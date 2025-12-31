# Notion Nodes

Notion nodes let workflows create, update, and query database content, plus poll for new or updated rows. All nodes require an explicit Notion connection and database selection.

## Actions

### Create database row

- **Required**: Connection, Database, at least one property value.
- **Notes**: The title property is required by Notion; map it in the property list.

### Update database row

- **Required**: Connection, Database (for schema), Page ID, at least one property value.
- **Notes**: Use a page ID from a previous step or trigger.

### Create page

- **Required**: Connection, Parent (database or page), and either properties or a title.
- **Notes**: When the parent is a database, map properties (including the title property). When the parent is a page, use the Title field.

### Query database

- **Required**: Connection, Database.
- **Filter**: Choose a property and operator (`equals`, `contains`, `is_empty`, `is_not_empty`). Provide a value when required.
- **Limit**: Max results per run (defaults to 25 when omitted).

## Triggers (Polling)

### New database row

Polls the selected database for new rows based on `created_time`. Emits a trigger event for each new row.

### Updated database row

Polls the selected database for updates based on `last_edited_time`. Emits a trigger event when rows change.

## Property Mapping Notes

- DSentr stores property mappings by **Notion property ID** for stability.
- The UI shows the property name and type, but the stored key remains the ID.
- Select and multi-select fields use Notion option names (or IDs when available).
