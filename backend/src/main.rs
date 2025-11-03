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

use anyhow::{anyhow, Context, Result};
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::HeaderValue;
use axum::http::Method;
use axum::Json;
use axum::{
    http::HeaderName,
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Router,
};
use config::Config;
use db::oauth_token_repository::UserOAuthTokenRepository;
use db::postgres_oauth_token_repository::PostgresUserOAuthTokenRepository;
use db::postgres_user_repository::PostgresUserRepository;
use db::postgres_workflow_repository::PostgresWorkflowRepository;
use db::postgres_workspace_connection_repository::PostgresWorkspaceConnectionRepository;
use db::postgres_workspace_repository::PostgresWorkspaceRepository;
use reqwest::Client;
use responses::JsonResponse;
use routes::auth::{handle_login, handle_refresh, handle_signup, verify_email};
use routes::{
    account::{confirm_account_deletion, get_account_deletion_summary, request_account_deletion},
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
    microsoft::{list_channel_members, list_team_channels, list_teams},
    oauth::{
        disconnect_connection, google_connect_callback, google_connect_start, list_connections,
        microsoft_connect_callback, microsoft_connect_start, refresh_connection,
        slack_connect_callback, slack_connect_start,
    },
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
use services::oauth::account_service::OAuthAccountService;
use services::oauth::github::client::GitHubOAuthClient;
use services::oauth::google::client::GoogleOAuthClient;
use services::oauth::workspace_service::{WorkspaceOAuthService, WorkspaceTokenRefresher};
use sqlx::PgPool;
use std::{net::SocketAddr, sync::Arc};
#[cfg(not(feature = "tls"))]
use tokio::net::TcpListener;
use tower::ServiceBuilder;
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;
use utils::{
    csrf::{get_csrf_token, validate_csrf},
    jwt::JwtKeys,
};

use crate::db::{
    user_repository::UserRepository, workflow_repository::WorkflowRepository,
    workspace_connection_repository::WorkspaceConnectionRepository,
    workspace_repository::WorkspaceRepository,
};
use crate::services::smtp_mailer::SmtpMailer;
use crate::services::stripe::{LiveStripeService, StripeService};
use crate::state::AppState;

#[cfg(feature = "tls")]
use axum_server::tls_rustls::RustlsConfig;

#[tokio::main]
async fn main() -> Result<()> {
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber)
        .map_err(|error| {
            tracing::error!(error = ?error, "Failed to set global tracing subscriber");
            error
        })
        .context("failed to set global tracing subscriber")?;

    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(1) // 2 req/sec
            .burst_size(5)
            .use_headers() // optional: adds RateLimit-* headers
            .finish()
            .ok_or_else(|| {
                tracing::error!("Failed to build rate limiter configuration");
                anyhow!("failed to build rate limiter configuration")
            })?,
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
            .ok_or_else(|| {
                tracing::error!("Failed to build global rate limiter configuration");
                anyhow!("failed to build global rate limiter configuration")
            })?,
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
            .ok_or_else(|| {
                tracing::error!("Failed to build auth rate limiter configuration");
                anyhow!("failed to build auth rate limiter configuration")
            })?,
    );

    let config = Arc::new(
        Config::from_env()
            .map_err(|error| {
                tracing::error!(error = %error, "Failed to load configuration from environment");
                error
            })
            .context("failed to load configuration from environment")?,
    );

    let jwt_keys = Arc::new(
        JwtKeys::from_env()
            .map_err(|error| {
                tracing::error!(error = %error, "Failed to load JWT secret");
                anyhow!(error)
            })
            .context("failed to load JWT secret from environment")?,
    );

    let pg_pool = establish_connection(&config.database_url).await?;
    let user_repo = Arc::new(PostgresUserRepository {
        pool: pg_pool.clone(),
    }) as Arc<dyn UserRepository>;

    let workflow_repo = Arc::new(PostgresWorkflowRepository {
        pool: pg_pool.clone(),
    }) as Arc<dyn WorkflowRepository>;

    let workspace_repo = Arc::new(PostgresWorkspaceRepository {
        pool: pg_pool.clone(),
    }) as Arc<dyn WorkspaceRepository>;

    // Initialize mailer
    let mailer = Arc::new(
        SmtpMailer::new()
            .map_err(|error| {
                tracing::error!(error = ?error, "Failed to initialize SMTP mailer");
                error
            })
            .context("failed to initialize SMTP mailer")?,
    );
    let http_client = Client::new();
    let http_client_arc = Arc::new(http_client.clone());

    let google_oauth = Arc::new(GoogleOAuthClient {
        client: http_client.clone(),
    });

    let github_oauth = Arc::new(GitHubOAuthClient {
        client: http_client.clone(),
    });

    let oauth_repo = Arc::new(PostgresUserOAuthTokenRepository {
        pool: pg_pool.clone(),
    }) as Arc<dyn UserOAuthTokenRepository>;
    let workspace_connection_repo = Arc::new(PostgresWorkspaceConnectionRepository {
        pool: pg_pool.clone(),
    }) as Arc<dyn WorkspaceConnectionRepository>;
    let encryption_key = Arc::new(config.oauth.token_encryption_key.clone());
    let oauth_accounts = Arc::new(OAuthAccountService::new(
        oauth_repo.clone(),
        workspace_connection_repo.clone(),
        encryption_key.clone(),
        http_client_arc.clone(),
        &config.oauth,
    ));
    let workspace_token_refresher: Arc<dyn WorkspaceTokenRefresher> =
        oauth_accounts.clone() as Arc<dyn WorkspaceTokenRefresher>;
    let workspace_oauth = Arc::new(WorkspaceOAuthService::new(
        oauth_repo.clone(),
        workspace_connection_repo.clone(),
        workspace_token_refresher,
        encryption_key.clone(),
    ));

    let stripe: Arc<dyn StripeService> = Arc::new(LiveStripeService::from_settings(&config.stripe));

    let state = AppState {
        db: user_repo,
        workflow_repo,
        workspace_repo,
        workspace_connection_repo,
        mailer,
        google_oauth,
        github_oauth,
        oauth_accounts,
        workspace_oauth,
        stripe,
        http_client: http_client_arc,
        config: config.clone(),
        worker_id: Arc::new(uuid::Uuid::new_v4().to_string()),
        worker_lease_seconds: std::env::var("WORKER_LEASE_SECONDS")
            .ok()
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(15),
        jwt_keys: jwt_keys.clone(),
    };
    let state_for_worker = state.clone();

    let frontend_origin = config
        .frontend_origin
        .parse::<HeaderValue>()
        .map_err(|error| {
            tracing::error!(
                error = %error,
                origin = %config.frontend_origin,
                "Invalid FRONTEND_ORIGIN provided"
            );
            error
        })
        .context("invalid FRONTEND_ORIGIN value")?;

    let cors = CorsLayer::new()
        .allow_origin(frontend_origin.clone())
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
        .route("/refresh", post(handle_refresh))
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
        .route("/verify-reset-token/{token}", get(handle_verify_token))
        .route(
            "/healthz",
            get(|| async { Json(serde_json::json!({"status": "ok"})) }),
        );

    // Nest them together
    let auth_routes = csrf_protected_routes
        .merge(unprotected_routes)
        .layer(GovernorLayer {
            config: auth_governor_conf.clone(),
        });

    let account_routes = Router::new()
        .route("/delete/request", post(request_account_deletion))
        .route("/delete/confirm", post(confirm_account_deletion))
        .route("/delete/summary/{token}", get(get_account_deletion_summary))
        .layer(csrf_layer.clone())
        .layer(GovernorLayer {
            config: auth_governor_conf.clone(),
        });

    // Protected workflow routes (CSRF layer applied)
    let workflow_routes = Router::new()
        .route("/", post(create_workflow).get(list_workflows))
        .route("/usage", get(routes::workflows::get_plan_usage))
        .route("/runs", get(routes::workflows::list_active_runs))
        .route("/runs/events", get(routes::workflows::sse_global_runs))
        .route(
            "/{workflow_id}",
            get(get_workflow)
                .put(update_workflow)
                .delete(delete_workflow),
        )
        .route(
            "/{workflow_id}/lock",
            post(routes::workflows::lock_workflow).delete(routes::workflows::unlock_workflow),
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

    let workspace_routes = Router::new()
        .route("/", get(routes::workspaces::list_workspaces))
        .route(
            "/onboarding",
            get(routes::workspaces::get_onboarding_context)
                .post(routes::workspaces::complete_onboarding),
        )
        .route("/plan", post(routes::workspaces::change_plan))
        .route(
            "/billing/subscription/resume",
            post(routes::workspaces::resume_workspace_subscription),
        )
        .route(
            "/{workspace_id}/members",
            get(routes::workspaces::list_workspace_members)
                .post(routes::workspaces::add_workspace_member),
        )
        .route(
            "/{workspace_id}/members/{member_id}",
            put(routes::workspaces::update_workspace_member_role)
                .delete(routes::workspaces::remove_workspace_member),
        )
        .route(
            "/{workspace_id}/secrets",
            get(routes::workspaces::list_workspace_secret_ownership),
        )
        .route(
            "/{workspace_id}/leave",
            post(routes::workspaces::leave_workspace),
        )
        .route(
            "/{workspace_id}/revoke",
            post(routes::workspaces::revoke_workspace_member),
        )
        .route(
            "/plan/workspace-to-solo-preview",
            post(routes::workspaces::workspace_to_solo_preview),
        )
        .route(
            "/plan/workspace-to-solo-execute",
            post(routes::workspaces::workspace_to_solo_execute),
        )
        .route(
            "/{workspace_id}/invites",
            get(routes::workspaces::list_workspace_invitations)
                .post(routes::workspaces::create_workspace_invitation),
        )
        .route(
            "/{workspace_id}/invites/{invite_id}/revoke",
            post(routes::workspaces::revoke_workspace_invitation),
        )
        .route(
            "/{workspace_id}/connections/promote",
            post(routes::workspaces::promote_workspace_connection),
        )
        .route(
            "/{workspace_id}/connections/{connection_id}",
            delete(routes::workspaces::remove_workspace_connection),
        )
        .layer(csrf_layer.clone());

    let options_routes = Router::new()
        .route("/secrets", get(list_secrets))
        .route(
            "/secrets/{group}/{service}/{name}",
            put(upsert_secret).delete(delete_secret),
        )
        .layer(csrf_layer.clone());

    let oauth_public_routes = Router::new()
        .route("/google/start", get(google_connect_start))
        .route("/google/callback", get(google_connect_callback))
        .route("/microsoft/start", get(microsoft_connect_start))
        .route("/microsoft/callback", get(microsoft_connect_callback))
        .route("/slack/start", get(slack_connect_start))
        .route("/slack/callback", get(slack_connect_callback));

    let oauth_private_routes = Router::new()
        .route("/connections", get(list_connections))
        .route("/{provider}/refresh", post(refresh_connection))
        .route("/{provider}/disconnect", delete(disconnect_connection))
        .layer(csrf_layer.clone());

    let oauth_routes = oauth_public_routes.merge(oauth_private_routes);

    let microsoft_routes = Router::new()
        .route("/teams", get(list_teams))
        .route("/teams/{team_id}/channels", get(list_team_channels))
        .route(
            "/teams/{team_id}/channels/{channel_id}/members",
            get(list_channel_members),
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
    let invite_routes = Router::new()
        .route("/invites", get(routes::workspaces::list_pending_invites))
        .route(
            "/invites/{token}",
            get(routes::workspaces::preview_invitation),
        )
        .route(
            "/invites/accept",
            post(routes::workspaces::accept_invitation),
        )
        .route(
            "/invites/decline",
            post(routes::workspaces::decline_invitation),
        );
    let app = Router::new()
        .route("/", get(root))
        .route("/api/early-access", post(handle_early_access))
        .route("/api/dashboard", get(dashboard_handler))
        // Stripe webhook: public endpoint, no CSRF/auth
        .route(
            "/api/billing/stripe/webhook",
            post(routes::billing::stripe_webhook),
        )
        // New consolidated Stripe webhook path
        .route("/api/stripe/webhook", post(routes::stripe::webhook))
        .nest("/api/auth", auth_routes) // <-- your auth routes with CSRF selectively applied
        .nest("/api/account", account_routes)
        .nest(
            "/api/workflows",
            workflow_routes.merge(public_workflow_routes),
        )
        .nest("/api/workspaces", workspace_routes)
        .merge(Router::new().nest("/api", invite_routes))
        .nest("/api/oauth", oauth_routes)
        .nest("/api/microsoft", microsoft_routes)
        .nest("/api/options", options_routes)
        .nest("/api/admin", admin_routes)
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(GovernorLayer {
            config: global_governor_conf.clone(),
        })
        .layer(cors);

    let make_service = app.into_make_service_with_connect_info::<SocketAddr>();
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("0.0.0.0:{}", port).parse().unwrap();

    // Start background workers (simple no-op executor for now)
    worker::start_background_workers(state_for_worker).await;
    #[cfg(feature = "tls")]
    {
        // TLS: Only run this block when `--features tls` is used
        let cert_path = std::env::var("DEV_CERT_LOCATION")
            .map_err(|error| {
                tracing::error!(error = %error, "DEV_CERT_LOCATION environment variable missing");
                error
            })
            .context("missing DEV_CERT_LOCATION environment variable")?;
        let key_path = std::env::var("DEV_KEY_LOCATION")
            .map_err(|error| {
                tracing::error!(error = %error, "DEV_KEY_LOCATION environment variable missing");
                error
            })
            .context("missing DEV_KEY_LOCATION environment variable")?;

        let tls_config = RustlsConfig::from_pem_file(&cert_path, &key_path)
            .await
            .map_err(|error| {
                tracing::error!(
                    error = ?error,
                    cert_path = %cert_path,
                    key_path = %key_path,
                    "Failed to load TLS configuration"
                );
                error
            })
            .context("failed to load TLS certificate or key")?;

        info!(%addr, "Running with TLS");
        axum_server::bind_rustls(addr, tls_config)
            .serve(make_service)
            .await
            .map_err(|error| {
                tracing::error!(error = ?error, %addr, "TLS server encountered an error");
                error
            })
            .context("TLS server encountered an error")?;
    }

    #[cfg(not(feature = "tls"))]
    {
        let listener = TcpListener::bind(addr)
            .await
            .map_err(|error| {
                tracing::error!(error = ?error, %addr, "Failed to bind TCP listener");
                error
            })
            .with_context(|| format!("failed to bind TCP listener to {addr}"))?;
        info!(%addr, "Running without TLS");
        axum::serve(listener, make_service)
            .await
            .map_err(|error| {
                tracing::error!(error = ?error, %addr, "Server encountered an error");
                error
            })
            .context("server encountered an error")?;
    }

    Ok(())
}
/// A simple root route.
async fn root() -> Response {
    JsonResponse::success("Hello, DSentr!").into_response()
}

/// Establish a connection to the database and verify it.
async fn establish_connection(database_url: &str) -> Result<PgPool> {
    let pool = PgPool::connect(database_url)
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "Failed to connect to the database");
            error
        })
        .context("failed to connect to the database")?;

    sqlx::query("SELECT 1")
        .execute(&pool)
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "Failed to verify database connection");
            error
        })
        .context("failed to verify database connection")?;

    info!("✅ Successfully connected to the database");
    Ok(pool)
}
