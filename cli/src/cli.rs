/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
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
    /// List nearby EMWaver devices (BLE).
    List {
        /// Scan timeout in milliseconds.
        #[arg(long, default_value_t = 6000)]
        timeout_ms: u64,
        /// Show all BLE devices (disables EMWaver filtering).
        #[arg(long)]
        all: bool,
        /// Device name to filter for (defaults to EMWaver).
        #[arg(long, default_value = "EMWaver")]
        name: String,
        /// Output as JSON (one array on stdout).
        #[arg(long)]
        json: bool,
    },
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
    /// Background daemon that keeps device connections alive (local socket IPC).
    Daemon {
        #[command(subcommand)]
        command: DaemonCommand,
    },
    /// Manage the daemon-owned RX buffer (load/save/transmit `.raw` captures).
    Buffer {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
        #[command(subcommand)]
        command: BufferCommand,
    },
    /// Convenience wrapper around sampler ASCII commands (runs via daemon connection).
    Sampler {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
        #[command(subcommand)]
        command: SamplerCommand,
    },
    /// Convenience wrapper around retransmit commands (plays RX buffer on a GPIO pin).
    Retransmit {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
        #[command(subcommand)]
        command: RetransmitCommand,
    },
}

#[derive(Debug, Subcommand)]
pub enum DaemonCommand {
    /// Run the daemon in the foreground.
    Run {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
    },
    /// Start the daemon in the background.
    Start {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
    },
    /// Stop the running daemon.
    Stop {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
    },
    /// Check whether the daemon is running.
    Status {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
        /// Output as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Ask the daemon to scan for nearby devices.
    List {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
        /// Scan timeout in milliseconds.
        #[arg(long, default_value_t = 6000)]
        timeout_ms: u64,
        /// Show all BLE devices (disables EMWaver filtering).
        #[arg(long)]
        all: bool,
        /// Device name to filter for (defaults to EMWaver).
        #[arg(long, default_value = "EMWaver")]
        name: String,
        /// Output as JSON (one array on stdout).
        #[arg(long)]
        json: bool,
    },
    /// Ask the daemon to connect to a device.
    Connect {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
        /// BLE address to connect to (if omitted, connects to the first matching device).
        #[arg(long)]
        address: Option<String>,
        /// Device name to filter for when scanning (defaults to EMWaver).
        #[arg(long, default_value = "EMWaver")]
        name: String,
    },
    /// Ask the daemon to disconnect from the active device.
    Disconnect {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
    },
    /// Ask the daemon for its currently connected device(s).
    Connected {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
        /// Output as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Send an ASCII command to the connected device (e.g. `version`).
    Cmd {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
        /// Command text to send.
        #[arg(required = true, trailing_var_arg = true, allow_hyphen_values = true)]
        text: Vec<String>,
        /// Command response timeout in milliseconds.
        #[arg(long, default_value_t = 1500)]
        timeout_ms: u64,
        /// Number of 64-byte packets to read back.
        #[arg(long, default_value_t = 1)]
        packets: u32,
        /// Output as JSON (includes base64 bytes).
        #[arg(long)]
        json: bool,
    },
}

#[derive(Debug, Subcommand)]
pub enum BufferCommand {
    /// Clear the daemon RX buffer.
    Clear,
    /// Print RX buffer length in bytes.
    Len {
        /// Output as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Load RX buffer bytes from a `.raw` file (replaces current buffer contents).
    Load {
        /// Path to a `.raw` file.
        path: PathBuf,
        /// Only load into the daemon RX buffer (do not upload to the device).
        #[arg(long)]
        no_upload: bool,
    },
    /// Save RX buffer bytes to a `.raw` file.
    Save {
        /// Destination path.
        path: PathBuf,
    },
    /// Transmit the current RX buffer (sampler upload) using daemon pacing/flow control.
    Transmit,
}

#[derive(Debug, Subcommand)]
pub enum SamplerCommand {
    /// Start sampling from a GPIO pin into the daemon RX buffer.
    Start {
        /// GPIO pin to sample.
        #[arg(long)]
        pin: i32,
        /// Automatically stop sampling after this duration (milliseconds).
        #[arg(long)]
        duration_ms: Option<u64>,
    },
    /// Stop sampling (fire-and-forget).
    Stop,
}

#[derive(Debug, Subcommand)]
pub enum RetransmitCommand {
    /// Start retransmitting from the RX buffer on a GPIO pin.
    Start {
        /// GPIO pin to drive for retransmission.
        #[arg(long)]
        pin: i32,
        /// Enable PWM carrier (useful for IR).
        #[arg(long)]
        pwm: bool,
        /// PWM carrier frequency (Hz).
        #[arg(long)]
        freq: Option<i32>,
        /// PWM duty cycle (percent, 0-100).
        #[arg(long)]
        duty: Option<i32>,
        /// Do not upload the daemon RX buffer before starting retransmit.
        #[arg(long)]
        no_upload: bool,
        /// Automatically stop retransmitting after this duration (milliseconds).
        #[arg(long)]
        duration_ms: Option<u64>,
    },
    /// Stop retransmitting (fire-and-forget).
    Stop,
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
    /// Enables BLE transport (required for EMWaver app interaction).
    Ble,
    /// Enables the ASCII command registry (depends on BLE).
    CommandRegistry,
    /// Enables OTA services (BLE + Wi‑Fi) in the ESP32 template.
    Ota,
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
