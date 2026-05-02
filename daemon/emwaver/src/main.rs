use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use directories::ProjectDirs;
use emwaver_device::Device;
use emwaver_runtime::{CommandBridge, Engine, SimulatorCommandBridge};
use nix::sys::signal::kill;
use nix::unistd::Pid;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn};
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
    /// Manage the headless host daemon.
    Daemon {
        #[command(subcommand)]
        cmd: DaemonCmd,
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
    },

    /// Alias for `gateway`.
    Web {
        /// Local gateway port (defaults to 3921).
        #[arg(long)]
        port: Option<u16>,
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
    /// Start the daemon as a background process and write a pidfile.
    Start {
        /// Backend base URL (defaults to https://api.emwavers.com)
        #[arg(long)]
        backend_url: Option<String>,

        /// ID token (optional for now)
        #[arg(long)]
        id_token: Option<String>,

        /// Host session id (optional)
        #[arg(long)]
        host_session_id: Option<String>,

        /// Override bootstrap script path (dev)
        #[arg(long)]
        bootstrap_path: Option<String>,

        /// MIDI input port id from `emwaver devices`.
        #[arg(long)]
        device_id: Option<String>,

        /// Replace any existing pidfile by stopping the previous daemon.
        #[arg(long)]
        force: bool,
    },

    /// Stop the daemon (best-effort).
    Stop,

    /// Print daemon status (running/not running) and autostart status.
    Status,

    /// Check whether autostart is configured (macOS launchd / Linux systemd).
    Autostart,
}

fn project_dirs() -> Result<ProjectDirs> {
    ProjectDirs::from("com", "EMWaver", "emwaver")
        .context("failed to resolve per-user data directories")
}

fn state_dir() -> Result<PathBuf> {
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

fn daemon_running() -> Result<Option<i32>> {
    let pidfile = pidfile_path()?;
    let Some(pid) = read_pid(&pidfile) else {
        return Ok(None);
    };
    if is_running(pid) {
        Ok(Some(pid))
    } else {
        // stale pidfile
        let _ = fs::remove_file(pidfile);
        Ok(None)
    }
}

fn daemon_start(
    backend_url: Option<String>,
    id_token: Option<String>,
    host_session_id: Option<String>,
    bootstrap_path: Option<String>,
    device_id: Option<String>,
    force: bool,
) -> Result<()> {
    if let Some(pid) = daemon_running()? {
        if force {
            warn!("daemon already running (pid={pid}), stopping due to --force");
            daemon_stop()?;
        } else {
            anyhow::bail!(
                "daemon already running (pid={pid}). Use `emwaver daemon status` or pass --force"
            );
        }
    }

    let pidfile = pidfile_path()?;
    let logfile = logfile_path()?;

    let mut log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&logfile)
        .with_context(|| format!("failed to open log file at {}", logfile.display()))?;

    writeln!(log, "\n--- emwaver daemon start ---")?;

    let mut cmd = Command::new("emwaver-host");
    cmd.stdin(Stdio::null());

    // stdout/stderr -> log file
    let log2 = log.try_clone()?;
    cmd.stdout(Stdio::from(log));
    cmd.stderr(Stdio::from(log2));

    if let Some(v) = backend_url {
        cmd.env("EMWAVER_BACKEND_URL", v);
    }
    if let Some(v) = id_token {
        cmd.env("EMWAVER_ID_TOKEN", v);
    }
    if let Some(v) = host_session_id {
        cmd.env("EMWAVER_HOST_SESSION_ID", v);
    }
    if let Some(v) = bootstrap_path {
        cmd.env("EMWAVER_BOOTSTRAP_PATH", v);
    }
    if let Some(v) = device_id {
        cmd.env("EMWAVER_DEVICE_ID", v);
    }

    // We are a terminal tool; good defaults.
    cmd.env(
        "RUST_LOG",
        std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()),
    );

    let child = cmd.spawn().context("failed to spawn emwaver-host")?;
    let pid = child.id() as i32;

    fs::write(&pidfile, format!("{pid}\n"))
        .with_context(|| format!("failed to write pidfile at {}", pidfile.display()))?;

    info!("daemon started (pid={pid})");
    info!("log: {}", logfile.display());

    Ok(())
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
        let unit1 = PathBuf::from("/etc/systemd/system/emwaver-host.service");
        let unit2 = PathBuf::from("/lib/systemd/system/emwaver-host.service");
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

fn list_devices_lines() -> Result<Vec<String>> {
    let devices = emwaver_device::list_devices()?;
    if devices.is_empty() {
        return Ok(vec!["No MIDI input ports found.".to_string()]);
    }

    let mut out: Vec<String> = vec!["MIDI input ports:".to_string()];
    for device in devices {
        let hint = if device.likely_emwaver {
            "  <— likely EMWaver"
        } else {
            ""
        };
        out.push(format!("  {}: {}{hint}", device.id, device.name));
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
            issues += 1;
            println!("device check failed: {err:#}");
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
        return run_script_direct(source, name, device, no_device, sim_device, bootstrap_path);
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

    let bridge: Arc<dyn CommandBridge> = if no_device {
        Arc::new(NoDeviceCommandBridge)
    } else if sim_device {
        Arc::new(SimulatorCommandBridge::basic_board()?)
    } else {
        let device = Device::new();
        if let Some(device_id) = device_id {
            device.connect_by_id(&device_id)?;
        } else {
            device.connect_auto()?;
        }
        Arc::new(DeviceCommandBridge { device })
    };

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
    repo_root().join("gateway")
}

fn default_bootstrap_path() -> PathBuf {
    repo_root()
        .join("assets")
        .join("default-scripts")
        .join("script_bootstrap.emw")
}

fn start_gateway(port: Option<u16>) -> Result<()> {
    let dir = gateway_dir();
    if !dir.join("package.json").exists() {
        anyhow::bail!("gateway package not found at {}", dir.display());
    }

    let tsx_bin = dir.join("node_modules").join(".bin").join("tsx");
    if !tsx_bin.exists() {
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

    let port_value = port.unwrap_or(3921);
    println!("starting EMWaver gateway on http://127.0.0.1:{port_value}");
    println!("gateway dir: {}", dir.display());

    let status = Command::new("npm")
        .arg("run")
        .arg("start")
        .current_dir(&dir)
        .env("EMWAVER_GATEWAY_PORT", port_value.to_string())
        .status()
        .context("failed to start gateway with npm")?;

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

    let script_payload = if let Some(path) = script {
        let source = fs::read_to_string(&path)
            .with_context(|| format!("failed to read script at {}", path.display()))?;
        Some(serde_json::json!({
            "name": script_name(&path, None),
            "source": source,
        }))
    } else {
        None
    };

    let mut payload = serde_json::json!({
        "mode": mode,
        "prompt": prompt,
    });
    if let Some(script_payload) = script_payload {
        payload["script"] = script_payload;
    }
    if let Some(error) = error {
        payload["runtime"] = serde_json::json!({ "error": error });
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
        Commands::Daemon { cmd } => match cmd {
            DaemonCmd::Start {
                backend_url,
                id_token,
                host_session_id,
                bootstrap_path,
                device_id,
                force,
            } => daemon_start(
                backend_url,
                id_token,
                host_session_id,
                bootstrap_path,
                device_id,
                force,
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
            no_device,
            sim_device,
            bootstrap_path,
        ),
        Commands::Gateway { port } | Commands::Web { port } => start_gateway(port),
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
                            let _ = daemon_start(None, None, None, None, None, false);
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
