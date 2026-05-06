use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use directories::ProjectDirs;
use emwaver_device::{list_ble_devices, BleDevice, Device};
use emwaver_runtime::{CommandBridge, Engine, SimulatorCommandBridge};
use nix::sys::signal::kill;
use nix::unistd::Pid;
use std::fs;
use std::fs::OpenOptions;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tracing::info;
use tungstenite::{connect, stream::MaybeTlsStream, Message};
use url::Url;

#[derive(Parser, Debug)]
#[command(name = "emwaver", about = "EMWaver headless host daemon CLI (beta)")]
struct Cli {
    #[command(subcommand)]
    cmd: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Start the local Linux-friendly gateway + daemon stack.
    Start {
        /// Local gateway port (defaults to 3921).
        #[arg(long)]
        port: Option<u16>,

        /// MIDI input port id from `emwaver devices` for daemon hardware mode.
        #[arg(long)]
        device: Option<String>,

        /// Use ESP32 BLE transport instead of USB MIDI/SysEx for daemon hardware mode.
        #[arg(long)]
        ble: bool,

        /// Start daemon with a no-op hardware bridge for UI-only scripts.
        #[arg(long)]
        no_device: bool,

        /// Start daemon with the shared mock EMWaver device simulator.
        #[arg(long)]
        sim_device: bool,

        /// Override bootstrap script path for daemon runtime.
        #[arg(long)]
        bootstrap_path: Option<PathBuf>,
    },

    /// Manage the headless host daemon.
    Daemon {
        #[command(subcommand)]
        cmd: DaemonCmd,
    },

    /// Install/manage the local Linux user service.
    Service {
        #[command(subcommand)]
        cmd: ServiceCmd,
    },

    /// Terminal UI for daemon + device status.
    Tui,

    /// List MIDI devices and highlight likely EMWaver ports.
    Devices,

    /// Check local CLI, gateway, and device prerequisites.
    Doctor,

    /// Run a .emw script through the local gateway/native app bridge.
    Run {
        /// Script file to run.
        script: PathBuf,

        /// Display name sent with the script. Defaults to the script filename.
        #[arg(long)]
        name: Option<String>,

        /// Local gateway port (defaults to 3921).
        #[arg(long)]
        port: Option<u16>,

        /// Override gateway base or WebSocket URL.
        #[arg(long)]
        gateway_url: Option<String>,

        /// Wait this long for script.started, script.error, or host.error.
        #[arg(long, default_value_t = 5000)]
        timeout_ms: u64,

        /// Send the script and return after the gateway accepts the message.
        #[arg(long)]
        no_wait: bool,

        /// Run through the local headless Rust runtime instead of the gateway/native-app bridge.
        #[arg(long)]
        direct: bool,

        /// MIDI input port id from `emwaver devices` for direct mode.
        #[arg(long)]
        device: Option<String>,

        /// Use ESP32 BLE transport instead of USB MIDI/SysEx for direct mode.
        #[arg(long)]
        ble: bool,

        /// Run direct mode with a no-op hardware bridge for UI-only scripts.
        #[arg(long)]
        no_device: bool,

        /// Run direct mode with the shared mock EMWaver device simulator.
        #[arg(long)]
        sim_device: bool,

        /// Override bootstrap script path for direct mode.
        #[arg(long)]
        bootstrap_path: Option<PathBuf>,
    },

    /// Start the localhost browser gateway.
    Gateway {
        /// Local gateway port (defaults to 3921).
        #[arg(long)]
        port: Option<u16>,

        /// Start the daemon underneath as a fallback runtime owner.
        #[arg(long)]
        daemon_fallback: bool,

        /// MIDI input port id from `emwaver devices` for daemon fallback.
        #[arg(long)]
        device: Option<String>,

        /// Use ESP32 BLE transport instead of USB MIDI/SysEx for daemon fallback.
        #[arg(long)]
        ble: bool,

        /// Start daemon fallback with a no-op hardware bridge for UI-only scripts.
        #[arg(long)]
        no_device: bool,

        /// Start daemon fallback with the shared mock EMWaver device simulator.
        #[arg(long)]
        sim_device: bool,

        /// Override bootstrap script path for daemon fallback.
        #[arg(long)]
        bootstrap_path: Option<PathBuf>,
    },

    /// Alias for `gateway`.
    Web {
        /// Local gateway port (defaults to 3921).
        #[arg(long)]
        port: Option<u16>,

        /// Start the daemon underneath as a fallback runtime owner.
        #[arg(long)]
        daemon_fallback: bool,

        /// MIDI input port id from `emwaver devices` for daemon fallback.
        #[arg(long)]
        device: Option<String>,

        /// Use ESP32 BLE transport instead of USB MIDI/SysEx for daemon fallback.
        #[arg(long)]
        ble: bool,

        /// Start daemon fallback with a no-op hardware bridge for UI-only scripts.
        #[arg(long)]
        no_device: bool,

        /// Start daemon fallback with the shared mock EMWaver device simulator.
        #[arg(long)]
        sim_device: bool,

        /// Override bootstrap script path for daemon fallback.
        #[arg(long)]
        bootstrap_path: Option<PathBuf>,
    },

    /// Ask the paid EMWaver Agent for script help.
    Agent {
        /// Prompt to send to the Agent.
        #[arg(required = true)]
        prompt: Vec<String>,

        /// Include a local .emw script as context.
        #[arg(long)]
        script: Option<PathBuf>,

        /// Agent mode: write, debug, explain, or patch.
        #[arg(long, default_value = "write")]
        mode: String,

        /// Include a runtime error as context.
        #[arg(long)]
        error: Option<String>,

        /// Override EMWAVER_AGENT_ENDPOINT for this request.
        #[arg(long)]
        endpoint: Option<String>,
    },

    /// Show where emwaver stores state/logs.
    Paths,
}

#[derive(Subcommand, Debug)]
enum DaemonCmd {
    /// Start the local headless runtime host in the background.
    Start {
        /// Local gateway port (defaults to 3921).
        #[arg(long)]
        port: Option<u16>,

        /// Override gateway base or WebSocket URL.
        #[arg(long)]
        gateway_url: Option<String>,

        /// MIDI input port id from `emwaver devices`.
        #[arg(long)]
        device: Option<String>,

        /// Use ESP32 BLE transport instead of USB MIDI/SysEx.
        #[arg(long)]
        ble: bool,

        /// Start with a no-op hardware bridge for UI-only scripts.
        #[arg(long)]
        no_device: bool,

        /// Start with the shared mock EMWaver device simulator.
        #[arg(long)]
        sim_device: bool,

        /// Override bootstrap script path.
        #[arg(long)]
        bootstrap_path: Option<PathBuf>,
    },

