use std::{collections::HashSet, sync::Arc};

use dashmap::DashMap;
use serde_json::json;
use thiserror::Error;
use time::{Duration, OffsetDateTime};
use tokio::sync::Mutex;
use tracing::{error, warn};
use uuid::Uuid;

#[cfg(test)]
use crate::db::mock_db::NoopWorkspaceRepository;
use crate::db::oauth_token_repository::UserOAuthTokenRepository;
#[cfg(test)]
use crate::db::workspace_connection_repository::StaleWorkspaceConnection;
#[cfg(test)]
use crate::db::workspace_connection_repository::WorkspaceConnectionListing;
use crate::db::workspace_connection_repository::{
    NewWorkspaceAuditEvent, NewWorkspaceConnection, WorkspaceConnectionRepository,
};
use crate::db::workspace_repository::WorkspaceRepository;
use crate::models::oauth_token::{
    ConnectedOAuthProvider, UserOAuthToken, WorkspaceConnection,
    WORKSPACE_AUDIT_EVENT_CONNECTION_PROMOTED, WORKSPACE_AUDIT_EVENT_CONNECTION_UNSHARED,
};
use crate::services::oauth::account_service::{
    AuthorizationTokens, OAuthAccountError, OAuthAccountService,
};
use crate::utils::encryption::{decrypt_secret, encrypt_secret, EncryptionError};

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct DecryptedWorkspaceConnection {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub created_by: Uuid,
    pub provider: ConnectedOAuthProvider,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: OffsetDateTime,
    pub account_email: String,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Error, Debug)]
