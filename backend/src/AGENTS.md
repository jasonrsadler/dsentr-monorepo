# Backend `src` Agent Notes

## Purpose
- Root of the Rust backend crate. Houses the binary entrypoint, dependency wiring, and shared helpers.

## Key Files
- `main.rs`: Axum bootstrap. Loads `Config`, builds Postgres pools and repository trait objects, wires rate limiting layers, and mounts every HTTP route. TLS support is feature gated via `tls`.
- `config.rs`: Reads required environment variables (DB URL, frontend origin, OAuth credentials, encryption key) and decodes the token encryption key with `utils::encryption::decode_key`.
- `state.rs`: Defines `AppState`, the shared application context passed to handlers. Provides `resolve_plan_tier` helper with tests using the mock repositories.
  - Extended to include `stripe: Arc<dyn StripeService>` so routes and workers can access billing functionality. Tests and helpers construct `AppState` with the mock service.
- `responses.rs`: Thin wrappers around JSON responses and redirect helpers used by routes. Includes tests to lock down status codes and payloads.
- `utils` re-export happens via `pub mod utils;` so downstream modules can use helper functions without long paths.

## Usage Tips
- When adding new dependencies that need to be shared across handlers, extend `AppState` and initialize them in `main.rs`.
  - Stripe integration: initialize `LiveStripeService::from_settings(&config.stripe)` in `main.rs` and pass it into `AppState`.
- Keep the trait object cloning cheap; prefer `Arc<dyn Trait>` and guard stateful clients (HTTP, DB pools) behind `Arc`.
- Follow existing rate-limiter patterns when wiring new route groups to avoid opening the API to abuse.

## Change Reasons
- AppState now wires workspace OAuth promotion repositories/services for shared connection APIs.
- Workflow run execution now records connection metadata and emits run events from routes, workers, and the engine.
- Config now exposes Stripe credentials so downstream services can initialize billing integrations without bespoke env parsing.
 - Introduced `StripeService` into `AppState` to centralize Stripe usage. Live service is created from `Config.stripe`; tests use `MockStripeService`. This keeps construction uniform and avoids per-handler instantiation.
- Hardened executor event persistence against FK violations from deleted workspace connections. The executor now:
  - Warn-logs when a referenced `connection_id` is missing.
  - Records a fallback run event with `connection_id = NULL` and `connection_type = "connection_missing"` to preserve audit ordering.
  - Avoids crashing the worker loop on these nonfatal persistence errors.
- `main.rs` now passes the workspace repository into `WorkspaceOAuthService` (and the AppState test builders mirror it) so membership checks run before decrypting shared workspace OAuth tokens.
- AppState exposes workspace member and run quota helpers (with rollback tickets) so routes/workers can consistently enforce seat caps and monthly run allocations.
- AppState now syncs/clears workspace billing cycle metadata (subscription id plus current period start/end) and run quota checks consume those persisted anchors instead of hardcoding calendar-month resets.
- Added unit coverage for workspace quota period calculations so billing-aligned run windows roll over at the correct boundary even when the current clock is past the stored cycle.
- Added a dedicated `API_SECRETS_ENCRYPTION_KEY` path (and rotation tooling) for encrypting settings secrets separately from OAuth tokens.
- Workspace member/run limits now load from `WORKSPACE_MEMBER_LIMIT` and `WORKSPACE_MONTHLY_RUN_LIMIT` with validation, and AppState uses these config values when enforcing quotas.
- Workspace run quota checks now return `None` for solo-plan workspaces so run handlers can apply solo limits without blocking execution behind workspace-only gating.
- Workspace overage billing now records Stripe subscription item ids and reports metered usage for over-limit workspace runs without impacting solo plans.
- Workspace overage reporting now emits Stripe billing meter events (using the configured meter event name and the workspace owner's Stripe customer id) instead of legacy usage records.
- Main bootstrap now mounts the authenticated issue-report submission route so support tickets are captured alongside existing API groups.
- AppState wires a Stripe event log repository so webhook handlers can record processed event ids for idempotent billing flows.
- Runaway workflow protection is configurable via `RUNAWAY_LIMIT_5MIN` and a per-workspace user setting so routes/workers can block runaway run creation with a dedicated error code.
- Workflow routing now includes workspace workflow SSE and optimistic concurrency handling so stale saves return 409 and live edits stream to collaborators.
- Introduced the admin router plumbing (AppState wiring stays shared) with an IP-allowlist stub and issue thread replies persisted for support conversations.
- CORS now honors `ADMIN_ORIGIN` so the admin portal can run on a separate host alongside the main frontend.
