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
mod ble_cli;
mod bridge;
mod daemon;
pub mod ble_ota;
pub mod dfu;
pub mod firmware;
pub mod git;
pub mod init;
mod vibe;
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
        Some(cli::Command::List {
            timeout_ms,
            all,
            name,
            json,
        }) => ble_cli::list_devices(timeout_ms, all, name, json),
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
        Some(cli::Command::Vibe { command }) => match command {
            cli::VibeCommand::Init {
                path,
                force,
                no_agents,
            } => {
                let destination = path.unwrap_or(std::env::current_dir()?);
                vibe::init_repo(destination, force, !no_agents)
            }
        },
        Some(cli::Command::Daemon { command }) => match command {
            cli::DaemonCommand::Run { socket } => daemon::daemon_run(socket),
            cli::DaemonCommand::Start { socket } => daemon::daemon_start(socket),
            cli::DaemonCommand::Stop { socket } => daemon::daemon_stop(socket),
            cli::DaemonCommand::Status { socket, json } => daemon::daemon_status(socket, json),
            cli::DaemonCommand::List {
                socket,
                timeout_ms,
                all,
                name,
                json,
            } => daemon::daemon_list(socket, timeout_ms, all, name, json),
            cli::DaemonCommand::Connect {
                socket,
                address,
                name,
            } => daemon::daemon_connect(socket, address, name),
            cli::DaemonCommand::Disconnect { socket } => daemon::daemon_disconnect(socket),
            cli::DaemonCommand::Connected { socket, json } => daemon::daemon_connected(socket, json),
            cli::DaemonCommand::Cmd {
                socket,
                text,
                timeout_ms,
                packets,
                verbose,
                json,
            } => daemon::daemon_cmd(socket, text, timeout_ms, packets, verbose, json),
        },
        Some(cli::Command::Buffer { socket, command }) => match command {
            cli::BufferCommand::Clear => daemon::buffer_clear(socket),
            cli::BufferCommand::Len { json } => daemon::buffer_len(socket, json),
            cli::BufferCommand::Load { path, no_upload } => {
                let socket_clone = socket.clone();
                daemon::buffer_load_file(socket_clone, path)?;
                if !no_upload {
                    // Upload to device so it's ready for retransmission immediately.
                    daemon::buffer_transmit(socket)?;
                }
                Ok(())
            }
            cli::BufferCommand::Save { path } => daemon::buffer_save_file(socket, path),
            cli::BufferCommand::Transmit => daemon::buffer_transmit(socket),
        },
        Some(cli::Command::Sampler { socket, command }) => match command {
            cli::SamplerCommand::Start {
                duration_ms,
                pin,
            } => {
                daemon::sampler_start(socket.clone(), pin)?;
                if let Some(ms) = duration_ms {
                    if ms > 0 {
                        std::thread::sleep(std::time::Duration::from_millis(ms));
                        daemon::sampler_stop(socket)?;
                    }
                }
                Ok(())
            }
            cli::SamplerCommand::Stop => daemon::sampler_stop(socket),
        },
        Some(cli::Command::Retransmit { socket, command }) => match command {
            cli::RetransmitCommand::Start {
                pin,
                pwm,
                freq,
                duty,
                no_upload,
                duration_ms,
            } => {
                daemon::retransmit_start(socket.clone(), pin, pwm, freq, duty)?;
                if !no_upload {
                    // Match desktop behavior: enter transmit mode first, then upload
                    // the capture (the device monitors RX fill level before draining).
                    std::thread::sleep(std::time::Duration::from_millis(25));
                    daemon::buffer_transmit(socket.clone())?;
                }
                if let Some(ms) = duration_ms {
                    if ms > 0 {
                        std::thread::sleep(std::time::Duration::from_millis(ms));
                        daemon::retransmit_stop(socket)?;
                    }
                }
                Ok(())
            }
            cli::RetransmitCommand::Stop => daemon::retransmit_stop(socket),
        },
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
