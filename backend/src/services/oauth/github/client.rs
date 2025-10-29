// services/oauth/github/real.rs

use crate::services::oauth::github::errors::GitHubAuthError;
use crate::services::oauth::github::models::GitHubToken;
use async_trait::async_trait;
use reqwest::Client;
use std::env;

use super::service::{GitHubOAuthService, GitHubUserInfo};

#[derive(Clone)]
pub struct GitHubOAuthClient {
    pub client: Client,
}

fn required_env_var(key: &'static str) -> Result<String, GitHubAuthError> {
    env::var(key).map_err(|_| GitHubAuthError::MissingConfiguration(key))
}

#[async_trait]
impl GitHubOAuthService for GitHubOAuthClient {
    async fn exchange_code_for_token(&self, code: &str) -> Result<GitHubToken, GitHubAuthError> {
        let token_url = required_env_var("GITHUB_OAUTH_TOKEN_URL")?;
        let client_id = required_env_var("GITHUB_CLIENT_ID")?;
        let client_secret = required_env_var("GITHUB_CLIENT_SECRET")?;

        let res = self
            .client
            .post(token_url)
            .header("Accept", "application/json") // Needed to get JSON response instead of URL-encoded
            .form(&[
                ("client_id", client_id),
                ("client_secret", client_secret),
                ("code", code.to_string()),
                // Optionally:
                // ("redirect_uri", redirect_uri),
                // ("state", csrf_token),
            ])
            .send()
            .await
            .map_err(|_| GitHubAuthError::TokenExchangeFailed)?;

        let json: serde_json::Value = res
            .json()
            .await
            .map_err(|_| GitHubAuthError::InvalidTokenJson)?;

        let access_token = json["access_token"]
            .as_str()
            .ok_or(GitHubAuthError::InvalidTokenJson)?;
        Ok(GitHubToken {
            access_token: access_token.to_string(),
        })
    }
    async fn fetch_user_info(
        &self,
        token: &GitHubToken,
    ) -> Result<GitHubUserInfo, GitHubAuthError> {
        let user_resp = self
            .client
            .get("https://api.github.com/user")
            .bearer_auth(&token.access_token)
            .header("User-Agent", "dsentr")
            .send()
            .await
            .map_err(|_| GitHubAuthError::UserInfoFetchFailed)?;

        let user_json: serde_json::Value = user_resp
            .json()
            .await
            .map_err(|_| GitHubAuthError::UserInfoFetchFailed)?;

        let email_resp = self
            .client
            .get("https://api.github.com/user/emails")
            .bearer_auth(&token.access_token)
            .header("User-Agent", "dsentr")
            .send()
            .await
            .map_err(|_| GitHubAuthError::EmailFetchFailed)?;

        let emails: Vec<serde_json::Value> = email_resp
            .json()
            .await
            .map_err(|_| GitHubAuthError::EmailFetchFailed)?;

        let email = emails
            .iter()
            .find(|e| e["verified"].as_bool() == Some(true) && e["primary"].as_bool() == Some(true))
            .and_then(|e| e["email"].as_str())
            .ok_or(GitHubAuthError::NoVerifiedEmail)?
            .to_string();

        let full_name = user_json["name"].as_str().unwrap_or("").to_string();
        let login = user_json["login"].as_str().unwrap_or("").to_string();

        let (first_name, last_name) = if !full_name.is_empty() {
            let mut parts = full_name.split_whitespace();
            let first = parts.next().unwrap_or("").to_string();
            let last = parts.collect::<Vec<_>>().join(" ");
            (first, last)
        } else {
            (login.clone(), "".to_string())
        };

        Ok(GitHubUserInfo {
            email,
            first_name,
            last_name,
        })
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
            "GITHUB_OAUTH_TOKEN_URL",
            "GITHUB_CLIENT_ID",
            "GITHUB_CLIENT_SECRET",
        ];
        let snapshot = {
            let _guard = ENV_MUTEX.lock().unwrap();
            let snapshot: Vec<_> = keys.iter().map(|key| (*key, env::var(key).ok())).collect();
            for key in &keys {
                env::remove_var(key);
            }
            snapshot
        };

        let client = GitHubOAuthClient {
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
            GitHubAuthError::MissingConfiguration("GITHUB_OAUTH_TOKEN_URL")
        ));
    }
}
