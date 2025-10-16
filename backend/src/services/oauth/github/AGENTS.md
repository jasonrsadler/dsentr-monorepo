# GitHub OAuth Agent Notes

## Purpose
- Implements the GitHub OAuth login flow and exposes a trait used by auth routes.

## Modules
- `service.rs`: Defines `GitHubOAuthService` trait and `GitHubUserInfo` DTO.
- `client.rs`: Real implementation that calls GitHub's token and user APIs via `reqwest`, reading credentials from env vars.
- `errors.rs`: Error enum covering state validation, HTTP failures, and downstream DB/JWT issues.
- `models.rs`: Callback/input models (`GitHubCallback`, `GitHubToken`).
- `mock_github_oauth.rs`: Simple in-memory implementation for tests.
- `mod.rs`: Re-exports the submodules.

## Usage Tips
- Always configure `GITHUB_OAUTH_TOKEN_URL`, `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET` in the environment before invoking `GitHubOAuthClient`.
- When extending functionality (e.g., adding repo scopes), keep `GitHubToken` and `GitHubUserInfo` serialization in sync with GitHub's API responses.
