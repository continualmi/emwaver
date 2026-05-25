pub mod esp32_flash;
pub mod stm32_dfu;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum FirmwareTarget {
    Stm32Dfu,
    Esp32Serial,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FirmwareImage {
    pub target: FirmwareTarget,
    pub path: String,
    pub offset: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FirmwarePlan {
    pub target: FirmwareTarget,
    pub images: Vec<FirmwareImage>,
    pub requires_manual_bootloader: bool,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum FirmwareError {
    #[error("missing firmware image: {0}")]
    MissingImage(String),
    #[error("invalid firmware plan: {0}")]
    InvalidPlan(String),
    #[error("dfu device unavailable: {0}")]
    DfuUnavailable(String),
    #[error("dfu flash failed: {0}")]
    DfuFlash(String),
    #[error("missing firmware helper: {0}")]
    MissingHelper(String),
    #[error("firmware helper failed: {0}")]
    HelperFailed(String),
    #[error("esp serial port unavailable: {0}")]
    EspSerialUnavailable(String),
    #[error("flashing backend is not implemented yet: {0}")]
    NotImplemented(&'static str),
}

pub type FirmwareResult<T> = Result<T, FirmwareError>;
