pub(crate) use std::collections::HashMap;

pub(crate) use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Redirect, Response},
    Json,
};
pub(crate) use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
pub(crate) use reqwest::Url;
pub(crate) use serde::{Deserialize, Serialize};
pub(crate) use time::{Duration, OffsetDateTime};
pub(crate) use tracing::error;
pub(crate) use urlencoding::encode;
pub(crate) use uuid::Uuid;

pub(crate) use crate::{
    config::Config,
    models::oauth_token::ConnectedOAuthProvider,
    responses::JsonResponse,
    routes::auth::session::AuthSession,
    services::oauth::account_service::OAuthAccountError,
    state::AppState,
    utils::{csrf::generate_csrf_token, plan_limits::NormalizedPlanTier},
};
