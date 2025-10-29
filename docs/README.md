# Contributor Documentation

## Secret Management Expectations
- Provision all secrets through the managed vault workflow described in [SECURITY.md](../SECURITY.md).
- Replace every `CHANGEME_...` placeholder in environment templates with vault-issued credentials scoped to the target environment.
- Document rotation and access changes in the appropriate runbook or ticket to keep audit trails complete.

## Client-Side Environment Variables (`VITE_` prefix)
- OWASP ASVS 12.3.1 requires that sensitive secrets remain on trusted servers. Vite automatically inlines any variable prefixed with `VITE_` into the browser bundle, so **only non-sensitive configuration may use this prefix**.
- The vetted list of public variables lives in [`docs/security/vite-public-env-whitelist.json`](./security/vite-public-env-whitelist.json). Each entry documents the review date, approver, and justification for exposing the value to clients.
- Before proposing a new `VITE_` variable:
  1. Partner with the backend service owners to confirm no server-side secret or privileged capability is required.
  2. Open a security review ticket that captures the risk analysis and the backend sign-off.
  3. Update the white list file with the approved metadata so CI knows the variable passed review.
- If a use case requires a sensitive value, design the feature so the browser requests it from the backend via authenticated APIs rather than injecting it through a `VITE_` variable.

## Database Bootstrap Responsibilities
- Run the bootstrap migration sequence using the privileged `dsentr_owner` role (or a session that inherits from it) so the database, schema, and tables are owned by the hardened administrator role introduced in the initial migration set.
- After the bootstrap completes, delegate day-to-day connections to the `dsentr_app` and `dsentr_readonly` roles as appropriate; they are granted only the minimal privileges required for runtime access.
- Avoid running migrations or manual SQL as `PUBLIC` or superuser accounts unless you explicitly need to break glass for incident response—doing so will bypass the hardened default privileges.

## Additional References
- Review the backend `.env.template` comments before configuring local services to ensure placeholder credentials are never reused in shared environments.
- Contact the security team in `#security-internal` on Slack if you have questions about secret rotation or vault onboarding.

## JavaScript Dependency Lockfiles
- The repository does **not** use a root npm workspace. Each JavaScript project (for example `frontend/` and `frontend/docs-site/`) owns its own `package.json` and corresponding `package-lock.json`.
- Run `npm install` from within the project directory you are working on so the right lockfile is updated.
- If you see a repository-level `package-lock.json`, delete it instead of committing it—those stub lockfiles are ignored by npm and create confusion about our actual dependency state.

## Dependency Security Audits
- All pull requests and pushes trigger the `Dependency Audit` workflow, which must pass before merge. Mark the workflow as a required status check in GitHub branch protection rules so dependency regressions block merges until resolved.
- JavaScript packages are audited twice per project (`npm audit --omit=dev` and `npm audit --production`) for both `frontend/` and `frontend/docs-site/` to cover runtime and production-only advisories.
- Packages that run install scripts (currently `esbuild` and `fsevents`) are gated by checksum verification inside the workflow. When either package or its tarball integrity changes, the workflow will fail and requires a manual review of the new artifact before updating the white list.
- Rust crates are scanned with `cargo audit` in `backend/`. Add any new Rust workspace members to the job matrix to keep coverage complete.
