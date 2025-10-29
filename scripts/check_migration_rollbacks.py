#!/usr/bin/env python3
"""Verify migrations document rollback steps."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = REPO_ROOT / "backend" / "migrations"

ALLOWLIST = {
    "backend/migrations/1 - init.sql",
    "backend/migrations/2025_05_09_create_early_access.sql",
    "backend/migrations/2025_05_11_create_signup.sql",
    "backend/migrations/2025_05_15_add_user_roles_columns_types.sql",
    "backend/migrations/2025_05_23_add_oauth_type_to_users.sql",
    "backend/migrations/2025_10_04_1_create_workflow.sql",
    "backend/migrations/2025_10_04_2_create_updated_at_trigger.sql",
    "backend/migrations/2025_10_07_1_create_workflow_logs.sql",
    "backend/migrations/2025_10_07_2_unique_workflow_name.sql",
    "backend/migrations/2025_10_07_3_create_workflow_runs.sql",
    "backend/migrations/2025_10_07_4_create_workflow_node_runs.sql",
    "backend/migrations/2025_10_07_5_add_webhook_salt.sql",
    "backend/migrations/2025_10_08_1_alter_workflows_add_concurrency.sql",
    "backend/migrations/2025_5_12_add_is_verified.sql",
    "backend/migrations/2025_5_12_create_email_verification_tokens.sql",
    "backend/migrations/2025_5_13_add_used_at_email_verification_tokens.sql",
    "backend/migrations/2025_5_16_add_reset_password_token_fields.sql",
    "backend/migrations/2025_9_15_add_used_at_password_reset.sql",
    "backend/migrations/2025_9_16_add_oauth_enum_email.sql",
}


def main() -> int:
    failures: list[str] = []

    if not MIGRATIONS_DIR.exists():
        print(f"Missing migrations directory: {MIGRATIONS_DIR}", file=sys.stderr)
        return 1

    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        rel_path = path.relative_to(REPO_ROOT).as_posix()
        if rel_path in ALLOWLIST:
            continue
        if "-- Rollback:" not in path.read_text(encoding="utf-8"):
            failures.append(rel_path)

    if failures:
        print("The following migrations are missing a '-- Rollback:' guidance block:")
        for failure in failures:
            print(f"  - {failure}")
        print("Add rollback notes or update the allowlist once legacy files are documented.", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
