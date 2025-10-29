use serde::{Deserialize, Serialize};

use crate::models::user::UserRole;

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, Clone)]
#[serde(rename_all = "lowercase")]
pub enum TokenUse {
    Access,
    Refresh,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Clone)]
pub struct Claims {
    pub id: String, // user ID or UUID
    pub email: String,
    pub exp: usize, // expiration (as UNIX timestamp)
    pub first_name: String,
    pub last_name: String,
    // Optional fields
    pub role: Option<UserRole>,
    pub plan: Option<String>,
    pub company_name: Option<String>,
    pub iss: String,
    pub aud: String,
    pub token_use: TokenUse,
}
