# Deployment Permissions Checklist

Use this checklist during migration reviews or fresh environment bring-up to confirm the hardened database permissions remain in place after running the bootstrap migrations.

1. **Connect with the owner role**
   - `psql "dbname=dsentr user=dsentr_owner"`
   - Verify `\dn+ public` shows `Owner` as `dsentr_owner`.
2. **Confirm roles exist**
   - `\du dsentr_owner dsentr_app dsentr_readonly`
   - Ensure `dsentr_owner` has `No Login`, and the application roles do not inherit superuser privileges.
3. **Validate object ownership**
   - `\dt+ public.*` and `\ds+ public.*`
   - All tables and sequences should list `dsentr_owner` as the owner.
4. **Inspect privileges on existing objects**
   - `\dp public.*`
   - `PUBLIC` should have no privileges; `dsentr_app` should have `arwdD` (CRUD) and sequence usage, and `dsentr_readonly` only `r` (SELECT).
5. **Check default privileges for future objects**
   - Run `SELECT * FROM pg_default_acl WHERE defaclrole = 'dsentr_owner'::regrole;`
   - Confirm only `dsentr_app` and `dsentr_readonly` appear with the expected grants.
6. **Spot-check application connectivity**
   - Attempt a read-only query as `dsentr_readonly` (e.g., `SELECT 1 FROM users LIMIT 1;`) to ensure access works without modification rights.
   - Attempt an insert/update as `dsentr_app` to confirm runtime privileges remain intact.
7. **Document the review**
   - Capture the `psql` transcript or checklist results in the deployment ticket for audit tracking.

Complete every item before marking the deployment review as finished.
