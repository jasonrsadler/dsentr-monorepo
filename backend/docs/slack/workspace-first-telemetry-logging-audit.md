## Telemetry, Logging, and Audit (Slack workspace-first)

### Scope and goals
Define required audit events, operational logs, and metrics for Slack workspace-first authentication and execution flows. This section is normative. Event names and fields are contracts.

Goals:
- Make identity decisions observable.
- Prove invariants and failure semantics are enforced.
- Support debugging, compliance, and user-facing audit trails.

Non-goals:
- Implementation code.
- Logging of secrets or raw Slack payloads.

---

### Principles
- Every auth and execution path emits:
  - One audit event (immutable, persisted, admin-visible) when state changes or invariants are violated.
  - One or more operational log events for debugging.
- Emit at boundaries only:
  - Backend: OAuth, connection persistence, token lifecycle, validation.
  - Engine: execution-time identity selection, Slack action execution.
  - Frontend: user intent and surfaced failures only.
- Correlate all events with correlation_id and runtime identifiers.
- Never log tokens, auth codes, webhook URLs, or full Slack payloads.

---

### Common event fields
Included on all events unless marked optional.

- ts (RFC3339)
- env (prod, staging, dev)
- correlation_id
- workspace_id (Dsentr workspace)
- slack_team_id
- slack_enterprise_id (optional)
- actor_type (user | system)
- actor_user_id (optional)
- identity_type (workspace_bot | delegated_user | incoming_webhook)
- outcome (success | failure | blocked | degraded)
- error_code (stable enum, optional)
- error_detail (short, sanitized, optional)
- scope_set (sorted list or hash)
- workspace_connection_id (optional)
- user_oauth_token_id (optional)
- workflow_id (optional)
- run_id (optional)
- node_id (optional)
- build_version (git sha)

---

### Stable error codes
- SLACK_OAUTH_EXCHANGE_FAILED
- SLACK_OAUTH_STATE_INVALID
- SLACK_TEAM_ID_MISSING
- SLACK_TEAM_ID_MISMATCH
- SLACK_WORKSPACE_INSTALL_MISSING
- SLACK_DELEGATED_TOKEN_MISSING
- SLACK_TOKEN_REFRESH_FAILED
- SLACK_TOKEN_REVOKE_FAILED
- SLACK_API_MISSING_SCOPE
- SLACK_API_NOT_IN_CHANNEL
- SLACK_API_CHANNEL_NOT_FOUND
- SLACK_API_RATE_LIMITED
- SLACK_API_INVALID_AUTH
- SLACK_API_ACCOUNT_INACTIVE
- SLACK_API_TOKEN_REVOKED
- SLACK_WEBHOOK_INVALID
- SLACK_IDENTITY_CONTRACT_INVALID

---

### Audit events (persisted)

#### audit.slack.workspace_install.created
- Trigger: successful workspace OAuth install
- Owner: backend
- Fields:
  - workspace_connection_id
  - slack_team_id, slack_enterprise_id
  - bot_user_id (optional)
  - incoming_webhook_present (bool)
  - scope_set
  - installer_user_id
- Outcome: success

#### audit.slack.workspace_install.updated
- Trigger: workspace connection updated (scopes changed, token rotated)
- Owner: backend
- Fields:
  - workspace_connection_id
  - previous_scope_set_hash
  - new_scope_set_hash
- Outcome: success

#### audit.slack.workspace_install.failed
- Trigger: workspace install attempt failed
- Owner: backend
- Fields:
  - slack_team_id (optional)
  - state_nonce_valid (bool)
  - error_code
- Outcome: failure

#### audit.slack.delegated_authorization.created
- Trigger: personal Slack OAuth completed
- Owner: backend
- Fields:
  - user_oauth_token_id
  - actor_user_id
  - slack_user_id (optional)
  - slack_team_id
  - scope_set
- Outcome: success

