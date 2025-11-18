use axum::{
    extract::{Json, State},
    response::{IntoResponse, Response},
};
use rand::{distr::Alphanumeric, Rng};
use serde::Deserialize;
use time::{Duration, OffsetDateTime};

use crate::{models::user::OauthProvider, responses::JsonResponse, state::AppState};

#[derive(Deserialize)]
pub struct ResendVerificationPayload {
    pub email: String,
}

pub async fn resend_verification_email(
    State(state): State<AppState>,
    Json(payload): Json<ResendVerificationPayload>,
) -> Response {
    let repo = &state.db;

    let email = payload.email.trim().to_lowercase();

    let user = match repo.find_user_by_email(&email).await {
        Ok(Some(user)) => user,
        Ok(None) => {
            return JsonResponse::success(
                "If an account exists for that email, a verification link has been sent.",
            )
            .into_response();
        }
        Err(err) => {
            eprintln!("Failed to look up user for resend verification: {:?}", err);
            return JsonResponse::server_error("Something went wrong").into_response();
        }
    };

    // OAuth users never need email verification
    if user.oauth_provider != Some(OauthProvider::Email) {
        return JsonResponse::success(
            "If an account exists for that email, a verification link has been sent.",
        )
        .into_response();
    }

    // Already verified; behave as success
    if user.is_verified {
        return JsonResponse::success(
            "If an account exists for that email, a verification link has been sent.",
        )
        .into_response();
    }

    // Generate fresh token
    let token: String = rand::rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    let now = OffsetDateTime::now_utc();
    let expires_at = now + Duration::hours(24);

    // Clear out any existing tokens
    if let Err(err) = repo.delete_verification_tokens_for_user(user.id).await {
        eprintln!(
            "Failed to delete old verification tokens for user {}: {:?}",
            user.id, err
        );
        return JsonResponse::server_error("Could not generate verification token").into_response();
    }

    // Insert the new token
    if let Err(err) = repo
        .insert_verification_token(user.id, &token, expires_at)
        .await
    {
        eprintln!(
            "Failed to insert verification token for user {}: {:?}",
            user.id, err
        );
        return JsonResponse::server_error("Could not generate verification token").into_response();
    }

    // Send email
    if let Err(err) = state.mailer.send_verification_email(&email, &token).await {
        eprintln!(
            "Failed to send verification email for user {}: {:?}",
            user.id, err
        );
        return JsonResponse::server_error("Failed to send verification email").into_response();
    }

    JsonResponse::success("If an account exists for that email, a verification link has been sent.")
        .into_response()
}
