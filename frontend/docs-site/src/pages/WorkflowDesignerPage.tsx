export function WorkflowDesignerPage() {
  return (
    <article className="page-card">
      <h2>Workflow designer</h2>
      <p>
        The workflow designer brings together the canvas, toolbar, and run console so you
        can build, test, and monitor automations from a single surface.
      </p>

      <section className="content-section">
        <h3>Workflow toolbar</h3>
        <ul>
          <li>
            Switch between workflows, rename them inline, or create new ones. Solo plans can
            store up to three workflows; additional creations prompt an upgrade notice.
          </li>
          <li>
            Access Save, New, Run Overlay, and Lock controls. Buttons enable only when your
            role allows edits and the workflow has unsaved changes.
          </li>
          <li>
            Monitor plan usage directly from the toolbar via run statistics and Solo plan
            warnings.
          </li>
        </ul>
      </section>

      <section className="content-section">
        <h3>Canvas interaction</h3>
        <ul>
          <li>
            Drag triggers, actions, and conditions from the sidebar onto the canvas. Solo
            plans can place up to ten nodes per workflow before encountering an upgrade
            prompt.
          </li>
          <li>
            Connect nodes by dragging handles. Condition branches automatically label “True”
            and “False,” and the designer keeps selections synchronized so the state stays
            consistent.
          </li>
          <li>
            Open the node flyout to edit fields, manage credentials, and tweak schedules
            without leaving the canvas. dsentr caches state internally to prevent accidental
            rerender loops.
          </li>
        </ul>
      </section>

      <section className="content-section">
        <h3>Saving and version safety</h3>
        <ul>
          <li>
            Saving writes a sanitized node and edge graph back to the API and clears the
            dirty flag when successful.
          </li>
          <li>
            Switching workflows with unsaved changes triggers a confirmation dialog to guard
            against losing edits.
          </li>
          <li>
            Closing the browser tab while changes are unsaved prompts a standard confirmation
            dialog as an additional safeguard.
          </li>
        </ul>
      </section>

      <section className="content-section">
        <h3>Running workflows</h3>
        <ul>
          <li>
            Start runs from the toolbar. The run overlay streams node-by-node execution
            status and highlights failures or success in real time.
          </li>
          <li>
            A global runs stream updates the toolbar so you can see when any workflow is
            queued or executing across the workspace.
          </li>
          <li>
            Heavy operations, such as cancelling or retrying runs, live in Settings → Engine
            so the overlay can stay focused on visibility.
          </li>
        </ul>
      </section>

      <section className="content-section">
        <h3>Locking and collaboration</h3>
        <ul>
          <li>
            Workflow creators can lock a workflow to freeze edits while deploying changes.
            Owners and admins can override locks; viewers stay read-only.
          </li>
          <li>
            When locked, the canvas ignores node drops and connection changes until the lock
            is released, preventing accidental modifications.
          </li>
        </ul>
      </section>
    </article>
  );
}
