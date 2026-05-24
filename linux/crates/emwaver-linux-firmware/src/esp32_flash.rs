use crate::{FirmwareImage, FirmwarePlan, FirmwareTarget};

pub fn plan_esp32_serial(images: Vec<(String, u32)>) -> FirmwarePlan {
    FirmwarePlan {
        target: FirmwareTarget::Esp32Serial,
        images: images
            .into_iter()
            .map(|(path, offset)| FirmwareImage {
                target: FirmwareTarget::Esp32Serial,
                path,
                offset: Some(offset),
            })
            .collect(),
        requires_manual_bootloader: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn esp32_plan_keeps_fixed_offsets() {
        let plan = plan_esp32_serial(vec![
            ("bootloader.bin".to_string(), 0x1000),
            ("app.bin".to_string(), 0x10000),
        ]);
        assert_eq!(plan.images[0].offset, Some(0x1000));
        assert!(plan.requires_manual_bootloader);
    }
}
