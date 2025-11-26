# Components Agent Notes

## Change Reasons
- Google Sheets action: guard against automatically falling back to the personal credential after a shared workspace connection is removed by tracking when a workspace selection is cleared. This keeps users from silently swapping credentials and mirrors the React Flow safety patterns for avoiding redundant updates.
- UI: Unified scrollbar theming across scrollable components to match the Settings modal.
- Applied the shared `themed-scroll` utility class to elements with `overflow-auto`/`overflow-y-auto` for consistent, theme-aware scrollbars in light and dark modes.
- TeamsAction: Prevented duplicate store writes for no-op input changes by tracking the last committed params in a ref and short-circuiting when the next state is identical. This avoids redundant `updateNodeData` calls that can cause render thrash in tests and the canvas.
- Plan tab plan-usage refresh now scopes workspace requests to Workspace plans so solo users still load usage successfully.
- SMTPAction: Improved accessibility of TLS radio options by marking helper text as `aria-hidden` and adding `aria-label` to radio inputs so `getByLabelText` works under jsdom. Also compute validation on each field change and include `hasValidationErrors` in the same `updateNodeData` payload to keep store state in sync with UI.
- Signup form: Excluded the required asterisk from accessible labels (`aria-hidden`) so tests can select the `Password` field by its exact label.
- Members tab: Added an ownership transfer confirmation modal so current owners are warned they'll lose the role and must rely on the new owner to regain it before promoting another member.
- Members tab: Removed the ability to transfer ownership to another member so each user can retain ownership of only their own workspace.
- RunCustomCodeAction: Added a lightweight help tooltip ("?") with concise guidance on how to reference inputs in code using `${inputs.*}`, how to map outputs to properties of a returned JSON object, and how to reference a primitive return via `${{<run code node name>.result}}`. Implemented with local state only to avoid unnecessary store writes and prevent canvas re-render loops.
- WebhooksTab: Updated HMAC instructions to match backend behavior. Preferred header-based verification using `X-DSentr-Timestamp` and `X-DSentr-Signature` (HMAC over `ts + '.' + canonical_json_body` with base64url-decoded key). Documented legacy body fields (`_dsentr_ts`/`_dsentr_sig`) with signing over the body excluding those fields. Added copyable examples for Bash (curl), PowerShell, and Node.
- WebhooksTab: Added positive confirmation states for the Signing Key "Copy" button ("Copied!") and HMAC settings "Save" button ("Saving…" → "Saved!") to clearly indicate the action was applied.
- WebhooksTab: Restored copy-to-clipboard controls for the HMAC language examples and added a signing key rotation button that surfaces success state, refreshes the derived webhook URL, and warns that both credentials change together.
- IntegrationsTab: Removed redundant client-side filtering of workspace OAuth connections by `workspaceId`. Backend now enforces workspace scoping for the connections listing endpoint, so the UI consumes the `workspace` array as returned.

## Affected Areas
- Settings > LogsTab: change history list
- Settings > WebhooksTab: code examples and raw payload blocks
- UI > Dialogs: `JsonDialog` content area
- UI > InputFields: dropdown menus for nodes and secrets
- UI > Schedule: time and timezone pickers
  - Removed redundant "Remove repeat" action in Trigger node (repeat is toggled via the header control).
- Workflow > Actions: email provider dropdowns, Teams mentions list
- Workflow > Trigger: trigger type dropdown

Styles live in `src/css/globals.css` under `.themed-scroll` and were previously used by `SettingsModal`.
- Added support components (header issue button and modal) so users can submit issue reports with their account/workspace context to the backend.
