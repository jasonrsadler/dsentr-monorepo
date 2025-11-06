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
- Updated `.env.template` placeholders to reference SECURITY.md and vault-managed secrets, reducing the risk of reusing committed credentials.

## Change Reasons
- Added pluggable app email delivery with environment-controlled provider selection (`EMAIL_PROVIDER`). Supports `smtp` and `sendgrid` for signup, password reset, invites, and account notifications. This accommodates hosts that disallow outbound SMTP while preserving SMTP for environments that support it.
- Workflow node email behavior is unchanged: nodes using SMTP still send via runtime SMTP configuration and are not affected by the app-level provider switch.

## App Email Delivery
- Environment variables:
  - `EMAIL_PROVIDER`: `smtp` (default) or `sendgrid`.
  - `EMAIL_FROM`: Sender for API-based providers; falls back to `SMTP_FROM` if unset.
  - `SENDGRID_API_KEY`: Required when `EMAIL_PROVIDER=sendgrid`.
- When `EMAIL_PROVIDER=smtp`:
  - Uses existing `SMTP_*` variables and the Lettre transport.
- When `EMAIL_PROVIDER=sendgrid`:
  - Sends app emails via SendGrid HTTP API. SMTP env vars are not required to boot.
  - Workflow nodes that choose SMTP continue to send using per-node SMTP settings.
