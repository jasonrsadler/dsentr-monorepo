mod config;
mod db;
mod engine;
mod models;
mod responses;
mod routes;
mod services;
mod state;
pub mod utils;
mod worker;

use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::HeaderValue;
use axum::http::Method;
use axum::{
    http::HeaderName,
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Router,
};
use config::Config;
use db::postgres_user_repository::PostgresUserRepository;
use db::postgres_workflow_repository::PostgresWorkflowRepository;
use reqwest::Client;
use responses::JsonResponse;
use routes::auth::{handle_login, handle_signup, verify_email};
use routes::{
    admin::purge_runs,
    auth::{
        forgot_password::handle_forgot_password,
        github_login::{github_callback, github_login},
        google_login::{google_callback, google_login},
        handle_logout, handle_me,
        reset_password::{handle_reset_password, handle_verify_token},
    },
    dashboard::dashboard_handler,
    early_access::handle_early_access,
    options::secrets::{delete_secret, list_secrets, upsert_secret},
    workflows::{
        cancel_all_runs_for_workflow, cancel_workflow_run, create_workflow, delete_workflow,
        download_run_json, get_egress_allowlist, get_webhook_config, get_webhook_url, get_workflow,
        get_workflow_run_status, list_dead_letters, list_runs_for_workflow, list_workflows,
        regenerate_webhook_token, requeue_dead_letter, rerun_from_failed_node, rerun_workflow_run,
        set_concurrency_limit, set_egress_allowlist, set_webhook_config, sse_run_events,
        start_workflow_run, update_workflow, webhook_trigger,
    },
};
use services::oauth::github::client::GitHubOAuthClient;
use services::oauth::google::client::GoogleOAuthClient;
use sqlx::PgPool;
use std::{net::SocketAddr, sync::Arc};
use tokio::net::TcpListener;
use tower::ServiceBuilder;
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;
use utils::csrf::{get_csrf_token, validate_csrf};

use crate::db::{user_repository::UserRepository, workflow_repository::WorkflowRepository};
use crate::services::smtp_mailer::SmtpMailer;
use crate::state::AppState;

#[cfg(feature = "tls")]
use axum_server::tls_rustls::RustlsConfig;

