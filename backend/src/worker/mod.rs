use std::time::Duration;

use crate::engine::execute_run;
use crate::models::workflow_schedule::WorkflowSchedule;
use crate::state::AppState;
use crate::utils::schedule::{
    compute_next_run, offset_to_utc, parse_schedule_config, utc_to_offset,
};
use chrono::Utc;
use serde_json::{json, Value};
use tokio::time::sleep;

pub async fn start_background_workers(state: AppState) {
    // Simple single-worker for now. Can be extended to multiple tasks.
    tokio::spawn(async move {
        // Periodic retention cleanup
        let retention_days: i32 = std::env::var("RUN_RETENTION_DAYS")
            .ok()
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(30);
        let mut last_cleanup = std::time::Instant::now();
        let mut last_schedule_check = std::time::Instant::now();
        let use_leases = std::env::var("WORKER_USE_LEASES")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(true);
        loop {
            if last_schedule_check.elapsed() > Duration::from_secs(5) {
                if let Err(err) = process_due_schedules(&state).await {
                    eprintln!("worker: error processing schedules: {:?}", err);
                }
                last_schedule_check = std::time::Instant::now();
            }
            if use_leases {
                // Requeue any expired leases before claiming
                let _ = state.workflow_repo.requeue_expired_leases().await;
            }
            let claim_res = if use_leases {
                state
                    .workflow_repo
                    .claim_next_eligible_run(&state.worker_id, state.worker_lease_seconds)
                    .await
            } else {
                state.workflow_repo.claim_next_queued_run().await
            };

            match claim_res {
                Ok(Some(run)) => {
                    execute_run(state.clone(), run).await;
                }
                Ok(None) => {
                    sleep(Duration::from_millis(750)).await;
                }
                Err(e) => {
                    eprintln!("worker: error claiming run: {:?}", e);
                    sleep(Duration::from_millis(1000)).await;
                }
            }

            // Do cleanup once in a while (every ~10 minutes)
            if last_cleanup.elapsed() > Duration::from_secs(600) {
                let _ = state.workflow_repo.purge_old_runs(retention_days).await;
                last_cleanup = std::time::Instant::now();
            }
        }
    });
}

async fn process_due_schedules(state: &AppState) -> Result<(), sqlx::Error> {
    const MAX_SCHEDULES: i64 = 10;
    let schedules = state
        .workflow_repo
        .list_due_schedules(MAX_SCHEDULES)
        .await?;
    for schedule in schedules {
        let schedule_id = schedule.id;
        if let Err(err) = trigger_schedule(state, schedule).await {
            eprintln!(
                "worker: failed to trigger schedule {}: {:?}",
                schedule_id, err
            );
        }
    }
    Ok(())
}

async fn trigger_schedule(state: &AppState, schedule: WorkflowSchedule) -> Result<(), sqlx::Error> {
    let config = match parse_schedule_config(&schedule.config) {
        Some(cfg) => cfg,
        None => {
            state
                .workflow_repo
                .disable_workflow_schedule(schedule.workflow_id)
                .await?;
            return Ok(());
        }
    };

    let next_time = match schedule.next_run_at {
        Some(ts) => ts,
        None => {
            state
                .workflow_repo
                .disable_workflow_schedule(schedule.workflow_id)
                .await?;
            return Ok(());
        }
    };

    let last_run_utc = match offset_to_utc(next_time) {
        Some(dt) => dt,
        None => {
            state
                .workflow_repo
                .disable_workflow_schedule(schedule.workflow_id)
                .await?;
            return Ok(());
        }
    };

    let workflow_opt = state
        .workflow_repo
        .find_workflow_by_id(schedule.user_id, schedule.workflow_id)
        .await?;

    let workflow = match workflow_opt {
        Some(w) => w,
        None => {
            state
                .workflow_repo
                .disable_workflow_schedule(schedule.workflow_id)
                .await?;
            return Ok(());
        }
    };

    let mut snapshot = workflow.data.clone();
    snapshot["_egress_allowlist"] = Value::Array(
        workflow
            .egress_allowlist
            .iter()
            .cloned()
            .map(Value::String)
            .collect(),
    );

    let mut context = snapshot
        .get("_trigger_context")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if let Value::Object(ref mut map) = context {
        map.insert("scheduled".to_string(), Value::Bool(true));
        map.insert(
            "scheduleId".to_string(),
            Value::String(schedule.id.to_string()),
        );
        map.insert(
            "scheduledFor".to_string(),
            Value::String(next_time.to_string()),
        );
        map.insert("scheduleConfig".to_string(), schedule.config.clone());
    } else {
        context = json!({
            "scheduled": true,
            "scheduleId": schedule.id,
            "scheduledFor": next_time.to_string(),
            "scheduleConfig": schedule.config.clone(),
        });
    }
    snapshot["_trigger_context"] = context;

    state
        .workflow_repo
        .create_workflow_run(schedule.user_id, schedule.workflow_id, snapshot, None)
        .await?;

    let now = Utc::now();
    let next_dt = compute_next_run(&config, Some(last_run_utc), now);
    let last_offset = match utc_to_offset(now) {
        Some(v) => v,
        None => {
            state
                .workflow_repo
                .disable_workflow_schedule(schedule.workflow_id)
                .await?;
            return Ok(());
        }
    };
    let next_offset = next_dt.and_then(utc_to_offset);
    state
        .workflow_repo
        .mark_schedule_run(schedule.id, last_offset, next_offset)
        .await?;

    Ok(())
}
