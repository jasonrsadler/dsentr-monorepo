# Components Agent Notes

## Change Reasons
- UI: Unified scrollbar theming across scrollable components to match the Settings modal.
- Applied the shared `themed-scroll` utility class to elements with `overflow-auto`/`overflow-y-auto` for consistent, theme-aware scrollbars in light and dark modes.

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
