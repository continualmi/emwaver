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

use anyhow::Result;
use dialoguer::{theme::ColorfulTheme, Confirm, MultiSelect, Select};

use crate::cli::{Component, Stm32Firmware, Target};
use crate::{init, shell};

pub fn run_menu() -> Result<()> {
    let theme = ColorfulTheme::default();

    let selection = Select::with_theme(&theme)
        .with_prompt("EMWaver CLI")
        .default(0)
        .items(&["Device shell", "Init firmware project", "Exit"])
        .interact()?;

    match selection {
        0 => {
            let verbose = Confirm::with_theme(&theme)
                .with_prompt("Verbose output?")
                .default(false)
                .interact()?;
            shell::run_shell(verbose)
        }
        1 => {
            let target = prompt_target(&theme)?;
            let cwd = std::env::current_dir()?;
            let proceed = Confirm::with_theme(&theme)
                .with_prompt(format!(
                    "Create EMWaver firmware project in {}? (will overwrite files)",
                    cwd.display()
                ))
                .default(true)
                .interact()?;
            if proceed {
                match target {
                    Target::Esp32s3 => {
                        let components = prompt_components(&theme, target)?;
                        init::run_init(target, components, None, cwd)?;
                    }
                    Target::Stm32f042 => {
                        let firmware = prompt_stm32_firmware(&theme)?;
                        init::run_init(target, Vec::new(), Some(firmware), cwd)?;
                    }
                }
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn prompt_target(theme: &ColorfulTheme) -> Result<Target> {
    let selection = Select::with_theme(theme)
        .with_prompt("Target")
        .default(0)
        .items(&["esp32s3", "stm32f042"])
        .interact()?;
    Ok(match selection {
        0 => Target::Esp32s3,
        _ => Target::Stm32f042,
    })
}

fn prompt_components(theme: &ColorfulTheme, target: Target) -> Result<Vec<Component>> {
    let (choices, core_label) = match target {
        Target::Esp32s3 => (
            vec![
                (Component::Gpio, "GPIO commands"),
                (Component::Sampler, "Sampler commands"),
                (Component::Cc1101, "CC1101 radio"),
                (Component::Rfm69, "RFM69 radio"),
                (Component::Mfrc522, "MFRC522 RFID"),
            ],
            "Core: BLE server + command registry + init (always included).",
        ),
        Target::Stm32f042 => (
            vec![
                (Component::Gpio, "GPIO commands"),
                (Component::Sampler, "Sampler commands"),
                (Component::Cc1101, "CC1101 radio"),
                (Component::Mfrc522, "MFRC522 RFID"),
            ],
            "Core: USB transport + command registry + init (always included).",
        ),
    };

    let labels: Vec<&str> = choices.iter().map(|(_, label)| *label).collect();

    let selections = MultiSelect::with_theme(theme)
        .with_prompt(format!(
            "Select optional components (space toggles, enter confirms). {core_label}"
        ))
        .items(&labels)
        .interact()?;

    Ok(selections.into_iter().map(|idx| choices[idx].0).collect())
}

fn prompt_stm32_firmware(theme: &ColorfulTheme) -> Result<Stm32Firmware> {
    let selection = Select::with_theme(theme)
        .with_prompt("STM32 firmware")
        .default(0)
        .items(&["gpio", "ir", "ism", "rfid"])
        .interact()?;
    Ok(match selection {
        0 => Stm32Firmware::Gpio,
        1 => Stm32Firmware::Ir,
        2 => Stm32Firmware::Ism,
        _ => Stm32Firmware::Rfid,
    })
}
