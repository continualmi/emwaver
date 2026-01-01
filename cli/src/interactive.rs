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
                (Component::Ota, "OTA services (BLE + Wi‑Fi)"),
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
