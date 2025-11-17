use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;

use crate::services::smtp_mailer::{MailError, Mailer, SmtpConfig};

#[derive(Clone)]
pub struct MailjetMailer {
    api_key: String,
    secret: String,
    from_email: String,
    from_name: String,
    http: Client,
}

impl MailjetMailer {
    pub fn from_env(http: &Client) -> Result<Self, MailError> {
        let api_key = std::env::var("MAILJET_API_KEY")
            .map_err(|_| MailError::EnvVarMissing("MAILJET_API_KEY".into()))?;

        let secret = std::env::var("MAILJET_SECRET_KEY")
            .map_err(|_| MailError::EnvVarMissing("MAILJET_SECRET_KEY".into()))?;

        // Prefer MAILJET_FROM_* then EMAIL_FROM then SMTP_FROM.
        let from_email = std::env::var("MAILJET_FROM_EMAIL")
            .or_else(|_| std::env::var("EMAIL_FROM"))
            .or_else(|_| std::env::var("SMTP_FROM"))
            .map_err(|_| {
                MailError::EnvVarMissing("MAILJET_FROM_EMAIL or EMAIL_FROM or SMTP_FROM".into())
            })?;

        let from_name = std::env::var("MAILJET_FROM_NAME").unwrap_or_else(|_| "DSentr".into());

        Ok(Self {
            api_key,
            secret,
            from_email,
            from_name,
            http: http.clone(),
        })
    }

    async fn send(&self, to: &str, subject: &str, body: &str) -> Result<(), MailError> {
        let payload = json!({
            "Messages": [
                {
                    "From": {
                        "Email": self.from_email,
                        "Name": self.from_name
                    },
                    "To": [
                        { "Email": to }
                    ],
                    "Subject": subject,
                    "TextPart": body
                }
            ]
        });

        let resp = self
            .http
            .post("https://api.mailjet.com/v3.1/send")
            .basic_auth(&self.api_key, Some(&self.secret))
            .json(&payload)
            .send()
            .await
            .map_err(|e| MailError::SendError(e.to_string()))?;

        if resp.status().is_success() {
            return Ok(());
        }

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(MailError::SendError(format!(
            "Mailjet send failed: {} {}",
            status, text
        )))
    }
}

#[async_trait]
impl Mailer for MailjetMailer {
    async fn send_verification_email(&self, to: &str, token: &str) -> Result<(), MailError> {
        let link = std::env::var("FRONTEND_ORIGIN")? + &std::env::var("EMAIL_VERIFICATION_PATH")?;
        let full = format!("{}{}", link, token);
        let body = format!("Thanks for signing up.\n\nVerify here:\n{}", full);

        self.send(to, "Verify your email", &body).await
    }

    async fn send_reset_email(&self, to: &str, token: &str) -> Result<(), MailError> {
        let link = std::env::var("FRONTEND_ORIGIN")? + &std::env::var("RESET_PASSWORD_PATH")?;
        let full = format!("{}{}", link, token);

        let body = format!(
            "You requested to reset your password.\n\nReset here:\n{}\n\nThis link expires in 30 minutes.",
            full
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
        Err(MailError::Other(
            "send_email_with_config is not supported by Mailjet mailer".into(),
        ))
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}
