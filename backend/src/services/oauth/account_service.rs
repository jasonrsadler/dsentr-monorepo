use std::sync::Arc;

use reqwest::{Client, StatusCode};
use serde::Deserialize;
use thiserror::Error;
use time::{Duration, OffsetDateTime};
use tracing::warn;
use uuid::Uuid;

use crate::config::{OAuthProviderConfig, OAuthSettings};
use crate::db::oauth_token_repository::{NewUserOAuthToken, UserOAuthTokenRepository};
use crate::db::workspace_connection_repository::WorkspaceConnectionRepository;
use crate::models::oauth_token::{ConnectedOAuthProvider, UserOAuthToken};
#[cfg(test)]
use crate::models::oauth_token::{WorkspaceAuditEvent, WorkspaceConnection};
use crate::utils::encryption::{decrypt_secret, encrypt_secret, EncryptionError};

const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_REVOCATION_URL: &str = "https://oauth2.googleapis.com/revoke";
const MICROSOFT_TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MICROSOFT_USERINFO_URL: &str = "https://graph.microsoft.com/v1.0/me";
const MICROSOFT_REVOCATION_URL: &str =
    "https://login.microsoftonline.com/common/oauth2/v2.0/logout";

#[derive(Debug, Clone)]
pub struct StoredOAuthToken {
    pub id: Uuid,
    pub provider: ConnectedOAuthProvider,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: OffsetDateTime,
    pub account_email: String,
    pub is_shared: bool,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct AuthorizationTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: OffsetDateTime,
    pub account_email: String,
}

#[derive(Error, Debug)]
pub enum OAuthAccountError {
    #[error("token not found")]
    NotFound,
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("encryption error: {0}")]
    Encryption(#[from] EncryptionError),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("invalid provider response: {0}")]
    InvalidResponse(String),
    #[error("refresh token missing in response")]
    MissingRefreshToken,
    #[error("oauth token revoked for {provider:?}")]
    TokenRevoked { provider: ConnectedOAuthProvider },
}

#[derive(Clone)]
pub struct OAuthAccountService {
    repo: Arc<dyn UserOAuthTokenRepository>,
    workspace_connections: Arc<dyn WorkspaceConnectionRepository>,
    encryption_key: Arc<Vec<u8>>,
    client: Arc<Client>,
    google: OAuthProviderConfig,
    microsoft: OAuthProviderConfig,
    #[cfg(test)]
    refresh_override: Option<Arc<RefreshOverride>>,
}

impl OAuthAccountService {
    pub fn new(
        repo: Arc<dyn UserOAuthTokenRepository>,
        workspace_connections: Arc<dyn WorkspaceConnectionRepository>,
        encryption_key: Arc<Vec<u8>>,
        client: Arc<Client>,
        settings: &OAuthSettings,
    ) -> Self {
        Self {
            repo,
            workspace_connections,
            encryption_key,
            client,
            google: settings.google.clone(),
            microsoft: settings.microsoft.clone(),
            #[cfg(test)]
            refresh_override: None,
        }
    }

