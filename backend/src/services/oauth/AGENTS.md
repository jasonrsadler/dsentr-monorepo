# OAuth Services Agent Notes

## Purpose
- Encapsulate OAuth token lifecycle management and provider-specific API helpers used by routes and workflow actions.

## Key Modules
- `account_service.rs`: High-level orchestrator. Exchanges authorization codes, encrypts/decrypts tokens, refreshes access tokens, and persists them via `UserOAuthTokenRepository`.
- `mod.rs`: Re-exports account service plus provider-specific modules (`github`, `google`).
- `github/` & `google/`: Contain HTTP clients, response models, error types, service traits, and mock implementations for interacting with provider APIs beyond generic OAuth (e.g., fetching user info or Google Sheets access).

## Usage Tips
- Always call `OAuthAccountService::ensure_valid_access_token` before making provider API calls; it transparently refreshes tokens when expired.
- Encryption utilities expect a 32-byte key from `Config`; do not bypass them when storing secrets.
- Use the mock modules when unit testing routes or engine actions to avoid external HTTP calls.
