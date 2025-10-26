# Settings & Administration

Open the Settings button in the dashboard header to manage plans, people, and platform integrations. Each tab enforces plan and role permissions based on your workspace membership.

## Plan & Billing

- Review available plan tiers (Solo and Workspace) with descriptions, prices, and the currently active selection. Dsentr fetches live plan options from the onboarding API but falls back to sensible defaults if unavailable.【F:src/components/Settings/tabs/PlanTab.tsx†L1-L89】
- Owners can upgrade or downgrade between plans, rename the workspace for team plans, and see status messages after changes. Solo plans require only a confirmation, while Workspace plans prompt for a workspace name before submission.【F:src/components/Settings/tabs/PlanTab.tsx†L91-L187】【F:src/components/Settings/tabs/PlanTab.tsx†L189-L268】
- Submissions send CSRF-protected requests to the `/api/workspaces/onboarding` endpoint and refresh memberships so the rest of the UI reflects the new plan immediately.【F:src/components/Settings/tabs/PlanTab.tsx†L214-L309】【F:src/components/Settings/tabs/PlanTab.tsx†L311-L378】

## Members

- View all members of the active workspace with their roles and contact information. Owners and admins can invite new members by email, specify roles, and set invite expiration windows.【F:src/components/Settings/tabs/MembersTab.tsx†L1-L92】【F:src/components/Settings/tabs/MembersTab.tsx†L120-L187】
- Invitations list pending requests, allow revocation, and respect plan tiers—member management is only available on Workspace plans with sufficient permissions.【F:src/components/Settings/tabs/MembersTab.tsx†L94-L152】【F:src/components/Settings/tabs/MembersTab.tsx†L188-L273】
- Removing a member triggers secret ownership checks so shared credentials are handled safely. Members who lose access are redirected to their remaining workspaces or Solo plan automatically.【F:src/components/Settings/tabs/MembersTab.tsx†L188-L273】【F:src/components/Settings/tabs/MembersTab.tsx†L274-L374】

## Integrations

- Connect Google, Microsoft, or Slack accounts for OAuth-powered actions. The tab loads personal and workspace-level connections, surfaces expiration or revocation warnings, and lets admins promote personal credentials to shared workspace credentials.【F:src/components/Settings/tabs/IntegrationsTab.tsx†L1-L121】【F:src/components/Settings/tabs/IntegrationsTab.tsx†L123-L233】
- Reconnect, refresh, or disconnect providers from the same screen. Admins can unshare workspace connections or remove them entirely, while Solo users see plan upgrade prompts for restricted features.【F:src/components/Settings/tabs/IntegrationsTab.tsx†L235-L344】【F:src/components/Settings/tabs/IntegrationsTab.tsx†L346-L470】
- The tab accepts notices passed from OAuth callback routes so successful and failed connections open the modal with contextual messaging automatically.【F:src/layouts/DashboardLayout.tsx†L190-L259】【F:src/components/Settings/tabs/IntegrationsTab.tsx†L472-L547】

## Secrets & API Keys

- Organize service credentials across categories such as Email, Messaging, Webhooks, and HTTP. Dsentr merges stored secrets with predefined descriptors so new entries automatically gain a labeled form.【F:src/components/Settings/tabs/OptionsTab.tsx†L1-L86】【F:src/components/Settings/tabs/OptionsTab.tsx†L88-L179】
- Create or update secrets inline with validation and optimistic UI states. Owners and admins can delete any secret, while other roles can only remove entries they created.【F:src/components/Settings/tabs/OptionsTab.tsx†L181-L261】【F:src/components/Settings/tabs/OptionsTab.tsx†L263-L357】
- Deleting a secret triggers a confirmation dialog and respects role-based permissions before removing it from the store.【F:src/components/Settings/tabs/OptionsTab.tsx†L359-L469】

## Engine Controls

- Adjust per-workflow concurrency limits, cancel queued runs, purge historical run data, and manage outbound egress allowlists. Solo plans are capped at single-run concurrency and display a notice when attempting to raise the limit.【F:src/components/Settings/tabs/EngineTab.tsx†L1-L104】【F:src/components/Settings/tabs/EngineTab.tsx†L106-L188】
- Owners and admins can update limits, purge runs, and configure egress domains, while viewers are restricted to read-only access.【F:src/components/Settings/tabs/EngineTab.tsx†L188-L302】

## Logs & Run History

- Inspect executed runs, dead-letter queues, blocked egress attempts, and configuration change history. Each tab provides filtering, contextual metadata (trigger type, credential usage), and access to raw JSON payloads via the JSON dialog.【F:src/components/Settings/tabs/LogsTab.tsx†L1-L120】【F:src/components/Settings/tabs/LogsTab.tsx†L122-L236】
- From the same view, requeue dead letters, clear blocked egress events, and mask sensitive values using the secret masking utilities tied to the workspace’s stored credentials.【F:src/components/Settings/tabs/LogsTab.tsx†L238-L414】【F:src/components/Settings/tabs/LogsTab.tsx†L416-L596】

## Webhooks

- Generate inbound webhook URLs for each workflow, copy ready-to-use curl/PowerShell/JavaScript examples, and optionally require HMAC signatures with a configurable replay window.【F:src/components/Settings/tabs/WebhooksTab.tsx†L1-L120】【F:src/components/Settings/tabs/WebhooksTab.tsx†L122-L206】
- Regenerate webhook URLs with confirmation prompts and guardrail messaging to prevent accidental breakage of external integrations.【F:src/components/Settings/tabs/WebhooksTab.tsx†L208-L294】

## Workflow Management

- Select any workflow in the workspace, confirm deletions by retyping the workflow name, and remove it after acknowledging the confirmation dialog.【F:src/components/Settings/tabs/WorkflowsTab.tsx†L1-L120】
- When a workflow is deleted, Dsentr emits a global `workflow-deleted` event so other parts of the app can refresh state without reloading.【F:src/components/Settings/tabs/WorkflowsTab.tsx†L120-L158】
