# Workflow Snapshot Connection Metadata

Workflow snapshots store the raw node configuration that the engine executes. OAuth-enabled
actions historically relied on legacy fields such as `accountEmail` (Google Sheets) and
`oauthConnectionId` (Teams delegated messaging) to identify which credential should be used
at runtime. Newer snapshots promote this information to a dedicated `connection` object to
support workspace-level OAuth connections while remaining backward compatible with the
legacy fields.

```json
{
  "params": {
    "connection": {
      "connectionScope": "workspace", // "workspace" or "user"
      "connectionId": "00000000-0000-0000-0000-000000000000",
      "accountEmail": "owner@example.com" // optional, used for UI display/validation
    },
    "oauthConnectionId": "microsoft",  // still persisted for legacy nodes
    "accountEmail": "owner@example.com" // legacy Sheets field
  }
}
```

* `connectionScope` indicates whether the engine should resolve a personal user token or a
  workspace connection.
* `connectionId` is required for workspace-scoped entries and should be the UUID of the
  promoted workspace connection. For user-scoped entries the field is optional and may retain
  legacy identifiers (for example the literal string `"microsoft"`).
* `accountEmail` remains optional but, when provided, is validated against the resolved token
  so that mismatched selections surface clear run-time errors.
* Legacy fields are still honored to keep existing snapshots valid. The engine helper first
  inspects the `connection` object and only falls back to `accountEmail`/`oauthConnectionId`
  when the object is not present.

When updating node serializers in the frontend, prefer writing both the new `connection`
object and the legacy fields until the migration is complete. This ensures older workflow
runs and downstream tooling continue to operate without requiring immediate re-publishing of
existing workflows.
