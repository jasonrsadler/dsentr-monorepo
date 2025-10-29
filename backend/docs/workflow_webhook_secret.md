# Workflow Webhook Secret Runbook

The `WEBHOOK_SECRET` environment variable controls how workflow trigger URLs and optional HMAC signatures are derived. This secret must remain consistent across all workers that process workflow traffic within a given environment. Follow the guidance below whenever you provision or rotate the value.

## Generation requirements

- Generate **at least 32 random bytes** (64 hex characters) using an approved entropy source such as `openssl rand -hex 32` or your vault tooling.
- Ensure the secret contains at least **8 unique characters**. Avoid placeholders such as `dev-secret` or any value containing `changeme`—startup validation will reject them.
- Store the secret in the appropriate vault path for each environment. Never commit the value to source control or share it over chat/email.

## Environment-specific instructions

### Local development

1. Generate a fresh value locally: `openssl rand -hex 32`.
2. Place the secret in your personal `.env` file as `WEBHOOK_SECRET=<generated value>`.
3. Do **not** reuse the same secret for staging or production. Rotate the local value whenever you suspect it was disclosed (for example, if you screen-share your terminal).

### QA / staging

1. Request a rotation ticket in the shared ops queue and obtain approval from the service owner.
2. Use the vault CLI or UI to generate and store the new secret in the staging path. Example: `vault kv put dsentr/staging/webhook SECRET=$(openssl rand -hex 32)`.
3. Update the staging deployment to pull the new value. For Kubernetes, update the sealed secret or vault reference and restart the workflow API pods.
4. Notify QA once the change is live so they can re-fetch webhook URLs in their test workspaces.

### Production

1. Open a change-management ticket and coordinate with the on-call engineer.
2. Generate the secret through the production vault workflow. Prefer dynamic issuance: `vault kv put dsentr/prod/webhook SECRET=$(openssl rand -hex 32)`.
3. Schedule a maintenance window to roll the value. Deploy the configuration update and restart all API/worker pods to ensure they load the new secret at startup.
4. After deployment, rotate any active webhook URLs for business-critical workflows so downstream systems immediately use the new tokens.
5. Document the rotation (ticket link, timestamp, operators) in the security log per the incident-response policy.

## Operational notes

- The backend now refuses to start if `WEBHOOK_SECRET` is missing or too weak. Startup logs include a descriptive error message if validation fails.
- The workflow webhook endpoints return HTTP 500 when the secret is absent, preventing accidental acceptance of unsigned requests.
- Whenever you rotate the secret, remember that previously issued webhook URLs and signing keys become invalid. Notify affected customers or internal teams before rotation so they can update integrations.

Refer back to `SECURITY.md` for global policies on secret handling and auditing.
