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
use dialoguer::{theme::ColorfulTheme, Confirm, Select};

use crate::cli::Target;
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
            let target = Target::Stm32f042;
            let cwd = std::env::current_dir()?;
            let proceed = Confirm::with_theme(&theme)
                .with_prompt(format!(
                    "Create EMWaver firmware project in {}? (will overwrite files)",
                    cwd.display()
                ))
                .default(true)
                .interact()?;
            if proceed {
                init::run_init(target, Vec::new(), cwd)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}
