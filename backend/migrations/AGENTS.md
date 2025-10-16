# Migrations Agent Notes

## Purpose
- Raw SQL migrations executed with the SQLx CLI or manual `psql` sessions.
- Files are applied in lexicographic order; keep timestamps consistent to avoid ordering surprises.

## Layout
- `1 - init.sql`: bootstraps the database (enables `pgcrypto`, creates `dsentr`, and defines the earliest user/auth tables). Run manually when standing up a new environment.
- `2025_05_*`: early access and authentication flow tables (email verification, password reset, signup metadata, user roles/enums).
- `2025_09_*` & `2025_10_*`: workflow engine schema (workflows, runs, node runs, schedules, dead letters, webhook replays, egress block events) plus concurrency/security columns and helper triggers.
- `2025_10_14_*` to `2025_10_17_*`: workspace and organization lifecycle (memberships, invites, deprecating legacy workspace-team linkage).
- `2025_10_11_1_create_user_oauth_tokens.sql`: persistence for connected OAuth integrations.
- `2025_05_23_add_oauth_type_to_users.sql` & `2025_9_16_add_oauth_enum_email.sql`: align user auth tables with OAuth providers.

## Usage Tips
- Never edit an existing migration after it ships; create a new timestamped file instead.
- For destructive changes, include companion rollback notes at the end of the file so emergency rollbacks are obvious.
- When adding new SQL files, ensure they end with a newline and are idempotent where practical—tests rely on rerunning migrations against scratch databases.
