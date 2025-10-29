use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
};
use axum_extra::extract::cookie::CookieJar;

use crate::routes::auth::claims::{Claims, TokenUse};
use crate::utils::jwt::{decode_jwt, JwtKeyProvider};

#[derive(Debug, PartialEq)]
pub struct AuthSession(pub Claims);

impl<S> FromRequestParts<S> for AuthSession
where
    S: Send + Sync + JwtKeyProvider,
{
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let jar = CookieJar::from_headers(&parts.headers);
        let token = jar.get("auth_token").ok_or(StatusCode::UNAUTHORIZED)?;

        let token_data = decode_jwt(
            token.value(),
            state.jwt_keys(),
            state.jwt_issuer(),
            state.jwt_audience(),
        )
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

        if token_data.claims.token_use != TokenUse::Access {
            return Err(StatusCode::UNAUTHORIZED);
        }

        Ok(AuthSession(token_data.claims))
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        extract::FromRequestParts,
        http::{header, HeaderMap, Method, Request, StatusCode},
    };
    use axum_extra::extract::cookie::Cookie;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::routes::auth::claims::TokenUse;
    use crate::routes::auth::session::AuthSession;
    use crate::{
        models::user::UserRole,
        routes::auth::claims::Claims,
        utils::jwt::{create_jwt, JwtKeyProvider, JwtKeys},
    };

    use std::sync::Arc;

    #[derive(Clone)]
    struct StubState {
        keys: Arc<JwtKeys>,
        issuer: String,
        audience: String,
    }

    impl StubState {
        fn new(keys: Arc<JwtKeys>) -> Self {
            Self {
                keys,
                issuer: "test-issuer".to_string(),
                audience: "test-audience".to_string(),
            }
        }
    }

    impl JwtKeyProvider for StubState {
        fn jwt_keys(&self) -> &JwtKeys {
            self.keys.as_ref()
        }

        fn jwt_issuer(&self) -> &str {
            &self.issuer
        }

        fn jwt_audience(&self) -> &str {
            &self.audience
        }
    }

    fn test_keys() -> Arc<JwtKeys> {
        Arc::new(
            JwtKeys::from_secret("0123456789abcdef0123456789abcdef")
                .expect("test JWT secret should be valid"),
        )
    }

    fn make_valid_jwt(keys: &JwtKeys, issuer: &str, audience: &str) -> String {
        let claims = Claims {
            id: "user_id_123".into(),
            email: "test@example.com".into(),
            first_name: "Test".into(),
            last_name: "User".into(),
            role: Some(UserRole::User),
            plan: Some("free".into()),
            company_name: Some("Acme Inc".into()),
            exp: (SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs()
                + 3600) as usize,
            iss: String::new(),
            aud: String::new(),
            token_use: TokenUse::Access,
        };
        create_jwt(claims, keys, issuer, audience).expect("JWT should create successfully")
    }

    #[tokio::test]
    async fn test_valid_token_extracted() {
        let keys = test_keys();
        let stub_state = StubState::new(keys.clone());
        let jwt = make_valid_jwt(
            keys.as_ref(),
            stub_state.jwt_issuer(),
            stub_state.jwt_audience(),
        );
        let cookie = Cookie::new("auth_token", jwt);

        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            header::HeaderValue::from_str(&cookie.to_string()).unwrap(),
        );

        let request = Request::builder()
            .method(Method::GET)
            .uri("/")
            .header(header::COOKIE, cookie.to_string())
            .body(())
            .unwrap();

        let mut parts = request.into_parts().0;
        let state = stub_state;
        let result = AuthSession::from_request_parts(&mut parts, &state).await;

        assert!(result.is_ok());
        let session = result.unwrap();
        assert_eq!(session.0.email, "test@example.com");
        assert_eq!(session.0.role, Some(UserRole::User));
    }

    #[tokio::test]
    async fn test_missing_cookie_returns_unauthorized() {
        let request = Request::builder()
            .method(Method::GET)
            .uri("/")
            .body(())
            .unwrap();

        let mut parts = request.into_parts().0;
        let state = StubState::new(test_keys());
        let result = AuthSession::from_request_parts(&mut parts, &state).await;

        assert_eq!(result, Err(StatusCode::UNAUTHORIZED));
    }

    #[tokio::test]
    async fn test_invalid_token_returns_unauthorized() {
        let cookie = Cookie::new("auth_token", "invalid.token.here");

        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            header::HeaderValue::from_str(&cookie.to_string()).unwrap(),
        );

        let request = Request::builder()
            .method(Method::GET)
            .uri("/")
            .header(header::COOKIE, cookie.to_string())
            .body(())
            .unwrap();

        let mut parts = request.into_parts().0;
        let state = StubState::new(test_keys());
        let result = AuthSession::from_request_parts(&mut parts, &state).await;

        assert_eq!(result, Err(StatusCode::UNAUTHORIZED));
    }

    #[tokio::test]
    async fn test_refresh_token_type_rejected() {
        let keys = test_keys();
        let claims = Claims {
            id: "user_id_123".into(),
            email: "test@example.com".into(),
            first_name: "Test".into(),
            last_name: "User".into(),
            role: Some(UserRole::User),
            plan: Some("free".into()),
            company_name: None,
            exp: (SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs()
                + 3600) as usize,
            iss: String::new(),
            aud: String::new(),
            token_use: TokenUse::Refresh,
        };
        let state = StubState::new(keys.clone());
        let jwt = create_jwt(
            claims,
            keys.as_ref(),
            state.jwt_issuer(),
            state.jwt_audience(),
        )
        .expect("token");

        let cookie = Cookie::new("auth_token", jwt);

        let request = Request::builder()
            .method(Method::GET)
            .uri("/")
            .header(header::COOKIE, cookie.to_string())
            .body(())
            .unwrap();

        let mut parts = request.into_parts().0;
        let result = AuthSession::from_request_parts(&mut parts, &state).await;

        assert_eq!(result, Err(StatusCode::UNAUTHORIZED));
    }

    #[tokio::test]
    async fn test_expired_token_returns_unauthorized() {
        let keys = test_keys();
        let state = StubState::new(keys.clone());
        let claims = Claims {
            id: "user_id_123".into(),
            email: "test@example.com".into(),
            first_name: "Test".into(),
            last_name: "User".into(),
            role: Some(UserRole::User),
            plan: None,
            company_name: None,
            exp: (SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs()
                - 60) as usize,
            iss: String::new(),
            aud: String::new(),
            token_use: TokenUse::Access,
        };

        let jwt = create_jwt(
            claims,
            keys.as_ref(),
            state.jwt_issuer(),
            state.jwt_audience(),
        )
        .expect("token");

        let cookie = Cookie::new("auth_token", jwt);
        let request = Request::builder()
            .method(Method::GET)
            .uri("/")
            .header(header::COOKIE, cookie.to_string())
            .body(())
            .unwrap();

        let mut parts = request.into_parts().0;
        let result = AuthSession::from_request_parts(&mut parts, &state).await;
        assert_eq!(result, Err(StatusCode::UNAUTHORIZED));
    }

    #[tokio::test]
    async fn test_mismatched_issuer_returns_unauthorized() {
        let keys = test_keys();
        let state = StubState::new(keys.clone());
        let jwt = make_valid_jwt(keys.as_ref(), "wrong-issuer", state.jwt_audience());
        let cookie = Cookie::new("auth_token", jwt);

        let request = Request::builder()
            .method(Method::GET)
            .uri("/")
            .header(header::COOKIE, cookie.to_string())
            .body(())
            .unwrap();

        let mut parts = request.into_parts().0;
        let result = AuthSession::from_request_parts(&mut parts, &state).await;
        assert_eq!(result, Err(StatusCode::UNAUTHORIZED));
    }

    #[tokio::test]
    async fn test_mismatched_audience_returns_unauthorized() {
        let keys = test_keys();
        let state = StubState::new(keys.clone());
        let jwt = make_valid_jwt(keys.as_ref(), state.jwt_issuer(), "other-aud");
        let cookie = Cookie::new("auth_token", jwt);

        let request = Request::builder()
            .method(Method::GET)
            .uri("/")
            .header(header::COOKIE, cookie.to_string())
            .body(())
            .unwrap();

        let mut parts = request.into_parts().0;
        let result = AuthSession::from_request_parts(&mut parts, &state).await;
        assert_eq!(result, Err(StatusCode::UNAUTHORIZED));
    }
}
