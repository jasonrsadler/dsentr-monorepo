# Docs Agent Notes

## Purpose
- Reference material for operational runbooks that support the backend team.
- Does not ship with the binary; used manually by engineers when configuring or repairing the service.

## Files
- `oauth_redirects.md`: documents the exact OAuth callback URLs and required environment variables for Google and Microsoft integrations. Use it when provisioning credentials in provider dashboards or setting up local `.env` files.
- `remove_duplicate_workspace_orgs.sql`: transactional cleanup script that deduplicates organizations/workspaces after the historical subscription bug. Always wrap execution in a manual transaction and review row counts before committing.

## Usage Tips
- Keep these docs updated whenever OAuth URLs or required secrets change, otherwise onboarding breaks silently.
- For SQL maintenance scripts, list the expected preconditions and postconditions directly in the file so production support knows how to validate execution.
