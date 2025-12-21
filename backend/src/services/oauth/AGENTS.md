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
- Workspace OAuth handling now keeps per-connection records keyed by connection ID: promotions always insert new rows without pruning other members, removal/unshare only clears personal tokens when no other workspace connections exist for that provider, and token retrieval helpers consume explicit connection IDs so callers can manage multiple shared integrations safely.
- WorkspaceOAuthService test doubles now stub the new workspace quota/billing methods and membership defaults so the expanded repository trait compiles cleanly across routes, services, and mocks.
- Workspace OAuth service tests implement the new overage subscription item accessors on workspace repositories so billing schema changes compile without affecting OAuth behavior.
 - Added Asana OAuth provider configuration and token handling so Asana connections can be exchanged, refreshed, revoked, and promoted like other providers.
 - Slack OAuth handling now encrypts and stores team, bot, and incoming webhook metadata on workspace connections only, keeping webhook URLs out of API responses while enabling webhook posting.
- Slack webhook metadata from the initial OAuth exchange is now encrypted into personal token metadata immediately, reused during workspace promotion (without relying on refresh responses), and cleared from the personal record after promotion to avoid retaining webhook secrets longer than needed.
- Personal/workspace OAuth services now insert new records for fresh installs, expose connection-id aware refresh/revoke/disconnect helpers, and ensure Slack metadata updates are stored per connection with dedicated tests.
- Workspace token unshare checks now ignore stale workspace connection rows with `user_oauth_token_id = NULL` by using `WorkspaceConnectionRepository::find_by_source_token(token_id)` when a token id is available.
- OAuth service test doubles were refactored to satisfy `cargo clippy -D warnings` by avoiding over-eager iterator cloning and introducing small type aliases for recorded call tuples.
- Workspace OAuth promotion now stamps workspace connections with the source personal `connection_id` so API listings can return stable identities.
- OAuth reconnect saves now dedupe by provider user id (email fallback only), preserve connection ids on updates, and propagate refreshed tokens to workspace connections without touching insert flows.
