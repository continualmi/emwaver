use crate::{
    DeviceRecord, DeviceRegistry, ScriptRunRequest, ScriptSession, ScriptSessionManager,
    SessionError,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum AppStatus {
    Idle,
    Running,
    ToolUnavailable,
    FirmwareUpdating,
}

#[derive(Debug)]
pub struct AppModel {
    status: AppStatus,
    registry: DeviceRegistry,
    sessions: ScriptSessionManager,
    selected_device_key: Option<String>,
}

impl Default for AppModel {
    fn default() -> Self {
        Self {
            status: AppStatus::Idle,
            registry: DeviceRegistry::default(),
            sessions: ScriptSessionManager::default(),
            selected_device_key: None,
        }
    }
}

impl AppModel {
    pub fn status(&self) -> &AppStatus {
        &self.status
    }

    pub fn upsert_device(&mut self, device: DeviceRecord) -> String {
        let key = self.registry.upsert(device);
        if self.selected_device_key.is_none() {
            self.selected_device_key = Some(key.clone());
        }
        key
    }

    pub fn devices(&self) -> Vec<DeviceRecord> {
        self.registry.list()
    }

    pub fn select_device(&mut self, key: impl Into<String>) {
        self.selected_device_key = Some(key.into());
    }

    pub fn selected_device(&self) -> Option<DeviceRecord> {
        self.selected_device_key
            .as_ref()
            .and_then(|key| self.registry.get(key))
            .cloned()
    }

    pub fn run_script(
        &mut self,
        script_name: impl Into<String>,
        source: impl Into<String>,
    ) -> Result<ScriptSession, SessionError> {
        let Some(device) = self.selected_device() else {
            return Err(SessionError::UnknownSession);
        };
        let session = self.sessions.start(ScriptRunRequest {
            script_name: script_name.into(),
            source: source.into(),
            device,
        })?;
        if let Some(uid) = session.hardware_uid.as_ref() {
            self.registry.set_busy_by_uid(uid, true);
        }
        self.status = AppStatus::Running;
        Ok(session)
    }

    pub fn stop_script(&mut self, session: uuid::Uuid) -> Result<ScriptSession, SessionError> {
        let stopped = self.sessions.stop(session)?;
        if let Some(uid) = stopped.hardware_uid.as_ref() {
            self.registry.set_busy_by_uid(uid, false);
        }
        self.status = AppStatus::Idle;
        Ok(stopped)
    }
}
