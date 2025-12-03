# Migrations Agent Notes

## Purpose
- Raw SQL migrations executed with the SQLx CLI or manual `psql` sessions.
- Files are applied in lexicographic order; keep timestamps consistent to avoid ordering surprises.

## Layout
- `1 - init.sql`: bootstraps the database (enables `pgcrypto`, creates `dsentr`, and defines the earliest user/auth tables). Run manually when standing up a new environment.
- `2025_05_*`: early access and authentication flow tables (email verification, password reset, signup metadata, user roles/enums).
- `2025_09_*` & `2025_10_*`: workflow engine schema (workflows, runs, node runs, schedules, dead letters, webhook replays, egress block events) plus concurrency/security columns and helper triggers.
- `2025_10_14_*` to `2025_10_17_*`: workspace and organization lifecycle (memberships, invites, deprecating legacy workspace-team linkage).
- `2025_10_11_1_create_user_oauth_tokens.sql`: persistence for connected OAuth integrations.
- `2025_05_23_add_oauth_type_to_users.sql` & `2025_9_16_add_oauth_enum_email.sql`: align user auth tables with OAuth providers.

## Usage Tips
- Never edit an existing migration after it ships; create a new timestamped file instead.
- For destructive changes, include companion rollback notes at the end of the file so emergency rollbacks are obvious.
- When adding new SQL files, ensure they end with a newline and are idempotent where practical—tests rely on rerunning migrations against scratch databases.
- Workspace lifecycle tables now expect:
  - `workspaces.owner_id` to mirror the current owner (separate from the original `created_by` author), `plan` as the workspace plan slug (`solo`, `workspace`, etc.), and `deleted_at` soft-delete tracking.
  - `workspace_invitations.status` constrained to `pending`, `accepted`, `revoked`, or `declined`, with `token` enforced as globally unique.
  - `workspace_member_audit` rows capturing `workspace_id`, `member_id`, `actor_id`, normalized `action` text, optional `reason`, and an automatic `recorded_at` timestamp for membership changes.

## Rollback Template
- Every forward migration **must** close with a guidance block that starts with `-- Rollback:`. List the exact statements (or referenced prior files) needed to undo the change and call out irreversible data loss when relevant.
- Example snippet to copy into new files:
  ```sql
  -- Rollback:
  --   DROP INDEX IF EXISTS example_idx;
  --   ALTER TABLE example DROP COLUMN IF EXISTS new_column;
  --   -- If the change cannot be reversed cleanly, note the manual steps or follow-up migrations required.
  ```
- Keep the notes concise but explicit enough that an on-call engineer can execute the steps without reading surrounding git history.

## Change Reasons
- Added workspace connection and audit event migration to back shared OAuth token promotion.
- Added owner/token metadata to `workspace_connections` plus a composite uniqueness constraint so multiple shared credentials per provider can coexist without colliding on `(workspace_id, provider)`.
- Added `workspace_run_usage` table to track monthly per-workspace run counts with indexed period windows so plan quota enforcement can atomically increment without race conditions.
- Added `workspace_billing_cycles` to capture each workspace's Stripe subscription id plus current period start/end so run quota resets can track the actual billing window instead of calendar months.
- Added `stripe_overage_item_id` to `workspaces` so metered Stripe subscription items can be stored for overage usage reporting.
- Added `issue_reports` table with workspace/user metadata fields so support submissions persist to the database for follow-up.
- Added `stripe_event_log` table to persist processed Stripe webhook ids for idempotent delivery handling.
- Added `issue_report_messages` plus `issue_reports.status/updated_at` to support admin/user reply threads without rewriting existing submissions.
- Added read-tracking columns and indexes for `issue_report_messages` so user/admin inboxes can badge unread replies accurately.
- Added `resume_at` to `workflow_runs` (with index) so Delay nodes can pause runs and resume later without holding worker leases.
