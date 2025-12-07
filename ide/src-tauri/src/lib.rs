use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env, fs, io,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use uuid::Uuid;
use tauri::{
    async_runtime::spawn_blocking,
    menu::{Menu, MenuItem, MenuItemKind, Submenu},
    AppHandle, Emitter, State,
};
use tempfile::Builder;

#[derive(Deserialize)]
struct CreateProjectPayload {
    name: String,
    location: String,
}

#[derive(Serialize)]
struct CreateProjectResponse {
    path: String,
}

const TOOLCHAIN_PROGRESS_EVENT: &str = "toolchain-progress";
const TOOLCHAIN_COMPLETE_EVENT: &str = "toolchain-complete";
const TOOLCHAIN_LOG_EVENT: &str = "toolchain-log";
const FIRMWARE_TASK_OUTPUT_EVENT: &str = "firmware-task-output";
const FIRMWARE_TASK_START_EVENT: &str = "firmware-task-start";
const FIRMWARE_TASK_COMPLETE_EVENT: &str = "firmware-task-complete";
const ESP_IDF_VERSION: &str = "v5.5.1";
const ESP_IDF_REPOSITORY: &str = "https://github.com/espressif/esp-idf.git";
const MENU_CLOSE_FOLDER_EVENT: &str = "menu-close-folder";
const MENU_NEW_PROJECT_EVENT: &str = "menu-new-project";
const MENU_OPEN_PROJECT_EVENT: &str = "menu-open-project";
const MENU_TOGGLE_EXPLORER_EVENT: &str = "menu-toggle-explorer";
const MENU_SHOW_EXPLORER_EVENT: &str = "menu-show-explorer";
const MENU_SHOW_WAVELETS_EVENT: &str = "menu-show-wavelets";
const MENU_TOGGLE_TERMINAL_EVENT: &str = "menu-toggle-terminal";
const MENU_SHOW_TERMINAL_EVENT: &str = "menu-show-terminal";
const MENU_HIDE_TERMINAL_EVENT: &str = "menu-hide-terminal";
const MENU_SYNC_WAVELETS_EVENT: &str = "menu-sync-wavelets";
const MENU_CLONE_WAVELETS_EVENT: &str = "menu-clone-wavelets";
const MENU_INCREASE_LAYOUT_EVENT: &str = "menu-increase-layout";
const MENU_DECREASE_LAYOUT_EVENT: &str = "menu-decrease-layout";
const MENU_RESET_LAYOUT_EVENT: &str = "menu-reset-layout";
const SHELL_OUTPUT_EVENT: &str = "shell-output";
const SHELL_EXIT_EVENT: &str = "shell-exit";

#[derive(Clone, Default)]
struct SharedState {
    install_in_progress: Arc<Mutex<bool>>,
}

#[derive(Clone)]
struct ShellSession {
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
}

struct ShellManager {
    sessions: Arc<Mutex<HashMap<String, ShellSession>>>,
}

impl Default for ShellManager {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Serialize, Clone)]
struct ToolchainStatus {
    installed: bool,
    version: Option<String>,
    installing: bool,
}

#[derive(Serialize, Clone)]
struct ToolchainProgressPayload {
    step: usize,
    total_steps: usize,
    message: String,
}

