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

use crate::dfu::{DEFAULT_USB_PRODUCT_ID, DEFAULT_USB_VENDOR_ID, DfuDevice, DfuOpenOptions};
use crate::cli::CodegenMode;
use anyhow::{Context, Result, bail};
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::env;
use std::io::Write;
use tempfile::NamedTempFile;
use walkdir::WalkDir;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FirmwareKind {
    EspIdf,
    Stm32Cube,
}

pub fn build(project: Option<PathBuf>, codegen: CodegenMode, verbose: bool) -> Result<()> {
    match resolve_firmware_project(project)? {
        (FirmwareKind::EspIdf, project) => {
            if !matches!(codegen, CodegenMode::Auto) {
                bail!("`--codegen` is only supported for STM32 CubeMX/CubeIDE projects");
            }
            esp_idf_build(&project)
        }
        (FirmwareKind::Stm32Cube, project) => {
            stm32_codegen_if_needed(&project, codegen, verbose)?;
            let _bin = stm32_build_and_export_bin(&project, verbose)?;
            Ok(())
        }
    }
}

pub fn flash(
    project: Option<PathBuf>,
    port: Option<String>,
    codegen: CodegenMode,
    dfu_alt: Option<u8>,
    verbose: bool,
) -> Result<()> {
    match resolve_firmware_project(project)? {
        (FirmwareKind::EspIdf, project) => {
            if !matches!(codegen, CodegenMode::Auto) {
                bail!("`--codegen` is only supported for STM32 CubeMX/CubeIDE projects");
            }
            if dfu_alt.is_some() {
                bail!("`--dfu-alt` is only supported for STM32 USB DFU flashing");
            }
            esp_idf_flash(&project, port)
        }
        (FirmwareKind::Stm32Cube, project) => {
            if port.is_some() {
                bail!("`--port` is only supported for ESP-IDF serial flashing");
            }
            stm32_codegen_if_needed(&project, codegen, verbose)?;
            let bin = stm32_build_and_export_bin(&project, verbose)?;
            dfu_flash_file(
                bin,
                DEFAULT_USB_VENDOR_ID,
                DEFAULT_USB_PRODUCT_ID,
                0x0800_0000,
                dfu_alt,
                verbose,
            )
        }
    }
}

pub fn monitor(project: Option<PathBuf>, port: Option<String>) -> Result<()> {
    let (kind, project) = resolve_firmware_project(project)?;
    match kind {
        FirmwareKind::EspIdf => esp_idf_monitor(&project, port),
        FirmwareKind::Stm32Cube => bail!("monitor is only supported for ESP-IDF projects"),
    }
}

pub fn dfu_flash_file(
    file: PathBuf,
    vid: u16,
    pid: u16,
    address: u32,
    alt: Option<u8>,
    verbose: bool,
) -> Result<()> {
    let firmware = fs::read(&file).with_context(|| format!("failed to read firmware file `{}`", file.display()))?;
    let (mut device, discovery) = DfuDevice::open_with_options(vid, pid, DfuOpenOptions { alt_setting: alt, verbose })
        .map_err(anyhow::Error::msg)?;
    if verbose {
        eprintln!(
            "DFU using interface {}{}",
            discovery.interface_number,
            discovery
                .selected_alt_setting
                .map(|a| format!(", alt {a}"))
                .unwrap_or_default()
        );
    }
    device
        .flash(&firmware, address, |msg| println!("{msg}"))
        .map_err(anyhow::Error::msg)?;
    Ok(())
}

fn resolve_firmware_project(project: Option<PathBuf>) -> Result<(FirmwareKind, PathBuf)> {
    let project = match project {
        Some(path) => path,
        None => autodetect_firmware_project()?,
    };

    if is_esp_idf_project_dir(&project) {
        return Ok((FirmwareKind::EspIdf, project));
    }
    if is_stm32_cube_project_dir(&project)? {
        return Ok((FirmwareKind::Stm32Cube, project));
    }

    bail!(
        "firmware project `{}` not found (expected ESP-IDF `setup.sh`+`sdkconfig`, or STM32 CubeMX `.ioc` + `Release/makefile`)",
        project.display()
    )
}

