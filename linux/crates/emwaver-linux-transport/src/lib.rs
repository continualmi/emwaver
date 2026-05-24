pub mod ble;
pub mod simulator;
pub mod usb;
pub mod wifi;

use async_trait::async_trait;
use emwaver_linux_core::TransportKind;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TransportId(pub String);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct EmwFrame {
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TransportDescriptor {
    pub id: TransportId,
    pub kind: TransportKind,
    pub display_name: String,
    pub hardware_uid: Option<String>,
    pub firmware_version: Option<String>,
}

#[derive(Debug, Error)]
pub enum TransportError {
    #[error("transport is not implemented yet: {0}")]
    NotImplemented(&'static str),
    #[error("transport is not connected")]
    NotConnected,
    #[error("fixture error: {0}")]
    Fixture(String),
}

pub type TransportResult<T> = Result<T, TransportError>;

#[async_trait]
pub trait EmwaverTransport: Send + Sync {
    fn descriptor(&self) -> TransportDescriptor;
    async fn connect(&mut self) -> TransportResult<()>;
    async fn send_frame(&mut self, frame: EmwFrame) -> TransportResult<()>;
    async fn next_frame(&mut self) -> TransportResult<EmwFrame>;
    async fn close(&mut self) -> TransportResult<()>;
}