pub enum WorkspaceOAuthError {
    #[error("token not found")]
    NotFound,
    #[error("forbidden")]
    Forbidden,
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("encryption error: {0}")]
    Encryption(#[from] EncryptionError),
    #[error("oauth error: {0}")]
    OAuth(#[from] OAuthAccountError),
}

#[async_trait::async_trait]
pub trait WorkspaceTokenRefresher: Send + Sync {
    async fn refresh_access_token(
        &self,
        provider: ConnectedOAuthProvider,
        refresh_token: &str,
    ) -> Result<AuthorizationTokens, OAuthAccountError>;
}

#[async_trait::async_trait]
impl WorkspaceTokenRefresher for OAuthAccountService {
    async fn refresh_access_token(
        &self,
        provider: ConnectedOAuthProvider,
        refresh_token: &str,
    ) -> Result<AuthorizationTokens, OAuthAccountError> {
        OAuthAccountService::refresh_access_token(self, provider, refresh_token).await
    }
}

#[derive(Clone)]
pub struct WorkspaceOAuthService {
    user_tokens: Arc<dyn UserOAuthTokenRepository>,
    workspace_repo: Arc<dyn WorkspaceRepository>,
    workspace_connections: Arc<dyn WorkspaceConnectionRepository>,
    oauth_accounts: Arc<dyn WorkspaceTokenRefresher>,
    encryption_key: Arc<Vec<u8>>,
    connection_locks: Arc<DashMap<Uuid, Arc<Mutex<()>>>>,
}

impl WorkspaceOAuthService {
    pub fn new(
        user_tokens: Arc<dyn UserOAuthTokenRepository>,
        workspace_repo: Arc<dyn WorkspaceRepository>,
        workspace_connections: Arc<dyn WorkspaceConnectionRepository>,
        oauth_accounts: Arc<dyn WorkspaceTokenRefresher>,
        encryption_key: Arc<Vec<u8>>,
    ) -> Self {
        Self {
            user_tokens,
            workspace_repo,
            workspace_connections,
            oauth_accounts,
            encryption_key,
            connection_locks: Arc::new(DashMap::new()),
        }
    }

    pub async fn promote_connection(
        &self,
        workspace_id: Uuid,
        actor_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<WorkspaceConnection, WorkspaceOAuthError> {
        self.ensure_membership(actor_id, workspace_id).await?;

        let token = self.load_token(actor_id, provider).await?;

        let connection = self
            .workspace_connections
            .insert_connection(NewWorkspaceConnection {
                workspace_id,
                created_by: actor_id,
                provider,
                access_token: token.access_token.clone(),
                refresh_token: token.refresh_token.clone(),
                expires_at: token.expires_at,
                account_email: token.account_email.clone(),
            })
            .await?;

        let _ = self
            .user_tokens
            .mark_shared(actor_id, provider, true)
            .await?;

        let metadata = json!({
            "provider": provider,
            "account_email": token.account_email,
        });

        let _ = self
            .workspace_connections
            .record_audit_event(NewWorkspaceAuditEvent {
                workspace_id,
                actor_id,
                event_type: WORKSPACE_AUDIT_EVENT_CONNECTION_PROMOTED.to_string(),
                metadata,
            })
            .await?;

        Ok(connection)
    }

    pub async fn remove_connection(
        &self,
        workspace_id: Uuid,
        actor_id: Uuid,
        connection_id: Uuid,
    ) -> Result<(), WorkspaceOAuthError> {
        self.ensure_membership(actor_id, workspace_id).await?;

        let connection = self
            .workspace_connections
            .find_by_id(connection_id)
            .await?
            .filter(|conn| conn.workspace_id == workspace_id)
            .ok_or(WorkspaceOAuthError::NotFound)?;

        if connection.created_by != actor_id {
            return Err(WorkspaceOAuthError::Forbidden);
        }

        match self
            .user_tokens
            .mark_shared(connection.created_by, connection.provider, false)
            .await
        {
            Ok(_) => {}
            Err(sqlx::Error::RowNotFound) => {
                warn!(
                    %connection_id,
                    %workspace_id,
                    user_id = %connection.created_by,
                    provider = ?connection.provider,
                    "personal oauth token missing while unsharing workspace connection"
                );
            }
            Err(err) => return Err(WorkspaceOAuthError::Database(err)),
        }

        self.workspace_connections
            .delete_connection(connection_id)
            .await?;

        let metadata = json!({
            "provider": connection.provider,
            "account_email": connection.account_email,
            "connection_id": connection.id,
        });

        self.workspace_connections
            .record_audit_event(NewWorkspaceAuditEvent {
                workspace_id,
                actor_id,
                event_type: WORKSPACE_AUDIT_EVENT_CONNECTION_UNSHARED.to_string(),
                metadata,
            })
            .await?;

        Ok(())
    }

    async fn ensure_membership(
        &self,
        user_id: Uuid,
        workspace_id: Uuid,
    ) -> Result<(), WorkspaceOAuthError> {
        if !self.workspace_repo.is_member(workspace_id, user_id).await? {
            return Err(WorkspaceOAuthError::Forbidden);
        }
        Ok(())
    }

    /// Purges connections for a departing member. The caller is expected to have
    /// already validated permissions because the actor might no longer belong to
    /// the workspace when this runs.
    pub async fn purge_member_connections(
        &self,
        workspace_id: Uuid,
        removed_user_id: Uuid,
        actor_id: Uuid,
    ) -> Result<(), WorkspaceOAuthError> {
        let connections = match self
            .workspace_connections
            .list_by_workspace_creator(workspace_id, removed_user_id)
            .await
        {
            Ok(rows) => rows,
            Err(err) => {
                error!(
                    ?err,
                    %workspace_id,
                    removed_user_id = %removed_user_id,
                    %actor_id,
                    "failed to load workspace connections for purge"
                );
                return Err(WorkspaceOAuthError::Database(err));
            }
        };

        if connections.is_empty() {
            return Ok(());
        }

        let mut processed_providers = HashSet::new();

        for connection in &connections {
            if !processed_providers.insert(connection.provider) {
                continue;
            }
            match self
                .user_tokens
                .mark_shared(removed_user_id, connection.provider, false)
                .await
            {
                Ok(_) => {}
                Err(sqlx::Error::RowNotFound) => {
                    warn!(
                        %workspace_id,
                        removed_user_id = %removed_user_id,
                        provider = ?connection.provider,
                        "personal oauth token missing during workspace purge"
                    );
                }
                Err(err) => {
                    error!(
                        ?err,
                        %workspace_id,
                        removed_user_id = %removed_user_id,
                        provider = ?connection.provider,
                        "failed to update personal token while purging workspace connections"
                    );
                    return Err(WorkspaceOAuthError::Database(err));
                }
            }
        }

        for connection in connections {
            if let Err(err) = self.workspace_connections.delete_by_id(connection.id).await {
                error!(
                    ?err,
                    %workspace_id,
                    removed_user_id = %removed_user_id,
                    connection_id = %connection.id,
                    "failed to delete workspace connection during purge"
                );
                return Err(WorkspaceOAuthError::Database(err));
            }

            let metadata = json!({
                "provider": connection.provider,
                "account_email": connection.account_email,
                "connection_id": connection.id,
                "removed_user_id": removed_user_id,
            });

            if let Err(err) = self
                .workspace_connections
                .record_audit_event(NewWorkspaceAuditEvent {
                    workspace_id,
                    actor_id,
                    event_type: WORKSPACE_AUDIT_EVENT_CONNECTION_UNSHARED.to_string(),
                    metadata,
                })
                .await
            {
                error!(
                    ?err,
                    %workspace_id,
                    removed_user_id = %removed_user_id,
                    connection_id = %connection.id,
                    "failed to record audit event during workspace purge"
                );
                return Err(WorkspaceOAuthError::Database(err));
            }
        }

        Ok(())
    }

    #[allow(dead_code)]
    pub async fn get_connection(
        &self,
        user_id: Uuid,
        workspace_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<DecryptedWorkspaceConnection, WorkspaceOAuthError> {
        self.ensure_membership(user_id, workspace_id).await?;

        let record = self
            .workspace_connections
            .find_by_workspace_and_provider(workspace_id, provider)
            .await?
            .ok_or(WorkspaceOAuthError::NotFound)?;
        self.decrypt_connection(record)
    }

    pub async fn ensure_valid_workspace_token(
        &self,
        workspace_id: Uuid,
        connection_id: Uuid,
    ) -> Result<DecryptedWorkspaceConnection, WorkspaceOAuthError> {
        let lock = self
            .connection_locks
            .entry(connection_id)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();

        let _guard = lock.lock().await;

        let record = self
            .workspace_connections
            .find_by_id(connection_id)
            .await?
            .filter(|conn| conn.workspace_id == workspace_id)
            .ok_or(WorkspaceOAuthError::NotFound)?;

        let mut decrypted = self.decrypt_connection(record.clone())?;
        let refresh_deadline = OffsetDateTime::now_utc() + Duration::seconds(60);

        if decrypted.expires_at <= refresh_deadline {
            let refreshed = match self
                .oauth_accounts
                .refresh_access_token(decrypted.provider, &decrypted.refresh_token)
                .await
            {
                Ok(tokens) => tokens,
                Err(err) => {
                    if matches!(err, OAuthAccountError::TokenRevoked { .. }) {
                        self.workspace_connections
                            .delete_connection(connection_id)
                            .await?;

                        match self
                            .user_tokens
                            .mark_shared(decrypted.created_by, decrypted.provider, false)
                            .await
                        {
                            Ok(_) => {}
                            Err(sqlx::Error::RowNotFound) => {
                                warn!(
                                    connection_id = %connection_id,
                                    provider = ?decrypted.provider,
                                    created_by = %decrypted.created_by,
                                    "workspace connection creator lost personal token while handling revocation"
                                );
                            }
                            Err(other) => return Err(WorkspaceOAuthError::Database(other)),
                        }
                    }

                    return Err(WorkspaceOAuthError::OAuth(err));
                }
            };

            let encrypted_access = encrypt_secret(&self.encryption_key, &refreshed.access_token)?;
            let encrypted_refresh = encrypt_secret(&self.encryption_key, &refreshed.refresh_token)?;

            let updated = self
                .workspace_connections
                .update_tokens(
                    connection_id,
                    encrypted_access,
                    encrypted_refresh,
                    refreshed.expires_at,
                )
                .await?;

            decrypted = self.decrypt_connection(updated)?;
        }

        Ok(decrypted)
    }

    pub async fn handle_revoked_connection(
        &self,
        workspace_id: Uuid,
        connection_id: Uuid,
    ) -> Result<(), WorkspaceOAuthError> {
        let record = self
            .workspace_connections
            .find_by_id(connection_id)
            .await?
            .filter(|conn| conn.workspace_id == workspace_id)
            .ok_or(WorkspaceOAuthError::NotFound)?;

        self.workspace_connections
            .delete_connection(connection_id)
            .await?;

        let personal_token_missing = match self
            .user_tokens
            .mark_shared(record.created_by, record.provider, false)
            .await
        {
            Ok(_) => false,
            Err(sqlx::Error::RowNotFound) => {
                warn!(
                    connection_id = %connection_id,
                    workspace_id = %workspace_id,
                    created_by = %record.created_by,
                    provider = ?record.provider,
                    "workspace connection creator missing personal token while handling revocation"
                );
                true
            }
            Err(err) => return Err(WorkspaceOAuthError::Database(err)),
        };

        warn!(
            connection_id = %connection_id,
            workspace_id = %workspace_id,
            created_by = %record.created_by,
            provider = ?record.provider,
            account_email = %record.account_email,
            personal_token_missing,
            "workspace connection revoked and shared credentials purged"
        );

        Ok(())
    }

    fn decrypt_connection(
        &self,
        record: WorkspaceConnection,
    ) -> Result<DecryptedWorkspaceConnection, WorkspaceOAuthError> {
        Ok(DecryptedWorkspaceConnection {
            id: record.id,
            workspace_id: record.workspace_id,
            created_by: record.created_by,
            provider: record.provider,
            access_token: decrypt_secret(&self.encryption_key, &record.access_token)?,
            refresh_token: decrypt_secret(&self.encryption_key, &record.refresh_token)?,
            expires_at: record.expires_at,
            account_email: record.account_email,
            created_at: record.created_at,
            updated_at: record.updated_at,
        })
    }

    async fn load_token(
        &self,
        actor_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<UserOAuthToken, WorkspaceOAuthError> {
        let record = self
            .user_tokens
            .find_by_user_and_provider(actor_id, provider)
            .await?
            .ok_or(WorkspaceOAuthError::NotFound)?;

        // Enforce personal token ownership strictly
        if record.user_id != actor_id || record.workspace_id.is_some() {
            return Err(WorkspaceOAuthError::Forbidden);
        }

        Ok(record)
    }

    #[cfg(test)]
    pub fn test_stub() -> Arc<Self> {
        use async_trait::async_trait;

        struct StubUserRepo;

        #[async_trait]
        impl UserOAuthTokenRepository for StubUserRepo {
            async fn upsert_token(
                &self,
                _new_token: crate::db::oauth_token_repository::NewUserOAuthToken,
            ) -> Result<UserOAuthToken, sqlx::Error> {
                Err(sqlx::Error::RowNotFound)
            }

            async fn find_by_user_and_provider(
                &self,
                _user_id: Uuid,
                _provider: ConnectedOAuthProvider,
            ) -> Result<Option<UserOAuthToken>, sqlx::Error> {
                Ok(None)
            }

            async fn delete_token(
                &self,
                _user_id: Uuid,
                _provider: ConnectedOAuthProvider,
            ) -> Result<(), sqlx::Error> {
                Ok(())
            }

            async fn list_tokens_for_user(
                &self,
                _user_id: Uuid,
            ) -> Result<Vec<UserOAuthToken>, sqlx::Error> {
                Ok(vec![])
            }

            async fn mark_shared(
                &self,
                _user_id: Uuid,
                _provider: ConnectedOAuthProvider,
                _is_shared: bool,
            ) -> Result<UserOAuthToken, sqlx::Error> {
                Err(sqlx::Error::RowNotFound)
            }
        }

        struct StubWorkspaceRepo;

        #[async_trait]
        impl WorkspaceConnectionRepository for StubWorkspaceRepo {
            async fn insert_connection(
                &self,
                _new_connection: NewWorkspaceConnection,
            ) -> Result<WorkspaceConnection, sqlx::Error> {
                Err(sqlx::Error::RowNotFound)
            }

            async fn find_by_id(
                &self,
                _connection_id: Uuid,
            ) -> Result<Option<WorkspaceConnection>, sqlx::Error> {
                Ok(None)
            }

            async fn find_by_workspace_and_provider(
                &self,
                _workspace_id: Uuid,
                _provider: ConnectedOAuthProvider,
            ) -> Result<Option<WorkspaceConnection>, sqlx::Error> {
                Ok(None)
            }

            async fn list_for_workspace(
                &self,
                _workspace_id: Uuid,
            ) -> Result<Vec<WorkspaceConnectionListing>, sqlx::Error> {
                Ok(Vec::new())
            }

            async fn list_for_user_memberships(
                &self,
                _user_id: Uuid,
            ) -> Result<Vec<WorkspaceConnectionListing>, sqlx::Error> {
                Ok(Vec::new())
            }

            async fn list_by_workspace_creator(
                &self,
                _workspace_id: Uuid,
                _creator_id: Uuid,
            ) -> Result<Vec<WorkspaceConnection>, sqlx::Error> {
                Ok(Vec::new())
            }

            async fn update_tokens_for_creator(
                &self,
                _creator_id: Uuid,
                _provider: ConnectedOAuthProvider,
                _access_token: String,
                _refresh_token: String,
                _expires_at: OffsetDateTime,
                _account_email: String,
            ) -> Result<(), sqlx::Error> {
                Ok(())
            }

            async fn update_tokens(
                &self,
                _connection_id: Uuid,
                _access_token: String,
                _refresh_token: String,
                _expires_at: OffsetDateTime,
            ) -> Result<WorkspaceConnection, sqlx::Error> {
                Err(sqlx::Error::RowNotFound)
            }

            async fn delete_connection(&self, _connection_id: Uuid) -> Result<(), sqlx::Error> {
                Ok(())
            }

            async fn delete_by_id(&self, _connection_id: Uuid) -> Result<(), sqlx::Error> {
                Ok(())
            }

            async fn mark_connections_stale_for_creator(
                &self,
                _creator_id: Uuid,
                _provider: ConnectedOAuthProvider,
            ) -> Result<Vec<StaleWorkspaceConnection>, sqlx::Error> {
                Ok(Vec::new())
            }

            async fn record_audit_event(
                &self,
                _event: NewWorkspaceAuditEvent,
            ) -> Result<crate::models::oauth_token::WorkspaceAuditEvent, sqlx::Error> {
                Err(sqlx::Error::RowNotFound)
            }
        }

        Arc::new(Self {
            user_tokens: Arc::new(StubUserRepo),
            workspace_repo: Arc::new(NoopWorkspaceRepository),
            workspace_connections: Arc::new(StubWorkspaceRepo),
            oauth_accounts: OAuthAccountService::test_stub() as Arc<dyn WorkspaceTokenRefresher>,
            encryption_key: Arc::new(vec![0u8; 32]),
            connection_locks: Arc::new(DashMap::new()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::collections::HashMap;
    use std::io::Write;
    use std::sync::{Arc, Mutex};
    use std::time::Duration as StdDuration;
    use time::Duration;
    use tokio::time::sleep;

    use crate::db::oauth_token_repository::NewUserOAuthToken;
    use crate::db::workspace_repository::WorkspaceRepository;
    use crate::models::plan::PlanTier;
    use crate::models::workspace::{
        Workspace, WorkspaceInvitation, WorkspaceMember, WorkspaceMembershipSummary, WorkspaceRole,
    };
    use crate::utils::encryption::encrypt_secret;

    fn noop_membership_repo() -> Arc<dyn WorkspaceRepository> {
        Arc::new(NoopWorkspaceRepository)
    }

    fn denying_membership_repo() -> Arc<dyn WorkspaceRepository> {
        Arc::new(MembershipGateRepo::new(false))
    }

    struct MembershipGateRepo {
        allowed: bool,
    }

    impl MembershipGateRepo {
        fn new(allowed: bool) -> Self {
            Self { allowed }
        }
    }

    #[async_trait]
    impl WorkspaceRepository for MembershipGateRepo {
        async fn create_workspace(
            &self,
            _name: &str,
            _created_by: Uuid,
            _plan: &str,
        ) -> Result<Workspace, sqlx::Error> {
            unimplemented!()
        }

        async fn update_workspace_name(
            &self,
            _workspace_id: Uuid,
            _name: &str,
        ) -> Result<Workspace, sqlx::Error> {
            unimplemented!()
        }

        async fn update_workspace_plan(
            &self,
            _workspace_id: Uuid,
            _plan: &str,
        ) -> Result<Workspace, sqlx::Error> {
            unimplemented!()
        }

        async fn get_plan(&self, _workspace_id: Uuid) -> Result<PlanTier, sqlx::Error> {
            Ok(PlanTier::Workspace)
        }

        async fn find_workspace(
            &self,
            _workspace_id: Uuid,
        ) -> Result<Option<Workspace>, sqlx::Error> {
            unimplemented!()
        }

        async fn add_member(
            &self,
            _workspace_id: Uuid,
            _user_id: Uuid,
            _role: WorkspaceRole,
        ) -> Result<(), sqlx::Error> {
            unimplemented!()
        }

        async fn set_member_role(
            &self,
            _workspace_id: Uuid,
            _user_id: Uuid,
            _role: WorkspaceRole,
        ) -> Result<(), sqlx::Error> {
            unimplemented!()
        }

        async fn remove_member(
            &self,
            _workspace_id: Uuid,
            _user_id: Uuid,
        ) -> Result<(), sqlx::Error> {
            unimplemented!()
        }

        async fn leave_workspace(
            &self,
            _workspace_id: Uuid,
            _user_id: Uuid,
        ) -> Result<(), sqlx::Error> {
            unimplemented!()
        }

        async fn revoke_member(
            &self,
            _workspace_id: Uuid,
            _member_id: Uuid,
            _revoked_by: Uuid,
            _reason: Option<&str>,
        ) -> Result<(), sqlx::Error> {
            unimplemented!()
        }

        async fn list_members(
            &self,
            _workspace_id: Uuid,
        ) -> Result<Vec<WorkspaceMember>, sqlx::Error> {
            unimplemented!()
        }

        async fn is_member(
            &self,
            _workspace_id: Uuid,
            _user_id: Uuid,
        ) -> Result<bool, sqlx::Error> {
            Ok(self.allowed)
        }

        async fn list_memberships_for_user(
            &self,
            _user_id: Uuid,
        ) -> Result<Vec<WorkspaceMembershipSummary>, sqlx::Error> {
            unimplemented!()
        }

        async fn list_user_workspaces(
            &self,
            _user_id: Uuid,
        ) -> Result<Vec<WorkspaceMembershipSummary>, sqlx::Error> {
            unimplemented!()
        }

        async fn create_workspace_invitation(
            &self,
            _workspace_id: Uuid,
            _email: &str,
            _role: WorkspaceRole,
            _token: &str,
            _expires_at: OffsetDateTime,
            _created_by: Uuid,
        ) -> Result<WorkspaceInvitation, sqlx::Error> {
            unimplemented!()
        }

        async fn list_workspace_invitations(
            &self,
            _workspace_id: Uuid,
        ) -> Result<Vec<WorkspaceInvitation>, sqlx::Error> {
            unimplemented!()
        }

        async fn revoke_workspace_invitation(&self, _invite_id: Uuid) -> Result<(), sqlx::Error> {
            unimplemented!()
        }

        async fn find_invitation_by_token(
            &self,
            _token: &str,
        ) -> Result<Option<WorkspaceInvitation>, sqlx::Error> {
            unimplemented!()
        }

        async fn mark_invitation_accepted(&self, _invite_id: Uuid) -> Result<(), sqlx::Error> {
            unimplemented!()
        }

        async fn mark_invitation_declined(&self, _invite_id: Uuid) -> Result<(), sqlx::Error> {
            unimplemented!()
        }

        async fn list_pending_invitations_for_email(
            &self,
            _email: &str,
        ) -> Result<Vec<WorkspaceInvitation>, sqlx::Error> {
            unimplemented!()
        }

        async fn disable_webhook_signing_for_workspace(
            &self,
            _workspace_id: Uuid,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }
    }

    #[derive(Clone)]
    struct BufferingMakeWriter {
        buffer: Arc<Mutex<Vec<u8>>>,
    }

    impl BufferingMakeWriter {
        fn new() -> Self {
            Self {
                buffer: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn buffer(&self) -> Arc<Mutex<Vec<u8>>> {
            Arc::clone(&self.buffer)
        }
    }

    struct BufferWriter {
        buffer: Arc<Mutex<Vec<u8>>>,
    }

    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for BufferingMakeWriter {
        type Writer = BufferWriter;

        fn make_writer(&'a self) -> Self::Writer {
            BufferWriter {
                buffer: Arc::clone(&self.buffer),
            }
        }
    }

    impl Write for BufferWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            let mut guard = self.buffer.lock().unwrap();
            guard.extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    struct InMemoryUserRepo {
        token: Mutex<Option<UserOAuthToken>>,
        shared_flag: Mutex<bool>,
    }

    #[async_trait]
    impl UserOAuthTokenRepository for InMemoryUserRepo {
        async fn upsert_token(
            &self,
            _new_token: NewUserOAuthToken,
        ) -> Result<UserOAuthToken, sqlx::Error> {
            Err(sqlx::Error::RowNotFound)
        }

        async fn find_by_user_and_provider(
            &self,
            user_id: Uuid,
            provider: ConnectedOAuthProvider,
        ) -> Result<Option<UserOAuthToken>, sqlx::Error> {
            let token = self.token.lock().unwrap();
            Ok(token
                .clone()
                .filter(|record| record.user_id == user_id && record.provider == provider))
        }

        async fn delete_token(
            &self,
            _user_id: Uuid,
            _provider: ConnectedOAuthProvider,
        ) -> Result<(), sqlx::Error> {
            let mut token = self.token.lock().unwrap();
            *token = None;
            Ok(())
        }

        async fn list_tokens_for_user(
            &self,
            _user_id: Uuid,
        ) -> Result<Vec<UserOAuthToken>, sqlx::Error> {
            Ok(vec![])
        }

        async fn mark_shared(
            &self,
            _user_id: Uuid,
            _provider: ConnectedOAuthProvider,
            is_shared: bool,
        ) -> Result<UserOAuthToken, sqlx::Error> {
            let mut flag = self.shared_flag.lock().unwrap();
            *flag = is_shared;
            let token = self.token.lock().unwrap();
            token.clone().ok_or(sqlx::Error::RowNotFound)
        }
    }

    struct InMemoryWorkspaceRepo {
        connection: Mutex<Option<WorkspaceConnection>>,
        events: Mutex<Vec<crate::models::oauth_token::WorkspaceAuditEvent>>,
        find_by_id_calls: Mutex<Vec<Uuid>>,
        update_calls: Mutex<usize>,
    }

    impl InMemoryWorkspaceRepo {
        fn new() -> Self {
            Self {
                connection: Mutex::new(None),
                events: Mutex::new(Vec::new()),
                find_by_id_calls: Mutex::new(Vec::new()),
                update_calls: Mutex::new(0),
            }
        }
    }

    #[async_trait]
    impl WorkspaceConnectionRepository for InMemoryWorkspaceRepo {
        async fn insert_connection(
            &self,
            new_connection: NewWorkspaceConnection,
        ) -> Result<WorkspaceConnection, sqlx::Error> {
            let record = WorkspaceConnection {
                id: Uuid::new_v4(),
                workspace_id: new_connection.workspace_id,
                created_by: new_connection.created_by,
                provider: new_connection.provider,
                access_token: new_connection.access_token,
                refresh_token: new_connection.refresh_token,
                expires_at: new_connection.expires_at,
                account_email: new_connection.account_email,
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            };
            let mut guard = self.connection.lock().unwrap();
            *guard = Some(record.clone());
            Ok(record)
        }

        async fn find_by_id(
            &self,
            connection_id: Uuid,
        ) -> Result<Option<WorkspaceConnection>, sqlx::Error> {
            self.find_by_id_calls.lock().unwrap().push(connection_id);
            let guard = self.connection.lock().unwrap();
            Ok(guard.clone().filter(|record| record.id == connection_id))
        }

        async fn find_by_workspace_and_provider(
            &self,
            workspace_id: Uuid,
            provider: ConnectedOAuthProvider,
        ) -> Result<Option<WorkspaceConnection>, sqlx::Error> {
            let guard = self.connection.lock().unwrap();
            Ok(guard.clone().filter(|record| {
                record.workspace_id == workspace_id && record.provider == provider
            }))
        }

        async fn list_for_workspace(
            &self,
            workspace_id: Uuid,
        ) -> Result<Vec<WorkspaceConnectionListing>, sqlx::Error> {
            let guard = self.connection.lock().unwrap();
            Ok(guard
                .clone()
                .filter(|record| record.workspace_id == workspace_id)
                .into_iter()
                .map(|record| WorkspaceConnectionListing {
                    id: record.id,
                    workspace_id: record.workspace_id,
                    workspace_name: String::new(),
                    provider: record.provider,
                    account_email: record.account_email.clone(),
                    expires_at: record.expires_at,
                    shared_by_first_name: None,
                    shared_by_last_name: None,
                    shared_by_email: None,
                    updated_at: record.updated_at,
                    requires_reconnect: false,
                })
                .collect())
        }

        async fn list_for_user_memberships(
            &self,
            user_id: Uuid,
        ) -> Result<Vec<WorkspaceConnectionListing>, sqlx::Error> {
            let guard = self.connection.lock().unwrap();
            Ok(guard
                .clone()
                .filter(|record| record.created_by == user_id)
                .into_iter()
                .map(|record| WorkspaceConnectionListing {
                    id: record.id,
                    workspace_id: record.workspace_id,
                    workspace_name: String::new(),
                    provider: record.provider,
                    account_email: record.account_email.clone(),
                    expires_at: record.expires_at,
                    shared_by_first_name: None,
                    shared_by_last_name: None,
                    shared_by_email: None,
                    updated_at: record.updated_at,
                    requires_reconnect: false,
                })
                .collect())
        }

        async fn list_by_workspace_creator(
            &self,
            workspace_id: Uuid,
            creator_id: Uuid,
        ) -> Result<Vec<WorkspaceConnection>, sqlx::Error> {
            let guard = self.connection.lock().unwrap();
            Ok(guard
                .clone()
                .filter(|record| {
                    record.workspace_id == workspace_id && record.created_by == creator_id
                })
                .into_iter()
                .collect())
        }

        async fn update_tokens_for_creator(
            &self,
            creator_id: Uuid,
            provider: ConnectedOAuthProvider,
            access_token: String,
            refresh_token: String,
            expires_at: OffsetDateTime,
            account_email: String,
        ) -> Result<(), sqlx::Error> {
            let mut guard = self.connection.lock().unwrap();
            if let Some(conn) = guard.as_mut() {
                if conn.created_by == creator_id && conn.provider == provider {
                    conn.access_token = access_token;
                    conn.refresh_token = refresh_token;
                    conn.expires_at = expires_at;
                    conn.account_email = account_email;
                    conn.updated_at = OffsetDateTime::now_utc();
                }
            }

            Ok(())
        }

        async fn update_tokens(
            &self,
            connection_id: Uuid,
            access_token: String,
            refresh_token: String,
            expires_at: OffsetDateTime,
        ) -> Result<WorkspaceConnection, sqlx::Error> {
            let mut guard = self.connection.lock().unwrap();
            if let Some(conn) = guard.as_mut() {
                if conn.id == connection_id {
                    let mut update_guard = self.update_calls.lock().unwrap();
                    *update_guard += 1;
                    conn.access_token = access_token;
                    conn.refresh_token = refresh_token;
                    conn.expires_at = expires_at;
                    conn.updated_at = OffsetDateTime::now_utc();
                    return Ok(conn.clone());
                }
            }
            Err(sqlx::Error::RowNotFound)
        }

        async fn delete_connection(&self, connection_id: Uuid) -> Result<(), sqlx::Error> {
            let mut guard = self.connection.lock().unwrap();
            if guard.as_ref().map(|record| record.id) == Some(connection_id) {
                *guard = None;
            }
            Ok(())
        }

        async fn delete_by_id(&self, connection_id: Uuid) -> Result<(), sqlx::Error> {
            self.delete_connection(connection_id).await
        }

        async fn mark_connections_stale_for_creator(
            &self,
            creator_id: Uuid,
            provider: ConnectedOAuthProvider,
        ) -> Result<Vec<StaleWorkspaceConnection>, sqlx::Error> {
            let mut guard = self.connection.lock().unwrap();
            let mut affected = Vec::new();
            if let Some(conn) = guard.as_mut() {
                if conn.created_by == creator_id && conn.provider == provider {
                    conn.expires_at = OffsetDateTime::now_utc() - Duration::minutes(5);
                    conn.updated_at = OffsetDateTime::now_utc();
                    affected.push(StaleWorkspaceConnection {
                        connection_id: conn.id,
                        workspace_id: conn.workspace_id,
                    });
                }
            }
            Ok(affected)
        }

        async fn record_audit_event(
            &self,
            event: NewWorkspaceAuditEvent,
        ) -> Result<crate::models::oauth_token::WorkspaceAuditEvent, sqlx::Error> {
            let audit = crate::models::oauth_token::WorkspaceAuditEvent {
                id: Uuid::new_v4(),
                workspace_id: event.workspace_id,
                actor_id: event.actor_id,
                event_type: event.event_type,
                metadata: event.metadata,
                created_at: OffsetDateTime::now_utc(),
            };
            let mut guard = self.events.lock().unwrap();
            guard.push(audit.clone());
            Ok(audit)
        }
    }

    #[derive(Clone)]
    struct RecordingTokenRefresher {
        calls: Arc<Mutex<Vec<String>>>,
        response: AuthorizationTokens,
        delay: StdDuration,
    }

    impl RecordingTokenRefresher {
        fn new(response: AuthorizationTokens) -> Self {
            Self {
                calls: Arc::new(Mutex::new(Vec::new())),
                response,
                delay: StdDuration::from_millis(25),
            }
        }

        fn without_delay(response: AuthorizationTokens) -> Self {
            Self {
                calls: Arc::new(Mutex::new(Vec::new())),
                response,
                delay: StdDuration::from_millis(0),
            }
        }

        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl WorkspaceTokenRefresher for RecordingTokenRefresher {
        async fn refresh_access_token(
            &self,
            _provider: ConnectedOAuthProvider,
            refresh_token: &str,
        ) -> Result<AuthorizationTokens, OAuthAccountError> {
            if self.delay > StdDuration::from_millis(0) {
                sleep(self.delay).await;
            }
            self.calls.lock().unwrap().push(refresh_token.to_string());
            Ok(self.response.clone())
        }
    }

    #[derive(Clone)]
    struct RevokingTokenRefresher;

    #[async_trait]
    impl WorkspaceTokenRefresher for RevokingTokenRefresher {
        async fn refresh_access_token(
            &self,
            provider: ConnectedOAuthProvider,
            _refresh_token: &str,
        ) -> Result<AuthorizationTokens, OAuthAccountError> {
            Err(OAuthAccountError::TokenRevoked { provider })
        }
    }

    #[derive(Default)]
    struct RecordingUserRepo {
        tokens: Mutex<HashMap<ConnectedOAuthProvider, UserOAuthToken>>,
        marks: Mutex<Vec<(Uuid, ConnectedOAuthProvider, bool)>>,
        missing: Mutex<HashSet<ConnectedOAuthProvider>>,
    }

    impl RecordingUserRepo {
        fn new() -> Self {
            Self::default()
        }

        fn set_token(&self, provider: ConnectedOAuthProvider, user_id: Uuid) {
            let now = OffsetDateTime::now_utc();
            let token = UserOAuthToken {
                id: Uuid::new_v4(),
                user_id,
                workspace_id: None,
                provider,
                access_token: String::new(),
                refresh_token: String::new(),
                expires_at: now + Duration::hours(1),
                account_email: "shared@example.com".into(),
                is_shared: true,
                created_at: now,
                updated_at: now,
            };
            self.tokens.lock().unwrap().insert(provider, token);
        }

        fn marks(&self) -> Vec<(Uuid, ConnectedOAuthProvider, bool)> {
            self.marks.lock().unwrap().clone()
        }

        fn fail_for(&self, provider: ConnectedOAuthProvider) {
            self.missing.lock().unwrap().insert(provider);
        }
    }

    #[async_trait]
    impl UserOAuthTokenRepository for RecordingUserRepo {
        async fn upsert_token(
            &self,
            _new_token: crate::db::oauth_token_repository::NewUserOAuthToken,
        ) -> Result<UserOAuthToken, sqlx::Error> {
            Err(sqlx::Error::RowNotFound)
        }

        async fn find_by_user_and_provider(
            &self,
            _user_id: Uuid,
            _provider: ConnectedOAuthProvider,
        ) -> Result<Option<UserOAuthToken>, sqlx::Error> {
            Ok(None)
        }

        async fn delete_token(
            &self,
            _user_id: Uuid,
            _provider: ConnectedOAuthProvider,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn list_tokens_for_user(
            &self,
            _user_id: Uuid,
        ) -> Result<Vec<UserOAuthToken>, sqlx::Error> {
            Ok(vec![])
        }

        async fn mark_shared(
            &self,
            user_id: Uuid,
            provider: ConnectedOAuthProvider,
            is_shared: bool,
        ) -> Result<UserOAuthToken, sqlx::Error> {
            self.marks
                .lock()
                .unwrap()
                .push((user_id, provider, is_shared));

            if self.missing.lock().unwrap().contains(&provider) {
                return Err(sqlx::Error::RowNotFound);
            }

            let mut guard = self.tokens.lock().unwrap();
            if let Some(token) = guard
                .get_mut(&provider)
                .filter(|token| token.user_id == user_id)
            {
                token.is_shared = is_shared;
                token.updated_at = OffsetDateTime::now_utc();
                return Ok(token.clone());
            }

            Err(sqlx::Error::RowNotFound)
        }
    }

    #[derive(Default)]
    struct RecordingWorkspaceRepo {
        connections: Mutex<Vec<WorkspaceConnection>>,
        deleted: Mutex<Vec<Uuid>>,
        events: Mutex<Vec<crate::models::oauth_token::WorkspaceAuditEvent>>,
    }

    impl RecordingWorkspaceRepo {
        fn with_connections(connections: Vec<WorkspaceConnection>) -> Self {
            Self {
                connections: Mutex::new(connections),
                deleted: Mutex::new(Vec::new()),
                events: Mutex::new(Vec::new()),
            }
        }

        fn deleted(&self) -> Vec<Uuid> {
            self.deleted.lock().unwrap().clone()
        }

        fn events(&self) -> Vec<crate::models::oauth_token::WorkspaceAuditEvent> {
            self.events.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl WorkspaceConnectionRepository for RecordingWorkspaceRepo {
        async fn insert_connection(
            &self,
            _new_connection: NewWorkspaceConnection,
        ) -> Result<WorkspaceConnection, sqlx::Error> {
            Err(sqlx::Error::RowNotFound)
        }

        async fn find_by_id(
            &self,
            _connection_id: Uuid,
        ) -> Result<Option<WorkspaceConnection>, sqlx::Error> {
            Ok(None)
        }

        async fn find_by_workspace_and_provider(
            &self,
            _workspace_id: Uuid,
            _provider: ConnectedOAuthProvider,
        ) -> Result<Option<WorkspaceConnection>, sqlx::Error> {
            Ok(None)
        }

        async fn list_for_workspace(
            &self,
            _workspace_id: Uuid,
        ) -> Result<Vec<WorkspaceConnectionListing>, sqlx::Error> {
            Ok(Vec::new())
        }

        async fn list_for_user_memberships(
            &self,
            _user_id: Uuid,
        ) -> Result<Vec<WorkspaceConnectionListing>, sqlx::Error> {
            Ok(Vec::new())
        }

        async fn list_by_workspace_creator(
            &self,
            workspace_id: Uuid,
            creator_id: Uuid,
        ) -> Result<Vec<WorkspaceConnection>, sqlx::Error> {
            let guard = self.connections.lock().unwrap();
            Ok(guard
                .iter()
                .filter(|conn| conn.workspace_id == workspace_id && conn.created_by == creator_id)
                .cloned()
                .collect())
        }

        async fn update_tokens_for_creator(
            &self,
            _creator_id: Uuid,
            _provider: ConnectedOAuthProvider,
            _access_token: String,
            _refresh_token: String,
            _expires_at: OffsetDateTime,
            _account_email: String,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn update_tokens(
            &self,
            _connection_id: Uuid,
            _access_token: String,
            _refresh_token: String,
            _expires_at: OffsetDateTime,
        ) -> Result<WorkspaceConnection, sqlx::Error> {
            Err(sqlx::Error::RowNotFound)
        }

        async fn delete_connection(&self, _connection_id: Uuid) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn delete_by_id(&self, connection_id: Uuid) -> Result<(), sqlx::Error> {
            let mut guard = self.connections.lock().unwrap();
            guard.retain(|conn| conn.id != connection_id);
            self.deleted.lock().unwrap().push(connection_id);
            Ok(())
        }

        async fn mark_connections_stale_for_creator(
            &self,
            _creator_id: Uuid,
            _provider: ConnectedOAuthProvider,
        ) -> Result<Vec<StaleWorkspaceConnection>, sqlx::Error> {
            Ok(Vec::new())
        }

        async fn record_audit_event(
            &self,
            event: NewWorkspaceAuditEvent,
        ) -> Result<crate::models::oauth_token::WorkspaceAuditEvent, sqlx::Error> {
            let audit = crate::models::oauth_token::WorkspaceAuditEvent {
                id: Uuid::new_v4(),
                workspace_id: event.workspace_id,
                actor_id: event.actor_id,
                event_type: event.event_type,
                metadata: event.metadata,
                created_at: OffsetDateTime::now_utc(),
            };
            self.events.lock().unwrap().push(audit.clone());
            Ok(audit)
        }
    }

    fn workspace_connection_record(
        workspace_id: Uuid,
        created_by: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> WorkspaceConnection {
        let now = OffsetDateTime::now_utc();
        WorkspaceConnection {
            id: Uuid::new_v4(),
            workspace_id,
            created_by,
            provider,
            access_token: "enc-access".into(),
            refresh_token: "enc-refresh".into(),
            expires_at: now + Duration::hours(1),
            account_email: "shared@example.com".into(),
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn promote_connection_copies_encrypted_tokens_and_marks_shared() {
        let user_id = Uuid::new_v4();
        let workspace_id = Uuid::new_v4();
        let key = Arc::new(vec![7u8; 32]);
        let expires_at = OffsetDateTime::now_utc() + Duration::hours(1);
        let encrypted_access = encrypt_secret(&key, "access").unwrap();
        let encrypted_refresh = encrypt_secret(&key, "refresh").unwrap();

        let user_repo = Arc::new(InMemoryUserRepo {
            token: Mutex::new(Some(UserOAuthToken {
                id: Uuid::new_v4(),
                user_id,
                workspace_id: None,
                provider: ConnectedOAuthProvider::Google,
                access_token: encrypted_access.clone(),
                refresh_token: encrypted_refresh.clone(),
                expires_at,
                account_email: "user@example.com".into(),
                is_shared: false,
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            })),
            shared_flag: Mutex::new(false),
        });
        let workspace_repo = Arc::new(InMemoryWorkspaceRepo::new());

        let oauth_accounts = OAuthAccountService::test_stub();
        let workspace_token_refresher: Arc<dyn WorkspaceTokenRefresher> =
            oauth_accounts.clone() as Arc<dyn WorkspaceTokenRefresher>;
        let service = WorkspaceOAuthService::new(
            user_repo.clone(),
            noop_membership_repo(),
            workspace_repo.clone(),
            workspace_token_refresher,
            key,
        );

        let result = service
            .promote_connection(workspace_id, user_id, ConnectedOAuthProvider::Google)
            .await
            .expect("promotion succeeds");

        assert_eq!(result.workspace_id, workspace_id);
        assert_eq!(result.created_by, user_id);
        assert_eq!(result.access_token, encrypted_access);
        assert_eq!(result.refresh_token, encrypted_refresh);

        let shared = *user_repo.shared_flag.lock().unwrap();
        assert!(shared, "user token should be marked shared");

        let events = workspace_repo.events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].event_type,
            WORKSPACE_AUDIT_EVENT_CONNECTION_PROMOTED
        );
    }

    #[tokio::test]
    async fn promote_slack_connection_copies_tokens_and_marks_shared() {
        let user_id = Uuid::new_v4();
        let workspace_id = Uuid::new_v4();
        let key = Arc::new(vec![9u8; 32]);
        let expires_at = OffsetDateTime::now_utc() + Duration::hours(2);
        let encrypted_access = encrypt_secret(&key, "slack-access").unwrap();
        let encrypted_refresh = encrypt_secret(&key, "slack-refresh").unwrap();

        let user_repo = Arc::new(InMemoryUserRepo {
            token: Mutex::new(Some(UserOAuthToken {
                id: Uuid::new_v4(),
                user_id,
                workspace_id: None,
                provider: ConnectedOAuthProvider::Slack,
                access_token: encrypted_access.clone(),
                refresh_token: encrypted_refresh.clone(),
                expires_at,
                account_email: "slack@example.com".into(),
                is_shared: false,
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            })),
            shared_flag: Mutex::new(false),
        });
        let workspace_repo = Arc::new(InMemoryWorkspaceRepo::new());

        let oauth_accounts = OAuthAccountService::test_stub();
        let refresher: Arc<dyn WorkspaceTokenRefresher> =
            oauth_accounts.clone() as Arc<dyn WorkspaceTokenRefresher>;
        let service = WorkspaceOAuthService::new(
            user_repo.clone(),
            noop_membership_repo(),
            workspace_repo.clone(),
            refresher,
            key,
        );

        let result = service
            .promote_connection(workspace_id, user_id, ConnectedOAuthProvider::Slack)
            .await
            .expect("promotion succeeds");

        assert_eq!(result.workspace_id, workspace_id);
        assert_eq!(result.provider, ConnectedOAuthProvider::Slack);
        assert_eq!(result.access_token, encrypted_access);
        assert_eq!(result.refresh_token, encrypted_refresh);

        let shared = *user_repo.shared_flag.lock().unwrap();
        assert!(shared);

        let events = workspace_repo.events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].event_type,
            WORKSPACE_AUDIT_EVENT_CONNECTION_PROMOTED
        );
    }

    #[tokio::test]
    async fn remove_connection_deletes_workspace_entry_and_marks_unshared() {
        let user_id = Uuid::new_v4();
        let workspace_id = Uuid::new_v4();
        let connection_id = Uuid::new_v4();
        let key = Arc::new(vec![11u8; 32]);
        let expires_at = OffsetDateTime::now_utc() + Duration::hours(1);
        let encrypted_access = encrypt_secret(&key, "access").unwrap();
        let encrypted_refresh = encrypt_secret(&key, "refresh").unwrap();

        let user_repo = Arc::new(InMemoryUserRepo {
            token: Mutex::new(Some(UserOAuthToken {
                id: Uuid::new_v4(),
                user_id,
                workspace_id: None,
                provider: ConnectedOAuthProvider::Google,
                access_token: encrypted_access.clone(),
                refresh_token: encrypted_refresh.clone(),
                expires_at,
                account_email: "user@example.com".into(),
                is_shared: true,
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            })),
            shared_flag: Mutex::new(true),
        });
        let workspace_repo = Arc::new(InMemoryWorkspaceRepo::new());
        {
            let mut guard = workspace_repo.connection.lock().unwrap();
            *guard = Some(WorkspaceConnection {
                id: connection_id,
                workspace_id,
                created_by: user_id,
                provider: ConnectedOAuthProvider::Google,
                access_token: encrypted_access.clone(),
                refresh_token: encrypted_refresh.clone(),
                expires_at,
                account_email: "user@example.com".into(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            });
        }

        let oauth_accounts = OAuthAccountService::test_stub();
        let refresher: Arc<dyn WorkspaceTokenRefresher> =
            oauth_accounts.clone() as Arc<dyn WorkspaceTokenRefresher>;
        let service = WorkspaceOAuthService::new(
            user_repo.clone(),
            noop_membership_repo(),
            workspace_repo.clone(),
            refresher,
            key,
        );

        service
            .remove_connection(workspace_id, user_id, connection_id)
            .await
            .expect("removal succeeds");

        assert!(workspace_repo.connection.lock().unwrap().is_none());
        let shared = *user_repo.shared_flag.lock().unwrap();
        assert!(!shared, "user token should be marked unshared");

        let events = workspace_repo.events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].event_type,
            WORKSPACE_AUDIT_EVENT_CONNECTION_UNSHARED
        );
        assert_eq!(events[0].workspace_id, workspace_id);
        assert_eq!(events[0].actor_id, user_id);
    }

    #[tokio::test]
    async fn remove_connection_succeeds_when_personal_token_missing() {
        let user_id = Uuid::new_v4();
        let workspace_id = Uuid::new_v4();
        let connection_id = Uuid::new_v4();
        let key = Arc::new(vec![13u8; 32]);
        let expires_at = OffsetDateTime::now_utc() + Duration::hours(1);
        let encrypted_access = encrypt_secret(&key, "access").unwrap();
        let encrypted_refresh = encrypt_secret(&key, "refresh").unwrap();

        let user_repo = Arc::new(InMemoryUserRepo {
            token: Mutex::new(None),
            shared_flag: Mutex::new(true),
        });
        let workspace_repo = Arc::new(InMemoryWorkspaceRepo::new());
        {
            let mut guard = workspace_repo.connection.lock().unwrap();
            *guard = Some(WorkspaceConnection {
                id: connection_id,
                workspace_id,
                created_by: user_id,
                provider: ConnectedOAuthProvider::Google,
                access_token: encrypted_access.clone(),
                refresh_token: encrypted_refresh.clone(),
                expires_at,
                account_email: "user@example.com".into(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            });
        }

        let oauth_accounts = OAuthAccountService::test_stub();
        let refresher: Arc<dyn WorkspaceTokenRefresher> =
            oauth_accounts.clone() as Arc<dyn WorkspaceTokenRefresher>;
        let service = WorkspaceOAuthService::new(
            user_repo.clone(),
            noop_membership_repo(),
            workspace_repo.clone(),
            refresher,
            key,
        );

        let make_writer = BufferingMakeWriter::new();
        let captured = make_writer.buffer();
        let subscriber = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::INFO)
            .with_writer(make_writer.clone())
            .without_time()
            .finish();
        let guard = tracing::subscriber::set_default(subscriber);

        service
            .remove_connection(workspace_id, user_id, connection_id)
            .await
            .expect("removal succeeds even without personal token");

        drop(guard);

        assert!(workspace_repo.connection.lock().unwrap().is_none());
        let shared = *user_repo.shared_flag.lock().unwrap();
        assert!(
            !shared,
            "shared flag should be cleared when removal succeeds"
        );

        let events = workspace_repo.events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].event_type,
            WORKSPACE_AUDIT_EVENT_CONNECTION_UNSHARED
        );

        let logs = String::from_utf8(captured.lock().unwrap().clone()).unwrap();
        assert!(logs.contains(&workspace_id.to_string()));
        assert!(logs.contains(&connection_id.to_string()));
        let alert_logged = logs
            .contains("workspace connection revoked and shared credentials purged")
            || logs.contains(
                "workspace connection creator missing personal token while handling revocation",
            )
            || logs.contains("personal oauth token missing while unsharing workspace connection");
        assert!(alert_logged);
    }

    #[tokio::test]
    async fn remove_connection_rejects_non_creator_actor() {
        let creator_id = Uuid::new_v4();
        let actor_id = Uuid::new_v4();
        let workspace_id = Uuid::new_v4();
        let connection_id = Uuid::new_v4();
        let key = Arc::new(vec![23u8; 32]);
        let expires_at = OffsetDateTime::now_utc() + Duration::hours(1);
        let encrypted_access = encrypt_secret(&key, "access").unwrap();
        let encrypted_refresh = encrypt_secret(&key, "refresh").unwrap();

        let user_repo = Arc::new(InMemoryUserRepo {
            token: Mutex::new(Some(UserOAuthToken {
                id: Uuid::new_v4(),
                user_id: creator_id,
                workspace_id: None,
                provider: ConnectedOAuthProvider::Google,
                access_token: encrypted_access.clone(),
                refresh_token: encrypted_refresh.clone(),
                expires_at,
                account_email: "owner@example.com".into(),
                is_shared: true,
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            })),
            shared_flag: Mutex::new(true),
        });
        let workspace_repo = Arc::new(InMemoryWorkspaceRepo::new());
        {
            let mut guard = workspace_repo.connection.lock().unwrap();
            *guard = Some(WorkspaceConnection {
                id: connection_id,
                workspace_id,
                created_by: creator_id,
                provider: ConnectedOAuthProvider::Google,
                access_token: encrypted_access.clone(),
                refresh_token: encrypted_refresh.clone(),
                expires_at,
                account_email: "owner@example.com".into(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            });
        }

        let oauth_accounts = OAuthAccountService::test_stub();
        let refresher: Arc<dyn WorkspaceTokenRefresher> =
            oauth_accounts.clone() as Arc<dyn WorkspaceTokenRefresher>;
        let service = WorkspaceOAuthService::new(
            user_repo.clone(),
            noop_membership_repo(),
            workspace_repo.clone(),
            refresher,
            key,
        );

        let err = service
            .remove_connection(workspace_id, actor_id, connection_id)
            .await
            .expect_err("non-creator actor should be rejected");

        assert!(matches!(err, WorkspaceOAuthError::Forbidden));
        assert!(workspace_repo.connection.lock().unwrap().is_some());
        let shared = *user_repo.shared_flag.lock().unwrap();
        assert!(shared, "shared flag should remain unchanged when forbidden");
        let events = workspace_repo.events.lock().unwrap();
        assert!(events.is_empty(), "no audit events should be recorded");
    }

    #[tokio::test]
    async fn handle_revoked_connection_removes_entry_and_marks_unshared() {
        let user_id = Uuid::new_v4();
        let workspace_id = Uuid::new_v4();
        let connection_id = Uuid::new_v4();
        let key = Arc::new(vec![17u8; 32]);
        let expires_at = OffsetDateTime::now_utc() + Duration::hours(1);
        let encrypted_access = encrypt_secret(&key, "access").unwrap();
        let encrypted_refresh = encrypt_secret(&key, "refresh").unwrap();

        let user_repo = Arc::new(InMemoryUserRepo {
            token: Mutex::new(Some(UserOAuthToken {
                id: Uuid::new_v4(),
                user_id,
                workspace_id: None,
                provider: ConnectedOAuthProvider::Google,
                access_token: encrypted_access.clone(),
                refresh_token: encrypted_refresh.clone(),
                expires_at,
                account_email: "user@example.com".into(),
                is_shared: true,
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            })),
            shared_flag: Mutex::new(true),
        });
        let workspace_repo = Arc::new(InMemoryWorkspaceRepo::new());
        {
            let mut guard = workspace_repo.connection.lock().unwrap();
            *guard = Some(WorkspaceConnection {
                id: connection_id,
                workspace_id,
                created_by: user_id,
                provider: ConnectedOAuthProvider::Google,
                access_token: encrypted_access.clone(),
                refresh_token: encrypted_refresh.clone(),
                expires_at,
                account_email: "user@example.com".into(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            });
        }

        let oauth_accounts = OAuthAccountService::test_stub();
        let refresher: Arc<dyn WorkspaceTokenRefresher> =
            oauth_accounts.clone() as Arc<dyn WorkspaceTokenRefresher>;
        let service = WorkspaceOAuthService::new(
            user_repo.clone(),
            noop_membership_repo(),
            workspace_repo.clone(),
            refresher,
            key,
        );

        service
            .handle_revoked_connection(workspace_id, connection_id)
            .await
            .expect("revoked cleanup succeeds");

        assert!(workspace_repo.connection.lock().unwrap().is_none());
        let shared = *user_repo.shared_flag.lock().unwrap();
        assert!(
            !shared,
            "user token should be marked unshared after revocation"
        );
    }

    #[tokio::test]
    async fn get_connection_decrypts_tokens() {
        let workspace_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let key = Arc::new(vec![9u8; 32]);
        let expires_at = OffsetDateTime::now_utc();
        let encrypted_access = encrypt_secret(&key, "access-token").unwrap();
        let encrypted_refresh = encrypt_secret(&key, "refresh-token").unwrap();

        let workspace_repo = Arc::new(InMemoryWorkspaceRepo::new());
        {
            let mut guard = workspace_repo.connection.lock().unwrap();
            *guard = Some(WorkspaceConnection {
                id: Uuid::new_v4(),
                workspace_id,
                created_by: user_id,
                provider: ConnectedOAuthProvider::Microsoft,
                access_token: encrypted_access.clone(),
                refresh_token: encrypted_refresh.clone(),
                expires_at,
                account_email: "user@example.com".into(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            });
        }

        let user_repo = Arc::new(InMemoryUserRepo {
            token: Mutex::new(None),
            shared_flag: Mutex::new(false),
        });

        let oauth_accounts = OAuthAccountService::test_stub();
        let workspace_token_refresher: Arc<dyn WorkspaceTokenRefresher> =
            oauth_accounts.clone() as Arc<dyn WorkspaceTokenRefresher>;
        let service = WorkspaceOAuthService::new(
            user_repo,
            noop_membership_repo(),
            workspace_repo,
            workspace_token_refresher,
            key,
        );

        let connection = service
            .get_connection(user_id, workspace_id, ConnectedOAuthProvider::Microsoft)
            .await
            .expect("connection exists");

        assert_eq!(connection.workspace_id, workspace_id);
        assert_eq!(connection.provider, ConnectedOAuthProvider::Microsoft);
        assert_eq!(connection.access_token, "access-token");
        assert_eq!(connection.refresh_token, "refresh-token");
    }

    #[tokio::test]
    async fn get_connection_rejects_non_member() {
        let workspace_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let key = Arc::new(vec![5u8; 32]);
        let expires_at = OffsetDateTime::now_utc();
        let encrypted_access = encrypt_secret(&key, "blocked-access").unwrap();
        let encrypted_refresh = encrypt_secret(&key, "blocked-refresh").unwrap();

        let connections = Arc::new(InMemoryWorkspaceRepo::new());
        {
            let mut guard = connections.connection.lock().unwrap();
            *guard = Some(WorkspaceConnection {
                id: Uuid::new_v4(),
                workspace_id,
                created_by: user_id,
                provider: ConnectedOAuthProvider::Slack,
                access_token: encrypted_access,
                refresh_token: encrypted_refresh,
                expires_at,
                account_email: "user@example.com".into(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            });
        }

        let user_repo = Arc::new(InMemoryUserRepo {
            token: Mutex::new(None),
            shared_flag: Mutex::new(false),
        });

        let oauth_accounts = OAuthAccountService::test_stub();
        let refresher: Arc<dyn WorkspaceTokenRefresher> =
            oauth_accounts.clone() as Arc<dyn WorkspaceTokenRefresher>;
        let service = WorkspaceOAuthService::new(
            user_repo,
            denying_membership_repo(),
            connections,
            refresher,
            key,
        );

        let err = service
            .get_connection(user_id, workspace_id, ConnectedOAuthProvider::Slack)
            .await
            .expect_err("non-member should be rejected");

        assert!(matches!(err, WorkspaceOAuthError::Forbidden));
    }

    #[tokio::test]
    async fn ensure_valid_workspace_token_returns_connection_without_refresh() {
        let workspace_id = Uuid::new_v4();
        let connection_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let key = Arc::new(vec![11u8; 32]);
        let expires_at = OffsetDateTime::now_utc() + Duration::minutes(5);
        let encrypted_access = encrypt_secret(&key, "existing-access").unwrap();
        let encrypted_refresh = encrypt_secret(&key, "existing-refresh").unwrap();

        let workspace_repo = Arc::new(InMemoryWorkspaceRepo::new());
        {
            let mut guard = workspace_repo.connection.lock().unwrap();
            *guard = Some(WorkspaceConnection {
                id: connection_id,
                workspace_id,
                created_by: user_id,
                provider: ConnectedOAuthProvider::Google,
                access_token: encrypted_access,
                refresh_token: encrypted_refresh,
                expires_at,
                account_email: "user@example.com".into(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            });
        }

        let user_repo = Arc::new(InMemoryUserRepo {
            token: Mutex::new(None),
            shared_flag: Mutex::new(false),
        });

        let oauth_accounts = OAuthAccountService::test_stub();
        let workspace_token_refresher: Arc<dyn WorkspaceTokenRefresher> =
            oauth_accounts.clone() as Arc<dyn WorkspaceTokenRefresher>;
        let service = WorkspaceOAuthService::new(
            user_repo,
            noop_membership_repo(),
            workspace_repo,
            workspace_token_refresher,
            key,
        );

        let connection = service
            .ensure_valid_workspace_token(workspace_id, connection_id)
            .await
            .expect("connection exists");

        assert_eq!(connection.id, connection_id);
        assert_eq!(connection.workspace_id, workspace_id);
        assert_eq!(connection.provider, ConnectedOAuthProvider::Google);
        assert_eq!(connection.access_token, "existing-access");
        assert_eq!(connection.refresh_token, "existing-refresh");
    }

    #[tokio::test]
    async fn ensure_valid_workspace_token_refreshes_when_expired() {
        let workspace_id = Uuid::new_v4();
        let connection_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let key = Arc::new(vec![13u8; 32]);
        let expired_at = OffsetDateTime::now_utc() + Duration::seconds(10);
        let encrypted_access = encrypt_secret(&key, "stale-access").unwrap();
        let encrypted_refresh = encrypt_secret(&key, "stale-refresh").unwrap();

        let workspace_repo = Arc::new(InMemoryWorkspaceRepo::new());
        {
            let mut guard = workspace_repo.connection.lock().unwrap();
            *guard = Some(WorkspaceConnection {
                id: connection_id,
                workspace_id,
                created_by: user_id,
                provider: ConnectedOAuthProvider::Google,
                access_token: encrypted_access,
                refresh_token: encrypted_refresh,
                expires_at: expired_at,
                account_email: "workspace@example.com".into(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            });
        }

        let user_repo = Arc::new(InMemoryUserRepo {
            token: Mutex::new(None),
            shared_flag: Mutex::new(false),
        });

        let refreshed_tokens = AuthorizationTokens {
            access_token: "refreshed-access".into(),
            refresh_token: "refreshed-refresh".into(),
            expires_at: OffsetDateTime::now_utc() + Duration::hours(2),
            account_email: "workspace@example.com".into(),
        };
        let refresher = RecordingTokenRefresher::without_delay(refreshed_tokens.clone());
        let service = WorkspaceOAuthService::new(
            user_repo,
            noop_membership_repo(),
            workspace_repo.clone(),
            Arc::new(refresher.clone()) as Arc<dyn WorkspaceTokenRefresher>,
            key.clone(),
        );

        let connection = service
            .ensure_valid_workspace_token(workspace_id, connection_id)
            .await
            .expect("refresh succeeds");

        assert_eq!(connection.access_token, "refreshed-access");
        assert_eq!(connection.refresh_token, "refreshed-refresh");
        assert!(connection.expires_at > expired_at);

        let calls = refresher.calls();
        assert_eq!(calls, vec!["stale-refresh".to_string()]);

        let update_calls = *workspace_repo.update_calls.lock().unwrap();
        assert_eq!(update_calls, 1);
    }

    #[tokio::test]
    async fn ensure_valid_workspace_token_refreshes_slack_connections() {
        let workspace_id = Uuid::new_v4();
        let connection_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let key = Arc::new(vec![15u8; 32]);
        let expired_at = OffsetDateTime::now_utc() - Duration::minutes(5);
        let encrypted_access = encrypt_secret(&key, "slack-old-access").unwrap();
        let encrypted_refresh = encrypt_secret(&key, "slack-old-refresh").unwrap();

        let workspace_repo = Arc::new(InMemoryWorkspaceRepo::new());
        {
            let mut guard = workspace_repo.connection.lock().unwrap();
            *guard = Some(WorkspaceConnection {
                id: connection_id,
                workspace_id,
                created_by: user_id,
                provider: ConnectedOAuthProvider::Slack,
                access_token: encrypted_access,
                refresh_token: encrypted_refresh,
                expires_at: expired_at,
                account_email: "slack@example.com".into(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            });
        }

        let user_repo = Arc::new(InMemoryUserRepo {
            token: Mutex::new(None),
            shared_flag: Mutex::new(false),
        });

        let refreshed_tokens = AuthorizationTokens {
            access_token: "slack-new-access".into(),
            refresh_token: "slack-new-refresh".into(),
            expires_at: OffsetDateTime::now_utc() + Duration::hours(4),
            account_email: "slack@example.com".into(),
        };
        let refresher = RecordingTokenRefresher::without_delay(refreshed_tokens.clone());
        let service = WorkspaceOAuthService::new(
            user_repo,
            noop_membership_repo(),
            workspace_repo.clone(),
            Arc::new(refresher.clone()) as Arc<dyn WorkspaceTokenRefresher>,
            key.clone(),
        );

        let connection = service
            .ensure_valid_workspace_token(workspace_id, connection_id)
            .await
            .expect("refresh succeeds");

        assert_eq!(connection.access_token, "slack-new-access");
        assert_eq!(connection.refresh_token, "slack-new-refresh");
        assert!(connection.expires_at > expired_at);

        assert_eq!(refresher.calls(), vec!["slack-old-refresh".to_string()]);
        assert_eq!(*workspace_repo.update_calls.lock().unwrap(), 1);
    }

    #[tokio::test]
    async fn ensure_valid_workspace_token_rejects_mismatched_workspace() {
        let workspace_id = Uuid::new_v4();
        let other_workspace = Uuid::new_v4();
        let connection_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let key = Arc::new(vec![17u8; 32]);
        let expires_at = OffsetDateTime::now_utc() + Duration::hours(1);
        let encrypted_access = encrypt_secret(&key, "access").unwrap();
        let encrypted_refresh = encrypt_secret(&key, "refresh").unwrap();

        let workspace_repo = Arc::new(InMemoryWorkspaceRepo::new());
        {
            let mut guard = workspace_repo.connection.lock().unwrap();
            *guard = Some(WorkspaceConnection {
                id: connection_id,
                workspace_id: other_workspace,
                created_by: user_id,
                provider: ConnectedOAuthProvider::Microsoft,
                access_token: encrypted_access,
                refresh_token: encrypted_refresh,
                expires_at,
                account_email: "workspace@example.com".into(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            });
        }

        let user_repo = Arc::new(InMemoryUserRepo {
            token: Mutex::new(None),
            shared_flag: Mutex::new(false),
        });

        let refresher = RecordingTokenRefresher::without_delay(AuthorizationTokens {
            access_token: "unused".into(),
            refresh_token: "unused".into(),
            expires_at: OffsetDateTime::now_utc() + Duration::hours(1),
            account_email: "workspace@example.com".into(),
        });

        let service = WorkspaceOAuthService::new(
            user_repo,
            noop_membership_repo(),
            workspace_repo,
            Arc::new(refresher) as Arc<dyn WorkspaceTokenRefresher>,
            key,
        );

        let err = service
            .ensure_valid_workspace_token(workspace_id, connection_id)
            .await
            .expect_err("workspace mismatch should be not found");

        assert!(matches!(err, WorkspaceOAuthError::NotFound));
    }

    #[tokio::test]
    async fn ensure_valid_workspace_token_refreshes_once_with_concurrent_calls() {
        let workspace_id = Uuid::new_v4();
        let connection_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let key = Arc::new(vec![19u8; 32]);
        let expired_at = OffsetDateTime::now_utc() - Duration::minutes(5);
        let encrypted_access = encrypt_secret(&key, "old-access").unwrap();
        let encrypted_refresh = encrypt_secret(&key, "old-refresh").unwrap();

        let workspace_repo = Arc::new(InMemoryWorkspaceRepo::new());
        {
            let mut guard = workspace_repo.connection.lock().unwrap();
            *guard = Some(WorkspaceConnection {
                id: connection_id,
                workspace_id,
                created_by: user_id,
                provider: ConnectedOAuthProvider::Google,
                access_token: encrypted_access,
                refresh_token: encrypted_refresh,
                expires_at: expired_at,
                account_email: "workspace@example.com".into(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            });
        }

        let user_repo = Arc::new(InMemoryUserRepo {
            token: Mutex::new(None),
            shared_flag: Mutex::new(false),
        });

        let refreshed_tokens = AuthorizationTokens {
            access_token: "next-access".into(),
            refresh_token: "next-refresh".into(),
            expires_at: OffsetDateTime::now_utc() + Duration::hours(3),
            account_email: "workspace@example.com".into(),
        };
        let refresher = RecordingTokenRefresher::new(refreshed_tokens.clone());
        let service = Arc::new(WorkspaceOAuthService::new(
            user_repo,
            noop_membership_repo(),
            workspace_repo.clone(),
            Arc::new(refresher.clone()) as Arc<dyn WorkspaceTokenRefresher>,
            key,
        ));

        let svc1 = service.clone();
        let svc2 = service.clone();

        let (res1, res2) = tokio::join!(
            svc1.ensure_valid_workspace_token(workspace_id, connection_id),
            svc2.ensure_valid_workspace_token(workspace_id, connection_id),
        );

        let conn1 = res1.expect("first call succeeds");
        let conn2 = res2.expect("second call succeeds");

        assert_eq!(conn1.access_token, "next-access");
        assert_eq!(conn2.access_token, "next-access");
        assert_eq!(conn1.refresh_token, "next-refresh");
        assert_eq!(conn2.refresh_token, "next-refresh");

        let calls = refresher.calls();
        assert_eq!(calls, vec!["old-refresh".to_string()]);

        let update_calls = *workspace_repo.update_calls.lock().unwrap();
        assert_eq!(update_calls, 1);
    }

    #[tokio::test]
    async fn ensure_valid_workspace_token_removes_connection_when_revoked() {
        let workspace_id = Uuid::new_v4();
        let connection_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let key = Arc::new(vec![23u8; 32]);
        let expired_at = OffsetDateTime::now_utc() - Duration::minutes(2);

        let encrypted_access = encrypt_secret(&key, "revoked-access").unwrap();
        let encrypted_refresh = encrypt_secret(&key, "revoked-refresh").unwrap();

        let workspace_repo = Arc::new(InMemoryWorkspaceRepo::new());
        {
            let mut guard = workspace_repo.connection.lock().unwrap();
            *guard = Some(WorkspaceConnection {
                id: connection_id,
                workspace_id,
                created_by: user_id,
                provider: ConnectedOAuthProvider::Google,
                access_token: encrypted_access,
                refresh_token: encrypted_refresh,
                expires_at: expired_at,
                account_email: "workspace@example.com".into(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            });
        }

        let user_repo = Arc::new(InMemoryUserRepo {
            token: Mutex::new(Some(UserOAuthToken {
                id: Uuid::new_v4(),
                user_id,
                workspace_id: None,
                provider: ConnectedOAuthProvider::Google,
                access_token: String::new(),
                refresh_token: String::new(),
                expires_at: OffsetDateTime::now_utc(),
                account_email: "user@example.com".into(),
                is_shared: true,
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            })),
            shared_flag: Mutex::new(true),
        });

        let service = WorkspaceOAuthService::new(
            user_repo.clone(),
            noop_membership_repo(),
            workspace_repo.clone(),
            Arc::new(RevokingTokenRefresher) as Arc<dyn WorkspaceTokenRefresher>,
            key,
        );

        let err = service
            .ensure_valid_workspace_token(workspace_id, connection_id)
            .await
            .expect_err("revoked token should bubble up error");

        match err {
            WorkspaceOAuthError::OAuth(OAuthAccountError::TokenRevoked { provider }) => {
                assert_eq!(provider, ConnectedOAuthProvider::Google);
            }
            other => panic!("unexpected error: {other:?}"),
        }

        assert!(workspace_repo.connection.lock().unwrap().is_none());
        assert!(!*user_repo.shared_flag.lock().unwrap());
    }

    #[tokio::test]
    async fn ensure_valid_workspace_token_reports_revocation_for_slack() {
        let workspace_id = Uuid::new_v4();
        let connection_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let key = Arc::new(vec![29u8; 32]);
        let expired_at = OffsetDateTime::now_utc() - Duration::minutes(2);

        let encrypted_access = encrypt_secret(&key, "revoked-slack-access").unwrap();
        let encrypted_refresh = encrypt_secret(&key, "revoked-slack-refresh").unwrap();

        let workspace_repo = Arc::new(InMemoryWorkspaceRepo::new());
        {
            let mut guard = workspace_repo.connection.lock().unwrap();
            *guard = Some(WorkspaceConnection {
                id: connection_id,
                workspace_id,
                created_by: user_id,
                provider: ConnectedOAuthProvider::Slack,
                access_token: encrypted_access,
                refresh_token: encrypted_refresh,
                expires_at: expired_at,
                account_email: "slack@example.com".into(),
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            });
        }

        let user_repo = Arc::new(InMemoryUserRepo {
            token: Mutex::new(Some(UserOAuthToken {
                id: Uuid::new_v4(),
                user_id,
                workspace_id: None,
                provider: ConnectedOAuthProvider::Slack,
                access_token: String::new(),
                refresh_token: String::new(),
                expires_at: OffsetDateTime::now_utc(),
                account_email: "slack@example.com".into(),
                is_shared: true,
                created_at: OffsetDateTime::now_utc(),
                updated_at: OffsetDateTime::now_utc(),
            })),
            shared_flag: Mutex::new(true),
        });

        let service = WorkspaceOAuthService::new(
            user_repo.clone(),
            noop_membership_repo(),
            workspace_repo.clone(),
            Arc::new(RevokingTokenRefresher) as Arc<dyn WorkspaceTokenRefresher>,
            key,
        );

        let err = service
            .ensure_valid_workspace_token(workspace_id, connection_id)
            .await
            .expect_err("revoked token should bubble up error");

        match err {
            WorkspaceOAuthError::OAuth(OAuthAccountError::TokenRevoked { provider }) => {
                assert_eq!(provider, ConnectedOAuthProvider::Slack);
            }
            other => panic!("unexpected error: {other:?}"),
        }

        assert!(workspace_repo.connection.lock().unwrap().is_none());
        assert!(!*user_repo.shared_flag.lock().unwrap());
    }

    #[tokio::test]
    async fn purge_member_connections_deletes_records_and_marks_tokens() {
        let workspace_id = Uuid::new_v4();
        let removed_user_id = Uuid::new_v4();
        let actor_id = Uuid::new_v4();
        let key = Arc::new(vec![21u8; 32]);

        let google_connection = workspace_connection_record(
            workspace_id,
            removed_user_id,
            ConnectedOAuthProvider::Google,
        );
        let slack_connection = workspace_connection_record(
            workspace_id,
            removed_user_id,
            ConnectedOAuthProvider::Slack,
        );
        let workspace_repo = Arc::new(RecordingWorkspaceRepo::with_connections(vec![
            google_connection.clone(),
            slack_connection.clone(),
        ]));

        let user_repo = Arc::new(RecordingUserRepo::new());
        user_repo.set_token(ConnectedOAuthProvider::Google, removed_user_id);
        user_repo.set_token(ConnectedOAuthProvider::Slack, removed_user_id);

        let service = WorkspaceOAuthService::new(
            user_repo.clone(),
            noop_membership_repo(),
            workspace_repo.clone(),
            OAuthAccountService::test_stub() as Arc<dyn WorkspaceTokenRefresher>,
            key,
        );

        service
            .purge_member_connections(workspace_id, removed_user_id, actor_id)
            .await
            .expect("purge should succeed");

        let mut deleted = workspace_repo.deleted();
        deleted.sort();
        let mut expected = vec![google_connection.id, slack_connection.id];
        expected.sort();
        assert_eq!(deleted, expected);

        assert_eq!(
            user_repo.marks(),
            vec![
                (removed_user_id, ConnectedOAuthProvider::Google, false),
                (removed_user_id, ConnectedOAuthProvider::Slack, false)
            ]
        );

        let events = workspace_repo.events();
        assert_eq!(events.len(), 2);
        for event in events {
            assert_eq!(event.workspace_id, workspace_id);
            assert_eq!(event.actor_id, actor_id);
            assert_eq!(event.event_type, WORKSPACE_AUDIT_EVENT_CONNECTION_UNSHARED);
        }
    }

    #[tokio::test]
    async fn purge_member_connections_succeeds_when_token_missing() {
        let workspace_id = Uuid::new_v4();
        let removed_user_id = Uuid::new_v4();
        let actor_id = Uuid::new_v4();
        let key = Arc::new(vec![17u8; 32]);

        let connection = workspace_connection_record(
            workspace_id,
            removed_user_id,
            ConnectedOAuthProvider::Slack,
        );
        let workspace_repo = Arc::new(RecordingWorkspaceRepo::with_connections(vec![
            connection.clone()
        ]));

        let user_repo = Arc::new(RecordingUserRepo::new());
        user_repo.fail_for(ConnectedOAuthProvider::Slack);

        let service = WorkspaceOAuthService::new(
            user_repo.clone(),
            noop_membership_repo(),
            workspace_repo.clone(),
            OAuthAccountService::test_stub() as Arc<dyn WorkspaceTokenRefresher>,
            key,
        );

        service
            .purge_member_connections(workspace_id, removed_user_id, actor_id)
            .await
            .expect("purge should ignore missing token");

        assert_eq!(workspace_repo.deleted(), vec![connection.id]);
        assert_eq!(
            user_repo.marks(),
            vec![(removed_user_id, ConnectedOAuthProvider::Slack, false)]
        );
    }
}
