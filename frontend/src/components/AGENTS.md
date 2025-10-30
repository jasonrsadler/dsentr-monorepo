# Components Agent Notes

## Change Reasons
- UI: Unified scrollbar theming across scrollable components to match the Settings modal.
- Applied the shared `themed-scroll` utility class to elements with `overflow-auto`/`overflow-y-auto` for consistent, theme-aware scrollbars in light and dark modes.
- TeamsAction: Prevented duplicate store writes for no-op input changes by tracking the last committed params in a ref and short-circuiting when the next state is identical. This avoids redundant `updateNodeData` calls that can cause render thrash in tests and the canvas.
- SMTPAction: Improved accessibility of TLS radio options by marking helper text as `aria-hidden` and adding `aria-label` to radio inputs so `getByLabelText` works under jsdom. Also compute validation on each field change and include `hasValidationErrors` in the same `updateNodeData` payload to keep store state in sync with UI.
- Signup form: Excluded the required asterisk from accessible labels (`aria-hidden`) so tests can select the `Password` field by its exact label.
- Members tab: Added an ownership transfer confirmation modal so current owners are warned they'll lose the role and must rely on the new owner to regain it before promoting another member.

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
