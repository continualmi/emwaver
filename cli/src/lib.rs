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
