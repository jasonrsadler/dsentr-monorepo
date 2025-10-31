# Frontend UI Security Hardening Review

## Scope
- Shared primitives under `src/components/UI` and `src/components/ui`
- Authentication and workspace navigation buttons (`GoogleLoginButton`, `GoogleSignupButton`, `OAuthButton`, `MobileNav`, `NavLinks`)
- Marketing surfaces in `src/components/marketing`

## Observations
### Shared UI primitives
- React components that render user-supplied strings rely on JSX escaping (no `dangerouslySetInnerHTML`) and clamp or sanitize length, which aligns with OWASP ASVS V3 output encoding expectations.【F:frontend/src/components/ui/InputFields/NodeInputField.tsx†L36-L70】【F:frontend/src/components/ui/InputFields/NodeTextAreaField.tsx†L32-L58】
- Dropdown implementations expose only text content; options are normalized to strings, grouped safely, and rendered via semantic list roles, minimizing HTML injection risk (OWASP ASVS V5.3, Fortify: Cross-Site Scripting).【F:frontend/src/components/ui/InputFields/NodeDropdownField.tsx†L58-L195】
- Secret handling masks values in the UI and trims inputs before persisting, reducing accidental disclosure in logs, but the trigger button lacks ARIA state attributes that should accompany custom popovers (STIG V5.10 accessibility clause, OWASP ASVS V1.5, 7PK: User Interface).【F:frontend/src/components/ui/InputFields/NodeSecretDropdown.tsx†L66-L188】
- Dialog primitives animate safely and avoid inline HTML, yet neither `JsonDialog` nor `ConfirmDialog` advertise `role="dialog"`/`aria-modal`, leaving assistive technologies unaware of focus traps (OWASP ASVS V1.5, STIG V5.10).【F:frontend/src/components/ui/dialog/JsonDialog.tsx†L20-L57】【F:frontend/src/components/ui/dialog/ConfirmDialog.tsx†L20-L47】

### Authentication buttons and navigation
- OAuth/login buttons render provider assets without external URLs and avoid inline scripts, meeting Fortify checks for HTML script injection.【F:frontend/src/components/GoogleLoginButton.tsx†L11-L23】【F:frontend/src/components/OAuthButton.tsx†L16-L27】
- `OAuthButton` omits `type="button"`; if mounted inside a `<form>`, it will submit unintentionally, conflicting with STIG 5.10 safe handler guidance and OWASP ASVS V4.3 (secure defaults).【F:frontend/src/components/OAuthButton.tsx†L17-L27】
- Mobile navigation toggles state with explicit `aria-label`, but the toggle button should also declare `type="button"` to avoid implicit submit behavior in composed forms (7PK: User Interface, STIG 5.10).【F:frontend/src/components/MobileNav.tsx†L15-L33】
- Navigation links are SPA-internal `NavLink` elements with no external targets, keeping them within the same origin and satisfying STIG 5.10’s safe link target expectation.【F:frontend/src/components/NavLinks.tsx†L13-L37】

### Marketing components
- Branding shells display gradients and inline SVG logos only; no remote scripts, API tokens, or secret configuration strings are present (Fortify: Insecure Data Storage).【F:frontend/src/components/marketing/MarketingShell.tsx†L9-L28】【F:frontend/src/components/marketing/BrandHero.tsx†L27-L53】

## Hardening Backlog
| Area | Finding | Risk | Standards Mapping | Recommendation |
| --- | --- | --- | --- | --- |
| NodeSecretDropdown | Missing `aria-haspopup`, `aria-expanded`, and keyboard support on the toggle for the secrets list.【F:frontend/src/components/ui/InputFields/NodeSecretDropdown.tsx†L123-L188】 | Reduced accessibility and potential focus leaks violate STIG 5.10 UI control requirements. | OWASP ASVS V1.5, STIG V5.10, 7PK (User Interface), Fortify: Accessibility | Add ARIA attributes mirroring `NodeDropdownField`, implement Escape/arrow key handlers, and ensure focus trapping within the popover. |
| JsonDialog / ConfirmDialog | Dialog containers lack `role="dialog"`, `aria-modal`, and focus return hooks.【F:frontend/src/components/ui/dialog/JsonDialog.tsx†L20-L57】【F:frontend/src/components/ui/dialog/ConfirmDialog.tsx†L20-L47】 | Screen readers may miss modal context, leading to disoriented navigation (STIG 5.10). | OWASP ASVS V1.5, STIG V5.10, 7PK (User Interface), Fortify: Accessibility | Annotate wrappers with `role`, `aria-modal`, focus sentinels, and restore focus to the invoker on close. |
| OAuthButton | Button defaults to `type="submit"`, risking unintended form posts during OAuth initiation.【F:frontend/src/components/OAuthButton.tsx†L17-L27】 | Could trigger duplicate submissions or bypass CSRF tokens, violating secure handler guidance. | OWASP ASVS V4.3, STIG V5.10, 7PK (API Abuse), Fortify: Dangerous UI Actions | Set `type="button"`, require explicit click handlers, and wrap redirects in verified workspace context guards. |
| MobileNav toggle | Toggle button misses explicit `type="button"`; same risk as above if nested within forms.【F:frontend/src/components/MobileNav.tsx†L15-L33】 | Form submissions may fire unexpectedly, disrupting auth flows. | OWASP ASVS V4.3, STIG V5.10, 7PK (User Interface), Fortify: Dangerous UI Actions | Add `type="button"` and guard `setOpen` with workspace-aware routing checks when used inside authenticated shells. |
| NavigateButton | Renders a `<button>` inside a `<Link>`, creating nested interactive elements without ARIA reconciliation.【F:frontend/src/components/ui/buttons/NavigateButton.tsx†L13-L24】 | Confusing focus order and duplicate activation paths (STIG 5.10). | OWASP ASVS V1.5, STIG V5.10, 7PK (User Interface), Fortify: Accessibility | Replace with a styled `<Link>` or move navigation to button `onClick` that calls router navigation, ensuring a single interactive element. |
| Secret creation flow | Newly saved secrets echo their raw value back via `onChange(trimmedValue)`, keeping plaintext in component trees.【F:frontend/src/components/ui/InputFields/NodeSecretDropdown.tsx†L102-L170】 | In-memory exposures can leak via debugging tools (7PK: Insecure Storage). | OWASP ASVS V3.3, STIG V5.10, 7PK (Insecure Storage), Fortify: Insecure Storage | Switch to returning a secret identifier after persistence and mask locally cached values. |
