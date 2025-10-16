use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "oauth_connection_provider", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum ConnectedOAuthProvider {
    Google,
    Microsoft,
}

#[allow(dead_code)]
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct UserOAuthToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub provider: ConnectedOAuthProvider,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: OffsetDateTime,
    pub account_email: String,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}
