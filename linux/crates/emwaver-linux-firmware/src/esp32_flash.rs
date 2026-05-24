use crate::{FirmwareError, FirmwareImage, FirmwarePlan, FirmwareResult, FirmwareTarget};
use std::path::Path;

pub const BUNDLED_ESP32S3_BOOTLOADER_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../esp/build/bootloader/bootloader.bin"
);
pub const BUNDLED_ESP32S3_PARTITION_TABLE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../esp/build/partition_table/partition-table.bin"
);
pub const BUNDLED_ESP32S3_OTA_DATA_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../esp/build/ota_data_initial.bin"
);
pub const BUNDLED_ESP32S3_APP_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../esp/build/emwaveresp.bin"
);

pub const ESP32S3_BOOTLOADER_OFFSET: u32 = 0x0;
pub const ESP32S3_PARTITION_TABLE_OFFSET: u32 = 0x8000;
pub const ESP32S3_OTA_DATA_OFFSET: u32 = 0x10000;
pub const ESP32S3_APP_OFFSET: u32 = 0x20000;

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

pub fn plan_bundled_esp32s3_serial() -> FirmwareResult<FirmwarePlan> {
    let images = vec![
        (
            BUNDLED_ESP32S3_BOOTLOADER_PATH.to_string(),
            ESP32S3_BOOTLOADER_OFFSET,
        ),
        (
            BUNDLED_ESP32S3_PARTITION_TABLE_PATH.to_string(),
            ESP32S3_PARTITION_TABLE_OFFSET,
        ),
        (
            BUNDLED_ESP32S3_OTA_DATA_PATH.to_string(),
            ESP32S3_OTA_DATA_OFFSET,
        ),
        (BUNDLED_ESP32S3_APP_PATH.to_string(), ESP32S3_APP_OFFSET),
    ];
    for (path, _) in &images {
        if !Path::new(path).exists() {
            return Err(FirmwareError::MissingImage(path.clone()));
        }
    }
    Ok(plan_esp32_serial(images))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn esp32_plan_keeps_fixed_offsets() {
        let plan = plan_esp32_serial(vec![
            ("bootloader.bin".to_string(), ESP32S3_BOOTLOADER_OFFSET),
            (
                "partition-table.bin".to_string(),
                ESP32S3_PARTITION_TABLE_OFFSET,
            ),
            ("ota-data.bin".to_string(), ESP32S3_OTA_DATA_OFFSET),
            ("app.bin".to_string(), ESP32S3_APP_OFFSET),
        ]);
        assert_eq!(plan.images[0].offset, Some(0x0));
        assert_eq!(plan.images[1].offset, Some(0x8000));
        assert_eq!(plan.images[2].offset, Some(0x10000));
        assert_eq!(plan.images[3].offset, Some(0x20000));
        assert!(plan.requires_manual_bootloader);
    }

    #[test]
    fn esp32_bundled_plan_uses_committed_images() {
        let plan = plan_bundled_esp32s3_serial().unwrap();
        assert_eq!(plan.target, FirmwareTarget::Esp32Serial);
        assert_eq!(plan.images.len(), 4);
    }
}
