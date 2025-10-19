use serde_json::Value;
use std::borrow::Cow;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NormalizedPlanTier {
    Solo,
    Workspace,
}

impl NormalizedPlanTier {
    pub fn from_str(raw: Option<&str>) -> Self {
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

fn messaging_platform(node: &Value) -> Option<String> {
    node.get("data")
        .and_then(|data| data.get("params"))
        .and_then(|params| params.get("platform"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn trigger_type(node: &Value) -> Option<Cow<'_, str>> {
    node.get("data")
        .and_then(|data| data.get("triggerType"))
        .and_then(|value| value.as_str())
        .map(|value| Cow::Owned(value.to_lowercase()))
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

    for node in &nodes {
        let node_type = node
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_lowercase();

        match node_type.as_str() {
            "action" => {
                if let Some(action) = action_type(node) {
                    match action.as_ref() {
                        "sheets" => premium_nodes.push((node_label(node), "Google Sheets")),
                        "messaging" => {
                            let platform =
                                messaging_platform(node).unwrap_or_else(|| "Messaging".to_string());
                            let platform_lower = platform.to_lowercase();
                            if platform_lower == "slack" || platform_lower == "teams" {
                                let pretty = if platform_lower == "slack" {
                                    "Slack"
                                } else {
                                    "Microsoft Teams"
                                };
                                premium_nodes.push((node_label(node), pretty));
                            }
                        }
                        _ => {}
                    }
                }
            }
            "trigger" => {
                if let Some(trigger) = trigger_type(node) {
                    if trigger == "schedule" {
                        schedule_nodes.push(node_label(node));
                    }
                }
            }
            _ => {}
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
        assert!(NormalizedPlanTier::from_str(Some("Solo")).is_solo());
        assert!(NormalizedPlanTier::from_str(Some("free")).is_solo());
        assert_eq!(
            NormalizedPlanTier::from_str(Some("workspace")),
            NormalizedPlanTier::Workspace
        );
        assert_eq!(
            NormalizedPlanTier::from_str(Some("workspace:trial")),
            NormalizedPlanTier::Workspace
        );
        assert_eq!(
            NormalizedPlanTier::from_str(Some("workspace_plus")),
            NormalizedPlanTier::Workspace
        );
        assert_eq!(
            NormalizedPlanTier::from_str(Some("team")),
            NormalizedPlanTier::Workspace
        );
        assert_eq!(
            NormalizedPlanTier::from_str(Some("organization")),
            NormalizedPlanTier::Workspace
        );
        assert_eq!(
            NormalizedPlanTier::from_str(Some("organization-pro")),
            NormalizedPlanTier::Workspace
        );
        assert_eq!(
            NormalizedPlanTier::from_str(Some("org_premium")),
            NormalizedPlanTier::Workspace
        );
        assert_eq!(
            NormalizedPlanTier::from_str(Some("enterprise")),
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
                        "params": {"platform": "Slack"}
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
}