    /// Run the local headless runtime host in the foreground.
    Serve {
        /// Local gateway port (defaults to 3921).
        #[arg(long)]
        port: Option<u16>,

        /// Override gateway base or WebSocket URL.
        #[arg(long)]
        gateway_url: Option<String>,

        /// MIDI input port id from `emwaver devices`.
        #[arg(long)]
        device: Option<String>,

        /// Use ESP32 BLE transport instead of USB MIDI/SysEx.
        #[arg(long)]
        ble: bool,

        /// Use a no-op hardware bridge for UI-only scripts.
        #[arg(long)]
        no_device: bool,

        /// Use the shared mock EMWaver device simulator.
        #[arg(long)]
        sim_device: bool,

        /// Override bootstrap script path.
        #[arg(long)]
        bootstrap_path: Option<PathBuf>,
    },

    /// Stop the daemon (best-effort).
    Stop,

    /// Print daemon status (running/not running) and autostart status.
    Status,

    /// Check whether autostart is configured (macOS launchd / Linux systemd).
    Autostart,
}

#[derive(Subcommand, Debug)]
enum ServiceCmd {
    /// Install a Linux systemd user service for the headless daemon host.
    Install {
        /// Local gateway port (defaults to 3921).
        #[arg(long)]
        port: Option<u16>,

        /// MIDI input port id from `emwaver devices`.
        #[arg(long)]
        device: Option<String>,

        /// Use ESP32 BLE transport instead of USB MIDI/SysEx.
        #[arg(long)]
        ble: bool,

        /// Start with a no-op hardware bridge for UI-only scripts.
        #[arg(long)]
        no_device: bool,

        /// Start with the shared mock EMWaver device simulator.
        #[arg(long)]
        sim_device: bool,

        /// Override bootstrap script path.
        #[arg(long)]
        bootstrap_path: Option<PathBuf>,

        /// Enable and start the service after writing the unit.
        #[arg(long)]
        now: bool,
    },

    /// Remove the Linux systemd user service.
    Uninstall,

    /// Print the systemd user service unit without installing it.
    PrintUnit {
        /// Local gateway port (defaults to 3921).
        #[arg(long)]
        port: Option<u16>,

        /// MIDI input port id from `emwaver devices`.
        #[arg(long)]
        device: Option<String>,

        /// Use ESP32 BLE transport instead of USB MIDI/SysEx.
        #[arg(long)]
        ble: bool,

        /// Start with a no-op hardware bridge for UI-only scripts.
        #[arg(long)]
        no_device: bool,

        /// Start with the shared mock EMWaver device simulator.
        #[arg(long)]
        sim_device: bool,

        /// Override bootstrap script path.
        #[arg(long)]
        bootstrap_path: Option<PathBuf>,
    },

    /// Start the installed user service.
    Start,

    /// Stop the installed user service.
    Stop,

    /// Show user service status.
    Status,
}

fn project_dirs() -> Result<ProjectDirs> {
    ProjectDirs::from("com", "EMWaver", "emwaver")
        .context("failed to resolve per-user data directories")
}

fn state_dir() -> Result<PathBuf> {
    if let Some(dir) = env_trim("EMWAVER_STATE_DIR") {
        let d = PathBuf::from(dir);
        fs::create_dir_all(&d)?;
        return Ok(d);
    }

    let d = project_dirs()?.data_local_dir().to_path_buf();
    fs::create_dir_all(&d)?;
    Ok(d)
}

fn pidfile_path() -> Result<PathBuf> {
    Ok(state_dir()?.join("daemon.pid"))
}

fn logfile_path() -> Result<PathBuf> {
    Ok(state_dir()?.join("daemon.log"))
}

fn read_pid(pidfile: &Path) -> Option<i32> {
    let s = fs::read_to_string(pidfile).ok()?;
    s.trim().parse::<i32>().ok()
}

fn is_running(pid: i32) -> bool {
    kill(Pid::from_raw(pid), None).is_ok()
}

fn pid_looks_like_daemon(pid: i32) -> bool {
    if cfg!(target_os = "linux") {
        let cmdline = fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
        let parts: Vec<String> = cmdline
            .split(|byte| *byte == 0)
            .filter(|part| !part.is_empty())
            .map(|part| String::from_utf8_lossy(part).to_string())
            .collect();
        if !parts.is_empty() {
            return parts.iter().any(|part| part.contains("emwaver"))
                && parts.iter().any(|part| part == "daemon")
                && parts.iter().any(|part| part == "serve");
        }
    }

    let output = Command::new("ps")
        .arg("-p")
        .arg(pid.to_string())
        .arg("-o")
        .arg("args=")
        .output();
    let Ok(output) = output else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let args = String::from_utf8_lossy(&output.stdout);
    args.contains("emwaver") && args.contains("daemon") && args.contains("serve")
}

fn daemon_running() -> Result<Option<i32>> {
    let pidfile = pidfile_path()?;
    let Some(pid) = read_pid(&pidfile) else {
        return Ok(None);
    };
    if is_running(pid) && pid_looks_like_daemon(pid) {
        Ok(Some(pid))
    } else {
        // Stale pidfile, or the OS reused the pid for an unrelated process.
        let _ = fs::remove_file(pidfile);
        Ok(None)
    }
}

fn daemon_start(
    port: Option<u16>,
    gateway_url: Option<String>,
    device: Option<String>,
    ble: bool,
    no_device: bool,
    sim_device: bool,
    bootstrap_path: Option<PathBuf>,
) -> Result<()> {
    if let Some(pid) = daemon_running()? {
        println!("daemon: already running (pid={pid})");
        return Ok(());
    }

    let exe = std::env::current_exe().context("failed to resolve current emwaver executable")?;
    let logfile = logfile_path()?;
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&logfile)
        .with_context(|| format!("failed to open daemon log at {}", logfile.display()))?;
    let stderr = stdout
        .try_clone()
        .context("failed to clone daemon log handle")?;

    let mut cmd = Command::new(exe);
    cmd.arg("daemon").arg("serve");
    if let Some(port) = port {
        cmd.arg("--port").arg(port.to_string());
    }
    if let Some(gateway_url) = gateway_url {
        cmd.arg("--gateway-url").arg(gateway_url);
    }
    if let Some(device) = device {
        cmd.arg("--device").arg(device);
    }
    if ble {
        cmd.arg("--ble");
    }
    if no_device {
        cmd.arg("--no-device");
    }
    if sim_device {
        cmd.arg("--sim-device");
    }
    if let Some(bootstrap_path) = bootstrap_path {
        cmd.arg("--bootstrap-path").arg(bootstrap_path);
    }

    let child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .context("failed to spawn daemon host process")?;

    let pid = child.id();
    fs::write(pidfile_path()?, pid.to_string())?;
    println!("daemon: started (pid={pid})");
    println!("logfile: {}", logfile.display());
    Ok(())
}

