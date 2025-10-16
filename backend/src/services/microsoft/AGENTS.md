# Microsoft Service Agent Notes

## Purpose
- Thin client around Microsoft Graph endpoints used by workflow messaging helpers and Microsoft route APIs.

## Key Functions
- `fetch_joined_teams`: Lists teams the authenticated user belongs to.
- `fetch_team_channels`: Lists channels for a given team.
- `fetch_channel_members`: Lists members in a channel.
- Shared helpers (`graph_get`, `build_url`, `extract_error_message`) normalize requests/responses and surface friendly `MicrosoftGraphError` variants.

## Usage Tips
- Always pass an `reqwest::Client` from `AppState` so connection pools are reused.
- The helpers trim/sanitize IDs; ensure inputs are URL-encoded before forwarding user-provided values.
- Extend `MicrosoftGraphError` rather than returning raw `reqwest::Error` to keep upstream error handling consistent.
