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
    host: String,
    port: u16,
    tls_mode: TlsMode,
}

impl SmtpMailer {
    pub fn new() -> Result<Self, MailError> {
        if std::env::var("SMTP_TLS_DISABLED")
            .map(|value| value.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
        {
            return Err(MailError::Other(
                "SMTP TLS must remain enabled; remove SMTP_TLS_DISABLED from the environment"
                    .into(),
            ));
        }

        let host = std::env::var("SMTP_HOST")?;
        if host.trim().is_empty() {
            return Err(MailError::Other(
                "SMTP_HOST must not be empty when configuring TLS".into(),
            ));
        }
        let username = std::env::var("SMTP_USERNAME")?;
        let password = std::env::var("SMTP_PASSWORD")?;
        let from = std::env::var("SMTP_FROM")?.parse()?;
        let port: u16 = std::env::var("SMTP_PORT")?
            .parse()
            .map_err(|err| MailError::Other(format!("invalid SMTP_PORT value: {}", err)))?;

        let tls_mode = if port == 465 {
            TlsMode::Implicit
        } else {
            TlsMode::StartTls
        };

        let creds = Credentials::new(username, password);
        let tls = TlsParameters::new(host.clone()).map_err(|err| {
            MailError::SendError(format!(
                "Failed to configure TLS for {}:{} (mode: {}): {}",
                host, port, tls_mode, err
            ))
        })?;

        let builder = AsyncSmtpTransport::<Tokio1Executor>::relay(&host)
            .map_err(|err| {
                MailError::SendError(format!(
                    "Failed to configure SMTP transport for {}:{} (mode: {}): {}",
                    host, port, tls_mode, err
                ))
            })?
            .port(port);

        let builder = match tls_mode {
            TlsMode::StartTls => builder.tls(Tls::Required(tls)),
            TlsMode::Implicit => builder.tls(Tls::Wrapper(tls)),
        };

        let mailer = builder.credentials(creds).build();

        Ok(Self {
            transport: Arc::new(mailer),
            sender: from,
            host,
            port,
            tls_mode,
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
            .map_err(|error| {
                tracing::error!(
                    error = %error,
                    host = %self.host,
                    port = self.port,
                    tls_mode = %self.tls_mode,
                    "Failed to send SMTP email"
                );
                MailError::SendError(format!(
                    "{} (host: {}:{}, tls: {})",
                    error, self.host, self.port, self.tls_mode
                ))
            })
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

        transport.send(email).await.map(|_| ()).map_err(|error| {
            tracing::error!(
                error = %error,
                host = %config.host,
                port = config.port,
                tls_mode = %config.tls_mode,
                auth_configured = config.username.is_some(),
                "Failed to send SMTP email with dynamic configuration"
            );
            MailError::SendError(format!(
                "{} (host: {}:{}, tls: {}, auth: {})",
                error,
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
    if config.host.trim().is_empty() {
        return Err(MailError::SendError(format!(
            "Failed to configure TLS for {}:{} (mode: {}): SMTP host is empty",
            config.host, config.port, config.tls_mode
        )));
    }

    let tls = TlsParameters::new(config.host.clone()).map_err(|err| {
        MailError::SendError(format!(
            "Failed to configure TLS for {}:{} (mode: {}): {}",
            config.host, config.port, config.tls_mode, err
        ))
    })?;

    let mut builder = match config.tls_mode {
        TlsMode::StartTls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host)
            .map_err(|err| {
                MailError::SendError(format!(
                    "Failed to configure SMTP transport for {}:{} (mode: {}): {}",
                    config.host, config.port, config.tls_mode, err
                ))
            })?
            .port(config.port)
            .tls(Tls::Required(tls)),
        TlsMode::Implicit => AsyncSmtpTransport::<Tokio1Executor>::relay(&config.host)
            .map_err(|err| {
                MailError::SendError(format!(
                    "Failed to configure SMTP transport for {}:{} (mode: {}): {}",
                    config.host, config.port, config.tls_mode, err
                ))
            })?
            .port(config.port)
            .tls(Tls::Wrapper(tls)),
    };

    if let (Some(username), Some(password)) = (config.username.as_ref(), config.password.as_ref()) {
        builder = builder.credentials(Credentials::new(username.clone(), password.clone()));
    }

    Ok(builder.build())
}

#[cfg(test)]
mod tests {
    use super::*;
    use once_cell::sync::Lazy;
    use std::sync::{Mutex, MutexGuard};

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

    static ENV_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    struct EnvGuard {
        previous: Vec<(&'static str, Option<String>)>,
        _lock: MutexGuard<'static, ()>,
    }

    impl EnvGuard {
        fn set(vars: &[(&'static str, &'static str)]) -> Self {
            let lock = ENV_LOCK.lock().expect("env mutex poisoned");
            let mut previous = Vec::with_capacity(vars.len());

            for (key, value) in vars {
                previous.push((*key, std::env::var(key).ok()));
                std::env::set_var(key, value);
            }

            Self {
                previous,
                _lock: lock,
            }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, value) in self.previous.drain(..) {
                if let Some(previous) = value {
                    std::env::set_var(key, previous);
                } else {
                    std::env::remove_var(key);
                }
            }
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
    async fn smtp_mailer_new_rejects_disabled_tls_env() {
        let _guard = EnvGuard::set(&[
            ("SMTP_HOST", "smtp.example.com"),
            ("SMTP_USERNAME", "user"),
            ("SMTP_PASSWORD", "secret"),
            ("SMTP_FROM", "sender@example.com"),
            ("SMTP_PORT", "587"),
            ("SMTP_TLS_DISABLED", "true"),
        ]);

        let error = match SmtpMailer::new() {
            Err(err) => err,
            Ok(_) => panic!("TLS disabled configurations must be rejected"),
        };

        if let MailError::Other(message) = error {
            assert!(
                message.contains("TLS"),
                "error message should mention TLS: {}",
                message
            );
        } else {
            panic!("expected MailError::Other, got: {:?}", error);
        }
    }

    #[tokio::test]
    async fn build_dynamic_transport_surfaces_tls_parameter_errors() {
        let mut config = base_config();
        config.host = String::new();

        let error = build_dynamic_transport(&config)
            .expect_err("invalid TLS host should surface a descriptive error");

        if let MailError::SendError(message) = error {
            assert!(
                message.contains("(mode: starttls)"),
                "error message should contain TLS mode context: {}",
                message
            );
            assert!(
                message.to_lowercase().contains("tls"),
                "error message should mention TLS context: {}",
                message
            );
        } else {
            panic!("expected MailError::SendError, got: {:?}", error);
        }
    }
}
