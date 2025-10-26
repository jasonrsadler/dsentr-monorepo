# Frontend Agent Notes

Vite build output (warnings-free):
- Added Rollup chunk splitting to group large vendor deps (React, XYFlow, framer-motion, router, zustand, etc.) and reduce main bundle size.
- Raised `chunkSizeWarningLimit` and silenced non-actionable Rollup warnings (`CIRCULAR_DEPENDENCY`, `CHUNK_SIZE_LIMIT`) via `onwarn` so `npm run build` is free of noisy warnings in CI.
- Enabled treeshake, esbuild minification, disabled sourcemaps and compressed size reporting for faster, cleaner builds.
## Context
- The frontend is built with Vite + React + TypeScript, using Tailwind CSS, Zustand for state, and a React Flow-powered visual a
utomation canvas.
- Many components are memoized and rely on stable references; inadvertent prop or context changes can trigger runaway re-render
loops, especially in the React Flow canvas.

## Required Practices
- All tests go in /tests directory. No tests go anywhere under /src
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
Vite 7 migration:
- Moved Vitest options into `vitest.config.ts` and removed the `test` field from `vite.config.ts` because Vite 7’s `UserConfig` no longer includes `test`. Mirrored aliases/plugins so test transforms and import paths match the app.

Vitest config type compatibility:
- Removed Vite plugins from `vitest.config.ts` to avoid cross-package `PluginOption` type mismatches between Vitest’s bundled Vite types and the app’s Vite types. Vitest/esbuild handles JSX/TS without these plugins; aliases are preserved for import resolution.

Lint hygiene:
- Added `vitest.config.ts` to `tsconfig.node.json` includes so ESLint’s typed parser (`parserOptions.project`) can resolve it and avoid parsing errors.
- Updated ESLint rule `react-refresh/only-export-components` to allow exports `useSecrets` and `SecretsContext`, matching our context/provider pattern without forcing file splits.
- Stabilized React hooks deps in `src/components/ui/InputFields/NodeSecretDropdown.tsx` by using a shared empty object constant instead of recreating `{}` each render.
Additional TypeScript build fixes (build hygiene):
- Excluded 	ests from 	sconfig.app.json so app builds don’t typecheck test files. Added missing TS path aliases (@components, @hooks, @utils, @assets) to mirror Vite aliases.
- Replaced uses of JSX.Element in public props with ReactNode to avoid JSX namespace issues in TS 5.x with React 19.
- Normalized import casing and resolved duplicate-casing conflicts (e.g., UI/dialog vs ui/dialog, Settings vs settings). Kept a single canonical path to avoid TS1261 on case-insensitive filesystems.
- React Flow: wrapped control callbacks to accept mouse events, ensured WorkflowEdgeData and ActionNodeData extend Record<string, unknown>, and cast node/edge data where needed to satisfy @xyflow/react v12 generics.
- Workflow selectors: relaxed generic constraints from Record<string, unknown> to object and removed Object.freeze returns to avoid "readonly to mutable" assignment errors. Preserved immutability via cloning where it matters.
- Teams action: removed empty-string assignments to ConnectionScope (use undefined/delete), coalesced option types, fixed readonly dropdown arrays via spreads, and tightened diff/patch typing to avoid index/union assignment errors.
- Fixed minor TS issues: implicit any in trigger dropdown, safe conversions to string for numeric NodeInputField values, label type on edges (use undefined instead of 
ull), and Signup form access to string fields.
- Removed or referenced unused locals (e.g., timers, memo caches) to comply with 
oUnusedLocals.
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
- Action node controller logic has been extracted into a shared hook so future node variants can reuse the guarded state sync, plan restriction notices, and dirty tracking patterns without duplicating React Flow safety checks.
- React Flow canvas documentation now calls out the cached-snapshot guard so future node work avoids reintroducing maximum update depth errors.
- Teams action now deduplicates Microsoft connection snapshots before mutating state so identical OAuth updates stop retriggering canvas loops.
- Messaging action caches the last emitted payload and only notifies parents when selections actually change, preventing redundant React Flow updates.
- Messaging action now derives platform payloads directly from the workflow store, sanitizes params on platform switches, and resets validation state to avoid stale cache refs.
- SendGrid action synchronizes props via snapshots and suppresses redundant onChange emissions to avoid React Flow maximum update depth errors.
- Custom code action now normalizes state snapshots, caches the last emission, and guards prop-to-state sync so React Flow doesn't hit maximum update depth while editing scripts or IO pairs.
- Teams action now initializes its connection sanitizer before dependent callbacks so React Flow renders don't encounter temporal dead zone reference errors.
- Teams action replaces object-returning zustand selectors with separate primitive selectors to satisfy useSyncExternalStore caching and eliminate the "getSnapshot should be cached" infinite loop and related maximum update depth errors.
- Slack action also replaces object-returning zustand selectors with separate primitive selectors to satisfy useSyncExternalStore caching and eliminate the same infinite loop warning and depth errors.
- Workflow toolbar save state: replaced separate `setNodes`/`setEdges` calls with an atomic `setGraph` in the workflow store and updated `Dashboard.pushGraphToStore` to use it. This prevents transient re-dirty flips during save (and the Save button immediately re-enabling) when the graph is rehydrated from the server.
- Save stability: excluded ephemeral UI/derived fields (`hasValidationErrors`, `labelError`, `hasLabelValidationError`, `dirty`, `wfEpoch`) from the serialized workflow payload via `sanitizeData()`. Store dirty checks now compare sanitized payloads, so post-save node validation effects no longer re-mark the workflow as dirty.
- Edge menu restore: preserved React Flow edge `selected` state in `normalizeEdgesForState` so the in-canvas edge menu (delete + style: normal/bold/dashed) appears on click again. Kept `normalizeEdgeForPayload` unchanged so ephemeral selection is not serialized.
- Flyout plan notice fix: updated `useMessagingActionRestriction` to accept an `enabled` flag and wired `FlowCanvas` to enable it only for the active messaging subtype (Slack or Teams). This prevents emitting workspace-plan restriction notices for unrelated actions, fixing the Solo plan header error appearing when opening any action flyout.
 - Workflow selectors: return stable default action params when a node is missing (e.g., during workflow switches or node deletion) so `useSyncExternalStore` dev checks see cached snapshots and the "getSnapshot should be cached" warning is eliminated. This also reduces unnecessary re-renders on the canvas when nodes are removed.
