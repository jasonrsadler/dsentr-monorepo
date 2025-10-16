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
