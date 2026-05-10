use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use directories::ProjectDirs;
use emwaver_device::{
    list_ble_devices, list_wifi_devices, query_hardware_uid, query_version, wifi_clear,
    wifi_disconnect_reason_text, wifi_provision, wifi_status, BleDevice, Device,
    DeviceCommandSender, WiFiDevice, WiFiDeviceInfo, WiFiStatus,
};
use emwaver_runtime::{CommandBridge, Engine, SimulatorCommandBridge};
use nix::sys::signal::kill;
use nix::unistd::Pid;
use std::fs;
use std::fs::OpenOptions;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tracing::info;
use tungstenite::{
    accept_hdr, connect,
    handshake::server::{Request, Response},
    stream::MaybeTlsStream,
    Message, WebSocket,
};
use url::Url;

#[derive(Clone)]
struct GatewayTransportStatus {
    device_id: Option<String>,
    ble: bool,
    wifi: Option<String>,
    wifi_port: u16,
    no_device: bool,
    sim_device: bool,
    hardware_uid: Option<String>,
    firmware_version: Option<String>,
}

struct CommandBridgeHandle {
    bridge: Arc<dyn CommandBridge>,
    command_sender: Option<Arc<dyn DeviceCommandSender>>,
}

#[derive(Parser, Debug)]
#[command(name = "emwaver", about = "EMWaver Gateway CLI")]
struct Cli {
    #[command(subcommand)]
    cmd: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Manage the local Gateway backend and browser server.
    Gateway {
        #[command(subcommand)]
        cmd: GatewayCmd,
    },

    /// Install/manage the local Linux Gateway user service.
    Service {
        #[command(subcommand)]
        cmd: ServiceCmd,
    },

    /// Terminal UI for Gateway + device status.
    Tui,

    /// List local devices and optionally probe a Wi-Fi endpoint.
    Devices {
        /// Print structured JSON instead of human-readable device lines.
        #[arg(long)]
        json: bool,

        /// Probe an ESP32 Wi-Fi device by hostname or IP.
        #[arg(long)]
        wifi: Option<String>,
        /// ESP32 Wi-Fi control port for the Wi-Fi probe.
        #[arg(long, default_value_t = 3922)]
        wifi_port: u16,
    },

    /// Check local CLI, gateway, and device prerequisites.
    Doctor {
        /// Probe an ESP32 Wi-Fi device by hostname or IP.
        #[arg(long)]
        wifi: Option<String>,
        /// ESP32 Wi-Fi control port for the Wi-Fi probe.
        #[arg(long, default_value_t = 3922)]
        wifi_port: u16,
    },

    /// Run a .emw script through the local Gateway.
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

        /// Target device id reported by the running Gateway.
        #[arg(long)]
        device: Option<String>,
    },

    /// Provision, inspect, or clear ESP32 Wi-Fi setup over USB, BLE, or Wi-Fi.
    Wifi {
        #[command(subcommand)]
        cmd: WifiCmd,
    },

    /// Show where emwaver stores state/logs.
    Paths,
}

