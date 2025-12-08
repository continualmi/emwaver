use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "emwaver", version, about = "EMWaver device CLI")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Connect to a nearby EMWaver device and open an interactive shell.
    Shell {
        /// Show raw hex payloads alongside ASCII output.
        #[arg(long)]
        verbose: bool,
    },
}
