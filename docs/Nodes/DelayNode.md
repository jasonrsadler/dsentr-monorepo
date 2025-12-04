# Delay Node (Wait)

The Delay node pauses workflow execution before continuing to the next step. Use it to throttle retries, stagger downstream calls, or wait until a specific moment before resuming.

## Configuration

- Mode: Choose **Wait for duration** or **Wait until specific datetime**.
- `wait_for_duration` (duration mode): Set any combination of **days**, **hours**, and **minutes** to wait before continuing. At least one of the duration fields must be greater than zero when this mode is used.
- `wait_until_datetime` (datetime mode): Select a calendar date plus hour/minute/second. The picker stores the value in UTC ISO 8601 (e.g., `2026-01-01T00:00:00Z`). If this time is already in the past when the run reaches the node, the workflow continues immediately.
- `jitter_seconds` (optional): A non-negative integer that adds a random offset between `0` and `jitter_seconds` to the computed delay. Helpful to avoid thundering herd behavior.

Validation:
- Duration mode requires at least one non-zero duration field.
- Datetime mode requires a valid date/time selection.
- The node fails fast if the chosen mode is missing required values.

## Behavior

1. The node calculates the target resume time from the duration and/or absolute timestamp.
2. If the target time is in the future, the workflow run is paused and rescheduled to resume from the next connected node after the delay elapses.
3. If the target time is already past (or the duration is zero), the workflow continues immediately without pausing.
4. Jitter, when provided, is added to the base delay before scheduling the resume time.

### Example

Pause for 2 hours with up to 60 seconds of jitter:

```json
{
  "wait_for": {
    "hours": 2
  },
  "jitter_seconds": 60
}
```

Wait until midnight UTC:

```json
{
  "wait_until": "2026-01-01T00:00:00Z"
}
```