#[derive(Subcommand, Debug)]
enum GatewayCmd {
    /// Start the local Gateway in the background.
    Start {
        /// Local gateway port (defaults to 3921).
        #[arg(long)]
        port: Option<u16>,

        /// MIDI input port id from `emwaver devices`.
        #[arg(long)]
        device: Option<String>,

        /// Use ESP32 BLE transport instead of USB MIDI/SysEx.
        #[arg(long)]
        ble: bool,

        /// Use ESP32 Wi-Fi transport by hostname or IP.
        #[arg(long)]
        wifi: Option<String>,
        /// ESP32 Wi-Fi control port.
        #[arg(long, default_value_t = 3922)]
        wifi_port: u16,

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

    /// Run the local Gateway in the foreground.
    Serve {
        /// Local gateway port (defaults to 3921).
        #[arg(long)]
        port: Option<u16>,

        /// MIDI input port id from `emwaver devices`.
        #[arg(long)]
        device: Option<String>,

        /// Use ESP32 BLE transport instead of USB MIDI/SysEx.
        #[arg(long)]
        ble: bool,

        /// Use ESP32 Wi-Fi transport by hostname or IP.
        #[arg(long)]
        wifi: Option<String>,
        /// ESP32 Wi-Fi control port.
        #[arg(long, default_value_t = 3922)]
        wifi_port: u16,

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

    /// Stop the background Gateway (best-effort).
    Stop,

    /// Print Gateway status (running/not running) and autostart status.
    Status,

    /// Check whether autostart is configured (macOS launchd / Linux systemd).
    Autostart,
}

#[derive(Subcommand, Debug)]
enum ServiceCmd {
    /// Install a Linux systemd user service for the local Gateway.
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

        /// Use ESP32 Wi-Fi transport by hostname or IP.
        #[arg(long)]
        wifi: Option<String>,
        /// ESP32 Wi-Fi control port.
        #[arg(long, default_value_t = 3922)]
        wifi_port: u16,

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

        /// Use ESP32 Wi-Fi transport by hostname or IP.
        #[arg(long)]
        wifi: Option<String>,
        /// ESP32 Wi-Fi control port.
        #[arg(long, default_value_t = 3922)]
        wifi_port: u16,

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

#[derive(Subcommand, Debug)]
enum WifiCmd {
    /// Send Wi-Fi credentials to a Wi-Fi-capable ESP32 board.
    Provision {
        /// Wi-Fi network SSID.
        #[arg(long)]
        ssid: String,

        /// Wi-Fi network password. Omit for an open network.
        #[arg(long)]
        password: Option<String>,

        /// MIDI input port id from `emwaver devices`.
        #[arg(long)]
        device: Option<String>,

        /// Use ESP32 BLE transport instead of USB MIDI/SysEx.
        #[arg(long)]
        ble: bool,

        /// Use ESP32 Wi-Fi transport by hostname or IP.
        #[arg(long)]
        wifi: Option<String>,

        /// ESP32 Wi-Fi control port.
        #[arg(long, default_value_t = 3922)]
        wifi_port: u16,
    },

    /// Query ESP32 Wi-Fi provisioning/runtime status.
    Status {
        /// MIDI input port id from `emwaver devices`.
        #[arg(long)]
        device: Option<String>,

        /// Use ESP32 BLE transport instead of USB MIDI/SysEx.
        #[arg(long)]
        ble: bool,

        /// Use ESP32 Wi-Fi transport by hostname or IP.
        #[arg(long)]
        wifi: Option<String>,

        /// ESP32 Wi-Fi control port.
        #[arg(long, default_value_t = 3922)]
        wifi_port: u16,
    },

    /// Clear stored ESP32 Wi-Fi credentials.
    Clear {
        /// MIDI input port id from `emwaver devices`.
        #[arg(long)]
        device: Option<String>,

        /// Use ESP32 BLE transport instead of USB MIDI/SysEx.
        #[arg(long)]
        ble: bool,

        /// Use ESP32 Wi-Fi transport by hostname or IP.
        #[arg(long)]
        wifi: Option<String>,

        /// ESP32 Wi-Fi control port.
        #[arg(long, default_value_t = 3922)]
        wifi_port: u16,
    },
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
    Ok(state_dir()?.join("gateway.pid"))
}

fn logfile_path() -> Result<PathBuf> {
    Ok(state_dir()?.join("gateway.log"))
}

fn read_pid(pidfile: &Path) -> Option<i32> {
    let s = fs::read_to_string(pidfile).ok()?;
    s.trim().parse::<i32>().ok()
}

fn is_running(pid: i32) -> bool {
    kill(Pid::from_raw(pid), None).is_ok()
}

fn pid_looks_like_gateway(pid: i32) -> bool {
    if cfg!(target_os = "linux") {
        let cmdline = fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
        let parts: Vec<String> = cmdline
            .split(|byte| *byte == 0)
            .filter(|part| !part.is_empty())
            .map(|part| String::from_utf8_lossy(part).to_string())
            .collect();
        if !parts.is_empty() {
            return parts.iter().any(|part| part.contains("emwaver"))
                && parts.iter().any(|part| part == "gateway")
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
    args.contains("emwaver") && args.contains("gateway") && args.contains("serve")
}

fn gateway_running() -> Result<Option<i32>> {
    let pidfile = pidfile_path()?;
    let Some(pid) = read_pid(&pidfile) else {
        return Ok(None);
    };
    if is_running(pid) && pid_looks_like_gateway(pid) {
        Ok(Some(pid))
    } else {
        // Stale pidfile, or the OS reused the pid for an unrelated process.
        let _ = fs::remove_file(pidfile);
        Ok(None)
    }
}

fn gateway_start(
    port: Option<u16>,
    device: Option<String>,
    ble: bool,
    wifi: Option<String>,
    wifi_port: u16,
    no_device: bool,
    sim_device: bool,
    bootstrap_path: Option<PathBuf>,
) -> Result<()> {
    if let Some(pid) = gateway_running()? {
        println!("gateway: already running (pid={pid})");
        return Ok(());
    }

    let exe = std::env::current_exe().context("failed to resolve current emwaver executable")?;
    let logfile = logfile_path()?;
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&logfile)
        .with_context(|| format!("failed to open gateway log at {}", logfile.display()))?;
    let stderr = stdout
        .try_clone()
        .context("failed to clone gateway log handle")?;

    let mut cmd = Command::new(exe);
    cmd.arg("gateway").arg("serve");
    if let Some(port) = port {
        cmd.arg("--port").arg(port.to_string());
    }
    if let Some(device) = device {
        cmd.arg("--device").arg(device);
    }
    if ble {
        cmd.arg("--ble");
    }
    if let Some(wifi) = wifi {
        cmd.arg("--wifi").arg(wifi);
        cmd.arg("--wifi-port").arg(wifi_port.to_string());
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
        .context("failed to spawn gateway process")?;

    let pid = child.id();
    fs::write(pidfile_path()?, pid.to_string())?;
    println!("gateway: started (pid={pid})");
    println!("logfile: {}", logfile.display());
    Ok(())
}

fn gateway_stop() -> Result<()> {
    let pidfile = pidfile_path()?;
    let Some(pid) = read_pid(&pidfile) else {
        info!("gateway not running");
        return Ok(());
    };

    if !is_running(pid) {
        let _ = fs::remove_file(pidfile);
        info!("gateway not running (stale pidfile removed)");
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
            .join("com.emwaver.gateway.plist");
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
        .join("emwaver-gateway.service")
}

#[cfg(target_os = "linux")]
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

#[cfg(target_os = "linux")]
fn systemctl_user_reload() -> Result<()> {
    systemctl_user(&[concat!("dae", "mon-reload")])
}

fn validate_service_transport_flags(
    device: Option<&str>,
    ble: bool,
    wifi: Option<&str>,
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
    if ble && wifi.is_some() {
        anyhow::bail!("--ble cannot be combined with --wifi");
    }
    if wifi.is_some() && device.is_some() {
        anyhow::bail!("--device cannot be combined with --wifi");
    }
    if wifi.is_some() && no_device {
        anyhow::bail!("--wifi cannot be combined with --no-device");
    }
    if wifi.is_some() && sim_device {
        anyhow::bail!("--wifi cannot be combined with --sim-device");
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
    wifi: Option<String>,
    wifi_port: u16,
    no_device: bool,
    sim_device: bool,
    bootstrap_path: Option<PathBuf>,
) -> Result<String> {
    validate_service_transport_flags(
        device.as_deref(),
        ble,
        wifi.as_deref(),
        no_device,
        sim_device,
    )?;

    let mut exec_args = vec![
        shell_escape(&exe.display().to_string()),
        "gateway".to_string(),
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
    if let Some(wifi) = wifi {
        exec_args.push("--wifi".to_string());
        exec_args.push(shell_escape(&wifi));
        exec_args.push("--wifi-port".to_string());
        exec_args.push(wifi_port.to_string());
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
Description=EMWaver local Gateway
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
    wifi: Option<String>,
    wifi_port: u16,
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
            wifi,
            wifi_port,
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
            wifi,
            wifi_port,
            no_device,
            sim_device,
            bootstrap_path,
        )?;

        fs::write(&unit_path, unit)
            .with_context(|| format!("failed to write {}", unit_path.display()))?;
        println!("installed systemd user unit: {}", unit_path.display());
        systemctl_user_reload()?;
        systemctl_user(&["enable", "emwaver-gateway.service"])?;
        if now {
            systemctl_user(&["restart", "emwaver-gateway.service"])?;
        }
        println!("service installed. Start with: systemctl --user start emwaver-gateway.service");
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
        let _ = systemctl_user(&["disable", "--now", "emwaver-gateway.service"]);
        let unit_path = systemd_user_unit_path();
        if unit_path.exists() {
            fs::remove_file(&unit_path)
                .with_context(|| format!("failed to remove {}", unit_path.display()))?;
            println!("removed {}", unit_path.display());
        } else {
            println!("service unit not present: {}", unit_path.display());
        }
        systemctl_user_reload()?;
        Ok(())
    }
}

fn service_start() -> Result<()> {
    #[cfg(not(target_os = "linux"))]
    {
        anyhow::bail!(
            "`emwaver service start` currently supports Linux systemd user services only"
        );
    }

    #[cfg(target_os = "linux")]
    {
        systemctl_user(&["start", "emwaver-gateway.service"])
    }
}

fn service_stop() -> Result<()> {
    #[cfg(not(target_os = "linux"))]
    {
        anyhow::bail!("`emwaver service stop` currently supports Linux systemd user services only");
    }

    #[cfg(target_os = "linux")]
    {
        systemctl_user(&["stop", "emwaver-gateway.service"])
    }
}

fn service_status() -> Result<()> {
    #[cfg(not(target_os = "linux"))]
    {
        anyhow::bail!(
            "`emwaver service status` currently supports Linux systemd user services only"
        );
    }

    #[cfg(target_os = "linux")]
    {
        systemctl_user(&["status", "emwaver-gateway.service"])
    }
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

#[derive(Debug, Clone)]
struct ValidatedWiFiDevice {
    info: WiFiDeviceInfo,
    hardware_uid: String,
    version: Option<String>,
}

fn list_devices_lines(wifi: Option<String>, wifi_port: u16) -> Result<Vec<String>> {
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

    match validated_wifi_devices(1_500) {
        Ok(devices) if devices.is_empty() => {
            out.push("No EMWaver Wi-Fi devices found.".to_string())
        }
        Ok(devices) => {
            out.push("Wi-Fi devices:".to_string());
            for device in devices {
                let board = device
                    .info
                    .txt
                    .get("board")
                    .map(String::as_str)
                    .unwrap_or("unknown board");
                let firmware = device
                    .version
                    .as_deref()
                    .or_else(|| device.info.txt.get("fw").map(String::as_str))
                    .unwrap_or("unknown fw");
                let addresses = if device.info.addresses.is_empty() {
                    device.info.host.clone()
                } else {
                    device.info.addresses.join(", ")
                };
                out.push(format!(
                    "  {}: {} at {}:{} ({board}, {firmware}, UID {})",
                    device.info.id,
                    device.info.name,
                    addresses,
                    device.info.port,
                    device.hardware_uid
                ));
            }
        }
        Err(err) => out.push(format!("Wi-Fi discovery unavailable: {err:#}")),
    }

    let (wifi_lines, _wifi_ok) = wifi_probe_lines(wifi, wifi_port)?;
    out.extend(wifi_lines);

    Ok(out)
}

fn wifi_probe_lines(wifi: Option<String>, wifi_port: u16) -> Result<(Vec<String>, bool)> {
    if wifi.is_none() {
        return Ok((Vec::new(), true));
    }

    let Some(host) = wifi else {
        return Ok((Vec::new(), true));
    };

    match probe_wifi_endpoint(&host, wifi_port) {
        Ok((uid, version)) => {
            let version = version.unwrap_or_else(|| "unknown fw".to_string());
            Ok((
                vec![format!(
                    "Wi-Fi device: {host}:{wifi_port} live (UID {uid}, {version})"
                )],
                true,
            ))
        }
        Err(err) => Ok((
            vec![format!(
                "Wi-Fi probe failed for {host}:{wifi_port}: {}",
                classify_wifi_probe_error(&err)
            )],
            false,
        )),
    }
}

fn classify_wifi_probe_error(err: &anyhow::Error) -> String {
    let text = format!("{err:#}");
    let lower = text.to_ascii_lowercase();
    if lower.contains("busy") {
        format!("device is busy with another session ({text})")
    } else if lower.contains("connection refused") || lower.contains("refused") {
        format!(
            "connection refused; the device may be offline or the control port is closed ({text})"
        )
    } else if lower.contains("no route")
        || lower.contains("network is unreachable")
        || lower.contains("host is down")
        || lower.contains("timed out")
        || lower.contains("timeout")
    {
        format!("missing route or device not reachable ({text})")
    } else if lower.contains("dns")
        || lower.contains("name or service not known")
        || lower.contains("nodename")
        || lower.contains("could not resolve")
    {
        format!("mDNS/DNS name unavailable ({text})")
    } else {
        text
    }
}

fn list_devices(json: bool, wifi: Option<String>, wifi_port: u16) -> Result<()> {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&list_devices_json(wifi, wifi_port)?)?
        );
        return Ok(());
    }
    for line in list_devices_lines(wifi, wifi_port)? {
        println!("{line}");
    }
    Ok(())
}

fn list_devices_json(wifi: Option<String>, wifi_port: u16) -> Result<serde_json::Value> {
    let mut devices = Vec::new();
    for device in emwaver_device::list_devices()? {
        devices.push(serde_json::json!({
            "id": format!("midi:{}", device.id),
            "name": device.name,
            "transport": "USB",
            "likelyEmwaver": device.likely_emwaver,
        }));
    }

    let ble_error = match list_ble_devices(1_500) {
        Ok(ble_devices) => {
            for device in ble_devices {
                devices.push(serde_json::json!({
                    "id": format!("ble:{}", device.id),
                    "name": device.name,
                    "transport": "BLE",
                    "boardType": "esp32s3",
                    "address": device.address,
                }));
            }
            None
        }
        Err(err) => Some(format!("BLE scan unavailable: {err:#}")),
    };

    let wifi_discovery_error = match validated_wifi_devices(1_500) {
        Ok(wifi_devices) => {
            for device in wifi_devices {
                let board = device
                    .info
                    .txt
                    .get("board")
                    .cloned()
                    .unwrap_or_else(|| "esp32".to_string());
                devices.push(serde_json::json!({
                    "id": format!("wifi:{}:{}", device.info.host, device.info.port),
                    "name": device.info.name,
                    "transport": "Wi-Fi",
                    "boardType": board,
                    "firmwareVersion": device.version.clone().or_else(|| device.info.txt.get("fw").cloned()),
                    "hardwareUid": device.hardware_uid,
                    "host": device.info.host,
                    "port": device.info.port,
                    "endpoint": format!("{}:{}", device.info.host, device.info.port),
                    "addresses": device.info.addresses,
                }));
            }
            None
        }
        Err(err) => Some(format!("Wi-Fi discovery unavailable: {err:#}")),
    };

    if let Some(host) = wifi.as_deref() {
        if let Ok((hardware_uid, version)) = probe_wifi_endpoint(host, wifi_port) {
            let id = format!("wifi:{host}:{wifi_port}");
            if !devices.iter().any(|device| {
                device.get("id").and_then(serde_json::Value::as_str) == Some(id.as_str())
            }) {
                devices.push(serde_json::json!({
                    "id": id,
                    "name": format!("ESP32 Wi-Fi {host}:{wifi_port}"),
                    "transport": "Wi-Fi",
                    "boardType": "esp32",
                    "firmwareVersion": version,
                    "hardwareUid": hardware_uid,
                    "host": host,
                    "port": wifi_port,
                    "endpoint": format!("{host}:{wifi_port}"),
                    "addresses": [host],
                }));
            }
        }
    }

    let (wifi_probe_lines, wifi_ok) = wifi_probe_lines(wifi, wifi_port)?;
    Ok(serde_json::json!({
        "ok": ble_error.is_none() && wifi_discovery_error.is_none(),
        "devices": devices,
        "bleError": ble_error,
        "wifiDiscoveryError": wifi_discovery_error,
        "wifiProbe": {
            "ok": wifi_ok,
            "lines": wifi_probe_lines,
        },
    }))
}

fn validated_wifi_devices(timeout_ms: u64) -> Result<Vec<ValidatedWiFiDevice>> {
    let devices = list_wifi_devices(timeout_ms)?;
    let mut out = Vec::new();
    for device in devices
        .into_iter()
        .filter(wifi_record_advertises_supported_runtime)
    {
        match probe_wifi_endpoint(&device.host, device.port) {
            Ok((hardware_uid, version)) => out.push(ValidatedWiFiDevice {
                info: device,
                hardware_uid,
                version,
            }),
            Err(err) => info!(
                "Wi-Fi endpoint {}:{} failed UID validation: {err:#}",
                device.host, device.port
            ),
        }
    }
    Ok(out)
}

fn probe_wifi_endpoint(host: &str, port: u16) -> Result<(String, Option<String>)> {
    let device = WiFiDevice::connect(host, port)?;
    let uid = query_hardware_uid(device.as_ref(), 1_500)?.with_context(|| {
        format!("Wi-Fi endpoint {host}:{port} did not return a valid hardware UID")
    })?;
    let version = query_version(device.as_ref(), 1_000).unwrap_or(None);
    Ok((uid, version))
}

fn wifi_record_advertises_supported_runtime(device: &WiFiDeviceInfo) -> bool {
    let proto_ok = device
        .txt
        .get("proto")
        .map(|proto| proto.trim() == "1")
        .unwrap_or(true);
    let caps_ok = device
        .txt
        .get("cap")
        .map(|cap| {
            cap.split(',')
                .any(|item| item.trim().eq_ignore_ascii_case("wifi"))
        })
        .unwrap_or(true);
    proto_ok && caps_ok
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

fn doctor(wifi: Option<String>, wifi_port: u16) -> Result<()> {
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

    match list_devices_lines(None, 3922) {
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

    match wifi_probe_lines(wifi, wifi_port) {
        Ok((lines, true)) => {
            for line in lines {
                println!("{line}");
            }
        }
        Ok((lines, false)) => {
            issues += 1;
            for line in lines {
                println!("{line}");
            }
        }
        Err(err) => {
            issues += 1;
            println!("Wi-Fi doctor check failed: {err:#}");
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

    fn load_buffer(&self, data: Vec<u8>) {
        self.device.load_buffer(data);
    }

    fn transmit_buffer(&self) -> Result<()> {
        self.device.transmit_buffer()
    }
}

impl DeviceCommandSender for DeviceCommandBridge {
    fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>> {
        self.device.send_command(cmd_lane, timeout_ms)
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

    fn load_buffer(&self, data: Vec<u8>) {
        self.device.load_buffer(data);
    }

    fn transmit_buffer(&self) -> Result<()> {
        self.device.transmit_buffer()
    }
}

impl DeviceCommandSender for BleCommandBridge {
    fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>> {
        self.device.send_command(cmd_lane, timeout_ms)
    }
}

struct WiFiCommandBridge {
    device: Arc<WiFiDevice>,
}

impl CommandBridge for WiFiCommandBridge {
    fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>> {
        self.device.send_command(cmd_lane, timeout_ms)
    }

    fn get_buffer(&self) -> Vec<u8> {
        self.device.get_buffer()
    }

    fn clear_buffer(&self) {
        self.device.clear_buffer();
    }

    fn load_buffer(&self, data: Vec<u8>) {
        self.device.load_buffer(data);
    }

    fn transmit_buffer(&self) -> Result<()> {
        self.device.transmit_buffer()
    }
}

impl DeviceCommandSender for WiFiCommandBridge {
    fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>> {
        self.device.send_command(cmd_lane, timeout_ms)
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
    device: Option<String>,
) -> Result<()> {
    let source = fs::read_to_string(&script)
        .with_context(|| format!("failed to read script at {}", script.display()))?;
    if source.trim().is_empty() {
        anyhow::bail!("script is empty: {}", script.display());
    }

    let name = script_name(&script, name);
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
            "deviceId": device,
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

fn make_command_bridge(
    device_id: Option<String>,
    ble: bool,
    wifi: Option<String>,
    wifi_port: u16,
    no_device: bool,
    sim_device: bool,
) -> Result<CommandBridgeHandle> {
    validate_service_transport_flags(
        device_id.as_deref(),
        ble,
        wifi.as_deref(),
        no_device,
        sim_device,
    )?;

    if no_device {
        Ok(CommandBridgeHandle {
            bridge: Arc::new(NoDeviceCommandBridge),
            command_sender: None,
        })
    } else if sim_device {
        Ok(CommandBridgeHandle {
            bridge: Arc::new(SimulatorCommandBridge::basic_board()?),
            command_sender: None,
        })
    } else if ble {
        let bridge = Arc::new(BleCommandBridge {
            device: BleDevice::connect_auto(5_000)?,
        });
        Ok(CommandBridgeHandle {
            bridge: bridge.clone(),
            command_sender: Some(bridge),
        })
    } else if let Some(wifi) = wifi {
        let bridge = Arc::new(WiFiCommandBridge {
            device: WiFiDevice::connect(&wifi, wifi_port)?,
        });
        Ok(CommandBridgeHandle {
            bridge: bridge.clone(),
            command_sender: Some(bridge),
        })
    } else {
        let device = Device::new();
        if let Some(device_id) = device_id {
            device.connect_by_id(&device_id)?;
        } else {
            device.connect_auto()?;
        }
        let bridge = Arc::new(DeviceCommandBridge { device });
        Ok(CommandBridgeHandle {
            bridge: bridge.clone(),
            command_sender: Some(bridge),
        })
    }
}

fn make_device_command_sender(
    device_id: Option<String>,
    ble: bool,
    wifi: Option<String>,
    wifi_port: u16,
) -> Result<Arc<dyn DeviceCommandSender>> {
    validate_service_transport_flags(device_id.as_deref(), ble, wifi.as_deref(), false, false)?;

    if ble {
        Ok(BleDevice::connect_auto(5_000)?)
    } else if let Some(wifi) = wifi {
        Ok(WiFiDevice::connect(&wifi, wifi_port)?)
    } else {
        let device = Device::new();
        if let Some(device_id) = device_id {
            device.connect_by_id(&device_id)?;
        } else {
            device.connect_auto()?;
        }
        Ok(device)
    }
}

fn bridge_for_gateway_device_id(
    device_id: Option<&str>,
    default_bridge: &Arc<dyn CommandBridge>,
) -> Result<Arc<dyn CommandBridge>> {
    let Some(device_id) = device_id.map(str::trim).filter(|id| !id.is_empty()) else {
        return Ok(default_bridge.clone());
    };
    if let Some(midi_id) = device_id.strip_prefix("midi:") {
        return Ok(make_command_bridge(
            Some(midi_id.to_string()),
            false,
            None,
            3922,
            false,
            false,
        )?
        .bridge);
    }
    if device_id.starts_with("ble:") {
        return Ok(make_command_bridge(None, true, None, 3922, false, false)?.bridge);
    }
    if let Some(rest) = device_id.strip_prefix("wifi:") {
        let (host, port) = parse_wifi_device_id(rest)?;
        return Ok(make_command_bridge(None, false, Some(host), port, false, false)?.bridge);
    }
    if device_id.starts_with("uid:") {
        return Ok(default_bridge.clone());
    }
    anyhow::bail!("unsupported Gateway device id: {device_id}")
}

fn parse_wifi_device_id(value: &str) -> Result<(String, u16)> {
    let (host, port) = value
        .rsplit_once(':')
        .context("Wi-Fi device id must be wifi:<host>:<port>")?;
    let port = port
        .parse::<u16>()
        .with_context(|| format!("invalid Wi-Fi device port: {port}"))?;
    if host.is_empty() {
        anyhow::bail!("Wi-Fi device id is missing host");
    }
    Ok((host.to_string(), port))
}

fn run_wifi_provision(
    ssid: String,
    password: Option<String>,
    device_id: Option<String>,
    ble: bool,
    wifi: Option<String>,
    wifi_port: u16,
) -> Result<()> {
    let sender = make_device_command_sender(device_id, ble, wifi, wifi_port)?;
    wifi_provision(sender.as_ref(), &ssid, password.as_deref(), 2_000)?;
    println!("Wi-Fi setup sent");
    Ok(())
}

fn run_wifi_status(
    device_id: Option<String>,
    ble: bool,
    wifi: Option<String>,
    wifi_port: u16,
) -> Result<()> {
    let sender = make_device_command_sender(device_id, ble, wifi, wifi_port)?;
    let status = wifi_status(sender.as_ref(), 2_000)?;
    println!("{}", format_wifi_status(&status));
    Ok(())
}

fn run_wifi_clear(
    device_id: Option<String>,
    ble: bool,
    wifi: Option<String>,
    wifi_port: u16,
) -> Result<()> {
    let sender = make_device_command_sender(device_id, ble, wifi, wifi_port)?;
    wifi_clear(sender.as_ref(), 2_000)?;
    println!("Wi-Fi setup cleared");
    Ok(())
}

fn format_wifi_status(status: &WiFiStatus) -> String {
    let provisioned = if status.provisioned {
        "provisioned"
    } else {
        "unprovisioned"
    };
    let socket = if status.socket_connected {
        "connected"
    } else {
        "idle"
    };
    let station = status
        .station_online
        .map(|online| if online { "online" } else { "offline" })
        .unwrap_or("unknown");
    let retrying = status
        .retrying
        .map(|retrying| if retrying { "retrying" } else { "idle" })
        .unwrap_or("unknown");
    let reason = status
        .disconnect_reason
        .map(|reason| format!("{reason} ({})", wifi_disconnect_reason_text(reason)))
        .unwrap_or_else(|| "unknown".to_string());
    let ip = status.station_ip.as_deref().unwrap_or("none");
    let runtime = status
        .runtime_active
        .map(|active| if active { "running" } else { "idle" })
        .unwrap_or("unknown");
    format!(
        "Wi-Fi is {provisioned}; socket is {socket}; station is {station}; retrying is {retrying}; disconnect reason is {reason}; station IP is {ip}; runtime is {runtime}."
    )
}

fn gateway_serve(
    port: Option<u16>,
    device_id: Option<String>,
    ble: bool,
    wifi: Option<String>,
    wifi_port: u16,
    no_device: bool,
    sim_device: bool,
    bootstrap_path: Option<PathBuf>,
) -> Result<()> {
    if let Some(parent) = pidfile_path()?.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(pidfile_path()?, std::process::id().to_string())?;

    let client_dist = prepare_gateway_client()?;
    let bootstrap_path = bootstrap_path.unwrap_or_else(default_bootstrap_path);
    let bootstrap = fs::read_to_string(&bootstrap_path)
        .with_context(|| format!("failed to read bootstrap at {}", bootstrap_path.display()))?;
    let bridge = make_command_bridge(
        device_id.clone(),
        ble,
        wifi.clone(),
        wifi_port,
        no_device,
        sim_device,
    )?;
    let (hardware_uid, firmware_version) = bridge
        .command_sender
        .as_ref()
        .map(|sender| {
            (
                query_hardware_uid(sender.as_ref(), 1_500).unwrap_or(None),
                query_version(sender.as_ref(), 1_000).unwrap_or(None),
            )
        })
        .unwrap_or((None, None));
    let transport_status = GatewayTransportStatus {
        device_id: device_id.clone(),
        ble,
        wifi: wifi.clone(),
        wifi_port,
        no_device,
        sim_device,
        hardware_uid,
        firmware_version,
    };

    let state = Arc::new(GatewayServerState {
        bootstrap: Arc::new(bootstrap),
        bridge: bridge.bridge,
        transport_status: Arc::new(Mutex::new(transport_status)),
        client_dist,
    });
    let port_value = port.unwrap_or(3921);
    let listener = TcpListener::bind(("127.0.0.1", port_value))
        .with_context(|| format!("failed to bind Gateway on 127.0.0.1:{port_value}"))?;
    println!("EMWaver Gateway listening on http://127.0.0.1:{port_value}");

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let state = state.clone();
                thread::spawn(move || {
                    if let Err(err) = handle_gateway_connection(stream, state) {
                        eprintln!("gateway connection failed: {err:#}");
                    }
                });
            }
            Err(err) => eprintln!("gateway accept failed: {err}"),
        }
    }
    Ok(())
}

#[derive(Clone)]
struct GatewayServerState {
    bootstrap: Arc<String>,
    bridge: Arc<dyn CommandBridge>,
    transport_status: Arc<Mutex<GatewayTransportStatus>>,
    client_dist: PathBuf,
}

fn handle_gateway_connection(stream: TcpStream, state: Arc<GatewayServerState>) -> Result<()> {
    let mut peek = [0_u8; 2048];
    let n = stream
        .peek(&mut peek)
        .context("failed to inspect gateway request")?;
    let header = String::from_utf8_lossy(&peek[..n]).to_ascii_lowercase();
    if header.starts_with("get /v1/ws ") && header.contains("upgrade: websocket") {
        handle_gateway_websocket(stream, state)
    } else {
        handle_gateway_http(stream, state)
    }
}

fn handle_gateway_websocket(stream: TcpStream, state: Arc<GatewayServerState>) -> Result<()> {
    stream
        .set_read_timeout(Some(Duration::from_millis(20)))
        .context("failed to set gateway websocket read timeout")?;
    let callback = |req: &Request, response: Response| {
        if req.uri().path() == "/v1/ws" {
            Ok(response)
        } else {
            Err(Response::builder()
                .status(404)
                .body(Some("not found".to_string()))
                .unwrap())
        }
    };
    let mut ws = accept_hdr(stream, callback).context("failed to accept gateway websocket")?;

    let mut active_engine: Option<Engine> = None;
    let mut active_script_id: Option<String> = None;
    let mut rev: u64 = 0;
    let mut last_status = Instant::now();
    let mut ready = false;

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
                if last_status.elapsed() >= Duration::from_secs(5) {
                    send_gateway_device_status(&mut ws, &state)?;
                    last_status = Instant::now();
                }
                continue;
            }
            Err(tungstenite::Error::ConnectionClosed) => return Ok(()),
            Err(err) => return Err(err).context("failed reading gateway websocket message"),
        };
        let Message::Text(text) = msg else {
            continue;
        };
        let value: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        let msg_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");

        if !ready {
            if msg_type != "hello" {
                send_ws_json(
                    &mut ws,
                    serde_json::json!({ "type": "error", "error": "expected_hello" }),
                )?;
                return Ok(());
            }
            let role = value
                .get("role")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if role != "web" {
                send_ws_json(
                    &mut ws,
                    serde_json::json!({ "type": "error", "error": "invalid_role" }),
                )?;
                return Ok(());
            }
            ready = true;
            send_ws_json(
                &mut ws,
                serde_json::json!({
                    "type": "hello.ack",
                    "role": "web",
                    "hostSessionId": "local",
                }),
            )?;
            send_gateway_device_status(&mut ws, &state)?;
            continue;
        }

        match msg_type {
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
                let requested_device_id = value
                    .get("deviceId")
                    .and_then(|v| v.as_str())
                    .filter(|id| !id.trim().is_empty())
                    .map(str::to_string);
                let script_id = format!("local-{}", std::process::id());
                active_engine = None;
                active_script_id = Some(script_id.clone());
                rev = 0;

                let result = (|| -> Result<Engine> {
                    if source.trim().is_empty() {
                        anyhow::bail!("script source is empty");
                    }
                    let script_bridge = bridge_for_gateway_device_id(
                        requested_device_id.as_deref(),
                        &state.bridge,
                    )?;
                    let engine = Engine::new(state.bootstrap.as_str(), script_bridge)?;
                    engine.run_script(&source)?;
                    Ok(engine)
                })();

                match result {
                    Ok(engine) => {
                        send_ws_json(
                            &mut ws,
                            serde_json::json!({
                                "type": "script.started",
                                "hostSessionId": "local",
                                "scriptInstanceId": script_id,
                                "name": name,
                                "deviceId": requested_device_id,
                            }),
                        )?;
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
                        send_ws_json(
                            &mut ws,
                            serde_json::json!({
                                "type": "script.error",
                                "hostSessionId": "local",
                                "error": err.to_string(),
                            }),
                        )?;
                    }
                }
            }
            "script.stop" => {
                let script_id = active_script_id
                    .take()
                    .unwrap_or_else(|| "local".to_string());
                active_engine = None;
                send_ws_json(
                    &mut ws,
                    serde_json::json!({
                        "type": "script.stopped",
                        "hostSessionId": "local",
                        "scriptInstanceId": script_id,
                        "reason": "stopped",
                    }),
                )?;
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
                        send_ws_json(
                            &mut ws,
                            serde_json::json!({
                                "type": "script.error",
                                "hostSessionId": "local",
                                "scriptInstanceId": script_id,
                                "error": err.to_string(),
                            }),
                        )?;
                    }
                }
            }
            "plot.viewport" => {}
            _ => send_ws_json(
                &mut ws,
                serde_json::json!({ "type": "error", "error": "unknown_message", "messageType": msg_type }),
            )?,
        }

        if let (Some(engine), Some(script_id)) =
            (active_engine.as_ref(), active_script_id.as_deref())
        {
            pump_engine_timers(&mut ws, engine, script_id, &mut rev)?;
        }
    }
}

fn pump_engine_timers<S: Read + Write>(
    ws: &mut WebSocket<S>,
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

fn send_gateway_device_status<S: Read + Write>(
    ws: &mut WebSocket<S>,
    state: &GatewayServerState,
) -> Result<()> {
    let transport_status = state.transport_status.lock().unwrap();
    send_ws_json(
        ws,
        serde_json::json!({
            "type": "device.status",
            "hostSessionId": "local",
            "connected": true,
            "runtimeOwner": "emwaver-gateway",
            "devices": gateway_status_devices(true, &transport_status),
        }),
    )?;
    Ok(())
}

fn gateway_status_devices(
    connected: bool,
    transport_status: &GatewayTransportStatus,
) -> Vec<serde_json::Value> {
    let mut devices = vec![selected_gateway_device(connected, transport_status)];
    let selected_id = devices
        .first()
        .and_then(|device| device.get("id"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);

    if !transport_status.no_device && !transport_status.sim_device {
        if let Ok(wifi_devices) = validated_wifi_devices(750) {
            for device in wifi_devices {
                let id = format!("wifi:{}:{}", device.info.host, device.info.port);
                if selected_id.as_deref() == Some(id.as_str()) {
                    continue;
                }
                let board = device
                    .info
                    .txt
                    .get("board")
                    .cloned()
                    .unwrap_or_else(|| "esp32".to_string());
                devices.push(serde_json::json!({
                    "id": id,
                    "name": device.info.name,
                    "transport": "Wi-Fi",
                    "boardType": board,
                    "firmwareVersion": device.version.clone().or_else(|| device.info.txt.get("fw").cloned()),
                    "hardwareUid": device.hardware_uid,
                    "connected": false,
                    "endpoint": format!("{}:{}", device.info.host, device.info.port),
                }));
            }
        }
    }

    devices
}

fn selected_gateway_device(
    connected: bool,
    transport_status: &GatewayTransportStatus,
) -> serde_json::Value {
    if transport_status.no_device {
        return serde_json::json!({
            "id": "local-gateway-no-device",
            "name": "Gateway hardware disabled",
            "transport": "None",
            "connected": connected,
        });
    }
    if transport_status.sim_device {
        return serde_json::json!({
            "id": "local-gateway-sim",
            "name": "EMWaver simulator",
            "transport": "Simulator",
            "boardType": "sim",
            "connected": connected,
        });
    }
    if transport_status.ble {
        return serde_json::json!({
            "id": "ble:auto",
            "name": "ESP32 BLE",
            "transport": "BLE",
            "boardType": "esp32s3",
            "connected": connected,
            "firmwareVersion": transport_status.firmware_version.clone(),
            "hardwareUid": transport_status.hardware_uid.clone(),
        });
    }
    if let Some(host) = transport_status.wifi.as_deref() {
        return serde_json::json!({
            "id": format!("wifi:{host}:{}", transport_status.wifi_port),
            "name": format!("ESP32 Wi-Fi {host}:{}", transport_status.wifi_port),
            "transport": "Wi-Fi",
            "boardType": "esp32",
            "connected": connected,
            "endpoint": format!("{host}:{}", transport_status.wifi_port),
            "firmwareVersion": transport_status.firmware_version.clone(),
            "hardwareUid": transport_status.hardware_uid.clone(),
        });
    }

    let selected_id = transport_status
        .device_id
        .as_deref()
        .unwrap_or("auto")
        .to_string();
    serde_json::json!({
        "id": format!("midi:{selected_id}"),
        "name": if selected_id == "auto" { "USB MIDI auto".to_string() } else { format!("USB MIDI {selected_id}") },
        "transport": "USB",
        "connected": connected,
        "firmwareVersion": transport_status.firmware_version.clone(),
        "hardwareUid": transport_status.hardware_uid.clone(),
    })
}

fn send_ui_snapshot<S: Read + Write>(
    ws: &mut WebSocket<S>,
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
    if let Some(root) = root.as_ref() {
        send_plot_data_for_tree(ws, engine, script_id, root)?;
    }
    Ok(())
}

fn send_plot_data_for_tree<S: Read + Write>(
    ws: &mut WebSocket<S>,
    engine: &Engine,
    script_id: &str,
    node: &emwaver_runtime::UiNode,
) -> Result<()> {
    if node.node_type == "plot" {
        if let Some(plot) = build_plot_data(engine, node) {
            ws.send(Message::Text(
                serde_json::json!({
                    "type": "plot.data",
                    "hostSessionId": "local",
                    "scriptInstanceId": script_id,
                    "targetNodeId": node.id,
                    "xMin": plot.x_min,
                    "xMax": plot.x_max,
                    "bins": plot.bins,
                    "dataX": plot.data_x,
                    "dataY": plot.data_y,
                })
                .to_string(),
            ))?;
        }
    }

    for child in &node.children {
        send_plot_data_for_tree(ws, engine, script_id, child)?;
    }
    Ok(())
}

struct PlotData {
    x_min: f64,
    x_max: f64,
    bins: usize,
    data_x: Vec<f64>,
    data_y: Vec<f64>,
}

fn build_plot_data(engine: &Engine, node: &emwaver_runtime::UiNode) -> Option<PlotData> {
    let buffer_id = plot_buffer_id(node)?;
    let buffer = engine.plot_buffer(&buffer_id)?;
    let total_bits = buffer.len().saturating_mul(8);
    if total_bits == 0 {
        return None;
    }

    let x_min = node
        .props
        .get("xMin")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let x_max = node
        .props
        .get("xMax")
        .and_then(|v| v.as_f64())
        .unwrap_or(total_bits as f64)
        .max(x_min + 1.0);
    let bins = node
        .props
        .get("bins")
        .and_then(|v| v.as_u64())
        .unwrap_or(400)
        .clamp(1, 12_000) as usize;
    let points = bins.min(total_bits.max(1));
    let span = (x_max - x_min).max(1.0);
    let mut data_x = Vec::with_capacity(points);
    let mut data_y = Vec::with_capacity(points);
    for i in 0..points {
        let t = if points <= 1 {
            0.0
        } else {
            i as f64 / (points - 1) as f64
        };
        let x = x_min + span * t;
        let bit_index = (x.floor().max(0.0) as usize).min(total_bits - 1);
        let byte = buffer[bit_index >> 3];
        let bit = (byte >> (bit_index & 7)) & 1;
        data_x.push(x);
        data_y.push(if bit == 1 { 255.0 } else { 0.0 });
    }

    Some(PlotData {
        x_min,
        x_max,
        bins,
        data_x,
        data_y,
    })
}

fn plot_buffer_id(node: &emwaver_runtime::UiNode) -> Option<String> {
    match node.props.get("source")? {
        serde_json::Value::String(id) => Some(id.clone()),
        serde_json::Value::Object(map) => map
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|id| !id.is_empty())
            .map(ToString::to_string),
        _ => None,
    }
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

fn send_ws_json<S: Read + Write>(ws: &mut WebSocket<S>, payload: serde_json::Value) -> Result<()> {
    ws.send(Message::Text(payload.to_string()))?;
    Ok(())
}

fn handle_gateway_http(mut stream: TcpStream, state: Arc<GatewayServerState>) -> Result<()> {
    let request = read_http_request(&mut stream)?;
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/health") => write_http_json(
            &mut stream,
            200,
            serde_json::json!({
                "ok": true,
                "service": "emwaver-gateway",
                "runtimeOwner": "emwaver-gateway",
            }),
        ),
        ("GET", "/v1/examples") => write_http_json(
            &mut stream,
            200,
            serde_json::json!({ "examples": load_bundled_examples()? }),
        ),
        ("GET", "/v1/devices") => match list_devices_json(None, 3922) {
            Ok(body) => write_http_json(&mut stream, 200, body),
            Err(err) => write_http_json(
                &mut stream,
                500,
                serde_json::json!({
                    "ok": false,
                    "error": "devices_failed",
                    "message": err.to_string(),
                }),
            ),
        },
        _ if request.path.starts_with("/v1/") => write_http_json(
            &mut stream,
            404,
            serde_json::json!({ "ok": false, "error": "not_found" }),
        ),
        _ => serve_gateway_client_asset(&mut stream, &state.client_dist, &request.path),
    }
}

struct HttpRequest {
    method: String,
    path: String,
}

fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];
    let header_end = loop {
        let n = stream
            .read(&mut chunk)
            .context("failed to read HTTP request")?;
        if n == 0 {
            anyhow::bail!("empty HTTP request");
        }
        buffer.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_header_end(&buffer) {
            break pos;
        }
        if buffer.len() > 1024 * 1024 {
            anyhow::bail!("HTTP request header too large");
        }
    };
    let header = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = header.lines();
    let request_line = lines.next().context("missing HTTP request line")?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or("").to_string();
    let raw_path = request_parts.next().unwrap_or("/").to_string();
    let path = raw_path.split('?').next().unwrap_or("/").to_string();
    let mut content_length = 0_usize;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse::<usize>().unwrap_or(0);
            }
        }
    }

    let body_start = header_end + 4;
    while buffer.len().saturating_sub(body_start) < content_length {
        let n = stream
            .read(&mut chunk)
            .context("failed to read HTTP request body")?;
        if n == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..n]);
    }
    Ok(HttpRequest { method, path })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn write_http_json(stream: &mut TcpStream, status: u16, body: serde_json::Value) -> Result<()> {
    write_http_response(
        stream,
        status,
        "application/json; charset=utf-8",
        body.to_string().into_bytes(),
    )
}