fn start_local_stack(
    port: Option<u16>,
    device: Option<String>,
    ble: bool,
    no_device: bool,
    sim_device: bool,
    bootstrap_path: Option<PathBuf>,
) -> Result<()> {
    let had_daemon = daemon_running()?.is_some();
    daemon_start(
        port,
        None,
        device,
        ble,
        no_device,
        sim_device,
        bootstrap_path,
    )?;

    let gateway_result = start_gateway(port);
    if !had_daemon {
        if let Err(err) = daemon_stop() {
            eprintln!("warning: failed to stop daemon started by `emwaver start`: {err:#}");
        }
    }

    gateway_result
}

fn daemon_stop() -> Result<()> {
    let pidfile = pidfile_path()?;
    let Some(pid) = read_pid(&pidfile) else {
        info!("daemon not running");
        return Ok(());
    };

    if !is_running(pid) {
        let _ = fs::remove_file(pidfile);
        info!("daemon not running (stale pidfile removed)");
        return Ok(());
    }

    // Best-effort SIGTERM.
    kill(Pid::from_raw(pid), nix::sys::signal::Signal::SIGTERM)
        .with_context(|| format!("failed to SIGTERM pid={pid}"))?;

    // pidfile cleanup is best-effort; the process may take a moment to exit.
    info!("sent SIGTERM to pid={pid}");
    Ok(())
}

fn autostart_status() -> Result<String> {
    // Minimal, non-invasive checks.
    // macOS: check LaunchAgents plist presence.
    // Linux: check systemd unit presence.

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let plist = PathBuf::from(home)
            .join("Library/LaunchAgents")
            .join("com.emwaver.daemon.plist");
        if plist.exists() {
            return Ok(format!(
                "autostart: configured (launchd plist exists: {})",
                plist.display()
            ));
        }
        return Ok("autostart: not configured (no launchd plist)".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        let user_unit = systemd_user_unit_path();
        if user_unit.exists() {
            return Ok(format!(
                "autostart: configured (systemd user unit exists: {})",
                user_unit.display()
            ));
        }
        let unit1 = PathBuf::from("/etc/systemd/system/emwaver.service");
        let unit2 = PathBuf::from("/lib/systemd/system/emwaver.service");
        if unit1.exists() || unit2.exists() {
            return Ok("autostart: configured (systemd unit exists)".to_string());
        }
        return Ok("autostart: not configured (no systemd unit)".to_string());
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Ok("autostart: unknown (unsupported OS)".to_string())
    }
}

#[cfg(target_os = "linux")]
fn systemd_user_unit_path() -> PathBuf {
    let base = env_trim("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| env_trim("HOME").map(|home| PathBuf::from(home).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("systemd")
        .join("user")
        .join("emwaver-daemon.service")
}

fn systemctl_user(args: &[&str]) -> Result<()> {
    let status = Command::new("systemctl")
        .arg("--user")
        .args(args)
        .status()
        .with_context(|| format!("failed to run systemctl --user {}", args.join(" ")))?;
    if !status.success() {
        anyhow::bail!(
            "systemctl --user {} exited with status {status}",
            args.join(" ")
        );
    }
    Ok(())
}

fn validate_service_transport_flags(
    device: Option<&str>,
    ble: bool,
    no_device: bool,
    sim_device: bool,
) -> Result<()> {
    if ble && device.is_some() {
        anyhow::bail!("--device cannot be combined with --ble");
    }
    if ble && no_device {
        anyhow::bail!("--ble cannot be combined with --no-device");
    }
    if ble && sim_device {
        anyhow::bail!("--ble cannot be combined with --sim-device");
    }
    if no_device && sim_device {
        anyhow::bail!("--no-device cannot be combined with --sim-device");
    }
    if no_device && device.is_some() {
        anyhow::bail!("--device cannot be combined with --no-device");
    }
    if sim_device && device.is_some() {
        anyhow::bail!("--device cannot be combined with --sim-device");
    }
    Ok(())
}

fn service_unit(
    exe: &Path,
    port: Option<u16>,
    device: Option<String>,
    ble: bool,
    no_device: bool,
    sim_device: bool,
    bootstrap_path: Option<PathBuf>,
) -> Result<String> {
    validate_service_transport_flags(device.as_deref(), ble, no_device, sim_device)?;

    let mut exec_args = vec![
        shell_escape(&exe.display().to_string()),
        "daemon".to_string(),
        "serve".to_string(),
    ];
    if let Some(port) = port {
        exec_args.push("--port".to_string());
        exec_args.push(port.to_string());
    }
    if let Some(device) = device {
        exec_args.push("--device".to_string());
        exec_args.push(shell_escape(&device));
    }
    if ble {
        exec_args.push("--ble".to_string());
    }
    if no_device {
        exec_args.push("--no-device".to_string());
    }
    if sim_device {
        exec_args.push("--sim-device".to_string());
    }
    if let Some(bootstrap_path) = bootstrap_path {
        exec_args.push("--bootstrap-path".to_string());
        exec_args.push(shell_escape(&bootstrap_path.display().to_string()));
    }

    Ok(format!(
        r#"[Unit]
Description=EMWaver local daemon host
After=bluetooth.target sound.target

[Service]
Type=simple
ExecStart={}
Restart=on-failure
RestartSec=2
Environment=RUST_LOG=info

[Install]
WantedBy=default.target
"#,
        exec_args.join(" ")
    ))
}

fn service_install(
    port: Option<u16>,
    device: Option<String>,
    ble: bool,
    no_device: bool,
    sim_device: bool,
    bootstrap_path: Option<PathBuf>,
    now: bool,
) -> Result<()> {
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (
            port,
            device,
            ble,
            no_device,
            sim_device,
            bootstrap_path,
            now,
        );
        anyhow::bail!(
            "`emwaver service install` currently supports Linux systemd user services only"
        );
    }

    #[cfg(target_os = "linux")]
    {
        let exe =
            std::env::current_exe().context("failed to resolve current emwaver executable")?;
        let unit_path = systemd_user_unit_path();
        if let Some(parent) = unit_path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }

        let unit = service_unit(
            &exe,
            port,
            device,
            ble,
            no_device,
            sim_device,
            bootstrap_path,
        )?;

        fs::write(&unit_path, unit)
            .with_context(|| format!("failed to write {}", unit_path.display()))?;
        println!("installed systemd user unit: {}", unit_path.display());
        systemctl_user(&["daemon-reload"])?;
        systemctl_user(&["enable", "emwaver-daemon.service"])?;
        if now {
            systemctl_user(&["restart", "emwaver-daemon.service"])?;
        }
        println!("service installed. Start with: systemctl --user start emwaver-daemon.service");
        println!("gateway still runs separately with: emwaver gateway");
        Ok(())
    }
}

