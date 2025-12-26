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
use std::io::{self, BufRead, BufReader, IsTerminal};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tempfile::NamedTempFile;
use walkdir::WalkDir;

const STM32_CUBEMX_DOWNLOAD_URL: &str = "https://www.st.com/en/development-tools/stm32cubemx.html";
const ARM_GNU_TOOLCHAIN_DOWNLOAD_URL: &str =
    "https://developer.arm.com/downloads/-/gnu-rm";

#[derive(Clone, Debug)]
pub enum FirmwareProgress {
    Info(String),
    Stdout(String),
    Stderr(String),
}

fn run_command_streaming(
    cmd: &mut Command,
    on_event: &mut dyn FnMut(FirmwareProgress),
    label: Option<String>,
) -> Result<std::process::ExitStatus> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    if let Some(label) = label {
        on_event(FirmwareProgress::Info(format!("Running `{label}`...")));
    }

    let mut child = cmd.spawn().context("failed to spawn process")?;
    let stdout = child
        .stdout
        .take()
        .context("failed to capture stdout from process")?;
    let stderr = child
        .stderr
        .take()
        .context("failed to capture stderr from process")?;

    let (tx, rx) = mpsc::channel::<FirmwareProgress>();
    let tx_out = tx.clone();
    let tx_err = tx.clone();

    let out_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            let _ = tx_out.send(FirmwareProgress::Stdout(line));
        }
    });

    let err_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            let _ = tx_err.send(FirmwareProgress::Stderr(line));
        }
    });

    drop(tx);

    loop {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(event) => on_event(event),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {}
        }

        if let Some(status) = child.try_wait().context("failed to poll process")? {
            let _ = out_handle.join();
            let _ = err_handle.join();
            while let Ok(event) = rx.try_recv() {
                on_event(event);
            }
            return Ok(status);
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum HostPlatform {
    Macos,
    Linux,
    Windows,
    Other,
}

fn host_platform() -> HostPlatform {
    match env::consts::OS {
        "macos" => HostPlatform::Macos,
        "linux" => HostPlatform::Linux,
        "windows" => HostPlatform::Windows,
        _ => HostPlatform::Other,
    }
}

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

pub fn build_at_streaming(
    start_dir: PathBuf,
    project: Option<PathBuf>,
    codegen: CodegenMode,
    verbose: bool,
    on_event: &mut dyn FnMut(FirmwareProgress),
) -> Result<()> {
    match resolve_firmware_project_at(&start_dir, project)? {
        (FirmwareKind::EspIdf, project) => {
            if !matches!(codegen, CodegenMode::Auto) {
                bail!("`--codegen` is only supported for STM32 CubeMX/CubeIDE projects");
            }
            run_idf_streaming(&project, &["build"], on_event)
        }
        (FirmwareKind::Stm32Cube, project) => {
            stm32_codegen_if_needed_streaming(&project, codegen, verbose, on_event)?;
            let _bin = stm32_build_and_export_bin_streaming(&project, verbose, on_event)?;
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

pub fn flash_at_streaming(
    start_dir: PathBuf,
    project: Option<PathBuf>,
    port: Option<String>,
    codegen: CodegenMode,
    dfu_alt: Option<u8>,
    verbose: bool,
    on_event: &mut dyn FnMut(FirmwareProgress),
) -> Result<()> {
    match resolve_firmware_project_at(&start_dir, project)? {
        (FirmwareKind::EspIdf, project) => {
            if !matches!(codegen, CodegenMode::Auto) {
                bail!("`--codegen` is only supported for STM32 CubeMX/CubeIDE projects");
            }
            if dfu_alt.is_some() {
                bail!("`--dfu-alt` is only supported for STM32 USB DFU flashing");
            }

            let args_owned: Vec<String> = match port {
                Some(port) => vec!["-p".into(), port, "flash".into()],
                None => vec!["flash".into()],
            };
            let args: Vec<&str> = args_owned.iter().map(|s| s.as_str()).collect();
            run_idf_streaming(&project, args.as_slice(), on_event)
        }
        (FirmwareKind::Stm32Cube, project) => {
            if port.is_some() {
                bail!("`--port` is only supported for ESP-IDF serial flashing");
            }
            stm32_codegen_if_needed_streaming(&project, codegen, verbose, on_event)?;
            let bin = stm32_build_and_export_bin_streaming(&project, verbose, on_event)?;
            dfu_flash_file_streaming(
                bin,
                DEFAULT_USB_VENDOR_ID,
                DEFAULT_USB_PRODUCT_ID,
                0x0800_0000,
                dfu_alt,
                verbose,
                on_event,
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

fn dfu_flash_file_streaming(
    file: PathBuf,
    vid: u16,
    pid: u16,
    address: u32,
    alt: Option<u8>,
    verbose: bool,
    on_event: &mut dyn FnMut(FirmwareProgress),
) -> Result<()> {
    let firmware = fs::read(&file)
        .with_context(|| format!("failed to read firmware file `{}`", file.display()))?;
    let (mut device, discovery) =
        DfuDevice::open_with_options(vid, pid, DfuOpenOptions { alt_setting: alt, verbose })
            .map_err(anyhow::Error::msg)?;
    if verbose {
        on_event(FirmwareProgress::Info(format!(
            "DFU using interface {}{}",
            discovery.interface_number,
            discovery
                .selected_alt_setting
                .map(|a| format!(", alt {a}"))
                .unwrap_or_default()
        )));
    }
    device
        .flash(&firmware, address, |msg| on_event(FirmwareProgress::Info(msg)))
        .map_err(anyhow::Error::msg)?;
    Ok(())
}

fn resolve_firmware_project(project: Option<PathBuf>) -> Result<(FirmwareKind, PathBuf)> {
    let cwd = env::current_dir().context("failed to read current directory")?;
    resolve_firmware_project_at(&cwd, project)
}

fn resolve_firmware_project_at(
    start_dir: &Path,
    project: Option<PathBuf>,
) -> Result<(FirmwareKind, PathBuf)> {
    let project = match project {
        Some(path) => path,
        None => autodetect_firmware_project_from(start_dir)?,
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

fn autodetect_firmware_project_from(start_dir: &Path) -> Result<PathBuf> {
    if !start_dir.exists() {
        bail!("start directory `{}` does not exist", start_dir.display());
    }

    // Prefer "current tree" projects (ancestor dirs) over subdirs.
    for dir in start_dir.ancestors() {
        if is_esp_idf_project_dir(dir) || is_stm32_cube_project_dir(dir)? {
            return Ok(dir.to_path_buf());
        }
    }

    // Fall back to repo-style subdirs: `esp/` and `stm/<project>/`.
    for dir in start_dir.ancestors() {
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

fn run_idf_streaming(
    project: &Path,
    args: &[&str],
    on_event: &mut dyn FnMut(FirmwareProgress),
) -> Result<()> {
    let mut cmd = Command::new("bash");
    cmd.arg("-lc")
        .arg("source ./setup.sh && idf.py \"$@\"")
        .arg("bash")
        .args(args)
        .current_dir(project)
        .stdin(Stdio::null());

    let status = run_command_streaming(&mut cmd, on_event, Some(format!("idf.py {}", args.join(" "))))
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
    if verbose {
        match find_cubemx_optional()? {
            Some(path) => eprintln!("STM32CubeMX: {}", path.display()),
            None => eprintln!(
                "STM32CubeMX: not found (download: {STM32_CUBEMX_DOWNLOAD_URL})"
            ),
        }
    }

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
            match find_cubemx_optional()? {
                Some(cubemx) => stm32_codegen_with(&cubemx, project),
                None => bail!(
                    "STM32CubeMX not found (required by `--codegen always`). Install it from {STM32_CUBEMX_DOWNLOAD_URL} or set EMWAVER_CUBEMX=/path/to/STM32CubeMX"
                ),
            }
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
                        eprintln!(
                            "warning: STM32CubeMX not found; continuing without regeneration (download: {STM32_CUBEMX_DOWNLOAD_URL}, or pass `--codegen always` to require it)."
                        );
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

fn stm32_codegen_if_needed_streaming(
    project: &Path,
    mode: CodegenMode,
    verbose: bool,
    on_event: &mut dyn FnMut(FirmwareProgress),
) -> Result<()> {
    if verbose {
        match find_cubemx_optional()? {
            Some(path) => on_event(FirmwareProgress::Info(format!("STM32CubeMX: {}", path.display()))),
            None => on_event(FirmwareProgress::Info(format!(
                "STM32CubeMX: not found (download: {STM32_CUBEMX_DOWNLOAD_URL})"
            ))),
        }
    }

    match mode {
        CodegenMode::Never => {
            if verbose {
                let needed = stm32_codegen_needed(project)?;
                if needed {
                    on_event(FirmwareProgress::Info(
                        "Skipping STM32CubeMX code generation (`--codegen never`).".into(),
                    ));
                } else {
                    on_event(FirmwareProgress::Info(
                        "Skipping STM32CubeMX code generation (`--codegen never`, not needed).".into(),
                    ));
                }
            }
            Ok(())
        }
        CodegenMode::Always => {
            if verbose {
                on_event(FirmwareProgress::Info(
                    "Running STM32CubeMX code generation (`--codegen always`).".into(),
                ));
            }
            match find_cubemx_optional()? {
                Some(cubemx) => stm32_codegen_with_streaming(&cubemx, project, on_event),
                None => bail!(
                    "STM32CubeMX not found (required by `--codegen always`). Install it from {STM32_CUBEMX_DOWNLOAD_URL} or set EMWAVER_CUBEMX=/path/to/STM32CubeMX"
                ),
            }
        }
        CodegenMode::Auto => {
            if stm32_codegen_needed(project)? {
                match find_cubemx_optional()? {
                    Some(cubemx) => {
                        if verbose {
                            on_event(FirmwareProgress::Info(format!(
                                "Running STM32CubeMX code generation (project `.ioc` appears newer): {}",
                                cubemx.display()
                            )));
                        }
                        stm32_codegen_with_streaming(&cubemx, project, on_event)
                    }
                    None => {
                        on_event(FirmwareProgress::Info(format!(
                            "warning: STM32CubeMX not found; continuing without regeneration (download: {STM32_CUBEMX_DOWNLOAD_URL}, or pass `--codegen always` to require it)."
                        )));
                        Ok(())
                    }
                }
            } else {
                if verbose {
                    on_event(FirmwareProgress::Info(
                        "Skipping STM32CubeMX code generation (generated sources appear up-to-date).".into(),
                    ));
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

fn stm32_codegen_with_streaming(
    cubemx: &Path,
    project: &Path,
    on_event: &mut dyn FnMut(FirmwareProgress),
) -> Result<()> {
    let ioc = find_single_ioc(project)?
        .canonicalize()
        .with_context(|| "failed to resolve `.ioc` path")?;

    let mut script = NamedTempFile::new().context("failed to create CubeMX script file")?;
    script
        .write_all(
            format!(
                "config load {ioc}\nproject generate\nexit\n",
                ioc = ioc.display()
            )
            .as_bytes(),
        )
        .context("failed to write CubeMX script")?;
    let _ = script.flush();

    let mut cmd = Command::new(cubemx);
    cmd.arg("-q")
        .arg(script.path())
        .current_dir(project)
        .stdin(Stdio::null());

    let status =
        run_command_streaming(&mut cmd, on_event, Some("STM32CubeMX".into()))
            .context("failed to run STM32CubeMX")?;
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

fn stm32_build_and_export_bin_streaming(
    project: &Path,
    verbose: bool,
    on_event: &mut dyn FnMut(FirmwareProgress),
) -> Result<PathBuf> {
    let env = stm32_build_env()?;
    let jobs = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let release = project.join("Release");

    if verbose {
        if let Some(gcc) = resolve_in_env_path("arm-none-eabi-gcc", &env) {
            on_event(FirmwareProgress::Info(format!("Using ARM toolchain: {}", gcc.display())));
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
                on_event(FirmwareProgress::Info(format!("nano.specs: {spec}")));
            }
        }
    }

    let mut make = Command::new("make");
    make.arg("-C")
        .arg(&release)
        .arg(format!("-j{jobs}"))
        .arg("all")
        .envs(env.clone())
        .stdin(Stdio::null());
    let status = run_command_streaming(
        &mut make,
        on_event,
        Some(format!("make -C {}", release.display())),
    )
    .with_context(|| format!("failed to run `make -C {}`", release.display()))?;
    if !status.success() {
        bail!("`make -C {}` exited with {status}", release.display());
    }

    let elf = find_single_elf(&release)?;
    let bin = elf.with_extension("bin");

    let mut objcopy = Command::new("arm-none-eabi-objcopy");
    objcopy
        .arg("-O")
        .arg("binary")
        .arg(&elf)
        .arg(&bin)
        .envs(env)
        .stdin(Stdio::null());
    let status = run_command_streaming(&mut objcopy, on_event, Some("arm-none-eabi-objcopy".into()))
        .context("failed to run `arm-none-eabi-objcopy`")?;
    if !status.success() {
        bail!("`arm-none-eabi-objcopy` exited with {status}");
    }

    on_event(FirmwareProgress::Info(format!("Exported: {}", bin.display())));
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
        for candidate in binary_candidates_in_dir(&dir, binary) {
            if candidate.is_file() {
                return Some(candidate);
            }
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

    if try_install_arm_toolchain_interactive()? {
        if toolchain_ok().unwrap_or(false) {
            return Ok(Vec::new());
        }
    }

    bail!(
        "missing/invalid ARM toolchain: expected `arm-none-eabi-gcc` + `arm-none-eabi-objcopy` (with `nano.specs`) on PATH.\n\
Options:\n\
- Install STM32CubeIDE (its bundled toolchain is auto-detected), or\n\
- Set EMWAVER_ARM_TOOLCHAIN_BIN=/path/to/toolchain/bin, or\n\
- Install Arm GNU Toolchain from {ARM_GNU_TOOLCHAIN_DOWNLOAD_URL}"
    )
}

fn try_install_arm_toolchain_interactive() -> Result<bool> {
    if !io::stdin().is_terminal() {
        return Ok(false);
    }

    eprintln!(
        "ARM toolchain missing or incomplete (needs `nano.specs`).\n\
Install it now?"
    );

    let prompt = match host_platform() {
        HostPlatform::Macos => "Install ARM GNU toolchain via Homebrew? [Y/n] ",
        HostPlatform::Linux => "Install ARM GNU toolchain via your package manager? [Y/n] ",
        HostPlatform::Windows => "Install ARM GNU toolchain via a Windows package manager? [Y/n] ",
        HostPlatform::Other => "Install ARM GNU toolchain now? [Y/n] ",
    };

    if !prompt_yes_no(prompt, true)? {
        return Ok(false);
    }

    match host_platform() {
        HostPlatform::Macos => try_install_arm_toolchain_macos(),
        HostPlatform::Linux => try_install_arm_toolchain_linux(),
        HostPlatform::Windows => try_install_arm_toolchain_windows(),
        HostPlatform::Other => {
            eprintln!("Automatic installation is not supported on this platform. Download: {ARM_GNU_TOOLCHAIN_DOWNLOAD_URL}");
            Ok(false)
        }
    }
}

fn run_cmd(program: &str, args: &[&str]) -> Result<std::process::ExitStatus> {
    Command::new(program)
        .args(args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .with_context(|| format!("failed to run `{}`", std::iter::once(program).chain(args.iter().copied()).collect::<Vec<_>>().join(" ")))
}

fn try_install_arm_toolchain_macos() -> Result<bool> {
    if which("brew").is_err() {
        eprintln!("Homebrew not found. Download: {ARM_GNU_TOOLCHAIN_DOWNLOAD_URL} (or install STM32CubeIDE).");
        return Ok(false);
    }

    let attempts: &[(&[&str], &str)] = &[
        (&["install", "arm-none-eabi-gcc"], "brew install arm-none-eabi-gcc"),
        (
            &["install", "--cask", "gcc-arm-embedded"],
            "brew install --cask gcc-arm-embedded",
        ),
    ];

    for (args, label) in attempts {
        eprintln!("Running `{label}`...");
        let status = run_cmd("brew", args)?;

        if status.success() {
            return Ok(true);
        }
    }

    eprintln!("Toolchain install via Homebrew failed. Install manually from {ARM_GNU_TOOLCHAIN_DOWNLOAD_URL} or install STM32CubeIDE.");
    Ok(false)
}

fn try_install_arm_toolchain_linux() -> Result<bool> {
    let has_sudo = which("sudo").is_ok();

    if which("apt-get").is_ok() {
        if has_sudo {
            eprintln!("Running `sudo apt-get update`...");
            let _ = run_cmd("sudo", &["apt-get", "update"]);
            eprintln!("Running `sudo apt-get install -y gcc-arm-none-eabi`...");
            let status = run_cmd("sudo", &["apt-get", "install", "-y", "gcc-arm-none-eabi"])?;
            return Ok(status.success());
        }
        eprintln!("Running `apt-get update`...");
        let _ = run_cmd("apt-get", &["update"]);
        eprintln!("Running `apt-get install -y gcc-arm-none-eabi`...");
        let status = run_cmd("apt-get", &["install", "-y", "gcc-arm-none-eabi"])?;
        return Ok(status.success());
    }

    if which("dnf").is_ok() {
        eprintln!(
            "dnf detected but package naming varies by distro.\n\
Install manually (download: {ARM_GNU_TOOLCHAIN_DOWNLOAD_URL}) or install STM32CubeIDE."
        );
        return Ok(false);
    }

    if which("pacman").is_ok() {
        if has_sudo {
            eprintln!("Running `sudo pacman -Sy --noconfirm arm-none-eabi-gcc arm-none-eabi-binutils`...");
            let status = run_cmd(
                "sudo",
                &[
                    "pacman",
                    "-Sy",
                    "--noconfirm",
                    "arm-none-eabi-gcc",
                    "arm-none-eabi-binutils",
                ],
            )?;
            return Ok(status.success());
        }
        eprintln!("Running `pacman -Sy --noconfirm arm-none-eabi-gcc arm-none-eabi-binutils`...");
        let status = run_cmd(
            "pacman",
            &[
                "-Sy",
                "--noconfirm",
                "arm-none-eabi-gcc",
                "arm-none-eabi-binutils",
            ],
        )?;
        return Ok(status.success());
    }

    eprintln!(
        "No supported Linux package manager detected.\n\
Download: {ARM_GNU_TOOLCHAIN_DOWNLOAD_URL} (or install STM32CubeIDE)."
    );
    Ok(false)
}

fn try_install_arm_toolchain_windows() -> Result<bool> {
    if which("winget").is_ok() {
        eprintln!("Running `winget install Arm.GnuArmEmbeddedToolchain`...");
        let status = run_cmd("winget", &["install", "Arm.GnuArmEmbeddedToolchain"])?;
        if status.success() {
            return Ok(true);
        }
    }

    if which("choco").is_ok() {
        eprintln!("Running `choco install gcc-arm-embedded -y`...");
        let status = run_cmd("choco", &["install", "gcc-arm-embedded", "-y"])?;
        if status.success() {
            return Ok(true);
        }
    }

    if which("scoop").is_ok() {
        eprintln!("Running `scoop install gcc-arm-none-eabi`...");
        let status = run_cmd("scoop", &["install", "gcc-arm-none-eabi"])?;
        if status.success() {
            return Ok(true);
        }
    }

    eprintln!("No supported Windows package manager found. Download: {ARM_GNU_TOOLCHAIN_DOWNLOAD_URL} (or install STM32CubeIDE).");
    Ok(false)
}

fn prompt_yes_no(prompt: &str, default_yes: bool) -> Result<bool> {
    loop {
        eprint!("{prompt}");
        let _ = io::stderr().flush();

        let mut input = String::new();
        io::stdin()
            .read_line(&mut input)
            .context("failed to read user input")?;

        let trimmed = input.trim();
        if trimmed.is_empty() {
            return Ok(default_yes);
        }

        match trimmed.to_ascii_lowercase().as_str() {
            "y" | "yes" => return Ok(true),
            "n" | "no" => return Ok(false),
            _ => eprintln!(
                "Please answer y/n (default: {}).",
                if default_yes { "y" } else { "n" }
            ),
        }
    }
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
        for candidate in binary_candidates_in_dir(&dir, binary) {
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    bail!("`{binary}` not found on PATH")
}

fn binary_candidates_in_dir(dir: &Path, binary: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    out.push(dir.join(binary));

    if host_platform() == HostPlatform::Windows && !binary.contains('.') {
        if let Some(pathext) = env::var_os("PATHEXT") {
            let pathext = pathext.to_string_lossy();
            for ext in pathext.split(';').map(str::trim).filter(|s| !s.is_empty()) {
                out.push(dir.join(format!("{binary}{ext}")));
            }
        } else {
            out.push(dir.join(format!("{binary}.exe")));
            out.push(dir.join(format!("{binary}.cmd")));
            out.push(dir.join(format!("{binary}.bat")));
        }
    }

    out
}
