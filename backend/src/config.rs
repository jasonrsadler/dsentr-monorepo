use std::env;

use crate::utils::encryption::{decode_key, EncryptionError};

#[derive(Clone)]
pub struct OAuthProviderConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
}

#[derive(Clone)]
#[allow(dead_code)]
pub struct StripeSettings {
    pub client_id: String,
    pub secret_key: String,
    pub webhook_secret: String,
}

#[derive(Clone)]
pub struct OAuthSettings {
    pub google: OAuthProviderConfig,
    pub microsoft: OAuthProviderConfig,
    pub slack: OAuthProviderConfig,
    pub token_encryption_key: Vec<u8>,
}

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub frontend_origin: String,
    pub oauth: OAuthSettings,
    #[allow(dead_code)]
    pub stripe: StripeSettings,
}

impl Config {
    pub fn from_env() -> Self {
        dotenv::dotenv().ok();

        let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
        let frontend_origin = env::var("FRONTEND_ORIGIN").expect("FRONTEND_ORIGIN must be set");

        let google = OAuthProviderConfig {
            client_id: env::var("GOOGLE_INTEGRATIONS_CLIENT_ID")
                .expect("GOOGLE_INTEGRATIONS_CLIENT_ID must be set"),
            client_secret: env::var("GOOGLE_INTEGRATIONS_CLIENT_SECRET")
                .expect("GOOGLE_INTEGRATIONS_CLIENT_SECRET must be set"),
            redirect_uri: env::var("GOOGLE_INTEGRATIONS_REDIRECT_URI")
                .expect("GOOGLE_INTEGRATIONS_REDIRECT_URI must be set"),
        };

        let microsoft = OAuthProviderConfig {
            client_id: env::var("MICROSOFT_INTEGRATIONS_CLIENT_ID")
                .expect("MICROSOFT_INTEGRATIONS_CLIENT_ID must be set"),
            client_secret: env::var("MICROSOFT_INTEGRATIONS_CLIENT_SECRET")
                .expect("MICROSOFT_INTEGRATIONS_CLIENT_SECRET must be set"),
            redirect_uri: env::var("MICROSOFT_INTEGRATIONS_REDIRECT_URI")
                .expect("MICROSOFT_INTEGRATIONS_REDIRECT_URI must be set"),
        };

        let slack = OAuthProviderConfig {
            client_id: env::var("SLACK_INTEGRATIONS_CLIENT_ID")
                .expect("SLACK_INTEGRATIONS_CLIENT_ID must be set"),
            client_secret: env::var("SLACK_INTEGRATIONS_CLIENT_SECRET")
                .expect("SLACK_INTEGRATIONS_CLIENT_SECRET must be set"),
            redirect_uri: env::var("SLACK_INTEGRATIONS_REDIRECT_URI")
                .expect("SLACK_INTEGRATIONS_REDIRECT_URI must be set"),
        };

        let encryption_key_b64 =
            env::var("OAUTH_TOKEN_ENCRYPTION_KEY").expect("OAUTH_TOKEN_ENCRYPTION_KEY must be set");
        let token_encryption_key =
            decode_key(&encryption_key_b64).unwrap_or_else(|err| match err {
                EncryptionError::InvalidKeyLength => {
                    panic!("OAUTH_TOKEN_ENCRYPTION_KEY must decode to 32 bytes")
                }
                _ => panic!("OAUTH_TOKEN_ENCRYPTION_KEY must be valid base64"),
            });

        let stripe = StripeSettings {
            client_id: env::var("STRIPE_CLIENT_ID")
                .expect("STRIPE_CLIENT_ID must be set to configure Stripe OAuth"),
            secret_key: env::var("STRIPE_SECRET_KEY")
                .expect("STRIPE_SECRET_KEY must be set to sign Stripe API requests"),
            webhook_secret: env::var("STRIPE_WEBHOOK_SECRET")
                .expect("STRIPE_WEBHOOK_SECRET must be set to validate Stripe webhooks"),
        };

        Config {
            database_url,
            frontend_origin,
            oauth: OAuthSettings {
                google,
                microsoft,
                slack,
                token_encryption_key,
            },
            stripe,
        }
    }
}
