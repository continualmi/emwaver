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

use std::io::{self, Write};
use anyhow::Result;

use crate::cli::Target;
use crate::{init, shell};

pub fn run_menu() -> Result<()> {
    loop {
        println!("EMWaver CLI");
        println!("1) Device shell");
        println!("2) Init firmware project");
        println!("3) Exit");
        print!("Select an option: ");
        io::stdout().flush()?;

        let choice = read_line()?;
        match choice.as_str() {
            "1" => {
                let verbose = prompt_yes_no("Verbose output? [y/N]: ")?;
                shell::run_shell(verbose)?;
            }
            "2" => {
                let target = prompt_target()?;
                let cwd = std::env::current_dir()?;
                println!("Create EMWaver project in {}?", cwd.display());
                let proceed = prompt_yes_no_default("Continue? [Y/n]: ", true)?;
                if proceed {
                    init::run_init(target)?;
                }
                return Ok(());
            }
            "3" => return Ok(()),
            _ => {
                println!("Invalid selection.");
            }
        }
    }
}

fn read_line() -> Result<String> {
    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    Ok(input.trim().to_string())
}

fn prompt_yes_no(prompt: &str) -> Result<bool> {
    prompt_yes_no_default(prompt, false)
}

fn prompt_yes_no_default(prompt: &str, default_yes: bool) -> Result<bool> {
    print!("{prompt}");
    io::stdout().flush()?;
    let input = read_line()?;
    if input.is_empty() {
        return Ok(default_yes);
    }
    Ok(matches!(input.as_str(), "y" | "Y" | "yes" | "YES" | "Yes"))
}


fn prompt_target() -> Result<Target> {
    print!("Target [esp32s3]: ");
    io::stdout().flush()?;
    let input = read_line()?;
    if input.is_empty() || input.eq_ignore_ascii_case("esp32s3") {
        Ok(Target::Esp32s3)
    } else {
        println!("Unknown target, defaulting to esp32s3.");
        Ok(Target::Esp32s3)
    }
}