#[derive(Serialize, Clone)]
struct ToolchainCompletionPayload {
    success: bool,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
struct ToolchainLogPayload {
    stream: String,
    chunk: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ShellOutputPayload {
    session_id: String,
    sequence: u64,
    data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ShellExitPayload {
    session_id: String,
    reason: Option<String>,
}

fn find_local_esp_root() -> Option<PathBuf> {
    // Probe current dir and a couple of parent levels for an "esp/esp-idf/export.sh"
    let mut bases: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = env::current_dir() {
        bases.push(cwd.clone());
        if let Some(parent) = cwd.parent() {
            bases.push(parent.to_path_buf());
            if let Some(grand) = parent.parent() {
                bases.push(grand.to_path_buf());
            }
        }
    }

    for base in bases {
        let idf = base.join("esp/esp-idf/export.sh");
        if idf.exists() {
            return base.join("esp").canonicalize().ok();
        }
    }
    None
}

#[derive(Serialize, Clone)]
struct SerialPortInfo {
    port: String,
    description: String,
    details: Vec<String>,
}

#[derive(Serialize)]
struct ShellConfig {
    program: String,
    args: Vec<String>,
}

#[derive(Serialize)]
struct DirectoryEntry {
    name: String,
    path: String,
    kind: EntryKind,
    children: Option<Vec<DirectoryEntry>>,
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
enum EntryKind {
    File,
    Directory,
}

#[derive(Deserialize)]
struct ReadDirectoryPayload {
    path: String,
}

#[derive(Deserialize)]
struct ReadFilePayload {
    path: String,
}

#[derive(Deserialize)]
struct WriteFilePayload {
    path: String,
    content: String,
}

#[derive(Deserialize)]
struct FirmwareTaskPayload {
    project_path: String,
    serial_port: Option<String>,
    task: FirmwareTaskKind,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum FirmwareTaskKind {
    Build,
    Flash,
    FlashMonitor,
}

impl FirmwareTaskKind {
    fn as_str(&self) -> &'static str {
        match self {
            FirmwareTaskKind::Build => "build",
            FirmwareTaskKind::Flash => "flash",
            FirmwareTaskKind::FlashMonitor => "flash_monitor",
        }
    }
}

#[derive(Serialize, Clone)]
struct FirmwareTaskOutputPayload {
    task: String,
    stream: String,
    line: String,
}

#[derive(Serialize, Clone)]
struct FirmwareTaskStartPayload {
    task: String,
}

#[derive(Serialize, Clone)]
struct FirmwareTaskCompletionPayload {
    task: String,
    success: bool,
    error: Option<String>,
}

#[tauri::command]
async fn create_project(payload: CreateProjectPayload) -> Result<CreateProjectResponse, String> {
    let token = resolve_token();

    let project_name = payload.name.trim();
    if project_name.is_empty() {
        return Err("Project name is required".into());
    }

    let base_path = expand_path(&payload.location);
    if !base_path.exists() {
        fs::create_dir_all(&base_path)
            .map_err(|error| format!("Unable to create base directory: {error}"))?;
    }

    let project_path = base_path.join(project_name);
    if project_path.exists() {
        let mut entries = project_path
            .read_dir()
            .map_err(|error| format!("Unable to inspect existing directory: {error}"))?;
        if entries.next().is_some() {
            return Err("Project directory already exists and is not empty".into());
        }
        fs::remove_dir(&project_path)
            .map_err(|error| format!("Unable to clear existing empty directory: {error}"))?;
    }

    let target = project_path.clone();
    let target_string = target
        .to_str()
        .ok_or_else(|| "Target path contains unsupported characters".to_string())?
        .to_owned();

    spawn_blocking(move || clone_repository(token, &target_string))
        .await
        .map_err(|error| format!("Failed to run clone task: {error}"))??;

    remove_git_metadata(&target)?;

    Ok(CreateProjectResponse {
        path: target
            .canonicalize()
            .unwrap_or(project_path)
            .to_string_lossy()
            .to_string(),
    })
}

#[tauri::command]
async fn read_directory(payload: ReadDirectoryPayload) -> Result<Vec<DirectoryEntry>, String> {
    let root = expand_path(&payload.path);
    if !root.exists() {
        return Err("Directory does not exist".into());
    }
    if !root.is_dir() {
        return Err("Path is not a directory".into());
    }

    spawn_blocking(move || list_directory(&root, &root))
        .await
        .map_err(|error| format!("Failed to read directory: {error}"))
        .and_then(|result| result)
}

#[tauri::command]
async fn read_file(payload: ReadFilePayload) -> Result<String, String> {
    let path = expand_path(&payload.path);
    spawn_blocking(move || {
        fs::read_to_string(&path).map_err(|error| format!("Failed to read file: {error}"))
    })
    .await
    .map_err(|error| format!("Failed to read file: {error}"))
    .and_then(|result| result)
}

#[tauri::command]
async fn write_file(payload: WriteFilePayload) -> Result<(), String> {
    let path = expand_path(&payload.path);
    let content = payload.content;
    spawn_blocking(move || {
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Failed to create parent directory: {error}"))?;
            }
        }
        fs::write(&path, content).map_err(|error| format!("Failed to write file: {error}"))
    })
    .await
    .map_err(|error| format!("Failed to write file: {error}"))?
    .map_err(|error| format!("Failed to write file: {error}"))?;

    Ok(())
}

#[tauri::command]
async fn toolchain_status(state: State<'_, SharedState>) -> Result<ToolchainStatus, String> {
    let installing = {
        let guard = state
            .install_in_progress
            .lock()
            .map_err(|_| "Failed to access toolchain state".to_string())?;
        *guard
    };

    let version = detect_toolchain_version()?;

    Ok(ToolchainStatus {
        installed: version.is_some(),
        version,
        installing,
    })
}

#[tauri::command]
async fn install_toolchain(
    app_handle: AppHandle,
    state: State<'_, SharedState>,
) -> Result<(), String> {
    let shared = state.inner().clone();
    {
        let mut guard = shared
            .install_in_progress
            .lock()
            .map_err(|_| "Failed to access toolchain state".to_string())?;
        if *guard {
            return Err("ESP-IDF installation already in progress".into());
        }
        *guard = true;
    }

    let app_clone = app_handle.clone();
    let result = spawn_blocking(move || perform_toolchain_install(&app_clone))
        .await
        .map_err(|error| format!("Failed to start toolchain installation: {error}"));

    {
        let mut guard = shared
            .install_in_progress
            .lock()
            .map_err(|_| "Failed to update toolchain state".to_string())?;
        *guard = false;
    }

    result??;
    Ok(())
}

#[tauri::command]
async fn list_serial_ports() -> Result<Vec<SerialPortInfo>, String> {
    let ports = spawn_blocking(list_serial_ports_internal)
        .await
        .map_err(|error| format!("Failed to enumerate serial ports: {error}"))??;

    Ok(ports)
}

#[tauri::command]
async fn run_firmware_task(
    app_handle: AppHandle,
    payload: FirmwareTaskPayload,
) -> Result<(), String> {
    spawn_blocking(move || execute_firmware_task(&app_handle, payload))
        .await
        .map_err(|error| format!("Failed to start firmware task: {error}"))?
        .map_err(|error| format!("Failed to start firmware task: {error}"))?;

    Ok(())
}

#[tauri::command]
fn default_shell() -> ShellConfig {
    if cfg!(target_os = "windows") {
        ShellConfig {
            program: "powershell.exe".to_string(),
            args: vec![
                "-NoLogo".to_string(),
                "-ExecutionPolicy".to_string(),
                "Bypass".to_string(),
            ],
        }
    } else {
        let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        ShellConfig {
            program: shell,
            args: vec!["-l".to_string()],
        }
    }
}

#[tauri::command]
async fn spawn_shell_session(
    app_handle: AppHandle,
    manager: State<'_, ShellManager>,
) -> Result<String, String> {
    let sessions = manager.sessions.clone();
    spawn_blocking(move || spawn_shell_session_internal(app_handle, sessions))
        .await
        .map_err(|error| format!("Failed to spawn shell: {error}"))?
}

fn spawn_shell_session_internal(
    app_handle: AppHandle,
    sessions: Arc<Mutex<HashMap<String, ShellSession>>>,
) -> Result<String, String> {
    let shell = default_shell();
    let ShellConfig { program, args } = shell;
    let pty_system = native_pty_system();
    let mut pair = pty_system
        .openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Failed to open shell PTY: {error}"))?;

    let mut command = CommandBuilder::new(program);
    for arg in args {
        command.arg(arg);
    }
    command.env("TERM", "xterm-256color");
    if let Ok(cwd) = env::current_dir() {
        command.cwd(cwd);
    }

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Failed to spawn shell: {error}"))?;

    let mut master = pair.master;
    let writer = master
        .take_writer()
        .map_err(|error| format!("Failed to access PTY writer: {error}"))?;

    let master = Arc::new(Mutex::new(master));
    let writer = Arc::new(Mutex::new(writer));
    let child = Arc::new(Mutex::new(child));

    let session_id = Uuid::new_v4().to_string();

    {
        let mut guard = sessions
            .lock()
            .map_err(|_| "Failed to register shell session".to_string())?;
        guard.insert(
            session_id.clone(),
            ShellSession {
                master: master.clone(),
                writer: writer.clone(),
                child: child.clone(),
            },
        );
    }

    // Prime reader thread before returning the session id.
    let mut reader = master
        .lock()
        .map_err(|_| "Failed to access PTY reader".to_string())?
        .try_clone_reader()
        .map_err(|error| format!("Failed to clone PTY reader: {error}"))?;

    let sessions_clone = sessions.clone();
    let session_id_clone = session_id.clone();
    let app_clone = app_handle.clone();
    thread::spawn(move || {
        let mut sequence: u64 = 0;
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
                    let payload = ShellOutputPayload {
                        session_id: session_id_clone.clone(),
                        sequence,
                        data: chunk,
                    };
                    let _ = app_clone.emit(SHELL_OUTPUT_EVENT, payload);
                    sequence = sequence.wrapping_add(1);
                    let _ = sequence;
                }
                Err(error) => {
                    let payload = ShellOutputPayload {
                        session_id: session_id_clone.clone(),
                        sequence,
                        data: format!(
                            "\r\n[emwaver] shell read error: {error}\r\n"
                        ),
                    };
                    let _ = app_clone.emit(SHELL_OUTPUT_EVENT, payload);
                    sequence = sequence.wrapping_add(1);
                    let _ = sequence;
                    break;
                }
            }
        }

