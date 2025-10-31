# Dashboard Overview

The dashboard is the authenticated control center for DSentr. It combines workspace context, settings access, and the workflow designer in a single layout.

## Accessing the Dashboard

- Visiting `/dashboard` requires authentication. Unauthenticated visitors are redirected through the protected route wrapper to sign in first.【F:src/App.tsx†L35-L70】
- Users who still need to complete onboarding are routed to the workspace onboarding flow before the dashboard loads.【F:src/App.tsx†L22-L54】【F:src/WorkspaceOnboarding.tsx†L1-L88】

## Layout Anatomy

The dashboard layout renders a global header and an outlet for dashboard pages.【F:src/layouts/DashboardLayout.tsx†L1-L200】【F:src/layouts/DashboardLayout.tsx†L222-L318】

### Header Controls

- **Workspace switcher** – Displays the current workspace name and lets members change context. When you belong to exactly one workspace, DSentr auto-selects it and keeps the `?workspace=` query parameter in sync with the switcher.【F:src/layouts/DashboardLayout.tsx†L32-L109】【F:src/layouts/DashboardLayout.tsx†L111-L166】
- **Plan badge** – Shows the active plan (Solo or Workspace) derived from the workspace membership or your personal plan. This label informs which features are available in other tabs.【F:src/layouts/DashboardLayout.tsx†L168-L189】
- **Theme toggle** – Quickly switch between light and dark modes using the header toggle button.【F:src/layouts/DashboardLayout.tsx†L5-L8】【F:src/layouts/DashboardLayout.tsx†L222-L250】
- **Settings button** – Opens the modal that hosts tabs for plan, members, engine, logs, webhooks, options, integrations, and workflows. The layout remembers the last requested tab and can deep-link into the integrations tab after OAuth flows.【F:src/layouts/DashboardLayout.tsx†L10-L24】【F:src/layouts/DashboardLayout.tsx†L190-L259】
- **Profile menu** – Manages personal account actions such as viewing account details or logging out via the profile modal.【F:src/layouts/DashboardLayout.tsx†L19-L24】【F:src/layouts/DashboardLayout.tsx†L260-L318】

### Notifications and Notices

Solo plan usage warnings render under the header. When plan or integration events occur (for example, a new OAuth connection is authorized), the layout surfaces contextual notices inside the settings modal for immediate feedback.【F:src/layouts/DashboardLayouts/Dashboard.tsx†L58-L108】【F:src/layouts/DashboardLayout.tsx†L190-L259】

## Main Content

Inside the layout outlet, DSentr currently renders the **Workflow Designer** page. Use the sidebar, canvas, and toolbar to manage workflows and runs. Refer to the [Workflow Designer guide](./workflow-designer.md) for a detailed breakdown.【F:src/layouts/DashboardLayouts/Dashboard.tsx†L1-L120】【F:src/layouts/DashboardLayouts/Dashboard.tsx†L244-L336】
