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
use nix::unistd::{setsid, Pid};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::fs::OpenOptions;
use std::io::{self, ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
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

const DEFAULT_GATEWAY_PORT: u16 = 3921;
const GATEWAY_UID_POLL_INTERVAL: Duration = Duration::from_secs(5);

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

    /// Open or print Gateway target settings.
    Settings {
        #[command(subcommand)]
        cmd: Option<SettingsCmd>,
    },

    /// Show or set the saved Gateway device UID.
    Device {
        #[command(subcommand)]
        cmd: Option<DeviceSettingsCmd>,
    },

    /// Show or set the saved Gateway transport preference.
    Transport {
        #[command(subcommand)]
        cmd: Option<TransportSettingsCmd>,
    },

    /// List local devices and optionally probe a Wi-Fi endpoint.
    Devices {
        /// Print structured JSON instead of human-readable device lines.
        #[arg(long)]
        json: bool,

        /// Local gateway port (defaults to 3921).
        #[arg(long)]
        port: Option<u16>,

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

        /// Wait this long for gateway hello/script.started handshakes.
        #[arg(long, default_value_t = 5000)]
        timeout_ms: u64,

        /// Send the script and return after the gateway accepts the message.
        #[arg(long)]
        no_wait: bool,

        /// Target device id reported by the running Gateway.
        #[arg(long)]
        device: Option<String>,

        /// Transport preference for this run: auto, usb, ble, or wifi.
        #[arg(long)]
        transport: Option<String>,
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
enum SettingsCmd {
    /// Print current Gateway target settings.
    Show {
        /// Print structured JSON.
        #[arg(long)]
        json: bool,
    },

    /// Clear all saved Gateway target settings.
    Reset,
}

#[derive(Subcommand, Debug)]
enum DeviceSettingsCmd {
    /// Print the saved device UID.
    Show,

    /// Save the device UID to target by default.
    Set {
        /// Hardware UID, with or without the uid: prefix.
        uid: String,
    },

    /// Clear the saved device UID.
    Clear,
}

#[derive(Subcommand, Debug)]
enum TransportSettingsCmd {
    /// Print the saved transport preference.
    Show,

    /// Save the transport preference: auto, usb, ble, or wifi.
    Set {
        /// Transport preference.
        transport: String,
    },

    /// Clear the saved transport preference.
    Clear,
}

#[derive(Subcommand, Debug)]
enum WifiCmd {
    /// Add a manual Wi-Fi target for Gateway polling.
    Add {
        /// Hostname or IP address.
        host: String,

        /// ESP32 Wi-Fi control port.
        #[arg(long, default_value_t = 3922)]
        port: u16,
    },

    /// Remove a manual Wi-Fi target.
    Remove {
        /// Hostname or IP address.
        host: String,

        /// ESP32 Wi-Fi control port.
        #[arg(long, default_value_t = 3922)]
        port: u16,
    },

    /// List manual Wi-Fi targets.
    List,

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

fn config_dir() -> Result<PathBuf> {
    if let Some(dir) = env_trim("EMWAVER_CONFIG_DIR") {
        let d = PathBuf::from(dir);
        fs::create_dir_all(&d)?;
        return Ok(d);
    }

    let d = project_dirs()?.config_dir().to_path_buf();
    fs::create_dir_all(&d)?;
    Ok(d)
}

fn settings_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("gateway-settings.json"))
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewaySettings {
    selected_device_uid: Option<String>,
    selected_transport: Option<String>,
    #[serde(default)]
    wifi_targets: Vec<ManualWiFiTarget>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManualWiFiTarget {
    host: String,
    port: u16,
}

fn load_gateway_settings() -> Result<GatewaySettings> {
    let path = settings_path()?;
    match fs::read_to_string(&path) {
        Ok(text) => {
            let mut settings: GatewaySettings = serde_json::from_str(&text)
                .with_context(|| format!("failed to parse settings at {}", path.display()))?;
            normalize_gateway_settings(&mut settings);
            Ok(settings)
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(GatewaySettings::default()),
        Err(err) => Err(err).with_context(|| format!("failed to read {}", path.display())),
    }
}

fn save_gateway_settings(settings: &GatewaySettings) -> Result<()> {
    let mut settings = settings.clone();
    normalize_gateway_settings(&mut settings);
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_vec_pretty(&settings)?;
    fs::write(&path, body).with_context(|| format!("failed to write {}", path.display()))
}

fn normalize_gateway_settings(settings: &mut GatewaySettings) {
    settings.selected_device_uid = settings
        .selected_device_uid
        .as_deref()
        .and_then(|uid| normalize_hardware_uid(uid).ok());
    settings.selected_transport = settings
        .selected_transport
        .as_deref()
        .and_then(|transport| normalize_transport_preference(transport).ok());
    for target in &mut settings.wifi_targets {
        target.host = target.host.trim().to_string();
    }
    settings
        .wifi_targets
        .retain(|target| !target.host.is_empty() && target.port > 0);
    settings
        .wifi_targets
        .sort_by(|a, b| a.host.cmp(&b.host).then(a.port.cmp(&b.port)));
    settings
        .wifi_targets
        .dedup_by(|a, b| a.host.eq_ignore_ascii_case(&b.host) && a.port == b.port);
}

fn normalize_hardware_uid(uid: &str) -> Result<String> {
    let uid = uid.trim();
    let uid = uid
        .get(0..4)
        .filter(|prefix| prefix.eq_ignore_ascii_case("uid:"))
        .map(|_| &uid[4..])
        .unwrap_or(uid)
        .trim()
        .to_ascii_lowercase();
    if uid.len() != 12 || !uid.chars().all(|ch| ch.is_ascii_hexdigit()) {
        anyhow::bail!("device UID must be 12 hexadecimal characters");
    }
    Ok(uid)
}

fn normalize_transport_preference(transport: &str) -> Result<String> {
    let value = transport.trim().to_ascii_lowercase();
    match value.as_str() {
        "" => Ok("auto".to_string()),
        "auto" | "default" => Ok("auto".to_string()),
        "usb" | "midi" | "usb-midi" | "usbmidi" => Ok("usb".to_string()),
        "ble" | "bluetooth" => Ok("ble".to_string()),
        "wifi" | "wi-fi" => Ok("wifi".to_string()),
        _ => anyhow::bail!("transport must be auto, usb, ble, or wifi"),
    }
}

fn gateway_settings_json(settings: &GatewaySettings) -> serde_json::Value {
    serde_json::json!({
        "selectedDeviceUid": settings.selected_device_uid.clone(),
        "selectedDeviceId": settings.selected_device_uid.as_ref().map(|uid| format!("uid:{uid}")),
        "selectedTransport": settings.selected_transport.as_deref().unwrap_or("auto"),
        "wifiTargets": settings.wifi_targets.clone(),
        "settingsPath": settings_path().ok().map(|path| path.display().to_string()),
    })
}

fn print_settings(json: bool) -> Result<()> {
    let settings = load_gateway_settings()?;
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&gateway_settings_json(&settings))?
        );
        return Ok(());
    }

    println!(
        "device: {}",
        settings
            .selected_device_uid
            .as_deref()
            .map(|uid| format!("uid:{uid}"))
            .unwrap_or_else(|| "auto".to_string())
    );
    println!(
        "transport: {}",
        settings.selected_transport.as_deref().unwrap_or("auto")
    );
    if settings.wifi_targets.is_empty() {
        println!("wifi targets: none");
    } else {
        println!("wifi targets:");
        for target in settings.wifi_targets {
            println!("  {}:{}", target.host, target.port);
        }
    }
    println!("settings: {}", settings_path()?.display());
    Ok(())
}

fn print_saved_device() -> Result<()> {
    let settings = load_gateway_settings()?;
    println!(
        "{}",
        settings
            .selected_device_uid
            .as_deref()
            .map(|uid| format!("uid:{uid}"))
            .unwrap_or_else(|| "auto".to_string())
    );
    Ok(())
}

fn print_saved_transport() -> Result<()> {
    let settings = load_gateway_settings()?;
    println!(
        "{}",
        settings.selected_transport.as_deref().unwrap_or("auto")
    );
    Ok(())
}

fn print_wifi_targets() -> Result<()> {
    let settings = load_gateway_settings()?;
    if settings.wifi_targets.is_empty() {
        println!("none");
    } else {
        for target in settings.wifi_targets {
            println!("{}:{}", target.host, target.port);
        }
    }
    Ok(())
}

fn set_saved_device(uid: Option<String>) -> Result<()> {
    let mut settings = load_gateway_settings()?;
    settings.selected_device_uid = uid.as_deref().map(normalize_hardware_uid).transpose()?;
    save_gateway_settings(&settings)?;
    print_settings(false)
}

fn set_saved_transport(transport: Option<String>) -> Result<()> {
    let mut settings = load_gateway_settings()?;
    settings.selected_transport = transport
        .as_deref()
        .map(normalize_transport_preference)
        .transpose()?;
    save_gateway_settings(&settings)?;
    print_settings(false)
}

fn reset_gateway_settings() -> Result<()> {
    save_gateway_settings(&GatewaySettings::default())?;
    print_settings(false)
}

fn add_wifi_target(host: String, port: u16) -> Result<()> {
    let mut settings = load_gateway_settings()?;
    let host = host.trim().to_string();
    if host.is_empty() {
        anyhow::bail!("Wi-Fi host is required");
    }
    settings.wifi_targets.push(ManualWiFiTarget { host, port });
    save_gateway_settings(&settings)?;
    print_settings(false)
}

fn remove_wifi_target(host: String, port: u16) -> Result<()> {
    let mut settings = load_gateway_settings()?;
    let host = host.trim().to_string();
    settings
        .wifi_targets
        .retain(|target| !(target.host.eq_ignore_ascii_case(&host) && target.port == port));
    save_gateway_settings(&settings)?;
    print_settings(false)
}

fn settings_terminal_ui() -> Result<()> {
    let mut settings = load_gateway_settings()?;
    let devices_body = gateway_devices_json_if_running(DEFAULT_GATEWAY_PORT)
        .ok()
        .flatten();
    let mut uid_labels: Vec<(String, String)> = Vec::new();
    if let Some(body) = devices_body.as_ref() {
        let mut labels_by_uid: HashMap<String, Vec<String>> = HashMap::new();
        for device in body
            .get("devices")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(uid) = json_str(device, "hardwareUid") else {
                continue;
            };
            let transport = json_str(device, "transport").unwrap_or("unknown");
            let name = json_str(device, "name").unwrap_or("EMWaver device");
            labels_by_uid
                .entry(uid.to_string())
                .or_default()
                .push(format!("{transport} {name}"));
        }
        for (uid, mut labels) in labels_by_uid {
            labels.sort();
            labels.dedup();
            uid_labels.push((uid, labels.join(", ")));
        }
        uid_labels.sort_by(|a, b| a.0.cmp(&b.0));
    }

    println!("EMWaver Gateway Settings");
    println!(
        "current device: {}",
        settings
            .selected_device_uid
            .as_deref()
            .map(|uid| format!("uid:{uid}"))
            .unwrap_or_else(|| "auto".to_string())
    );
    println!(
        "current transport: {}",
        settings.selected_transport.as_deref().unwrap_or("auto")
    );
    println!();
    if uid_labels.is_empty() {
        println!("No UID-backed Gateway devices are currently reported.");
    } else {
        println!("Devices:");
        for (idx, (uid, label)) in uid_labels.iter().enumerate() {
            println!("  {}. uid:{} ({label})", idx + 1, uid);
        }
    }

    print!("Select device number, UID, `auto`, or Enter to keep: ");
    io::stdout().flush()?;
    let mut line = String::new();
    io::stdin().read_line(&mut line)?;
    let device_choice = line.trim();
    if !device_choice.is_empty() {
        if device_choice.eq_ignore_ascii_case("auto") || device_choice.eq_ignore_ascii_case("clear")
        {
            settings.selected_device_uid = None;
        } else if let Ok(idx) = device_choice.parse::<usize>() {
            let Some((uid, _)) = uid_labels.get(idx.saturating_sub(1)) else {
                anyhow::bail!("device selection is out of range");
            };
            settings.selected_device_uid = Some(uid.clone());
        } else {
            settings.selected_device_uid = Some(normalize_hardware_uid(device_choice)?);
        }
    }

    print!("Select transport auto/usb/ble/wifi, `clear`, or Enter to keep: ");
    io::stdout().flush()?;
    line.clear();
    io::stdin().read_line(&mut line)?;
    let transport_choice = line.trim();
    if !transport_choice.is_empty() {
        if transport_choice.eq_ignore_ascii_case("clear") {
            settings.selected_transport = None;
        } else {
            settings.selected_transport = Some(normalize_transport_preference(transport_choice)?);
        }
    }

    save_gateway_settings(&settings)?;
    println!();
    print_settings(false)
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

    #[cfg(unix)]
    unsafe {
        cmd.pre_exec(|| {
            setsid()
                .map(|_| ())
                .map_err(|err| std::io::Error::new(ErrorKind::Other, err.to_string()))
        });
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
Environment=RUST_LOG=emwaver=info,emwaver_device=info,emwaver_runtime=info,btleplug=off

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

#[derive(Clone)]
struct GatewayDeviceEntry {
    transport_id: String,
    name: String,
    transport: String,
    priority: u8,
    board_type: String,
    firmware_version: Option<String>,
    hardware_uid: Option<String>,
    endpoint: Option<String>,
    address: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    addresses: Vec<String>,
    connected: bool,
    bridge: Arc<dyn CommandBridge>,
    sender: Option<Arc<dyn DeviceCommandSender>>,
}

impl GatewayDeviceEntry {
    fn device_key(&self) -> Option<String> {
        self.hardware_uid
            .as_deref()
            .map(str::trim)
            .filter(|uid| !uid.is_empty())
            .map(|uid| format!("uid:{uid}"))
    }

    fn to_json(
        &self,
        settings: &GatewaySettings,
        active_transport_id: Option<&str>,
    ) -> serde_json::Value {
        let device_key = self.device_key();
        let selected_uid = settings.selected_device_uid.as_deref();
        let selected_transport = settings.selected_transport.as_deref().unwrap_or("auto");
        let is_selected_device = selected_uid
            .zip(self.hardware_uid.as_deref())
            .is_some_and(|(selected, uid)| selected.eq_ignore_ascii_case(uid));
        let is_selected_transport = selected_transport == "auto"
            || selected_transport == transport_setting_name(&self.transport);
        serde_json::json!({
            "id": self.transport_id,
            "deviceKey": device_key,
            "transportId": self.transport_id,
            "name": self.name,
            "transport": self.transport,
            "boardType": self.board_type,
            "firmwareVersion": self.firmware_version,
            "hardwareUid": self.hardware_uid,
            "endpoint": self.endpoint,
            "address": self.address,
            "host": self.host,
            "port": self.port,
            "addresses": self.addresses,
            "connected": self.connected,
            "connectionState": if self.connected { "connected" } else { "disconnected" },
            "isActive": active_transport_id == Some(self.transport_id.as_str()),
            "isSelected": is_selected_device && is_selected_transport,
        })
    }
}

struct GatewayDeviceRegistry {
    devices: Mutex<Vec<GatewayDeviceEntry>>,
    settings: Mutex<GatewaySettings>,
    no_device: bool,
    sim_device: bool,
    startup_wifi_targets: Vec<ManualWiFiTarget>,
}

struct ResolvedGatewayBridge {
    bridge: Arc<dyn CommandBridge>,
    device_id: Option<String>,
    transport_id: Option<String>,
    warning: Option<String>,
}

impl GatewayDeviceRegistry {
    fn new(
        no_device: bool,
        sim_device: bool,
        startup_wifi_targets: Vec<ManualWiFiTarget>,
    ) -> Result<Self> {
        let settings = load_gateway_settings()?;
        Ok(Self {
            devices: Mutex::new(Vec::new()),
            settings: Mutex::new(settings),
            no_device,
            sim_device,
            startup_wifi_targets,
        })
    }

    fn refresh(&self) -> Result<()> {
        if let Ok(settings) = load_gateway_settings() {
            *self.settings.lock().unwrap() = settings;
        }

        if self.no_device {
            *self.devices.lock().unwrap() = vec![GatewayDeviceEntry {
                transport_id: "local-gateway-no-device".to_string(),
                name: "Gateway hardware disabled".to_string(),
                transport: "None".to_string(),
                priority: 255,
                board_type: "none".to_string(),
                firmware_version: None,
                hardware_uid: None,
                endpoint: None,
                address: None,
                host: None,
                port: None,
                addresses: Vec::new(),
                connected: true,
                bridge: Arc::new(NoDeviceCommandBridge),
                sender: None,
            }];
            return Ok(());
        }

        if self.sim_device {
            *self.devices.lock().unwrap() = vec![GatewayDeviceEntry {
                transport_id: "local-gateway-sim".to_string(),
                name: "EMWaver simulator".to_string(),
                transport: "Simulator".to_string(),
                priority: 254,
                board_type: "sim".to_string(),
                firmware_version: None,
                hardware_uid: None,
                endpoint: None,
                address: None,
                host: None,
                port: None,
                addresses: Vec::new(),
                connected: true,
                bridge: Arc::new(SimulatorCommandBridge::basic_board()?),
                sender: None,
            }];
            return Ok(());
        }

        let previous = self.devices.lock().unwrap().clone();
        let mut previous_by_transport: HashMap<String, GatewayDeviceEntry> = previous
            .into_iter()
            .map(|entry| (entry.transport_id.clone(), entry))
            .collect();
        let mut refreshed = Vec::new();
        refresh_gateway_midi_devices(&mut refreshed, &mut previous_by_transport);
        refresh_gateway_ble_devices(&mut refreshed, &mut previous_by_transport);
        refresh_gateway_wifi_devices(
            &mut refreshed,
            &mut previous_by_transport,
            &self.settings.lock().unwrap(),
            &self.startup_wifi_targets,
        );
        refreshed.sort_by(|a, b| {
            a.priority
                .cmp(&b.priority)
                .then(a.hardware_uid.cmp(&b.hardware_uid))
                .then(a.transport_id.cmp(&b.transport_id))
        });
        refreshed.dedup_by(|a, b| a.transport_id == b.transport_id);
        *self.devices.lock().unwrap() = refreshed;
        Ok(())
    }

    fn snapshot(&self) -> Vec<GatewayDeviceEntry> {
        self.devices.lock().unwrap().clone()
    }

    fn settings(&self) -> GatewaySettings {
        self.settings.lock().unwrap().clone()
    }

    fn replace_settings(&self, settings: GatewaySettings) -> Result<()> {
        save_gateway_settings(&settings)?;
        *self.settings.lock().unwrap() = load_gateway_settings()?;
        Ok(())
    }

    fn devices_json(&self) -> Vec<serde_json::Value> {
        let settings = self.settings();
        let resolved = self.resolve(None, None).ok();
        let active_transport_id = resolved
            .as_ref()
            .and_then(|resolved| resolved.transport_id.as_deref());
        self.snapshot()
            .into_iter()
            .map(|entry| entry.to_json(&settings, active_transport_id))
            .collect()
    }

    fn resolve(
        &self,
        requested_device_id: Option<&str>,
        requested_transport: Option<&str>,
    ) -> Result<ResolvedGatewayBridge> {
        let devices = self.snapshot();
        if devices.is_empty() {
            anyhow::bail!("no UID-validated EMWaver devices are available");
        }

        let settings = self.settings();
        let requested_device_id = requested_device_id
            .map(str::trim)
            .filter(|id| !id.is_empty());
        if let Some(transport_id) = requested_device_id.filter(|id| is_transport_id(id)) {
            let entry = devices
                .iter()
                .find(|entry| entry.transport_id == transport_id)
                .with_context(|| format!("Gateway transport is unavailable: {transport_id}"))?;
            return Ok(ResolvedGatewayBridge {
                bridge: entry.bridge.clone(),
                device_id: entry.device_key(),
                transport_id: Some(entry.transport_id.clone()),
                warning: None,
            });
        }

        let requested_uid = requested_device_id
            .or_else(|| settings.selected_device_uid.as_deref())
            .map(normalize_hardware_uid)
            .transpose()?;
        let transport = requested_transport
            .or(settings.selected_transport.as_deref())
            .map(normalize_transport_preference)
            .transpose()?
            .unwrap_or_else(|| "auto".to_string());

        let mut candidates: Vec<&GatewayDeviceEntry> = devices
            .iter()
            .filter(|entry| entry.connected)
            .filter(|entry| {
                requested_uid
                    .as_deref()
                    .zip(entry.hardware_uid.as_deref())
                    .map(|(wanted, actual)| wanted.eq_ignore_ascii_case(actual))
                    .unwrap_or_else(|| requested_uid.is_none())
            })
            .collect();

        if candidates.is_empty() {
            if let Some(uid) = requested_uid.as_deref() {
                anyhow::bail!("selected device uid:{uid} is not available");
            }
            anyhow::bail!("no UID-validated EMWaver devices are available");
        }

        candidates.sort_by(|a, b| {
            a.priority
                .cmp(&b.priority)
                .then(a.transport_id.cmp(&b.transport_id))
        });
        let exact = if transport == "auto" {
            None
        } else {
            candidates
                .iter()
                .copied()
                .find(|entry| transport_setting_name(&entry.transport) == transport)
        };
        let selected = exact.unwrap_or(candidates[0]);
        let warning = if transport != "auto" && exact.is_none() {
            Some(format!(
                "selected {transport} transport is unavailable; using {} for {}",
                selected.transport,
                selected
                    .hardware_uid
                    .as_deref()
                    .map(|uid| format!("uid:{uid}"))
                    .unwrap_or_else(|| selected.transport_id.clone())
            ))
        } else {
            None
        };

        Ok(ResolvedGatewayBridge {
            bridge: selected.bridge.clone(),
            device_id: selected.device_key(),
            transport_id: Some(selected.transport_id.clone()),
            warning,
        })
    }
}

fn is_transport_id(value: &str) -> bool {
    value.starts_with("midi:") || value.starts_with("ble:") || value.starts_with("wifi:")
}

fn transport_setting_name(transport: &str) -> &'static str {
    match transport {
        "USB" => "usb",
        "BLE" => "ble",
        "Wi-Fi" => "wifi",
        _ => "auto",
    }
}

fn refresh_gateway_midi_devices(
    out: &mut Vec<GatewayDeviceEntry>,
    previous: &mut HashMap<String, GatewayDeviceEntry>,
) {
    let Ok(devices) = emwaver_device::list_devices() else {
        return;
    };
    for info in devices {
        let transport_id = format!("midi:{}", info.id);
        if let Some(entry) = previous.remove(&transport_id) {
            if let Some(entry) = refresh_existing_gateway_entry(entry) {
                out.push(entry);
                continue;
            }
        }

        let device = Device::new();
        if device.connect_by_id(&info.id).is_err() {
            continue;
        }
        let bridge = Arc::new(DeviceCommandBridge { device });
        let sender: Arc<dyn DeviceCommandSender> = bridge.clone();
        let Some((hardware_uid, firmware_version)) = query_gateway_identity(sender.as_ref()) else {
            continue;
        };
        out.push(GatewayDeviceEntry {
            transport_id,
            name: info.name.clone(),
            transport: "USB".to_string(),
            priority: 0,
            board_type: infer_gateway_board_type(&info.name, info.likely_emwaver),
            firmware_version,
            hardware_uid: Some(hardware_uid),
            endpoint: None,
            address: None,
            host: None,
            port: None,
            addresses: Vec::new(),
            connected: true,
            bridge,
            sender: Some(sender),
        });
    }
}

fn refresh_gateway_ble_devices(
    out: &mut Vec<GatewayDeviceEntry>,
    previous: &mut HashMap<String, GatewayDeviceEntry>,
) {
    let Ok(devices) = list_ble_devices(1_500) else {
        return;
    };
    for info in devices {
        let transport_id = format!("ble:{}", info.id);
        if let Some(entry) = previous.remove(&transport_id) {
            out.push(entry);
            continue;
        }

        let Ok(device) = BleDevice::connect_by_id(&info.id, 3_000) else {
            continue;
        };
        let bridge = Arc::new(BleCommandBridge { device });
        let sender: Arc<dyn DeviceCommandSender> = bridge.clone();
        let Some((hardware_uid, firmware_version)) = query_gateway_identity(sender.as_ref()) else {
            continue;
        };
        out.push(GatewayDeviceEntry {
            transport_id,
            name: info.name,
            transport: "BLE".to_string(),
            priority: 1,
            board_type: "esp32s3".to_string(),
            firmware_version,
            hardware_uid: Some(hardware_uid),
            endpoint: None,
            address: Some(info.address),
            host: None,
            port: None,
            addresses: Vec::new(),
            connected: true,
            bridge,
            sender: Some(sender),
        });
    }

    let remaining_ble_ids: Vec<String> = previous
        .keys()
        .filter(|transport_id| transport_id.starts_with("ble:"))
        .cloned()
        .collect();
    for transport_id in remaining_ble_ids {
        if let Some(entry) = previous.remove(&transport_id) {
            if let Some(entry) = refresh_existing_gateway_entry(entry) {
                out.push(entry);
            }
        }
    }
}

fn refresh_gateway_wifi_devices(
    out: &mut Vec<GatewayDeviceEntry>,
    previous: &mut HashMap<String, GatewayDeviceEntry>,
    settings: &GatewaySettings,
    startup_targets: &[ManualWiFiTarget],
) {
    let mut infos = list_wifi_devices(1_500).unwrap_or_default();
    for target in settings.wifi_targets.iter().chain(startup_targets.iter()) {
        if infos
            .iter()
            .any(|info| info.host.eq_ignore_ascii_case(&target.host) && info.port == target.port)
        {
            continue;
        }
        infos.push(WiFiDeviceInfo {
            id: format!("manual:{}:{}", target.host, target.port),
            name: format!("ESP32 Wi-Fi {}:{}", target.host, target.port),
            host: target.host.clone(),
            port: target.port,
            addresses: vec![target.host.clone()],
            txt: HashMap::new(),
        });
    }

    for info in infos
        .into_iter()
        .filter(wifi_record_advertises_supported_runtime)
    {
        let transport_id = format!("wifi:{}:{}", info.host, info.port);
        if let Some(entry) = previous.remove(&transport_id) {
            if let Some(entry) = refresh_existing_gateway_entry(entry) {
                out.push(entry);
                continue;
            }
        }

        let Ok(device) = WiFiDevice::connect(&info.host, info.port) else {
            continue;
        };
        let bridge = Arc::new(WiFiCommandBridge { device });
        let sender: Arc<dyn DeviceCommandSender> = bridge.clone();
        let Some((hardware_uid, firmware_version)) = query_gateway_identity(sender.as_ref()) else {
            continue;
        };
        let board_type = info
            .txt
            .get("board")
            .cloned()
            .unwrap_or_else(|| "esp32".to_string());
        let firmware_version = firmware_version.or_else(|| info.txt.get("fw").cloned());
        out.push(GatewayDeviceEntry {
            transport_id,
            name: info.name,
            transport: "Wi-Fi".to_string(),
            priority: 2,
            board_type,
            firmware_version,
            hardware_uid: Some(hardware_uid),
            endpoint: Some(format!("{}:{}", info.host, info.port)),
            address: None,
            host: Some(info.host),
            port: Some(info.port),
            addresses: info.addresses,
            connected: true,
            bridge,
            sender: Some(sender),
        });
    }

    for (_transport_id, entry) in previous
        .drain()
        .filter(|(transport_id, _)| transport_id.starts_with("wifi:"))
    {
        if let Some(entry) = refresh_existing_gateway_entry(entry) {
            out.push(entry);
        }
    }
}

fn refresh_existing_gateway_entry(mut entry: GatewayDeviceEntry) -> Option<GatewayDeviceEntry> {
    let sender = entry.sender.as_ref()?;
    let (hardware_uid, firmware_version) = query_gateway_identity(sender.as_ref())?;
    entry.hardware_uid = Some(hardware_uid);
    if firmware_version.is_some() {
        entry.firmware_version = firmware_version;
    }
    entry.connected = true;
    Some(entry)
}

fn query_gateway_identity(sender: &dyn DeviceCommandSender) -> Option<(String, Option<String>)> {
    let uid = query_hardware_uid(sender, 1_500).ok().flatten()?;
    let version = query_version(sender, 1_000).unwrap_or(None);
    Some((uid, version))
}

fn infer_gateway_board_type(name: &str, likely_emwaver: bool) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.contains("esp32-s2") || lower.contains("esp32s2") {
        "esp32s2".to_string()
    } else if lower.contains("esp32-s3") || lower.contains("esp32s3") || lower.contains("s3") {
        "esp32s3".to_string()
    } else if lower.contains("esp32") {
        "esp32".to_string()
    } else if likely_emwaver {
        "emwaver".to_string()
    } else {
        "unknown".to_string()
    }
}

