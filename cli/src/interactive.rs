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

use crate::cli::{Component, Target};
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
            let target = Target::Esp32s3;
            let cwd = std::env::current_dir()?;
            let proceed = Confirm::with_theme(&theme)
                .with_prompt(format!(
                    "Create EMWaver firmware project in {}? (will overwrite files)",
                    cwd.display()
                ))
                .default(true)
                .interact()?;
            if proceed {
                let components = prompt_components(&theme)?;
                init::run_init(target, components, cwd)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn prompt_components(theme: &ColorfulTheme) -> Result<Vec<Component>> {
    let choices = [
        (Component::Gpio, "GPIO commands"),
        (Component::Sampler, "Sampler commands"),
        (Component::Cc1101, "CC1101 radio"),
        (Component::Rfm69, "RFM69 radio"),
        (Component::Mfrc522, "MFRC522 RFID"),
    ];
    let labels: Vec<&str> = choices.iter().map(|(_, label)| *label).collect();

    let selections = MultiSelect::with_theme(theme)
        .with_prompt("Select optional components (space toggles, enter confirms). Core is always included.")
        .items(&labels)
        .interact()?;

    Ok(selections.into_iter().map(|idx| choices[idx].0).collect())
}
