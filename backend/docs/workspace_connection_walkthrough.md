# Hybrid OAuth Connections Walkthrough

This guide demonstrates how to validate the hybrid (user + workspace) OAuth connection flow end-to-end in a local Dsentr environment.

## Prerequisites
- Local development stack running (backend API, worker, and frontend web app).
- Seed data that includes:
  - A workspace with at least one admin/owner user.
  - At least one non-admin workspace member for cross-verification.
- OAuth provider credentials configured (Google/Microsoft/Slack, etc.) and the corresponding redirect URIs added to the provider dashboard.
- Access to the database (e.g., `psql`) for inspecting connection records and audit logs.

## 1. Connect a Personal OAuth Account
1. Sign in as a regular workspace admin/owner via the frontend.
2. Navigate to **Settings → Integrations**.
3. Under the provider you intend to test (e.g., Google), click **Connect** and complete the provider consent flow.
4. When redirected back:
   - The UI should now display the connection under **Your connections** with status **Connected**.
   - The **Promote to Workspace** button should be visible (admin/owner only).
5. Database validation (optional):
   ```sql
   SELECT id, provider, is_shared
   FROM provider_connections
   WHERE user_id = '<admin_user_id>'
     AND provider = 'google';
   ```
   Expected result: a row with `is_shared = false`.

## 2. Promote the Connection to the Workspace
1. In **Settings → Integrations**, locate the personal connection and click **Promote to Workspace**.
2. Confirm the promotion in the modal dialogue.
3. Verify the UI updates:
   - The personal connection should remain listed with a "Shared with workspace" indicator (or equivalent state).
   - A new entry should appear under **Workspace connections**.
4. API validation (optional):
   ```bash
   curl -X POST \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"connection_id":"<provider_connection_id>"}' \
     http://localhost:3000/api/workspaces/<workspace_id>/connections/promote
   ```
   Response should include `workspace_connection_id` and `created_by` (matching the admin user).
5. Database checks:
   ```sql
   SELECT id, provider, created_by
   FROM workspace_connections
   WHERE workspace_id = '<workspace_id>'
     AND provider = 'google';

   SELECT is_shared
   FROM provider_connections
   WHERE id = '<provider_connection_id>';
   ```
   Expected: `workspace_connections` contains a new row; `provider_connections.is_shared = true`.
6. Audit log validation:
   ```sql
   SELECT event_type, metadata
   FROM workspace_audit_events
   WHERE workspace_id = '<workspace_id>'
   ORDER BY created_at DESC
   LIMIT 5;
   ```
   Expect a `connection_promoted` entry with `user_id`, `workspace_id`, and `provider` metadata.

## 3. Use the Shared Connection in a Workflow
1. Open or create a workflow within the same workspace.
2. Add a node that requires an OAuth connection (e.g., Google Sheets).
3. When configuring the node:
   - The connection picker should display two groups: **Your connections** and **Workspace connections**.
   - Select the promoted workspace connection.
   - A notice should appear: “This workflow uses shared workspace credentials provided by <user_name>.”
4. Save and run the workflow.
5. Observe the run metadata (from the run details panel or logs):
   - `Triggered by`: the current user (who started the run).
   - `Executed with`: `Workspace <Provider> connection (shared by <user_name>)`.
6. Database logging (optional):
   ```sql
   SELECT workflow_id, workspace_id, triggered_by, using_connection_type, connection_id
   FROM workflow_run_events
   WHERE workflow_id = '<workflow_id>'
   ORDER BY timestamp DESC
   LIMIT 1;
   ```
   Expect `using_connection_type = 'workspace'` and `connection_id` matching the workspace connection.

## 4. Verify Token Refresh Behavior
1. Force the workspace connection’s `expires_at` to a past timestamp (via DB update) to trigger refresh on next use.
2. Execute another workflow run using the shared connection.
3. Confirm the run succeeds and that only one refresh occurs (check backend logs for serialized refresh messages if logging is enabled).
4. Optionally verify the updated `expires_at` and tokens in the database.

## 5. Permissions Checks
1. Sign in as a non-admin workspace member.
2. Navigate to **Settings → Integrations**:
   - Shared workspace connections should be visible but **Promote to Workspace** buttons should be absent for personal connections they do not own.
3. Attempt to call the promotion API as the member; expect a 403 response.
4. In the workflow editor, confirm the member can select and use the shared workspace connection.

## 6. Cleanup (Optional)
- Revoke tokens via the provider dashboard if the test credentials should not persist.
- Remove test rows from `workspace_connections` and reset `provider_connections.is_shared` if necessary.

---
Following these steps verifies the hybrid OAuth connection workflow from setup through runtime attribution and permission enforcement.
