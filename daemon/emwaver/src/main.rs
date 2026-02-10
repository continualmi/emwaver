use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use directories::ProjectDirs;
use midir::MidiInput;
use nix::sys::signal::kill;
use nix::unistd::Pid;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tracing::{info, warn};

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
    let Some(pid) = read_pid(&pidfile) else { return Ok(None); };
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
    force: bool,
) -> Result<()> {
    if let Some(pid) = daemon_running()? {
        if force {
            warn!("daemon already running (pid={pid}), stopping due to --force");
            daemon_stop()?;
        } else {
            anyhow::bail!("daemon already running (pid={pid}). Use `emwaver daemon status` or pass --force");
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

    // We are a terminal tool; good defaults.
    cmd.env("RUST_LOG", std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()));

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
            return Ok(format!("autostart: configured (launchd plist exists: {})", plist.display()));
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
    let midi_in = MidiInput::new("emwaver-cli")?;
    let ports = midi_in.ports();
    if ports.is_empty() {
        return Ok(vec!["No MIDI input ports found.".to_string()]);
    }

    let mut out: Vec<String> = vec!["MIDI input ports:".to_string()];
    for (i, p) in ports.iter().enumerate() {
        let name = midi_in.port_name(p).unwrap_or_else(|_| format!("in#{i}"));
        let l = name.to_lowercase();
        let hint = if l.contains("emw") || l.contains("emwaver") {
            "  <— likely EMWaver"
        } else {
            ""
        };
        out.push(format!("  {i}: {name}{hint}"));
    }

    Ok(out)
}

fn list_devices() -> Result<()> {
    for line in list_devices_lines()? {
        println!("{line}");
    }
    Ok(())
}

fn print_paths() -> Result<()> {
    println!("state dir: {}", state_dir()?.display());
    println!("pidfile:  {}", pidfile_path()?.display());
    println!("logfile:  {}", logfile_path()?.display());
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
                force,
            } => daemon_start(backend_url, id_token, host_session_id, bootstrap_path, force),
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
                    Line::from("EMWaver Daemon (beta)".to_string()).style(Style::default().add_modifier(Modifier::BOLD)),
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
                            let _ = daemon_start(None, None, None, None, false);
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
