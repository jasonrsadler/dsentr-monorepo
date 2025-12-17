# Services Agent Notes

## Purpose
- Integration-facing layers that wrap external APIs (Microsoft Graph, OAuth providers, SMTP).
- Exposed to routes/engine via traits so they can be mocked in tests.

## Modules
- `microsoft`: Fetches Teams/channels/members via Microsoft Graph REST API with friendly structs and error handling.
- `oauth`: Houses shared OAuth account management plus provider-specific clients/services.
- `smtp_mailer`: Trait + implementations for sending transactional email (real SMTP + mock).
- `stripe`: Trait-based Stripe integration for Checkout Sessions, webhook verification, and event retrieval with a live SDK-backed client and a mock for tests.

## Usage Tips
- Keep external HTTP calls in these modules; routes should only orchestrate and shape responses.
- Provide mock implementations in each module so tests remain deterministic (see `MockMailer`, `mock_github_oauth`, `mock_google_oauth`).

## Change Reasons
- Introduced workspace OAuth service for cloning encrypted tokens into workspace-level connections and emitting audit events.
- Added `stripe` service: unified trait for creating Checkout Sessions, verifying webhooks safely, and retrieving events; live implementation wraps `async-stripe` and mock captures calls for deterministic tests.
 - Extended StripeService to support customer creation (`create_customer`) and enriched Checkout Session requests with `customer` and `metadata` fields so routes can associate sessions with users and desired workspace upgrades.
 - New: subscription helpers for plan lifecycle — `get_active_subscription_for_customer` and `set_subscription_cancel_at_period_end` — so routes can display renewal dates and schedule downgrades at period end without immediate plan changes. The mock tracks a synthetic `active_subscription` to keep tests deterministic.
- Stripe `SubscriptionInfo` now exposes `current_period_start`, and both live/mocked clients populate it so routes/AppState can persist billing cycle anchors for quota resets.
- Stripe service now reports overage usage via billing meter events (`create_meter_event`), posting the configured event name with customer id/value payloads; the mock records emitted meter events for assertion in tests.
- Tests: added unit tests for the Stripe service validating request construction (via the mock capturing last requests) and error mapping (invalid webhook signature, invalid customer id parsing) without hitting the network.
- Workspace OAuth service adds connection purge helpers plus dedicated mocks/tests so member removals can revoke shared tokens and audit deletions consistently.
- Workspace OAuth workflows now persist `owner_user_id`/`user_oauth_token_id` on shared connections and ensure permission checks, mocks, and decrypt helpers respect the new ownership contract.
 - Workspace OAuth service now tolerates nullable `user_oauth_token_id` values so personal token deletions set workspace connection references to NULL instead of cascading deletes.
 - Added Asana provider support to the OAuth service so Asana tokens refresh, revoke, and promote alongside existing Google/Microsoft/Slack credentials.
- OAuth services now support connection-id aware installs/refresh/revoke flows, avoid provider-level overwrites on new installs, and include unit coverage for multi-connection selection.
- OAuth account refresh now propagates updated encrypted tokens into dependent workspace connections via repository lookups, logging sync failures without interrupting the personal token update.
