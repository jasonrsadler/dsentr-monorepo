# Worker Agent Notes

## Purpose
- Runs background tasks that drive workflow execution and schedule maintenance.

## Key Functions
- `start_background_workers`: Spawns a Tokio task that periodically:
  - requeues expired leases,
  - claims eligible runs and dispatches them to `engine::execute_run`,
  - processes due schedules (`process_due_schedules`),
  - purges old runs based on `RUN_RETENTION_DAYS`.
- `process_due_schedules`: Loads a batch of due schedules and delegates to `trigger_schedule`.
- `trigger_schedule`: Converts stored schedule config into a new workflow run snapshot, seeds trigger context, and updates next-run timestamps.

## Usage Tips
- Adjust cadence and batch sizes via env vars or constants (`MAX_SCHEDULES`) rather than hard-coding multiple loops elsewhere.
- The worker clones `AppState`; ensure any new state fields are `Arc`-backed so they remain inexpensive to clone.
- When adding new periodic maintenance tasks, append them inside the loop with a clear timer guard similar to `last_cleanup`.

## Change Reasons
- Swapped ad-hoc stderr logging for structured tracing so worker diagnostics include worker and schedule identifiers and play nicely with the global subscriber.
- Updated slow-run worker test harness to fully own mocked node run fields and reuse shared completion trackers without moving them, fixing compile-time lifetime and move errors.
