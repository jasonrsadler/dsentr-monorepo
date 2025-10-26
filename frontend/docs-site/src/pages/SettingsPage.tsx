export function SettingsPage() {
  return (
    <article className="page-card">
      <h2>Settings & administration</h2>
      <p>
        The settings modal centralizes plan management, member permissions, integrations,
        and operational controls. Each tab respects your role and the active plan so the
        right tools are surfaced to the right people.
      </p>

      <section className="content-section">
        <h3>Plan & billing</h3>
        <ul>
          <li>
            Review Solo and Workspace tiers, compare pricing, and see which plan is active
            for the current workspace.
          </li>
          <li>
            Owners can upgrade or downgrade, rename workspaces, and receive clear status
            messaging once the change is applied.
          </li>
          <li>
            All submissions use CSRF-protected requests and refresh membership data so the
            rest of the UI updates immediately.
          </li>
        </ul>
      </section>

      <section className="content-section">
        <h3>Members</h3>
        <ul>
          <li>
            Browse every member with their role and contact information. Owners and admins
            can invite teammates by email and choose roles plus expiration windows.
          </li>
          <li>
            Invitation management is restricted to Workspace plans with sufficient
            permissions.
          </li>
          <li>
            Removing a member automatically handles shared secrets and returns them to their
            Solo workspace if necessary.
          </li>
        </ul>
      </section>

      <section className="content-section">
        <h3>Integrations</h3>
        <ul>
          <li>
            Connect Google, Microsoft, Slack, and other providers. View both personal and
            workspace-level credentials with expiration notices.
          </li>
          <li>
            Promote personal credentials to shared workspace assets, reconnect expired
            tokens, or revoke access entirely.
          </li>
          <li>
            OAuth callbacks can deep-link back into the modal with contextual success or
            failure messaging.
          </li>
        </ul>
      </section>

      <section className="content-section">
        <h3>Secrets & API keys</h3>
        <ul>
          <li>
            Organize service credentials by category (Email, Messaging, Webhooks, HTTP) with
            ready-to-use forms for new entries.
          </li>
          <li>
            Update or delete secrets inline with optimistic UI states and permission checks.
          </li>
          <li>
            Sensitive deletions require confirmation so you avoid breaking connected
            workflows accidentally.
          </li>
        </ul>
      </section>

      <section className="content-section">
        <h3>Engine controls</h3>
        <ul>
          <li>
            Set per-workflow concurrency limits, cancel queued runs, and purge historical
            run data.
          </li>
          <li>
            Solo plans are limited to single-run concurrency and surface upgrade prompts when
            attempting to raise the limit.
          </li>
          <li>
            Owners and admins manage these controls, while viewers receive read-only access.
          </li>
        </ul>
      </section>

      <section className="content-section">
        <h3>Logs & run history</h3>
        <ul>
          <li>
            Audit executed runs, dead-letter queues, blocked egress attempts, and
            configuration changes from one place.
          </li>
          <li>
            Filtering and raw JSON payload dialogs make it easy to investigate issues without
            leaving the app.
          </li>
          <li>
            Trigger requeues and clear blocked events directly from the interface when your
            role allows it.
          </li>
        </ul>
      </section>

      <section className="content-section">
        <h3>Webhooks</h3>
        <ul>
          <li>
            Generate inbound webhook URLs for each workflow and copy prebuilt curl,
            PowerShell, or JavaScript examples.
          </li>
          <li>
            Enforce HMAC signatures with a configurable replay window when security is a
            priority.
          </li>
          <li>
            Regenerate URLs with confirmation prompts to prevent accidental breakage.
          </li>
        </ul>
      </section>

      <section className="content-section">
        <h3>Workflow management</h3>
        <ul>
          <li>
            Select any workflow from the workspace, rename it, or delete it after retyping
            the confirmation phrase.
          </li>
          <li>
            Deletions emit workspace-wide events so open tabs refresh their state without a
            manual reload.
          </li>
        </ul>
      </section>
    </article>
  );
}
