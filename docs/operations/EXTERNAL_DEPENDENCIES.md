# External Dependency Register

To satisfy OWASP ASVS 14.1.2 and DoD STIG 5.10 reporting requirements, operations maintains this register of externally hosted assets that the frontend depends on at runtime.

## Google Fonts CDN
- **Purpose:** Hosts the Inter and Fira Code web fonts referenced by `frontend/index.html`.
- **Approved Domains:** `https://fonts.googleapis.com` (CSS manifests) and `https://fonts.gstatic.com` (font binaries). Both origins are enumerated in the production CSP and deployment header template.
- **Change Management:** Any modification to the font families or providers must:
  1. Update the CSP (`frontend/index.html` and `frontend/public/security-headers.conf`).
  2. Note the change in the release checklist under "External Dependencies".
  3. File a security review ticket documenting risk evaluation and mitigation.
- **Monitoring:** Track CSP violation reports for blocked font requests. Unexpected rejections should trigger an incident ticket so we can confirm no unauthorized CDN was introduced.

Record additional external dependencies in this file with the same fields before rollout.
