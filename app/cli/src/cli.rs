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

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(
    name = "emwaver",
    version,
    about = "EMWaver CLI (Desktop-backed)",
    disable_help_subcommand = true
)]
pub struct Cli {
    /// Evaluate a snippet and exit (Python-style `-c`).
    #[arg(
        short = 'c',
        value_name = "CODE",
        conflicts_with_all = ["path", "interactive"]
    )]
    pub command: Option<String>,

    /// After running a file, drop into the REPL (Python-style `-i`).
    #[arg(short = 'i', requires = "path", conflicts_with = "command")]
    pub interactive: bool,

    /// Run a script file and exit (Python-style `python file.py`).
    #[arg(value_name = "FILE")]
    pub path: Option<PathBuf>,

    #[command(subcommand)]
    pub subcommand: Option<Command>,
}

#[derive(Debug, Subcommand)]
pub enum Command {
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
