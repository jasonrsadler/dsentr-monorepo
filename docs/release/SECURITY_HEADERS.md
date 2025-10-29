# Content Security Policy Deployment Guide

To satisfy OWASP ASVS 14.4 and STIG 5.10.1 we serve the frontend with a strict Content Security Policy (CSP) and related security headers.

## Header configuration

Use the header stanza in `frontend/public/security-headers.conf` as the source of truth when configuring the CDN or reverse proxy that serves the built frontend. The policy enforces:

- `default-src 'self'`
- `script-src 'self' https://js.stripe.com`
- `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com` (Inter and Fira Code are loaded from the Google Fonts CDN; browsers still require `'unsafe-inline'` rather than `style-src-attr` for React-rendered inline styles.)
- `font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com data:`
- `connect-src 'self' https://api.dsentr.com https://js.stripe.com https://api.stripe.com` (extend this list for any additional API origins used in production.)
- Supporting directives for frames, forms, and strict transport security.

For deployments that inject inline scripts (for example, analytics tags during incident debugging), generate a per-request nonce value, append `'nonce-<value>'` to the `script-src` directive, and apply the same nonce attribute to the approved inline script tags.

## Build integration

- `frontend/index.html` ships without inline scripts. The theme bootstrapper now executes from `src/themeBootstrapper.ts`, keeping CSP compatible with strict `script-src` requirements.
- The development meta tag also whitelists `https://localhost:3000` and the Vite dev server websocket (`ws://localhost:5173` / `wss://localhost:5173`) so local builds continue to function under CSP.
- When creating additional entry points, either reference bundled modules or attach the deployment nonce described above.

## Verification

1. After deploying, visit the application in a browser and confirm the CSP response header matches `security-headers.conf`.
2. Use the browser console (`document.contentSecurityPolicy`) or security scanners to ensure violations are not reported.
3. Record CSP verification in the release checklist alongside other security controls.

Document any deviations from the baseline policy (for example, additional API origins added to `connect-src`) in the release notes. When adding or removing font providers, update both directives so the external domains remain explicitly enumerated for ASVS 14.1.2 and STIG 5.10 traceability.
