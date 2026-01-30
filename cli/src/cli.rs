/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
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
