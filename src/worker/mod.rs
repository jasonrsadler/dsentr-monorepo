use std::time::Duration;

use crate::engine::execute_run;
use crate::state::AppState;
use tokio::time::sleep;

pub async fn start_background_workers(state: AppState) {
    // Simple single-worker for now. Can be extended to multiple tasks.
    tokio::spawn(async move {
        loop {
            match state.workflow_repo.claim_next_queued_run().await {
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
        }
    });
}
