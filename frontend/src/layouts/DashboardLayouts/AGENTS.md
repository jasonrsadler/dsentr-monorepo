# FlowCanvas Agent Notes

## Change Reasons
- Flyout Trigger schedule parity: replaced plain text inputs with the same calendar, time, and timezone pickers used on the Trigger node, and added repeat enable/fields to match node behavior.
- Plan usage refresh now skips workspace-scoped requests for solo plans and the solo banner displays remaining monthly runs to avoid stale or blocked usage data.

## Notes
- Pickers are locally stateful and wrapped in useMemo/useCallback with click-outside + Escape handling to avoid React Flow re-render loops.
- Schedule changes patch node data via `updateNodeData` with shallow merges; removing repeat sets `repeat: undefined` to clear it without extra writes.