- Workflow designer sidebar: removed fixed heights and switched to flex-based layout with `min-h-0` and internal `overflow-y-auto` so the sidebar scrolls independently and stays within the viewport. The aside now uses `overflow-hidden` and the right pane uses `min-h-0` wrappers around the React Flow provider to eliminate unintended page-level scrollbars.
- Workflow canvas flyout: switched from rendering a nested React Flow preview to rendering the node's fields directly in the side panel (label edit, delete with confirm, OAuth pickers, inputs, and execution options). Applied to Action, Trigger, and Condition nodes. This avoids nested canvas pitfalls and ensures edits sync via the same controllers/selectors used on-canvas.
- Workflow canvas flyout: added hover-activated shortcut arrows on nodes that programmatically select the target and open the mirrored flyout so users can launch the panel without clicking the entire node.
- Workflow designer sidebar: added an "Actions" section header under Trigger and Condition, and made each action category collapsible (expanded by default) to declutter the node picker without changing default visibility.
- Workflow designer sidebar: added a fast search input under the "Actions" header that filters action tiles across categories in real time. While searching, categories auto-expand to show matches and a fallback message appears when no actions match.
- Dashboard notifications: collapsed the header-adjacent notification area to only show the Solo plan usage/limits banner. Removed the general plan banner (e.g., workspace plan messaging) and rerouted plan restriction notices (node caps, schedule limits, exceeding Solo workflow count, etc.) to the inline error bar within the designer. This preserves clear feedback without surfacing extra banners under the app header.
- Solo banner spacing: restored internal padding inside the Solo plan banner for readability, and removed the surrounding wrapperâ€™s side/top padding so the banner sits flush under the header without extra horizontal/top spacing.
- Solo usage bar: restored the run usage progress bar beneath the usage count. Switched to fractional widths (no rounding/clamping) so small usage shows a proportional sliver. If the API omits a Solo plan run limit, the UI uses a 250-run fallback (matching backend SOLO_MONTHLY_RUN_LIMIT) so the bar still reflects progress.
- Added a `docs/` directory with user-facing guides that document onboarding, dashboard navigation, settings, and the workflow designer so product behavior is discoverable without reading source code.
- Shipped a standalone Vite-powered `docs-site/` React application that renders the customer documentation with navigation, layout, and tests so teams can host the guides separately from the product UI.