fn write_http_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: Vec<u8>,
) -> Result<()> {
    let head = format!(
        "HTTP/1.1 {status} {}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        http_status_reason(status),
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(&body)?;
    Ok(())
}

fn http_status_reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        502 => "Bad Gateway",
        _ => "OK",
    }
}

fn serve_gateway_client_asset(
    stream: &mut TcpStream,
    client_dist: &Path,
    path: &str,
) -> Result<()> {
    let requested = if path == "/" || path == "/index.html" {
        "index.html"
    } else {
        path.trim_start_matches('/')
    };
    let mut relative = PathBuf::new();
    for part in requested.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains('\\') {
            relative = PathBuf::from("index.html");
            break;
        }
        relative.push(part);
    }
    let candidate = client_dist.join(relative);
    let final_path = if candidate.exists() && candidate.is_file() {
        candidate
    } else {
        client_dist.join("index.html")
    };

    if !final_path.exists() {
        return write_http_response(
            stream,
            404,
            "text/plain; charset=utf-8",
            b"not found".to_vec(),
        );
    }

    let body = fs::read(&final_path)
        .with_context(|| format!("failed to read {}", final_path.display()))?;
    write_http_response(stream, 200, content_type(&final_path), body)
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn load_bundled_examples() -> Result<Vec<serde_json::Value>> {
    let dir = default_scripts_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = fs::read_dir(&dir)
        .with_context(|| format!("failed to read default scripts at {}", dir.display()))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());

    let mut examples = Vec::new();
    for entry in entries {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("emw") {
            continue;
        }
        examples.push(serde_json::json!({
            "name": entry.file_name().to_string_lossy(),
            "source": fs::read_to_string(&path)
                .with_context(|| format!("failed to read {}", path.display()))?,
        }));
    }
    Ok(examples)
}

