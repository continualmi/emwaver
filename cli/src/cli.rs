use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(
    name = "emwaver",
    version,
    about = "EMWaver - Manage wavelets and device files"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Connect to a nearby EMWaver device and open an interactive shell
    Shell {
        /// Show raw hex payloads alongside ASCII output
        #[arg(long)]
        verbose: bool,
    },

    /// Clone all files from device to a directory (creates .emwaver folder)
    Clone {
        /// Directory to clone into
        directory: PathBuf,

        /// Force overwrite if directory exists
        #[arg(short, long)]
        force: bool,
    },

    /// List files on the device
    #[command(visible_alias = "ls")]
    List {
        /// Show detailed information
        #[arg(short, long)]
        long: bool,
    },

    /// Push a file to the device
    Push {
        /// File to push
        file: PathBuf,

        /// Force overwrite if file exists
        #[arg(short, long)]
        force: bool,
    },

    /// Pull a file from the device
    Pull {
        /// File name to pull
        name: String,

        /// Output path (default: current directory)
        #[arg(short, long)]
        output: Option<PathBuf>,
    },

    /// Remove a file from the device
    #[command(visible_alias = "rm")]
    Remove {
        /// File name to remove
        name: String,

        /// Force removal without confirmation
        #[arg(short, long)]
        force: bool,
    },

    /// Show sync status
    Status {
        /// Show verbose status
        #[arg(short, long)]
        verbose: bool,
    },
}
