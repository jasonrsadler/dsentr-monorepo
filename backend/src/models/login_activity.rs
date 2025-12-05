use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::types::ipnetwork::IpNetwork;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserLoginActivity {
    pub id: Uuid,
    pub user_id: Uuid,
    pub session_id: Uuid,
    pub ip_address: String,
    pub user_agent: Option<String>,
    pub city: Option<String>,
    pub region: Option<String>,
    pub country: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub is_proxy: Option<bool>,
    pub is_vpn: Option<bool>,
    pub lookup_raw: Option<Value>,
    #[serde(with = "time::serde::rfc3339")]
    pub logged_in_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub logged_out_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct NewLoginActivity {
    pub user_id: Uuid,
    pub session_id: Uuid,
    pub ip_address: IpNetwork,
    pub user_agent: Option<String>,
    pub city: Option<String>,
    pub region: Option<String>,
    pub country: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub is_proxy: Option<bool>,
    pub is_vpn: Option<bool>,
    pub lookup_raw: Option<Value>,
    pub logged_in_at: OffsetDateTime,
}
