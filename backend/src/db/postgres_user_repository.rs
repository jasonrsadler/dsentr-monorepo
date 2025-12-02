use crate::{
    db::user_repository::UserRepository,
    models::{
        account_deletion::{
            AccountDeletionAuditInsert, AccountDeletionContext, AccountDeletionCounts,
            AccountDeletionToken,
        },
        issue_report::NewIssueReport,
        signup::SignupPayload,
        user::{OauthProvider, PublicUser, User},
    },
};
use async_trait::async_trait;
use serde_json::Value;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use super::user_repository::UserId;

pub struct PostgresUserRepository {
    pub pool: PgPool,
}

#[async_trait]
impl UserRepository for PostgresUserRepository {
    async fn find_user_id_by_email(&self, email: &str) -> Result<Option<UserId>, sqlx::Error> {
        let rec = sqlx::query!("SELECT id FROM users WHERE email = $1", email)
            .fetch_optional(&self.pool)
            .await?;

        Ok(rec.map(|r| UserId { id: r.id }))
    }

    async fn insert_password_reset_token(
        &self,
        user_id: Uuid,
        token: &str,
        expires_at: OffsetDateTime,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "INSERT INTO password_resets (user_id, token, expires_at)
            VALUES ($1, $2, $3)",
            user_id,
            token,
            expires_at
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn find_user_by_email(&self, email: &str) -> Result<Option<User>, sqlx::Error> {
        let row = sqlx::query_as!(
            User,
            r#"
            SELECT id,
                   email,
                   role as "role: _",
                   password_hash,
                   first_name,
                   last_name,
                   plan,
                   company_name,
                   stripe_customer_id,
                   oauth_provider as "oauth_provider: OauthProvider",
                   onboarded_at,
                   created_at,
                   is_verified
            FROM users
            WHERE email = $1
            "#,
            email
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row)
    }

    async fn create_user_with_oauth(
        &self,
        email: &str,
        first_name: &str,
        last_name: &str,
        provider: OauthProvider,
    ) -> Result<User, sqlx::Error> {
        let user = sqlx::query_as!(
            User,
            r#"
            INSERT INTO users (
                email,
                password_hash,
                first_name,
                last_name,
                oauth_provider,
                is_verified,
                role,
                created_at
            )
            VALUES ($1, '', $2, $3, $4::oauth_provider, true, 'user'::user_role, $5)
            RETURNING
                id,
                email,
                password_hash,
                first_name,
                last_name,
                role as "role: crate::models::user::UserRole",
                plan,
                company_name,
                stripe_customer_id,
                oauth_provider as "oauth_provider: OauthProvider",
                onboarded_at,
                created_at,
                is_verified
            "#,
            email,
            first_name,
            last_name,
            provider as OauthProvider,
            OffsetDateTime::now_utc()
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(user)
    }

    async fn find_public_user_by_id(
        &self,
        user_id: Uuid,
    ) -> Result<Option<PublicUser>, sqlx::Error> {
        sqlx::query_as::<_, PublicUser>(
            r#"
            SELECT id,
                   email,
                   first_name,
                   last_name,
                   role,
                   plan,
                   company_name,
                   oauth_provider,
                   onboarded_at
            FROM users
            WHERE id = $1
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
    }

    async fn verify_password_reset_token(&self, token: &str) -> Result<Option<Uuid>, sqlx::Error> {
        let result = sqlx::query!(
            r#"
            SELECT user_id FROM password_resets
            WHERE token = $1 AND expires_at > $2 AND used_at IS NULL
            "#,
            token,
            OffsetDateTime::now_utc()
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result.map(|r| r.user_id))
    }

    async fn update_user_password(
        &self,
        user_id: Uuid,
        password_hash: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE users SET password_hash = $1 WHERE id = $2",
            password_hash,
            user_id
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn mark_password_reset_token_used(&self, token: &str) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "UPDATE password_resets SET used_at = $1 WHERE token = $2",
            OffsetDateTime::now_utc(),
            token
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn is_email_taken(&self, email: &str) -> Result<bool, sqlx::Error> {
        let res = sqlx::query_scalar!("SELECT 1 FROM users WHERE email = $1", email)
            .fetch_optional(&self.pool)
            .await?;
        Ok(res.is_some())
    }

    async fn create_user(
        &self,
        payload: &SignupPayload,
        password_hash: &str,
        provider: OauthProvider,
    ) -> Result<Uuid, sqlx::Error> {
        let settings = payload
            .settings
            .clone()
            .unwrap_or_else(|| serde_json::json!({}));

        sqlx::query_scalar!(
            r#"
            INSERT INTO users (
                email, password_hash, first_name, last_name, company_name, country, tax_id,
                is_verified, is_subscribed, settings, created_at, updated_at, oauth_provider
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                false, false, $8, now(), now(), $9::oauth_provider
            )
            RETURNING id
            "#,
            payload.email,
            password_hash,
            payload.first_name,
            payload.last_name,
            payload.company_name,
            payload.country,
            payload.tax_id,
            settings,
            provider as OauthProvider
        )
        .fetch_one(&self.pool)
        .await
    }

    async fn record_terms_acceptance(
        &self,
        user_id: Uuid,
        terms_version: &str,
        accepted_at: OffsetDateTime,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            INSERT INTO user_terms_acceptances (user_id, terms_version, accepted_at)
            VALUES ($1, $2, $3)
            "#,
            user_id,
            terms_version,
            accepted_at
        )
        .execute(&self.pool)
        .await
        .map(|_| ())
    }

    async fn insert_verification_token(
        &self,
        user_id: Uuid,
        token: &str,
        expires_at: OffsetDateTime,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)",
            user_id,
            token,
            expires_at
        )
        .execute(&self.pool)
        .await
        .map(|_| ())
    }

    async fn cleanup_user_and_token(&self, user_id: Uuid, token: &str) -> Result<(), sqlx::Error> {
        let _ = sqlx::query!(
            "DELETE FROM email_verification_tokens WHERE token = $1",
            token
        )
        .execute(&self.pool)
        .await;

        let _ = sqlx::query!("DELETE FROM users WHERE id = $1", user_id)
            .execute(&self.pool)
            .await;

        Ok(())
    }

    async fn mark_verification_token_used(
        &self,
        token: &str,
        now: OffsetDateTime,
    ) -> Result<Option<Uuid>, sqlx::Error> {
        let rec = sqlx::query!(
            r#"
            UPDATE email_verification_tokens
            SET used_at = $1
            WHERE token = $2
              AND expires_at > $1
              AND used_at IS NULL
            RETURNING user_id
            "#,
            now,
            token
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(rec.map(|r| r.user_id))
    }

    async fn set_user_verified(&self, user_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query!("UPDATE users SET is_verified = true WHERE id = $1", user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn insert_early_access_email(&self, email: &str) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO early_access_emails (email) VALUES ($1)")
            .bind(email)
            .execute(&self.pool)
            .await
            .map(|_| ()) // return `Ok(())` on success
    }

    async fn get_user_settings(&self, user_id: Uuid) -> Result<Value, sqlx::Error> {
        let record = sqlx::query!("SELECT settings FROM users WHERE id = $1", user_id)
            .fetch_optional(&self.pool)
            .await?;

        match record {
            Some(row) => {
                let mut settings = row.settings;
                if settings.is_null() {
                    settings = Value::Object(Default::default());
                }
                Ok(settings)
            }
            None => Err(sqlx::Error::RowNotFound),
        }
    }

    async fn update_user_settings(
        &self,
        user_id: Uuid,
        settings: Value,
    ) -> Result<(), sqlx::Error> {
        let result = sqlx::query!(
            "UPDATE users SET settings = $2, updated_at = now() WHERE id = $1",
            user_id,
            settings
        )
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(sqlx::Error::RowNotFound);
        }

        Ok(())
    }

    async fn update_user_plan(&self, user_id: Uuid, plan: &str) -> Result<(), sqlx::Error> {
        let result = sqlx::query!(
            "UPDATE users SET plan = $2, updated_at = now() WHERE id = $1",
            user_id,
            plan
        )
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(sqlx::Error::RowNotFound);
        }

        Ok(())
    }

    async fn mark_workspace_onboarded(
        &self,
        user_id: Uuid,
        onboarded_at: OffsetDateTime,
    ) -> Result<(), sqlx::Error> {
        let result = sqlx::query!(
            "UPDATE users SET onboarded_at = $2, updated_at = now() WHERE id = $1",
            user_id,
            onboarded_at
        )
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(sqlx::Error::RowNotFound);
        }

        Ok(())
    }