        let removed = sessions_clone
            .lock()
            .map(|mut guard| guard.remove(&session_id_clone))
            .ok()
            .flatten();

        let reason = removed.and_then(|session| match session.child.lock() {
            Ok(mut child) => match child.wait() {
                Ok(status) => Some(format!("{status:?}")),
                Err(error) => Some(format!("Shell wait error: {error}")),
            },
            Err(error) => Some(format!("Shell child lock error: {error}")),
        });

        let exit_payload = ShellExitPayload {
            session_id: session_id_clone.clone(),
            reason,
        };
        let _ = app_clone.emit(SHELL_EXIT_EVENT, exit_payload);
    });

    // Initialise ESP-IDF environment if available.
    if let Some(esp_root) = find_local_esp_root() {
        let idf_path = esp_root.join("esp-idf");
        let tools_path = esp_root.join("tools");
        let ide_home = esp_root
            .parent()
            .map(|path| path.to_path_buf())
            .unwrap_or_else(|| esp_root.clone());
        let real_home = env::var("HOME").unwrap_or_default();
        let init_commands = format!(
            "export EMWAVER_IDE_HOME='{}'\r\nexport EMWAVER_REAL_HOME='{}'\r\nexport EMWAVER_ESP_ROOT='{}'\r\nexport IDF_PATH='{}'\r\nexport IDF_TOOLS_PATH='{}'\r\nsource '{}/export.sh'\r\n",
            escape_single_quotes(&ide_home.to_string_lossy()),
            escape_single_quotes(&real_home),
            escape_single_quotes(&esp_root.to_string_lossy()),
            escape_single_quotes(&idf_path.to_string_lossy()),
            escape_single_quotes(&tools_path.to_string_lossy()),
            escape_single_quotes(&idf_path.to_string_lossy())
        );

        if let Ok(mut guard) = writer.lock() {
            let _ = guard.write_all(init_commands.as_bytes());
            let _ = guard.flush();
        }
    }

    Ok(session_id)
}

#[tauri::command]
async fn write_shell(
    manager: State<'_, ShellManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let writer = {
        let guard = manager
            .sessions
            .lock()
            .map_err(|_| "Failed to access shell sessions".to_string())?;
        guard
            .get(&session_id)
            .cloned()
            .ok_or_else(|| "Shell session not found".to_string())?
            .writer
    };

    spawn_blocking(move || -> Result<(), String> {
        let mut guard = writer
            .lock()
            .map_err(|_| "Shell writer poisoned".to_string())?;
        guard
            .write_all(data.as_bytes())
            .map_err(|error| format!("Failed to write to shell: {error}"))?;
        guard
            .flush()
            .map_err(|error| format!("Failed to flush shell: {error}"))?;
        Ok(())
    })
    .await
    .map_err(|error| format!("Failed to write to shell: {error}"))?;

    Ok(())
}

