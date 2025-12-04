use crate::engine::actions::delay::DelayConfig;
use crate::engine::actions::formatter::FormatterConfig;

/// Typed workflow node variants used for internal validation.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq)]
pub enum WorkflowNodeKind {
    Delay(DelayConfig),
    Formatter(FormatterConfig),
}
