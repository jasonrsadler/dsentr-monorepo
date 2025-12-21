## Legacy Behaviors Removed

The following behaviors exist in the current Slack OAuth and execution model and are intentionally removed as part of the workspace-first refactor.

### Personal → Workspace Promotion
Personal Slack OAuth tokens can currently be promoted into workspace connections via explicit promotion flows.
This behavior is removed.

Reason:
Promotion blurs ownership boundaries, allows cross-user token mutation, and makes identity resolution ambiguous at runtime.

Impact:
All Slack workspace connections must originate from an explicit workspace install.
Personal tokens are never promoted and never cloned into workspace records.

Risk:
Low. Promotion paths are already fragile and inconsistently used.

---

### Incoming Webhook Fallback Execution
Workspace Slack execution currently short-circuits to an incoming webhook URL when present, bypassing OAuth token usage.

Reason:
Webhook fallback overrides explicit identity choice, bypasses OAuth scope enforcement, and creates non-obvious execution paths.

Impact:
All Slack execution must use OAuth tokens tied to an explicit identity (workspace bot or personal user).
Webhook-only execution is removed.

Risk:
Moderate. Some legacy workflows may rely on webhook behavior.
These workflows must be reconfigured to use OAuth-based execution.

---

### Email-Based Deduplication
Slack OAuth deduplication currently falls back to normalized email when provider user ID is missing.

Reason:
Email is not a stable Slack identity and can cause unintended token merges across users or teams.

Impact:
Slack personal tokens are deduplicated by Slack user ID only.
If a Slack user ID is unavailable, no deduplication occurs.

Risk:
Low. Slack reliably provides user identifiers.

---

### Implicit Identity Selection
Slack execution currently infers whether to act as a workspace bot or a personal user based on token availability or flags.

Reason:
Implicit selection hides execution intent, breaks auditability, and causes unpredictable behavior.

Impact:
All Slack actions must specify identity explicitly.
Execution fails if identity is missing or ambiguous.

Risk:
Low. Failures are explicit and actionable.

---

### Multiple Workspace Slack Connections per Team
The system currently allows multiple Slack workspace connections for the same Slack team within a Dsentr workspace.

Reason:
Multiple connections for the same Slack team create ambiguity in execution, refresh, and authorization flows.

Impact:
Exactly one Slack workspace connection is allowed per Dsentr workspace per Slack team ID.

Risk:
Low. Duplicates are rare and will be collapsed deterministically during migration.

---

## Explicit Non-Goals

The following items are explicitly out of scope for this phase.

### Multiple Slack Teams per Dsentr Workspace
Supporting multiple Slack teams within a single Dsentr workspace is not implemented.

Reason:
It significantly increases complexity in execution routing, identity validation, and UI semantics.

Revisit When:
There is a clear product requirement for cross-team workflows.

---

### Migration of Webhook-Only Workflows
Existing webhook-only Slack workflows are not automatically migrated.

Reason:
Webhook semantics are incompatible with the workspace-first OAuth model.

Revisit When:
A dedicated migration or compatibility layer is designed.

---

### Broad Integrations UI Redesign
Only Slack-related UX is updated.
Other integrations remain unchanged.

Reason:
This change targets Slack-specific identity and OAuth semantics only.

---

### Cross-Team Slack Execution
Executing Slack actions across mismatched Slack team IDs is not supported.

Reason:
Cross-team execution violates Slack’s authorization model and creates security risk.

---

## Usage and Risk Notes

Current logs and code inspection show no strong dependency on:
- Email-based Slack deduplication
- Multiple Slack workspace connections per team
- Implicit identity inference as a supported feature

Any workflows relying on removed behaviors will fail fast with explicit errors and require user reconfiguration.
