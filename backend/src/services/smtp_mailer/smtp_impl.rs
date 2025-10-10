use async_trait::async_trait;
use lettre::{
    address::AddressError,
    message::Mailbox,
    transport::smtp::{
        authentication::Credentials,
        client::{Tls, TlsParameters},
    },
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use std::sync::Arc;

use crate::services::smtp_mailer::{Mailer, SmtpConfig, TlsMode};

use super::MailError;

#[derive(Clone)]
pub struct SmtpMailer {
    transport: Arc<AsyncSmtpTransport<Tokio1Executor>>,
    sender: Mailbox,
}

impl SmtpMailer {
    pub fn new() -> Result<Self, anyhow::Error> {
        let host = std::env::var("SMTP_HOST")?;
        let username = std::env::var("SMTP_USERNAME")?;
        let password = std::env::var("SMTP_PASSWORD")?;
        let from = std::env::var("SMTP_FROM")?.parse()?;
        let port: u16 = std::env::var("SMTP_PORT")?.parse()?;

        let disabled_tls = std::env::var("SMTP_TLS_DISABLED")
            .unwrap_or_else(|_| "false".to_string())
            .to_lowercase()
            == "true";

        let mailer = if disabled_tls {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&host)
                .port(port)
                .build()
        } else {
            let creds = Credentials::new(username, password);
            let tls = TlsParameters::new(host.clone())?;

            AsyncSmtpTransport::<Tokio1Executor>::relay(&host)?
                .port(port)
                .tls(Tls::Required(tls))
                .credentials(creds)
                .build()
        };

        Ok(Self {
            transport: Arc::new(mailer),
            sender: from,
        })
    }

    async fn send_email(&self, to: &str, subject: &str, body: &str) -> Result<(), MailError> {
        let email = Message::builder()
            .from(self.sender.clone())
            .to(to
                .parse()
                .map_err(|e: AddressError| MailError::InvalidEmailAddress(e.to_string()))?)
            .subject(subject)
            .body(body.to_string())?;

        self.transport
            .send(email)
            .await
            .map(|_| ())
            .map_err(|e| e.into())
    }
}

#[async_trait]
impl Mailer for SmtpMailer {
    async fn send_verification_email(&self, to: &str, token: &str) -> Result<(), MailError> {
        let verify_link =
            std::env::var("FRONTEND_ORIGIN")? + &std::env::var("EMAIL_VERIFICATION_PATH")?;
        let full_url = format!("{}{}", verify_link, token);

        let body = format!("Thanks for signing up!\n\nVerify here:\n{}", full_url);

        self.send_email(to, "Verify your email", &body).await
    }

    async fn send_reset_email(&self, to: &str, token: &str) -> Result<(), MailError> {
        let reset_link = std::env::var("FRONTEND_ORIGIN")? + &std::env::var("RESET_PASSWORD_PATH")?;
        let full_url = format!("{}{}", reset_link, token);

        let body = format!(
            "You requested to reset your password.\n\nReset here:\n{}\n\nThis link will expire in 30 minutes.",
            full_url
        );

        self.send_email(to, "Reset your password", &body).await
    }

    async fn send_email_generic(
        &self,
        to: &str,
        subject: &str,
        body: &str,
    ) -> Result<(), MailError> {
        self.send_email(to, subject, body).await
    }

    async fn send_email_with_config(
        &self,
        config: &SmtpConfig,
        recipients: &[String],
        subject: &str,
        body: &str,
    ) -> Result<(), MailError> {
        let from_mailbox: Mailbox = config.from.parse()?;
        let mut builder = Message::builder().from(from_mailbox);

        for recipient in recipients {
            let mailbox: Mailbox = recipient.parse()?;
            builder = builder.to(mailbox);
        }

        let email = builder.subject(subject).body(body.to_string())?;

        let transport = build_dynamic_transport(config)?;

        transport.send(email).await.map(|_| ()).map_err(|e| {
            MailError::SendError(format!(
                "{} (host: {}:{}, tls: {}, auth: {})",
                e,
                config.host,
                config.port,
                config.tls_mode,
                if config.username.is_some() {
                    "set"
                } else {
                    "not set"
                }
            ))
        })
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

fn build_dynamic_transport(
    config: &SmtpConfig,
) -> Result<AsyncSmtpTransport<Tokio1Executor>, MailError> {
    let mut builder = match config.tls_mode {
        TlsMode::StartTls => {
            let tls = TlsParameters::new(config.host.clone())?;
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host)?
                .port(config.port)
                .tls(Tls::Required(tls))
        }
        TlsMode::Implicit => {
            let tls = TlsParameters::new(config.host.clone())?;
            AsyncSmtpTransport::<Tokio1Executor>::relay(&config.host)?
                .port(config.port)
                .tls(Tls::Wrapper(tls))
        }
        TlsMode::None => {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.host).port(config.port)
        }
    };

    if let (Some(username), Some(password)) = (config.username.as_ref(), config.password.as_ref()) {
        builder = builder.credentials(Credentials::new(username.clone(), password.clone()));
    }

    Ok(builder.build())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_config() -> SmtpConfig {
        SmtpConfig {
            host: "smtp.example.com".to_string(),
            port: 587,
            username: Some("user".to_string()),
            password: Some("pass".to_string()),
            from: "sender@example.com".to_string(),
            tls_mode: TlsMode::StartTls,
        }
    }

    #[tokio::test]
    async fn build_dynamic_transport_prefers_starttls_on_standard_ports() {
        let config = base_config();
        let transport = build_dynamic_transport(&config);
        assert!(transport.is_ok());
    }

    #[tokio::test]
    async fn build_dynamic_transport_supports_wrapper_tls_on_port_465() {
        let mut config = base_config();
        config.port = 465;
        config.tls_mode = TlsMode::Implicit;
        let transport = build_dynamic_transport(&config);
        assert!(transport.is_ok());
    }

    #[tokio::test]
    async fn build_dynamic_transport_allows_plaintext_when_disabled() {
        let mut config = base_config();
        config.tls_mode = TlsMode::None;
        let transport = build_dynamic_transport(&config);
        assert!(transport.is_ok());
    }
}
