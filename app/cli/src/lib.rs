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
use std::path::PathBuf;
use std::process::Command;
use std::fs;
use emwaver_dfu::{DfuDevice, DfuOpenOptions, DEFAULT_USB_PRODUCT_ID, DEFAULT_USB_VENDOR_ID};

pub fn run() -> Result<()> {
    let cli = cli::Cli::parse();

    if cli.subcommand.is_some() {
        if cli.command.is_some() || cli.path.is_some() || cli.interactive {
            anyhow::bail!("Use either a subcommand (like `cmd`) or Python-style `-c`/FILE/REPL, not both");
        }
    }

    match cli.subcommand {
        Some(cli::Command::Build { clean }) => build_firmware(clean),
        Some(cli::Command::Flash { verbose, alt }) => flash_firmware(verbose, alt),
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

fn build_firmware(clean: bool) -> Result<()> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| anyhow::anyhow!("Expected app/cli to live under repo_root/app/cli"))?
        .to_path_buf();

    let release_dir = repo_root.join("stm/emwaver-firmware/Release");

    // Prepend STM32CubeIDE toolchain to PATH for correct arm-none-eabi-gcc
    let stm32_toolchain_bin = "/Applications/STM32CubeIDE.app/Contents/Eclipse/plugins/com.st.stm32cube.ide.mcu.externaltools.gnu-tools-for-stm32.13.3.rel1.macos64_1.0.100.202509120712/tools/bin";
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{}:{}", stm32_toolchain_bin, current_path);

    if clean {
        let status = Command::new("make")
            .current_dir(&release_dir)
            .env("PATH", &new_path)
            .arg("clean")
            .status()?;
        if !status.success() {
            anyhow::bail!("Firmware clean failed");
        }
    }

    let status = Command::new("make")
        .current_dir(&release_dir)
        .env("PATH", &new_path)
        .arg("all")
        .status()?;
    if !status.success() {
        anyhow::bail!("Firmware build failed");
    }

    // The CubeIDE-generated Makefile doesn't always emit a .bin by default.
    // Always regenerate it from the ELF so `stm/.../Release/emwaver-firmware.bin` stays fresh.
    let status = Command::new("arm-none-eabi-objcopy")
        .current_dir(&release_dir)
        .args([
            "-O",
            "binary",
            "emwaver-firmware.elf",
            "emwaver-firmware.bin",
        ])
        .status()?;
    if !status.success() {
        anyhow::bail!("Failed to generate emwaver-firmware.bin (arm-none-eabi-objcopy)");
    }

    let built_bin = release_dir.join("emwaver-firmware.bin");

    // Keep a copy inside the repo under `app/` for Desktop dev builds
    // (so `app/src-tauri/build.rs` can bundle it deterministically).
    let repo_app_firmware = repo_root.join("app/src-tauri/firmware/emwaver.bin");
    if let Some(parent) = repo_app_firmware.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(&built_bin, &repo_app_firmware)?;

    println!("ok: {}", built_bin.strip_prefix(&repo_root).unwrap_or(&built_bin).display());
    println!("ok: {}", repo_app_firmware.strip_prefix(&repo_root).unwrap_or(&repo_app_firmware).display());
    Ok(())
}

fn flash_firmware(verbose: bool, alt: Option<u8>) -> Result<()> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| anyhow::anyhow!("Expected app/cli to live under repo_root/app/cli"))?
        .to_path_buf();

    let firmware_path = repo_root.join("app/src-tauri/firmware/emwaver.bin");
    let bytes = fs::read(&firmware_path)
        .map_err(|e| anyhow::anyhow!("Failed to read {}: {e}", firmware_path.display()))?;

    println!("Using {} ({} bytes)", firmware_path.display(), bytes.len());
    println!("Waiting for device in Update Mode (DFU)...");

    let (mut device, _discovery) = DfuDevice::open_with_options(
        DEFAULT_USB_VENDOR_ID,
        DEFAULT_USB_PRODUCT_ID,
        DfuOpenOptions { alt_setting: alt, verbose },
    )
    .map_err(anyhow::Error::msg)?;

    device
        .flash(&bytes, 0x0800_0000, |msg| println!("{msg}"))
        .map_err(anyhow::Error::msg)?;

    Ok(())
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
