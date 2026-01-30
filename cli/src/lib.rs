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

use anyhow::Result;
use clap::Parser;
use emwaver_dfu::{DfuDevice, DfuOpenOptions, DEFAULT_USB_PRODUCT_ID, DEFAULT_USB_VENDOR_ID};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

pub fn run() -> Result<()> {
    let cli = cli::Cli::parse();

    match cli.command {
        cli::Command::Build { clean } => build_firmware(clean),
        cli::Command::Flash { verbose, alt } => flash_firmware(verbose, alt),
    }
}

fn build_firmware(clean: bool) -> Result<()> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Expected CLI to live under repo_root/cli"))?
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

    // Keep a copy inside the repo as the canonical bundled firmware payload.
    // Apps and internal tooling can reference this stable path.
    let bundled_firmware = repo_root.join("firmware/emwaver.bin");
    if let Some(parent) = bundled_firmware.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(&built_bin, &bundled_firmware)?;

    println!(
        "ok: {}",
        built_bin
            .strip_prefix(&repo_root)
            .unwrap_or(&built_bin)
            .display()
    );
    println!(
        "ok: {}",
        bundled_firmware
            .strip_prefix(&repo_root)
            .unwrap_or(&bundled_firmware)
            .display()
    );
    Ok(())
}

fn flash_firmware(verbose: bool, alt: Option<u8>) -> Result<()> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Expected CLI to live under repo_root/cli"))?
        .to_path_buf();

    let firmware_path = repo_root.join("firmware/emwaver.bin");
    let bytes = fs::read(&firmware_path)
        .map_err(|e| anyhow::anyhow!("Failed to read {}: {e}", firmware_path.display()))?;

    println!("Using {} ({} bytes)", firmware_path.display(), bytes.len());
    println!("Waiting for device in Update Mode (DFU)...");

    let (mut device, _discovery) = DfuDevice::open_with_options(
        DEFAULT_USB_VENDOR_ID,
        DEFAULT_USB_PRODUCT_ID,
        DfuOpenOptions {
            alt_setting: alt,
            verbose,
        },
    )
    .map_err(anyhow::Error::msg)?;

    device
        .flash(&bytes, 0x0800_0000, |msg| println!("{msg}"))
        .map_err(anyhow::Error::msg)?;

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
