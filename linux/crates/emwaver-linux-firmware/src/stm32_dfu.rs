use crate::{FirmwareError, FirmwareImage, FirmwarePlan, FirmwareResult, FirmwareTarget};
use emwaver_dfu::{DfuDevice, DfuOpenOptions, DEFAULT_USB_PRODUCT_ID, DEFAULT_USB_VENDOR_ID};
use std::fs;
use std::path::Path;

pub const BUNDLED_STM32_FIRMWARE_PATH: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/../../../firmware/emwaver.bin");

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

pub fn plan_bundled_stm32_dfu() -> FirmwareResult<FirmwarePlan> {
    plan_stm32_dfu(BUNDLED_STM32_FIRMWARE_PATH)
}

pub fn is_stm32_dfu_connected() -> FirmwareResult<bool> {
    match DfuDevice::open_with_options(
        DEFAULT_USB_VENDOR_ID,
        DEFAULT_USB_PRODUCT_ID,
        DfuOpenOptions {
            alt_setting: None,
            verbose: false,
        },
    ) {
        Ok((_device, _discovery)) => Ok(true),
        Err(err) if err.contains("No DFU device found") => Ok(false),
        Err(err) => Err(FirmwareError::DfuUnavailable(err)),
    }
}

pub fn flash_stm32_dfu(plan: &FirmwarePlan) -> FirmwareResult<()> {
    flash_stm32_dfu_with_progress(plan, |_| {})
}

pub fn flash_stm32_dfu_with_progress(
    plan: &FirmwarePlan,
    mut progress: impl FnMut(&str),
) -> FirmwareResult<()> {
    if plan.target != FirmwareTarget::Stm32Dfu {
        return Err(FirmwareError::InvalidPlan(format!(
            "expected STM32 DFU plan, got {:?}",
            plan.target
        )));
    }
    let image = plan
        .images
        .iter()
        .find(|image| image.target == FirmwareTarget::Stm32Dfu)
        .ok_or_else(|| FirmwareError::InvalidPlan("missing STM32 image".to_string()))?;
    if image.offset.is_some() {
        return Err(FirmwareError::InvalidPlan(
            "STM32 DFU image must not specify an offset".to_string(),
        ));
    }

    let bytes =
        fs::read(&image.path).map_err(|_| FirmwareError::MissingImage(image.path.clone()))?;
    progress(&format!("Using {} ({} bytes)", image.path, bytes.len()));
    progress("Opening device in Update Mode...");

    let (mut device, _discovery) = DfuDevice::open_with_options(
        DEFAULT_USB_VENDOR_ID,
        DEFAULT_USB_PRODUCT_ID,
        DfuOpenOptions {
            alt_setting: None,
            verbose: false,
        },
    )
    .map_err(FirmwareError::DfuUnavailable)?;

    device
        .flash(&bytes, 0x0800_0000, true, |line| progress(&line))
        .map_err(FirmwareError::DfuFlash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stm32_plan_uses_committed_firmware_image() {
        let plan = plan_bundled_stm32_dfu().unwrap();
        assert_eq!(plan.target, FirmwareTarget::Stm32Dfu);
        assert!(!plan.requires_manual_bootloader);
    }

    #[test]
    fn stm32_plan_rejects_missing_image() {
        let err = plan_stm32_dfu("/tmp/does-not-exist-emwaver.bin").unwrap_err();
        assert_eq!(
            err,
            FirmwareError::MissingImage("/tmp/does-not-exist-emwaver.bin".to_string())
        );
    }

    #[test]
    fn stm32_flash_rejects_wrong_target_plan() {
        let plan = FirmwarePlan {
            target: FirmwareTarget::Esp32Serial,
            images: Vec::new(),
            requires_manual_bootloader: true,
        };
        assert!(matches!(
            flash_stm32_dfu(&plan),
            Err(FirmwareError::InvalidPlan(_))
        ));
    }
}
