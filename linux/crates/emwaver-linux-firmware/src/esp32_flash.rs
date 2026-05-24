use crate::{FirmwareError, FirmwareImage, FirmwarePlan, FirmwareResult, FirmwareTarget};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub const ESP_HELPER_DIST_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../tools/emwaver-esp-helper/dist/emwaver-esp-helper/emwaver-esp-helper"
);
pub const ESP_HELPER_SOURCE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../tools/emwaver-esp-helper/emwaver_esp_helper.py"
);
pub const SYSTEM_ESP_HELPER_SOURCE_PATH: &str = "/usr/share/emwaver/tools/emwaver_esp_helper.py";

pub const REPO_ESP32S3_BOOTLOADER_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../esp/build/bootloader/bootloader.bin"
);
pub const REPO_ESP32S3_PARTITION_TABLE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../esp/build/partition_table/partition-table.bin"
);
pub const REPO_ESP32S3_OTA_DATA_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../esp/build/ota_data_initial.bin"
);
pub const REPO_ESP32S3_APP_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../esp/build/emwaveresp.bin"
);

pub const ESP32S3_BOOTLOADER_OFFSET: u32 = 0x0;
pub const ESP32S3_PARTITION_TABLE_OFFSET: u32 = 0x8000;
pub const ESP32S3_OTA_DATA_OFFSET: u32 = 0x10000;
pub const ESP32S3_APP_OFFSET: u32 = 0x20000;
pub const ESP32_FLASH_BAUD: u32 = 115200;

fn bundled_esp32s3_image_path(file_name: &str, repo_path: &str) -> PathBuf {
    if let Ok(dir) = std::env::var("EMWAVER_FIRMWARE_DIR") {
        let path = PathBuf::from(dir).join("esp32s3").join(file_name);
        if path.is_file() {
            return path;
        }
    }
    let system_path = PathBuf::from("/usr/share/emwaver/firmware/esp32s3").join(file_name);
    if system_path.is_file() {
        return system_path;
    }
    PathBuf::from(repo_path)
}

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
            bundled_esp32s3_image_path("bootloader.bin", REPO_ESP32S3_BOOTLOADER_PATH),
            ESP32S3_BOOTLOADER_OFFSET,
        ),
        (
            bundled_esp32s3_image_path("partition-table.bin", REPO_ESP32S3_PARTITION_TABLE_PATH),
            ESP32S3_PARTITION_TABLE_OFFSET,
        ),
        (
            bundled_esp32s3_image_path("ota_data_initial.bin", REPO_ESP32S3_OTA_DATA_PATH),
            ESP32S3_OTA_DATA_OFFSET,
        ),
        (
            bundled_esp32s3_image_path("emwaveresp.bin", REPO_ESP32S3_APP_PATH),
            ESP32S3_APP_OFFSET,
        ),
    ];
    let images = images
        .into_iter()
        .map(|(path, offset)| (path.display().to_string(), offset))
        .collect::<Vec<_>>();
    for (path, _) in &images {
        if !Path::new(path).exists() {
            return Err(FirmwareError::MissingImage(path.clone()));
        }
    }
    Ok(plan_esp32_serial(images))
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EspSerialPort {
    pub port: String,
    pub description: Option<String>,
    pub hardware_id: Option<String>,
}

pub fn list_esp_serial_ports() -> FirmwareResult<Vec<EspSerialPort>> {
    let output = run_esp_helper_capture(&["list-ports"])?;
    parse_port_list(&output)
}

pub fn resolve_esp_flash_port(preferred_port: Option<&str>) -> FirmwareResult<String> {
    if let Some(port) = preferred_port
        .map(str::trim)
        .filter(|port| !port.is_empty())
    {
        return Ok(port.to_string());
    }

    let ports = list_esp_serial_ports()?;
    let preferred = ports
        .iter()
        .filter(|port| is_preferred_esp_port(port))
        .collect::<Vec<_>>();
    if preferred.len() == 1 {
        return Ok(preferred[0].port.clone());
    }
    if ports.len() == 1 {
        return Ok(ports[0].port.clone());
    }
    if ports.is_empty() {
        return Err(FirmwareError::EspSerialUnavailable(
            "No ESP serial ports were reported by the helper. Connect the ESP flash-capable port in bootloader mode, then retry.".to_string(),
        ));
    }
    Err(FirmwareError::EspSerialUnavailable(
        "Could not choose a unique ESP serial port. Connect only the ESP flash port, or specify the port explicitly.".to_string(),
    ))
}