#[tauri::command]
async fn resize_shell(
    manager: State<'_, ShellManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let master = {
        let guard = manager
            .sessions
            .lock()
            .map_err(|_| "Failed to access shell sessions".to_string())?;
        guard
            .get(&session_id)
            .cloned()
            .ok_or_else(|| "Shell session not found".to_string())?
            .master
    };

    spawn_blocking(move || -> Result<(), String> {
        let guard = master
            .lock()
            .map_err(|_| "Shell master poisoned".to_string())?;
        guard
            .resize(PtySize {
                cols,
                rows,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Failed to resize shell: {error}"))
    })
    .await
    .map_err(|error| format!("Failed to resize shell: {error}"))?;

    Ok(())
}

#[tauri::command]
async fn close_shell_session(
    manager: State<'_, ShellManager>,
    session_id: String,
) -> Result<(), String> {
    let child = {
        let guard = manager
            .sessions
            .lock()
            .map_err(|_| "Failed to access shell sessions".to_string())?;
        guard
            .get(&session_id)
            .cloned()
            .ok_or_else(|| "Shell session not found".to_string())?
            .child
    };

    spawn_blocking(move || -> Result<(), String> {
        if let Ok(mut guard) = child.lock() {
            let _ = guard.kill();
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Failed to close shell: {error}"))?;

    Ok(())
}

#[tauri::command]
async fn resolve_serial_port(preferred: Option<String>) -> Result<Option<String>, String> {
    spawn_blocking(move || -> Result<Option<String>, String> {
        if let Some(port) = preferred {
            let trimmed = port.trim();
            if !trimmed.is_empty() {
                return Ok(Some(trimmed.to_string()));
            }
        }
        auto_detect_serial_port()
    })
    .await
    .map_err(|error| format!("Failed to resolve serial port: {error}"))?
}


fn detect_toolchain_version() -> Result<Option<String>, String> {
    if cfg!(target_os = "windows") {
        return Ok(None);
    }

    let mut candidates = Vec::new();
    // Prefer local "esp/esp-idf" beside the IDE installation
    if let Some(esp_root) = find_local_esp_root() {
        candidates.push(esp_root.join("esp-idf"));
    }
    if let Ok(idf_path) = env::var("IDF_PATH") {
        candidates.push(PathBuf::from(idf_path));
    }
    if let Ok(home) = env::var("HOME") {
        candidates.push(PathBuf::from(home).join("esp/esp-idf"));
    }

    for candidate in candidates {
        let export = candidate.join("export.sh");
        if !export.exists() {
            continue;
        }

        let export_str = export.to_string_lossy().to_string();
        let escaped_export = escape_single_quotes(&export_str);
        let script = format!(
            "set -e\nsource '{}' >/dev/null 2>&1\nidf.py --version",
            escaped_export
        );

        let mut cmd = Command::new("bash");
        cmd.arg("-lc").arg(script);
        if let Some(parent) = candidate.parent() {
            let tools = parent.join("tools");
            if tools.exists() {
                cmd.env("IDF_TOOLS_PATH", tools.to_string_lossy().to_string());
            }
        }

        match cmd.output() {
            Ok(output) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let version = stdout.trim();
                if !version.is_empty() {
                    return Ok(Some(version.to_string()));
                }
            }
            _ => continue,
        }
    }

    Ok(None)
}

fn perform_toolchain_install(app_handle: &AppHandle) -> Result<(), String> {
    let result = if cfg!(target_os = "macos") {
        install_toolchain_macos(app_handle)
    } else {
        Err("Automatic ESP-IDF installation is not supported on this platform yet.".to_string())
    };

    match result {
        Ok(()) => {
            let _ = app_handle.emit(
                TOOLCHAIN_COMPLETE_EVENT,
                ToolchainCompletionPayload {
                    success: true,
                    error: None,
                },
            );
            Ok(())
        }
        Err(error) => {
            let payload = ToolchainCompletionPayload {
                success: false,
                error: Some(error.clone()),
            };
            let _ = app_handle.emit(TOOLCHAIN_COMPLETE_EVENT, payload);
            Err(error)
        }
    }
}

fn install_toolchain_macos(app_handle: &AppHandle) -> Result<(), String> {
    let total_steps = 2;
    emit_toolchain_progress(app_handle, 0, total_steps, "Checking local ESP-IDF bundle");

    let esp_root = find_local_esp_root()
        .ok_or_else(|| "Local esp/esp-idf not found. Place an ESP-IDF bundle in the IDE folder under 'esp/'.".to_string())?;
    let idf_dir = esp_root.join("esp-idf");
    let tools_dir = esp_root.join("tools");

    if !idf_dir.join("export.sh").exists() {
        return Err(format!(
            "Missing export.sh at '{}'. Ensure esp/esp-idf is a complete checkout without .git.",
            idf_dir.to_string_lossy()
        ));
    }
    if !tools_dir.exists() {
        return Err(format!(
            "Missing tools directory at '{}'. Provide the preinstalled tools (IDF_TOOLS_PATH).",
            tools_dir.to_string_lossy()
        ));
    }

    emit_toolchain_progress(app_handle, 1, total_steps, "Verifying ESP-IDF environment");

    // Verify by sourcing export.sh with the local tools path
    let export = idf_dir.join("export.sh");
    let escaped_export = escape_single_quotes(&export.to_string_lossy());
    let verify_script = format!("set -e\nexport IDF_TOOLS_PATH='{}'\nsource '{}' >/dev/null 2>&1\nidf.py --version",
        escape_single_quotes(&tools_dir.to_string_lossy()),
        escaped_export
    );
    let output = Command::new("bash").arg("-lc").arg(verify_script).output()
        .map_err(|e| format!("Failed to verify ESP-IDF: {e}"))?;
    if !output.status.success() {
        return Err(command_error_message(&output));
    }

    Ok(())
}

fn run_toolchain_script(
    app_handle: &AppHandle,
    script: &str,
    envs: &[(&str, &str)],
) -> Result<(), String> {
    let mut command = Command::new("bash");
    command.arg("-lc").arg(script);
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    for (key, value) in envs {
        command.env(key, value);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to execute shell command: {error}"))?;

    let mut handles = Vec::new();
    let combined_output: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));

    if let Some(stdout) = child.stdout.take() {
        let app_clone = app_handle.clone();
        let output_clone = Arc::clone(&combined_output);
        handles.push(thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut buffer = [0u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(size) => {
                        if size == 0 {
                            continue;
                        }
                        let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
                        if let Ok(mut collected) = output_clone.lock() {
                            collected.push_str(&chunk);
                        }
                        let payload = ToolchainLogPayload {
                            stream: "stdout".to_string(),
                            chunk,
                        };
                        let _ = app_clone.emit(TOOLCHAIN_LOG_EVENT, payload);
                    }
                    Err(_) => break,
                }
            }
        }));
    }

    if let Some(stderr) = child.stderr.take() {
        let app_clone = app_handle.clone();
        let output_clone = Arc::clone(&combined_output);
        handles.push(thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut buffer = [0u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(size) => {
                        if size == 0 {
                            continue;
                        }
                        let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
                        if let Ok(mut collected) = output_clone.lock() {
                            collected.push_str(&chunk);
                        }
                        let payload = ToolchainLogPayload {
                            stream: "stderr".to_string(),
                            chunk,
                        };
                        let _ = app_clone.emit(TOOLCHAIN_LOG_EVENT, payload);
                    }
                    Err(_) => break,
                }
            }
        }));
    }

    let status = child
        .wait()
        .map_err(|error| format!("Failed to wait for command completion: {error}"))?;

    for handle in handles {
        let _ = handle.join();
    }

    if status.success() {
        Ok(())
    } else {
        let message = combined_output
            .lock()
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| format!("Process exited with status: {:?}", status.code()));
        Err(message)
    }
}

