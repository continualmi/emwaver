/*
 * EMWaver CLI
 * Copyright (C) 2025 Luís Marnoto
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

use clap::{ArgGroup, Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(name = "emwaver", version, about = "EMWaver CLI")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Copy, Clone, Debug, ValueEnum)]
pub enum CodegenMode {
    /// Run STM32CubeMX code generation only when the `.ioc` appears newer than generated sources.
    Auto,
    /// Always run STM32CubeMX code generation before building.
    Always,
    /// Never run STM32CubeMX code generation (use existing generated files as-is).
    Never,
}

#[derive(Copy, Clone, Debug, ValueEnum)]
pub enum OtaTransport {
    /// OTA over BLE (works anywhere, slower).
    Ble,
    /// OTA over Wi‑Fi SoftAP (faster; requires connecting to EMWaver-OTA Wi‑Fi).
    Wifi,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Open an interactive shell to a nearby EMWaver device.
    Shell {
        /// Show raw hex payloads alongside ASCII output.
        #[arg(long)]
        verbose: bool,
    },
    /// Flash ESP32 firmware over BLE OTA.
    #[command(group(
        ArgGroup::new("source")
            .required(true)
            .args(["file", "stock"]),
    ))]
    Ota {
        /// Firmware image path (raw `.bin` bytes).
        file: Option<PathBuf>,
        /// Flash the bundled stock ESP32 firmware from this repo.
        #[arg(long)]
        stock: bool,
        /// BLE device name to scan for (defaults to EMWaver).
        #[arg(long, default_value = "EMWaver")]
        device_name: String,
        /// OTA transport to use (defaults to BLE).
        #[arg(long, value_enum, default_value_t = OtaTransport::Ble)]
        transport: OtaTransport,
        /// Chunk size in bytes (defaults to 200).
        #[arg(long, default_value_t = 200)]
        chunk_size: usize,
        /// Print extra status notifications.
        #[arg(long)]
        verbose: bool,
    },
    /// Build the firmware in the current project (auto-detects ESP-IDF or STM32 CubeMX/CubeIDE).
    Build {
        /// Firmware project path (defaults to auto-detect).
        #[arg(long)]
        project: Option<PathBuf>,
        /// STM32CubeMX code generation mode (STM32 projects only).
        #[arg(long, value_enum, default_value_t = CodegenMode::Auto)]
        codegen: CodegenMode,
        /// Print additional build/codegen details.
        #[arg(long)]
        verbose: bool,
    },
    /// Flash the firmware in the current project (ESP-IDF serial flash, or STM32 DFU over USB).
    Flash {
        /// Firmware project path (defaults to auto-detect).
        #[arg(long)]
        project: Option<PathBuf>,
        /// Serial port (passed as `-p <port>`). If omitted, ESP-IDF decides.
        #[arg(long)]
        port: Option<String>,
        /// STM32CubeMX code generation mode (STM32 projects only).
        #[arg(long, value_enum, default_value_t = CodegenMode::Auto)]
        codegen: CodegenMode,
        /// DFU alt setting to use for STM32 USB DFU flashing (overrides auto-selection).
        #[arg(long)]
        dfu_alt: Option<u8>,
        /// Print additional flash/build details (also enables DFU discovery logging on STM32).
        #[arg(long)]
        verbose: bool,
    },
    /// Monitor the ESP-IDF device in the current project (runs `idf.py monitor`).
    Monitor {
        /// ESP-IDF project path (defaults to auto-detect).
        #[arg(long)]
        project: Option<PathBuf>,
        /// Serial port (passed as `-p <port>`). If omitted, ESP-IDF decides.
        #[arg(long)]
        port: Option<String>,
    },
    /// Flash a firmware image to an STM32 DFU device (standalone).
    Dfu {
        /// Firmware file path (raw `.bin` or `.dfu` bytes).
        file: PathBuf,
        /// USB vendor ID (defaults to 0x0483).
        #[arg(long, value_parser = parse_u16_hex, default_value = "0x0483")]
        vid: u16,
        /// USB product ID (defaults to 0xDF11).
        #[arg(long, value_parser = parse_u16_hex, default_value = "0xDF11")]
        pid: u16,
        /// Target flash base address (defaults to 0x08000000).
        #[arg(long, value_parser = parse_u32_hex, default_value = "0x08000000")]
        address: u32,
        /// DFU alt setting to use (overrides auto-selection).
        #[arg(long)]
        alt: Option<u8>,
        /// Print DFU USB discovery details (interface/alt settings).
        #[arg(long)]
        verbose: bool,
    },
    /// Initialize a new firmware project.
    Init {
        /// Target platform template to use.
        #[arg(long, value_enum, default_value_t = Target::Esp32s3)]
        target: Target,
        /// Optional components to include (comma-separated).
        #[arg(long, value_enum, value_delimiter = ',')]
        components: Vec<Component>,
        /// STM32 starting firmware template to use (defaults to gpio).
        #[arg(long, value_enum)]
        stm32_firmware: Option<Stm32Firmware>,
        /// Destination directory (defaults to current directory).
        #[arg(long)]
        path: Option<PathBuf>,
    },
}

#[derive(Copy, Clone, Debug, ValueEnum)]
pub enum Target {
    Esp32s3,
    Stm32f042,
}

#[derive(Copy, Clone, Debug, ValueEnum)]
pub enum Stm32Firmware {
    Gpio,
    Ir,
    Ism,
    Rfid,
}

#[derive(Copy, Clone, Debug, ValueEnum, Eq, PartialEq, Hash)]
pub enum Component {
    Gpio,
    Sampler,
    Cc1101,
    Rfm69,
    Mfrc522,
}

fn parse_u16_hex(value: &str) -> Result<u16, String> {
    let raw = value.trim();
    if let Some(hex) = raw.strip_prefix("0x").or_else(|| raw.strip_prefix("0X")) {
        u16::from_str_radix(hex, 16).map_err(|e| e.to_string())
    } else {
        raw.parse::<u16>().map_err(|e| e.to_string())
    }
}

fn parse_u32_hex(value: &str) -> Result<u32, String> {
    let raw = value.trim();
    if let Some(hex) = raw.strip_prefix("0x").or_else(|| raw.strip_prefix("0X")) {
        u32::from_str_radix(hex, 16).map_err(|e| e.to_string())
    } else {
        raw.parse::<u32>().map_err(|e| e.to_string())
    }
}
