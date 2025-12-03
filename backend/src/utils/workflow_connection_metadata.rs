use std::collections::BTreeSet;

use serde_json::{json, Map, Value};
use uuid::Uuid;

use crate::models::workflow_run::WorkflowRun;
use crate::models::workflow_run_event::NewWorkflowRunEvent;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct ConnectionMetadata {
    pub connection_type: String,
    pub connection_id: Option<Uuid>,
}

impl ConnectionMetadata {
    pub fn user() -> Self {
        ConnectionMetadata {
            connection_type: "user".to_string(),
            connection_id: None,
        }
    }

    pub fn workspace(connection_id: Uuid) -> Self {
        ConnectionMetadata {
            connection_type: "workspace".to_string(),
            connection_id: Some(connection_id),
        }
    }
}

pub fn collect(snapshot: &Value) -> Vec<ConnectionMetadata> {
    let mut seen: BTreeSet<ConnectionMetadata> = BTreeSet::new();

    if let Some(nodes) = snapshot.get("nodes").and_then(|v| v.as_array()) {
        for node in nodes {
            if let Some(data) = node.get("data") {
                collect_from_value(data, &mut seen);
            }
        }
    }

    seen.into_iter().collect()
}

pub fn embed(snapshot: &mut Value, metadata: &[ConnectionMetadata]) {
    let Some(obj) = snapshot.as_object_mut() else {
        return;
    };

    if metadata.is_empty() {
        obj.remove("_connection_metadata");
        return;
    }

    let serialized = metadata
        .iter()
        .map(|entry| {
            json!({
                "connection_type": entry.connection_type,
                "connection_id": entry
                    .connection_id
                    .map(|id| id.to_string()),
            })
        })
        .collect();

    obj.insert("_connection_metadata".to_string(), Value::Array(serialized));
}

pub fn build_run_events(
    run: &WorkflowRun,
    triggered_by: &str,
    metadata: &[ConnectionMetadata],
) -> Vec<NewWorkflowRunEvent> {
    if metadata.is_empty() {
        return vec![NewWorkflowRunEvent {
            workflow_run_id: run.id,
            workflow_id: run.workflow_id,
            workspace_id: run.workspace_id,
            triggered_by: triggered_by.to_string(),
            connection_type: None,
            connection_id: None,
            recorded_at: None,
        }];
    }

    metadata
        .iter()
        .map(|entry| NewWorkflowRunEvent {
            workflow_run_id: run.id,
            workflow_id: run.workflow_id,
            workspace_id: run.workspace_id,
            triggered_by: triggered_by.to_string(),
            connection_type: Some(entry.connection_type.clone()),
            connection_id: entry.connection_id,
            recorded_at: None,
        })
        .collect()
}

fn collect_from_value(value: &Value, seen: &mut BTreeSet<ConnectionMetadata>) {
    match value {
        Value::Object(map) => {
            collect_from_object(map, seen);
            for nested in map.values() {
                collect_from_value(nested, seen);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_from_value(item, seen);
            }
        }
        _ => {}
    }
}

fn collect_from_object(map: &Map<String, Value>, seen: &mut BTreeSet<ConnectionMetadata>) {
    if let Some(connection_value) = map.get("connection") {
        if let Some(connection_obj) = connection_value.as_object() {
            if let Some(metadata) = resolve_connection_metadata(connection_obj, Some(map)) {
                seen.insert(metadata);
            }
        }
    }

    if let Some(metadata) = resolve_connection_metadata(map, None) {
        seen.insert(metadata);
    }

    let legacy_user = map.contains_key("oauthConnectionId")
        || map.contains_key("oauthAccountEmail")
        || map.contains_key("accountEmail");

    if legacy_user {
        seen.insert(ConnectionMetadata::user());
    }
}

fn resolve_connection_metadata(
    map: &Map<String, Value>,
    parent: Option<&Map<String, Value>>,
) -> Option<ConnectionMetadata> {
    let scope = read_string(map.get("connectionScope"))
        .or_else(|| parent.and_then(|p| read_string(p.get("connectionScope"))));

    let scope = scope.map(|s| s.to_ascii_lowercase());

    match scope.as_deref() {
        Some("workspace") => {
            let id = read_string(map.get("connectionId"))
                .or_else(|| parent.and_then(|p| read_string(p.get("connectionId"))))?;
            let parsed = Uuid::parse_str(&id).ok()?;
            Some(ConnectionMetadata::workspace(parsed))
        }
        Some("user") => Some(ConnectionMetadata::user()),
        _ => None,
    }
}

fn read_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::workflow_run::WorkflowRun;
    use serde_json::json;
    use time::OffsetDateTime;
    use uuid::Uuid;

    #[test]
    fn collect_extracts_user_and_workspace_connections() {
        let workspace_id = Uuid::new_v4();
        let snapshot = json!({
            "nodes": [
                {"data": {"connection": {"connectionScope": "workspace", "connectionId": workspace_id}}},
                {"data": {"connection": {"connectionScope": "user"}}}
            ]
        });

        let metadata = collect(&snapshot);
        assert_eq!(metadata.len(), 2);
        assert!(metadata
            .iter()
            .any(|entry| entry.connection_type == "workspace"));
        assert!(metadata.iter().any(|entry| entry.connection_type == "user"));
    }

    #[test]
    fn build_run_events_emits_metadata_for_each_connection() {
        let workspace_id = Uuid::new_v4();
        let run = WorkflowRun {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            workflow_id: Uuid::new_v4(),
            workspace_id: Some(workspace_id),
            snapshot: json!({}),
            status: "queued".into(),
            error: None,
            idempotency_key: None,
            started_at: OffsetDateTime::now_utc(),
            resume_at: OffsetDateTime::now_utc(),
            finished_at: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        };

        let workspace_conn = Uuid::new_v4();
        let metadata = vec![
            ConnectionMetadata::workspace(workspace_conn),
            ConnectionMetadata::user(),
        ];

        let events = build_run_events(&run, "worker", &metadata);
        assert_eq!(events.len(), 2);

        let mut workspace_event = None;
        let mut user_event = None;
        for event in events {
            if event.connection_type.as_deref() == Some("workspace") {
                workspace_event = Some(event);
            } else {
                user_event = Some(event);
            }
        }

        let workspace_event = workspace_event.expect("workspace event exists");
        assert_eq!(workspace_event.connection_id, Some(workspace_conn));
        assert_eq!(workspace_event.workspace_id, Some(workspace_id));
        assert_eq!(workspace_event.triggered_by, "worker");

        let user_event = user_event.expect("user event exists");
        assert_eq!(user_event.connection_type.as_deref(), Some("user"));
        assert!(user_event.connection_id.is_none());
    }
}
