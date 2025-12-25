/*
 * EMWaver CLI - Firmware Workflows
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

use anyhow::{Context, Result, bail};
use std::path::Path;
use std::process::{Command, Stdio};
use std::{env, path::PathBuf};

pub fn esp_idf_build(project: Option<PathBuf>) -> Result<()> {
    let project = resolve_esp_idf_project(project)?;
    run_idf(&project, &["build"])
}

pub fn esp_idf_flash(project: Option<PathBuf>, port: Option<String>) -> Result<()> {
    let project = resolve_esp_idf_project(project)?;
    if let Some(port) = port.as_deref() {
        run_idf(&project, &["-p", port, "flash"])
    } else {
        run_idf(&project, &["flash"])
    }
}

pub fn esp_idf_monitor(project: Option<PathBuf>, port: Option<String>) -> Result<()> {
    let project = resolve_esp_idf_project(project)?;
    if let Some(port) = port.as_deref() {
        run_idf(&project, &["-p", port, "monitor"])
    } else {
        run_idf(&project, &["monitor"])
    }
}

fn resolve_esp_idf_project(project: Option<PathBuf>) -> Result<PathBuf> {
    let project = match project {
        Some(path) => path,
        None => autodetect_esp_idf_project()?,
    };
    ensure_esp_idf_project_dir(&project)?;
    Ok(project)
}

fn autodetect_esp_idf_project() -> Result<PathBuf> {
    let cwd = env::current_dir().context("failed to read current directory")?;
    for dir in cwd.ancestors() {
        if is_esp_idf_project_dir(dir) {
            return Ok(dir.to_path_buf());
        }
        let esp_subdir = dir.join("esp");
        if is_esp_idf_project_dir(&esp_subdir) {
            return Ok(esp_subdir);
        }
    }

    bail!(
        "could not auto-detect an ESP-IDF project (expected `setup.sh`, `CMakeLists.txt`, and `sdkconfig`); pass `--project <path>`"
    )
}

fn ensure_esp_idf_project_dir(project: &Path) -> Result<()> {
    if !is_esp_idf_project_dir(project) {
        bail!(
            "ESP-IDF project `{}` not found (expected `setup.sh`, `CMakeLists.txt`, and `sdkconfig`)",
            project.display()
        );
    }
    Ok(())
}

fn is_esp_idf_project_dir(project: &Path) -> bool {
    project.exists()
        && project.join("setup.sh").is_file()
        && project.join("CMakeLists.txt").is_file()
        && project.join("sdkconfig").is_file()
}

fn run_idf(project: &Path, args: &[&str]) -> Result<()> {
    let mut cmd = Command::new("bash");
    cmd.arg("-lc")
        .arg("source ./setup.sh && idf.py \"$@\"")
        .arg("bash")
        .args(args)
        .current_dir(project)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let status = cmd
        .status()
        .with_context(|| format!("failed to run `idf.py {}`", args.join(" ")))?;

    if !status.success() {
        bail!("`idf.py {}` exited with {status}", args.join(" "));
    }
    Ok(())
}