#[tokio::main]
async fn main() {
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber).unwrap();

    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(1) // 2 req/sec
            .burst_size(5)
            .use_headers() // optional: adds RateLimit-* headers
            .finish()
            .unwrap(),
    );

    // ✅ Background task to cleanup old IPs
    let governor_limiter = governor_conf.limiter().clone();
    std::thread::spawn(move || {
        let interval = std::time::Duration::from_secs(60);
        loop {
            std::thread::sleep(interval);
            //tracing::info!("Rate limiting map size: {}", governor_limiter.len());
            governor_limiter.retain_recent();
        }
    });

    let rate_limit_ms: u64 = std::env::var("RATE_LIMITER_MILLISECONDS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        // Default: 200ms/token (~5 req/sec)
        .unwrap_or(200);
    let rate_limit_burst: u32 = std::env::var("RATE_LIMITER_BURST")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        // Default: allow short bursts during client polling
        .unwrap_or(20);
    let global_governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_millisecond(rate_limit_ms)
            .burst_size(rate_limit_burst)
            .use_headers()
            .error_handler(|_err| {
                JsonResponse::too_many_requests(
                    "Too many requests. Please wait a moment and try again.",
                )
                .into_response()
            })
            .finish()
            .unwrap(),
    );

    let rate_limit_auth_s: u64 = std::env::var("RATE_LIMITER_AUTH_SECONDS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(1);
    let rate_limit_auth_burst: u32 = std::env::var("RATE_LIMITER_AUTH_BURST")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(10);
    // Stricter limiter for /api/auth/*
    let auth_governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(rate_limit_auth_s)
            .burst_size(rate_limit_auth_burst)
            .use_headers()
            .error_handler(|_err| {
                JsonResponse::too_many_requests(
                    "Too many requests. Please wait a moment and try again.",
                )
                .into_response()
            })
            .finish()
            .unwrap(),
    );

    let config = Config::from_env();

    let pg_pool = establish_connection(&config.database_url).await;
    let user_repo = Arc::new(PostgresUserRepository {
        pool: pg_pool.clone(),
    }) as Arc<dyn UserRepository>;

    let workflow_repo = Arc::new(PostgresWorkflowRepository {
        pool: pg_pool.clone(),
    }) as Arc<dyn WorkflowRepository>;

    // Initialize mailer
    let mailer = Arc::new(SmtpMailer::new().expect("Failed to initialize mailer"));
    let http_client = Client::new();

    let google_oauth = Arc::new(GoogleOAuthClient {
        client: http_client.clone(),
    });

    let github_oauth = Arc::new(GitHubOAuthClient {
        client: http_client.clone(),
    });

    let state = AppState {
        db: user_repo,
        workflow_repo,
        mailer,
        google_oauth,
        github_oauth,
        worker_id: Arc::new(uuid::Uuid::new_v4().to_string()),
        worker_lease_seconds: std::env::var("WORKER_LEASE_SECONDS")
            .ok()
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(15),
    };
    let state_for_worker = state.clone();

    let cors = CorsLayer::new()
        .allow_origin(config.frontend_origin.parse::<HeaderValue>().unwrap())
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([
            AUTHORIZATION,
            CONTENT_TYPE,
            HeaderName::from_static("x-csrf-token"),
        ])
        .allow_credentials(true);

    let csrf_layer = ServiceBuilder::new().layer(axum::middleware::from_fn(validate_csrf));

    // Routes that require CSRF protection (typically unsafe HTTP methods)
    let csrf_protected_routes = Router::new()
        .route("/signup", post(handle_signup))
        .route("/login", post(handle_login))
        .route("/logout", post(handle_logout))
        .route("/verify", post(verify_email))
        .route("/forgot-password", post(handle_forgot_password))
        .route("/reset-password", post(handle_reset_password))
        .layer(csrf_layer.clone()) // Apply CSRF middleware here
        .layer(GovernorLayer {
            config: auth_governor_conf.clone(),
        });

    // Routes that do NOT require CSRF (safe methods and OAuth)
    let unprotected_routes = Router::new()
        .route("/me", get(handle_me))
        .route("/csrf-token", get(get_csrf_token))
        .route("/google-login", get(google_login))
        .route("/github-login", get(github_login))
        .route("/google-callback", get(google_callback))
        .route("/github-callback", get(github_callback))
        .route("/verify-reset-token/{token}", get(handle_verify_token));

    // Nest them together
    let auth_routes = csrf_protected_routes
        .merge(unprotected_routes)
        .layer(GovernorLayer {
            config: auth_governor_conf.clone(),
        });

    // Protected workflow routes (CSRF layer applied)
    let workflow_routes = Router::new()
        .route("/", post(create_workflow).get(list_workflows))
        .route("/runs", get(routes::workflows::list_active_runs))
        .route("/runs/events", get(routes::workflows::sse_global_runs))
        .route(
            "/{workflow_id}",
            get(get_workflow)
                .put(update_workflow)
                .delete(delete_workflow),
        )
        .route("/{workflow_id}/run", post(start_workflow_run))
        .route("/{workflow_id}/runs/{run_id}", get(get_workflow_run_status))
        .route(
            "/{workflow_id}/runs/{run_id}/cancel",
            post(cancel_workflow_run),
        )
        .route("/{workflow_id}/runs", get(list_runs_for_workflow))
        .route(
            "/{workflow_id}/runs/cancel-all",
            post(cancel_all_runs_for_workflow),
        )
        .route(
            "/{workflow_id}/runs/{run_id}/rerun",
            post(rerun_workflow_run),
        )
        .route(
            "/{workflow_id}/runs/{run_id}/rerun-from-failed",
            post(rerun_from_failed_node),
        )
        .route(
            "/{workflow_id}/runs/{run_id}/download",
            get(download_run_json),
        )
        .route("/{workflow_id}/runs/{run_id}/events", get(sse_run_events))
        .route(
            "/{workflow_id}/runs/events-stream",
            get(routes::workflows::sse_workflow_runs),
        )
        .route("/{workflow_id}/webhook-url", get(get_webhook_url))
        .route(
            "/{workflow_id}/webhook/config",
            get(get_webhook_config).post(set_webhook_config),
        )
        .route(
            "/{workflow_id}/webhook/regenerate",
            post(regenerate_webhook_token),
        )
        .route(
            "/{workflow_id}/egress",
            get(get_egress_allowlist).post(set_egress_allowlist),
        )
        .route(
            "/{workflow_id}/egress/blocks",
            get(routes::workflows::list_egress_block_events)
                .delete(routes::workflows::clear_egress_block_events),
        )
        .route("/{workflow_id}/concurrency", post(set_concurrency_limit))
        .route(
            "/{workflow_id}/dead-letters",
            get(list_dead_letters).delete(routes::workflows::clear_dead_letters_api),
        )
        .route(
            "/{workflow_id}/dead-letters/{dead_id}/requeue",
            post(requeue_dead_letter),
        )
        .route(
            "/{workflow_id}/logs",
            get(routes::workflows::list_workflow_logs)
                .delete(routes::workflows::clear_workflow_logs),
        )
        .route(
            "/{workflow_id}/logs/{log_id}",
            delete(routes::workflows::delete_workflow_log_entry),
        )
        .layer(csrf_layer.clone());

    let options_routes = Router::new()
        .route("/secrets", get(list_secrets))
        .route(
            "/secrets/{group}/{service}/{name}",
            put(upsert_secret).delete(delete_secret),
        )
        .layer(csrf_layer.clone());

    // Admin routes (CSRF + rate limit). Only Admin role may call these handlers.
    let admin_routes = Router::new()
        .route("/purge-runs", post(purge_runs))
        .layer(csrf_layer.clone())
        .layer(GovernorLayer {
            config: global_governor_conf.clone(),
        });

    // Public webhook route (no CSRF, no auth)
    let public_workflow_routes =
        Router::new().route("/{workflow_id}/trigger/{token}", post(webhook_trigger));
    let app = Router::new()
        .route("/", get(root))
        .route("/api/early-access", post(handle_early_access))
        .route("/api/dashboard", get(dashboard_handler))
        .nest("/api/auth", auth_routes) // <-- your auth routes with CSRF selectively applied
        .nest(
            "/api/workflows",
            workflow_routes.merge(public_workflow_routes),
        )
        .nest("/api/options", options_routes)
        .nest("/api/admin", admin_routes)
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(GovernorLayer {
            config: global_governor_conf.clone(),
        })
        .layer(cors);

    let make_service = app.into_make_service_with_connect_info::<SocketAddr>();
    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));

    // Start background workers (simple no-op executor for now)
    worker::start_background_workers(state_for_worker).await;
    #[cfg(feature = "tls")]
    {
        // TLS: Only run this block when `--features tls` is used
        let tls_config = RustlsConfig::from_pem_file(
            std::env::var("DEV_CERT_LOCATION").unwrap(),
            std::env::var("DEV_KEY_LOCATION").unwrap(),
        )
        .await
        .expect("Failed to load TLS certs");

        println!("Running with TLS at https://{}", addr);
        let _ = axum_server::bind_rustls(addr, tls_config)
            .serve(make_service)
            .await;

        return; // Skip the fallback if TLS was used
    }

    let listener = TcpListener::bind(addr).await.unwrap();
    println!("Running without TLS at http://{}", addr);
    axum::serve(listener, make_service).await.unwrap();
}
/// A simple root route.
async fn root() -> Response {
    JsonResponse::success("Hello, Dsentr!").into_response()
}

/// Establish a connection to the database and verify it.
async fn establish_connection(database_url: &str) -> PgPool {
    let pool = PgPool::connect(database_url)
        .await
        .expect("Failed to connect to the database");

    sqlx::query("SELECT 1")
        .execute(&pool)
        .await
        .expect("Failed to verify database connection");

    info!("✅ Successfully connected to the database");
    pool
}
