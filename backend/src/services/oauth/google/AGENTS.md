# Google OAuth Agent Notes

## Purpose
- Provides the Google OAuth login/connect implementation used by auth routes and account linking.

## Modules
- `service.rs`: Trait abstraction (`GoogleOAuthService`) returning access tokens and user info.
- `client.rs`: Production implementation that exchanges codes and fetches user info using env-configured endpoints.
- `errors.rs`: Enumerates recoverable failures (state validation, HTTP, DB).
- `mock_google_oauth.rs`: Deterministic mock for tests.
- `mod.rs`: Re-exports submodules.

## Usage Tips
- Ensure `GOOGLE_ACCOUNTS_OAUTH_TOKEN_CLIENT_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` are set before using `GoogleOAuthClient`.
- User info fetch returns raw `serde_json::Value`; downstream callers should validate required fields (`email`, `name`) before persistence.