    async fn get_user_stripe_customer_id(
        &self,
        user_id: Uuid,
    ) -> Result<Option<String>, sqlx::Error> {
        let rec = sqlx::query_scalar!(
            "SELECT stripe_customer_id FROM users WHERE id = $1",
            user_id
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(rec.flatten())
    }

    async fn set_user_stripe_customer_id(
        &self,
        user_id: Uuid,
        stripe_customer_id: &str,
    ) -> Result<(), sqlx::Error> {
        let result = sqlx::query!(
            "UPDATE users SET stripe_customer_id = $2, updated_at = now() WHERE id = $1",
            user_id,
            stripe_customer_id
        )
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(sqlx::Error::RowNotFound);
        }
        Ok(())
    }

    async fn find_user_id_by_stripe_customer_id(
        &self,
        customer_id: &str,
    ) -> Result<Option<Uuid>, sqlx::Error> {
        let rec = sqlx::query_scalar!(
            "SELECT id FROM users WHERE stripe_customer_id = $1",
            customer_id
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(rec)
    }

    async fn clear_pending_checkout_with_error(
        &self,
        user_id: Uuid,
        message: &str,
    ) -> Result<(), sqlx::Error> {
        // Load, mutate, and persist settings to avoid clobbering other keys
        let mut settings = self.get_user_settings(user_id).await?;
        if let Some(obj) = settings.as_object_mut() {
            let billing = obj
                .entry("billing")
                .or_insert_with(|| serde_json::json!({}))
                .as_object_mut()
                .unwrap();
            billing.insert("pending_checkout".to_string(), serde_json::Value::Null);
            billing.insert(
                "last_error".to_string(),
                serde_json::Value::String(message.to_string()),
            );
            billing.insert(
                "last_error_at".to_string(),
                serde_json::json!(time::OffsetDateTime::now_utc()),
            );
        }
        self.update_user_settings(user_id, settings).await
    }

    async fn create_issue_report(&self, report: NewIssueReport) -> Result<Uuid, sqlx::Error> {
        let issue_id = sqlx::query_scalar!(
            r#"
            INSERT INTO issue_reports (
                user_id,
                workspace_id,
                user_email,
                user_name,
                user_plan,
                user_role,
                workspace_plan,
                workspace_role,
                description,
                metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id
            "#,
            report.user_id,
            report.workspace_id,
            report.user_email,
            report.user_name,
            report.user_plan,
            report.user_role,
            report.workspace_plan,
            report.workspace_role,
            report.description,
            report.metadata
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(issue_id)
    }

    async fn upsert_account_deletion_token(
        &self,
        user_id: Uuid,
        token: &str,
        expires_at: OffsetDateTime,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        sqlx::query!(
            "DELETE FROM account_deletion_tokens WHERE user_id = $1",
            user_id
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "INSERT INTO account_deletion_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)",
            token,
            user_id,
            expires_at
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    async fn get_account_deletion_context(
        &self,
        token: &str,
    ) -> Result<Option<AccountDeletionContext>, sqlx::Error> {
        let row = sqlx::query!(
            r#"
            SELECT
                t.token,
                t.user_id AS token_user_id,
                t.expires_at,
                t.consumed_at,
                t.created_at AS token_created_at,
                u.id,
                u.email,
                u.password_hash,
                u.first_name,
                u.last_name,
                u.role AS "role: crate::models::user::UserRole",
                u.plan,
                u.company_name,
                u.stripe_customer_id,
                u.oauth_provider AS "oauth_provider: OauthProvider",
                u.onboarded_at,
                u.created_at,
                u.is_verified
            FROM account_deletion_tokens t
            JOIN users u ON u.id = t.user_id
            WHERE t.token = $1
            "#,
            token
        )
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };

        let token = AccountDeletionToken {
            token: row.token,
            user_id: row.token_user_id,
            expires_at: row.expires_at,
            consumed_at: row.consumed_at,
            created_at: row.token_created_at,
        };

        let user = User {
            id: row.id,
            email: row.email,
            password_hash: row.password_hash,
            first_name: row.first_name,
            last_name: row.last_name,
            role: Some(row.role),
            plan: row.plan,
            company_name: row.company_name,
            stripe_customer_id: row.stripe_customer_id,
            oauth_provider: row.oauth_provider,
            onboarded_at: row.onboarded_at,
            created_at: row.created_at,
            is_verified: row.is_verified,
        };

        Ok(Some(AccountDeletionContext { token, user }))
    }

    async fn collect_account_deletion_counts(
        &self,
        user_id: Uuid,
    ) -> Result<AccountDeletionCounts, sqlx::Error> {
        let workflow_count = sqlx::query_scalar!(
            "SELECT COUNT(*)::bigint FROM workflows WHERE user_id = $1",
            user_id
        )
        .fetch_one(&self.pool)
        .await?
        .unwrap_or(0);

        let owned_workspace_count = sqlx::query_scalar!(
            "SELECT COUNT(*)::bigint FROM workspaces WHERE owner_id = $1",
            user_id
        )
        .fetch_one(&self.pool)
        .await?
        .unwrap_or(0);

        let member_workspace_count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*)::bigint
            FROM workspace_members wm
            JOIN workspaces w ON w.id = wm.workspace_id
            WHERE wm.user_id = $1
              AND w.owner_id <> $1
            "#,
            user_id
        )
        .fetch_one(&self.pool)
        .await?
        .unwrap_or(0);

        let workflow_run_count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*)::bigint
            FROM workflow_runs
            WHERE workflow_id IN (SELECT id FROM workflows WHERE user_id = $1)
            "#,
            user_id
        )
        .fetch_one(&self.pool)
        .await?
        .unwrap_or(0);

        let workflow_log_count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*)::bigint
            FROM workflow_logs
            WHERE user_id = $1
               OR workflow_id IN (SELECT id FROM workflows WHERE user_id = $1)
            "#,
            user_id
        )
        .fetch_one(&self.pool)
        .await?
        .unwrap_or(0);

        let oauth_connection_count = sqlx::query_scalar!(
            "SELECT COUNT(*)::bigint FROM user_oauth_tokens WHERE user_id = $1",
            user_id
        )
        .fetch_one(&self.pool)
        .await?
        .unwrap_or(0);

        let workspace_invitation_count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*)::bigint
            FROM workspace_invitations
            WHERE created_by = $1 AND status = 'pending'
            "#,
            user_id
        )
        .fetch_one(&self.pool)
        .await?
        .unwrap_or(0);

        Ok(AccountDeletionCounts {
            workflow_count,
            owned_workspace_count,
            member_workspace_count,
            workflow_run_count,
            workflow_log_count,
            oauth_connection_count,
            workspace_invitation_count,
        })
    }

    async fn finalize_account_deletion(
        &self,
        token: &str,
        audit: AccountDeletionAuditInsert,
    ) -> Result<(), sqlx::Error> {
        use std::convert::TryFrom;

        let mut tx = self.pool.begin().await?;

        let token_row = sqlx::query!(
            r#"
            SELECT user_id, created_at, consumed_at, expires_at
            FROM account_deletion_tokens
            WHERE token = $1
            FOR UPDATE
            "#,
            token
        )
        .fetch_optional(&mut *tx)
        .await?;

        let Some(row) = token_row else {
            tx.rollback().await?;
            return Err(sqlx::Error::RowNotFound);
        };

        if row.consumed_at.is_some() || row.expires_at <= OffsetDateTime::now_utc() {
            tx.rollback().await?;
            return Err(sqlx::Error::RowNotFound);
        }

        if row.user_id != audit.user_id {
            tx.rollback().await?;
            return Err(sqlx::Error::Protocol("token/user mismatch".into()));
        }

        let workflow_count = i32::try_from(audit.workflow_count)
            .map_err(|_| sqlx::Error::Protocol("workflow count overflow".into()))?;
        let owned_workspace_count = i32::try_from(audit.owned_workspace_count)
            .map_err(|_| sqlx::Error::Protocol("workspace count overflow".into()))?;
        let member_workspace_count = i32::try_from(audit.member_workspace_count)
            .map_err(|_| sqlx::Error::Protocol("member workspace count overflow".into()))?;

        sqlx::query!(
            r#"
            INSERT INTO account_deletion_audit (
                user_id,
                email,
                requested_at,
                confirmed_at,
                workflow_count,
                owned_workspace_count,
                member_workspace_count,
                stripe_customer_id,
                oauth_provider,
                ip_address,
                user_agent,
                metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            "#,
            audit.user_id,
            audit.email,
            audit.requested_at,
            audit.confirmed_at,
            workflow_count,
            owned_workspace_count,
            member_workspace_count,
            audit.stripe_customer_id,
            audit.oauth_provider,
            audit.ip_address,
            audit.user_agent,
            audit.metadata
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "UPDATE account_deletion_tokens SET consumed_at = now() WHERE token = $1",
            token
        )
        .execute(&mut *tx)
        .await?;

        // Remove any workflows owned by the user as well as workflows that live in
        // workspaces they own. This ensures downstream tables that reference
        // `workspace_id` (e.g., workflow runs, logs, schedules) are deleted via the
        // cascade on `workflow_id` before we drop the workspace itself, avoiding the
        // foreign-key violation observed in production.
        sqlx::query!(
            r#"
            DELETE FROM workflows
            WHERE user_id = $1
               OR workspace_id IN (SELECT id FROM workspaces WHERE owner_id = $1)
            "#,
            audit.user_id
        )
        .execute(&mut *tx)
        .await?;

        // Remove any workspaces owned by the user before deleting the user record so
        // the subsequent cascade from `users` does not attempt to delete workspaces
        // that still have workflows pointing at them.
        sqlx::query!("DELETE FROM workspaces WHERE owner_id = $1", audit.user_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query!("DELETE FROM users WHERE id = $1", audit.user_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(())
    }

    async fn delete_verification_tokens_for_user(&self, user_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query!(
            "DELETE FROM email_verification_tokens WHERE user_id = $1",
            user_id
        )
        .execute(&self.pool)
        .await
        .map(|_| ())
    }

    async fn clear_stripe_customer_id(&self, user_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"
            UPDATE users
            SET stripe_customer_id = NULL
            WHERE id = $1
            "#,
            user_id
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