fn emit_toolchain_progress(app_handle: &AppHandle, step: usize, total_steps: usize, message: &str) {
    let payload = ToolchainProgressPayload {
        step,
        total_steps,
        message: message.to_string(),
    };
    let _ = app_handle.emit(TOOLCHAIN_PROGRESS_EVENT, payload);
}

fn command_error_message(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if !stderr.trim().is_empty() {
        stderr.trim().to_string()
    } else {
        stdout.trim().to_string()
    };
    if detail.is_empty() {
        "Unknown command error".to_string()
    } else {
        detail
    }
}

fn list_serial_ports_internal() -> Result<Vec<SerialPortInfo>, String> {
    let commands = [
        ["python3", "-m", "serial.tools.list_ports", "-v"],
        ["python3", "-m", "serial.tools.list_devices", "-v"],
        ["python", "-m", "serial.tools.list_ports", "-v"],
        ["python", "-m", "serial.tools.list_devices", "-v"],
    ];

    let mut last_error: Option<String> = None;

    for command in commands.iter() {
        let (program, args) = command.split_first().expect("command is not empty");
        match Command::new(program).args(args).output() {
            Ok(output) => {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let ports = parse_serial_ports(&stdout);
                    return Ok(ports);
                }
                last_error = Some(command_error_message(&output));
            }
            Err(error) => {
                last_error = Some(format!("Failed to execute {program}: {error}"));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "Unable to enumerate serial ports".to_string()))
}

fn parse_serial_ports(output: &str) -> Vec<SerialPortInfo> {
    let mut ports = Vec::new();
    let mut current: Option<SerialPortInfo> = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.ends_with("ports found") {
            continue;
        }

        let starts_with_whitespace = line
            .chars()
            .next()
            .map(|ch| ch.is_whitespace())
            .unwrap_or(false);

        if !starts_with_whitespace {
            if let Some(port) = current.take() {
                ports.push(normalise_serial_port(port));
            }
            current = Some(SerialPortInfo {
                port: trimmed.to_string(),
                description: String::new(),
                details: Vec::new(),
            });
            continue;
        }

        if let Some(info) = current.as_mut() {
            if let Some((key, value)) = trimmed.split_once(':') {
                let key_raw = key.trim();
                let key_lower = key_raw.to_lowercase();
                let value = value.trim();
                match key_lower.as_str() {
                    "desc" | "description" => {
                        if info.description.is_empty() {
                            info.description = value.to_string();
                        }
                    }
                    "hwid" => {
                        info.details
                            .push(format!("HWID: {value}"));
                    }
                    "manufacturer" => {
                        info.details
                            .push(format!("Manufacturer: {value}"));
                    }
                    "serial" | "ser" => {
                        info.details
                            .push(format!("Serial: {value}"));
                    }
                    "location" => {
                        info.details
                            .push(format!("Location: {value}"));
                    }
                    "product" => {
                        info.details
                            .push(format!("Product: {value}"));
                    }
                    "interface" => {
                        info.details
                            .push(format!("Interface: {value}"));
                    }
                    _ => {
                        info.details
                            .push(format!("{}: {}", key_raw, value));
                    }
                }
            } else {
                info.details.push(trimmed.to_string());
            }
        }
    }

    if let Some(port) = current.take() {
        ports.push(normalise_serial_port(port));
    }

    ports
}

fn normalise_serial_port(mut info: SerialPortInfo) -> SerialPortInfo {
    if info.description.is_empty() {
        if let Some(detail) = info.details.first() {
            info.description = detail.clone();
        } else {
            info.description = "Unknown device".to_string();
        }
    }

    info
}

