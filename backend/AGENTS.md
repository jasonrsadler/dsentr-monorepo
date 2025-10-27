# Backend Agent Notes

## Context
- The backend is a Rust Axum service backed by SQLx + PostgreSQL with async execution via Tokio.
- We expose workflow execution endpoints and persistence, so schema or API changes must remain backward compatible unless explic
itly coordinated.

## Required Practices
- Run `cargo fmt` and `SQLX_OFFLINE=true cargo clippy --all-targets --all-features` before committing backend changes.
- Add or update integration/unit tests (`SQLX_OFFLINE=true cargo test`) whenever modifying request handlers, data models, or migrations.
- Prefer strongly typed structures and avoid `unwrap`/`expect` in production paths—propagate errors with `Result` and `thiserror
`/`anyhow` patterns as appropriate.
- App is run by using `cargo run --features tls` or just `cargo run` for non-ssl
- Updated offline database for tests with `cargo sqlx prepare -- --manifest-path ./Cargo.toml --all-targets`

## Change Reasons
- Workspace membership listing now accepts viewer roles so the Members settings tab can display roster data without forcing a workspace switch.
- Added workspace OAuth connection removal flow so admins can revoke shared credentials without deleting personal tokens.
- Added Stripe configuration scaffolding so billing integrations can access shared credentials and webhook secrets at startup.