fn gateway_http_json(port: u16, path: &str) -> Result<serde_json::Value> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .with_context(|| format!("failed to connect to Gateway HTTP on 127.0.0.1:{port}"))?;
    let timeout = Duration::from_millis(1_500);
    stream
        .set_read_timeout(Some(timeout))
        .context("failed to set Gateway HTTP read timeout")?;
    stream
        .set_write_timeout(Some(timeout))
        .context("failed to set Gateway HTTP write timeout")?;

    let request = format!(
        "GET {path} HTTP/1.1\r\nhost: 127.0.0.1:{port}\r\naccept: application/json\r\nconnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .context("failed to send Gateway HTTP request")?;

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .context("failed to read Gateway HTTP response")?;
    let response = String::from_utf8_lossy(&response);
    let (head, body) = response
        .split_once("\r\n\r\n")
        .context("Gateway HTTP response missing header separator")?;
    let status = head.lines().next().unwrap_or("");
    if !status.contains(" 200 ") {
        anyhow::bail!("Gateway HTTP request failed: {status}");
    }
    serde_json::from_str(body).context("failed to parse Gateway JSON response")
}

fn gateway_devices_json_if_running(port: u16) -> Result<Option<serde_json::Value>> {
    let Some(_pid) = gateway_running()? else {
        return Ok(None);
    };
    gateway_http_json(port, "/v1/devices").map(Some)
}

