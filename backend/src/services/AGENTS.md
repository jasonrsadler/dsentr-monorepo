# Services Agent Notes

## Purpose
- Integration-facing layers that wrap external APIs (Microsoft Graph, OAuth providers, SMTP).
- Exposed to routes/engine via traits so they can be mocked in tests.

## Modules
- `microsoft`: Fetches Teams/channels/members via Microsoft Graph REST API with friendly structs and error handling.
- `oauth`: Houses shared OAuth account management plus provider-specific clients/services.
- `smtp_mailer`: Trait + implementations for sending transactional email (real SMTP + mock).

## Usage Tips
- Keep external HTTP calls in these modules; routes should only orchestrate and shape responses.
- Provide mock implementations in each module so tests remain deterministic (see `MockMailer`, `mock_github_oauth`, `mock_google_oauth`).
