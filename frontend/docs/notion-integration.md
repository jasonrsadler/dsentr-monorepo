# Notion Integration Setup

Use the Notion integration to connect DSentr workflows to Notion databases and pages with OAuth. The integration only sees databases that you explicitly share with it inside Notion.

## Connect Notion

1. Open **Settings -> Integrations** in DSentr.
2. Select **Notion** and choose **Connect** (personal) or **Connect to workspace** (workspace scope).
3. Complete the Notion OAuth prompt.

After connecting, DSentr stores the OAuth connection and uses it for Notion actions and triggers.

## Share Databases with the Integration

Notion does not allow integrations to browse your workspace automatically. You must share each database with the integration:

1. Open the database in Notion.
2. Click **Share**.
3. Invite the **DSentr** integration (the name shown in the OAuth consent).
4. Confirm the permissions.

Only databases shared this way appear in the DSentr database picker.

## Connection Scopes

- **Personal**: Uses your personal OAuth token. You can keep multiple personal connections and select one per node.
- **Workspace**: A shared connection owned by the DSentr workspace. Admins can connect it once and reuse it across workflows.

## Common Errors

- **No databases found**: The integration does not have access to any databases yet. Share the database with the integration in Notion and retry.
- **Authentication failed**: The OAuth token was revoked or expired. Reconnect the Notion integration from Settings.
- **Workspace connection not accessible**: The selected workspace connection was removed or you no longer have access. Ask an admin to reconnect.
