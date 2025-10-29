use crate::services::oauth::google::{errors::GoogleAuthError, service::GoogleOAuthService};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::Value;
use std::env;

pub struct GoogleOAuthClient {
    pub client: Client,
}

fn required_env_var(key: &'static str) -> Result<String, GoogleAuthError> {
    env::var(key).map_err(|_| GoogleAuthError::MissingConfiguration(key))
}

#[async_trait]
impl GoogleOAuthService for GoogleOAuthClient {
    async fn exchange_code_for_token(&self, code: &str) -> Result<String, GoogleAuthError> {
        let token_url = required_env_var("GOOGLE_ACCOUNTS_OAUTH_TOKEN_CLIENT_URL")?;
        let client_id = required_env_var("GOOGLE_CLIENT_ID")?;
        let client_secret = required_env_var("GOOGLE_CLIENT_SECRET")?;
        let redirect_uri = required_env_var("GOOGLE_REDIRECT_URI")?;

        let res = self
            .client
            .post(token_url)
            .form(&[
                ("code", code),
                ("client_id", client_id.as_str()),
                ("client_secret", client_secret.as_str()),
                ("redirect_uri", redirect_uri.as_str()),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
            .map_err(|_| GoogleAuthError::TokenExchangeFailed)?;

        if !res.status().is_success() {
            return Err(GoogleAuthError::TokenExchangeFailed);
        }

        let token_json: Value = res
            .json()
            .await
            .map_err(|_| GoogleAuthError::InvalidTokenJson)?;
        token_json["access_token"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or(GoogleAuthError::InvalidTokenJson)
    }

    async fn fetch_user_info(&self, access_token: &str) -> Result<Value, GoogleAuthError> {
        let user_info_url = required_env_var("GOOGLE_ACCOUNTS_OAUTH_USER_INFO_URL")?;

        let res = self
            .client
            .get(user_info_url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|_| GoogleAuthError::UserInfoFetchFailed)?;

        if !res.status().is_success() {
            return Err(GoogleAuthError::UserInfoFetchFailed);
        }

        res.json()
            .await
            .map_err(|_| GoogleAuthError::InvalidUserInfo)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use once_cell::sync::Lazy;
    use std::sync::Mutex;

    static ENV_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn restore_env(vars: Vec<(&'static str, Option<String>)>) {
        for (key, value) in vars {
            if let Some(val) = value {
                env::set_var(key, val);
            } else {
                env::remove_var(key);
            }
        }
    }

    #[tokio::test]
    async fn exchange_code_for_token_missing_configuration() {
        let keys = vec![
            "GOOGLE_ACCOUNTS_OAUTH_TOKEN_CLIENT_URL",
            "GOOGLE_CLIENT_ID",
            "GOOGLE_CLIENT_SECRET",
            "GOOGLE_REDIRECT_URI",
        ];
        let snapshot = {
            let _guard = ENV_MUTEX.lock().unwrap();
            let snapshot: Vec<_> = keys.iter().map(|key| (*key, env::var(key).ok())).collect();
            for key in &keys {
                env::remove_var(key);
            }
            snapshot
        };

        let client = GoogleOAuthClient {
            client: Client::new(),
        };

        let err = client
            .exchange_code_for_token("code")
            .await
            .expect_err("missing env should surface configuration error");

        {
            let _guard = ENV_MUTEX.lock().unwrap();
            restore_env(snapshot);
        }

        assert!(matches!(
            err,
            GoogleAuthError::MissingConfiguration("GOOGLE_ACCOUNTS_OAUTH_TOKEN_CLIENT_URL")
        ));
    }

    #[tokio::test]
    async fn fetch_user_info_missing_configuration() {
        let key = "GOOGLE_ACCOUNTS_OAUTH_USER_INFO_URL";
        let snapshot = {
            let _guard = ENV_MUTEX.lock().unwrap();
            let snapshot = vec![(key, env::var(key).ok())];
            env::remove_var(key);
            snapshot
        };

        let client = GoogleOAuthClient {
            client: Client::new(),
        };

        let err = client
            .fetch_user_info("token")
            .await
            .expect_err("missing env should surface configuration error");

        {
            let _guard = ENV_MUTEX.lock().unwrap();
            restore_env(snapshot);
        }

        assert!(matches!(
            err,
            GoogleAuthError::MissingConfiguration("GOOGLE_ACCOUNTS_OAUTH_USER_INFO_URL")
        ));
    }
}
