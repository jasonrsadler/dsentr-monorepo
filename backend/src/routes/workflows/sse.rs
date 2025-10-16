use super::prelude::*;

pub async fn sse_run_events(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((workflow_id, run_id)): Path<(Uuid, Uuid)>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let user_id = Uuid::parse_str(&claims.id).ok();

    let state = app_state.clone();
    let s = stream! {
        let mut last_run_updated: Option<time::OffsetDateTime> = None;
        let mut last_node_updated: Option<time::OffsetDateTime> = None;
        let mut intv = tokio::time::interval(Duration::from_millis(800));
        loop {
            intv.tick().await;
            // If not authorized, emit error once and end
            if user_id.is_none() {
                let ev = Event::default().event("error").json_data(json!({"error": "unauthorized"})).unwrap();
                yield Ok::<Event, Infallible>(ev);
                break;
            }
            let uid = user_id.unwrap();
            // Send run update if newer
            if let Ok(Some(run)) = state
                .workflow_repo
                .get_workflow_run(uid, workflow_id, run_id)
                .await
            {
                if last_run_updated.map(|t| t < run.updated_at).unwrap_or(true) {
                    last_run_updated = Some(run.updated_at);
                    let ev = Event::default().event("run").json_data(&run).unwrap();
                    yield Ok::<Event, Infallible>(ev);
                }
            }

            // Send node runs if any updated
            if let Ok(nodes) = state
                .workflow_repo
                .list_workflow_node_runs(uid, workflow_id, run_id)
                .await
            {
                if let Some(max_upd) = nodes.iter().map(|n| n.updated_at).max() {
                    if last_node_updated.map(|t| t < max_upd).unwrap_or(true) {
                        last_node_updated = Some(max_upd);
                        let ev = Event::default().event("node_runs").json_data(&nodes).unwrap();
                        yield Ok::<Event, Infallible>(ev);
                    }
                }
            }

            // keep alive tick every ~10s to prevent proxies from closing
        }
    };

    Sse::new(s).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(10))
            .text("keepalive"),
    )
}

pub async fn sse_workflow_runs(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(workflow_id): Path<Uuid>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => Uuid::nil(),
    };
    let state = app_state.clone();
    let s = stream! {
        let mut last_ids: Option<Vec<(Uuid, String)>> = None;
        let mut intv = tokio::time::interval(Duration::from_millis(1000));
        loop {
            intv.tick().await;
            if user_id.is_nil() {
                let ev = Event::default().event("error").data("unauthorized");
                yield Ok::<Event, Infallible>(ev);
                break;
            }
            match state.workflow_repo.list_active_runs(user_id, Some(workflow_id)).await {
                Ok(runs) => {
                    let ids: Vec<(Uuid, String)> = runs.iter().map(|r| (r.id, r.status.clone())).collect();
                    let changed = last_ids.as_ref().map(|prev| prev != &ids).unwrap_or(true);
                    if changed {
                        last_ids = Some(ids);
                        let ev = Event::default().event("runs").json_data(&runs).unwrap();
                        yield Ok::<Event, Infallible>(ev);
                    } else {
                        yield Ok::<Event, Infallible>(Event::default().event("tick").data("{}"));
                    }
                }
                Err(_) => {
                    let ev = Event::default().event("error").data("fetch_failed");
                    yield Ok::<Event, Infallible>(ev);
                }
            }
        }
    };
    Sse::new(s).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(10))
            .text("keepalive"),
    )
}

pub async fn sse_global_runs(
    State(app_state): State<AppState>,
    AuthSession(claims): AuthSession,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let user_id = match Uuid::parse_str(&claims.id) {
        Ok(id) => id,
        Err(_) => Uuid::nil(),
    };
    let state = app_state.clone();
    let s = stream! {
        let mut last: Option<(bool, bool)> = None;
        let mut intv = tokio::time::interval(Duration::from_millis(1500));
        loop {
            intv.tick().await;
            if user_id.is_nil() {
                let ev = Event::default().event("error").data("unauthorized");
                yield Ok::<Event, Infallible>(ev);
                break;
            }
            match state.workflow_repo.list_active_runs(user_id, None).await {
                Ok(runs) => {
                    let has_running = runs.iter().any(|r| r.status == "running");
                    let has_queued = runs.iter().any(|r| r.status == "queued");
                    let cur = (has_running, has_queued);
                    if last.map(|p| p != cur).unwrap_or(true) {
                        last = Some(cur);
                        let payload = json!({"has_running": has_running, "has_queued": has_queued});
                        let ev = Event::default().event("status").json_data(payload).unwrap();
                        yield Ok::<Event, Infallible>(ev);
                    } else {
                        yield Ok::<Event, Infallible>(Event::default().event("tick").data("{}"));
                    }
                }
                Err(_) => {
                    let ev = Event::default().event("error").data("fetch_failed");
                    yield Ok::<Event, Infallible>(ev);
                }
            }
        }
    };
    Sse::new(s).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(10))
            .text("keepalive"),
    )
}

// Protected endpoint to fetch a webhook URL for a workflow (for display in UI)
