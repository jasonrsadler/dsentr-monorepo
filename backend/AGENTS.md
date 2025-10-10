# Backend Agent Notes

## Context
- The backend is a Rust Axum service backed by SQLx + PostgreSQL with async execution via Tokio.
- We expose workflow execution endpoints and persistence, so schema or API changes must remain backward compatible unless explic
itly coordinated.

## Required Practices
- Run `cargo fmt` and `cargo clippy --all-targets --all-features` before committing backend changes.
- Add or update integration/unit tests (`cargo test`) whenever modifying request handlers, data models, or migrations.
- Prefer strongly typed structures and avoid `unwrap`/`expect` in production paths—propagate errors with `Result` and `thiserror
`/`anyhow` patterns as appropriate.
