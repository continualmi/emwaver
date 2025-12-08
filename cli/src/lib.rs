mod cli;
mod shell;

use anyhow::Result;
use clap::Parser;

pub fn run() -> Result<()> {
    let cli = cli::Cli::parse();
    match cli.command {
        cli::Commands::Shell { verbose } => shell::run_shell(verbose),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn cli_help_builds() {
        cli::Cli::command().debug_assert();
    }
}
