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
- Workspace invitation emails must link to `/signup?invite=�?�` and use URL-encoded tokens�?"update the dedicated test if this contract changes.
- Workspace lifecycle flows now expose `GET /api/workspaces`, `GET /api/invites`, `POST /api/workspaces/:id/leave`, and `POST /api/workspaces/:id/revoke`. Use the shared Solo-provisioning helper so the last member receives an automatic personal workspace when they leave or are revoked.

## Change Reasons
- Solo plan downgrades now normalize owned workspaces back to the solo tier when processing plan changes.
- Added promotion endpoint tests to cover workspace-level OAuth sharing and authorization checks.
- Plan change behavior updated: selecting the Workspace plan now initiates a Stripe Checkout session and returns `{ success, checkout_url }` instead of immediately updating user/workspace plans. The handler persists the Checkout `session_id` and desired plan/workspace name in `users.settings.billing.pending_checkout` and stores a `stripe_customer_id` on the user if needed. The Solo path is unchanged and still returns the prior shape with memberships/workflows.

- Added `POST /api/billing/stripe/webhook` (legacy) and `POST /api/stripe/webhook` (new) to process Stripe webhooks. We verify signatures via the shared `StripeService`.
- Success handling (`checkout.session.completed`):
  - Validates idempotently by matching the event's `data.object.id` against `users.settings.billing.pending_checkout.session_id`. If no match or `pending_checkout` is absent, the handler acknowledges and does nothing.
  - Resolves the user via `metadata.user_id`, `client_reference_id`, or by mapping `customer` to `users.stripe_customer_id`.
  - Creates the user's personal workspace at the Workspace tier using the pending `workspace_name`, sets `users.plan = "workspace"`, assigns the user as `owner`, and optionally shares any `shared_workflow_ids` recorded in `pending_checkout`.
  - Marks onboarding complete when applicable and clears `settings.billing.pending_checkout` plus any prior `last_error/last_error_at`.
- Failure handling (`payment_intent.payment_failed`, `invoice.payment_failed`, `checkout.session.async_payment_failed`, `checkout.session.expired`): When a failure is detected, we:
  - Identify the user either from `checkout.session` metadata/client_reference_id or by mapping `customer` to `users.stripe_customer_id`.
  - Clear `users.settings.billing.pending_checkout` and set `users.settings.billing.last_error`/`last_error_at` to surface retry guidance in the UI.
  - Safeguard the personal plan by rolling back `users.plan` to `solo` if it was set to `workspace` during a provisional upgrade.

- `GET /api/workspaces/onboarding` now includes a `billing` object with `last_error`, `last_error_at`, and `has_pending_checkout` to provide clear client messaging after failed payments. Starting a new checkout clears any prior error state.

- Tests: added coverage to assert that initiating a Workspace upgrade triggers the Stripe mock and returns a Checkout URL without mutating plans, plus integration-style tests for the Stripe webhook handler covering both success (creates workspace, clears pending, sets plan) and failure (records error, clears pending, rolls back plans) paths.

- Workspace OAuth administration now returns `403 Forbidden` when a workspace admin attempts to remove a shared connection that they did not create. The `/api/workspaces/:id/connections/:connection_id` handler surfaces a clear error so clients can prompt users to ask the original sharer to unshare their credential.
- Workspace OAuth-related routes/tests now construct `WorkspaceOAuthService` with the workspace repository so membership checks run before decrypting connections (workspaces API helpers, Microsoft route helpers, and Stripe/account tests were updated to the new constructor).
- Shared the `PlanTier` enum from models and updated workspaces/auth/stripe route tests to rely on the repository-level `get_plan` helper so backend plan gating no longer depends on route-local definitions.
- Workspace OAuth routes serialize and authorize against the new `owner_user_id`/`user_oauth_token_id` fields so multiple shared connections per provider can coexist without clobbering each other in the repository mocks.
- Workspace OAuth routes now resolve shared credentials by explicit connection IDs: Microsoft Teams APIs require a connection_id + scope, and handlers double-check the resolved workspace before issuing tokens so selecting a stale ID can’t leak another workspace’s credentials. Test repositories were updated to track multiple connections for these scenarios.
- Added workspace/member/run quota enforcement with explicit error codes (`workspace_plan_required`, `workspace_member_limit`, `workspace_run_limit`) plus a shared helper module so invites, signup, and workflow run routes all emit consistent JSON payloads.
- Workspaces/auth/account/billing routes now sync or clear `workspace_billing_cycles` based on Stripe subscription data, expose `cycle_started_at` alongside `renews_at`, and wipe stored cycle windows whenever a workspace downgrades back to Solo so quota evaluation matches the real billing window.

## New (Stripe billing plan lifecycle)
- Workspace subscribers now see renewal/reversion dates surfaced in the Plans tab. `GET /api/workspaces/onboarding` attaches `billing.subscription` with:
  - `renews_at` (RFC3339), `cancel_at` (RFC3339|null), and `cancel_at_period_end`.
  - Backed by the new StripeService subscription helpers; we resolve the customer via `users.stripe_customer_id`.
- Downgrading from Workspace to Solo is now scheduled at period end when the user has an active Stripe subscription:
  - `POST /api/workspaces/plan` with `plan_tier: "solo"` sets `cancel_at_period_end = true` on the Stripe subscription and returns `{ success, scheduled_downgrade: { effective_at } }` without mutating local plan fields immediately.
  - For non-Stripe users (or no active subscription), the route preserves the immediate downgrade behavior.
- Webhook handling updated to revert plans when the subscription actually cancels:
  - On `customer.subscription.deleted`, we map the `customer` to a user, set `users.plan = "solo"`, and downgrade any owned workspaces to `"solo"`.

### New endpoint: resume subscription
- `POST /api/workspaces/billing/subscription/resume` clears `cancel_at_period_end` on the active Stripe subscription for the authenticated user�?Ts Stripe customer. Returns the updated renewal date so clients can refresh UI.
- Workspace membership removal/leave flows now call the workspace OAuth purge helper and have regression tests to ensure shared connections are deleted when members depart or workspaces convert to Solo.
