use async_trait::async_trait;
use std::any::Any;
use std::fmt;

#[derive(Debug)]
#[allow(dead_code)]
pub enum MailError {
    Other(String),
    InvalidEmailAddress(String),
    SendError(String),
    EnvVarMissing(String),
}

impl fmt::Display for MailError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MailError::Other(e) => write!(f, "Error: {}", e),
            MailError::InvalidEmailAddress(e) => write!(f, "Invalid Address: {}", e),
            MailError::SendError(e) => write!(f, "Send error: {}", e),
            MailError::EnvVarMissing(e) => write!(f, "Env Var Missing: {}", e),
        }
    }
}

impl std::error::Error for MailError {}

use lettre::transport::smtp::Error as SmtpError;

impl From<SmtpError> for MailError {
    fn from(err: SmtpError) -> Self {
        MailError::SendError(err.to_string())
    }
}

impl From<std::env::VarError> for MailError {
    fn from(err: std::env::VarError) -> Self {
        MailError::EnvVarMissing(err.to_string())
    }
}

impl From<lettre::error::Error> for MailError {
    fn from(err: lettre::error::Error) -> Self {
        MailError::SendError(err.to_string())
    }
}

impl From<AddressError> for MailError {
    fn from(e: AddressError) -> Self {
        MailError::InvalidEmailAddress(e.to_string())
    }
}

#[async_trait]
pub trait Mailer: Send + Sync {
    async fn send_verification_email(&self, to: &str, token: &str) -> Result<(), MailError>;
    async fn send_reset_email(&self, to: &str, token: &str) -> Result<(), MailError>;
    async fn send_email_generic(
        &self,
        to: &str,
        subject: &str,
        body: &str,
    ) -> Result<(), MailError>;
    async fn send_email_with_config(
        &self,
        config: &SmtpConfig,
        recipients: &[String],
        subject: &str,
        body: &str,
    ) -> Result<(), MailError>;
    #[allow(dead_code)]
    fn as_any(&self) -> &dyn Any;
}

mod mock_mailer;
mod smtp_impl;

use lettre::address::AddressError;
#[allow(unused_imports)]
pub use mock_mailer::MockMailer;
pub use smtp_impl::SmtpMailer;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TlsMode {
    StartTls,
    Implicit,
}

impl TlsMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            TlsMode::StartTls => "starttls",
            TlsMode::Implicit => "implicit_tls",
        }
    }
}

impl fmt::Display for TlsMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub from: String,
    pub tls_mode: TlsMode,
}
