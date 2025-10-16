# Auth Routes Agent Notes

## Purpose
- Handles authentication, session management, and account lifecycle flows (signup, login, verification, password reset).

## Key Modules
- `claims.rs`: JWT claim shape shared between encoding/decoding.
- `session.rs`: `AuthSession` extractor that validates the `auth_token` cookie and injects `Claims`.
- `login.rs`: Username/password login plus `/me` endpoint that hydrates workspace context.
- `logout.rs`: Clears session cookie and returns a standard success payload.
- `signup.rs`: Creates users via email/password or OAuth bootstrap, sends verification email.
- `verify.rs`: Confirms email verification tokens and marks account verified.
- `forgot_password.rs`: Issues password reset tokens and sends reset emails.
- `reset_password.rs`: Validates reset tokens and sets new passwords.
- `google_login.rs` / `github_login.rs`: Provider-specific OAuth login flows (start + callback) that exchange codes and set session cookies.
- `mod.rs`: Exports route handlers for easy imports elsewhere.

## Usage Tips
- Reuse `JsonResponse` helpers for consistent error handling; the frontend depends on the `success/message` contract.
- Any new handler that needs authentication should accept `AuthSession` and derive the user ID via `claims.id`.
- Password hashing/verification lives in `utils::password`; keep crypto concerns centralized there.
- Signup handlers must honor workspace invitations: call `workspace_repo.find_invitation_by_token` to validate incoming tokens, attach members or mark invites declined accordingly, and provision a Solo workspace when no invite is accepted.
