use std::sync::Arc;

use reqwest::{Client, StatusCode};
use serde::Deserialize;
use thiserror::Error;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::config::{OAuthProviderConfig, OAuthSettings};
use crate::db::oauth_token_repository::{NewUserOAuthToken, UserOAuthTokenRepository};
use crate::models::oauth_token::{ConnectedOAuthProvider, UserOAuthToken};
use crate::utils::encryption::{decrypt_secret, encrypt_secret, EncryptionError};

const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_REVOCATION_URL: &str = "https://oauth2.googleapis.com/revoke";
const MICROSOFT_TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MICROSOFT_USERINFO_URL: &str = "https://graph.microsoft.com/v1.0/me";
const MICROSOFT_REVOCATION_URL: &str =
    "https://login.microsoftonline.com/common/oauth2/v2.0/logout";

#[derive(Debug, Clone)]
pub struct StoredOAuthToken {
    pub provider: ConnectedOAuthProvider,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: OffsetDateTime,
    pub account_email: String,
}

#[derive(Debug, Clone)]
pub struct AuthorizationTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: OffsetDateTime,
    pub account_email: String,
}

#[derive(Error, Debug)]
pub enum OAuthAccountError {
    #[error("token not found")]
    NotFound,
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("encryption error: {0}")]
    Encryption(#[from] EncryptionError),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("invalid provider response: {0}")]
    InvalidResponse(String),
    #[error("refresh token missing in response")]
    MissingRefreshToken,
}

#[derive(Clone)]
pub struct OAuthAccountService {
    repo: Arc<dyn UserOAuthTokenRepository>,
    encryption_key: Arc<Vec<u8>>,
    client: Arc<Client>,
    google: OAuthProviderConfig,
    microsoft: OAuthProviderConfig,
}

impl OAuthAccountService {
    pub fn new(
        repo: Arc<dyn UserOAuthTokenRepository>,
        encryption_key: Arc<Vec<u8>>,
        client: Arc<Client>,
        settings: &OAuthSettings,
    ) -> Self {
        Self {
            repo,
            encryption_key,
            client,
            google: settings.google.clone(),
            microsoft: settings.microsoft.clone(),
        }
    }

