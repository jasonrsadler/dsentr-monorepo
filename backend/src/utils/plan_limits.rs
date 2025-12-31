use serde_json::Value;
use std::{borrow::Cow, convert::Infallible, str::FromStr};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NormalizedPlanTier {
    Solo,
    Workspace,
}

impl NormalizedPlanTier {
    pub fn from_option(raw: Option<&str>) -> Self {
        let normalized = raw.unwrap_or_default().trim().to_lowercase();
        if normalized.is_empty() {
            return Self::Solo;
        }

        let key = normalized
            .split([':', '-', '_', ' ', '/', '.'])
            .next()
            .unwrap_or(normalized.as_str());

        match key {
            "workspace" | "team" | "organization" | "organisation" | "org" | "enterprise" => {
                Self::Workspace
            }
            "solo" | "free" | "personal" | "individual" => Self::Solo,
            _ => {
                if normalized.contains("workspace")
                    || normalized.contains("organization")
                    || normalized.contains("organisation")
                    || normalized.contains("org:")
                    || normalized.contains("org_")
                {
                    Self::Workspace
                } else {
                    Self::Solo
                }
            }
        }
    }

    pub fn is_solo(self) -> bool {
        matches!(self, Self::Solo)
    }
}

impl FromStr for NormalizedPlanTier {
    type Err = Infallible;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        Ok(Self::from_option(Some(raw)))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanViolation {
    pub code: &'static str,
    pub message: String,
    pub node_label: Option<String>,
}

impl PlanViolation {
    fn new<M: Into<String>>(code: &'static str, message: M, node_label: Option<String>) -> Self {
        Self {
            code,
            message: message.into(),
            node_label,
        }
    }
}

pub struct WorkflowAssessment {
    pub node_count: usize,
    pub violations: Vec<PlanViolation>,
}

fn node_label(node: &Value) -> Option<String> {
    node.get("data")
        .and_then(|data| data.get("label"))
        .and_then(|label| label.as_str())
        .map(|label| label.trim().to_string())
        .filter(|label| !label.is_empty())
}

fn action_type(node: &Value) -> Option<Cow<'_, str>> {
    node.get("data")
        .and_then(|data| data.get("actionType"))
        .and_then(|value| value.as_str())
        .map(|value| Cow::Owned(value.to_lowercase()))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MessagingIntegration {
    Slack,
    Teams,
}

fn detect_messaging_integration(candidate: &str) -> Option<MessagingIntegration> {
    let normalized = candidate.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }

    if normalized.contains("slack") {
        return Some(MessagingIntegration::Slack);
    }
    if normalized.contains("teams") || normalized.contains("microsoft") {
        return Some(MessagingIntegration::Teams);
    }

    None
}

fn messaging_integration(node: &Value) -> Option<MessagingIntegration> {
    let data = node.get("data")?;

    let mut candidates: Vec<&str> = Vec::new();
    if let Some(params) = data.get("params") {
        if let Some(value) = params.get("service").and_then(|v| v.as_str()) {
            candidates.push(value);
        }
        if let Some(value) = params.get("provider").and_then(|v| v.as_str()) {
            candidates.push(value);
        }
        // Legacy field retained for backward compatibility; check after service/provider
        if let Some(value) = params.get("platform").and_then(|v| v.as_str()) {
            candidates.push(value);
        }
    }

    for key in ["nodeType", "actionKey", "actionType", "label"] {
        if let Some(value) = data.get(key).and_then(|v| v.as_str()) {
            candidates.push(value);
        }
    }

    if let Some(kind) = node.get("type").and_then(|v| v.as_str()) {
        candidates.push(kind);
    }

    candidates
        .into_iter()
        .find_map(detect_messaging_integration)
}

fn trigger_type(node: &Value) -> Option<Cow<'_, str>> {
    node.get("data")
        .and_then(|data| data.get("triggerType"))
        .and_then(|value| value.as_str())
        .map(|value| Cow::Owned(value.to_lowercase()))
}

fn is_notion_trigger_type(trigger: &str) -> bool {
    matches!(
        trigger.trim(),
        "notion.new_database_row" | "notion.updated_database_row"
    )
}

