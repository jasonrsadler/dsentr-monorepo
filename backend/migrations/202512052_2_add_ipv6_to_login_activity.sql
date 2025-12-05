-- Support capturing both IPv4 (preferred) and IPv6 addresses alongside the primary IP.
ALTER TABLE user_login_activity
    ADD COLUMN IF NOT EXISTS ipv4_address INET,
    ADD COLUMN IF NOT EXISTS ipv6_address INET;

-- Backfill existing rows to keep primary IP visible in the new columns.
UPDATE user_login_activity
SET ipv4_address = ip_address
WHERE ipv4_address IS NULL
  AND family(ip_address) = 4;

UPDATE user_login_activity
SET ipv6_address = ip_address
WHERE ipv6_address IS NULL
  AND family(ip_address) = 6;

-- Rollback:
--   ALTER TABLE user_login_activity DROP COLUMN IF EXISTS ipv4_address;
--   ALTER TABLE user_login_activity DROP COLUMN IF EXISTS ipv6_address;
