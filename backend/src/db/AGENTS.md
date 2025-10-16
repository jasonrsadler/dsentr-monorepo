# DB Agent Notes

## Purpose
- Repository traits and their SQLx-backed implementations for users, workspaces, workflows, and connected OAuth tokens.
- Provides in-memory test doubles (`mock_db.rs`) so route/service tests can run without touching Postgres.

## Modules
- `user_repository.rs`: trait surface for all user/account operations (signup, password reset, plan upgrades, settings).
- `workflow_repository.rs`: async trait covering workflow CRUD, run management, scheduling, dead-letter handling, and webhook utilities. Some rarely used methods are intentionally left unimplemented in mocks.
- `workspace_repository.rs`: trait for workspace CRUD, membership management, and invitation flows.
- `oauth_token_repository.rs`: trait + `NewUserOAuthToken` DTO for storing encrypted OAuth connection tokens.
- `postgres_*_repository.rs`: SQLx implementations of the above traits. Every method uses `query!`/`query_as!` macros for compile-time checked SQL.
- `mock_db.rs`: default struct implementing `UserRepository` plus `NoopWorkflowRepository` and `NoopWorkspaceRepository` for tests.
- `mod.rs`: re-exports to simplify `use crate::db::*` paths.

## Usage Tips
- Keep trait signatures exhaustive; services depend on these abstractions rather than concrete Postgres types.
- When adding new queries, use the SQLx macros so compile-time checking stays intact—remember to run `cargo sqlx prepare` if the project relies on it.
- Extend `MockDb` and the `Noop*Repository` helpers when writing tests that need to assert persistence behavior without a database.
