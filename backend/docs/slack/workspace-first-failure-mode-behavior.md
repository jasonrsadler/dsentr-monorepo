## Failure Semantics and Runtime Slack Identity Contract

This section defines (1) failure-mode behavior (block vs degrade), (2) cleanup and retry rules, and (3) a binding identity resolution contract that frontend, backend routes, and engine execution must all enforce consistently.

---

## Definitions

Identities:
- Workspace bot identity: Slack bot token stored on the workspace Slack connection (anchored by `slack_team_id`).
- Personal user identity: Slack user token stored on a personal OAuth token record (deduped by Slack user id), linked to a workspace Slack connection via `slack_team_id`.

Connection IDs:
- `workspaceSlackConnectionId`: the Dsentr workspace connection id representing the Slack workspace install.
- `personalSlackConnectionId`: the Dsentr personal OAuth connection id representing a user’s delegated Slack authorization.

Scopes:
- `scope=workspace`: use workspace bot identity.
- `scope=personal`: use personal user identity (still requires workspace context for team validation).

---

## Failure Mode Matrix

For each failure mode, define:
- Block: stop request or execution with a deterministic error.
- Degrade: allow limited behavior without silently switching identities.

### 1) Workspace install missing

Scenario:
- User tries Slack actions/channels without any Slack workspace connection installed.

Applies to:
- Channel listing
- Bot-post actions
- Personal-post actions (because personal auth must link to a workspace install)

Behavior:
- Block.

User-facing error:
- "Slack is not installed for this workspace. Install Slack to the workspace first."

Cleanup:
- None.

Retry:
- Retry after install.

Telemetry:
- event: `slack.workspace_install_missing`
- fields: workspace_id, requested_operation, route_or_action

---

### 2) Personal auth missing post-install

Scenario:
- Workspace Slack install exists, user selects “post as user” or requests user-scoped channels but has not authorized personally.

Applies to:
- Post-as-user execution
- Any user-identity-only operation

Behavior:
- Block.

User-facing error:
- "Authorize Slack for yourself to post as you."

Cleanup:
- None.

Retry:
- Retry after personal authorization.

Telemetry:
- event: `slack.personal_auth_missing`
- fields: workspace_id, slack_team_id, user_id, requested_operation

---

### 3) Slack app revoked or tokens invalid

Scenario:
- Slack returns token invalid, invalid_auth, account_inactive, token_revoked, or similar.

Applies to:
- Workspace bot token
- Personal user token

Behavior:
- Block for the affected identity.
- No identity fallback. Do not switch bot to user or user to bot implicitly.

User-facing error:
- If workspace bot: "Slack workspace connection requires reconnect."
- If personal user: "Your Slack authorization requires reconnect."

Cleanup:
- Mark the specific connection stale:
  - Workspace: set requiresReconnect and/or expires_at forced expired; preserve `slack_team_id`.
  - Personal: revoke and/or mark token stale; preserve identity metadata for debugging.

Retry:
- Requires reconnect flow for that identity:
  - Workspace reinstall reconnects bot identity.
  - Personal reconnect reauthorizes user identity.

Telemetry:
- event: `slack.token_revoked_or_invalid`
- fields: workspace_id, slack_team_id, identity_type(workspace|personal), user_id(optional), slack_error_code

---

### 4) Missing required scopes

Scenario:
- Slack API call fails with missing_scope or insufficient_scope.

Applies to:
- Any Slack API call requiring newly added bot scopes or user scopes.

Behavior:
- Block.
- Provide actionable scope guidance. No fallback.

User-facing error:
- "Slack app is missing required scopes. Reinstall Slack to the workspace to grant updated permissions."
- For personal scope missing: "Reauthorize Slack for yourself to grant updated permissions."

Cleanup:
- Mark identity as requiresReconnect if the missing scopes indicate the current install cannot succeed without reauth.

Retry:
- Reinstall (workspace) or reauthorize (personal) depending on identity.

Telemetry:
- event: `slack.missing_scopes`
- fields: workspace_id, slack_team_id, identity_type, required_scopes(if known), slack_error_code

---

### 5) Stale Dsentr linkage or mismatched Slack team.id

Scenario:
- Personal token slack_team_id does not match workspace connection slack_team_id.
- Or request attempts to use a personal token against a different workspace Slack connection/team.

Applies to:
- Channel listing with both ids
- Execution with both ids
- Any operation requiring team alignment

Behavior:
- Block.
- Never attempt to “fix” by guessing correct ids.

