# Engine Actions Agent Notes

## Purpose
- Houses the concrete node executors invoked by `engine::executor`.
- Each module exposes an async function returning `(serde_json::Value, Option<String>)` where the optional string selects the next node.

## Modules
- `code.rs`: Runs custom JavaScript via Boa, marshals templated inputs, and maps outputs back into context keys while preventing duplicate parameter names.
- `email.rs`: Supports SMTP and AWS SES delivery with recipient validation, optional TLS settings, and request signing. Applies a per-node timeout to avoid hanging workers.
- `google.rs`: Uses stored Google OAuth tokens to append rows to Google Sheets. Validates column mappings, enforces account ownership, and builds ranges safely.
- `http.rs`: Provides configurable HTTP requests with support for headers, query/body templating, retries, and allow/deny host enforcement.
- `messaging.rs`: Sends messages to Slack (chat.postMessage), Microsoft Teams (via Graph API channel/tenant metadata), or Google Chat webhooks. Normalizes platform identifiers and handles OAuth token refresh for Teams.
- `mod.rs`: Router that chooses between trigger/condition/action handlers and shared helpers (`parse_expression`, templating, etc.).

## Usage Tips
- Keep new action modules stateless—pass everything via parameters and the shared `AppState`.
- Validate all user-provided inputs before performing network calls; return `Err(String)` with actionable error messages so UI surfaces them cleanly.
- Prefer adding small helper structs/functions within each module rather than extending `mod.rs` unless they are shared across actions.

## Change Reasons
- Teams routing now infers Delegated OAuth when `teamId` + `channelId` are provided (and `oauthProvider` is Microsoft) even if `deliveryMethod` is omitted. This prevents silent fallback to the Incoming Webhook path and "sent" logs without posting to the intended channel after the node refactor.