pub fn assess_workflow_for_plan(graph: &Value) -> WorkflowAssessment {
    let nodes = graph
        .get("nodes")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let mut violations: Vec<PlanViolation> = Vec::new();

    let mut premium_nodes: Vec<(Option<String>, &'static str)> = Vec::new();
    let mut schedule_nodes: Vec<Option<String>> = Vec::new();
    let mut notion_trigger_nodes: Vec<Option<String>> = Vec::new();

    for node in &nodes {
        let node_type = node
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_lowercase();

        if node_type == "action" || node_type.starts_with("action") {
            if let Some(action) = action_type(node) {
                match action.as_ref() {
                    "sheets" => premium_nodes.push((node_label(node), "Google Sheets")),
                    "notion" => premium_nodes.push((node_label(node), "Notion")),
                    "messaging" | "teams" | "slack" | "googlechat" | "microsoftteams" => {
                        match messaging_integration(node) {
                            Some(MessagingIntegration::Slack) => {
                                premium_nodes.push((node_label(node), "Slack"));
                            }
                            Some(MessagingIntegration::Teams) => {
                                premium_nodes.push((node_label(node), "Microsoft Teams"));
                            }
                            None => {}
                        }
                    }
                    _ => {}
                }
            }
            continue;
        }

        if node_type == "trigger" {
            if let Some(trigger) = trigger_type(node) {
                if trigger == "schedule" {
                    schedule_nodes.push(node_label(node));
                } else if is_notion_trigger_type(trigger.as_ref()) {
                    notion_trigger_nodes.push(node_label(node));
                }
            }
            continue;
        }
    }

    if !premium_nodes.is_empty() {
        for (label, integration) in premium_nodes {
            violations.push(PlanViolation::new(
                "premium-integration",
                format!(
                    "{integration} actions are available on workspace plans and above. Upgrade in Settings → Plan to run this step."
                ),
                label,
            ));
        }
    }

    if !schedule_nodes.is_empty() {
        for label in schedule_nodes {
            violations.push(PlanViolation::new(
                "premium-trigger",
                "Scheduled triggers are available on workspace plans and above. Switch this trigger to Manual or Webhook to keep running on the solo plan.",
                label,
            ));
        }
    }

    if !notion_trigger_nodes.is_empty() {
        for label in notion_trigger_nodes {
            violations.push(PlanViolation::new(
                "premium-trigger",
                "Notion triggers are available on workspace plans and above. Upgrade in Settings ƒ+' Plan to keep polling Notion.",
                label,
            ));
        }
    }

    let node_count = nodes.len();
    if node_count > 10 {
        violations.push(PlanViolation::new(
            "node-limit",
            format!(
                "Solo plan workflows can include up to 10 nodes. Remove {} node{} or upgrade your plan.",
                node_count - 10,
                if node_count - 10 == 1 { "" } else { "s" }
            ),
            None,
        ));
    }

    WorkflowAssessment {
        node_count,
        violations,
    }
}

#[cfg(test)]
mod tests {
    use super::{assess_workflow_for_plan, NormalizedPlanTier};
    use serde_json::json;

    #[test]
    fn normalizes_plan_values() {
        assert!(NormalizedPlanTier::from_option(Some("Solo")).is_solo());
        assert!(NormalizedPlanTier::from_option(Some("free")).is_solo());
        assert_eq!(
            NormalizedPlanTier::from_option(Some("workspace")),
            NormalizedPlanTier::Workspace
        );
        assert_eq!(
            NormalizedPlanTier::from_option(Some("workspace:trial")),
            NormalizedPlanTier::Workspace
        );
        assert_eq!(
            NormalizedPlanTier::from_option(Some("workspace_plus")),
            NormalizedPlanTier::Workspace
        );
        assert_eq!(
            NormalizedPlanTier::from_option(Some("team")),
            NormalizedPlanTier::Workspace
        );
        assert_eq!(
            NormalizedPlanTier::from_option(Some("organization")),
            NormalizedPlanTier::Workspace
        );
        assert_eq!(
            NormalizedPlanTier::from_option(Some("organization-pro")),
            NormalizedPlanTier::Workspace
        );
        assert_eq!(
            NormalizedPlanTier::from_option(Some("org_premium")),
            NormalizedPlanTier::Workspace
        );
        assert_eq!(
            NormalizedPlanTier::from_option(Some("enterprise")),
            NormalizedPlanTier::Workspace
        );
    }

    #[test]
    fn detects_premium_integrations_and_schedule() {
        let graph = json!({
            "nodes": [
                {
                    "id": "1",
                    "type": "action",
                    "data": {
                        "label": "Sheets",
                        "actionType": "sheets"
                    }
                },
                {
                    "id": "2",
                    "type": "action",
                    "data": {
                        "label": "Notify",
                        "actionType": "messaging",
                        "params": {"service": "Slack"}
                    }
                },
                {
                    "id": "3",
                    "type": "trigger",
                    "data": {
                        "label": "Every hour",
                        "triggerType": "Schedule"
                    }
                }
            ]
        });

        let assessment = assess_workflow_for_plan(&graph);
        assert_eq!(assessment.node_count, 3);
        assert_eq!(assessment.violations.len(), 3);
    }

    #[test]
    fn enforces_node_count_limit() {
        let nodes: Vec<_> = (0..12)
            .map(|i| {
                json!({
                    "id": format!("node-{i}"),
                    "type": "action",
                    "data": {
                        "label": format!("Node {i}"),
                        "actionType": "email"
                    }
                })
            })
            .collect();
        let graph = json!({"nodes": nodes});
        let assessment = assess_workflow_for_plan(&graph);
        assert!(assessment.node_count > 10);
        assert!(assessment.violations.iter().any(|v| v.code == "node-limit"));
    }

    #[test]
    fn detects_messaging_integration_from_service_and_label() {
        let graph = json!({
            "nodes": [
                {
                    "id": "action-1",
                    "type": "action",
                    "data": {
                        "label": "Teams Alert",
                        "actionType": "messaging",
                        "params": {"service": "Microsoft Teams"}
                    }
                }
            ]
        });

        let assessment = assess_workflow_for_plan(&graph);
        assert_eq!(assessment.node_count, 1);
        assert_eq!(assessment.violations.len(), 1);
        assert_eq!(
            assessment.violations[0].message,
            "Microsoft Teams actions are available on workspace plans and above. Upgrade in Settings → Plan to run this step."
        );
    }
}
