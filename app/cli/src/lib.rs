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
mod desktop_ipc;
mod repl;

use anyhow::Result;
use clap::Parser;

pub fn run() -> Result<()> {
    let cli = cli::Cli::parse();

    if cli.subcommand.is_some() {
        if cli.command.is_some() || cli.path.is_some() || cli.interactive {
            anyhow::bail!("Use either a subcommand (like `cmd`) or Python-style `-c`/FILE/REPL, not both");
        }
    }

    match cli.subcommand {
        Some(cli::Command::Cmd {
            text,
            timeout_ms,
            packets,
            verbose,
            json,
        }) => cmd_desktop(text, timeout_ms, packets, verbose, json),
        Some(cli::Command::Usb { command }) => match command {
            cli::MidiCommand::List { json } => usb_list(json),
            cli::MidiCommand::Connect { port, json } => usb_connect(port, json),
            cli::MidiCommand::Disconnect => usb_disconnect(),
            cli::MidiCommand::Status { json } => usb_status(json),
        },
        None => {
            if let Some(code) = cli.command {
                return repl::run_code(&code);
            }
            if let Some(path) = cli.path {
                return repl::run_file(path, cli.interactive);
            }
            repl::run_repl()
        }
    }
}

fn cmd_desktop(
    text: Vec<String>,
    timeout_ms: u64,
    packets: u32,
    verbose: bool,
    json: bool,
) -> Result<()> {
    let text = text.join(" ");
    let value = desktop_ipc::rpc_ok(
        "send_command",
        serde_json::json!({
            "text": text,
            "timeout_ms": timeout_ms,
            "packets": packets
        }),
        std::time::Duration::from_millis(timeout_ms.saturating_add(5_000).max(1)),
    )?;

    let bytes_b64 = value.get("bytes_b64").and_then(|v| v.as_str()).unwrap_or("");
    let bytes = desktop_ipc::decode_b64(bytes_b64)?;

    if json {
        println!(
            "{}",
            serde_json::json!({
                "bytes_b64": bytes_b64,
                "bytes_len": bytes.len()
            })
        );
        return Ok(());
    }

    if verbose {
        let mut hex = String::new();
        for (i, b) in bytes.iter().enumerate() {
            use std::fmt::Write;
            let _ = write!(&mut hex, "{:02X}{}", b, if i + 1 == bytes.len() { "" } else { " " });
        }
        println!("hex: {hex}");
    }
    println!("{}", String::from_utf8_lossy(&bytes).trim_matches(['\0', '\n', '\r']));
    Ok(())
}

fn usb_list(json: bool) -> Result<()> {
    let value = desktop_ipc::rpc_ok("midi_list_ports", serde_json::json!({}), std::time::Duration::from_secs(5))?;
    if json {
        println!("{value}");
        return Ok(());
    }
    let ports = value
        .get("ports")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str())
        .collect::<Vec<_>>();
    for p in ports {
        println!("{p}");
    }
    Ok(())
}

fn usb_connect(port: Option<String>, json: bool) -> Result<()> {
    let value = desktop_ipc::rpc_ok(
        "midi_connect",
        serde_json::json!({ "port_name": port }),
        std::time::Duration::from_secs(10),
    )?;
    if json {
        println!("{value}");
        return Ok(());
    }
    println!("ok");
    Ok(())
}

fn usb_disconnect() -> Result<()> {
    let _ = desktop_ipc::rpc_ok("midi_disconnect", serde_json::json!({}), std::time::Duration::from_secs(5))?;
    println!("ok");
    Ok(())
}

fn usb_status(json: bool) -> Result<()> {
    let value = desktop_ipc::rpc_ok("midi_status", serde_json::json!({}), std::time::Duration::from_secs(3))?;
    if json {
        println!("{value}");
        return Ok(());
    }
    let connected = value.get("connected").and_then(|v| v.as_bool()).unwrap_or(false);
    let name = value.get("device_name").and_then(|v| v.as_str()).unwrap_or("");
    if connected {
        if name.is_empty() {
            println!("connected");
        } else {
            println!("connected: {name}");
        }
    } else {
        println!("disconnected");
    }
    Ok(())
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