    pub fn google_scopes(&self) -> &'static str {
        "openid email profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile"
    }

    pub fn microsoft_scopes(&self) -> &'static str {
        "offline_access User.Read"
    }

    pub async fn save_authorization(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
        tokens: AuthorizationTokens,
    ) -> Result<StoredOAuthToken, OAuthAccountError> {
        let encrypted_access = encrypt_secret(&self.encryption_key, &tokens.access_token)?;
        let encrypted_refresh = encrypt_secret(&self.encryption_key, &tokens.refresh_token)?;

        let stored = self
            .repo
            .upsert_token(NewUserOAuthToken {
                user_id,
                provider,
                access_token: encrypted_access,
                refresh_token: encrypted_refresh,
                expires_at: tokens.expires_at,
                account_email: tokens.account_email.clone(),
            })
            .await?;

        Ok(StoredOAuthToken {
            provider,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: stored.expires_at,
            account_email: stored.account_email,
        })
    }

    pub async fn list_tokens(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<StoredOAuthToken>, OAuthAccountError> {
        let records = self.repo.list_tokens_for_user(user_id).await?;
        records
            .into_iter()
            .map(|record| self.decrypt_record(record))
            .collect()
    }

    pub async fn ensure_valid_access_token(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<StoredOAuthToken, OAuthAccountError> {
        let record = self
            .repo
            .find_by_user_and_provider(user_id, provider)
            .await?
            .ok_or(OAuthAccountError::NotFound)?;

        let mut decrypted = self.decrypt_record(record.clone())?;
        let now = OffsetDateTime::now_utc();
        if decrypted.expires_at <= now + Duration::seconds(60) {
            let refreshed = self
                .refresh_access_token(provider, &decrypted.refresh_token)
                .await?;
            decrypted.access_token = refreshed.access_token.clone();
            decrypted.refresh_token = refreshed.refresh_token.clone();
            decrypted.expires_at = refreshed.expires_at;

            let encrypted_access = encrypt_secret(&self.encryption_key, &refreshed.access_token)?;
            let encrypted_refresh = encrypt_secret(&self.encryption_key, &refreshed.refresh_token)?;

            let updated = self
                .repo
                .upsert_token(NewUserOAuthToken {
                    user_id,
                    provider,
                    access_token: encrypted_access,
                    refresh_token: encrypted_refresh,
                    expires_at: refreshed.expires_at,
                    account_email: record.account_email,
                })
                .await?;
            decrypted.expires_at = updated.expires_at;
            decrypted.account_email = updated.account_email;
        }

        Ok(decrypted)
    }

    pub async fn delete_tokens(
        &self,
        user_id: Uuid,
        provider: ConnectedOAuthProvider,
    ) -> Result<(), OAuthAccountError> {
        if let Some(existing) = self
            .repo
            .find_by_user_and_provider(user_id, provider)
            .await?
        {
            let decrypted = self.decrypt_record(existing)?;
            let _ = self
                .revoke_refresh_token(provider, &decrypted.refresh_token)
                .await;
        }
        self.repo.delete_token(user_id, provider).await?;
        Ok(())
    }

    pub async fn exchange_authorization_code(
        &self,
        provider: ConnectedOAuthProvider,
        code: &str,
    ) -> Result<AuthorizationTokens, OAuthAccountError> {
        match provider {
            ConnectedOAuthProvider::Google => self.exchange_google_code(code).await,
            ConnectedOAuthProvider::Microsoft => self.exchange_microsoft_code(code).await,
        }
    }

    async fn exchange_google_code(
        &self,
        code: &str,
    ) -> Result<AuthorizationTokens, OAuthAccountError> {
        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            #[serde(default)]
            refresh_token: Option<String>,
            expires_in: Option<i64>,
        }

        #[derive(Deserialize)]
        struct UserInfoResponse {
            email: Option<String>,
        }

        let response: TokenResponse = self
            .client
            .post(GOOGLE_TOKEN_URL)
            .form(&[
                ("code", code),
                ("client_id", self.google.client_id.as_str()),
                ("client_secret", self.google.client_secret.as_str()),
                ("redirect_uri", self.google.redirect_uri.as_str()),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let refresh_token = response
            .refresh_token
            .ok_or(OAuthAccountError::MissingRefreshToken)?;
        let expires_in = response.expires_in.unwrap_or(3600);
        let expires_at = OffsetDateTime::now_utc() + Duration::seconds(expires_in.into());

        let user_info: UserInfoResponse = self
            .client
            .get(GOOGLE_USERINFO_URL)
            .bearer_auth(&response.access_token)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let email = user_info
            .email
            .ok_or_else(|| OAuthAccountError::InvalidResponse("Missing email".into()))?;

        Ok(AuthorizationTokens {
            access_token: response.access_token,
            refresh_token,
            expires_at,
            account_email: email,
        })
    }

    async fn exchange_microsoft_code(
        &self,
        code: &str,
    ) -> Result<AuthorizationTokens, OAuthAccountError> {
        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            #[serde(default)]
            refresh_token: Option<String>,
            expires_in: Option<i64>,
        }

        #[derive(Deserialize)]
        struct UserInfoResponse {
            #[serde(rename = "mail")]
            mail: Option<String>,
            #[serde(rename = "userPrincipalName")]
            user_principal_name: Option<String>,
        }

        let response: TokenResponse = self
            .client
            .post(MICROSOFT_TOKEN_URL)
            .form(&[
                ("client_id", self.microsoft.client_id.as_str()),
                ("client_secret", self.microsoft.client_secret.as_str()),
                ("code", code),
                ("redirect_uri", self.microsoft.redirect_uri.as_str()),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let refresh_token = response
            .refresh_token
            .ok_or(OAuthAccountError::MissingRefreshToken)?;
        let expires_in = response.expires_in.unwrap_or(3600);
        let expires_at = OffsetDateTime::now_utc() + Duration::seconds(expires_in.into());

        let user_info: UserInfoResponse = self
            .client
            .get(MICROSOFT_USERINFO_URL)
            .bearer_auth(&response.access_token)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let email = user_info
            .mail
            .or(user_info.user_principal_name)
            .ok_or_else(|| OAuthAccountError::InvalidResponse("Missing account email".into()))?;

        Ok(AuthorizationTokens {
            access_token: response.access_token,
            refresh_token,
            expires_at,
            account_email: email,
        })
    }

    pub async fn refresh_access_token(
        &self,
        provider: ConnectedOAuthProvider,
        refresh_token: &str,
    ) -> Result<AuthorizationTokens, OAuthAccountError> {
        match provider {
            ConnectedOAuthProvider::Google => self.refresh_google_token(refresh_token).await,
            ConnectedOAuthProvider::Microsoft => self.refresh_microsoft_token(refresh_token).await,
        }
    }

    async fn refresh_google_token(
        &self,
        refresh_token: &str,
    ) -> Result<AuthorizationTokens, OAuthAccountError> {
        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            expires_in: Option<i64>,
            #[serde(default)]
            refresh_token: Option<String>,
        }

        let response: TokenResponse = self
            .client
            .post(GOOGLE_TOKEN_URL)
            .form(&[
                ("client_id", self.google.client_id.as_str()),
                ("client_secret", self.google.client_secret.as_str()),
                ("refresh_token", refresh_token),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let new_refresh = response
            .refresh_token
            .unwrap_or_else(|| refresh_token.to_string());
        let expires_in = response.expires_in.unwrap_or(3600);
        let expires_at = OffsetDateTime::now_utc() + Duration::seconds(expires_in.into());

        Ok(AuthorizationTokens {
            access_token: response.access_token,
            refresh_token: new_refresh,
            expires_at,
            account_email: String::new(),
        })
    }

    async fn refresh_microsoft_token(
        &self,
        refresh_token: &str,
    ) -> Result<AuthorizationTokens, OAuthAccountError> {
        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            expires_in: Option<i64>,
            #[serde(default)]
            refresh_token: Option<String>,
        }

        let response: TokenResponse = self
            .client
            .post(MICROSOFT_TOKEN_URL)
            .form(&[
                ("client_id", self.microsoft.client_id.as_str()),
                ("client_secret", self.microsoft.client_secret.as_str()),
                ("refresh_token", refresh_token),
                ("grant_type", "refresh_token"),
                ("redirect_uri", self.microsoft.redirect_uri.as_str()),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let new_refresh = response
            .refresh_token
            .unwrap_or_else(|| refresh_token.to_string());
        let expires_in = response.expires_in.unwrap_or(3600);
        let expires_at = OffsetDateTime::now_utc() + Duration::seconds(expires_in.into());

        Ok(AuthorizationTokens {
            access_token: response.access_token,
            refresh_token: new_refresh,
            expires_at,
            account_email: String::new(),
        })
    }

    async fn revoke_refresh_token(
        &self,
        provider: ConnectedOAuthProvider,
        refresh_token: &str,
    ) -> Result<(), OAuthAccountError> {
        let response = match provider {
            ConnectedOAuthProvider::Google => {
                self.client
                    .post(GOOGLE_REVOCATION_URL)
                    .form(&[("token", refresh_token)])
                    .send()
                    .await?
            }
            ConnectedOAuthProvider::Microsoft => {
                self.client
                    .post(MICROSOFT_REVOCATION_URL)
                    .form(&[
                        ("token", refresh_token),
                        ("token_type_hint", "refresh_token"),
                        ("client_id", self.microsoft.client_id.as_str()),
                    ])
                    .send()
                    .await?
            }
        };

        if response.status() == StatusCode::OK || response.status() == StatusCode::NO_CONTENT {
            Ok(())
        } else {
            Err(OAuthAccountError::InvalidResponse(format!(
                "Failed to revoke token: {}",
                response.status()
            )))
        }
    }

    fn decrypt_record(
        &self,
        record: UserOAuthToken,
    ) -> Result<StoredOAuthToken, OAuthAccountError> {
        let access_token = decrypt_secret(&self.encryption_key, &record.access_token)?;
        let refresh_token = decrypt_secret(&self.encryption_key, &record.refresh_token)?;
        Ok(StoredOAuthToken {
            provider: record.provider,
            access_token,
            refresh_token,
            expires_at: record.expires_at,
            account_email: record.account_email,
        })
    }

    #[cfg(test)]
    pub fn test_stub() -> Arc<Self> {
        use async_trait::async_trait;

        struct StubRepo;

        #[async_trait]
        impl UserOAuthTokenRepository for StubRepo {
            async fn upsert_token(
                &self,
                _new_token: NewUserOAuthToken,
            ) -> Result<UserOAuthToken, sqlx::Error> {
                Err(sqlx::Error::RowNotFound)
            }

            async fn find_by_user_and_provider(
                &self,
                _user_id: Uuid,
                _provider: ConnectedOAuthProvider,
            ) -> Result<Option<UserOAuthToken>, sqlx::Error> {
                Ok(None)
            }

            async fn delete_token(
                &self,
                _user_id: Uuid,
                _provider: ConnectedOAuthProvider,
            ) -> Result<(), sqlx::Error> {
                Ok(())
            }

            async fn list_tokens_for_user(
                &self,
                _user_id: Uuid,
            ) -> Result<Vec<UserOAuthToken>, sqlx::Error> {
                Ok(vec![])
            }
        }

        let repo = Arc::new(StubRepo) as Arc<dyn UserOAuthTokenRepository>;
        let key = Arc::new(vec![0u8; 32]);
        let client = Arc::new(Client::new());
        let settings = OAuthSettings {
            google: OAuthProviderConfig {
                client_id: "stub".into(),
                client_secret: "stub".into(),
                redirect_uri: "http://localhost".into(),
            },
            microsoft: OAuthProviderConfig {
                client_id: "stub".into(),
                client_secret: "stub".into(),
                redirect_uri: "http://localhost".into(),
            },
            token_encryption_key: vec![0u8; 32],
        };
        Arc::new(Self::new(repo, key, client, &settings))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::oauth_token_repository::{NewUserOAuthToken, UserOAuthTokenRepository};
    use async_trait::async_trait;
    use sqlx::Error;

    struct InMemoryRepo;

    #[async_trait]
    impl UserOAuthTokenRepository for InMemoryRepo {
        async fn upsert_token(
            &self,
            _new_token: NewUserOAuthToken,
        ) -> Result<UserOAuthToken, sqlx::Error> {
            Err(Error::RowNotFound)
        }

        async fn find_by_user_and_provider(
            &self,
            _user_id: Uuid,
            _provider: ConnectedOAuthProvider,
        ) -> Result<Option<UserOAuthToken>, sqlx::Error> {
            Ok(None)
        }

        async fn delete_token(
            &self,
            _user_id: Uuid,
            _provider: ConnectedOAuthProvider,
        ) -> Result<(), sqlx::Error> {
            Ok(())
        }

        async fn list_tokens_for_user(
            &self,
            _user_id: Uuid,
        ) -> Result<Vec<UserOAuthToken>, sqlx::Error> {
            Ok(vec![])
        }
    }

    #[tokio::test]
    async fn scopes_are_exposed() {
        let client = Arc::new(Client::new());
        let repo = Arc::new(InMemoryRepo);
        let key = Arc::new(vec![0u8; 32]);
        let settings = OAuthSettings {
            google: OAuthProviderConfig {
                client_id: "id".into(),
                client_secret: "secret".into(),
                redirect_uri: "http://localhost".into(),
            },
            microsoft: OAuthProviderConfig {
                client_id: "id".into(),
                client_secret: "secret".into(),
                redirect_uri: "http://localhost".into(),
            },
            token_encryption_key: vec![0u8; 32],
        };
        let service = OAuthAccountService::new(repo, key, client, &settings);
        assert!(service.google_scopes().contains("email"));
        assert!(service.microsoft_scopes().contains("offline_access"));
    }
}
