use serde::{Deserialize, Serialize};

use crate::utils::plan_limits::NormalizedPlanTier;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanTier {
    Solo,
    Workspace,
}

impl PlanTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            PlanTier::Solo => "solo",
            PlanTier::Workspace => "workspace",
        }
    }
}

impl From<NormalizedPlanTier> for PlanTier {
    fn from(value: NormalizedPlanTier) -> Self {
        match value {
            NormalizedPlanTier::Solo => PlanTier::Solo,
            NormalizedPlanTier::Workspace => PlanTier::Workspace,
        }
    }
}
