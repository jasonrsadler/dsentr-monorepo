# ⚠ ReactFlow + Zustand Architecture (MANDATORY)
- **Lock discipline.** Never mutate workflow graph state while a persistence or evaluation lock is active. All canvas writes
  must go through the store's serialized action queue so concurrent saves or executions cannot interleave. When you acquire the
  `workflowLock`, release it in a `finally` clause and short-circuit UI updates until the lock clears.
- **Dirty-state contract.** Treat `workflowDirty` as the single truth for unsaved changes. Toggle it only through the dedicated
  Zustand actions, and reset node-level dirty flags from within the same transaction that persists the workflow. Never derive
  dirtiness from React Flow props or local component state.
- **Memoized handlers only.** All canvas callbacks (`onNodesChange`, `onEdgesChange`, `onNodeDragStop`, etc.) must be wrapped in
  `useCallback` (or equivalent memo helpers) with stable selector inputs so React Flow can reuse handler instances between
  renders. Refrain from inline lambdas that capture mutable state.
- **Node purity rules.** Node components must remain referentially pure: compute derived props with `useMemo`, keep side effects
  inside `useEffect` that depend on memoized selectors, and avoid firing store updates during render. Only emit store actions
  from vetted effect or event handler paths after confirming the payload actually changed.

# ⚠ ReactFlow Development Standard (HIGH PRIORITY)
- All React Flow canvas features must continue to use the Zustand-driven unidirectional workflow architecture.
- Treat the workflow store as the single source of truth: read via selectors, mutate via dispatched actions only.
- Keep data flowing in one direction—store ➜ component props/derived selectors ➜ user interaction callbacks ➜ store actions.
- Do not introduce cross-component prop mutation, ad-hoc event buses, or direct store mutations.
- Define any new canvas state alongside typed selectors/actions in the shared workflow store modules and reuse existing helpers when possible.
- Run side effects (async loads, debounced persistence, telemetry) inside dedicated store actions/effects so components remain pure.
- When updating nodes or edges, emit Zustand actions that describe intent rather than mutating React Flow internals directly.

# Frontend Agent Notes

## Context
- The frontend is built with Vite + React + TypeScript, using Tailwind CSS, Zustand for state, and a React Flow-powered visual a
utomation canvas.
- Many components are memoized and rely on stable references; inadvertent prop or context changes can trigger runaway re-render
loops, especially in the React Flow canvas.

## Required Practices
- Always run `npm run lint` and `npm test` before submitting frontend changes. Keep in mind that linting and tests take quite a
few moments so patience is required for them to finish
- When altering canvas nodes, edges, or shared hooks, audit for dependency cycles and ensure state setters are wrapped (e.g., `u
seCallback`, `useMemo`) to prevent infinite renders.
- Follow the established ESLint + Prettier formatting rules; avoid disabling lint rules unless necessary and documented.
- React Flow safe patterns (must be used and commented in code):
  - Initialize local state from props once using useRef mounted flag.
  - No state changes during render.
  - useEffect with correct dependency arrays.
  - useCallback for handlers.
  - Only call parent onUpdate when deep-equality shows change.
  - Debounce inputs that propagate to parent.
  - When mirroring props into local state, keep a `useRef` snapshot of the last payload and short-circuit updates when the next payload is structurally identical. This avoids the React Flow "maximum update depth" loop caused by dispatching redundant setter calls from effects.
- Signup flows that accept workspace invites must route all query parsing through `parseInviteQuery` in `src/lib/inviteQuery.ts` so redirects and conflict detection stay consistent with backend expectations.
- Invitation acceptance must always go through a confirmation modal with explicit Accept/Decline actions so users can opt out before hitting the API.
- The dashboard header now includes a global workspace switcher. It must stay synchronized with `useAuth().currentWorkspaceId`, auto-select a sole workspace, and keep the router query string (`?workspace=`) up to date whenever the selection changes.
- Leaving a workspace is initiated from the Members settings tab. The "Leave workspace" button must be disabled for owners, call the `leaveWorkspace` API when allowed, refresh cached memberships, and send users back to their Solo workspace (or next available one) when the server responds with `403`.

