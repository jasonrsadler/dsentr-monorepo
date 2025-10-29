# Frontend Security Remediation Notes

## Scope
Assessment of the React frontend's API utilities (`src/lib`), shared state (stores, contexts, hooks, layouts), and bootstrapping (`src/css/globals.css`, `src/main.tsx`) for alignment with OWASP Frontend, OWASP 7PK data validation, DoD STIG 5.10, and Micro Focus Fortify control expectations.

## Findings & Recommended Actions

### 1. CSRF token cache persists across sessions
- **Evidence:** `getCsrfToken` caches the value module-wide and never clears it; `logout` relies on the cached token without invalidating it.【F:frontend/src/lib/csrfCache.ts†L1-L20】【F:frontend/src/stores/auth.ts†L147-L165】
- **Impact:** Re-using stale tokens after logout undermines per-session CSRF guarantees and violates OWASP guidance on one-time tokens. An attacker who forces logout/login flows could benefit from token fixation.
- **Recommendation:** Reset the cache when calling `logout`, on authentication errors, and after any 403/419 responses; optionally scope the cache per user session by storing the token alongside a session identifier.
- **Control Mapping:** OWASP Frontend CSRF Protections, OWASP 7PK Input Validation (canonicalization of anti-CSRF state), STIG 5.10 session management, Fortify "Missing Cache Invalidation for CSRF Tokens".

### 2. Invite accept/decline endpoints skip CSRF headers
- **Evidence:** `postInviteDecision` submits POST requests with credentials but omits the `x-csrf-token` header used elsewhere for state-changing requests.【F:frontend/src/lib/orgWorkspaceApi.ts†L262-L294】
- **Impact:** Requests initiated by untrusted origins can succeed if cookie-based authentication is present, defeating CSRF defenses for invite workflows.
- **Recommendation:** Fetch a CSRF token via `getCsrfToken()` and attach it to the headers for accept/decline calls; add error handling to surface missing token scenarios.
- **Control Mapping:** OWASP Frontend CSRF Protections, OWASP 7PK Authentication and Session Management, STIG 5.10 least-privilege workflow controls, Fortify "Missing Anti-CSRF Token".

### 3. Workspace selection persists in localStorage without session scoping
- **Evidence:** The auth store writes `dsentr.currentWorkspaceId` directly to `window.localStorage`, leaving workspace context available to any script and surviving logout/logins for different users.【F:frontend/src/stores/auth.ts†L45-L165】
- **Impact:** Cross-site scripting could exfiltrate workspace identifiers; stale context can auto-select a workspace a new user should not access, conflicting with least-privilege workspace switching guidance.
- **Recommendation:** Store workspace context in HTTP-only cookies or sessionStorage tied to the authenticated user, and clear it whenever `logout` runs or membership changes fail.
- **Control Mapping:** OWASP Frontend Secure Storage, OWASP 7PK Authorization Enforcement, STIG 5.10 least-privilege workspace separation, Fortify "Insecure Client Storage of Sensitive Information".

### 4. Form payloads rely on unsanitized caller input
- **Evidence:** `signupUser` spreads caller-provided fields directly into the JSON body, only lowercasing the email address before transmission.【F:frontend/src/lib/authApi.ts†L18-L50】
- **Impact:** Client-side canonicalization is inconsistent, allowing mixed-case or script-injected fields to traverse the SPA unchanged. While the backend should validate, OWASP 7PK recommends layered input normalization to prevent malicious echo or logging issues on the frontend.
- **Recommendation:** Normalize and trim user-provided strings before serialization (e.g., strip control characters, enforce length constraints) and centralize helper utilities for reuse across API clients.
- **Control Mapping:** OWASP Frontend Data Validation, OWASP 7PK Input Validation, STIG 5.10 data handling, Fortify "Insufficient Input Validation".

### 5. Bootstrapping lacks client-side mitigation hooks for CSP/clickjacking
- **Evidence:** `main.tsx` only mounts the app and loads Stripe.js; no runtime enforcements (e.g., meta `http-equiv="Content-Security-Policy"`, frame-busting logic) exist in the frontend assets.【F:frontend/src/main.tsx†L1-L17】
- **Impact:** Hosting platforms must supply CSP and frame-ancestors headers; without frontend fallbacks, misconfigured deployments remain vulnerable to clickjacking or script injection alongside third-party Stripe content.
- **Recommendation:** Document required CSP/frame-ancestors headers for deployers, add optional runtime checks (e.g., frame-busting script), and consider dynamic nonce/meta tag injection during boot.
- **Control Mapping:** OWASP Frontend Secure Headers, OWASP 7PK Environment hardening, STIG 5.10 UI redress protection, Fortify "Missing Clickjacking Protection" / "Missing Content Security Policy".

## Next Steps
1. Prioritize CSRF hardening (Findings 1 & 2) to close outright protection gaps.
2. Rework workspace persistence to follow least-privilege scoping, clearing state upon logout and membership churn.
3. Introduce shared sanitization utilities for form payloads and document CSP/header requirements in deployment guides.
