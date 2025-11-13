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
