use serde::{Deserialize, Serialize};

use super::user::OauthProvider;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SignupInviteDecision {
    Join,
    Decline,
}

#[derive(Deserialize, Serialize)]
pub struct SignupPayload {
    pub email: String,
    pub password: String,
    pub first_name: String,
    pub last_name: String,
    pub company_name: Option<String>,
    pub country: Option<String>,
    pub tax_id: Option<String>,
    #[serde(default)]
    pub provider: Option<OauthProvider>,
    #[serde(default)]
    pub invite_token: Option<String>,
    #[serde(default)]
    pub invite_decision: Option<SignupInviteDecision>,
}
