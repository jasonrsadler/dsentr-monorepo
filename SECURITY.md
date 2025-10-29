# Secret Handling Policy

## Purpose and Scope
This policy governs how dsentr engineers create, store, rotate, and consume application secrets across all services in this repository. It applies to credentials, encryption keys, API tokens, signing materials, and any other value that could be used to gain unauthorized access to infrastructure or data. The controls below align with [OWASP Proactive Controls C8: Protect Data Everywhere] and [Seven Pernicious Kingdoms (7PK) – Security Features], ensuring our implementation meets industry guidance for safeguarding sensitive material.

## Environment Isolation
- Generate **unique, per-environment secrets** for local development, QA, staging, and production. Never reuse a token, password, or key between environments, even for temporary testing. (OWASP Proactive Controls C8; 7PK: Security Features)
- Treat production secrets as the highest sensitivity tier. Access to production values requires explicit approval from the service owner and confirmation that the request is tied to an on-call or change-management ticket.
- For developer convenience, provide **non-privileged sandbox accounts** instead of reusing staging or production credentials.

## Secret Storage Requirements
- Store secrets exclusively in **managed secret vaults** such as HashiCorp Vault, AWS Secrets Manager, Google Secret Manager, or Azure Key Vault. Vault policies must enforce least privilege, multi-factor authentication, and audit logging. (OWASP ASVS V3.4 Sensitive Data Protection; 7PK: Security Features)
- Never embed live credentials in source control, build scripts, container images, or CI/CD configuration files. Encrypted values committed to Git must use organization-approved tooling with envelope encryption, key rotation, and access auditing.
- The `.env` templates and example configuration files must only include clear `CHANGEME_` placeholders with references back to this policy.
- Client-delivered bundles **must not** receive secrets. Vite exposes any environment variable that starts with `VITE_` directly to the browser; only values explicitly documented in [`docs/security/vite-public-env-whitelist.json`](docs/security/vite-public-env-whitelist.json) may use that prefix. All other secrets must remain server-side and be delivered through authenticated backend APIs. (OWASP ASVS 12.3.1: Sensitive Data Protection)

## Secret Distribution and Access
- Provision secrets to applications using platform-native integrations (e.g., Vault sidecars, Kubernetes Secrets synced from a vault, AWS IAM roles). Direct injection through SSH sessions or manual copy/paste is prohibited unless performing emergency recovery approved by the security team.
- Rotating or retrieving secrets requires opening a ticket or runbook entry that records: who requested access, the reason, the change ticket, and the expiration of temporary access.
- Production secrets may only be decrypted on hardened build agents or runtime hosts. Local machines must use short-lived tokens or dynamic secrets issued by the vault.

## Rotation Cadence
- Define rotation SLAs for every secret:
  - **Tier 0 (root/signing keys, database superuser passwords): rotate every 30 days** or immediately after any personnel change with access. (OWASP SAMM Operations – Incident Management)
  - **Tier 1 (application service accounts, third-party API keys): rotate every 90 days** or whenever the provider reports credential abuse.
  - **Tier 2 (low-privilege dev/test secrets): rotate every 180 days** or when shared with external collaborators.
- Automate rotation via the vault where possible. Manual rotations require dual verification and post-rotation smoke tests documented in the runbook.

## Commit Hygiene and Tooling
- **Do not commit live credentials**. Add pre-commit hooks and CI scanners (e.g., `gitleaks`, `truffleHog`) to detect accidental exposures. (OWASP Proactive Controls C3: Secure Database Access; 7PK: Errors & Security Features)
- If a secret is accidentally committed, treat it as compromised: revoke it immediately in the provider dashboard or vault, rotate downstream secrets, and document the remediation in the incident tracker.
- Developers must update `.gitignore` whenever new secret files are introduced (e.g., local vault tokens, downloaded key material).

## Incident Response
- Report suspected secret exposure to security@dsentr.com and the on-call channel within 15 minutes of discovery.
- Follow the incident response runbook: revoke affected credentials, rotate dependent secrets, audit access logs, and document timeline and lessons learned.
- Complete a post-incident review within five business days, including any required updates to this policy or engineering runbooks.

## Compliance and Verification
- Product security performs quarterly audits to confirm adherence to this policy, including verifying rotation timestamps, vault access logs, and CI scanning reports.
- Teams must certify compliance during release readiness reviews and note any exceptions with mitigation timelines.
- Updates to this policy require approval from the security lead and must be communicated in release notes and engineering all-hands meetings.

## Approved Third-Party Content Delivery
- The frontend consumes Inter and Fira Code web fonts from the Google Fonts CDN (`https://fonts.googleapis.com` and `https://fonts.gstatic.com`). This dependency is approved for production deployments provided the CSP white list in `frontend/index.html` and `frontend/public/security-headers.conf` references both domains explicitly.
- Engineering must review any additional third-party font or style CDN before use. Submit the review through the security exception workflow so we can capture the risk assessment, CSP updates, and vendor contract references.
- Operations records the CDN approval in the release checklist alongside CSP verification to satisfy OWASP ASVS 14.1.2 and DoD STIG 5.10 traceability requirements.
