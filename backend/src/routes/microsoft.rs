use axum::{
    extract::{Path, State},
    response::{IntoResponse, Response},
    Json,
};
use http::StatusCode;
use serde::Serialize;
use tracing::error;
use uuid::Uuid;

use crate::models::oauth_token::ConnectedOAuthProvider;
use crate::responses::JsonResponse;
use crate::routes::auth::claims::Claims;
use crate::routes::auth::session::AuthSession;
use crate::routes::oauth::map_oauth_error;
use crate::services::microsoft::{
    fetch_channel_members, fetch_joined_teams, fetch_team_channels, MicrosoftChannel,
    MicrosoftChannelMember, MicrosoftGraphError, MicrosoftTeam,
};
use crate::services::oauth::account_service::StoredOAuthToken;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamPayload {
    id: String,
    display_name: String,
}

impl From<MicrosoftTeam> for TeamPayload {
    fn from(value: MicrosoftTeam) -> Self {
        Self {
            id: value.id,
            display_name: value.display_name,
        }
    }
}

#[derive(Serialize)]
struct TeamsResponse {
    success: bool,
    teams: Vec<TeamPayload>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChannelPayload {
    id: String,
    display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    membership_type: Option<String>,
}

impl From<MicrosoftChannel> for ChannelPayload {
    fn from(value: MicrosoftChannel) -> Self {
        Self {
            id: value.id,
            display_name: value.display_name,
            membership_type: value.membership_type,
        }
    }
}

#[derive(Serialize)]
struct ChannelsResponse {
    success: bool,
    channels: Vec<ChannelPayload>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MemberPayload {
    id: String,
    user_id: String,
    display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
}

impl From<MicrosoftChannelMember> for MemberPayload {
    fn from(value: MicrosoftChannelMember) -> Self {
        Self {
            id: value.id,
            user_id: value.user_id,
            display_name: value.display_name,
            email: value.email,
        }
    }
}

#[derive(Serialize)]
struct MembersResponse {
    success: bool,
    members: Vec<MemberPayload>,
}

pub async fn list_teams(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
) -> Response {
    let user_id = match parse_user_id(&claims) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    let token = match ensure_microsoft_token(&state, user_id).await {
        Ok(token) => token,
        Err(resp) => return resp,
    };

    let teams = match fetch_joined_teams(state.http_client.as_ref(), &token.access_token).await {
        Ok(items) => items,
        Err(err) => return graph_error_response(err),
    };

    Json(TeamsResponse {
        success: true,
        teams: teams.into_iter().map(TeamPayload::from).collect(),
    })
    .into_response()
}

pub async fn list_team_channels(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path(team_id): Path<String>,
) -> Response {
    let user_id = match parse_user_id(&claims) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    let token = match ensure_microsoft_token(&state, user_id).await {
        Ok(token) => token,
        Err(resp) => return resp,
    };

    let trimmed_id = team_id.trim();
    if trimmed_id.is_empty() {
        return JsonResponse::bad_request("Team ID is required").into_response();
    }
    let encoded_team = urlencoding::encode(trimmed_id);

    let channels = match fetch_team_channels(
        state.http_client.as_ref(),
        &token.access_token,
        encoded_team.as_ref(),
    )
    .await
    {
        Ok(items) => items,
        Err(err) => return graph_error_response(err),
    };

    Json(ChannelsResponse {
        success: true,
        channels: channels.into_iter().map(ChannelPayload::from).collect(),
    })
    .into_response()
}

pub async fn list_channel_members(
    State(state): State<AppState>,
    AuthSession(claims): AuthSession,
    Path((team_id, channel_id)): Path<(String, String)>,
) -> Response {
    let user_id = match parse_user_id(&claims) {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    let token = match ensure_microsoft_token(&state, user_id).await {
        Ok(token) => token,
        Err(resp) => return resp,
    };

    let trimmed_team = team_id.trim();
    if trimmed_team.is_empty() {
        return JsonResponse::bad_request("Team ID is required").into_response();
    }
    let trimmed_channel = channel_id.trim();
    if trimmed_channel.is_empty() {
        return JsonResponse::bad_request("Channel ID is required").into_response();
    }

    let encoded_team = urlencoding::encode(trimmed_team);
    let encoded_channel = urlencoding::encode(trimmed_channel);

    let members = match fetch_channel_members(
        state.http_client.as_ref(),
        &token.access_token,
        encoded_team.as_ref(),
        encoded_channel.as_ref(),
    )
    .await
    {
        Ok(items) => items,
        Err(err) => return graph_error_response(err),
    };

    Json(MembersResponse {
        success: true,
        members: members.into_iter().map(MemberPayload::from).collect(),
    })
    .into_response()
}

#[allow(clippy::result_large_err)]
fn parse_user_id(claims: &Claims) -> Result<Uuid, Response> {
    Uuid::parse_str(&claims.id)
        .map_err(|_| JsonResponse::unauthorized("Invalid user identifier").into_response())
}

async fn ensure_microsoft_token(
    state: &AppState,
    user_id: Uuid,
) -> Result<StoredOAuthToken, Response> {
    state
        .oauth_accounts
        .ensure_valid_access_token(user_id, ConnectedOAuthProvider::Microsoft)
        .await
        .map_err(map_oauth_error)
}

fn graph_error_response(err: MicrosoftGraphError) -> Response {
    match err {
        MicrosoftGraphError::Http(error) => {
            error!(?error, "Microsoft Graph HTTP error");
            JsonResponse::server_error("Failed to contact Microsoft Graph").into_response()
        }
        MicrosoftGraphError::UnexpectedStatus { status, message } => {
            error!(%status, %message, "Microsoft Graph responded with an error");
            if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
                JsonResponse::unauthorized(
                    "The Microsoft connection no longer has permission. Refresh the integration in Settings.",
                )
                .into_response()
            } else {
                JsonResponse::server_error(&message).into_response()
            }
        }
        MicrosoftGraphError::InvalidResponse(message) => {
            error!(%message, "Microsoft Graph returned an invalid payload");
            JsonResponse::server_error("Microsoft Graph returned an unexpected response")
                .into_response()
        }
    }
}
