use crate::{FirmwareError, FirmwareImage, FirmwarePlan, FirmwareResult, FirmwareTarget};
use std::path::Path;

pub fn plan_stm32_dfu(image_path: impl AsRef<Path>) -> FirmwareResult<FirmwarePlan> {
    let path = image_path.as_ref();
    if !path.exists() {
        return Err(FirmwareError::MissingImage(path.display().to_string()));
    }
    Ok(FirmwarePlan {
        target: FirmwareTarget::Stm32Dfu,
        images: vec![FirmwareImage {
            target: FirmwareTarget::Stm32Dfu,
            path: path.display().to_string(),
            offset: None,
        }],
        requires_manual_bootloader: false,
    })
}

pub fn flash_stm32_dfu(_plan: &FirmwarePlan) -> FirmwareResult<()> {
    Err(FirmwareError::NotImplemented(
        "STM32 DFU flashing via emwaver-dfu",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stm32_plan_uses_committed_firmware_image() {
        let plan = plan_stm32_dfu(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../firmware/emwaver.bin"
        ))
        .unwrap();
        assert_eq!(plan.target, FirmwareTarget::Stm32Dfu);
        assert!(!plan.requires_manual_bootloader);
    }
}
