# Options Routes Agent Notes

## Purpose
- Manage per-user option data exposed in settings panels, currently focused on encrypted secret storage.

## Key Modules
- `mod.rs`: Re-exports the `secrets` handlers for cleaner imports.
- `secrets.rs`: CRUD endpoints for named secrets grouped by `<group>/<service>/<name>`. Relies on `utils::secrets` helpers to validate and persist data inside the user's JSON settings blob. Also includes `sync_secrets_from_workflow` helper so workflow saves auto-populate missing secrets.

## Usage Tips
- Always canonicalize path parameters before storing (lowercasing, trimming); reuse `canonicalize_key`.
- When adding new settings sections, follow the pattern of loading/updating user settings via `AppState.db` to keep the JSON schema consistent.

## Change Reasons
- Enforced workspace-scoped secret aggregation so membership checks and creator/admin deletion rules are handled on the server.
- Secrets endpoints now encrypt persisted API keys with `API_SECRETS_ENCRYPTION_KEY`, re-encrypt legacy plaintext settings on read/write, and align with the rotation helper so sensitive values never sit in cleartext.
- Added user-settings endpoints to read/update per-workspace `workflows.runaway_protection_enabled`, enabling the Settings UI toggle for runaway workflow protection.
- Workspace secret creation now emits change-history entries (without values) so logs can show who added shared secrets.
