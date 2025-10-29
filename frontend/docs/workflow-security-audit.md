# Workflow & Settings Security Review

## Summary
- Workflow nodes persist and transmit raw secret values, creating sensitive-data exposure risks that conflict with OWASP ASVS 3.4 and Fortify "Sensitive Data Protection" expectations.
- Settings → Webhooks exposes the signing key to read-only roles, violating least-privilege guidance from STIG 5.10 and Fortify's access-control checks.
- Supporting stores and API clients reuse those plaintext payloads without masking, so any downstream logging or transport will continue to leak secrets, contravening OWASP Top 10 (A02:2021 Cryptographic Failures) and 7PK "Security Features" guidelines.

## Workflow nodes & controllers
### Finding: Plaintext secret propagation across UI state and saves
`NodeSecretDropdown` builds its options and change payloads with the full secret value pulled from the workspace secret store. Creating or selecting a secret immediately writes the raw string back to node state via `onChange(trimmedValue)`.【F:frontend/src/components/UI/InputFields/NodeSecretDropdown.tsx†L51-L182】 Those values come from `optionsApi.fetchSecrets`, which normalizes the server response into `{ value, ownerId }` pairs without redaction.【F:frontend/src/lib/optionsApi.ts†L32-L109】 When workflows are saved, `sanitizeNodeData` only strips editor metadata, so the plaintext secrets are serialized back into the workflow graph and sent to the API.【F:frontend/src/lib/workflowGraph.ts†L10-L36】【F:frontend/src/layouts/DashboardLayouts/Dashboard.tsx†L1015-L1037】【F:frontend/src/stores/workflowStore.ts†L52-L140】 This violates OWASP ASVS 3.4 and Fortify data-protection checks by keeping long-lived secrets in front-end memory, request payloads, and logs.

**Mitigation tasks**
- Replace plaintext values in `optionsApi`/`SecretsContext` with opaque secret handles (ID + last4) so nodes store references rather than raw strings. Update workflow execution paths to resolve handles server-side. (OWASP ASVS V3, Fortify Sensitive Data Protection)
- Add client-side masking before save/export (`sanitizeNodeData`) so any remaining legacy plaintext secrets are scrubbed or replaced with redaction tokens before persistence. (OWASP Top 10 A02, 7PK Security Features)
- Introduce audit logging around handle-resolution in the backend API so access to real secret material is monitored. (OWASP ASVS V10, Fortify Audit Trail)

## Settings tabs
### Finding: Webhook signing key disclosed to unauthorized roles
`WebhooksTab` always calls `getWebhookConfig` and stores the returned `signing_key`, rendering it in the UI and allowing copy-to-clipboard even when the active user only has viewer permissions (controls merely disable toggles, they do not block the fetch).【F:frontend/src/components/Settings/tabs/WebhooksTab.tsx†L14-L386】 The API client mirrors that behavior by returning the signing key on every request with no role hint.【F:frontend/src/lib/workflowApi.ts†L693-L732】 This contravenes STIG 5.10 "Access Control" and 7PK "Access Control" by exposing shared secrets to principals that should be read-only.

**Mitigation tasks**
- Gate the `getWebhookConfig` request behind role checks in `WebhooksTab` and request a redacted payload when the caller lacks admin/owner privileges. (STIG 5.10, OWASP ASVS V4)
- Update the backend/webhook config endpoint to omit or hash the signing key for read-only roles and require explicit rotation to view it. (Fortify Access Control, 7PK Access Control)
- Add an access audit event whenever the signing key is revealed, ensuring workspace owners can review secret access. (OWASP ASVS V10)

## Stores & API clients
### Finding: Workflow stores keep unmasked secrets available for reuse
`useWorkflowStore.getGraph()` clones the current nodes and edges—which still contain plaintext secrets—before saves, exports, or history diffs, and no throttling or masking is applied in `workflowLogs` or related selectors.【F:frontend/src/stores/workflowStore.ts†L120-L170】【F:frontend/src/stores/workflowSelectors.ts†L395-L407】【F:frontend/src/stores/workflowLogs.ts†L1-L18】 Because these stores feed logs, tests, and run simulations, any consumer can leak the underlying credentials, violating OWASP Top 10 A09 (Security Logging & Monitoring) and Fortify "Sensitive Data Propagation" rules.

**Mitigation tasks**
- Introduce redaction helpers in `workflowStore`/`workflowSelectors` that swap secret handles for masked placeholders before exposing state to logs, tests, or exports. (OWASP ASVS V10, Fortify Sensitive Data Propagation)
- Add rate limiting/queuing around secret-backed test invocations (`handleTestAction`) to align with 7PK "Reliability & Security" and prevent brute-force probing of secret material. (7PK Reliability & Security)
- Extend `workflowLogs` to detect secret-pattern diffs (e.g., from `maskSecretsDeep`) and automatically mask them before entries are stored. (OWASP Top 10 A09, STIG 5.10 audit requirements)
