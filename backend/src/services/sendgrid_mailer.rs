use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;

use crate::services::smtp_mailer::{MailError, Mailer, SmtpConfig};

#[derive(Clone)]
pub struct SendgridMailer {
    api_key: String,
    from: String,
    http: Client,
}

impl SendgridMailer {
    pub fn from_env(http: &Client) -> Result<Self, MailError> {
        let api_key = std::env::var("SENDGRID_API_KEY")
            .map_err(|_| MailError::EnvVarMissing("SENDGRID_API_KEY".into()))?;

        // Prefer a generic EMAIL_FROM; fall back to SMTP_FROM for compatibility
        let from = std::env::var("EMAIL_FROM")
            .ok()
            .or_else(|| std::env::var("SMTP_FROM").ok())
            .ok_or_else(|| MailError::EnvVarMissing("EMAIL_FROM or SMTP_FROM".into()))?;

        Ok(Self {
            api_key,
            from,
            http: http.clone(),
        })
    }

    async fn send(&self, to: &str, subject: &str, body: &str) -> Result<(), MailError> {
        let payload = json!({
            "personalizations": [ { "to": [ { "email": to } ] } ],
            "from": { "email": self.from },
            "subject": subject,
            "content": [ { "type": "text/plain", "value": body } ]
        });

        let resp = self
            .http
            .post("https://api.sendgrid.com/v3/mail/send")
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|e| MailError::SendError(e.to_string()))?;

        if resp.status().is_success() {
            Ok(())
        } else {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Err(MailError::SendError(format!(
                "SendGrid send failed: {} {}",
                status, text
            )))
        }
    }
}

#[async_trait]
impl Mailer for SendgridMailer {
    async fn send_verification_email(&self, to: &str, token: &str) -> Result<(), MailError> {
        let verify_link =
            std::env::var("FRONTEND_ORIGIN")? + &std::env::var("EMAIL_VERIFICATION_PATH")?;
        let full_url = format!("{}{}", verify_link, token);
        let body = format!("Thanks for signing up!\n\nVerify here:\n{}", full_url);
        self.send(to, "Verify your email", &body).await
    }

    async fn send_reset_email(&self, to: &str, token: &str) -> Result<(), MailError> {
        let reset_link = std::env::var("FRONTEND_ORIGIN")? + &std::env::var("RESET_PASSWORD_PATH")?;
        let full_url = format!("{}{}", reset_link, token);
        let body = format!(
            "You requested to reset your password.\n\nReset here:\n{}\n\nThis link will expire in 30 minutes.",
            full_url
        );
        self.send(to, "Reset your password", &body).await
    }

    async fn send_email_generic(
        &self,
        to: &str,
        subject: &str,
        body: &str,
    ) -> Result<(), MailError> {
        self.send(to, subject, body).await
    }

    async fn send_email_with_config(
        &self,
        _config: &SmtpConfig,
        _recipients: &[String],
        _subject: &str,
        _body: &str,
    ) -> Result<(), MailError> {
        // Not used for workflow nodes. Pluggable mailer handles SMTP runtime configuration.
        Err(MailError::Other(
            "send_email_with_config is not supported by SendGrid mailer".into(),
        ))
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}
