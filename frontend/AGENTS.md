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
