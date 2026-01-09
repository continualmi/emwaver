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

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use include_dir::{include_dir, Dir};

use crate::cli::{Component, Target};

static STM32F042_TEMPLATE: Dir = include_dir!("$CARGO_MANIFEST_DIR/../../stm/emwaver-firmware");

pub fn run_init(target: Target, _components: Vec<Component>, destination: PathBuf) -> Result<()> {
    match target {
        Target::Stm32f042 => {}
    }

    if destination.exists() {
        if !destination.is_dir() {
            bail!("destination exists and is not a directory");
        }
    } else {
        fs::create_dir_all(&destination)
            .with_context(|| format!("failed to create {}", destination.display()))?;
    }

    write_dir(&STM32F042_TEMPLATE, &destination)?;
    normalize_project_names(&destination)?;

    println!("Initialized {target:?} project at {}", destination.display());
    let project_name = destination
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("emwaver-firmware");
    println!(
        "Next: open `{project_name}.ioc` in STM32CubeIDE, generate code if prompted, then build/flash."
    );
    Ok(())
}

fn normalize_project_names(destination: &Path) -> Result<()> {
    let project_name = destination
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("emwaver-firmware");

    let Some((old_ioc_path, old_ioc_name)) = find_root_ioc(destination)? else {
        return Ok(());
    };

    let old_project_name = read_project_name(destination)
        .or_else(|| {
            old_ioc_path
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| old_ioc_name.trim_end_matches(".ioc").to_string());

    let new_ioc_path = destination.join(format!("{project_name}.ioc"));
    if old_ioc_path != new_ioc_path {
        fs::rename(&old_ioc_path, &new_ioc_path).with_context(|| {
            format!(
                "failed to rename {} to {}",
                old_ioc_path.display(),
                new_ioc_path.display()
            )
        })?;
    }

    for relative_path in [".project", ".cproject"] {
        let path = destination.join(relative_path);
        replace_in_file(&path, &old_project_name, project_name)?;
    }

    replace_in_file(&new_ioc_path, &old_project_name, project_name)?;
    replace_in_file(&new_ioc_path, &old_ioc_name, &format!("{project_name}.ioc"))?;

    Ok(())
}

fn find_root_ioc(destination: &Path) -> Result<Option<(PathBuf, String)>> {
    for entry in fs::read_dir(destination)
        .with_context(|| format!("failed to read {}", destination.display()))?
    {
        let entry = entry.with_context(|| format!("failed to read entry in {}", destination.display()))?;
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy().to_string();
        if file_name.ends_with(".ioc") {
            return Ok(Some((entry.path(), file_name)));
        }
    }
    Ok(None)
}

fn read_project_name(destination: &Path) -> Option<String> {
    let project_path = destination.join(".project");
    let contents = fs::read_to_string(project_path).ok()?;
    let start = contents.find("<name>")? + "<name>".len();
    let end = contents[start..].find("</name>")? + start;
    Some(contents[start..end].trim().to_string())
}

fn replace_in_file(path: &Path, from: &str, to: &str) -> Result<()> {
    let contents = fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    if !contents.contains(from) {
        return Ok(());
    }
    let updated = contents.replace(from, to);
    fs::write(path, updated).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn write_dir(template: &Dir, destination: &Path) -> Result<()> {
    for entry in template.entries() {
        let out_path = destination.join(entry.path());
        match entry {
            include_dir::DirEntry::Dir(d) => {
                fs::create_dir_all(&out_path)
                    .with_context(|| format!("failed to create {}", out_path.display()))?;
                write_dir(d, destination)?;
            }
            include_dir::DirEntry::File(f) => {
                let parent = out_path.parent().unwrap_or(destination);
                fs::create_dir_all(parent)
                    .with_context(|| format!("failed to create {}", parent.display()))?;
                fs::write(&out_path, f.contents())
                    .with_context(|| format!("failed to write {}", out_path.display()))?;
            }
        }
    }
    Ok(())
}