fn autodetect_firmware_project() -> Result<PathBuf> {
    let cwd = env::current_dir().context("failed to read current directory")?;

    // Prefer "current tree" projects (ancestor dirs) over subdirs.
    for dir in cwd.ancestors() {
        if is_esp_idf_project_dir(dir) || is_stm32_cube_project_dir(dir)? {
            return Ok(dir.to_path_buf());
        }
    }

    // Fall back to repo-style subdirs: `esp/` and `stm/<project>/`.
    for dir in cwd.ancestors() {
        let esp_subdir = dir.join("esp");
        if is_esp_idf_project_dir(&esp_subdir) {
            return Ok(esp_subdir);
        }

        let stm_subdir = dir.join("stm");
        if stm_subdir.is_dir() {
            let mut candidates = Vec::new();
            for entry in fs::read_dir(&stm_subdir).with_context(|| format!("failed to read `{}`", stm_subdir.display()))? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() && is_stm32_cube_project_dir(&path)? {
                    candidates.push(path);
                }
            }
            if candidates.len() == 1 {
                return Ok(candidates.remove(0));
            }
            if candidates.len() > 1 {
                bail!(
                    "multiple STM32 firmware projects found under `{}`; `cd` into one or pass `--project <path>`",
                    stm_subdir.display()
                );
            }
        }
    }

    bail!("could not auto-detect a firmware project; pass `--project <path>`")
}

// ---- ESP-IDF ----

fn esp_idf_build(project: &Path) -> Result<()> {
    run_idf(project, &["build"])
}

fn esp_idf_flash(project: &Path, port: Option<String>) -> Result<()> {
    if let Some(port) = port.as_deref() {
        run_idf(project, &["-p", port, "flash"])
    } else {
        run_idf(project, &["flash"])
    }
}

