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

use std::fs;
use std::path::Path;

use anyhow::{bail, Context, Result};
use include_dir::{include_dir, Dir, DirEntry};

use crate::cli::Target;

static TEMPLATES: Dir = include_dir!("$CARGO_MANIFEST_DIR/templates");

pub fn run_init(target: Target) -> Result<()> {
    let destination = std::env::current_dir()?;

    if destination.exists() {
        if !destination.is_dir() {
            bail!("destination exists and is not a directory");
        }
    } else {
        fs::create_dir_all(&destination)
            .with_context(|| format!("failed to create {}", destination.display()))?;
    }

    match target {
        Target::Esp32s3 => write_template("esp32s3", &destination),
    }?;

    println!("Initialized {target:?} project at {}", destination.display());
    Ok(())
}

fn write_template(template_name: &str, destination: &Path) -> Result<()> {
    let template_dir = TEMPLATES
        .get_dir(template_name)
        .with_context(|| format!("missing template: {template_name}"))?;

    write_entries(template_dir, Path::new(template_name), destination)
}

fn write_entries(dir: &Dir, root: &Path, destination: &Path) -> Result<()> {
    for entry in dir.entries() {
        match entry {
            DirEntry::Dir(subdir) => {
                let relative = subdir
                    .path()
                    .strip_prefix(root)
                    .context("failed to resolve template path")?;
                let target = destination.join(relative);
                fs::create_dir_all(&target)
                    .with_context(|| format!("failed to create {}", target.display()))?;
                write_entries(subdir, root, destination)?;
            }
            DirEntry::File(file) => {
                let relative = file
                    .path()
                    .strip_prefix(root)
                    .context("failed to resolve template path")?;
                let target = destination.join(relative);
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).with_context(|| {
                        format!("failed to create {}", parent.display())
                    })?;
                }
                fs::write(&target, file.contents())
                    .with_context(|| format!("failed to write {}", target.display()))?;
            }
        }
    }

    Ok(())
}
