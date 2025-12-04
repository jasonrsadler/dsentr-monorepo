# Formatter Node (Transform)

The Formatter node reshapes or cleans data between workflow steps. It accepts a templated input value, applies a selected operation, and emits the typed result under the provided `output_key` within the node namespace.

## Operations

- **Strings:** Trim, Lowercase, Uppercase, Replace (search/replace), Split (delimiter + index), Substring (start + length).
- **Numbers:** Add, Subtract, Multiply, Divide, Round (decimal places), Convert to Number.
- **JSON:** Pick Field (dot/array path), Flatten (flattens objects/arrays into dotted keys), Merge (object + second JSON), Convert to Object (wrap under key), Convert to Array (delimiter with optional trim).
- **Dates:** Parse (choose input format), Format (output format), Add/Subtract Time (days/hours/minutes), Extract Component (year/month/day/hour/minute/second/weekday with timezone).
- **Booleans:** To Boolean, Is Empty.
- **Type Conversion:** Convert to String.

## Configuration

- **Operation:** Required. Grouped dropdown under Logic/Utility.
- **Input Value:** Templated text (e.g., `{{trigger.body}}`). JSON operations expect valid JSON strings.
- **Output Key:** Required JavaScript identifier (letters/numbers/underscores, no spaces). Result is stored as `{{FormatterNode.output_key}}`.
- **Operation Fields:** Shown only when relevant (e.g., `delimiter` + `index` for Split, `json_path` for Pick Field, `output_format` for Date Format).
- **Date formats:** `rfc3339`, `rfc2822`, `YYYY-MM-DD`, `YYYY-MM-DD HH:mm:ss`, `MM/DD/YYYY`, Unix seconds, Unix milliseconds. Timezone selection is supported for component extraction.

## Examples

- Trim and lowercase:
  ```json
  {
    "operation": "string.lowercase",
    "input": "  Hello  ",
    "fields": {},
    "output_key": "clean"
  }
  // Result: { "clean": "hello" }
  ```
- Pick a JSON field:
  ```json
  {
    "operation": "json.pick",
    "input": "{\"user\":{\"name\":\"Ada\"}}",
    "fields": { "json_path": "user.name" },
    "output_key": "name"
  }
  // Result: { "name": "Ada" }
  ```
- Date formatting:
  ```json
  {
    "operation": "date.format",
    "input": "2025-01-02T03:04:05Z",
    "fields": { "output_format": "date_only" },
    "output_key": "dateOnly"
  }
  // Result: { "dateOnly": "2025-01-02" }
  ```

## Type Handling

- Numeric operations and conversions emit JSON numbers (no quoted numerics).
- Boolean conversion accepts `true/false/yes/no/1/0` (case-insensitive); unknown strings raise an error.
- Empty checks treat empty strings/arrays/objects/null as empty; numbers are never empty.
- JSON conversion preserves arrays/objects; string splits emit arrays of strings.

## Gotchas

- Index fields are zero-based and must be >= 0.
- JSON paths use dot/array notation (e.g., `items.0.id`); invalid paths fail fast.
- Divide rejects zero; Round clamps decimal places to 15.
- Provide valid timezones (e.g., `UTC`, `America/New_York`) when extracting date components.
