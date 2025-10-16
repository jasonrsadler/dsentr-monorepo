# SMTP Mailer Agent Notes

## Purpose
- Abstract email delivery so routes and services can send messages without binding to a specific transport.

## Modules
- `mod.rs`: Defines the `Mailer` trait, mailer errors, TLS enum, config struct, and re-exports the mock implementation for tests.
- `smtp_impl.rs`: Production `SmtpMailer` built on Lettre async transport. Reads SMTP credentials from env vars and supports runtime-configurable TLS modes. Also respects per-request overrides (`send_email_with_config`).
- `mock_mailer.rs`: Recording mock that stores sent emails in memory for assertions.

## Usage Tips
- `SmtpMailer::new` expects `SMTP_*` env vars; prefer creating it once in `main.rs` and sharing via `AppState`.
- When adding new email templates, keep the helper methods in `smtp_impl.rs` simple—template rendering is handled earlier in the call stack.
