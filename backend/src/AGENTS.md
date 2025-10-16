# Backend `src` Agent Notes

## Purpose
- Root of the Rust backend crate. Houses the binary entrypoint, dependency wiring, and shared helpers.

## Key Files
- `main.rs`: Axum bootstrap. Loads `Config`, builds Postgres pools and repository trait objects, wires rate limiting layers, and mounts every HTTP route. TLS support is feature gated via `tls`.
- `config.rs`: Reads required environment variables (DB URL, frontend origin, OAuth credentials, encryption key) and decodes the token encryption key with `utils::encryption::decode_key`.
- `state.rs`: Defines `AppState`, the shared application context passed to handlers. Provides `resolve_plan_tier` helper with tests using the mock repositories.
- `responses.rs`: Thin wrappers around JSON responses and redirect helpers used by routes. Includes tests to lock down status codes and payloads.
- `utils` re-export happens via `pub mod utils;` so downstream modules can use helper functions without long paths.

## Usage Tips
- When adding new dependencies that need to be shared across handlers, extend `AppState` and initialize them in `main.rs`.
- Keep the trait object cloning cheap; prefer `Arc<dyn Trait>` and guard stateful clients (HTTP, DB pools) behind `Arc`.
- Follow existing rate-limiter patterns when wiring new route groups to avoid opening the API to abuse.
