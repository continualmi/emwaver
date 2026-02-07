use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// Minimal representation of the UI node schema we stream in `ui.snapshot`.
/// Matches frontend/src/lib/remoteSessions.ts `RemoteUiNode`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,

    #[serde(default)]
    pub props: HashMap<String, Value>,

    #[serde(default)]
    pub handlers: HashMap<String, String>,

    #[serde(default)]
    pub children: Vec<UiNode>,
}

impl UiNode {
    pub fn find_node<'a>(&'a self, id: &str) -> Option<&'a UiNode> {
        if self.id == id {
            return Some(self);
        }
        for c in &self.children {
            if let Some(found) = c.find_node(id) {
                return Some(found);
            }
        }
        None
    }

    pub fn handler_token(&self, event_name: &str) -> Option<&str> {
        self.handlers.get(event_name).map(|s| s.as_str())
    }
}
