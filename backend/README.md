# Dsentr Backend

This directory contains the backend API and workflow execution system for Dsentr. It handles authentication, workspace management, workflow execution, logging, billing, and all server-side logic.

## Stack

- Rust with Axum
- SQLx with PostgreSQL
- Tokio runtime
- Tower middleware
- Serde for serialization
- Tracing for structured logs

## Features

- Session-based authentication with database-backed sessions
- Multi-tenant workspace model
- OAuth provider integrations
- Workflow execution engine and worker pipeline
- Run logging and error handling
- Billing, quotas, and subscription enforcement
- Encrypted secret storage
- Environment-driven configuration

## Setup

```
cp .env.template .env
```

Set values for:

```
DATABASE_URL=postgres://user:pass@localhost:5432/dsentr
SESSION_SECRET=base64-encoded-48-byte-secret
API_SECRETS_ENCRYPTION_KEY=base64-encoded-32-byte-key
```

Generate keys as needed:

```
openssl rand -base64 48
openssl rand -base64 32
```

Run migrations:

```
sqlx migrate run
```

Start the server:

```
cargo run
```

## Testing

```
cargo test
```

Integration tests require a database configured through the env values.

## Structure

- `src/routes` HTTP handlers
- `src/services` business logic and orchestration
- `src/db` repositories and database models
- `src/engine` workflow execution engine
- `src/worker` background run processing
- `src/utils` helpers for auth, secrets, validation, and responses
- `migrations/` SQL migrations for SQLx

## License

This component is licensed under the Business Source License 1.1.  
See `LICENSE` in this directory for details.
