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

mod cli;
pub mod ble_ota;
pub mod dfu;
pub mod firmware;
pub mod git;
pub mod init;
mod interactive;
mod shell;

use anyhow::Result;
use clap::Parser;

pub use cli::CodegenMode;
pub use cli::{Component, Stm32Firmware, Target};
pub use cli::OtaTransport;

pub fn run() -> Result<()> {
    let cli = cli::Cli::parse();
    match cli.command {
        Some(cli::Command::Shell { verbose }) => shell::run_shell(verbose),
        Some(cli::Command::Ota {
            file,
            stock,
            device_name,
            transport,
            chunk_size,
            verbose,
        }) => {
            match transport {
                cli::OtaTransport::Ble => {
                    if stock {
                        ble_ota::flash_stock(device_name, chunk_size, verbose)
                    } else {
                        let file = file.expect("clap should enforce file when --stock is not present");
                        ble_ota::flash(file, device_name, chunk_size, verbose)
                    }
                }
                cli::OtaTransport::Wifi => {
                    if stock {
                        ble_ota::flash_stock_wifi(device_name, verbose)
                    } else {
                        let file = file.expect("clap should enforce file when --stock is not present");
                        ble_ota::flash_wifi(file, device_name, verbose)
                    }
                }
            }
        }
        Some(cli::Command::Build {
            project,
            codegen,
            verbose,
        }) => firmware::build(project, codegen, verbose),
        Some(cli::Command::Flash {
            project,
            port,
            codegen,
            dfu_alt,
            verbose,
        }) => firmware::flash(project, port, codegen, dfu_alt, verbose),
        Some(cli::Command::Monitor { project, port }) => firmware::monitor(project, port),
        Some(cli::Command::Dfu {
            file,
            vid,
            pid,
            address,
            alt,
            verbose,
        }) => firmware::dfu_flash_file(file, vid, pid, address, alt, verbose),
        Some(cli::Command::Init {
            target,
            components,
            stm32_firmware,
            path,
        }) => {
            let destination = path.unwrap_or(std::env::current_dir()?);
            init::run_init(target, components, stm32_firmware, destination)
        }
        None => interactive::run_menu(),
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
