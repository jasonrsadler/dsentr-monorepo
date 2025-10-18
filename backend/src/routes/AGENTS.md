# Routes Agent Notes

## Purpose
- HTTP handlers grouped by feature area. Each module exposes functions wired in `main.rs`.

## Key Modules
- `admin.rs`: Admin-only maintenance endpoints (currently purge stale runs).
- `dashboard.rs`: Simple authenticated health check that returns a welcome message and disables caching.
- `early_access.rs`: Public endpoint that records early-access emails with duplicate handling.
- `microsoft.rs`: Authenticated helpers that surface Microsoft Teams metadata using stored OAuth tokens.
- `options/`: User settings APIs (secrets management).
- `auth/`: Authentication/login flows, session management, password reset, etc.
- `oauth/`: Connected account management and OAuth callbacks for Google/Microsoft integrations.
- `workflows/`: Core workflow CRUD, execution controls, logs, SSE streams, webhooks.
- `workspaces.rs`: Workspace CRUD and membership APIs.

## Usage Tips
- Handlers expect `AppState` and often an `AuthSession` extractor; ensure new routes reuse these patterns for authorization.
- For APIs returning JSON, use `responses::JsonResponse` helpers to keep status/message structure consistent.
- When adding new route groups, update `main.rs` to mount them and consider rate-limit layer alignment (`auth_governor_conf` vs global).
- Workspace invitation emails must link to `/signup?invite=…` and use URL-encoded tokens—update the dedicated test if this contract changes.
- Workspace lifecycle flows now expose `GET /api/workspaces`, `GET /api/invites`, `POST /api/workspaces/:id/leave`, and `POST /api/workspaces/:id/revoke`. Use the shared Solo-provisioning helper so the last member receives an automatic personal workspace when they leave or are revoked.

## Change Reasons
- Solo plan downgrades now normalize owned workspaces back to the solo tier when processing plan changes.