fn service_uninstall() -> Result<()> {
    #[cfg(not(target_os = "linux"))]
    {
        anyhow::bail!(
            "`emwaver service uninstall` currently supports Linux systemd user services only"
        );
    }

    #[cfg(target_os = "linux")]
    {
        let _ = systemctl_user(&["disable", "--now", "emwaver-daemon.service"]);
        let unit_path = systemd_user_unit_path();
        if unit_path.exists() {
            fs::remove_file(&unit_path)
                .with_context(|| format!("failed to remove {}", unit_path.display()))?;
            println!("removed {}", unit_path.display());
        } else {
            println!("service unit not present: {}", unit_path.display());
        }
        systemctl_user(&["daemon-reload"])?;
        Ok(())
    }
}

fn service_status() -> Result<()> {
    systemctl_user(&["status", "emwaver-daemon.service"])
}

fn shell_escape(value: &str) -> String {
    if value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "/._:-".contains(c))
    {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

fn list_devices_lines() -> Result<Vec<String>> {
    let devices = emwaver_device::list_devices()?;
    let mut out: Vec<String> = Vec::new();
    if devices.is_empty() {
        out.push("No MIDI input ports found.".to_string());
    } else {
        out.push("MIDI input ports:".to_string());
        for device in devices {
            let hint = if device.likely_emwaver {
                "  <— likely EMWaver"
            } else {
                ""
            };
            out.push(format!("  {}: {}{hint}", device.id, device.name));
        }
    }

    match list_ble_devices(1_500) {
        Ok(devices) if devices.is_empty() => out.push("No EMWaver BLE devices found.".to_string()),
        Ok(devices) => {
            out.push("BLE devices:".to_string());
            for device in devices {
                out.push(format!(
                    "  {}: {} ({})",
                    device.id, device.name, device.address
                ));
            }
        }
        Err(err) => out.push(format!("BLE scan unavailable: {err:#}")),
    }

    Ok(out)
}

fn list_devices() -> Result<()> {
    for line in list_devices_lines()? {
        println!("{line}");
    }
    Ok(())
}

fn command_available(name: &str) -> bool {
    Command::new(name)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn doctor() -> Result<()> {
    let mut issues = 0usize;
    let allow_midi_unavailable =
        env_trim("EMWAVER_DOCTOR_ALLOW_MIDI_UNAVAILABLE").as_deref() == Some("1");

    println!("EMWaver doctor");
    println!(
        "platform: {} {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );

    let root = repo_root();
    println!("repo root: {}", root.display());
    println!("state dir: {}", state_dir()?.display());
    println!("pidfile: {}", pidfile_path()?.display());
    println!("logfile: {}", logfile_path()?.display());
    println!("{}", autostart_status()?);

    let gateway = gateway_dir();
    if gateway.join("package.json").exists() {
        println!("ok: gateway package found at {}", gateway.display());
    } else {
        issues += 1;
        println!("missing: gateway package at {}", gateway.display());
    }

    if command_available("node") {
        println!("ok: node is available");
    } else {
        issues += 1;
        println!("missing: node");
    }

    if command_available("npm") {
        println!("ok: npm is available");
    } else {
        issues += 1;
        println!("missing: npm");
    }

    if command_available("cargo") {
        println!("ok: cargo is available");
    } else {
        issues += 1;
        println!("missing: cargo");
    }

    if command_available("rustc") {
        println!("ok: rustc is available");
    } else {
        issues += 1;
        println!("missing: rustc");
    }

    match list_devices_lines() {
        Ok(lines) => {
            for line in lines {
                println!("{line}");
            }
        }
        Err(err) => {
            if allow_midi_unavailable {
                println!("device check skipped: {err:#}");
            } else {
                issues += 1;
                println!("device check failed: {err:#}");
            }
        }
    }

    if issues == 0 {
        println!("doctor: ok");
        Ok(())
    } else {
        anyhow::bail!("doctor found {issues} issue(s)")
    }
}

fn gateway_ws_url(port: Option<u16>, gateway_url: Option<String>) -> Result<Url> {
    if let Some(raw) = gateway_url {
        let mut url =
            Url::parse(raw.trim()).with_context(|| format!("invalid gateway URL: {raw}"))?;

        match url.scheme() {
            "http" => {
                url.set_scheme("ws").ok();
            }
            "https" => {
                url.set_scheme("wss").ok();
            }
            "ws" | "wss" => {}
            other => anyhow::bail!("unsupported gateway URL scheme: {other}"),
        }

        if url.path() == "/" || url.path().is_empty() {
            url.set_path("/v1/ws");
        }

        return Ok(url);
    }

    let port_value = port.unwrap_or(3921);
    Url::parse(&format!("ws://127.0.0.1:{port_value}/v1/ws"))
        .context("failed to build localhost gateway WebSocket URL")
}

fn script_name(script: &Path, explicit_name: Option<String>) -> String {
    explicit_name
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            script
                .file_name()
                .and_then(|s| s.to_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "script.emw".to_string())
}

struct DeviceCommandBridge {
    device: Arc<Device>,
}

impl CommandBridge for DeviceCommandBridge {
    fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>> {
        self.device.send_command(cmd_lane, timeout_ms)
    }

    fn get_buffer(&self) -> Vec<u8> {
        self.device.get_buffer()
    }

    fn clear_buffer(&self) {
        self.device.clear_buffer();
    }
}

struct BleCommandBridge {
    device: Arc<BleDevice>,
}

impl CommandBridge for BleCommandBridge {
    fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>> {
        self.device.send_command(cmd_lane, timeout_ms)
    }

    fn get_buffer(&self) -> Vec<u8> {
        self.device.get_buffer()
    }

    fn clear_buffer(&self) {
        self.device.clear_buffer();
    }
}

struct NoDeviceCommandBridge;

impl CommandBridge for NoDeviceCommandBridge {
    fn send_command(&self, _cmd_lane: &[u8], _timeout_ms: u64) -> Result<Option<Vec<u8>>> {
        anyhow::bail!("hardware bridge is disabled")
    }
}

fn run_script(
    script: PathBuf,
    name: Option<String>,
    port: Option<u16>,
    gateway_url: Option<String>,
    timeout_ms: u64,
    no_wait: bool,
    direct: bool,
    device: Option<String>,
    ble: bool,
    no_device: bool,
    sim_device: bool,
    bootstrap_path: Option<PathBuf>,
) -> Result<()> {
    let source = fs::read_to_string(&script)
        .with_context(|| format!("failed to read script at {}", script.display()))?;
    if source.trim().is_empty() {
        anyhow::bail!("script is empty: {}", script.display());
    }

    let name = script_name(&script, name);
    if direct {
        return run_script_direct(
            source,
            name,
            device,
            ble,
            no_device,
            sim_device,
            bootstrap_path,
        );
    }
    if device.is_some() {
        anyhow::bail!("--device is only supported with --direct for now");
    }
    if no_device {
        anyhow::bail!("--no-device is only supported with --direct");
    }
    if sim_device {
        anyhow::bail!("--sim-device is only supported with --direct");
    }
    if bootstrap_path.is_some() {
        anyhow::bail!("--bootstrap-path is only supported with --direct");
    }

    let url = gateway_ws_url(port, gateway_url)?;
    let (mut ws, _response) = connect(url.as_str())
        .with_context(|| format!("failed to connect to local gateway at {url}"))?;

    let timeout = Duration::from_millis(timeout_ms.max(1));
    if let MaybeTlsStream::Plain(stream) = ws.get_mut() {
        stream
            .set_read_timeout(Some(timeout))
            .context("failed to set gateway read timeout")?;
    }

    ws.send(Message::Text(
        serde_json::json!({
            "type": "hello",
            "role": "web",
            "protocolVersion": 1,
        })
        .to_string(),
    ))
    .context("failed to send gateway hello")?;

    loop {
        let msg = ws.read().context("failed waiting for gateway hello.ack")?;
        let Message::Text(text) = msg else {
            continue;
        };
        let value: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        if value.get("type").and_then(|v| v.as_str()) == Some("hello.ack") {
            break;
        }
    }

    ws.send(Message::Text(
        serde_json::json!({
            "type": "script.run",
            "name": name,
            "source": source,
        })
        .to_string(),
    ))
    .context("failed to send script.run")?;

    if no_wait {
        println!("sent {name} to {url}");
        return Ok(());
    }

    loop {
        let msg = match ws.read() {
            Ok(msg) => msg,
            Err(err) => anyhow::bail!("timed out waiting for script result from gateway: {err}"),
        };
        let Message::Text(text) = msg else {
            continue;
        };
        let value: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        let msg_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match msg_type {
            "script.started" => {
                println!("started {name}");
                return Ok(());
            }
            "script.error" | "host.error" => {
                let error = value
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown_error");
                anyhow::bail!("{msg_type}: {error}");
            }
            _ => {}
        }
    }
}

fn run_script_direct(
    source: String,
    name: String,
    device_id: Option<String>,
    ble: bool,
    no_device: bool,
    sim_device: bool,
    bootstrap_path: Option<PathBuf>,
) -> Result<()> {
    if no_device && device_id.is_some() {
        anyhow::bail!("--device cannot be combined with --no-device");
    }
    if sim_device && device_id.is_some() {
        anyhow::bail!("--device cannot be combined with --sim-device");
    }
    if sim_device && no_device {
        anyhow::bail!("--no-device cannot be combined with --sim-device");
    }

    let bootstrap_path = bootstrap_path.unwrap_or_else(default_bootstrap_path);
    let bootstrap = fs::read_to_string(&bootstrap_path)
        .with_context(|| format!("failed to read bootstrap at {}", bootstrap_path.display()))?;

    let bridge = make_command_bridge(device_id, ble, no_device, sim_device)?;

    let engine = Engine::new(&bootstrap, bridge)?;
    engine.run_script(&source)?;

    println!("ran {name} directly");
    if let Some(root) = engine.latest_tree.lock().unwrap().clone() {
        let snapshot = serde_json::json!({
            "type": "ui.snapshot",
            "scriptInstanceId": name,
            "root": root,
            "metadata": engine.latest_metadata.lock().unwrap().clone(),
        });
        println!("{}", serde_json::to_string(&snapshot)?);
    }

    Ok(())
}

fn make_command_bridge(
    device_id: Option<String>,
    ble: bool,
    no_device: bool,
    sim_device: bool,
) -> Result<Arc<dyn CommandBridge>> {
    if no_device && device_id.is_some() {
        anyhow::bail!("--device cannot be combined with --no-device");
    }
    if sim_device && device_id.is_some() {
        anyhow::bail!("--device cannot be combined with --sim-device");
    }
    if sim_device && no_device {
        anyhow::bail!("--no-device cannot be combined with --sim-device");
    }
    if ble && device_id.is_some() {
        anyhow::bail!("--device cannot be combined with --ble");
    }
    if ble && no_device {
        anyhow::bail!("--ble cannot be combined with --no-device");
    }
    if ble && sim_device {
        anyhow::bail!("--ble cannot be combined with --sim-device");
    }

    if no_device {
        Ok(Arc::new(NoDeviceCommandBridge))
    } else if sim_device {
        Ok(Arc::new(SimulatorCommandBridge::basic_board()?))
    } else if ble {
        Ok(Arc::new(BleCommandBridge {
            device: BleDevice::connect_auto(5_000)?,
        }))
    } else {
        let device = Device::new();
        if let Some(device_id) = device_id {
            device.connect_by_id(&device_id)?;
        } else {
            device.connect_auto()?;
        }
        Ok(Arc::new(DeviceCommandBridge { device }))
    }
}

fn daemon_serve(
    port: Option<u16>,
    gateway_url: Option<String>,
    device_id: Option<String>,
    ble: bool,
    no_device: bool,
    sim_device: bool,
    bootstrap_path: Option<PathBuf>,
) -> Result<()> {
    if let Some(parent) = pidfile_path()?.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(pidfile_path()?, std::process::id().to_string())?;

    let bootstrap_path = bootstrap_path.unwrap_or_else(default_bootstrap_path);
    let bootstrap = fs::read_to_string(&bootstrap_path)
        .with_context(|| format!("failed to read bootstrap at {}", bootstrap_path.display()))?;
    let bridge = make_command_bridge(device_id, ble, no_device, sim_device)?;
    let url = gateway_ws_url(port, gateway_url)?;

    println!("daemon host connecting to {url}");
    loop {
        match daemon_host_session(url.as_str(), &bootstrap, bridge.clone()) {
            Ok(()) => println!("gateway session ended; reconnecting"),
            Err(err) => println!("gateway session failed: {err:#}; reconnecting"),
        }
        thread::sleep(Duration::from_secs(1));
    }
}

fn daemon_host_session(url: &str, bootstrap: &str, bridge: Arc<dyn CommandBridge>) -> Result<()> {
    let (mut ws, _response) =
        connect(url).with_context(|| format!("failed to connect to local gateway at {url}"))?;
    if let MaybeTlsStream::Plain(stream) = ws.get_mut() {
        stream
            .set_read_timeout(Some(Duration::from_millis(20)))
            .context("failed to set daemon host read timeout")?;
    }

    ws.send(Message::Text(
        serde_json::json!({
            "type": "hello",
            "role": "host",
            "protocolVersion": 1,
        })
        .to_string(),
    ))
    .context("failed to send daemon host hello")?;

    send_host_device_status(&mut ws, true)?;

    let mut active_engine: Option<Engine> = None;
    let mut active_script_id: Option<String> = None;
    let mut rev: u64 = 0;

    loop {
        let msg = match ws.read() {
            Ok(msg) => msg,
            Err(tungstenite::Error::Io(err))
                if matches!(err.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) =>
            {
                if let (Some(engine), Some(script_id)) =
                    (active_engine.as_ref(), active_script_id.as_deref())
                {
                    if pump_engine_timers(&mut ws, engine, script_id, &mut rev)? > 0 {
                        continue;
                    }
                }
                continue;
            }
            Err(err) => return Err(err).context("failed reading gateway host message"),
        };
        let Message::Text(text) = msg else {
            continue;
        };
        let value: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        let msg_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match msg_type {
            "hello.ack" => {}
            "script.run" => {
                let source = value
                    .get("source")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let name = value
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("script.emw")
                    .to_string();
                let script_id = format!("local-{}", std::process::id());
                active_engine = None;
                active_script_id = Some(script_id.clone());
                rev = 0;

                let result = (|| -> Result<Engine> {
                    if source.trim().is_empty() {
                        anyhow::bail!("script source is empty");
                    }
                    let engine = Engine::new(bootstrap, bridge.clone())?;
                    engine.run_script(&source)?;
                    Ok(engine)
                })();

                match result {
                    Ok(engine) => {
                        ws.send(Message::Text(
                            serde_json::json!({
                                "type": "script.started",
                                "hostSessionId": "local",
                                "scriptInstanceId": script_id,
                                "name": name,
                            })
                            .to_string(),
                        ))?;
                        rev += 1;
                        send_ui_snapshot(
                            &mut ws,
                            &engine,
                            active_script_id.as_deref().unwrap(),
                            rev,
                        )?;
                        active_engine = Some(engine);
                    }
                    Err(err) => {
                        ws.send(Message::Text(
                            serde_json::json!({
                                "type": "script.error",
                                "hostSessionId": "local",
                                "error": err.to_string(),
                            })
                            .to_string(),
                        ))?;
                    }
                }
            }
            "script.stop" => {
                let script_id = active_script_id
                    .take()
                    .unwrap_or_else(|| "local".to_string());
                active_engine = None;
                ws.send(Message::Text(
                    serde_json::json!({
                        "type": "script.stopped",
                        "hostSessionId": "local",
                        "scriptInstanceId": script_id,
                        "reason": "stopped",
                    })
                    .to_string(),
                ))?;
            }
            "ui.event" => {
                let Some(engine) = active_engine.as_ref() else {
                    continue;
                };
                let Some(script_id) = active_script_id.as_deref() else {
                    continue;
                };
                match dispatch_gateway_ui_event(engine, &value) {
                    Ok(()) => {
                        rev += 1;
                        send_ui_snapshot(&mut ws, engine, script_id, rev)?;
                    }
                    Err(err) => {
                        ws.send(Message::Text(
                            serde_json::json!({
                                "type": "script.error",
                                "hostSessionId": "local",
                                "scriptInstanceId": script_id,
                                "error": err.to_string(),
                            })
                            .to_string(),
                        ))?;
                    }
                }
            }
            _ => {}
        }

        if let (Some(engine), Some(script_id)) =
            (active_engine.as_ref(), active_script_id.as_deref())
        {
            pump_engine_timers(&mut ws, engine, script_id, &mut rev)?;
        }
    }
}

fn pump_engine_timers(
    ws: &mut tungstenite::WebSocket<MaybeTlsStream<std::net::TcpStream>>,
    engine: &Engine,
    script_id: &str,
    rev: &mut u64,
) -> Result<usize> {
    let ran = engine.pump_due_timers(32)?;
    if ran > 0 {
        *rev += 1;
        send_ui_snapshot(ws, engine, script_id, *rev)?;
    }
    Ok(ran)
}

fn send_host_device_status(
    ws: &mut tungstenite::WebSocket<MaybeTlsStream<std::net::TcpStream>>,
    connected: bool,
) -> Result<()> {
    ws.send(Message::Text(
        serde_json::json!({
            "type": "device.status",
            "hostSessionId": "local",
            "connected": connected,
            "runtimeOwner": "emwaver-daemon",
            "devices": [{
                "id": "local-daemon",
                "name": "EMWaver daemon",
                "connected": connected,
            }],
        })
        .to_string(),
    ))?;
    Ok(())
}

fn send_ui_snapshot(
    ws: &mut tungstenite::WebSocket<MaybeTlsStream<std::net::TcpStream>>,
    engine: &Engine,
    script_id: &str,
    rev: u64,
) -> Result<()> {
    let root = engine.latest_tree.lock().unwrap().clone();
    let metadata = engine.latest_metadata.lock().unwrap().clone();
    ws.send(Message::Text(
        serde_json::json!({
            "type": "ui.snapshot",
            "hostSessionId": "local",
            "scriptInstanceId": script_id,
            "rev": rev,
            "root": root,
            "metadata": metadata,
        })
        .to_string(),
    ))?;
    Ok(())
}

fn dispatch_gateway_ui_event(engine: &Engine, value: &serde_json::Value) -> Result<()> {
    let target_id = value
        .get("targetNodeId")
        .and_then(|v| v.as_str())
        .context("ui.event missing targetNodeId")?;
    let event_name = value
        .get("name")
        .and_then(|v| v.as_str())
        .context("ui.event missing name")?;
    let payload = value
        .get("payload")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let root = engine
        .latest_tree
        .lock()
        .unwrap()
        .clone()
        .context("ui.event received before UI snapshot")?;
    let node = root
        .find_node(target_id)
        .with_context(|| format!("ui.event target not found: {target_id}"))?;
    let token = node
        .handler_token(event_name)
        .with_context(|| format!("ui.event handler not found: {event_name}"))?
        .to_string();

    engine.dispatch_ui_event(&token, gateway_ui_event_args(event_name, payload))
}

fn gateway_ui_event_args(event_name: &str, payload: serde_json::Value) -> Vec<serde_json::Value> {
    if let Some(args) = payload.get("args").and_then(|v| v.as_array()) {
        return args.clone();
    }

    if matches!(event_name, "tap" | "close") {
        return Vec::new();
    }

    if matches!(event_name, "change" | "submit") {
        if let Some(value) = payload.get("value") {
            return vec![value.clone()];
        }
    }

    if payload.is_null() {
        Vec::new()
    } else {
        vec![payload]
    }
}

fn print_paths() -> Result<()> {
    println!("state dir: {}", state_dir()?.display());
    println!("pidfile:  {}", pidfile_path()?.display());
    println!("logfile:  {}", logfile_path()?.display());
    Ok(())
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn gateway_dir() -> PathBuf {
    if let Some(dir) = env_trim("EMWAVER_GATEWAY_DIR") {
        return PathBuf::from(dir);
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(prefix) = exe.parent().and_then(Path::parent) {
            let packaged = prefix.join("share").join("emwaver").join("gateway");
            if packaged.join("dist").join("server.mjs").exists() {
                return packaged;
            }
        }
    }

    repo_root().join("gateway")
}

fn default_bootstrap_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(prefix) = exe.parent().and_then(Path::parent) {
            let packaged = prefix
                .join("share")
                .join("emwaver")
                .join("assets")
                .join("default-scripts")
                .join("script_bootstrap.emw");
            if packaged.exists() {
                return packaged;
            }
        }
    }

    repo_root()
        .join("assets")
        .join("default-scripts")
        .join("script_bootstrap.emw")
}

fn start_gateway(port: Option<u16>) -> Result<()> {
    let dir = gateway_dir();
    let package_json = dir.join("package.json");
    let built_server = dir.join("dist").join("server.mjs");
    let built_client = dir.join("dist").join("client").join("index.html");
    if !package_json.exists() && (!built_server.exists() || !built_client.exists()) {
        anyhow::bail!(
            "gateway package or built assets not found at {}",
            dir.display()
        );
    }

    let node_modules = dir.join("node_modules");
    if !node_modules.exists() && package_json.exists() {
        println!(
            "gateway dependencies missing; running `npm ci` in {}",
            dir.display()
        );
        let status = Command::new("npm")
            .arg("ci")
            .current_dir(&dir)
            .status()
            .context("failed to install gateway dependencies with npm ci")?;

        if !status.success() {
            anyhow::bail!("gateway dependency install exited with status {status}");
        }
    }

    if !built_server.exists() || !built_client.exists() {
        if !package_json.exists() {
            anyhow::bail!("gateway built assets missing at {}", dir.display());
        }
        println!(
            "gateway build missing; running `npm run build` in {}",
            dir.display()
        );
        let status = Command::new("npm")
            .arg("run")
            .arg("build")
            .current_dir(&dir)
            .status()
            .context("failed to build gateway")?;
        if !status.success() {
            anyhow::bail!("gateway build exited with status {status}");
        }
    }

    let port_value = port.unwrap_or(3921);
    println!("starting EMWaver gateway on http://127.0.0.1:{port_value}");
    println!("gateway dir: {}", dir.display());

    let status = Command::new("node")
        .arg("dist/server.mjs")
        .current_dir(&dir)
        .env("EMWAVER_GATEWAY_PORT", port_value.to_string())
        .status()
        .context("failed to start built gateway with node")?;

    if !status.success() {
        anyhow::bail!("gateway exited with status {status}");
    }

    Ok(())
}

fn env_trim(key: &str) -> Option<String> {
    let value = std::env::var(key).ok()?;
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn run_agent(
    prompt_parts: Vec<String>,
    script: Option<PathBuf>,
    mode: String,
    error: Option<String>,
    endpoint: Option<String>,
) -> Result<()> {
    let prompt = prompt_parts.join(" ").trim().to_string();
    if prompt.is_empty() {
        anyhow::bail!("agent prompt is required");
    }

    let api_key = env_trim("EMWAVER_AGENT_API_KEY").ok_or_else(|| {
        anyhow::anyhow!("agent_not_configured: set EMWAVER_AGENT_API_KEY to use `emwaver agent`")
    })?;
    let endpoint = endpoint
        .or_else(|| env_trim("EMWAVER_AGENT_ENDPOINT"))
        .or_else(|| env_trim("CONTINUAL_AGENT_ENDPOINT"))
        .ok_or_else(|| {
            anyhow::anyhow!(
                "agent_not_configured: set EMWAVER_AGENT_ENDPOINT or CONTINUAL_AGENT_ENDPOINT"
            )
        })?;

    let mut user_input = prompt.clone();
    if let Some(path) = script {
        let source = fs::read_to_string(&path)
            .with_context(|| format!("failed to read script at {}", path.display()))?;
        user_input.push_str(&format!(
            "\n\nScript `{}`:\n```emw\n{}\n```",
            script_name(&path, None),
            source
        ));
    }
    if let Some(error) = error {
        user_input.push_str(&format!("\n\nRuntime error:\n```text\n{error}\n```"));
    }
    if mode != "write" {
        user_input.push_str(&format!("\n\nRequested mode: {mode}"));
    }

    let mut payload = serde_json::json!({
        "userInput": user_input,
    });
    if let Some(universe) =
        env_trim("EMWAVER_AGENT_UNIVERSE").or_else(|| env_trim("CONTINUAL_AGENT_UNIVERSE"))
    {
        payload["universe"] = serde_json::json!(universe);
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .context("failed to create agent HTTP client")?;
    let response = client
        .post(&endpoint)
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .with_context(|| format!("agent request failed: {endpoint}"))?;

    let status = response.status();
    let body: serde_json::Value = response.json().unwrap_or_else(|_| serde_json::Value::Null);
    if !status.is_success() {
        let error = body
            .get("error")
            .and_then(|v| v.as_str())
            .or_else(|| body.get("message").and_then(|v| v.as_str()))
            .unwrap_or("agent_request_failed");
        anyhow::bail!("agent request failed ({status}): {error}");
    }

    if let Some(message) = body.get("message").and_then(|v| v.as_str()) {
        println!("{message}");
    }
    if let Some(code) = body.get("code").and_then(|v| v.as_str()) {
        println!("\n```emw");
        println!("{code}");
        println!("```");
    }
    if let Some(patch) = body.get("patch").and_then(|v| v.as_str()) {
        println!("\nPatch:\n{patch}");
    }
    if let Some(warnings) = body.get("warnings").and_then(|v| v.as_array()) {
        for warning in warnings.iter().filter_map(|v| v.as_str()) {
            println!("warning: {warning}");
        }
    }
    if body.get("message").is_none() && body.get("code").is_none() && body.get("patch").is_none() {
        println!("{}", serde_json::to_string_pretty(&body)?);
    }

    Ok(())
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();

    match cli.cmd {
        Commands::Start {
            port,
            device,
            ble,
            no_device,
            sim_device,
            bootstrap_path,
        } => start_local_stack(port, device, ble, no_device, sim_device, bootstrap_path),
        Commands::Daemon { cmd } => match cmd {
            DaemonCmd::Start {
                port,
                gateway_url,
                device,
                ble,
                no_device,
                sim_device,
                bootstrap_path,
            } => daemon_start(
                port,
                gateway_url,
                device,
                ble,
                no_device,
                sim_device,
                bootstrap_path,
            ),
            DaemonCmd::Serve {
                port,
                gateway_url,
                device,
                ble,
                no_device,
                sim_device,
                bootstrap_path,
            } => daemon_serve(
                port,
                gateway_url,
                device,
                ble,
                no_device,
                sim_device,
                bootstrap_path,
            ),
            DaemonCmd::Stop => daemon_stop(),
            DaemonCmd::Status => {
                match daemon_running()? {
                    Some(pid) => println!("daemon: running (pid={pid})"),
                    None => println!("daemon: not running"),
                }
                println!("{}", autostart_status()?);
                Ok(())
            }
            DaemonCmd::Autostart => {
                println!("{}", autostart_status()?);
                Ok(())
            }
        },
        Commands::Service { cmd } => match cmd {
            ServiceCmd::Install {
                port,
                device,
                ble,
                no_device,
                sim_device,
                bootstrap_path,
                now,
            } => service_install(
                port,
                device,
                ble,
                no_device,
                sim_device,
                bootstrap_path,
                now,
            ),
            ServiceCmd::Uninstall => service_uninstall(),
            ServiceCmd::PrintUnit {
                port,
                device,
                ble,
                no_device,
                sim_device,
                bootstrap_path,
            } => {
                let exe = std::env::current_exe()
                    .context("failed to resolve current emwaver executable")?;
                print!(
                    "{}",
                    service_unit(
                        &exe,
                        port,
                        device,
                        ble,
                        no_device,
                        sim_device,
                        bootstrap_path
                    )?
                );
                Ok(())
            }
            ServiceCmd::Start => systemctl_user(&["start", "emwaver-daemon.service"]),
            ServiceCmd::Stop => systemctl_user(&["stop", "emwaver-daemon.service"]),
            ServiceCmd::Status => service_status(),
        },
        Commands::Tui => run_tui(),
        Commands::Devices => list_devices(),
        Commands::Doctor => doctor(),
        Commands::Run {
            script,
            name,
            port,
            gateway_url,
            timeout_ms,
            no_wait,
            direct,
            device,
            ble,
            no_device,
            sim_device,
            bootstrap_path,
        } => run_script(
            script,
            name,
            port,
            gateway_url,
            timeout_ms,
            no_wait,
            direct,
            device,
            ble,
            no_device,
            sim_device,
            bootstrap_path,
        ),
        Commands::Gateway {
            port,
            daemon_fallback,
            device,
            ble,
            no_device,
            sim_device,
            bootstrap_path,
        }
        | Commands::Web {
            port,
            daemon_fallback,
            device,
            ble,
            no_device,
            sim_device,
            bootstrap_path,
        } => {
            if daemon_fallback {
                start_local_stack(port, device, ble, no_device, sim_device, bootstrap_path)
            } else {
                if device.is_some() || ble || no_device || sim_device || bootstrap_path.is_some() {
                    anyhow::bail!("daemon transport flags require --daemon-fallback");
                }
                start_gateway(port)
            }
        }
        Commands::Agent {
            prompt,
            script,
            mode,
            error,
            endpoint,
        } => run_agent(prompt, script, mode, error, endpoint),
        Commands::Paths => print_paths(),
    }
}

fn run_tui() -> Result<()> {
    use crossterm::{
        event::{self, Event, KeyCode},
        execute,
        terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
    };
    use ratatui::{
        backend::CrosstermBackend,
        layout::{Constraint, Direction, Layout},
        style::{Modifier, Style},
        text::{Line, Text},
        widgets::{Block, Borders, Paragraph},
        Terminal,
    };

    enable_raw_mode()?;
    let mut stdout = std::io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let res = (|| -> Result<()> {
        loop {
            let daemon_line = match daemon_running()? {
                Some(pid) => format!("running (pid={pid})"),
                None => "not running".to_string(),
            };
            let autostart = autostart_status()?;
            let devices = list_devices_lines()?;

            terminal.draw(|f| {
                let size = f.size();
                let chunks = Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(5),
                        Constraint::Min(8),
                        Constraint::Length(3),
                    ])
                    .split(size);

                let header = Paragraph::new(Text::from(vec![
                    Line::from("EMWaver Daemon (beta)".to_string())
                        .style(Style::default().add_modifier(Modifier::BOLD)),
                    Line::from(format!("daemon: {daemon_line}")),
                    Line::from(autostart),
                ]))
                .block(Block::default().borders(Borders::ALL).title("Status"));
                f.render_widget(header, chunks[0]);

                let dev_text: Vec<Line> = devices.into_iter().map(Line::from).collect();
                let dev = Paragraph::new(Text::from(dev_text))
                    .block(Block::default().borders(Borders::ALL).title("Devices"));
                f.render_widget(dev, chunks[1]);

                let help = Paragraph::new("Keys: (s)tart  s(t)op  (r)efresh  (q)uit")
                    .block(Block::default().borders(Borders::ALL).title("Help"));
                f.render_widget(help, chunks[2]);
            })?;

            // Input
            if event::poll(std::time::Duration::from_millis(250))? {
                if let Event::Key(key) = event::read()? {
                    match key.code {
                        KeyCode::Char('q') => break,
                        KeyCode::Char('r') => {
                            // redraw on next loop
                        }
                        KeyCode::Char('s') => {
                            // Start with defaults (env can override)
                            let _ = daemon_start(None, None, None, false, false, false, None);
                        }
                        KeyCode::Char('t') => {
                            let _ = daemon_stop();
                        }
                        _ => {}
                    }
                }
            }
        }
        Ok(())
    })();

    // restore terminal
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn gateway_tap_events_match_native_empty_args() {
        assert!(gateway_ui_event_args("tap", json!({})).is_empty());
        assert!(gateway_ui_event_args("close", json!({"value": "ignored"})).is_empty());
    }

    #[test]
    fn gateway_change_events_match_native_value_arg() {
        assert_eq!(
            gateway_ui_event_args("change", json!({"value": "abc"})),
            vec![json!("abc")]
        );
        assert_eq!(
            gateway_ui_event_args("submit", json!({"value": 42})),
            vec![json!(42)]
        );
    }

    #[test]
    fn gateway_event_args_can_be_explicit() {
        assert_eq!(
            gateway_ui_event_args("custom", json!({"args": ["a", 2, true]})),
            vec![json!("a"), json!(2), json!(true)]
        );
    }

    #[test]
    fn gateway_custom_events_keep_payload_arg() {
        assert_eq!(
            gateway_ui_event_args("viewport", json!({"min": 10, "max": 20})),
            vec![json!({"min": 10, "max": 20})]
        );
    }
}
