# Workflow Designer

The workflow designer combines a canvas, toolbar, and run console so you can build, test, and monitor automations without leaving the dashboard.

## Workflow Toolbar

- Select any workflow from the dropdown, rename it in place, or create a new workflow. Solo plans can store up to three workflows; attempting to create more shows an upgrade notice.【F:src/layouts/DashboardLayouts/Toolbar.tsx†L1-L120】【F:src/layouts/DashboardLayouts/Dashboard.tsx†L360-L444】
- The toolbar surfaces Save, New, Run Overlay, and Lock/Unlock actions. Buttons enable only when your role allows editing and when the workflow has unsaved changes. Locked workflows can be unlocked by their creator or workspace admins.【F:src/layouts/DashboardLayouts/Toolbar.tsx†L120-L208】【F:src/layouts/DashboardLayouts/Dashboard.tsx†L244-L336】
- Plan usage stats (runs used vs limit) and solo plan warnings appear above the canvas, keeping you aware of remaining capacity.【F:src/layouts/DashboardLayouts/Dashboard.tsx†L120-L180】

## Canvas Interaction

- Drag triggers, actions, and conditions from the sidebar onto the canvas. Solo plans may add up to 10 nodes per workflow; dropping beyond that limit shows a restriction notice prompting an upgrade.【F:src/layouts/DashboardLayouts/FlowCanvas.tsx†L492-L574】【F:src/layouts/DashboardLayouts/FlowCanvas.tsx†L936-L986】
- Connect nodes by dragging handles. Condition nodes label “True” and “False” branches automatically, while the store keeps node and edge selections synchronized so the canvas state stays consistent.【F:src/layouts/DashboardLayouts/FlowCanvas.tsx†L900-L974】
- Use the node flyout (arrow icon) to edit fields, credentials, and scheduling options without leaving the canvas. Flyout state is memoized so prop-to-state synchronization avoids React Flow update loops.【F:src/layouts/DashboardLayouts/FlowCanvas.tsx†L974-L1070】【F:src/layouts/DashboardLayouts/FlowCanvas.tsx†L1120-L1186】
- Solo plans restrict advanced scheduling features; when a schedule would exceed plan capabilities, the canvas surfaces inline notices instead of allowing the change.【F:src/layouts/DashboardLayouts/FlowCanvas.tsx†L1420-L1486】

## Saving and Version Safety

- Saving writes the sanitized node and edge graph back to the API, normalizes the server response, and clears the dirty flag. Validation violations (such as using a premium feature on a Solo plan) display inline errors and keep unsaved changes on the canvas for correction.【F:src/layouts/DashboardLayouts/Dashboard.tsx†L820-L920】
- Switching workflows with unsaved changes triggers a confirmation dialog; Dsentr delays the switch until the current graph is clean to prevent accidental loss.【F:src/layouts/DashboardLayouts/Dashboard.tsx†L336-L388】
- Closing the browser tab while unsaved changes exist prompts a standard “are you sure” dialog, reducing the risk of losing edits.【F:src/layouts/DashboardLayouts/Dashboard.tsx†L388-L420】

## Running Workflows

- Start runs from the toolbar. The run overlay displays live node-by-node execution status, failed steps, and success indicators, updating via server-sent events and falling back to polling if needed.【F:src/layouts/DashboardLayouts/Dashboard.tsx†L520-L744】【F:src/layouts/DashboardLayouts/Dashboard.tsx†L744-L844】
- A global runs stream feeds the toolbar status pill so you can see when any workflow is queued or running across the workspace.【F:src/layouts/DashboardLayouts/Dashboard.tsx†L744-L820】
- Cancelling or retrying runs is managed from the Settings → Engine tab; the overlay focuses on visibility while heavy operations live in the administration surface.【F:src/components/settings/tabs/EngineTab.tsx†L106-L188】

## Locking and Collaboration

- Workflow creators can lock a workflow to prevent edits while they are deploying or reviewing changes. Owners and admins can override locks, while viewers remain read-only.【F:src/layouts/DashboardLayouts/Dashboard.tsx†L180-L244】【F:src/layouts/DashboardLayouts/Toolbar.tsx†L160-L208】
- When a lock is active, the canvas enters read-only mode (`canEdit` is set to false) so accidental node drops or connections are ignored until the lock is released.【F:src/layouts/DashboardLayouts/FlowCanvas.tsx†L512-L566】
