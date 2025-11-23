# Plan Limits & Error Payloads

The backend enforces several workspace-specific limits to keep Solo and Workspace plans aligned. These limits surface deterministic API errors so clients can react gracefully.

## Workspace membership
- Only workspaces on the Workspace tier may invite or add members.
- Workspace plans include up to **8 active members** (owner + collaborators).
- When a call would exceed the cap, handlers return:
  ```json
  {
    "success": false,
    "status": "error",
    "message": "Workspace plans support up to 8 members. Remove an existing member or contact support to increase your limit.",
    "code": "workspace_member_limit"
  }
  ```
- Inviting or adding members on Solo plans returns `403 Forbidden` with `code: "workspace_plan_required"`.

## Workspace run quota
- Each workspace includes **20,000 workflow runs per billing period by default** (configurable via `WORKSPACE_MONTHLY_RUN_LIMIT`). Solo workspaces continue to use the existing personal limit (250 runs/month) tied to the workflow owner.
- Usage is tracked per billing cycle window in `workspace_run_usage.run_count`, and every run beyond the limit increments `workspace_run_usage.overage_count` for billing. Workflow execution continues even when the limit is exceeded.
- Clients should rely on `/api/workflows/usage?workspace={id}` for workspace run usage and member-level breakdowns instead of expecting `workspace_run_limit` errors during execution.

## Error payload contract
- All limit-related errors follow the standard `JsonResponse` envelope with a `code` field describing the violation.
- The `code` values above are stable; use them for client-side translations or retry guidance.