pub fn flash_esp32_serial_with_progress(
    plan: &FirmwarePlan,
    preferred_port: Option<&str>,
    progress: impl Fn(&str),
) -> FirmwareResult<()> {
    validate_esp32_serial_plan(plan)?;
    progress("ESP32 update selected.");
    progress("ESP flashing uses the serial helper, not STM32 DFU.");
    let port = resolve_esp_flash_port(preferred_port)?;
    progress(&format!("ESP flash port: {port}"));
    for image in &plan.images {
        progress(&format!(
            "ESP image: 0x{:05x}  {}",
            image.offset.unwrap_or_default(),
            image.path
        ));
    }

    let args = flash_helper_args(plan, &port)?;
    let output = run_esp_helper_streaming(&args, &progress)?;
    if output.status == 0 {
        progress("ESP firmware update complete. Reconnect the device in Run Mode.");
        Ok(())
    } else {
        Err(FirmwareError::HelperFailed(
            output
                .stderr
                .trim()
                .to_string()
                .if_empty_then(format!("ESP helper exited with status {}.", output.status)),
        ))
    }
}

pub fn flash_helper_args(plan: &FirmwarePlan, port: &str) -> FirmwareResult<Vec<String>> {
    validate_esp32_serial_layout(plan)?;
    let image_at = |offset| {
        plan.images
            .iter()
            .find(|image| image.offset == Some(offset))
            .map(|image| image.path.clone())
            .ok_or_else(|| {
                FirmwareError::InvalidPlan(format!("missing ESP image at offset 0x{offset:05x}"))
            })
    };
    Ok(vec![
        "flash".to_string(),
        "--port".to_string(),
        port.to_string(),
        "--baud".to_string(),
        ESP32_FLASH_BAUD.to_string(),
        "--before".to_string(),
        "no_reset".to_string(),
        "--after".to_string(),
        "hard_reset".to_string(),
        "--no-stub".to_string(),
        "--bootloader".to_string(),
        image_at(ESP32S3_BOOTLOADER_OFFSET)?,
        "--partition-table".to_string(),
        image_at(ESP32S3_PARTITION_TABLE_OFFSET)?,
        "--ota-data".to_string(),
        image_at(ESP32S3_OTA_DATA_OFFSET)?,
        "--app".to_string(),
        image_at(ESP32S3_APP_OFFSET)?,
    ])
}

fn validate_esp32_serial_plan(plan: &FirmwarePlan) -> FirmwareResult<()> {
    validate_esp32_serial_layout(plan)?;
    for image in &plan.images {
        if !Path::new(&image.path).exists() {
            return Err(FirmwareError::MissingImage(image.path.clone()));
        }
    }
    Ok(())
}

fn validate_esp32_serial_layout(plan: &FirmwarePlan) -> FirmwareResult<()> {
    if plan.target != FirmwareTarget::Esp32Serial {
        return Err(FirmwareError::InvalidPlan(
            "ESP32 serial flash requires an ESP32 serial plan".to_string(),
        ));
    }
    let required = [
        ESP32S3_BOOTLOADER_OFFSET,
        ESP32S3_PARTITION_TABLE_OFFSET,
        ESP32S3_OTA_DATA_OFFSET,
        ESP32S3_APP_OFFSET,
    ];
    for offset in required {
        if !plan.images.iter().any(|image| image.offset == Some(offset)) {
            return Err(FirmwareError::InvalidPlan(format!(
                "missing ESP image at offset 0x{offset:05x}"
            )));
        }
    }
    Ok(())
}

fn parse_port_list(output: &str) -> FirmwareResult<Vec<EspSerialPort>> {
    let mut ports = Vec::new();
    for line in output.lines() {
        let mut port = None;
        let mut description = None;
        let mut hardware_id = None;
        for field in line.split('\t') {
            if let Some(value) = field.strip_prefix("PORT=") {
                port = Some(value.trim().to_string());
            } else if let Some(value) = field.strip_prefix("DESC=") {
                let value = value.trim();
                if !value.is_empty() {
                    description = Some(value.to_string());
                }
            } else if let Some(value) = field.strip_prefix("HWID=") {
                let value = value.trim();
                if !value.is_empty() {
                    hardware_id = Some(value.to_string());
                }
            }
        }
        if let Some(port) = port.filter(|port| !port.is_empty()) {
            ports.push(EspSerialPort {
                port,
                description,
                hardware_id,
            });
        }
    }
    Ok(ports)
}

fn is_preferred_esp_port(port: &EspSerialPort) -> bool {
    let text = format!(
        "{} {} {}",
        port.port.to_lowercase(),
        port.description
            .as_deref()
            .unwrap_or_default()
            .to_lowercase(),
        port.hardware_id
            .as_deref()
            .unwrap_or_default()
            .to_lowercase()
    );
    text.contains("ttyacm")
        || text.contains("ttyusb")
        || text.contains("usbmodem")
        || text.contains("usbserial")
        || text.contains("esp32")
        || text.contains("espressif")
        || text.contains("cp210")
        || text.contains("ch910")
        || text.contains("silicon labs")
        || text.contains("wch")
}

struct HelperCommand {
    program: String,
    leading_args: Vec<String>,
}

struct HelperOutput {
    status: i32,
    stderr: String,
}

