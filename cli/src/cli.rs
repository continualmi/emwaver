use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "emwaver", version, about = "EMWaver file workspace CLI")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Authenticate against the EMWaver backend.
    Login {
        /// Email address used for authentication.
        #[arg(long)]
        email: Option<String>,
        /// Password used for authentication (will prompt if omitted).
        #[arg(long)]
        password: Option<String>,
    },
    /// Clone the remote workspace into a local directory.
    Clone {
        /// Workspace identifier to sync.
        workspace: String,
        /// Destination directory (defaults to workspace name).
        destination: Option<PathBuf>,
    },
    /// Show local changes relative to the last pull.
    Status,
    /// Display diffs for modified files.
    Diff {
        /// Optional subset of paths to include.
        paths: Vec<PathBuf>,
    },
    /// Stage files for the next push.
    Add { files: Vec<PathBuf> },
    /// Pull latest workspace contents.
    Pull,
    /// Push staged changes to the remote workspace.
    Push,
    /// Remove local credentials and workspace state.
    Logout,
    /// Connect to a nearby EMWaver device and open an interactive shell.
    Shell {
        /// Show raw hex payloads alongside ASCII output.
        #[arg(long)]
        verbose: bool,
    },
}