## Change Reasons
- Removed the Members tab workspace selector so the dashboard header switcher is the single mechanism for context changes.
- Updated Members tab data loading so workspace viewers don't get redirected when invite lists return 403 responses.
- Allowed the Members tab to keep viewer contexts active by loading roster data even when invite management remains restricted.
- Skipped invite fetching for non-admin workspace members so the Members tab avoids unnecessary API calls and 403 responses.
- Secrets tab now scopes API requests by workspace so shared secrets remain visible across members while enforcing creator/admin deletion rules.
- Secrets tab now opens a confirmation modal before deleting entries, warning that removal is irreversible and may impact dependent workflows.
- Workspace selection now falls back to a user's owned workspace when their previously active workspace is unavailable so dashboard context stays consistent after membership changes.
- Logs tab now summarizes executed workflow runs with a human-readable timeline while keeping a copy-to-clipboard option for the raw JSON payload.
- Logs tab now enriches workflow run summaries with trigger origin, credential usage, and node subtype context derived from execution snapshots.
- Integrations tab now lets admins revoke shared OAuth connections without deleting the owner's personal credential.
- Workflow nodes clear shared workspace credential selections when the shared connection is removed so users must choose an available credential explicitly.
- OAuth connection selectors update in real time when workspace credentials are promoted or removed, so open workflows reflect changes without refreshing.
- Shared credential removal flows now warn about potential workflow failures and ensure personal disconnects also revoke shared workspace connections.
- Action nodes now deep-compare local state before notifying the canvas so update notifications don't trigger infinite React Flow rerender loops.
- Action node prop-to-state sync skips redundant param updates to prevent React Flow dirty-check loops when toggling node UI.
- Condition nodes now deep-compare update payloads before notifying the canvas so toggling other nodes or edges doesn't trigger infinite workflow rerenders.
- Action nodes no longer mirror their entire config payload in unused state, avoiding React Flow effect loops when props update with identical data.
- Action nodes now guard prop-to-state synchronization so redundant dirty resets can't cascade into React Flow depth errors when interacting with nodes or edges.
- Action nodes now cache the last prop snapshot before syncing local state so identical data stops propagating through the canvas and avoids infinite update loops.
- React Flow canvas documentation now calls out the cached-snapshot guard so future node work avoids reintroducing maximum update depth errors.
- Teams action now deduplicates Microsoft connection snapshots before mutating state so identical OAuth updates stop retriggering canvas loops.
- Messaging action caches the last emitted payload and only notifies parents when selections actually change, preventing redundant React Flow updates.
- SendGrid action synchronizes props via snapshots and suppresses redundant onChange emissions to avoid React Flow maximum update depth errors.
- Custom code action now normalizes state snapshots, caches the last emission, and guards prop-to-state sync so React Flow doesn't hit maximum update depth while editing scripts or IO pairs.
- Teams action now initializes its connection sanitizer before dependent callbacks so React Flow renders don't encounter temporal dead zone reference errors.
- Documented the high-priority React Flow standard that enforces the Zustand-driven unidirectional workflow architecture.
- Documented the mandatory React Flow + Zustand architecture contract covering lock discipline, dirty-state management, memoized handlers, and node purity rules.
- Dashboard workflow view now listens directly to the workflow store so the toolbar's save indicator reacts immediately to node or edge edits.
- Workflow toolbar dirty indicator now flips immediately when canvas edits occur so the save button activates as soon as the workflow changes.
- Workflow saves now merge sanitized node snapshots without reflagging the workflow as dirty, ensuring the toolbar save button disables once persistence completes.
- Workflow node dirty badges now reset after a successful save unless validation errors remain, so only nodes requiring attention retain their badge indicators.
- FlowCanvas now clears node dirty flags during saves and avoids inferring dirtiness from validation status when reloading graphs, keeping validation badges visible without re-triggering unsaved-change indicators.