fn json_str<'a>(value: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(serde_json::Value::as_str)
}

fn gateway_devices_lines(body: &serde_json::Value) -> Vec<String> {
    let devices = body
        .get("devices")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    if devices.is_empty() {
        return vec!["Gateway devices: none".to_string()];
    }

    let mut out = vec!["Gateway devices:".to_string()];
    for device in devices {
        let id = json_str(&device, "id").unwrap_or("unknown");
        let name = json_str(&device, "name").unwrap_or("unknown device");
        let transport = json_str(&device, "transport").unwrap_or("unknown transport");
        let board = json_str(&device, "boardType").unwrap_or("unknown board");
        let firmware = json_str(&device, "firmwareVersion").unwrap_or("unknown fw");
        let uid = json_str(&device, "hardwareUid").unwrap_or("no UID");
        let connected = device
            .get("connected")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let endpoint = json_str(&device, "endpoint")
            .map(|endpoint| format!(", {endpoint}"))
            .unwrap_or_default();
        let state = if connected {
            "connected"
        } else {
            "disconnected"
        };
        out.push(format!(
            "  {id}: {name} ({transport}, {board}, {firmware}, UID {uid}, {state}{endpoint})"
        ));
    }
    out
}

fn list_devices_lines(
    wifi: Option<String>,
    wifi_port: u16,
    gateway_port: u16,
) -> Result<Vec<String>> {
    if let Some(body) = gateway_devices_json_if_running(gateway_port)? {
        let mut lines = gateway_devices_lines(&body);
        if wifi.is_some() {
            lines.push(
                "Gateway is running; showing Gateway-owned devices instead of probing Wi-Fi directly."
                    .to_string(),
            );
        }
        return Ok(lines);
    }

    let _ = (wifi, wifi_port);
    Ok(vec![
        "Gateway devices: unavailable".to_string(),
        "Gateway is not running. Start it with `emw gateway start`.".to_string(),
    ])
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

fn list_devices(json: bool, wifi: Option<String>, wifi_port: u16, port: Option<u16>) -> Result<()> {
    let gateway_port = port.unwrap_or(DEFAULT_GATEWAY_PORT);
    if let Some(body) = gateway_devices_json_if_running(gateway_port)? {
        if json {
            println!("{}", serde_json::to_string_pretty(&body)?);
        } else {
            for line in gateway_devices_lines(&body) {
                println!("{line}");
            }
            if wifi.is_some() {
                println!(
                    "Gateway is running; showing Gateway-owned devices instead of probing Wi-Fi directly."
                );
            }
        }
        return Ok(());
    }

    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "ok": false,
                "error": "gateway_not_running",
                "message": "Gateway is not running. Start it with `emw gateway start`.",
                "devices": [],
            }))?
        );
        return Ok(());
    }
    let _ = (wifi, wifi_port);
    for line in list_devices_lines(None, 3922, gateway_port)? {
        println!("{line}");
    }
    Ok(())
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

    match list_devices_lines(None, 3922, DEFAULT_GATEWAY_PORT) {
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
    transport: Option<String>,
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
            "role": "cli",
            "protocolVersion": 1,
        })
        .to_string(),
    ))
    .context("failed to send gateway hello")?;

    let hello_deadline = Instant::now() + timeout;
    loop {
        let msg = match ws.read() {
            Ok(msg) => msg,
            Err(tungstenite::Error::Io(err))
                if matches!(err.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) =>
            {
                if Instant::now() >= hello_deadline {
                    anyhow::bail!("timed out waiting for gateway hello.ack");
                }
                continue;
            }
            Err(err) => return Err(err).context("failed waiting for gateway hello.ack"),
        };
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
            "transport": transport,
        })
        .to_string(),
    ))
    .context("failed to send script.run")?;

    if no_wait {
        println!("sent {name} to {url}");
        return Ok(());
    }

    let interrupted = Arc::new(AtomicBool::new(false));
    let interrupt_flag = interrupted.clone();
    ctrlc::set_handler(move || {
        interrupt_flag.store(true, Ordering::SeqCst);
    })
    .context("failed to install Ctrl-C handler")?;

    if let MaybeTlsStream::Plain(stream) = ws.get_mut() {
        stream
            .set_read_timeout(Some(Duration::from_millis(250)))
            .context("failed to set streaming read timeout")?;
    }

    let started_deadline = Instant::now() + timeout;
    let mut script_started = false;
    let mut active_script_id = None::<String>;

    loop {
        if interrupted.swap(false, Ordering::SeqCst) {
            let id = active_script_id
                .as_deref()
                .unwrap_or("local");
            let _ = ws.send(Message::Text(
                serde_json::json!({
                    "type": "script.stop",
                    "hostSessionId": "local",
                    "scriptInstanceId": id,
                })
                .to_string(),
            ));
            println!("interrupt: stop requested");
            return Ok(());
        }

        let msg = match ws.read() {
            Ok(msg) => msg,
            Err(tungstenite::Error::Io(err))
                if matches!(err.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) =>
            {
                if !script_started && Instant::now() >= started_deadline {
                    anyhow::bail!("timed out waiting for script.started from gateway");
                }
                continue;
            }
            Err(tungstenite::Error::ConnectionClosed) => {
                if script_started {
                    anyhow::bail!("gateway disconnected while script was running");
                }
                anyhow::bail!("gateway disconnected before script started");
            }
            Err(err) => return Err(err).context("failed waiting for script result from gateway"),
        };
        let Message::Text(text) = msg else {
            continue;
        };
        let value: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        let msg_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");

        let script_instance_id = value
            .get("scriptInstanceId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !script_instance_id.is_empty() {
            active_script_id = Some(script_instance_id.to_string());
        }

        match msg_type {
            "script.started" => {
                if !script_started {
                    script_started = true;
                    if let Some(id) = &active_script_id {
                        println!("running script {id}");
                    }
                    println!("started {name}");
                }
                if let Some(warning) = value.get("warning").and_then(|v| v.as_str()) {
                    println!("warning: {warning}");
                }
            }
            "script.log" => {
                let level = value.get("level").and_then(|v| v.as_str()).unwrap_or("log");
                let message = value
                    .get("message")
                    .and_then(|v| v.as_str())
                    .map(String::from)
                    .unwrap_or_else(|| value.get("message").map_or_else(|| "".to_string(), |v| v.to_string()));
                if level == "log" {
                    println!("{message}");
                } else {
                    println!("[{level}] {message}");
                }
            }
            "script.error" | "host.error" => {
                let error = value
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown_error");
                anyhow::bail!("{msg_type}: {error}");
            }
            "script.stopped" => {
                if script_started {
                    if let Some(reason) = value.get("reason").and_then(|v| v.as_str()) {
                        println!("stopped ({reason})");
                    } else {
                        println!("stopped");
                    }
                    return Ok(());
                }
            }
            _ => {}
        }
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
    _device_id: Option<String>,
    _ble: bool,
    wifi: Option<String>,
    wifi_port: u16,
    no_device: bool,
    sim_device: bool,
    bootstrap_path: Option<PathBuf>,
) -> Result<()> {
    if no_device && sim_device {
        anyhow::bail!("--no-device cannot be combined with --sim-device");
    }
    if let Some(parent) = pidfile_path()?.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(pidfile_path()?, std::process::id().to_string())?;

    let client_dist = prepare_gateway_client()?;
    let bootstrap_path = bootstrap_path.unwrap_or_else(default_bootstrap_path);
    let bootstrap = fs::read_to_string(&bootstrap_path)
        .with_context(|| format!("failed to read bootstrap at {}", bootstrap_path.display()))?;
    let startup_wifi_targets = wifi
        .map(|host| ManualWiFiTarget {
            host,
            port: wifi_port,
        })
        .into_iter()
        .collect();
    let device_registry = Arc::new(GatewayDeviceRegistry::new(
        no_device,
        sim_device,
        startup_wifi_targets,
    )?);
    if let Err(err) = device_registry.refresh() {
        info!("initial Gateway device refresh failed: {err:#}");
    }
    {
        let device_registry = device_registry.clone();
        thread::spawn(move || loop {
            thread::sleep(GATEWAY_UID_POLL_INTERVAL);
            if let Err(err) = device_registry.refresh() {
                info!("Gateway device refresh failed: {err:#}");
            }
        });
    }

    let state = Arc::new(GatewayServerState {
        bootstrap: Arc::new(bootstrap),
        device_registry,
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
    device_registry: Arc<GatewayDeviceRegistry>,
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
                    send_script_log_events(&mut ws, engine, script_id)?;
                    if pump_engine_timers(&mut ws, engine, script_id, &mut rev)? > 0 {
                        continue;
                    }
                    send_script_log_events(&mut ws, engine, script_id)?;
                }
                if last_status.elapsed() >= GATEWAY_UID_POLL_INTERVAL {
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
            if role != "web" && role != "cli" {
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
                    "role": role,
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
                let requested_transport = value
                    .get("transport")
                    .and_then(|v| v.as_str())
                    .filter(|transport| !transport.trim().is_empty())
                    .map(str::to_string);
                let script_id = format!("local-{}", std::process::id());
                active_engine = None;
                active_script_id = Some(script_id.clone());
                rev = 0;
                let mut resolved_target: Option<ResolvedGatewayBridge> = None;

                let result = (|| -> Result<Engine> {
                    if source.trim().is_empty() {
                        anyhow::bail!("script source is empty");
                    }
                    let resolved = state.device_registry.resolve(
                        requested_device_id.as_deref(),
                        requested_transport.as_deref(),
                    )?;
                    let script_bridge = resolved.bridge.clone();
                    resolved_target = Some(resolved);
                    let engine = Engine::new(state.bootstrap.as_str(), script_bridge)?;
                    engine.run_script(&source)?;
                    Ok(engine)
                })();

                match result {
                    Ok(engine) => {
                        let resolved_device_id = resolved_target
                            .as_ref()
                            .and_then(|target| target.device_id.clone())
                            .or(requested_device_id.clone());
                        let resolved_transport_id = resolved_target
                            .as_ref()
                            .and_then(|target| target.transport_id.clone());
                        let warning = resolved_target
                            .as_ref()
                            .and_then(|target| target.warning.clone());
                        send_ws_json(
                            &mut ws,
                            serde_json::json!({
                                "type": "script.started",
                                "hostSessionId": "local",
                                "scriptInstanceId": script_id,
                                "name": name,
                                "deviceId": resolved_device_id,
                                "transportId": resolved_transport_id,
                                "warning": warning,
                            }),
                        )?;
                        rev += 1;
                        send_ui_snapshot(
                            &mut ws,
                            &engine,
                            active_script_id.as_deref().unwrap(),
                            rev,
                        )?;
                        send_script_log_events(&mut ws, &engine, &script_id)?;
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
                if let Some(engine) = active_engine.as_ref() {
                    send_script_log_events(&mut ws, engine, &script_id)?;
                }
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
                        send_script_log_events(&mut ws, engine, script_id)?;
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
            send_script_log_events(&mut ws, engine, script_id)?;
            pump_engine_timers(&mut ws, engine, script_id, &mut rev)?;
        }
    }
}

fn send_script_log_events<S: Read + Write>(
    ws: &mut WebSocket<S>,
    engine: &Engine,
    script_id: &str,
) -> Result<()> {
    for event in engine.drain_log_events() {
        send_ws_json(
            ws,
            serde_json::json!({
                "type": "script.log",
                "hostSessionId": "local",
                "scriptInstanceId": script_id,
                "level": event.level,
                "message": event.message,
                "ts": event.ts,
                "seq": event.seq,
            }),
        )?;
    }
    Ok(())
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
    let settings = state.device_registry.settings();
    send_ws_json(
        ws,
        serde_json::json!({
            "type": "device.status",
            "hostSessionId": "local",
            "connected": true,
            "runtimeOwner": "emwaver-gateway",
            "devices": state.device_registry.devices_json(),
            "settings": gateway_settings_json(&settings),
        }),
    )?;
    Ok(())
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
        ("GET", "/v1/devices") => write_http_json(
            &mut stream,
            200,
            serde_json::json!({
                "ok": true,
                "devices": state.device_registry.devices_json(),
                "settings": gateway_settings_json(&state.device_registry.settings()),
            }),
        ),
        ("GET", "/v1/settings") => write_http_json(
            &mut stream,
            200,
            serde_json::json!({
                "ok": true,
                "settings": gateway_settings_json(&state.device_registry.settings()),
            }),
        ),
        ("POST", "/v1/settings") => {
            match serde_json::from_slice::<GatewaySettings>(&request.body) {
                Ok(settings) => match state.device_registry.replace_settings(settings) {
                    Ok(()) => write_http_json(
                        &mut stream,
                        200,
                        serde_json::json!({
                            "ok": true,
                            "settings": gateway_settings_json(&state.device_registry.settings()),
                        }),
                    ),
                    Err(err) => write_http_json(
                        &mut stream,
                        400,
                        serde_json::json!({
                            "ok": false,
                            "error": "settings_failed",
                            "message": err.to_string(),
                        }),
                    ),
                },
                Err(err) => write_http_json(
                    &mut stream,
                    400,
                    serde_json::json!({
                        "ok": false,
                        "error": "invalid_settings",
                        "message": err.to_string(),
                    }),
                ),
            }
        }
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
    body: Vec<u8>,
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
    let body = buffer[body_start..buffer.len().min(body_start + content_length)].to_vec();
    Ok(HttpRequest { method, path, body })
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
    println!("config dir: {}", config_dir()?.display());
    println!("settings:   {}", settings_path()?.display());
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
    let log_filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        tracing_subscriber::EnvFilter::new(
            "emwaver=info,emwaver_device=info,emwaver_runtime=info,btleplug=off",
        )
    });
    tracing_subscriber::fmt().with_env_filter(log_filter).init();

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
        Commands::Settings { cmd } => match cmd {
            None => settings_terminal_ui(),
            Some(SettingsCmd::Show { json }) => print_settings(json),
            Some(SettingsCmd::Reset) => reset_gateway_settings(),
        },
        Commands::Device { cmd } => match cmd {
            None | Some(DeviceSettingsCmd::Show) => print_saved_device(),
            Some(DeviceSettingsCmd::Set { uid }) => set_saved_device(Some(uid)),
            Some(DeviceSettingsCmd::Clear) => set_saved_device(None),
        },
        Commands::Transport { cmd } => match cmd {
            None | Some(TransportSettingsCmd::Show) => print_saved_transport(),
            Some(TransportSettingsCmd::Set { transport }) => set_saved_transport(Some(transport)),
            Some(TransportSettingsCmd::Clear) => set_saved_transport(None),
        },
        Commands::Devices {
            json,
            port,
            wifi,
            wifi_port,
        } => list_devices(json, wifi, wifi_port, port),
        Commands::Doctor { wifi, wifi_port } => doctor(wifi, wifi_port),
        Commands::Run {
            script,
            name,
            port,
            gateway_url,
            timeout_ms,
            no_wait,
            device,
            transport,
        } => run_script(
            script,
            name,
            port,
            gateway_url,
            timeout_ms,
            no_wait,
            device,
            transport,
        ),
        Commands::Wifi { cmd } => match cmd {
            WifiCmd::Add { host, port } => add_wifi_target(host, port),
            WifiCmd::Remove { host, port } => remove_wifi_target(host, port),
            WifiCmd::List => print_wifi_targets(),
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
            let devices = list_devices_lines(None, 3922, DEFAULT_GATEWAY_PORT)?;

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
    fn gateway_settings_normalize_uid_prefix() {
        assert_eq!(
            normalize_hardware_uid(" UID:D83BDAA4EC7C ").unwrap(),
            "d83bdaa4ec7c"
        );
        assert!(normalize_hardware_uid("d83b").is_err());
    }

    #[test]
    fn gateway_settings_normalize_transport_aliases() {
        assert_eq!(normalize_transport_preference("usb-midi").unwrap(), "usb");
        assert_eq!(normalize_transport_preference("Wi-Fi").unwrap(), "wifi");
        assert_eq!(normalize_transport_preference("").unwrap(), "auto");
        assert!(normalize_transport_preference("serial").is_err());
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
