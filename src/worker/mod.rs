use std::time::Duration;

use crate::engine::execute_run;
use crate::state::AppState;
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
        let use_leases = std::env::var("WORKER_USE_LEASES")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(true);
        loop {
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