User-facing error:
- "Slack authorization belongs to a different Slack workspace. Authorize Slack for yourself for this workspace."

Cleanup:
- None automatically.
- Optionally prompt user to disconnect the mismatched personal auth in settings.

Retry:
- User must authorize personal Slack against the current workspace Slack install.

Telemetry:
- event: `slack.team_mismatch`
- fields: workspace_id, workspace_slack_team_id, personal_slack_team_id, user_id, requested_operation

---

### 6) Multiple workspace Slack connections detected

Scenario:
- Data inconsistency during migration: multiple workspace Slack connections exist for same Dsentr workspace, or selection ambiguous.

Applies to:
- Routes that accept provider-only without explicit workspace connection id
- Execution that tries to infer workspace connection

Behavior:
- Block.
- Require explicit workspaceSlackConnectionId, and migration should remove duplicates.

User-facing error:
- "Multiple Slack workspace connections exist. Select a specific Slack connection."

Cleanup:
- None at runtime. This is a data migration/ops issue.

Retry:
- After selecting explicit id (short-term) or after dedupe migration (preferred).

Telemetry:
- event: `slack.workspace_connection_ambiguous`
- fields: workspace_id, count, connection_ids(if safe)

---

## Cleanup and Retry Rules

General:
- Do not auto-switch identities.
- Do not auto-promote.
- Do not auto-create workspace connections during personal auth.
- Only mark the specific failing identity as stale/reconnect-required.

Workspace bot identity cleanup:
- On token revoked/invalid/missing scopes: mark workspace connection as requiresReconnect.
- Preserve slack_team_id for stable identity and migration safety.

Personal user identity cleanup:
- On token revoked/invalid/missing scopes: mark personal token as requiresReconnect or delete token if your existing semantics require deletion.
- Do not mutate workspace connection tokens on personal failures.

Retries:
- Workspace failures: reinstall/reconnect workspace Slack install.
- Personal failures: user reauthorizes personal Slack.

---

## Binding Runtime Identity Resolution Contract

This contract must be enforced consistently across:
- Frontend (node config + channel fetch)
- Backend routes (slack channels endpoints)
- Engine execution (send_slack / Slack action runtime)

### Required Inputs

For any Slack operation, requests must include:
- `workspace_id` (implicit via auth/session + route path) and
- `workspaceSlackConnectionId` (explicit, always required)

Additionally, if using personal identity:
- `personalSlackConnectionId` (explicit)

### Valid Combinations

1) Workspace bot operation:
- Required: workspaceSlackConnectionId
- Forbidden: personalSlackConnectionId
- Scope: workspace

2) Personal user operation:
- Required: workspaceSlackConnectionId AND personalSlackConnectionId
- Scope: personal
- Additional validation: personal.slack_team_id must equal workspace.slack_team_id

### Invalid Combinations (must hard-fail)

- Missing workspaceSlackConnectionId (always invalid)
- Both workspace and personal ids provided for a workspace bot operation
- Personal operation without personalSlackConnectionId
- Personal operation without a workspaceSlackConnectionId context
- Mismatched slack_team_id between workspace and personal identities
- Any attempt to use webhook-only execution without explicit identity selection

### Identity Selection Rules

Frontend:
- SlackAction config must persist an explicit identity choice:
  - `identity = workspace_bot | personal_user`
- Backend parameters must be emitted deterministically based on identity.
- No auto-defaulting to bot or user based on token presence.

Backend routes:
- Reject requests without explicit workspaceSlackConnectionId.
- Reject requests that provide both ids when route expects one identity.
- Validate workspace membership.
- Validate team alignment on personal operations.

Engine:
- Resolve connection usage only from explicit ids and stored identity selection.
- Enforce the same validity rules as above.
- Do not use incoming_webhook_url as an implicit shortcut. If webhooks remain temporarily supported, they must be an explicit identity mode (separate from bot/user), and must still require a workspaceSlackConnectionId.

---

## Error Shape Expectations (Contract)

Responses must clearly state:
- identity_type: `workspace_bot` or `personal_user`
- reason_code: stable machine-readable string (e.g., `workspace_install_missing`, `personal_auth_missing`, `team_mismatch`, `requires_reconnect`, `missing_scopes`)
- user_message: actionable text
- requires_reconnect: boolean (when applicable)

This prevents UI guesswork and prevents silent fallbacks.

---

## Completion Criteria

This section is complete when:
- Every listed failure mode has an explicit block/degrade rule.
- Cleanup actions are identity-scoped and non-propagating.
- Frontend, backend, and engine can implement the same identity contract without ambiguity.
