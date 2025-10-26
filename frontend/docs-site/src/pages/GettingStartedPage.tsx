export function GettingStartedPage() {
  return (
    <article className="page-card">
      <h2>Getting started with dsentr</h2>
      <p>
        Launch your automation workspace in minutes. This guide covers account creation,
        verification, invite handling, and the onboarding wizard that prepares your
        workspace for collaboration.
      </p>

      <section className="content-section">
        <h3>Create an account</h3>
        <ol>
          <li>
            Visit the sign-up page and enter your name, email, password, and optional
            company details. Inline validation ensures each field meets dsentr’s security
            requirements before you submit.
          </li>
          <li>
            Choose a sign-up method: continue with email and password, or authenticate via
            Google or GitHub OAuth to skip manual password entry.
          </li>
          <li>
            If you joined from an invitation link, dsentr automatically loads the workspace
            information so you can accept the invite during sign-up. Invalid or expired
            invites surface immediately with guidance to request a new link.
          </li>
        </ol>
      </section>

      <section className="content-section">
        <h3>Verify your email</h3>
        <p>
          After signing up, dsentr sends a verification message. Click the link in your
          inbox to confirm ownership and unlock your account. If the link expires, return
          to the login page and request a fresh message.
        </p>
      </section>

      <section className="content-section">
        <h3>Sign in and review invites</h3>
        <ol>
          <li>
            Sign in with your preferred method. Toggle “Remember me” to keep the session
            active across browser restarts.
          </li>
          <li>
            When the URL contains an invite token, dsentr preloads the invitation details
            and opens a confirmation modal after authentication so you can accept, decline,
            or postpone the decision.
          </li>
          <li>
            Accepted invites add the workspace to your account immediately. Declined invites
            remain visible in case you need to revisit them later.
          </li>
        </ol>
      </section>

      <section className="content-section">
        <h3>Recover access when needed</h3>
        <p>
          Use the forgot-password flow whenever credentials are misplaced. Request a reset
          email from the login screen, follow the secure link, and set a new password—all
          while dsentr enforces standard security checks.
        </p>
      </section>

      <section className="content-section">
        <h3>Complete the onboarding wizard</h3>
        <ol>
          <li>
            <strong>Pick a plan:</strong> choose between Solo and Workspace tiers. Dsentr
            defaults to the plan referenced by your invite or personal account but lets you
            switch before continuing.
          </li>
          <li>
            <strong>Name your workspace:</strong> provide a recognizable name for team
            workspaces. Solo plan users can skip this step.
          </li>
          <li>
            <strong>Share starter workflows:</strong> decide which of your personal flows to
            publish into the new workspace. Solo plans treat this step as optional.
          </li>
          <li>
            <strong>Submit:</strong> dsentr saves the selections, applies CSRF protection,
            and routes you directly into the dashboard.
          </li>
        </ol>
      </section>
    </article>
  );
}
