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

## Change Reasons
- Introduced workspace OAuth service for cloning encrypted tokens into workspace-level connections and emitting audit events.
- Hardened workspace OAuth removal: `WorkspaceOAuthService::remove_connection` now enforces that only the connection creator can unshare a personal OAuth token, returning `403 Forbidden` when a different workspace admin attempts removal.
- WorkspaceOAuthService now includes a purge helper plus unit tests so membership removals can revoke shared credentials, mark personal tokens unshared, and record audit events consistently.
- WorkspaceOAuthService now receives `WorkspaceRepository` so it can call the new `is_member` check before decrypting shared credentials; `get_connection`, `promote_connection`, and removal flows enforce membership with new unit tests covering success and `403 Forbidden` cases.
- Documented workspace membership invariants: all removal/leave/Solo-conversion flows in `workspace_service.rs` and `routes/workspaces.rs` must invoke the purge helper so shared workspace credentials disappear alongside the member, and every workspace token fetch (routes + engine actions via `engine/actions/mod.rs`) now performs a `workspace_repo.is_member` guard that surfaces a `403 Forbidden` before touching OAuth tokens when the actor is no longer a member.
- WorkspaceOAuthService test doubles now implement the shared `get_plan` helper so future plan-aware logic can exercise the service without depending on route-only enums.
