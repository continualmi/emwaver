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

use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(name = "emwaver", version, about = "EMWaver CLI")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Open an interactive shell to a nearby EMWaver device.
    Shell {
        /// Show raw hex payloads alongside ASCII output.
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
        /// Destination directory (defaults to current directory).
        #[arg(long)]
        path: Option<PathBuf>,
    },
}

#[derive(Copy, Clone, Debug, ValueEnum)]
pub enum Target {
    Esp32s3,
}

#[derive(Copy, Clone, Debug, ValueEnum, Eq, PartialEq, Hash)]
pub enum Component {
    Gpio,
    Sampler,
    Cc1101,
    Rfm69,
    Mfrc522,
}
