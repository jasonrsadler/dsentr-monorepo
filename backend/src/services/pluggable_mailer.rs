use async_trait::async_trait;
use lettre::{
    message::Mailbox,
    transport::smtp::{
        authentication::Credentials,
        client::{Tls, TlsParameters},
    },
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use reqwest::Client;
use std::sync::Arc;

use crate::services::smtp_mailer::{MailError, Mailer, SmtpConfig, TlsMode};

use super::mailjet_mailer::MailjetMailer;
use super::sendgrid_mailer::SendgridMailer;
use super::smtp_mailer::SmtpMailer;

#[derive(Clone)]
enum AppSender {
    Smtp(Arc<SmtpMailer>),
    Sendgrid(Arc<SendgridMailer>),
    Mailjet(Arc<MailjetMailer>),
}

#[derive(Clone)]
pub struct PluggableMailer {
    // App-level email transport (verification, reset, invites, notifications)
    app_sender: AppSender,
    // SMTP runtime sending for workflow nodes (per-request SMTP config)
    smtp_runtime: Option<Arc<SmtpMailer>>, // available when using SMTP for app sender
}

impl PluggableMailer {
    pub fn from_env(http: &Client) -> Result<Self, MailError> {
        let provider = std::env::var("EMAIL_PROVIDER").unwrap_or_else(|_| "smtp".into());
        let provider = provider.to_ascii_lowercase();

        match provider.as_str() {
            "smtp" => {
                let smtp = Arc::new(SmtpMailer::new()?);
                Ok(Self {
                    app_sender: AppSender::Smtp(smtp.clone()),
                    smtp_runtime: Some(smtp),
                })
            }
            "sendgrid" => {
                let sg = Arc::new(SendgridMailer::from_env(http)?);
                Ok(Self {
                    app_sender: AppSender::Sendgrid(sg),
                    smtp_runtime: None, // dynamic SMTP is implemented directly below
                })
            }
            "mailjet" => {
                let mj = Arc::new(MailjetMailer::from_env(http)?);
                Ok(Self {
                    app_sender: AppSender::Mailjet(mj),
                    smtp_runtime: None,
                })
            }
            other => Err(MailError::Other(format!(
                "Unsupported EMAIL_PROVIDER: {} (expected 'smtp' or 'sendgrid')",
                other
            ))),
        }
    }

    async fn send_runtime_smtp(
        &self,
        config: &SmtpConfig,
        recipients: &[String],
        subject: &str,
        body: &str,
    ) -> Result<(), MailError> {
        // If we have an SMTP mailer (provider=smtp), delegate to its implementation
        if let Some(smtp) = &self.smtp_runtime {
            return smtp
                .send_email_with_config(config, recipients, subject, body)
                .await;
        }

        // Otherwise (provider != smtp), build a transient SMTP transport from the provided config
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

        if let (Some(username), Some(password)) =
            (config.username.as_ref(), config.password.as_ref())
        {
            builder = builder.credentials(Credentials::new(username.clone(), password.clone()));
        }

        let transport = builder.build();

        let from_mailbox: Mailbox = config.from.parse()?;
        let mut msg_builder = Message::builder().from(from_mailbox);
        for r in recipients {
            msg_builder = msg_builder.to(r.parse()?);
        }
        let email = msg_builder.subject(subject).body(body.to_string())?;

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
}

#[async_trait]
impl Mailer for PluggableMailer {
    async fn send_verification_email(&self, to: &str, token: &str) -> Result<(), MailError> {
        match &self.app_sender {
            AppSender::Smtp(smtp) => smtp.send_verification_email(to, token).await,
            AppSender::Sendgrid(sg) => sg.send_verification_email(to, token).await,
            AppSender::Mailjet(mj) => mj.send_verification_email(to, token).await,
        }
    }

    async fn send_reset_email(&self, to: &str, token: &str) -> Result<(), MailError> {
        match &self.app_sender {
            AppSender::Smtp(smtp) => smtp.send_reset_email(to, token).await,
            AppSender::Sendgrid(sg) => sg.send_reset_email(to, token).await,
            AppSender::Mailjet(mj) => mj.send_reset_email(to, token).await,
        }
    }

    async fn send_email_generic(
        &self,
        to: &str,
        subject: &str,
        body: &str,
    ) -> Result<(), MailError> {
        match &self.app_sender {
            AppSender::Smtp(smtp) => smtp.send_email_generic(to, subject, body).await,
            AppSender::Sendgrid(sg) => sg.send_email_generic(to, subject, body).await,
            AppSender::Mailjet(mj) => mj.send_email_generic(to, subject, body).await,
        }
    }

    async fn send_email_with_config(
        &self,
        config: &SmtpConfig,
        recipients: &[String],
        subject: &str,
        body: &str,
    ) -> Result<(), MailError> {
        self.send_runtime_smtp(config, recipients, subject, body)
            .await
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}
