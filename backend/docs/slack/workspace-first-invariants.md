# Slack workspace-first OAuth invariants

This document defines the invariants for the “workspace-first Slack OAuth” model in Dsentr. It references the current-state analysis in backend/docs/slack/workspace-first-current-state.md and does not propose implementation details beyond feasibility notes and required assumptions.

## Definitions

- Dsentr workspace: A Dsentr tenant workspace.
- Slack team: A Slack workspace identified by Slack team.id.
- Workspace Slack connection: A Dsentr workspace-scoped Slack OAuth connection that holds the bot token and Slack team identity.
- Personal Slack connection: A user-scoped Slack OAuth token that represents a Slack user identity (for “post as user”).
- Identity selection: The explicit choice of which Slack identity a node/run uses (workspace bot vs personal user).

## Invariants

### I1. One Slack workspace connection per Dsentr workspace per Slack team.id
There must be at most one workspace Slack connection for a given (dsentr_workspace_id, slack_team_id).

Implications:
- Installing Slack to the Dsentr workspace creates or reuses this single workspace Slack connection.
- The system must reject a second workspace Slack install for the same Slack team.id in the same Dsentr workspace, or treat it as a reconnect that updates the existing workspace Slack connection.

Feasibility against current state:
- Workspace connections already store slack_team_id and can be constrained by a unique index.
- Current code allows multiple Slack workspace connections and does not consistently validate slack_team_id. This invariant requires schema enforcement plus stricter lookups.

### I2. Workspace install precedes personal authorization for “post as user”
A Dsentr workspace must have a workspace Slack connection installed before any user can authorize Slack personally for use within that Dsentr workspace.

Implications:
- The UX must be “Install Slack to workspace” first, then “Authorize Slack for yourself.”
- Personal Slack authorization must be bound to an existing workspace Slack connection context.

Feasibility against current state:
- Current OAuth routes allow personal Slack connect without a workspace context.
- This requires Slack connect/start/callback to support an explicit workspace install path and to reject personal Slack auth when no workspace Slack connection exists for that Dsentr workspace.

Open question:
- Do we allow a personal Slack token to exist “globally” (not tied to a Dsentr workspace) for future linking, or do we require the workspace context always? This model assumes workspace context is required.

### I3. Personal Slack tokens dedupe by Slack user id only
Personal Slack tokens must dedupe by Slack user id (provider_user_id), not by email. Email is not a stable or unique identity anchor for Slack.

Implications:
- If a user re-authorizes Slack and the Slack user id matches an existing personal Slack token for that provider, update that same token (preserve connection id).
- If the user id differs, create a new personal token (even if email matches).

Feasibility against current state:
- Current dedupe prefers provider_user_id but can fall back to email.
- For Slack, email fallback must be disabled. Slack exchange must reliably capture Slack user id.

### I4. Personal Slack tokens must be linked to Slack team.id for workspace use
A personal Slack token is only valid for a Dsentr workspace Slack installation when its slack_team_id matches the workspace Slack connection’s slack_team_id.

Implications:
- Channel listing, node configuration, and execution must validate slack_team_id alignment between:
  - selected workspace Slack connection (bot identity)
  - selected personal Slack connection (user identity)
- Cross-team usage must be rejected with a clear error.

Feasibility against current state:
- slack_team_id is stored in workspace connections; personal token metadata already stores team_id.
- Current execution and routes do not strictly validate team alignment, so this invariant requires adding validation at API and engine boundaries.

### I5. No webhook promotion/fallback semantics
Slack incoming webhooks are not a special-case identity mechanism. The runtime must not implicitly choose a webhook path based on webhook presence.

Implications:
- If incoming webhooks remain supported, treat them as an explicit connection type or explicit mode, not an automatic shortcut.
- “Workspace bot” actions must use the workspace Slack OAuth token path, not silently use incoming_webhook_url.

Feasibility against current state:
- Current engine has an incoming_webhook_url short-circuit for workspace connections.
- This requires removing the implicit shortcut and either deprecating webhook-only mode or making webhook usage an explicit selection.

Open question:
- Do we keep webhook-only posting as an explicit non-OAuth connection type, or do we deprecate it entirely for Slack? This model assumes no implicit webhook fallback; explicit webhook support can be decided separately.

### I6. Workspace bot tokens are immutable with respect to personal reconnects
A user reconnecting or updating their personal Slack token must not overwrite the workspace Slack connection’s bot token.

Implications:
- Token propagation from personal token updates to workspace connections is forbidden for Slack.
- Workspace Slack connection token refresh/reconnect must occur only through the workspace Slack connection path.

Feasibility against current state:
- Current dedup save path can propagate updated tokens to workspace connections by source token id.
- For Slack, this propagation must be disabled or split by scope to avoid overwriting workspace tokens.

### I7. Explicit identity selection at runtime is mandatory
Every Slack action execution must specify which identity it uses:
- workspace bot (workspace connection id)
- personal user (personal connection id, plus workspace context)

Implications:
- No inference based on “available tokens,” provider defaults, webhook presence, or prior selections.
- Node configuration must persist identity choice and validate required connection ids before save.

Feasibility against current state:
- Engine already requires explicit connectionScope + connectionId in many places, but the UI still exposes implicit/legacy options.
- Routes and engine must reject missing identity inputs and reject invalid combinations (both ids supplied, neither supplied, mismatched team ids).

### I8. Slack promotion is not a concept in the workspace-first model
Slack does not use personal to workspace promotion semantics. Workspace install creates the workspace Slack connection directly. Personal auth only creates personal tokens linked for “post as user.”

Implications:
- Any “Promote to workspace” UI/actions for Slack must be removed.
- Backend promotion endpoints must reject Slack provider.

Feasibility against current state:
- Promotion exists historically and has Slack-specific behavior (webhook clearing, shared flags).
- This requires a deliberate removal or hard-blocking of Slack promotion paths.

## Consistency checks

- I1 + I2 + I7 are consistent: one workspace Slack connection exists and identity choice selects either that bot connection or a personal token tied to the same team.
- I3 + I4 avoid ambiguous dedupe: Slack user id anchors personal identity, team id anchors workspace compatibility.
- I5 + I7 remove implicit paths: execution behavior becomes predictable and auditable.
- I6 avoids token clobbering: workspace bot token lifecycle is isolated from personal token lifecycle.

## Required assumptions and gaps

1. Slack OAuth exchange must reliably return Slack user id and Slack team.id for all relevant flows. If any path does not provide these, it must be rejected or fixed.
2. Dsentr must store slack_team_id for both workspace Slack connections and personal Slack tokens (metadata). Missing values must be treated as invalid.
3. UI must remove any manual token or webhook fallback options that bypass explicit identity selection.
4. Backfill and dedupe migrations are required if existing data violates I1 or lacks slack_team_id.

## Open questions for sign-off

1. Multi-team per Dsentr workspace: Do we support connecting multiple Slack team.id values to one Dsentr workspace? This invariant set assumes “one team per workspace” for now.
2. Incoming webhooks: Keep as explicit legacy-only connection type, or remove entirely?
3. Channel listing: Do we allow channel listing for personal tokens, or only through workspace bot with optional personal context? Workspace-first suggests workspace bot drives listing, personal is only for “post as user.”
4. Reconnect semantics: On workspace reconnect, do we treat it as updating the existing workspace Slack connection or create-and-replace? Invariant I1 suggests update-in-place.

## Acceptance criteria for this document

- Invariants are explicit and testable.
- Each invariant states feasibility impact against current behavior.
- Open questions are enumerated for product/engineering sign-off.
