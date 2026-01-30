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

#[derive(Debug, Parser)]
#[command(
    name = "emwaver",
    version,
    about = "EMWaver tooling",
    disable_help_subcommand = true,
    subcommand_required = true,
    arg_required_else_help = true
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Build the STM32 firmware (updates the bundled .bin used by Desktop).
    Build {
        /// Run `make clean` before building.
        #[arg(long)]
        clean: bool,
    },

    /// Flash the bundled firmware to a device in Update Mode (DFU).
    Flash {
        /// Print DFU discovery details.
        #[arg(long)]
        verbose: bool,
        /// DFU alt setting to use (defaults to "Internal Flash" if present).
        #[arg(long)]
        alt: Option<u8>,
    },
}
