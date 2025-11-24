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

### 2025-11-07 — HMAC verification update
- Reason: Previous verification logic required `_dsentr_ts`/`_dsentr_sig` in the JSON body and computed the HMAC over a payload that included the signature itself, making client-side signing impractical. This also diverged from the Settings note that recommends header-based auth.
- Change: `webhook_trigger` now supports header-based HMAC and fixes JSON-body verification.
  - Preferred (recommended): headers `X-DSentr-Timestamp` and `X-DSentr-Signature: v1=<hex>` are accepted. The server verifies `HMAC_SHA256(signing_key, "<ts>.<canonical_json_body>")` where `canonical_json_body` is the minified body as parsed by `serde_json`.
  - Legacy compatibility: if headers are absent, the server will read `_dsentr_ts`/`_dsentr_sig` from the JSON body and verify the same payload, but it will first remove `_dsentr_ts` and `_dsentr_sig` keys from the body before computing the signature.
  - Replay protection and window enforcement remain unchanged.
- Added `POST /api/workflows/:id/webhook/signing-key/regenerate` so admins can rotate the derived signing key (and webhook token) without visiting the token endpoint explicitly. Response returns both the new key and URL for UI refreshes.

Operational notes:
- Token validation is still required and occurs before HMAC verification.
- The allowlist injection into the run snapshot is unchanged.
- Keep the Settings help text aligned with the header-based flow above.

## Usage Tips
- Always call `AppState::resolve_plan_tier` before performing plan-gated operations; helpers assume it was run.
- Responses use `JsonResponse` for errors; return structured JSON (`success`, payload) for success cases.
- When modifying workflow data, invoke `sync_secrets_from_workflow` so new secrets propagate to the user's secret store.
- Workflow run APIs and worker schedules now enforce workspace run quotas (10k runs/month) via the shared limit helpers, returning the `workspace_run_limit` response code when the allocation is exhausted.
- Workspace run caps respect the `WORKSPACE_MONTHLY_RUN_LIMIT` configuration so deployments can raise/lower allocations without code changes.

## Change Reasons
- Workflow run endpoints now treat solo-plan workspaces as solo for quota gating, avoiding workspace-plan errors and adding regression coverage for the `/run` path.
- Plan usage endpoint now returns personal/solo usage when a workspace query targets a non-Workspace plan so solo workspaces don't receive 403 errors.
- Workflow run execution now hydrates secrets for scheduled and webhook-triggered runs while responses (run listings, downloads, and webhook acknowledgements) redact sensitive fields so plaintext API keys are never returned to clients.
- Workflow helper tests populate `stripe_overage_item_id` on workspace fixtures so billing overage schema updates compile across plan usage helpers.