fn default_scripts_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(prefix) = exe.parent().and_then(Path::parent) {
            let packaged = prefix
                .join("share")
                .join("emwaver")
                .join("assets")
                .join("default-scripts");
            if packaged.exists() {
                return packaged;
            }
        }
    }
    repo_root().join("assets").join("default-scripts")
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
            if packaged
                .join("dist")
                .join("client")
                .join("index.html")
                .exists()
            {
                return packaged;
            }
        }
    }

    repo_root().join("gateway").join("frontend")
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

fn prepare_gateway_client() -> Result<PathBuf> {
    let dir = gateway_dir();
    let package_json = dir.join("package.json");
    let client_dist = dir.join("dist").join("client");
    let built_client = client_dist.join("index.html");
    if !package_json.exists() && !built_client.exists() {
        anyhow::bail!(
            "gateway frontend package or built client assets not found at {}",
            dir.display()
        );
    }
    if built_client.exists() {
        return Ok(client_dist);
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

    if !package_json.exists() {
        anyhow::bail!("gateway client assets missing at {}", dir.display());
    }
    println!(
        "gateway client build missing; running `npm run build` in {}",
        dir.display()
    );
    let status = Command::new("npm")
        .arg("run")
        .arg("build")
        .current_dir(&dir)
        .status()
        .context("failed to build gateway")?;
    if !status.success() {
        anyhow::bail!("gateway frontend build exited with status {status}");
    }

    Ok(client_dist)
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

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();

    match cli.cmd {
        Commands::Gateway { cmd } => match cmd {
            GatewayCmd::Start {
                port,
                device,
                ble,
                wifi,
                wifi_port,
                no_device,
                sim_device,
                bootstrap_path,
            } => gateway_start(
                port,
                device,
                ble,
                wifi,
                wifi_port,
                no_device,
                sim_device,
                bootstrap_path,
            ),
            GatewayCmd::Serve {
                port,
                device,
                ble,
                wifi,
                wifi_port,
                no_device,
                sim_device,
                bootstrap_path,
            } => gateway_serve(
                port,
                device,
                ble,
                wifi,
                wifi_port,
                no_device,
                sim_device,
                bootstrap_path,
            ),
            GatewayCmd::Stop => gateway_stop(),
            GatewayCmd::Status => {
                match gateway_running()? {
                    Some(pid) => println!("gateway: running (pid={pid})"),
                    None => println!("gateway: not running"),
                }
                println!("{}", autostart_status()?);
                Ok(())
            }
            GatewayCmd::Autostart => {
                println!("{}", autostart_status()?);
                Ok(())
            }
        },
        Commands::Service { cmd } => match cmd {
            ServiceCmd::Install {
                port,
                device,
                ble,
                wifi,
                wifi_port,
                no_device,
                sim_device,
                bootstrap_path,
                now,
            } => service_install(
                port,
                device,
                ble,
                wifi,
                wifi_port,
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
                wifi,
                wifi_port,
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
                        wifi,
                        wifi_port,
                        no_device,
                        sim_device,
                        bootstrap_path,
                    )?
                );
                Ok(())
            }
            ServiceCmd::Start => service_start(),
            ServiceCmd::Stop => service_stop(),
            ServiceCmd::Status => service_status(),
        },
        Commands::Tui => run_tui(),
        Commands::Devices {
            json,
            wifi,
            wifi_port,
        } => list_devices(json, wifi, wifi_port),
        Commands::Doctor { wifi, wifi_port } => doctor(wifi, wifi_port),
        Commands::Run {
            script,
            name,
            port,
            gateway_url,
            timeout_ms,
            no_wait,
            device,
        } => run_script(script, name, port, gateway_url, timeout_ms, no_wait, device),
        Commands::Wifi { cmd } => match cmd {
            WifiCmd::Provision {
                ssid,
                password,
                device,
                ble,
                wifi,
                wifi_port,
            } => run_wifi_provision(ssid, password, device, ble, wifi, wifi_port),
            WifiCmd::Status {
                device,
                ble,
                wifi,
                wifi_port,
            } => run_wifi_status(device, ble, wifi, wifi_port),
            WifiCmd::Clear {
                device,
                ble,
                wifi,
                wifi_port,
            } => run_wifi_clear(device, ble, wifi, wifi_port),
        },
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
            let gateway_line = match gateway_running()? {
                Some(pid) => format!("running (pid={pid})"),
                None => "not running".to_string(),
            };
            let autostart = autostart_status()?;
            let devices = list_devices_lines(None, 3922)?;

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
                    Line::from("EMWaver Gateway".to_string())
                        .style(Style::default().add_modifier(Modifier::BOLD)),
                    Line::from(format!("gateway: {gateway_line}")),
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
                            let _ =
                                gateway_start(None, None, false, None, 3922, false, false, None);
                        }
                        KeyCode::Char('t') => {
                            let _ = gateway_stop();
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

    #[test]
    fn wifi_probe_error_classifies_busy_device() {
        let err = anyhow::anyhow!("received text frame: busy");
        assert!(classify_wifi_probe_error(&err).contains("device is busy with another session"));
    }

    #[test]
    fn wifi_probe_error_classifies_busy_text_response() {
        let err = anyhow::anyhow!("Wi-Fi device is busy with another session");
        assert!(classify_wifi_probe_error(&err).contains("device is busy with another session"));
    }
}
