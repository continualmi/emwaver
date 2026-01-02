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

use anyhow::{bail, Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

const AGENTS_FILENAME: &str = "AGENTS.md";

const AGENTS_TEMPLATE: &str = include_str!("../resources/vibe/AGENTS_template.md");

pub fn init_repo(destination: PathBuf, force: bool, update_agents: bool) -> Result<()> {
    if destination.exists() && !destination.is_dir() {
        bail!("destination exists and is not a directory: {}", destination.display());
    }
    fs::create_dir_all(&destination)
        .with_context(|| format!("failed to create {}", destination.display()))?;

    if update_agents {
        write_agents_md(&destination.join(AGENTS_FILENAME), force)?;
        println!("Updated {}", destination.join(AGENTS_FILENAME).display());
    } else {
        println!(
            "Skipped {} (--no-agents).",
            destination.join(AGENTS_FILENAME).display()
        );
    }
    println!("Next: `emwaver start`, then `emwaver cmd version`.");

    Ok(())
}

fn write_agents_md(path: &Path, force: bool) -> Result<()> {
    let template = normalize_newlines(AGENTS_TEMPLATE).trim_end().to_string() + "\n";

    if path.exists() {
        let existing =
            fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
        if normalize_newlines(&existing) == template {
            return Ok(());
        }
        if !force {
            bail!("refusing to overwrite {}; re-run with --force", path.display());
        }
    }

    fs::write(path, template).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn normalize_newlines(s: &str) -> String {
    s.replace("\r\n", "\n")
}
