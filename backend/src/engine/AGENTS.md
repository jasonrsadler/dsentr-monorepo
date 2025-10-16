# Engine Agent Notes

## Purpose
- Executes workflow runs produced by the scheduler/worker.
- Converts stored workflow graphs into runtime structures and dispatches node-specific handlers.

## Key Modules
- `executor.rs`: Main orchestration loop. Builds the in-memory `Graph`, enforces egress allow/block lists, renews run leases, and invokes action/condition/trigger handlers. Persists node run status via `WorkflowRepository`.
- `graph.rs`: Lightweight parser that extracts `Node`/`Edge` metadata from workflow JSON snapshots and builds adjacency lists.
- `templating.rs`: String interpolation helpers (`{{path.to.value}}`) used across actions for mapping context into parameters.
- `actions/`: Handler implementations:
  - `code.rs`: Runs user-supplied JavaScript snippets via Boa with guarded input/output mapping.
  - `email.rs`: Delivers email through SMTP or AWS SES (signing requests manually) with deduplicated recipients.
  - `google.rs`: Writes rows into Google Sheets using stored OAuth tokens.
  - `http.rs`: Makes outbound HTTP requests while honoring allow/deny host lists and attached auth headers.
  - `messaging.rs`: Sends messages to Slack, Microsoft Teams (via Graph), or Google Chat webhooks.

## Usage Tips
- Each action should return `(outputs, next_node)`; keep outputs JSON-serializable because they flow back into the context map.
- When adding new actions, register them inside `actions/mod.rs` and ensure they respect the allowlist/denylist enforcement enforced in `executor.rs`.
- Avoid blocking operations inside actions; always use async HTTP clients and timeouts to keep workers responsive.
