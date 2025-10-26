export function DashboardPage() {
  return (
    <article className="page-card">
      <h2>Dashboard overview</h2>
      <p>
        The dashboard is your authenticated command center. It keeps workspace context,
        global notices, and the workflow designer within reach so you can build and
        maintain automations without leaving the page.
      </p>

      <section className="content-section">
        <h3>Accessing the dashboard</h3>
        <ul>
          <li>
            The dashboard lives at <code>/dashboard</code>. Unauthenticated visitors are
            redirected through the sign-in flow.
          </li>
          <li>
            Users who still need to complete onboarding finish the wizard before entering
            the dashboard.
          </li>
        </ul>
      </section>

      <section className="content-section">
        <h3>Header controls</h3>
        <ul>
          <li>
            <strong>Workspace switcher:</strong> shows the current workspace and keeps the
            <code>?workspace=</code> query string synced whenever you switch context.
          </li>
          <li>
            <strong>Plan badge:</strong> displays whether you are operating in a Solo or
            Workspace plan so you always know which features are available.
          </li>
          <li>
            <strong>Theme toggle:</strong> lets you move between light and dark modes.
          </li>
          <li>
            <strong>Settings button:</strong> opens a modal with tabs for plan management,
            members, engine controls, logs, webhooks, integrations, and workflow
            administration.
          </li>
          <li>
            <strong>Profile menu:</strong> surfaces personal account actions, including
            viewing details or signing out.
          </li>
        </ul>
      </section>

      <section className="content-section">
        <h3>Notifications and notices</h3>
        <p>
          Solo plan usage warnings appear below the header so you can monitor monthly run
          capacity. OAuth and plan change notices display contextually inside the settings
          modal, keeping the dashboard uncluttered while still highlighting important
          events.
        </p>
      </section>

      <section className="content-section">
        <h3>Main content area</h3>
        <p>
          The primary outlet renders the workflow designer. Use the sidebar, canvas, and
          toolbar to create, test, and operate workflows. When you need a deeper dive,
          visit the dedicated Workflow Designer guide.
        </p>
      </section>
    </article>
  );
}
