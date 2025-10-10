use crate::services::smtp_mailer::{MailError, Mailer, SmtpConfig};
use async_trait::async_trait;
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordedSmtpEmail {
    pub config: SmtpConfig,
    pub recipients: Vec<String>,
    pub subject: String,
    pub body: String,
}

/// A mock mailer that records sent emails for testing purposes.
#[derive(Debug, Default)]
#[allow(dead_code)]
pub struct MockMailer {
    pub sent_verification_emails: Mutex<Vec<(String, String)>>,
    pub sent_reset_emails: Mutex<Vec<(String, String)>>,
    pub sent_smtp_emails: Mutex<Vec<RecordedSmtpEmail>>,
    pub fail_send: bool,
}

#[async_trait]
impl Mailer for MockMailer {
    async fn send_verification_email(&self, to: &str, token: &str) -> Result<(), MailError> {
        if self.fail_send {
            return Err(MailError::Other("mock failure".into()));
        }
        self.sent_verification_emails
            .lock()
            .unwrap()
            .push((to.to_string(), token.to_string()));
        Ok(())
    }

    async fn send_reset_email(&self, to: &str, token: &str) -> Result<(), MailError> {
        self.sent_reset_emails
            .lock()
            .unwrap()
            .push((to.to_string(), token.to_string()));
        if self.fail_send {
            Err(MailError::Other("mock fail".into()))
        } else {
            Ok(())
        }
    }

    async fn send_email_generic(
        &self,
        _to: &str,
        _subject: &str,
        _body: &str,
    ) -> Result<(), MailError> {
        if self.fail_send {
            Err(MailError::Other("mock fail".into()))
        } else {
            Ok(())
        }
    }

    async fn send_email_with_config(
        &self,
        config: &SmtpConfig,
        recipients: &[String],
        subject: &str,
        body: &str,
    ) -> Result<(), MailError> {
        if self.fail_send {
            return Err(MailError::Other("mock fail".into()));
        }

        self.sent_smtp_emails
            .lock()
            .unwrap()
            .push(RecordedSmtpEmail {
                config: config.clone(),
                recipients: recipients.to_vec(),
                subject: subject.to_string(),
                body: body.to_string(),
            });

        Ok(())
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}
