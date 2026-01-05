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

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Open an interactive shell to a nearby EMWaver device.
    Shell {
        /// Show raw hex payloads alongside ASCII output.
        #[arg(long)]
        verbose: bool,
    },
    /// Send an ASCII command to the connected device (daemon-backed).
    ///
    /// This is a shorthand for `emwaver daemon cmd ...`.
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
        /// Print both ASCII (trimmed) and raw hex bytes.
        #[arg(long, conflicts_with = "json")]
        verbose: bool,
        /// Output as JSON (includes base64 bytes).
        #[arg(long)]
        json: bool,
    },
    /// Start the background daemon (recommended).
    ///
    /// This is a shorthand for `emwaver daemon start ...`.
    Start {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
    },
    /// Stop the running daemon.
    ///
    /// This is a shorthand for `emwaver daemon stop ...`.
    Stop {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
    },
    /// Check whether the daemon is running.
    ///
    /// This is a shorthand for `emwaver daemon status ...`.
    Status {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
        /// Output as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Connect the daemon to a device (USB MIDI).
    ///
    /// This is a shorthand for `emwaver daemon connect ...`.
    Connect {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
        /// MIDI port name to connect to (if omitted, connects to the first available port).
        #[arg(long)]
        port: Option<String>,
    },
    /// Disconnect the daemon from the active device.
    ///
    /// This is a shorthand for `emwaver daemon disconnect ...`.
    Disconnect {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
    },
    /// Print the currently connected device(s).
    ///
    /// This is a shorthand for `emwaver daemon connected ...`.
    Connected {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
        /// Output as JSON.
        #[arg(long)]
        json: bool,
    },
    /// USB MIDI transport utilities (daemon-backed).
    Midi {
        #[command(subcommand)]
        command: MidiCommand,
    },
    /// Build the firmware in the current project (STM32 CubeMX/CubeIDE).
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
    /// Flash the firmware in the current project (STM32 DFU over USB).
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
pub enum MidiCommand {
    /// List available USB MIDI ports.
    List {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
        /// Output as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Connect the daemon to a USB MIDI port.
    Connect {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
        /// MIDI port name to connect to (defaults to the first matching port).
        #[arg(long)]
        port: Option<String>,
        /// Output as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Disconnect the active MIDI connection (if any).
    Disconnect {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
    },
    /// Print current MIDI connection status.
    Status {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
        /// Output as JSON.
        #[arg(long)]
        json: bool,
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
    /// Ask the daemon to connect to a USB MIDI port.
    Connect {
        /// Override the daemon socket path.
        #[arg(long)]
        socket: Option<PathBuf>,
        /// MIDI port name to connect to (if omitted, connects to the first available port).
        #[arg(long)]
        port: Option<String>,
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
        /// Print both ASCII (trimmed) and raw hex bytes.
        #[arg(long, conflicts_with = "json")]
        verbose: bool,
        /// Output as JSON (includes base64 bytes).
        #[arg(long)]
        json: bool,
    },
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
    Stm32f042,
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