    #[cfg(test)]
    pub fn set_refresh_override<F>(&mut self, override_fn: Option<Arc<F>>)
    where
        F: for<'a> Fn(
                ConnectedOAuthProvider,
                &'a str,
            ) -> Result<AuthorizationTokens, OAuthAccountError>
            + Send
            + Sync
            + 'static,
    {
        self.refresh_override = override_fn.map(|func| func as Arc<RefreshOverride>);
    }

    pub fn google_scopes(&self) -> &'static str {
        "openid email profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/spreadsheets"
    }

    pub fn microsoft_scopes(&self) -> &'static str {
        "offline_access User.Read Team.ReadBasic.All Channel.ReadBasic.All ChannelMember.Read.All ChannelMessage.Send"
    }

    pub async fn save_authorization(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
        tokens: AuthorizationTokens,
    ) -> Result<StoredOAuthToken, OAuthAccountError> {
        let encrypted_access = encrypt_secret(&self.encryption_key, &tokens.access_token)?;
        let encrypted_refresh = encrypt_secret(&self.encryption_key, &tokens.refresh_token)?;

        let stored = self
            .repo
            .upsert_token(NewUserOAuthToken {
                user_id,
                provider,
                access_token: encrypted_access,
                refresh_token: encrypted_refresh,
                expires_at: tokens.expires_at,
                account_email: tokens.account_email.clone(),
            })
            .await?;

        Ok(StoredOAuthToken {
            id: stored.id,
            provider,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: stored.expires_at,
            account_email: stored.account_email,
            is_shared: stored.is_shared,
            updated_at: stored.updated_at,
        })
    }

    pub async fn list_tokens(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<StoredOAuthToken>, OAuthAccountError> {
        let records = self.repo.list_tokens_for_user(user_id).await?;
        records
            .into_iter()
            .map(|record| self.decrypt_record(record))
            .collect()
    }

    pub async fn ensure_valid_access_token(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<StoredOAuthToken, OAuthAccountError> {
        let record = self
            .repo
            .find_by_user_and_provider(user_id, provider)
            .await?
            .ok_or(OAuthAccountError::NotFound)?;

        let mut decrypted = self.decrypt_record(record.clone())?;
        let now = OffsetDateTime::now_utc();
        if decrypted.expires_at <= now + Duration::seconds(60) {
            let refreshed = match self
                .refresh_access_token(provider, &decrypted.refresh_token)
                .await
            {
                Ok(tokens) => tokens,
                Err(err) => {
                    if matches!(err, OAuthAccountError::TokenRevoked { .. }) {
                        self.repo.delete_token(user_id, provider).await?;
                        self.workspace_connections
                            .mark_connections_stale_for_creator(user_id, provider)
                            .await?;
                    }
                    return Err(err);
                }
            };
            decrypted.access_token = refreshed.access_token.clone();
            decrypted.refresh_token = refreshed.refresh_token.clone();
            decrypted.expires_at = refreshed.expires_at;

            let encrypted_access = encrypt_secret(&self.encryption_key, &refreshed.access_token)?;
            let encrypted_refresh = encrypt_secret(&self.encryption_key, &refreshed.refresh_token)?;

            let updated = self
                .repo
                .upsert_token(NewUserOAuthToken {
                    user_id,
                    provider,
                    access_token: encrypted_access.clone(),
                    refresh_token: encrypted_refresh.clone(),
                    expires_at: refreshed.expires_at,
                    account_email: record.account_email,
                })
                .await?;
            decrypted.id = updated.id;
            decrypted.expires_at = updated.expires_at;
            let account_email = updated.account_email.clone();
            decrypted.account_email = account_email.clone();
            decrypted.is_shared = updated.is_shared;
            decrypted.updated_at = updated.updated_at;

            if updated.is_shared {
                self.workspace_connections
                    .update_tokens_for_creator(
                        user_id,
                        provider,
                        encrypted_access,
                        encrypted_refresh,
                        refreshed.expires_at,
                        account_email,
                    )
                    .await?;
            }
        }

        Ok(decrypted)
    }

    pub async fn delete_tokens(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<(), OAuthAccountError> {
        if let Some(existing) = self
            .repo
            .find_by_user_and_provider(user_id, provider)
            .await?
        {
            let decrypted = self.decrypt_record(existing)?;
            let _ = self
                .revoke_refresh_token(provider, &decrypted.refresh_token)
                .await;
        }
        self.repo.delete_token(user_id, provider).await?;
        Ok(())
    }

    pub async fn handle_revoked_token(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<(), OAuthAccountError> {
        self.repo.delete_token(user_id, provider).await?;
        self.workspace_connections
            .mark_connections_stale_for_creator(user_id, provider)
            .await?;
        Ok(())
    }

    pub async fn exchange_authorization_code(
        &self,
        provider: ConnectedOAuthProvider,
        code: &str,
    ) -> Result<AuthorizationTokens, OAuthAccountError> {
        match provider {
            ConnectedOAuthProvider::Google => self.exchange_google_code(code).await,
            ConnectedOAuthProvider::Microsoft => self.exchange_microsoft_code(code).await,
        }
    }

    async fn exchange_google_code(
        &self,
        code: &str,
    ) -> Result<AuthorizationTokens, OAuthAccountError> {
        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            #[serde(default)]
            refresh_token: Option<String>,
            expires_in: Option<i64>,
        }

        #[derive(Deserialize)]
        struct UserInfoResponse {
            email: Option<String>,
        }

        let response: TokenResponse = self
            .client
            .post(GOOGLE_TOKEN_URL)
            .form(&[
                ("code", code),
                ("client_id", self.google.client_id.as_str()),
                ("client_secret", self.google.client_secret.as_str()),
                ("redirect_uri", self.google.redirect_uri.as_str()),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let refresh_token = response
            .refresh_token
            .ok_or(OAuthAccountError::MissingRefreshToken)?;
        let expires_in = response.expires_in.unwrap_or(3600);
        let expires_at = OffsetDateTime::now_utc() + Duration::seconds(expires_in);

        let user_info: UserInfoResponse = self
            .client
            .get(GOOGLE_USERINFO_URL)
            .bearer_auth(&response.access_token)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let email = user_info
            .email
            .ok_or_else(|| OAuthAccountError::InvalidResponse("Missing email".into()))?;

        Ok(AuthorizationTokens {
            access_token: response.access_token,
            refresh_token,
            expires_at,
            account_email: email,
        })
    }

    async fn exchange_microsoft_code(
        &self,
        code: &str,
    ) -> Result<AuthorizationTokens, OAuthAccountError> {
        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            #[serde(default)]
            refresh_token: Option<String>,
            expires_in: Option<i64>,
        }

        #[derive(Deserialize)]
        struct UserInfoResponse {
            #[serde(rename = "mail")]
            mail: Option<String>,
            #[serde(rename = "userPrincipalName")]
            user_principal_name: Option<String>,
        }

        let response: TokenResponse = self
            .client
            .post(MICROSOFT_TOKEN_URL)
            .form(&[
                ("client_id", self.microsoft.client_id.as_str()),
                ("client_secret", self.microsoft.client_secret.as_str()),
                ("code", code),
                ("redirect_uri", self.microsoft.redirect_uri.as_str()),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let refresh_token = response
            .refresh_token
            .ok_or(OAuthAccountError::MissingRefreshToken)?;
        let expires_in = response.expires_in.unwrap_or(3600);
        let expires_at = OffsetDateTime::now_utc() + Duration::seconds(expires_in);

        let user_info: UserInfoResponse = self
            .client
            .get(MICROSOFT_USERINFO_URL)
            .bearer_auth(&response.access_token)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let email = user_info
            .mail
            .or(user_info.user_principal_name)
            .ok_or_else(|| OAuthAccountError::InvalidResponse("Missing account email".into()))?;

        Ok(AuthorizationTokens {
            access_token: response.access_token,
            refresh_token,
            expires_at,
            account_email: email,
        })
    }

    pub async fn refresh_access_token(
        &self,
        provider: ConnectedOAuthProvider,
        refresh_token: &str,
    ) -> Result<AuthorizationTokens, OAuthAccountError> {
        #[cfg(test)]
        if let Some(override_fn) = &self.refresh_override {
            return override_fn(provider, refresh_token);
        }
        match provider {
            ConnectedOAuthProvider::Google => self.refresh_google_token(refresh_token).await,
            ConnectedOAuthProvider::Microsoft => self.refresh_microsoft_token(refresh_token).await,
        }
    }

    async fn refresh_google_token(
        &self,
        refresh_token: &str,
    ) -> Result<AuthorizationTokens, OAuthAccountError> {
        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            expires_in: Option<i64>,
            #[serde(default)]
            refresh_token: Option<String>,
        }

        let response = self
            .client
            .post(GOOGLE_TOKEN_URL)
            .form(&[
                ("client_id", self.google.client_id.as_str()),
                ("client_secret", self.google.client_secret.as_str()),
                ("refresh_token", refresh_token),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await?;

        if let Err(err) = response.error_for_status_ref() {
            let body = response.text().await.unwrap_or_else(|_| String::new());
            if is_revocation_signal(err.status(), &body) {
                warn!(
                    provider = "google",
                    status = ?err.status(),
                    body = %body,
                    "google oauth refresh token revoked"
                );
                return Err(OAuthAccountError::TokenRevoked {
                    provider: ConnectedOAuthProvider::Google,
                });
            }
            return Err(OAuthAccountError::Http(err));
        }

        let response: TokenResponse = response
            .json()
            .await
            .map_err(|err| OAuthAccountError::InvalidResponse(err.to_string()))?;

        let new_refresh = response
            .refresh_token
            .unwrap_or_else(|| refresh_token.to_string());
        let expires_in = response.expires_in.unwrap_or(3600);
        let expires_at = OffsetDateTime::now_utc() + Duration::seconds(expires_in);

        Ok(AuthorizationTokens {
            access_token: response.access_token,
            refresh_token: new_refresh,
            expires_at,
            account_email: String::new(),
        })
    }

    async fn refresh_microsoft_token(
        &self,
        refresh_token: &str,
    ) -> Result<AuthorizationTokens, OAuthAccountError> {
        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            expires_in: Option<i64>,
            #[serde(default)]
            refresh_token: Option<String>,
        }

        let response = self
            .client
            .post(MICROSOFT_TOKEN_URL)
            .form(&[
                ("client_id", self.microsoft.client_id.as_str()),
                ("client_secret", self.microsoft.client_secret.as_str()),
                ("refresh_token", refresh_token),
                ("grant_type", "refresh_token"),
                ("redirect_uri", self.microsoft.redirect_uri.as_str()),
            ])
            .send()
            .await?;

        if let Err(err) = response.error_for_status_ref() {
            let body = response.text().await.unwrap_or_else(|_| String::new());
            if is_revocation_signal(err.status(), &body) {
                warn!(
                    provider = "microsoft",
                    status = ?err.status(),
                    body = %body,
                    "microsoft oauth refresh token revoked"
                );
                return Err(OAuthAccountError::TokenRevoked {
                    provider: ConnectedOAuthProvider::Microsoft,
                });
            }
            return Err(OAuthAccountError::Http(err));
        }

        let response: TokenResponse = response
            .json()
            .await
            .map_err(|err| OAuthAccountError::InvalidResponse(err.to_string()))?;

        let new_refresh = response
            .refresh_token
            .unwrap_or_else(|| refresh_token.to_string());
        let expires_in = response.expires_in.unwrap_or(3600);
        let expires_at = OffsetDateTime::now_utc() + Duration::seconds(expires_in);

        Ok(AuthorizationTokens {
            access_token: response.access_token,
            refresh_token: new_refresh,
            expires_at,
            account_email: String::new(),
        })
    }

    async fn revoke_refresh_token(
        &self,
        provider: ConnectedOAuthProvider,
        refresh_token: &str,
    ) -> Result<(), OAuthAccountError> {
        let response = match provider {
            ConnectedOAuthProvider::Google => {
                self.client
                    .post(GOOGLE_REVOCATION_URL)
                    .form(&[("token", refresh_token)])
                    .send()
                    .await?
            }
            ConnectedOAuthProvider::Microsoft => {
                self.client
                    .post(MICROSOFT_REVOCATION_URL)
                    .form(&[
                        ("token", refresh_token),
                        ("token_type_hint", "refresh_token"),
                        ("client_id", self.microsoft.client_id.as_str()),
                    ])
                    .send()
                    .await?
            }
        };

        if response.status() == StatusCode::OK || response.status() == StatusCode::NO_CONTENT {
            Ok(())
        } else {
            Err(OAuthAccountError::InvalidResponse(format!(
                "Failed to revoke token: {}",
                response.status()
            )))
        }
    }

    fn decrypt_record(
        &self,
        record: UserOAuthToken,
    ) -> Result<StoredOAuthToken, OAuthAccountError> {
        let access_token = decrypt_secret(&self.encryption_key, &record.access_token)?;
        let refresh_token = decrypt_secret(&self.encryption_key, &record.refresh_token)?;
        Ok(StoredOAuthToken {
            id: record.id,
            provider: record.provider,
            access_token,
            refresh_token,
            expires_at: record.expires_at,
            account_email: record.account_email,
            is_shared: record.is_shared,
            updated_at: record.updated_at,
        })
    }

    #[cfg(test)]
    pub fn test_stub() -> Arc<Self> {
        use async_trait::async_trait;

        struct StubRepo;

        #[async_trait]
        impl UserOAuthTokenRepository for StubRepo {
            async fn upsert_token(
                &self,
                _new_token: NewUserOAuthToken,
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
                _new_connection: crate::db::workspace_connection_repository::NewWorkspaceConnection,
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
            ) -> Result<
                Vec<crate::db::workspace_connection_repository::WorkspaceConnectionListing>,
                sqlx::Error,
            > {
                Ok(Vec::new())
            }

            async fn list_for_user_memberships(
                &self,
                _user_id: Uuid,
            ) -> Result<
                Vec<crate::db::workspace_connection_repository::WorkspaceConnectionListing>,
                sqlx::Error,
            > {
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

            async fn mark_connections_stale_for_creator(
                &self,
                _creator_id: Uuid,
                _provider: ConnectedOAuthProvider,
            ) -> Result<(), sqlx::Error> {
                Ok(())
            }

            async fn record_audit_event(
                &self,
                _event: crate::db::workspace_connection_repository::NewWorkspaceAuditEvent,
            ) -> Result<WorkspaceAuditEvent, sqlx::Error> {
                Err(sqlx::Error::RowNotFound)
            }
        }

        let repo = Arc::new(StubRepo) as Arc<dyn UserOAuthTokenRepository>;
        let workspace_connections =
            Arc::new(StubWorkspaceRepo) as Arc<dyn WorkspaceConnectionRepository>;
        let key = Arc::new(vec![0u8; 32]);
        let client = Arc::new(Client::new());
        let settings = OAuthSettings {
            google: OAuthProviderConfig {
                client_id: "stub".into(),
                client_secret: "stub".into(),
                redirect_uri: "http://localhost".into(),
            },
            microsoft: OAuthProviderConfig {
                client_id: "stub".into(),
                client_secret: "stub".into(),
                redirect_uri: "http://localhost".into(),
            },
            token_encryption_key: vec![0u8; 32],
        };
        Arc::new(Self::new(
            repo,
            workspace_connections,
            key,
            client,
            &settings,
        ))
    }
}

pub(crate) fn is_revocation_signal(status: Option<StatusCode>, body: &str) -> bool {
    if matches!(status, Some(StatusCode::UNAUTHORIZED)) {
        return true;
    }

    if let Some(StatusCode::BAD_REQUEST) = status {
        let lowered = body.to_ascii_lowercase();
        if lowered.contains("invalid_grant") || lowered.contains("revoked") {
            return true;
        }
    }

    let lowered = body.to_ascii_lowercase();
    lowered.contains("invalid_grant") || lowered.contains("token revoked")
}

#[cfg(test)]
type RefreshOverride = dyn for<'a> Fn(ConnectedOAuthProvider, &'a str) -> Result<AuthorizationTokens, OAuthAccountError>
    + Send
    + Sync;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::oauth_token_repository::{NewUserOAuthToken, UserOAuthTokenRepository};
    use crate::db::workspace_connection_repository::WorkspaceConnectionRepository;
    use async_trait::async_trait;
    use sqlx::Error;
    use std::sync::Mutex;

    struct InMemoryRepo;

    #[async_trait]
    impl UserOAuthTokenRepository for InMemoryRepo {
        async fn upsert_token(
            &self,
            _new_token: NewUserOAuthToken,
        ) -> Result<UserOAuthToken, sqlx::Error> {
            Err(Error::RowNotFound)
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
            Err(Error::RowNotFound)
        }
    }

    struct NoopWorkspaceRepo;

    #[async_trait]
    impl WorkspaceConnectionRepository for NoopWorkspaceRepo {
        async fn insert_connection(
            &self,
            _new_connection: crate::db::workspace_connection_repository::NewWorkspaceConnection,
        ) -> Result<WorkspaceConnection, sqlx::Error> {
            Err(Error::RowNotFound)
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
        ) -> Result<
            Vec<crate::db::workspace_connection_repository::WorkspaceConnectionListing>,
            sqlx::Error,
        > {
            Ok(Vec::new())
        }

        async fn list_for_user_memberships(
            &self,
            _user_id: Uuid,
        ) -> Result<
            Vec<crate::db::workspace_connection_repository::WorkspaceConnectionListing>,
            sqlx::Error,
        > {
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
            Err(Error::RowNotFound)
        }

        async fn delete_connection(&self, _connection_id: Uuid) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn mark_connections_stale_for_creator(
            &self,
            _creator_id: Uuid,
            _provider: ConnectedOAuthProvider,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn record_audit_event(
            &self,
            _event: crate::db::workspace_connection_repository::NewWorkspaceAuditEvent,
        ) -> Result<WorkspaceAuditEvent, sqlx::Error> {
            Err(Error::RowNotFound)
        }
    }

    #[tokio::test]
    async fn scopes_are_exposed() {
        let client = Arc::new(Client::new());
        let repo = Arc::new(InMemoryRepo);
        let workspace_repo = Arc::new(NoopWorkspaceRepo);
        let key = Arc::new(vec![0u8; 32]);
        let settings = OAuthSettings {
            google: OAuthProviderConfig {
                client_id: "id".into(),
                client_secret: "secret".into(),
                redirect_uri: "http://localhost".into(),
            },
            microsoft: OAuthProviderConfig {
                client_id: "id".into(),
                client_secret: "secret".into(),
                redirect_uri: "http://localhost".into(),
            },
            token_encryption_key: vec![0u8; 32],
        };
        let service = OAuthAccountService::new(repo, workspace_repo, key, client, &settings);
        let scopes = service.google_scopes();
        assert!(scopes.contains("email"));
        assert!(scopes.contains("https://www.googleapis.com/auth/spreadsheets"));
        assert!(service.microsoft_scopes().contains("offline_access"));
    }

    #[derive(Default)]
    struct RecordingTokenRepo {
        token: Mutex<Option<UserOAuthToken>>,
        delete_calls: Mutex<Vec<(Uuid, ConnectedOAuthProvider)>>,
    }

    impl RecordingTokenRepo {
        fn new(token: UserOAuthToken) -> Self {
            Self {
                token: Mutex::new(Some(token)),
                delete_calls: Mutex::new(Vec::new()),
            }
        }

        fn delete_calls(&self) -> Vec<(Uuid, ConnectedOAuthProvider)> {
            self.delete_calls.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl UserOAuthTokenRepository for RecordingTokenRepo {
        async fn upsert_token(
            &self,
            _new_token: NewUserOAuthToken,
        ) -> Result<UserOAuthToken, sqlx::Error> {
            Err(Error::RowNotFound)
        }

        async fn find_by_user_and_provider(
            &self,
            user_id: Uuid,
            provider: ConnectedOAuthProvider,
        ) -> Result<Option<UserOAuthToken>, sqlx::Error> {
            let guard = self.token.lock().unwrap();
            Ok(guard
                .as_ref()
                .filter(|token| token.user_id == user_id && token.provider == provider)
                .cloned())
        }

        async fn delete_token(
            &self,
            user_id: Uuid,
            provider: ConnectedOAuthProvider,
        ) -> Result<(), sqlx::Error> {
            let mut guard = self.token.lock().unwrap();
            if guard
                .as_ref()
                .map(|token| token.user_id == user_id && token.provider == provider)
                .unwrap_or(false)
            {
                *guard = None;
            }
            self.delete_calls.lock().unwrap().push((user_id, provider));
            Ok(())
        }

        async fn list_tokens_for_user(
            &self,
            _user_id: Uuid,
        ) -> Result<Vec<UserOAuthToken>, sqlx::Error> {
            Ok(Vec::new())
        }

        async fn mark_shared(
            &self,
            _user_id: Uuid,
            _provider: ConnectedOAuthProvider,
            _is_shared: bool,
        ) -> Result<UserOAuthToken, sqlx::Error> {
            Err(Error::RowNotFound)
        }
    }

    #[derive(Default)]
    struct RecordingWorkspaceRepo {
        stale_calls: Mutex<Vec<(Uuid, ConnectedOAuthProvider)>>,
    }

    impl RecordingWorkspaceRepo {
        fn stale_calls(&self) -> Vec<(Uuid, ConnectedOAuthProvider)> {
            self.stale_calls.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl WorkspaceConnectionRepository for RecordingWorkspaceRepo {
        async fn insert_connection(
            &self,
            _new_connection: crate::db::workspace_connection_repository::NewWorkspaceConnection,
        ) -> Result<WorkspaceConnection, sqlx::Error> {
            Err(Error::RowNotFound)
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
        ) -> Result<
            Vec<crate::db::workspace_connection_repository::WorkspaceConnectionListing>,
            sqlx::Error,
        > {
            Ok(Vec::new())
        }

        async fn list_for_user_memberships(
            &self,
            _user_id: Uuid,
        ) -> Result<
            Vec<crate::db::workspace_connection_repository::WorkspaceConnectionListing>,
            sqlx::Error,
        > {
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
            Err(Error::RowNotFound)
        }

        async fn delete_connection(&self, _connection_id: Uuid) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn mark_connections_stale_for_creator(
            &self,
            creator_id: Uuid,
            provider: ConnectedOAuthProvider,
        ) -> Result<(), sqlx::Error> {
            self.stale_calls
                .lock()
                .unwrap()
                .push((creator_id, provider));
            Ok(())
        }

        async fn record_audit_event(
            &self,
            _event: crate::db::workspace_connection_repository::NewWorkspaceAuditEvent,
        ) -> Result<WorkspaceAuditEvent, sqlx::Error> {
            Err(Error::RowNotFound)
        }
    }

    #[tokio::test]
    async fn ensure_valid_access_token_marks_revoked_tokens_as_stale() {
        let user_id = Uuid::new_v4();
        let token_id = Uuid::new_v4();
        let now = OffsetDateTime::now_utc();
        let key = Arc::new(vec![42u8; 32]);

        let encrypted_access =
            encrypt_secret(&key, "access-before-revocation").expect("encrypt access");
        let encrypted_refresh = encrypt_secret(&key, "plain-refresh").expect("encrypt refresh");

        let stored_token = UserOAuthToken {
            id: token_id,
            user_id,
            provider: ConnectedOAuthProvider::Google,
            access_token: encrypted_access,
            refresh_token: encrypted_refresh,
            expires_at: now,
            account_email: "owner@example.com".into(),
            is_shared: true,
            created_at: now - Duration::hours(1),
            updated_at: now - Duration::minutes(10),
        };

        let token_repo = Arc::new(RecordingTokenRepo::new(stored_token));
        let workspace_repo = Arc::new(RecordingWorkspaceRepo::default());
        let mut service = OAuthAccountService::new(
            token_repo.clone(),
            workspace_repo.clone(),
            key.clone(),
            Arc::new(Client::new()),
            &OAuthSettings {
                google: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "http://localhost/google".into(),
                },
                microsoft: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "http://localhost/microsoft".into(),
                },
                token_encryption_key: (*key).clone(),
            },
        );

        fn revoked_override(
            provider: ConnectedOAuthProvider,
            token: &str,
        ) -> Result<AuthorizationTokens, OAuthAccountError> {
            assert_eq!(provider, ConnectedOAuthProvider::Google);
            assert_eq!(token, "plain-refresh");
            Err(OAuthAccountError::TokenRevoked { provider })
        }

        service.set_refresh_override(Some(Arc::new(revoked_override)));

        let err = service
            .ensure_valid_access_token(user_id, ConnectedOAuthProvider::Google)
            .await
            .expect_err("revocation should return error");

        match err {
            OAuthAccountError::TokenRevoked { provider } => {
                assert_eq!(provider, ConnectedOAuthProvider::Google);
            }
            other => panic!("unexpected error: {other:?}"),
        }

        assert!(token_repo.token.lock().unwrap().is_none());
        assert_eq!(
            token_repo.delete_calls.lock().unwrap().as_slice(),
            &[(user_id, ConnectedOAuthProvider::Google)]
        );
        assert_eq!(
            workspace_repo.stale_calls.lock().unwrap().as_slice(),
            &[(user_id, ConnectedOAuthProvider::Google)]
        );
    }

    #[tokio::test]
    async fn handle_revoked_token_removes_personal_credentials_and_marks_workspace() {
        let user_id = Uuid::new_v4();
        let token_id = Uuid::new_v4();
        let now = OffsetDateTime::now_utc();
        let key = Arc::new(vec![7u8; 32]);

        let stored_token = UserOAuthToken {
            id: token_id,
            user_id,
            provider: ConnectedOAuthProvider::Microsoft,
            access_token: "enc-access".into(),
            refresh_token: "enc-refresh".into(),
            expires_at: now,
            account_email: "owner@example.com".into(),
            is_shared: true,
            created_at: now - Duration::hours(2),
            updated_at: now - Duration::hours(1),
        };

        let token_repo = Arc::new(RecordingTokenRepo::new(stored_token));
        let workspace_repo = Arc::new(RecordingWorkspaceRepo::default());
        let service = OAuthAccountService::new(
            token_repo.clone(),
            workspace_repo.clone(),
            key.clone(),
            Arc::new(Client::new()),
            &OAuthSettings {
                google: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "http://localhost/google".into(),
                },
                microsoft: OAuthProviderConfig {
                    client_id: "client".into(),
                    client_secret: "secret".into(),
                    redirect_uri: "http://localhost/microsoft".into(),
                },
                token_encryption_key: (*key).clone(),
            },
        );

        service
            .handle_revoked_token(user_id, ConnectedOAuthProvider::Microsoft)
            .await
            .expect("revoked cleanup should succeed");

        assert_eq!(
            token_repo.delete_calls(),
            vec![(user_id, ConnectedOAuthProvider::Microsoft)]
        );
        assert_eq!(
            workspace_repo.stale_calls(),
            vec![(user_id, ConnectedOAuthProvider::Microsoft)]
        );
    }

    #[test]
    fn revocation_signal_detects_unauthorized_status() {
        assert!(is_revocation_signal(Some(StatusCode::UNAUTHORIZED), ""));
    }

    #[test]
    fn revocation_signal_detects_invalid_grant_keyword() {
        assert!(is_revocation_signal(
            Some(StatusCode::BAD_REQUEST),
            "invalid_grant"
        ));
        assert!(is_revocation_signal(None, "Token revoked by admin"));
    }
}
