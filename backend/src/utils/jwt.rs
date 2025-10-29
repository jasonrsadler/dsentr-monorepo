use std::{collections::HashSet, env};

use crate::routes::auth::claims::Claims;
use jsonwebtoken::{
    decode, encode, errors::Error, errors::ErrorKind, Algorithm, DecodingKey, EncodingKey, Header,
    TokenData, Validation,
};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

/// Minimum acceptable size for the JWT secret in bytes.
pub const MIN_JWT_SECRET_LENGTH: usize = 32;
/// Minimum number of unique bytes expected for the JWT secret to avoid trivially guessable values.
const MIN_UNIQUE_JWT_BYTES: usize = 8;

#[derive(Debug, Error)]
pub enum JwtSecretError {
    #[error("JWT_SECRET must be set")]
    Missing,
    #[error("JWT_SECRET must be at least {required} bytes, but {actual} bytes were provided")]
    TooShort { actual: usize, required: usize },
    #[error(
        "JWT_SECRET must contain sufficient entropy (at least {required} unique bytes); only {actual} unique bytes found"
    )]
    LowEntropy { actual: usize, required: usize },
}

#[derive(Clone)]
pub struct JwtKeys {
    encoding: EncodingKey,
    decoding: DecodingKey,
}

impl std::fmt::Debug for JwtKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JwtKeys").finish_non_exhaustive()
    }
}

impl JwtKeys {
    pub fn from_env() -> Result<Self, JwtSecretError> {
        let value = env::var("JWT_SECRET").map_err(|_| JwtSecretError::Missing)?;
        Self::from_secret(value)
    }

    pub fn from_secret(secret: impl AsRef<[u8]>) -> Result<Self, JwtSecretError> {
        let bytes = secret.as_ref();
        validate_secret(bytes)?;

        Ok(Self {
            encoding: EncodingKey::from_secret(bytes),
            decoding: DecodingKey::from_secret(bytes),
        })
    }

    pub fn encoding_key(&self) -> &EncodingKey {
        &self.encoding
    }

    pub fn decoding_key(&self) -> &DecodingKey {
        &self.decoding
    }
}

pub trait JwtKeyProvider {
    fn jwt_keys(&self) -> &JwtKeys;
    fn jwt_issuer(&self) -> &str;
    fn jwt_audience(&self) -> &str;
}

fn validate_secret(secret: &[u8]) -> Result<(), JwtSecretError> {
    if secret.len() < MIN_JWT_SECRET_LENGTH {
        return Err(JwtSecretError::TooShort {
            actual: secret.len(),
            required: MIN_JWT_SECRET_LENGTH,
        });
    }

    let unique = secret.iter().copied().collect::<HashSet<_>>().len();
    if unique < MIN_UNIQUE_JWT_BYTES {
        return Err(JwtSecretError::LowEntropy {
            actual: unique,
            required: MIN_UNIQUE_JWT_BYTES,
        });
    }

    Ok(())
}

pub fn create_jwt(
    mut claims: Claims,
    keys: &JwtKeys,
    issuer: &str,
    audience: &str,
) -> Result<String, Error> {
    claims.iss = issuer.to_owned();
    claims.aud = audience.to_owned();
    encode(&Header::default(), &claims, keys.encoding_key())
}

pub fn decode_jwt(
    token: &str,
    keys: &JwtKeys,
    issuer: &str,
    audience: &str,
) -> Result<TokenData<Claims>, Error> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_audience(&[audience]);
    validation.iss = Some(HashSet::from([issuer.to_owned()]));
    validation.validate_exp = true;
    validation.required_spec_claims.insert("exp".to_string());
    let data = decode::<Claims>(token, keys.decoding_key(), &validation)?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| Error::from(ErrorKind::InvalidToken))?
        .as_secs();

    if (data.claims.exp as u64) <= now {
        return Err(Error::from(ErrorKind::ExpiredSignature));
    }

    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::routes::auth::claims::Claims;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn valid_secret() -> &'static str {
        "0123456789abcdef0123456789abcdef"
    }

    #[test]
    fn rejects_short_secret() {
        let err = JwtKeys::from_secret("too-short").unwrap_err();
        assert!(matches!(
            err,
            JwtSecretError::TooShort {
                actual,
                required: MIN_JWT_SECRET_LENGTH
            } if actual < MIN_JWT_SECRET_LENGTH
        ));
    }

    #[test]
    fn rejects_low_entropy_secret() {
        let err = JwtKeys::from_secret("a".repeat(MIN_JWT_SECRET_LENGTH)).unwrap_err();
        assert!(matches!(
            err,
            JwtSecretError::LowEntropy {
                actual,
                required: _
            } if actual < MIN_UNIQUE_JWT_BYTES
        ));
    }

    #[test]
    fn accepts_valid_secret_and_round_trips() {
        let keys = JwtKeys::from_secret(valid_secret()).expect("secret should be accepted");
        let claims = Claims {
            id: "user-123".into(),
            email: "user@example.com".into(),
            first_name: "Jane".into(),
            last_name: "Doe".into(),
            role: None,
            plan: None,
            company_name: None,
            exp: (SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs()
                + 60) as usize,
            iss: String::new(),
            aud: String::new(),
            token_use: crate::routes::auth::claims::TokenUse::Access,
        };

        let token =
            create_jwt(claims.clone(), &keys, "issuer", "audience").expect("token should encode");
        let decoded = decode_jwt(&token, &keys, "issuer", "audience").expect("token should decode");
        assert_eq!(decoded.claims.email, claims.email);
    }
}