fn resolve_helper_command() -> FirmwareResult<HelperCommand> {
    if let Ok(path) = std::env::var("EMWAVER_ESP_HELPER_PATH") {
        if Path::new(&path).is_file() {
            return Ok(HelperCommand {
                program: path,
                leading_args: Vec::new(),
            });
        }
    }
    if Path::new(ESP_HELPER_DIST_PATH).is_file() {
        return Ok(HelperCommand {
            program: ESP_HELPER_DIST_PATH.to_string(),
            leading_args: Vec::new(),
        });
    }

    let source_candidates = [
        std::env::var("EMWAVER_ESP_HELPER_SOURCE").ok(),
        Some(SYSTEM_ESP_HELPER_SOURCE_PATH.to_string()),
        Some(ESP_HELPER_SOURCE_PATH.to_string()),
    ];
    for candidate in source_candidates.into_iter().flatten() {
        if Path::new(&candidate).is_file() {
            return Ok(HelperCommand {
                program: "python3".to_string(),
                leading_args: vec![candidate],
            });
        }
    }

    Err(FirmwareError::MissingHelper(format!(
        "Expected frozen helper at {ESP_HELPER_DIST_PATH}, source helper at {ESP_HELPER_SOURCE_PATH}, or packaged helper at {SYSTEM_ESP_HELPER_SOURCE_PATH}."
    )))
}

fn run_esp_helper_capture(args: &[&str]) -> FirmwareResult<String> {
    let helper = resolve_helper_command()?;
    let output = Command::new(&helper.program)
        .args(&helper.leading_args)
        .args(args)
        .output()
        .map_err(|err| FirmwareError::HelperFailed(err.to_string()))?;
    if !output.status.success() {
        return Err(FirmwareError::HelperFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn run_esp_helper_streaming(
    args: &[String],
    progress: &impl Fn(&str),
) -> FirmwareResult<HelperOutput> {
    let helper = resolve_helper_command()?;
    let output = Command::new(&helper.program)
        .args(&helper.leading_args)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| FirmwareError::HelperFailed(err.to_string()))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    for line in stdout.lines().chain(stderr.lines()) {
        let line = line.trim();
        if !line.is_empty() {
            progress(line);
        }
    }
    Ok(HelperOutput {
        status: output.status.code().unwrap_or(1),
        stderr,
    })
}

trait EmptyStringFallback {
    fn if_empty_then(self, fallback: String) -> String;
}

impl EmptyStringFallback for String {
    fn if_empty_then(self, fallback: String) -> String {
        if self.is_empty() {
            fallback
        } else {
            self
        }
    }
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
    fn esp32_bundled_plan_uses_committed_images_when_available() {
        match plan_bundled_esp32s3_serial() {
            Ok(plan) => {
                assert_eq!(plan.target, FirmwareTarget::Esp32Serial);
                assert_eq!(plan.images.len(), 4);
            }
            Err(FirmwareError::MissingImage(path)) => {
                // ESP-IDF build outputs are generated and may be absent in clean CI clones.
                assert!(
                    path.ends_with("bootloader.bin")
                        || path.ends_with("partition-table.bin")
                        || path.ends_with("ota_data_initial.bin")
                        || path.ends_with("emwaveresp.bin")
                );
            }
            Err(err) => panic!("unexpected ESP bundled-plan error: {err}"),
        }
    }

    #[test]
    fn parses_helper_port_rows() {
        let ports = parse_port_list(
            "PORT=/dev/ttyACM0\tDESC=USB JTAG/serial debug unit\tHWID=USB VID:PID=303A:1001\n\
             PORT=/dev/ttyS0\tDESC=Built-in serial\tHWID=\n",
        )
        .unwrap();
        assert_eq!(ports.len(), 2);
        assert_eq!(ports[0].port, "/dev/ttyACM0");
        assert!(is_preferred_esp_port(&ports[0]));
        assert!(!is_preferred_esp_port(&ports[1]));
    }

    #[test]
    fn flash_helper_args_match_macos_helper_contract() {
        let plan = plan_esp32_serial(vec![
            ("bootloader.bin".to_string(), ESP32S3_BOOTLOADER_OFFSET),
            (
                "partition-table.bin".to_string(),
                ESP32S3_PARTITION_TABLE_OFFSET,
            ),
            ("ota-data.bin".to_string(), ESP32S3_OTA_DATA_OFFSET),
            ("app.bin".to_string(), ESP32S3_APP_OFFSET),
        ]);
        let args = flash_helper_args(&plan, "/dev/ttyACM0").unwrap();
        assert_eq!(args[0], "flash");
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--port", "/dev/ttyACM0"]));
        assert!(args.windows(2).any(|pair| pair == ["--before", "no_reset"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--after", "hard_reset"]));
        assert!(args.iter().any(|arg| arg == "--no-stub"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--bootloader", "bootloader.bin"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--partition-table", "partition-table.bin"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--ota-data", "ota-data.bin"]));
        assert!(args.windows(2).any(|pair| pair == ["--app", "app.bin"]));
    }
}
