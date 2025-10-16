# Workflow Routes Agent Notes

## Purpose
- REST + SSE surface for building, executing, and monitoring workflows.
- All handlers assume authenticated access via `AuthSession` and rely on `AppState` repositories/services.

## Module Overview
- `prelude.rs`: Shared imports/types (Axum extractors, serde aliases, plan helpers).
- `helpers.rs`: Utility functions for plan enforcement, diffing workflow JSON, syncing schedules/secrets, and SQL error helpers.
- `crud.rs`: Create/read/update/delete workflows with plan-tier enforcement and automatic schedule/secret synchronization.
- `runs.rs`: Start, cancel, rerun workflows; fetch run lists/status; download run snapshots.
- `concurrency.rs`: Adjust per-workflow concurrency limits with plan checks.
- `logs.rs`: List, delete, or clear workflow log entries.
- `dead_letters.rs`: Manage dead-letter queue entries (list, requeue, clear).
- `egress.rs`: Manage webhook/egress allowlists and blocked event history.
- `plan.rs`: Surfaces usage metrics for the current plan tier.
- `sse.rs`: Server-sent-event endpoints streaming run updates (global, per workflow, per run).
- `webhooks.rs`: Public webhook trigger endpoint plus helper APIs to rotate tokens or toggle webhook security settings.

## Usage Tips
- Always call `AppState::resolve_plan_tier` before performing plan-gated operations; helpers assume it was run.
- Responses use `JsonResponse` for errors; return structured JSON (`success`, payload) for success cases.
- When modifying workflow data, invoke `sync_secrets_from_workflow` so new secrets propagate to the user's secret store.