fn auto_detect_serial_port() -> Result<Option<String>, String> {
    let ports = list_serial_ports_internal()?;
    let mut preferred = None;
    for port in &ports {
        let mut haystack = port.description.to_lowercase();
        for detail in &port.details {
            haystack.push(' ');
            haystack.push_str(&detail.to_lowercase());
        }
        if haystack.contains("usb")
            || haystack.contains("uart")
            || haystack.contains("esp")
            || haystack.contains("cp210")
        {
            preferred = Some(port.port.clone());
            break;
        }
    }

    if let Some(port) = preferred {
        return Ok(Some(port));
    }

    Ok(ports.into_iter().map(|port| port.port).next())
}

fn execute_firmware_task(
    app_handle: &AppHandle,
    payload: FirmwareTaskPayload,
) -> Result<(), String> {
    let project_path = expand_path(&payload.project_path);
    if !project_path.exists() {
        return Err("Selected project directory does not exist".to_string());
    }

    let setup_script = project_path.join("setup.sh");
    if !setup_script.exists() {
        return Err("setup.sh is missing from the firmware project".to_string());
    }

    let task_name = payload.task.as_str().to_string();
    let mut serial_port = payload.serial_port.clone();
    if matches!(
        payload.task,
        FirmwareTaskKind::Flash | FirmwareTaskKind::FlashMonitor
    ) {
        let needs_port = serial_port
            .as_ref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true);
        if needs_port {
            serial_port = auto_detect_serial_port()?;
        }

        if serial_port.is_none() {
            return Err(
                "Unable to detect a connected ESP32 device. Connect the board and try again."
                    .to_string(),
            );
        }
    }

    let escaped_project = escape_single_quotes(&project_path.to_string_lossy());
    let command = match payload.task {
        FirmwareTaskKind::Build => "idf.py build".to_string(),
        FirmwareTaskKind::Flash => {
            let port = escape_single_quotes(serial_port.as_ref().unwrap());
            format!("idf.py -p '{}' flash", port)
        }
        FirmwareTaskKind::FlashMonitor => {
            let port = escape_single_quotes(serial_port.as_ref().unwrap());
            format!("idf.py -p '{}' flash monitor", port)
        }
    };

    // Prefer local ESP environment if available
    let mut prelude = String::from("set -euo pipefail\n");
    if let Some(esp_root) = find_local_esp_root() {
        let idf_path = esp_root.join("esp-idf");
        let tools_path = esp_root.join("tools");
        prelude.push_str(&format!(
            "export IDF_PATH='{}'\nexport IDF_TOOLS_PATH='{}'\nsource '{}/export.sh' >/dev/null 2>&1\n",
            escape_single_quotes(&idf_path.to_string_lossy()),
            escape_single_quotes(&tools_path.to_string_lossy()),
            escape_single_quotes(&idf_path.to_string_lossy()),
        ));
    }

    let script = format!(
        "{prelude}cd '{project}'\nsource ./setup.sh >/dev/null 2>&1\n{command}",
        prelude = prelude,
        project = escaped_project,
        command = command
    );

    let _ = app_handle.emit(
        FIRMWARE_TASK_START_EVENT,
        FirmwareTaskStartPayload {
            task: task_name.clone(),
        },
    );

    match run_streaming_command(app_handle, &task_name, script) {
        Ok(()) => {
            let _ = app_handle.emit(
                FIRMWARE_TASK_COMPLETE_EVENT,
                FirmwareTaskCompletionPayload {
                    task: task_name,
                    success: true,
                    error: None,
                },
            );
            Ok(())
        }
        Err(error) => {
            let _ = app_handle.emit(
                FIRMWARE_TASK_COMPLETE_EVENT,
                FirmwareTaskCompletionPayload {
                    task: task_name,
                    success: false,
                    error: Some(error.clone()),
                },
            );
            Err(error)
        }
    }
}

fn run_streaming_command(app_handle: &AppHandle, task: &str, script: String) -> Result<(), String> {
    let mut command = Command::new("bash");
    command.arg("-lc").arg(script);
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to execute command: {error}"))?;

    let task_label = task.to_string();
    let mut handles = Vec::new();

    if let Some(stdout) = child.stdout.take() {
        let app_clone = app_handle.clone();
        let task_clone = task_label.clone();
        handles.push(thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let payload = FirmwareTaskOutputPayload {
                        task: task_clone.clone(),
                        stream: "stdout".to_string(),
                        line,
                    };
                    let _ = app_clone.emit(FIRMWARE_TASK_OUTPUT_EVENT, payload);
                }
            }
        }));
    }

    if let Some(stderr) = child.stderr.take() {
        let app_clone = app_handle.clone();
        let task_clone = task_label.clone();
        handles.push(thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let payload = FirmwareTaskOutputPayload {
                        task: task_clone.clone(),
                        stream: "stderr".to_string(),
                        line,
                    };
                    let _ = app_clone.emit(FIRMWARE_TASK_OUTPUT_EVENT, payload);
                }
            }
        }));
    }

    let status = child
        .wait()
        .map_err(|error| format!("Failed to wait for command completion: {error}"))?;

    for handle in handles {
        let _ = handle.join();
    }

    if status.success() {
        Ok(())
    } else if let Some(code) = status.code() {
        Err(format!("Process exited with status code {code}"))
    } else {
        Err("Process terminated by signal".to_string())
    }
}

