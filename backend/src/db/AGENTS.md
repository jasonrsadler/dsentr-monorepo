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

## Change Reasons
- Added workspace connection repositories and shared-token helpers for promoting OAuth credentials into workspaces.
 - Extended `UserRepository` with Stripe customer tracking: `get_user_stripe_customer_id` and `set_user_stripe_customer_id`, and updated `PostgresUserRepository` queries and the `User` model to include an optional `stripe_customer_id` column.
 - Introduced billing helpers: `find_user_id_by_stripe_customer_id` to map Stripe customer IDs back to local users for webhook processing, and `clear_pending_checkout_with_error` to atomically clear `settings.billing.pending_checkout` while recording `last_error`/`last_error_at` for frontend retry UX.
 - Test support: `MockDb` now tracks `update_user_plan` call count to assert that plan mutations do not occur during checkout initiation and do occur in webhook success/failure flows.

- Added `workspace_id` (nullable) to `user_oauth_tokens` and propagated it through `UserOAuthToken` and `NewUserOAuthToken`.
  - Repository reads/writes for personal tokens now enforce `workspace_id IS NULL` to avoid cross-scope leakage.
  - Introduced ownership helpers at the service layer; `WorkspaceOAuthService::load_token` now rejects non-owned or non-personal tokens with a 403 (Forbidden) response.
  - `PostgresUserOAuthTokenRepository` uses `query_as::<_, UserOAuthToken>` bindings for these queries to avoid churn in SQLx offline artifacts while the schema evolves.
