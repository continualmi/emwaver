use anyhow::Result;
use serde_json::Value as JsonValue;
use std::sync::{Arc, Mutex};

use crate::device::Device;
use crate::ui_tree::UiNode;

/// Minimal Engine stub for the secure-connection daemon milestone.
///
/// The full product design expects a JS runtime + UI tree generation (same as GUI apps).
/// For now, we focus on: USB MIDI connectivity + backend heartbeat/ws attach.
pub struct Engine {
    _device: Arc<Device>,

    pub latest_tree: Arc<Mutex<Option<UiNode>>>,
    pub latest_metadata: Arc<Mutex<JsonValue>>,
}

impl Engine {
    pub fn new(_bootstrap_source: &str, device: Arc<Device>) -> Result<Self> {
        Ok(Self {
            _device: device,
            latest_tree: Arc::new(Mutex::new(None)),
            latest_metadata: Arc::new(Mutex::new(JsonValue::Object(Default::default()))),
        })
    }

    pub fn run_script(&self, _source: &str) -> Result<()> {
        // TODO: re-enable JS runtime + script bootstrap.
        anyhow::bail!("script runtime not enabled in daemon yet")
    }

    pub fn dispatch_ui_event(&self, _token: &str, _args: Vec<JsonValue>) -> Result<()> {
        // TODO: re-enable when JS runtime is restored.
        Ok(())
    }
}