fn esp_idf_monitor(project: &Path, port: Option<String>) -> Result<()> {
    if let Some(port) = port.as_deref() {
        run_idf(project, &["-p", port, "monitor"])
    } else {
        run_idf(project, &["monitor"])
    }
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

// ---- STM32 CubeMX / CubeIDE ----

fn is_stm32_cube_project_dir(project: &Path) -> Result<bool> {
    if !project.is_dir() {
        return Ok(false);
    }
    if !project.join("Release").join("makefile").is_file() {
        return Ok(false);
    }
    Ok(find_single_ioc(project).is_ok())
}

fn find_single_ioc(project: &Path) -> Result<PathBuf> {
    let mut iocs = Vec::new();
    for entry in fs::read_dir(project).with_context(|| format!("failed to read `{}`", project.display()))? {
        let entry = entry?;
        let path = entry.path();
        if path.extension() == Some(OsStr::new("ioc")) {
            iocs.push(path);
        }
    }
    match iocs.len() {
        0 => bail!("no `.ioc` file found in `{}`", project.display()),
        1 => Ok(iocs.remove(0)),
        _ => bail!(
            "multiple `.ioc` files found in `{}`; pass a more specific `--project <path>`",
            project.display()
        ),
    }
}

fn stm32_codegen_if_needed(project: &Path, mode: CodegenMode, verbose: bool) -> Result<()> {
    match mode {
        CodegenMode::Never => {
            if verbose {
                let needed = stm32_codegen_needed(project)?;
                if needed {
                    eprintln!("Skipping STM32CubeMX code generation (`--codegen never`).");
                } else {
                    eprintln!("Skipping STM32CubeMX code generation (`--codegen never`, not needed).");
                }
            }
            Ok(())
        }
        CodegenMode::Always => {
            if verbose {
                eprintln!("Running STM32CubeMX code generation (`--codegen always`).");
            }
            stm32_codegen(project)
        }
        CodegenMode::Auto => {
            if stm32_codegen_needed(project)? {
                match find_cubemx_optional()? {
                    Some(cubemx) => {
                        if verbose {
                            eprintln!(
                                "Running STM32CubeMX code generation (project `.ioc` appears newer): {}",
                                cubemx.display()
                            );
                        }
                        stm32_codegen_with(&cubemx, project)
                    }
                    None => {
                        if verbose {
                            eprintln!(
                                "STM32CubeMX not found; continuing without regeneration (pass `--codegen always` to require CubeMX)."
                            );
                        }
                        Ok(())
                    }
                }
            } else {
                if verbose {
                    eprintln!("Skipping STM32CubeMX code generation (generated sources appear up-to-date).");
                }
                Ok(())
            }
        }
    }
}

fn stm32_codegen_needed(project: &Path) -> Result<bool> {
    let ioc = find_single_ioc(project)?;
    let ioc_mtime = fs::metadata(&ioc)
        .with_context(|| format!("failed to stat `{}`", ioc.display()))?
        .modified()
        .with_context(|| format!("failed to read mtime for `{}`", ioc.display()))?;

    let sentinels = [
        project.join("Core").join("Src").join("main.c"),
        project.join("Core").join("Inc").join("main.h"),
        project.join("USB_DEVICE").join("App").join("usb_device.c"),
        project.join("USB_DEVICE").join("Target").join("usbd_conf.c"),
    ];

    let mut newest_generated: Option<std::time::SystemTime> = None;
    for sentinel in sentinels {
        if !sentinel.is_file() {
            return Ok(true);
        }
        let mtime = fs::metadata(&sentinel)
            .with_context(|| format!("failed to stat `{}`", sentinel.display()))?
            .modified()
            .with_context(|| format!("failed to read mtime for `{}`", sentinel.display()))?;
        newest_generated = Some(match newest_generated {
            Some(existing) => existing.max(mtime),
            None => mtime,
        });
    }

    Ok(match newest_generated {
        None => true,
        Some(generated) => ioc_mtime > generated,
    })
}

fn stm32_codegen(project: &Path) -> Result<()> {
    let cubemx = find_cubemx()?;
    stm32_codegen_with(&cubemx, project)
}

fn stm32_codegen_with(cubemx: &Path, project: &Path) -> Result<()> {
    let ioc = find_single_ioc(project)?.canonicalize().with_context(|| "failed to resolve `.ioc` path")?;

    // CubeMX on macOS is a GUI app; script mode still may open a window. We run it
    // in quiet mode to avoid requiring the user to navigate to the project.
    let mut script = NamedTempFile::new().context("failed to create CubeMX script file")?;
    script
        .write_all(format!("config load {ioc}\nproject generate\nexit\n", ioc = ioc.display()).as_bytes())
        .context("failed to write CubeMX script")?;
    let _ = script.flush();

    let mut cmd = Command::new(cubemx);
    cmd.arg("-q")
        .arg(script.path())
        .current_dir(project)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let status = cmd.status().context("failed to run STM32CubeMX")?;
    if !status.success() {
        bail!("STM32CubeMX exited with {status}");
    }
    Ok(())
}

fn stm32_build_and_export_bin(project: &Path, verbose: bool) -> Result<PathBuf> {
    let env = stm32_build_env()?;
    let jobs = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let release = project.join("Release");

    if verbose {
        if let Some(gcc) = resolve_in_env_path("arm-none-eabi-gcc", &env) {
            eprintln!("Using ARM toolchain: {}", gcc.display());
        }
        if let Ok(spec_path) = Command::new("arm-none-eabi-gcc")
            .arg("-print-file-name=nano.specs")
            .envs(env.clone())
            .stdin(Stdio::null())
            .output()
        {
            let raw = String::from_utf8_lossy(&spec_path.stdout);
            let spec = raw.trim();
            if !spec.is_empty() {
                eprintln!("nano.specs: {spec}");
            }
        }
    }

    let status = Command::new("make")
        .arg("-C")
        .arg(&release)
        .arg(format!("-j{jobs}"))
        .arg("all")
        .envs(env.clone())
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .with_context(|| format!("failed to run `make -C {}`", release.display()))?;

    if !status.success() {
        bail!("`make -C {}` exited with {status}", release.display());
    }

    let elf = find_single_elf(&release)?;
    let bin = elf.with_extension("bin");

    let status = Command::new("arm-none-eabi-objcopy")
        .arg("-O")
        .arg("binary")
        .arg(&elf)
        .arg(&bin)
        .envs(env)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .context("failed to run `arm-none-eabi-objcopy`")?;

    if !status.success() {
        bail!("`arm-none-eabi-objcopy` exited with {status}");
    }

    println!("Exported: {}", bin.display());
    Ok(bin)
}

fn resolve_in_env_path(binary: &str, env: &[(String, String)]) -> Option<PathBuf> {
    let mut override_path = None;
    for (k, v) in env {
        if k == "PATH" {
            override_path = Some(v.as_str());
            break;
        }
    }

    let path = override_path
        .map(std::ffi::OsString::from)
        .or_else(|| env::var_os("PATH"))?;

    for dir in env::split_paths(&path) {
        let candidate = dir.join(binary);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn find_single_elf(release_dir: &Path) -> Result<PathBuf> {
    let mut elfs = Vec::new();
    for entry in fs::read_dir(release_dir).with_context(|| format!("failed to read `{}`", release_dir.display()))? {
        let entry = entry?;
        let path = entry.path();
        if path.extension() == Some(OsStr::new("elf")) {
            elfs.push(path);
        }
    }
    match elfs.len() {
        0 => bail!("no `.elf` output found in `{}`", release_dir.display()),
        1 => Ok(elfs.remove(0)),
        _ => bail!("multiple `.elf` outputs found in `{}`", release_dir.display()),
    }
}

fn stm32_build_env() -> Result<Vec<(String, String)>> {
    if let Some(bin_dir) = env::var_os("EMWAVER_ARM_TOOLCHAIN_BIN") {
        let bin_dir = PathBuf::from(bin_dir);
        if !bin_dir.is_dir() {
            bail!(
                "EMWAVER_ARM_TOOLCHAIN_BIN is set but is not a directory: {}",
                bin_dir.display()
            );
        }
        let current = env::var_os("PATH").unwrap_or_default();
        let mut new_path = std::ffi::OsString::from(bin_dir);
        new_path.push(":");
        new_path.push(current);
        return Ok(vec![("PATH".to_string(), new_path.to_string_lossy().into_owned())]);
    }

    if toolchain_ok().unwrap_or(false) {
        return Ok(Vec::new());
    }

    if let Some(bin_dir) = find_cubeide_toolchain_bin()? {
        let current = env::var_os("PATH").unwrap_or_default();
        let mut new_path = std::ffi::OsString::from(bin_dir);
        new_path.push(":");
        new_path.push(current);
        return Ok(vec![("PATH".to_string(), new_path.to_string_lossy().into_owned())]);
    }

    bail!(
        "missing/invalid ARM toolchain: expected `arm-none-eabi-gcc` and `arm-none-eabi-objcopy` on PATH (or install STM32CubeIDE so its bundled toolchain can be auto-detected)"
    )
}

fn toolchain_ok() -> Result<bool> {
    let gcc_ok = Command::new("arm-none-eabi-gcc")
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok();
    if !gcc_ok {
        return Ok(false);
    }

    let objcopy_ok = Command::new("arm-none-eabi-objcopy")
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok();
    if !objcopy_ok {
        return Ok(false);
    }

    let nano_specs = Command::new("arm-none-eabi-gcc")
        .arg("-print-file-name=nano.specs")
        .stdin(Stdio::null())
        .output()
        .context("failed to query `nano.specs` from `arm-none-eabi-gcc`")?;
    if !nano_specs.status.success() {
        return Ok(false);
    }
    let nano_specs = String::from_utf8_lossy(&nano_specs.stdout).trim().to_string();
    if nano_specs.is_empty() || nano_specs == "nano.specs" || !Path::new(&nano_specs).is_file() {
        return Ok(false);
    }

    let mut test_c = NamedTempFile::new().context("failed to create toolchain test source")?;
    test_c
        .write_all(
            b"#include <stdint.h>\n#include <stdio.h>\nint main(void) { return 0; }\n",
        )
        .context("failed to write toolchain test source")?;
    let test_o = NamedTempFile::new().context("failed to create toolchain test output")?;

    let status = Command::new("arm-none-eabi-gcc")
        .arg("-mcpu=cortex-m0")
        .arg("-mthumb")
        .arg("--specs=nano.specs")
        .arg("-c")
        .arg(test_c.path())
        .arg("-o")
        .arg(test_o.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .context("failed to run `arm-none-eabi-gcc` for toolchain validation")?;

    Ok(status.success())
}

fn find_cubeide_toolchain_bin() -> Result<Option<PathBuf>> {
    let candidates = [
        PathBuf::from("/Applications/STM32CubeIDE.app"),
        env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/"))
            .join("Applications/STM32CubeIDE.app"),
    ];

    for app in candidates {
        let ide_root = app.join("Contents").join("Eclipse");
        if !ide_root.is_dir() {
            continue;
        }

        for entry in WalkDir::new(&ide_root).max_depth(8).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() && entry.file_name() == "arm-none-eabi-gcc" {
                let path = entry.path();
                if path.parent().is_some_and(|p| p.file_name() == Some(OsStr::new("bin"))) {
                    return Ok(path.parent().map(|p| p.to_path_buf()));
                }
            }
        }
    }

    Ok(None)
}

fn find_cubemx() -> Result<PathBuf> {
    let cubemx = find_cubemx_optional()?;
    if let Some(path) = cubemx {
        return Ok(path);
    }

    bail!(
        "STM32CubeMX not found. Install it or set EMWAVER_CUBEMX=/path/to/STM32CubeMX (expected e.g. /Applications/STMicroelectronics/STM32CubeMX.app/Contents/MacOS/STM32CubeMX)"
    )
}

fn find_cubemx_optional() -> Result<Option<PathBuf>> {
    if let Some(path) = env::var_os("EMWAVER_CUBEMX") {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Ok(Some(p));
        }
        bail!("EMWAVER_CUBEMX is set but is not a file: {}", p.display());
    }

    let candidates = [
        PathBuf::from("/Applications/STMicroelectronics/STM32CubeMX.app/Contents/MacOS/STM32CubeMX"),
        PathBuf::from("/Applications/STM32CubeMX.app/Contents/MacOS/STM32CubeMX"),
        env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/"))
            .join("Applications/STM32CubeMX.app/Contents/MacOS/STM32CubeMX"),
    ];

    for path in candidates {
        if path.is_file() {
            return Ok(Some(path));
        }
    }

    if let Ok(path) = which("STM32CubeMX") {
        return Ok(Some(path));
    }

    Ok(None)
}

fn which(binary: &str) -> Result<PathBuf> {
    let path = env::var_os("PATH").unwrap_or_default();
    for dir in env::split_paths(&path) {
        let candidate = dir.join(binary);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    bail!("`{binary}` not found on PATH")
}
