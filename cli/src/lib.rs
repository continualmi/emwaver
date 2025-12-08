mod app_ble;
mod cli;
mod shell;
mod sync; // BLE connection to Android app for file sync
// shell.rs contains device_ble for ESP32-S3 connection

use anyhow::Result;
use clap::Parser;

pub fn run() -> Result<()> {
    let cli = cli::Cli::parse();

    // Create async runtime for BLE operations
    let runtime = tokio::runtime::Runtime::new()?;

    match cli.command {
        cli::Commands::Shell { verbose } => shell::run_shell(verbose),

        cli::Commands::Clone { directory, force } => runtime.block_on(async {
            let app = app_ble::AppConnection::connect().await?;
            app.clone_repository(&directory, force).await
        }),

        cli::Commands::List { long } => runtime.block_on(async {
            let app = app_ble::AppConnection::connect().await?;
            app.list_files(long).await?;
            Ok(())
        }),

        cli::Commands::Push { file, force } => runtime.block_on(async {
            let app = app_ble::AppConnection::connect().await?;
            app.push_file(&file, force).await
        }),

        cli::Commands::Pull { name, output } => runtime.block_on(async {
            let app = app_ble::AppConnection::connect().await?;
            app.pull_file(&name, output.as_deref()).await
        }),

        cli::Commands::Remove { name, force } => runtime.block_on(async {
            let app = app_ble::AppConnection::connect().await?;
            app.remove_file(&name, force).await
        }),

        cli::Commands::Status { verbose } => runtime.block_on(async {
            let app = app_ble::AppConnection::connect().await?;
            app.show_status(verbose).await
        }),
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
