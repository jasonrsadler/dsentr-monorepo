use axum::{http::StatusCode, response::Response};
use tracing::error;

use crate::{responses::JsonResponse, state::WorkspaceLimitError};

pub(crate) fn workspace_limit_error_response(err: WorkspaceLimitError) -> Response {
    match err {
        WorkspaceLimitError::WorkspacePlanRequired => JsonResponse::forbidden_with_code(
            "Upgrade to the Workspace plan to invite or manage members in this workspace",
            "workspace_plan_required",
        )
        .into_response(),
        WorkspaceLimitError::MemberLimitReached { limit } => {
            let message = format!(
                "Workspace plans support up to {limit} members. Remove an existing member or contact support to increase your limit."
            );
            JsonResponse::error_with_code(
                StatusCode::BAD_REQUEST,
                &message,
                "workspace_member_limit",
            )
            .into_response()
        }
        WorkspaceLimitError::RunLimitReached { limit } => {
            let message = format!(
                "Workspace run usage has reached the {limit} runs per month allocation. Upgrade or wait for the next cycle before running more workflows."
            );
            JsonResponse::error_with_code(
                StatusCode::TOO_MANY_REQUESTS,
                &message,
                "workspace_run_limit",
            )
            .into_response()
        }
        WorkspaceLimitError::Database(err) => {
            error!(?err, "workspace limit check failed");
            JsonResponse::server_error("Failed to verify workspace limits").into_response()
        }
    }
}