fn clone_repository(token: Option<String>, target: &str) -> Result<(), String> {
    match run_git_clone(None, target) {
        Ok(()) => Ok(()),
        Err(initial_error) => {
            if let Some(token) = token {
                run_git_clone(Some(token), target)
            } else {
                Err(initial_error)
            }
        }
    }
}

fn run_git_clone(token: Option<String>, target: &str) -> Result<(), String> {
    let helper = if let Some(ref value) = token {
        let safe_token = escape_single_quotes(value);
        let mut script = Builder::new()
            .prefix("emwaver-askpass")
            .tempfile()
            .map_err(|error| format!("Failed to create credentials helper: {error}"))?;

        let helper = format!(
            "#!/bin/sh\ncase \"$1\" in\n*Username*)\n  printf '%s\\n' 'x-access-token'\n  ;;\n*)\n  printf '%s\\n' '{}'\n  ;;\nesac\n",
            safe_token
        );

        script
            .write_all(helper.as_bytes())
            .map_err(|error| format!("Failed to write credentials helper: {error}"))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = script
                .as_file()
                .metadata()
                .map_err(|error| format!("Failed to read helper metadata: {error}"))?
                .permissions();
            permissions.set_mode(0o700);
            script
                .as_file()
                .set_permissions(permissions)
                .map_err(|error| format!("Failed to set helper permissions: {error}"))?;
        }

        Some(script.into_temp_path())
    } else {
        None
    };

    let mut command = Command::new("git");
    command.args([
        "clone",
        "--depth",
        "1",
        "https://github.com/luispl77/emwaver-fw.git",
        target,
    ]);
    command.env("GIT_TERMINAL_PROMPT", "0");

    if let Some(ref askpass) = helper {
        command.env("GIT_ASKPASS", askpass);
    }

    let output = command
        .output()
        .map_err(|error| format!("Failed to execute git: {error}"))?;

    if let Some(path) = helper {
        if let Err(error) = path.close() {
            return Err(format!("Failed to clean credentials helper: {error}"));
        }
    }

    if output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = if !stderr.trim().is_empty() {
        stderr.trim().to_string()
    } else {
        stdout.trim().to_string()
    };

    if detail.is_empty() {
        Err("Failed to clone emwaver firmware repository.".to_string())
    } else {
        Err(format!(
            "Failed to clone emwaver firmware repository. {detail}"
        ))
    }
}

fn remove_git_metadata(target: &Path) -> Result<(), String> {
    let git_dir = target.join(".git");
    if git_dir.exists() {
        fs::remove_dir_all(&git_dir)
            .map_err(|error| format!("Failed to remove git metadata: {error}"))?;
    }
    Ok(())
}

fn list_directory(current: &Path, root: &Path) -> Result<Vec<DirectoryEntry>, String> {
    let mut entries = fs::read_dir(current)
        .map_err(|error| format!("Failed to read directory entries: {error}"))?
        .collect::<Result<Vec<_>, io::Error>>()
        .map_err(|error| format!("Unable to iterate directory: {error}"))?;

    entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

    let mut directories = Vec::new();
    let mut files = Vec::new();

    for entry in entries {
        let path = entry.path();
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Encountered invalid UTF-8 filename".to_string())?;

        if name == ".git" {
            continue;
        }

        if path.is_dir() {
            let children = list_directory(&path, root)?;
            directories.push(DirectoryEntry {
                name,
                path: relative_path(&path, root),
                kind: EntryKind::Directory,
                children: Some(children),
            });
        } else if path.is_file() {
            files.push(DirectoryEntry {
                name,
                path: relative_path(&path, root),
                kind: EntryKind::File,
                children: None,
            });
        }
    }

    directories.sort_by(|a, b| a.name.cmp(&b.name));
    files.sort_by(|a, b| a.name.cmp(&b.name));

    directories.extend(files);
    Ok(directories)
}

fn relative_path(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn expand_path(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Ok(home) = env::var("HOME") {
            return PathBuf::from(home).join(stripped);
        }
    } else if path == "~" {
        if let Ok(home) = env::var("HOME") {
            return PathBuf::from(home);
        }
    }

    PathBuf::from(path)
}

fn escape_single_quotes(value: &str) -> String {
    value.replace('\'', "'\"'\"'")
}

