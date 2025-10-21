# TypeScript Follow-up Items

The remaining `tsc` failures require broader refactors that are likely to affect runtime behaviour.

## Workflow node typing gaps
- Files: `src/components/workflow/ActionNode.tsx`, `src/components/workflow/TriggerNode.tsx`, `src/components/workflow/TriggerTypeDropdown.tsx`
- Issue: The React state hooks rely on `any`-typed node payloads, so every setter callback parameter is inferred as `any`.
- Required changes:
  - Introduce explicit interfaces for workflow node data (labels, params, inputs, retry metadata) and use them throughout the components.
  - Update every `useState` call with a generic argument so React infers the correct types for setter callbacks.
  - Plumb the refined types through downstream helpers (`inputsEqual`, `sanitizeInputs`, etc.) to keep comparisons and validations type-safe.
  - Ensure the workflow canvas contract still matches the backend payloads to avoid breaking persisted workflows.

## Workflow canvas contract
- Files: `src/layouts/DashboardLayouts/FlowCanvas.tsx`, `src/components/workflow/ActionNode.tsx`, `src/components/workflow/ConditionNode.tsx`, `src/components/workflow/TriggerNode.tsx`
- Issue: `ActionNode` expects an `onRun` callback that returns a `Promise`, and `TriggerNode` requires `onLabelChange`, but the canvas currently provides noop callbacks or omits them entirely.
- Required changes:
  - Decide whether the canvas should support running individual nodes. If so, surface async handlers that resolve a promise; otherwise, relax the node prop contracts.
  - Align the props passed from the canvas with each node's definition so React Flow no longer receives incompatible component props.
  - Verify that any behavioural changes (e.g., enabling per-node execution) are coordinated with the backend trigger workflow.

## Dashboard run status logic
- File: `src/layouts/DashboardLayouts/Dashboard.tsx`
- Issue: Unused timer refs and a status comparison that TypeScript flags as impossible indicate outdated run-state handling.
- Required changes:
  - Audit the live run polling logic and either remove obsolete refs or reintroduce their usage.
  - Revisit the `globalRunStatus` state machine so comparisons cover all valid statuses without narrowing them to disjoint values.
  - Confirm the UX for queued vs. running runs after adjusting the state machine.

## Trigger node refs
- File: `src/components/workflow/TriggerNode.tsx`
- Issue: `useRef` is invoked without an initial value even though the type expects one.
- Required changes:
  - Supply an explicit initial snapshot (e.g., `null`) when creating `useRef` holders for node updates.
  - Ensure subsequent reads handle the nullable ref safely.

These areas will need focused follow-up work beyond the quick fixes delivered in this pass.
