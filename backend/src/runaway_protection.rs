use serde_json::{Map, Value};
use thiserror::Error;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::state::AppState;

pub const RUNAWAY_PROTECTION_ERROR: &str = "runaway_protection_triggered";

#[derive(Debug, Error)]
pub enum RunawayProtectionError {
    #[error(
        "runaway protection triggered after {count} runs in the last 5 minutes (limit {limit})"
    )]
    RunawayProtectionTriggered { count: i64, limit: i64 },
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

pub fn runaway_protection_enabled(settings: &Value, workspace_id: Uuid) -> bool {
    let Some(workflows) = settings.get("workflows").and_then(|v| v.as_object()) else {
        return true;
    };

    if let Some(Value::Bool(flag)) = workflows.get("runaway_protection_enabled") {
        return *flag;
    }

    if let Some(Value::Object(map)) = workflows.get("runaway_protection_enabled") {
        if let Some(enabled) = map.get(&workspace_id.to_string()).and_then(|v| v.as_bool()) {
            return enabled;
        }

        if let Some(default_enabled) = map.get("default").and_then(|v| v.as_bool()) {
            return default_enabled;
        }
    }

    true
}

pub fn set_runaway_protection_enabled(settings: &mut Value, workspace_id: Uuid, enabled: bool) {
    if !settings.is_object() {
        *settings = Value::Object(Default::default());
    }

    let obj = settings.as_object_mut().expect("converted to object above");
    let workflows = obj
        .entry("workflows")
        .or_insert_with(|| Value::Object(Default::default()));
    if !workflows.is_object() {
        *workflows = Value::Object(Default::default());
    }
    let workflows_obj = workflows
        .as_object_mut()
        .expect("workflows coerced to object");

    let entry = workflows_obj
        .entry("runaway_protection_enabled".to_string())
        .or_insert_with(|| Value::Object(Default::default()));

    match entry {
        Value::Object(map) => {
            map.insert(workspace_id.to_string(), Value::Bool(enabled));
        }
        Value::Bool(previous) => {
            let mut map = Map::new();
            map.insert("default".to_string(), Value::Bool(*previous));
            map.insert(workspace_id.to_string(), Value::Bool(enabled));
            *entry = Value::Object(map);
        }
        _ => {
            let mut map = Map::new();
            map.insert(workspace_id.to_string(), Value::Bool(enabled));
            *entry = Value::Object(map);
        }
    }
}

pub async fn enforce_runaway_protection(
    state: &AppState,
    workspace_id: Uuid,
    settings: &Value,
) -> Result<(), RunawayProtectionError> {
    if !runaway_protection_enabled(settings, workspace_id) {
        return Ok(());
    }

    let window_start = OffsetDateTime::now_utc() - Duration::minutes(5);
    let count = state
        .workflow_repo
        .count_workspace_runs_since(workspace_id, window_start)
        .await?;

    let limit = state.config.runaway_limit_5min;
    if count > limit {
        return Err(RunawayProtectionError::RunawayProtectionTriggered { count, limit });
    }

    Ok(())
}