fn resolve_token() -> Option<String> {
    for key in ["GHCR_PAT", "GITHUB_TOKEN", "GH_TOKEN"] {
        if let Ok(value) = env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();

            let new_item = MenuItem::with_id(
                app,
                "menu-new-project",
                "New Project…",
                true,
                Some("CmdOrCtrl+Shift+N"),
            )?;
            let open_item = MenuItem::with_id(
                app,
                "menu-open-project",
                "Open Project…",
                true,
                Some("CmdOrCtrl+O"),
            )?;
            let close_item = MenuItem::with_id(
                app,
                "menu-close-folder",
                "Close Folder",
                true,
                Some("CmdOrCtrl+W"),
            )?;
            let toggle_explorer_item = MenuItem::with_id(
                app,
                "menu-toggle-explorer",
                "Toggle Explorer",
                true,
                Some("CmdOrCtrl+B"),
            )?;
            let show_explorer_item = MenuItem::with_id(
                app,
                "menu-show-explorer",
                "Show Explorer",
                true,
                None::<&str>,
            )?;
            let show_wavelets_item = MenuItem::with_id(
                app,
                "menu-show-wavelets",
                "Show Wavelets Pane",
                true,
                None::<&str>,
            )?;
            let toggle_terminal_item = MenuItem::with_id(
                app,
                "menu-toggle-terminal",
                "Toggle Terminal",
                true,
                Some("CmdOrCtrl+J"),
            )?;
            let show_terminal_item = MenuItem::with_id(
                app,
                "menu-show-terminal",
                "Show Terminal",
                true,
                None::<&str>,
            )?;
            let hide_terminal_item = MenuItem::with_id(
                app,
                "menu-hide-terminal",
                "Hide Terminal",
                true,
                None::<&str>,
            )?;
            let increase_layout_item = MenuItem::with_id(
                app,
                "menu-increase-layout",
                "Zoom In",
                true,
                Some("CmdOrCtrl+Shift+="),
            )?;
            let decrease_layout_item = MenuItem::with_id(
                app,
                "menu-decrease-layout",
                "Zoom Out",
                true,
                Some("CmdOrCtrl+-"),
            )?;
            let reset_layout_item = MenuItem::with_id(
                app,
                "menu-reset-layout",
                "Reset Layout",
                true,
                Some("CmdOrCtrl+0"),
            )?;
            let sync_wavelets_item = MenuItem::with_id(
                app,
                "menu-sync-wavelets",
                "Sync with Cloud",
                true,
                None::<&str>,
            )?;
            let clone_wavelets_item = MenuItem::with_id(
                app,
                "menu-clone-wavelets",
                "Clone Wavelet Scripts",
                true,
                None::<&str>,
            )?;

            let mut close_item_added = false;
            let mut view_menu_added = false;
            let menu = Menu::default(&handle)?;
            if let Ok(items) = menu.items() {
                for item in items {
                    if let MenuItemKind::Submenu(submenu) = item {
                        if let Ok(label) = submenu.text() {
                            if label == "File" {
                                submenu.append(&close_item)?;
                                close_item_added = true;
                            } else if label == "View" {
                                submenu.append(&increase_layout_item)?;
                                submenu.append(&decrease_layout_item)?;
                                submenu.append(&reset_layout_item)?;
                                submenu.append(&toggle_explorer_item)?;
                                submenu.append(&show_explorer_item)?;
                                submenu.append(&show_wavelets_item)?;
                                submenu.append(&toggle_terminal_item)?;
                                submenu.append(&show_terminal_item)?;
                                submenu.append(&hide_terminal_item)?;
                                view_menu_added = true;
                            }
                        }
                    }
                }
            }

            if !close_item_added {
                let file_menu = Submenu::new(app, "File", true)?;
                file_menu.append(&close_item)?;
                menu.append(&file_menu)?;
            }

            if !view_menu_added {
                let view_menu = Submenu::new(app, "View", true)?;
                view_menu.append(&increase_layout_item)?;
                view_menu.append(&decrease_layout_item)?;
                view_menu.append(&reset_layout_item)?;
                view_menu.append(&toggle_explorer_item)?;
                view_menu.append(&show_explorer_item)?;
                view_menu.append(&show_wavelets_item)?;
                view_menu.append(&toggle_terminal_item)?;
                view_menu.append(&show_terminal_item)?;
                view_menu.append(&hide_terminal_item)?;
                menu.append(&view_menu)?;
            }

            let projects_menu = Submenu::new(app, "Projects", true)?;
            projects_menu.append(&new_item)?;
            projects_menu.append(&open_item)?;
            menu.append(&projects_menu)?;

            let wavelets_menu = Submenu::new(app, "Wavelets", true)?;
            wavelets_menu.append(&sync_wavelets_item)?;
            wavelets_menu.append(&clone_wavelets_item)?;
            menu.append(&wavelets_menu)?;

            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "menu-close-folder" => {
                    let _ = app.emit(MENU_CLOSE_FOLDER_EVENT, ());
                }
                "menu-new-project" => {
                    let _ = app.emit(MENU_NEW_PROJECT_EVENT, ());
                }
                "menu-open-project" => {
                    let _ = app.emit(MENU_OPEN_PROJECT_EVENT, ());
                }
                "menu-toggle-explorer" => {
                    let _ = app.emit(MENU_TOGGLE_EXPLORER_EVENT, ());
                }
                "menu-show-explorer" => {
                    let _ = app.emit(MENU_SHOW_EXPLORER_EVENT, ());
                }
                "menu-show-wavelets" => {
                    let _ = app.emit(MENU_SHOW_WAVELETS_EVENT, ());
                }
                "menu-toggle-terminal" => {
                    let _ = app.emit(MENU_TOGGLE_TERMINAL_EVENT, ());
                }
                "menu-show-terminal" => {
                    let _ = app.emit(MENU_SHOW_TERMINAL_EVENT, ());
                }
                "menu-hide-terminal" => {
                    let _ = app.emit(MENU_HIDE_TERMINAL_EVENT, ());
                }
                "menu-increase-layout" => {
                    let _ = app.emit(MENU_INCREASE_LAYOUT_EVENT, ());
                }
                "menu-decrease-layout" => {
                    let _ = app.emit(MENU_DECREASE_LAYOUT_EVENT, ());
                }
                "menu-reset-layout" => {
                    let _ = app.emit(MENU_RESET_LAYOUT_EVENT, ());
                }
                "menu-sync-wavelets" => {
                    let _ = app.emit(MENU_SYNC_WAVELETS_EVENT, ());
                }
                "menu-clone-wavelets" => {
                    let _ = app.emit(MENU_CLONE_WAVELETS_EVENT, ());
                }
                _ => {}
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(ShellManager::default())
        .manage(SharedState::default())
        .invoke_handler(tauri::generate_handler![
            create_project,
            read_directory,
            read_file,
            write_file,
            toolchain_status,
            install_toolchain,
            list_serial_ports,
            run_firmware_task,
            default_shell,
            spawn_shell_session,
            write_shell,
            resize_shell,
            close_shell_session,
            resolve_serial_port
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
