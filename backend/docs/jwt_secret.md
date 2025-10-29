# JWT Secret Requirements

The backend signs session tokens with the `JWT_SECRET` environment variable. The
startup check now enforces the following:

- The secret must be **at least 32 bytes** long.
- The secret must include a mix of characters (at least eight unique bytes) so it
  is not trivially guessable.

Generate a new secret with a cryptographically secure random generator, for
example:

```bash
openssl rand -base64 48
```

Add the resulting string to your environment (e.g. `.env`) as `JWT_SECRET`.
Existing deployments should rotate to a secret that meets the new constraints
before updating the service.

## Session Cookie HTTPS Enforcement

Set `AUTH_COOKIE_SECURE=true` in any deployed environment that terminates over
HTTPS so the `auth_token` cookie is marked `Secure`. Local HTTP development can
override the flag with `AUTH_COOKIE_SECURE=false` when TLS proxies are not
available.
