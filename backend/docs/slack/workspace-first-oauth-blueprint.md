# Slack Workspace-First OAuth Blueprint

## Purpose
Define the canonical, workspace-first Slack OAuth model. This document is normative. Behavior not described here is unsupported.

---

## Current vs Target Flow

### Current (legacy)
- Mixed implicit auth paths.
- Account inference and fallback guessing.
- Tokens reused across users and workspaces.
- Limited auditability of identity decisions.

### Target (workspace-first)
- One Slack app install per Slack workspace.
- Workspace bot token stored as WorkspaceConnection.
- Optional delegated user tokens stored per user.
- Explicit identity selection at execution time.
- No implicit fallback or guessing.

---

## Invariants
- Every Slack execution is bound to a Dsentr workspace and a Slack team.id.
- Workspace bot identity always exists for Slack-enabled workspaces.
- Delegated user identity is optional and never replaces the workspace install.
- Identity selection is explicit and deterministic.
- Tokens are never shared across workspaces.
- Missing or mismatched team.id blocks execution.
- No raw tokens, emails, or inferred identities are accepted at runtime.

---

## Legacy Behaviors and Non-Goals

### Deprecated / removed
- Implicit token fallback.
- accountEmail-based identity inference.
- Raw token configuration.
- Cross-workspace token reuse.

### Non-goals
- Slack trigger parity with full bot frameworks.
- Multiple Slack app installs per workspace.
- Silent degradation that hides auth failures.
- Backward compatibility with undocumented behavior.

---

## Migration and Rollout
- Introduce workspace-first model behind feature flag.
- Backfill Slack team.id on existing connections.
- Detect legacy connections and mark read-only.
- Force explicit identity selection on edit.
- Remove legacy execution paths after cutover window.
- Surface clear admin warnings during migration.

---

## Failure Semantics
- Block execution when invariants are violated.
- Degrade only when explicitly allowed and observable.
- Never auto-switch identities.
- Persist token revocation on Slack invalid_auth responses.
- User-facing errors map to stable error codes.

---

## Runtime Identity Contract

### Required inputs
- workspace_id
- slack_team_id
- node_id
- requested_identity_type
- connection_id (workspace or user, depending on identity)

### Identity types
- workspace_bot
- delegated_user
- incoming_webhook

### Invalid combinations
- delegated_user without workspace install.
- delegated_user token with mismatched slack_team_id.
- incoming_webhook without explicit connection object.
- Mixed workspace and user tokens in one execution.

### Resolution rules
- Identity is resolved once per node execution.
- Required scopes must be satisfied by selected identity.
- Resolution decision is logged on success and failure.

---

## Telemetry, Logging, and Audit
See section: Telemetry, Logging, and Audit (Slack workspace-first).

This section defines:
- Audit events for installs, auth, revocation, and invariant violations.
- Operational logs for identity selection and Slack API calls.
- Metrics for installs, failures, identity usage, and latency.

Event names, fields, and emission points are contracts.

---

## Approval Checklist

### Invariants
- [ ] All invariants listed and referenced.
- [ ] No section contradicts an invariant.

### Runtime identity contract
- [ ] Required inputs defined.
- [ ] Invalid combinations explicitly listed.
- [ ] Backend vs engine responsibilities clear.

### Failure semantics
- [ ] Block vs degrade rules unambiguous.
- [ ] Error codes stable and mapped.

### Migration and rollout
- [ ] Legacy paths explicitly sunset.
- [ ] Backfill and detection steps defined.
- [ ] No silent behavior changes.

### Telemetry and audit
- [ ] All state changes audited.
- [ ] All runtime decisions logged.
- [ ] Correlation fields consistent.

### Legacy behaviors and non-goals
- [ ] Deprecated behaviors clearly marked.
- [ ] Non-goals explicit and upheld.

---

## Status
Blueprint complete. Ready for stakeholder review and sign-off.
