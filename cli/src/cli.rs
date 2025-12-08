use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(
    name = "emw",
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

    /// Clone all files from device to emwaver_files/ (creates .emwaver folder)
    Clone {
        /// Force overwrite if directory exists
        #[arg(short, long)]
        force: bool,
    },

    /// List files on the device
    #[command(name = "ls", visible_alias = "list")]
    List {
        /// Show detailed information
        #[arg(short, long)]
        long: bool,
    },

    /// Push all local changes to device (overwrites remote)
    Push {
        /// Skip confirmation prompt
        #[arg(short = 'y', long)]
        yes: bool,
    },

    /// Pull all remote changes from device (overwrites local)
    Pull {
        /// Skip confirmation prompt
        #[arg(short = 'y', long)]
        yes: bool,
    },

    /// Show sync status (like git status)
    Status {
        /// Show verbose status
        #[arg(short, long)]
        verbose: bool,
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
}
