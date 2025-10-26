# Dashboard Layouts Agent Notes

## Change Reasons
- UI: Unified scrollbar styling in this directory to match Settings modal.
- Applied `themed-scroll` to scrollable containers so light/dark mode scrollbar visuals are consistent.
- Affected files:
  - `Dashboard.tsx`: node/task sidebar list and templates panel now use `themed-scroll`.
  - `FlowCanvas.tsx`: flyout content area now uses `themed-scroll`.
- Styles are defined globally in `src/css/globals.css` under `.themed-scroll` and already used by `SettingsModal`.
