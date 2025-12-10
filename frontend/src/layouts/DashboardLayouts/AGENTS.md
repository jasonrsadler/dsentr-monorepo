# FlowCanvas Agent Notes

## Change Reasons
- Flyout Trigger schedule parity: replaced plain text inputs with the same calendar, time, and timezone pickers used on the Trigger node, and added repeat enable/fields to match node behavior.
- Plan usage refresh now skips workspace-scoped requests for solo plans and the solo banner displays remaining monthly runs to avoid stale or blocked usage data.
- Dashboard now listens to workflow SSE updates, tracks `updated_at` versions, and surfaces conflict banners so workspace collaborators do not overwrite each other's saves.
- Workflow switches, new workflow creation, and run attempts now auto-save dirty graphs before proceeding so navigation and executions never drop pending edits.
- Added a global workflow auto-save hook that responds to integration OAuth connect requests so dirty graphs are persisted before redirecting away.
- Runs tab replaced by a separate Runs button that opens a sidebar drawer so the Designer tab stays active while run details live in the slide-out panel.
- Runs drawer only mounts when open, preventing it from overlaying or obscuring the canvas when closed.
- Runs button styled as a tab beside Designer and the runs panel now slides up from the bottom with animation to avoid blocking the node sidebar.

## Notes
- Pickers are locally stateful and wrapped in useMemo/useCallback with click-outside + Escape handling to avoid React Flow re-render loops.
- Schedule changes patch node data via `updateNodeData` with shallow merges; removing repeat sets `repeat: undefined` to clear it without extra writes.