#### audit.slack.delegated_authorization.failed
- Trigger: personal Slack OAuth failed
- Owner: backend
- Fields:
  - actor_user_id
  - slack_team_id (optional)
  - error_code
- Outcome: failure

#### audit.slack.identity_binding.violation
- Trigger: invariant breach (identity mismatch or invalid combination)
- Owner: backend or engine
- Fields:
  - expected_slack_team_id
  - actual_slack_team_id
  - provided_identity_inputs (sanitized summary)
  - error_code
- Outcome: blocked

#### audit.slack.token.revoked
- Trigger: token marked revoked or invalid
- Owner: backend
- Fields:
  - token_kind (workspace_bot | delegated_user)
  - workspace_connection_id or user_oauth_token_id
  - revocation_source (slack_response | user_disconnect | admin_action)
- Outcome: success

---

### Operational log events

#### slack.identity.selected
- Trigger: execution-time identity resolved for a node
- Owner: engine
- Fields:
  - workflow_id, run_id, node_id
  - identity_type
  - selection_reason
  - required_scopes
  - available_scopes
  - scope_gap (optional)
- Outcome: success

#### slack.identity.selection_failed
- Trigger: identity resolution failed
- Owner: engine
- Fields:
  - selection_reason
  - error_code
- Outcome: blocked or degraded

#### slack.api.request
- Trigger: Slack API call initiated
- Owner: engine or backend
- Fields:
  - method
  - identity_type
  - attempt
  - retryable (bool)

#### slack.api.response
- Trigger: Slack API response received
- Owner: engine or backend
- Fields:
  - method
  - http_status
  - slack_ok (bool)
  - slack_error (sanitized)
  - error_code
  - duration_ms
  - retry_after_s (optional)

#### slack.token.refresh.attempt
- Trigger: token refresh started
- Owner: backend
- Fields:
  - token_kind
  - user_oauth_token_id
  - expires_at
- Outcome: pending

#### slack.token.refresh.succeeded
- Trigger: token refresh succeeded
- Owner: backend
- Fields:
  - new_expires_at
  - scope_set (if changed)
- Outcome: success

#### slack.token.refresh.failed
- Trigger: token refresh failed
- Owner: backend
- Fields:
  - error_code
  - slack_error (optional)
- Outcome: failure

#### slack.token.invalidation.detected
- Trigger: Slack indicates token invalid or revoked
- Owner: engine or backend
- Fields:
  - token_kind
  - connection_id
  - slack_error
- Outcome: failure

---

### Frontend telemetry (non-audit)

- ui.slack.connect.opened
- ui.slack.connect.completed
- ui.slack.connect.failed
- ui.slack.identity.choice.changed

Fields:
- workspace_id
- actor_user_id
- node_id (for identity choice)
- selected_identity_type
- error_code (for failures)

---

### Metrics

Counters:
- slack_workspace_install_success_total
- slack_workspace_install_failure_total
- slack_delegated_auth_success_total
- slack_delegated_auth_failure_total
- slack_identity_selected_total{identity_type, selection_reason}
- slack_identity_selection_failed_total{error_code}
- slack_token_refresh_failed_total{error_code}
- slack_token_revoked_total{token_kind, source}
- slack_api_calls_total{method, outcome, error_code}

Histograms:
- slack_api_latency_ms{method}
- slack_identity_resolution_ms

Gauges:
- slack_tokens_expiring_24h{token_kind}

---

### Failure semantics alignment
- Blocked execution:
  - Emit slack.identity.selection_failed with outcome=blocked.
  - Emit audit.slack.identity_binding.violation if invariant breach.
- Degraded execution:
  - Emit slack.identity.selection_failed with outcome=degraded.
  - Include degradation_action (skip_node, notify_only).

---

### Known gaps to close
- Ensure correlation_id propagates from OAuth install through runtime execution.
- Persist token invalidation instead of logging only.
- Emit identity selection logs on success, not only failure.
- Standardize Slack error to internal error_code mapping.
- Track scope gaps explicitly during identity resolution.
