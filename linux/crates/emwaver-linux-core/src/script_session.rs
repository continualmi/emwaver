use crate::device_registry::DeviceRecord;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum SessionState {
    Running,
    Stopping,
    Completed,
    Failed(String),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ScriptRunRequest {
    pub script_name: String,
    pub source: String,
    pub device: DeviceRecord,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ScriptSession {
    pub id: Uuid,
    pub script_name: String,
    pub device_key: String,
    pub hardware_uid: Option<String>,
    pub state: SessionState,
    pub log: Vec<String>,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum SessionError {
    #[error("device is already running a script")]
    BusyDevice,
    #[error("unknown session")]
    UnknownSession,
}

#[derive(Default, Debug)]
pub struct ScriptSessionManager {
    sessions: BTreeMap<Uuid, ScriptSession>,
}

impl ScriptSessionManager {
    pub fn start(&mut self, request: ScriptRunRequest) -> Result<ScriptSession, SessionError> {
        if let Some(uid) = request.device.hardware_uid.as_ref() {
            let busy = self.sessions.values().any(|session| {
                session.hardware_uid.as_ref() == Some(uid)
                    && matches!(
                        session.state,
                        SessionState::Running | SessionState::Stopping
                    )
            });
            if busy {
                return Err(SessionError::BusyDevice);
            }
        }

        let id = Uuid::new_v4();
        let session = ScriptSession {
            id,
            script_name: request.script_name,
            device_key: request.device.identity_key(),
            hardware_uid: request.device.hardware_uid,
            state: SessionState::Running,
            log: vec!["session started".to_string()],
        };
        self.sessions.insert(id, session.clone());
        Ok(session)
    }

    pub fn append_log(&mut self, id: Uuid, line: impl Into<String>) -> Result<(), SessionError> {
        let session = self
            .sessions
            .get_mut(&id)
            .ok_or(SessionError::UnknownSession)?;
        session.log.push(line.into());
        Ok(())
    }

    pub fn stop(&mut self, id: Uuid) -> Result<ScriptSession, SessionError> {
        let session = self
            .sessions
            .get_mut(&id)
            .ok_or(SessionError::UnknownSession)?;
        session.state = SessionState::Completed;
        session.log.push("session stopped".to_string());
        Ok(session.clone())
    }

    pub fn list(&self) -> Vec<ScriptSession> {
        self.sessions.values().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device_registry::TransportKind;

    fn sim_request() -> ScriptRunRequest {
        ScriptRunRequest {
            script_name: "blink.emw".to_string(),
            source: "gpio.write(13, 1);".to_string(),
            device: DeviceRecord::new(
                "sim",
                "Simulator",
                TransportKind::Simulator,
                Some("SIM-00000001".to_string()),
            ),
        }
    }

    #[test]
    fn rejects_concurrent_run_for_same_hardware_uid() {
        let mut manager = ScriptSessionManager::default();
        manager.start(sim_request()).unwrap();

        assert_eq!(
            manager.start(sim_request()).unwrap_err(),
            SessionError::BusyDevice
        );
    }

    #[test]
    fn releases_device_after_stop() {
        let mut manager = ScriptSessionManager::default();
        let session = manager.start(sim_request()).unwrap();
        manager.stop(session.id).unwrap();

        assert!(manager.start(sim_request()).is_ok());
    }
}
