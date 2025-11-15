# OAuth Routes Agent Notes

## Purpose
- Manage connected OAuth integrations (Google, Microsoft) for workflow actions.
- Implements both the authorization-code handshake and account-management APIs.

## Key Modules
- `prelude.rs`: Common `use` imports (Axum extractors, AppState, ConnectedOAuthProvider, etc.) re-exported for sibling modules.
- `helpers.rs`: Shared constants and utilities—state cookie helpers, provider parsing, redirect builders, and error mapping.
- `connect.rs`: `/oauth/{provider}/connect` start + callback endpoints. Exchanges authorization codes and persists tokens via `OAuthAccountService`.
- `accounts.rs`: Authenticated APIs to list, refresh, and disconnect stored connections.
- `tests.rs`: End-to-end tests that validate the helper utilities and account flows.
- `mod.rs`: Re-exports the public handlers used in `main.rs`.

## Usage Tips
- Always validate the returned `state` parameter before exchanging codes; reuse `build_state_cookie`/`clear_state_cookie`.
- When adding new providers, extend `ConnectedOAuthProvider`, update `parse_provider`/`provider_to_key`, and build new connect handlers following the existing pattern.
- Redirects back to the frontend include query flags—coordinate expected parameters with the UI before changing them.

## Change Reasons
- Accounts: Listing connections now requires an explicit `workspace` query parameter and verifies membership via `workspace_repo.list_memberships_for_user` before proceeding. This prevents cross-workspace leakage and aligns with workspace context routing elsewhere.
- Accounts: Workspace connections are fetched with `WorkspaceConnectionRepository::list_for_workspace(workspace_id)` instead of a user-membership scan. The handler asserts all returned rows match the requested workspace and returns 403 on any violation.
- Accounts: Added a defensive ownership assertion for personal tokens by cross-checking repository lookups for the authenticated `user_id` and provider before serializing the response. Violations return 403 and are logged.
- OAuth route tests implement the new WorkspaceRepository::is_member helper so WorkspaceOAuthService membership checks work inside the test harness.
- Workspace OAuth tests now cover the shared `get_plan` repository helper so plan-aware services can reuse the mocks without referring back to route modules.
