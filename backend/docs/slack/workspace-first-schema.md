## Migration and Rollout Plan

This section defines the database, service, and rollout strategy for transitioning Slack OAuth to a workspace-first model. The plan is explicitly staged to avoid partial breakage, ensure reversibility, and surface failures early.

---

## Schema and Index Changes

### Workspace Connection Uniqueness

Introduce a uniqueness constraint to enforce one Slack workspace connection per Dsentr workspace per Slack team.

Required changes:
- Add a non-null `slack_team_id` column to workspace Slack connection records if not already present.
- Add a unique index on `(workspace_id, provider = 'slack', slack_team_id)`.

Rationale:
This guarantees a single canonical workspace Slack connection per Slack team and removes ambiguity during execution and refresh.

---

## Slack team.id Backfill Strategy

### Source of Truth
Slack `team.id` is sourced from existing encrypted Slack metadata stored on:
- Workspace connections (preferred)
- Associated personal Slack tokens if workspace metadata is incomplete

### Backfill Steps
1. Scan all workspace Slack connections.
2. For each connection:
   - Extract `slack_team_id` from stored Slack metadata if present.
   - Otherwise, attempt to resolve via linked personal Slack token metadata.
3. Write `slack_team_id` to the workspace connection row.
4. Log any rows where `slack_team_id` cannot be resolved.

No new tokens are created.
No promotions or token rewrites occur during backfill.

---

## Migration Ordering and Rollout Checkpoints

### Checkpoint 1: Schema Preparation
Actions:
- Add nullable `slack_team_id` column if missing.
- Deploy code that reads but does not yet enforce uniqueness.

Verification:
- All Slack workspace connections load successfully.
- No runtime behavior changes.

Rollback:
- Safe. Column addition only.

---

### Checkpoint 2: Backfill Execution
Actions:
- Run backfill migration to populate `slack_team_id`.
- Emit logs for unresolved or duplicate cases.

Verification:
- 100 percent of active workspace Slack connections have a resolved `slack_team_id`, or are explicitly logged.
- No workspace connections deleted.

Rollback:
- Safe. Data is additive only.
- Column can be cleared if needed.

---

### Checkpoint 3: Duplicate Collapse
Actions:
- Identify duplicate workspace Slack connections with the same `(workspace_id, slack_team_id)`.
- Select a canonical row deterministically (most recently updated).
- Remove non-canonical duplicates with audit logging.

Verification:
- At most one Slack workspace connection exists per `(workspace_id, slack_team_id)`.
- No personal tokens are modified or deleted.

Rollback:
- Limited.
- Requires restoring deleted rows from backups or audit logs.
- Must be completed before enforcing uniqueness.

---

### Checkpoint 4: Constraint Enforcement
Actions:
- Apply unique index on `(workspace_id, provider, slack_team_id)`.
- Enforce `slack_team_id` as non-null for Slack workspace rows.

Verification:
- New Slack workspace installs fail if a connection already exists for the team.
- No duplicate insertions possible.

Rollback:
- Drop unique index.
- Keep backfilled data intact.

---

### Checkpoint 5: Service Gating
Actions:
- Enable workspace-first Slack logic in services and routes.
- Block Slack promotion paths.
- Require explicit workspace install before personal authorization.

Verification:
- Slack OAuth start rejects non-workspace installs.
- Personal Slack authorization requires an existing workspace Slack connection.
- No implicit promotion occurs.

Rollback:
- Disable feature gate.
- Leave schema intact.

---

## Feature Flags and Gating

Introduce a feature gate for:
- Workspace-first Slack OAuth enforcement
- Promotion path blocking
- Webhook fallback removal

The gate must default to disabled during backfill and enabled only after constraint enforcement.

---

## Failure and Rollback Strategy

### Backfill Failures
- Log unresolved Slack connections.
- Do not block rollout unless unresolved rows exceed an acceptable threshold.

### Constraint Failures
- Abort constraint creation.
- Investigate duplicate or malformed rows.
- Rerun backfill or collapse step.

### Service-Level Failures
- Disable workspace-first feature gate.
- Leave schema and data intact.
- No destructive rollback required.

---

## Data Safety Guarantees

- No personal Slack tokens are deleted during migration.
- No workspace tokens are overwritten.
- No execution paths are modified until service gating is enabled.
- All destructive actions are logged with sufficient identifiers for audit or recovery.

---

## Completion Criteria

This migration phase is complete when:
- Every Slack workspace connection has a valid `slack_team_id`.
- Exactly one workspace Slack connection exists per `(workspace_id, slack_team_id)`.
- Workspace-first Slack OAuth is gated on and promotion paths are unreachable.
