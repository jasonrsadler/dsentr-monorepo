use serde_json::{json, Value};
use uuid::Uuid;

use crate::{models::user::PublicUser, state::AppState};

fn actor_label(user: &PublicUser) -> Option<String> {
    let first = user.first_name.trim();
    let last = user.last_name.trim();
    let email = user.email.trim();

    let mut name = String::new();
    if !first.is_empty() {
        name.push_str(first);
    }
    if !last.is_empty() {
        if !name.is_empty() {
            name.push(' ');
        }
        name.push_str(last);
    }

    if name.is_empty() && email.is_empty() {
        None
    } else if name.is_empty() {
        Some(email.to_string())
    } else if email.is_empty() {
        Some(name)
    } else {
        Some(format!("{name} <{email}>"))
    }
}

async fn resolve_actor_label(state: &AppState, actor_id: Uuid) -> Option<String> {
    match state.db.find_public_user_by_id(actor_id).await {
        Ok(Some(user)) => actor_label(&user),
        _ => None,
    }
}

pub async fn log_workspace_history_event(
    state: &AppState,
    workspace_id: Uuid,
    actor_id: Uuid,
    mut diffs: Vec<Value>,
) {
    let actor = resolve_actor_label(state, actor_id).await;
    if let Some(label) = actor {
        diffs.insert(
            0,
            json!({
                "path": "actor",
                "from": Value::Null,
                "to": label,
            }),
        );
    }

    let payload = Value::Array(diffs);

    let workflows = match state
        .workflow_repo
        .list_workflows_by_workspace_ids(&[workspace_id])
        .await
    {
        Ok(items) => items,
        Err(err) => {
            eprintln!(
                "Failed to load workflows for workspace history event {}: {:?}",
                workspace_id, err
            );
            return;
        }
    };

    for workflow in workflows {
        if let Err(err) = state
            .workflow_repo
            .insert_workflow_log(actor_id, workflow.id, payload.clone())
            .await
        {
            eprintln!(
                "Failed to record history event for workflow {}: {:?}",
                workflow.id, err
            );
        }
    }
}
