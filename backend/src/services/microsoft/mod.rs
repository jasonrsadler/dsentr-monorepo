use http::StatusCode;
use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use thiserror::Error;

const GRAPH_BASE_URL: &str = "https://graph.microsoft.com/v1.0";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MicrosoftTeam {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MicrosoftChannel {
    pub id: String,
    pub display_name: String,
    pub membership_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MicrosoftChannelMember {
    pub id: String,
    pub user_id: String,
    pub display_name: String,
    pub email: Option<String>,
}

#[derive(Debug, Error)]
pub enum MicrosoftGraphError {
    #[error("failed to perform Microsoft Graph request: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Microsoft Graph responded with status {status}: {message}")]
    UnexpectedStatus { status: StatusCode, message: String },
    #[error("Microsoft Graph returned an invalid response: {0}")]
    InvalidResponse(String),
}

pub async fn fetch_joined_teams(
    client: &Client,
    access_token: &str,
) -> Result<Vec<MicrosoftTeam>, MicrosoftGraphError> {
    fetch_joined_teams_with_base(client, GRAPH_BASE_URL, access_token).await
}

pub async fn fetch_team_channels(
    client: &Client,
    access_token: &str,
    team_id: &str,
) -> Result<Vec<MicrosoftChannel>, MicrosoftGraphError> {
    fetch_team_channels_with_base(client, GRAPH_BASE_URL, access_token, team_id).await
}

pub async fn fetch_channel_members(
    client: &Client,
    access_token: &str,
    team_id: &str,
    channel_id: &str,
) -> Result<Vec<MicrosoftChannelMember>, MicrosoftGraphError> {
    fetch_channel_members_with_base(client, GRAPH_BASE_URL, access_token, team_id, channel_id).await
}

fn build_url(base: &str, path: &str) -> String {
    let trimmed_base = base.trim_end_matches('/');
    if path.is_empty() {
        trimmed_base.to_string()
    } else {
        let trimmed_path = path.trim_start_matches('/');
        format!("{}/{}", trimmed_base, trimmed_path)
    }
}

async fn graph_get<T: DeserializeOwned>(
    client: &Client,
    base_url: &str,
    path: &str,
    access_token: &str,
) -> Result<T, MicrosoftGraphError> {
    let url = build_url(base_url, path);
    let response = client
        .get(url)
        .bearer_auth(access_token)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let message = extract_error_message(&body);
        let status = match StatusCode::from_u16(status.as_u16()) {
            Ok(code) => code,
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        return Err(MicrosoftGraphError::UnexpectedStatus { status, message });
    }

    response
        .json::<T>()
        .await
        .map_err(|err| MicrosoftGraphError::InvalidResponse(err.to_string()))
}

#[derive(Deserialize)]
struct GraphListResponse<T> {
    #[serde(default)]
    value: Vec<T>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawTeam {
    id: Option<String>,
    display_name: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawChannel {
    id: Option<String>,
    display_name: Option<String>,
    membership_type: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawChannelMember {
    id: Option<String>,
    user_id: Option<String>,
    display_name: Option<String>,
    email: Option<String>,
}

fn extract_error_message(body: &str) -> String {
    #[derive(Deserialize)]
    struct GraphErrorBody {
        message: Option<String>,
    }

    #[derive(Deserialize)]
    struct GraphErrorResponse {
        error: Option<GraphErrorBody>,
    }

    if let Ok(parsed) = serde_json::from_str::<GraphErrorResponse>(body) {
        if let Some(message) = parsed.error.and_then(|err| err.message) {
            if !message.trim().is_empty() {
                return message;
            }
        }
    }

    let fallback = body.trim();
    if fallback.is_empty() {
        "Microsoft Graph request failed".to_string()
    } else {
        fallback.to_string()
    }
}

async fn fetch_joined_teams_with_base(
    client: &Client,
    base_url: &str,
    access_token: &str,
) -> Result<Vec<MicrosoftTeam>, MicrosoftGraphError> {
    let response: GraphListResponse<RawTeam> = graph_get(
        client,
        base_url,
        "/me/joinedTeams?$select=id,displayName",
        access_token,
    )
    .await?;

    let teams = response
        .value
        .into_iter()
        .filter_map(|team| {
            let id = team.id?.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let display_name = team
                .display_name
                .and_then(|name| {
                    let trimmed = name.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                })
                .unwrap_or_else(|| id.clone());
            Some(MicrosoftTeam { id, display_name })
        })
        .collect();

    Ok(teams)
}

async fn fetch_team_channels_with_base(
    client: &Client,
    base_url: &str,
    access_token: &str,
    team_id: &str,
) -> Result<Vec<MicrosoftChannel>, MicrosoftGraphError> {
    let path = format!(
        "/teams/{}/channels?$select=id,displayName,membershipType",
        team_id
    );
    let response: GraphListResponse<RawChannel> =
        graph_get(client, base_url, &path, access_token).await?;

    let channels = response
        .value
        .into_iter()
        .filter_map(|channel| {
            let id = channel.id?.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let display_name = channel
                .display_name
                .and_then(|name| {
                    let trimmed = name.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                })
                .unwrap_or_else(|| id.clone());
            let membership_type = channel.membership_type.and_then(|value| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            });
            Some(MicrosoftChannel {
                id,
                display_name,
                membership_type,
            })
        })
        .collect();

    Ok(channels)
}

async fn fetch_channel_members_with_base(
    client: &Client,
    base_url: &str,
    access_token: &str,
    team_id: &str,
    channel_id: &str,
) -> Result<Vec<MicrosoftChannelMember>, MicrosoftGraphError> {
    let filter = "(microsoft.graph.aadUserConversationMember/userId ne null)";
    let path = format!(
        "/teams/{}/channels/{}/members?$select=id,displayName,microsoft.graph.aadUserConversationMember/email,microsoft.graph.aadUserConversationMember/userId&$filter={}",
        team_id,
        channel_id,
        filter.replace(' ', "%20"),
    );
    let response: GraphListResponse<RawChannelMember> =
        graph_get(client, base_url, &path, access_token).await?;

    let members = response
        .value
        .into_iter()
        .filter_map(|member| {
            let user_id = member.user_id?.trim().to_string();
            if user_id.is_empty() {
                return None;
            }
            let display_name = member
                .display_name
                .and_then(|name| {
                    let trimmed = name.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                })
                .unwrap_or_else(|| user_id.clone());
            let email = member.email.and_then(|addr| {
                let trimmed = addr.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            });
            let id = member
                .id
                .and_then(|value| {
                    let trimmed = value.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                })
                .unwrap_or_else(|| user_id.clone());

            Some(MicrosoftChannelMember {
                id,
                user_id,
                display_name,
                email,
            })
        })
        .collect();

    Ok(members)
}

#[cfg(test)]
mod tests {
    use super::*;

    use once_cell::sync::Lazy;
    use tokio::sync::Mutex;

    static CLIENT: Lazy<Mutex<Client>> = Lazy::new(|| {
        Mutex::new(
            Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("client"),
        )
    });

    #[tokio::test]
    async fn sanitize_teams_filters_missing_ids() {
        let client = CLIENT.lock().await;
        let body = serde_json::json!({
            "value": [
                { "id": "team-1", "displayName": "Team One" },
                { "id": " ", "displayName": "Should Skip" },
                { "displayName": "No ID" },
                { "id": "team-2" }
            ]
        });
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/me/joinedTeams")
                .query_param("$select", "id,displayName");
            then.status(200)
                .header("content-type", "application/json")
                .body(body.to_string());
        });

        let teams = fetch_joined_teams_with_base(&client, &server.url(""), "token")
            .await
            .expect("teams");

        mock.assert();
        assert_eq!(teams.len(), 2);
        assert_eq!(
            teams[0],
            MicrosoftTeam {
                id: "team-1".into(),
                display_name: "Team One".into()
            }
        );
        assert_eq!(
            teams[1],
            MicrosoftTeam {
                id: "team-2".into(),
                display_name: "team-2".into()
            }
        );
    }

    #[tokio::test]
    async fn graph_error_surfaces_status_and_message() {
        let client = CLIENT.lock().await;
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.any_request();
            then.status(403)
                .header("content-type", "application/json")
                .body(
                    serde_json::json!({
                        "error": { "message": "Forbidden" }
                    })
                    .to_string(),
                );
        });

        let result =
            fetch_team_channels_with_base(&client, &server.url(""), "token", "team-1").await;

        mock.assert();
        match result {
            Err(MicrosoftGraphError::UnexpectedStatus { status, message }) => {
                assert_eq!(status, StatusCode::FORBIDDEN);
                assert_eq!(message, "Forbidden");
            }
            other => panic!("unexpected result: {other:?}"),
        }
    }

    #[tokio::test]
    async fn fetch_channel_members_requests_user_id_filter() {
        let client = CLIENT.lock().await;
        let server = httpmock::MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::GET)
                .path("/teams/team-1/channels/channel-1/members")
                .query_param(
                    "$select",
                    "id,displayName,microsoft.graph.aadUserConversationMember/email,microsoft.graph.aadUserConversationMember/userId",
                )
                .query_param(
                    "$filter",
                    "(microsoft.graph.aadUserConversationMember/userId ne null)",
                );
            then.status(200)
                .header("content-type", "application/json")
                .body("{\"value\": []}");
        });

        let members = fetch_channel_members_with_base(
            &client,
            &server.url(""),
            "token",
            "team-1",
            "channel-1",
        )
        .await
        .expect("members fetch");

        mock.assert();
        assert!(members.is_empty());
    }
}
