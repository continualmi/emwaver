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

use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(name = "emwaver", version, about = "EMWaver CLI (Desktop-backed)")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, ValueEnum)]
pub enum CodegenMode {
    /// Run STM32CubeMX code generation only when the `.ioc` appears newer than generated sources.
    Auto,
    /// Always run STM32CubeMX code generation before building.
    Always,
    /// Never run STM32CubeMX code generation (use existing generated files as-is).
    Never,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Open an interactive shell via the Desktop app.
    Shell {
        /// Show raw hex payloads alongside ASCII output.
        #[arg(long)]
        verbose: bool,
    },
    /// Send an ASCII command to the connected device (Desktop owns the USB connection).
    Cmd {
        /// Command text to send.
        #[arg(required = true, trailing_var_arg = true, allow_hyphen_values = true)]
        text: Vec<String>,
        /// Command response timeout in milliseconds.
        #[arg(long, default_value_t = 1500)]
        timeout_ms: u64,
        /// Number of 64-byte packets to read back.
        #[arg(long, default_value_t = 1)]
        packets: u32,
        /// Print both ASCII (trimmed) and raw hex bytes.
        #[arg(long, conflicts_with = "json")]
        verbose: bool,
        /// Output as JSON (includes base64 bytes).
        #[arg(long)]
        json: bool,
    },
    /// USB transport utilities (Desktop-owned).
    #[command(name = "usb", alias = "midi")]
    Usb {
        #[command(subcommand)]
        command: MidiCommand,
    },
    /// Run or control wavelets via the Desktop app.
    Wavelet {
        #[command(subcommand)]
        command: WaveletCommand,
    },
    /// Build the firmware in the current project (STM32 CubeMX/CubeIDE).
    #[cfg(feature = "firmware-tools")]
    Build {
        /// Firmware project path (defaults to auto-detect).
        #[arg(long)]
        project: Option<PathBuf>,
        /// STM32CubeMX code generation mode (STM32 projects only).
        #[arg(long, value_enum, default_value_t = CodegenMode::Never)]
        codegen: CodegenMode,
        /// Print additional build/codegen details.
        #[arg(long)]
        verbose: bool,
    },
    /// Flash the firmware in the current project (STM32 DFU over USB).
    #[cfg(feature = "firmware-tools")]
    Flash {
        /// Firmware project path (defaults to auto-detect).
        #[arg(long)]
        project: Option<PathBuf>,
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
    /// Flash a firmware image to an STM32 DFU device (standalone).
    #[cfg(feature = "firmware-tools")]
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
        #[arg(long, value_enum, default_value_t = Target::Stm32f042)]
        target: Target,
        /// Optional components to include (comma-separated).
        #[arg(long, value_enum, value_delimiter = ',')]
        components: Vec<Component>,
        /// Destination directory (defaults to current directory).
        #[arg(long)]
        path: Option<PathBuf>,
    },
    /// Repo-local vibe hacking helpers (docs, skills, templates).
    Vibe {
        #[command(subcommand)]
        command: VibeCommand,
    },
}

#[derive(Debug, Subcommand)]
pub enum MidiCommand {
    /// List available USB devices.
    List {
        /// Output as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Connect to a USB device.
    Connect {
        /// USB device name to connect to (defaults to the first matching device).
        #[arg(long)]
        port: Option<String>,
        /// Output as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Disconnect the active USB connection (if any).
    Disconnect,
    /// Print current USB connection status.
    Status {
        /// Output as JSON.
        #[arg(long)]
        json: bool,
    },
}

#[derive(Debug, Subcommand)]
pub enum WaveletCommand {
    /// Run a wavelet script file (Desktop executes and renders UI).
    Run {
        /// Path to the wavelet script file.
        path: PathBuf,
        /// Optional bootstrap script to prepend (defaults to empty).
        #[arg(long)]
        bootstrap: Option<PathBuf>,
    },
    /// Stop the currently running wavelet.
    Stop,
}

#[derive(Debug, Subcommand)]
pub enum VibeCommand {
    /// Initialize (or update) an `AGENTS.md` Vibe Hacking guide for working with EMWaver.
    Init {
        /// Destination directory (defaults to current directory).
        #[arg(long)]
        path: Option<PathBuf>,
        /// Overwrite existing files when they differ.
        #[arg(long)]
        force: bool,
        /// Do not modify or create `AGENTS.md`.
        #[arg(long)]
        no_agents: bool,
    },
}

#[derive(Copy, Clone, Debug, ValueEnum)]
pub enum Target {
    Stm32f042,
}

#[derive(Copy, Clone, Debug, ValueEnum, Eq, PartialEq, Hash)]
pub enum Component {
    Gpio,
    Sampler,
    Cc1101,
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
