mod ble;

use serde::{Deserialize, Serialize};
use std::{env, fs, io, io::Write, path::{Path, PathBuf}, process::Command, sync::Arc};
use tauri::{
    async_runtime::spawn_blocking,
    menu::{Menu, MenuItem, MenuItemKind, Submenu},
    Emitter, State,
};
use tempfile::Builder;
use ble::{BLEState, BLEStatus, BLENotification};

#[derive(Deserialize)]
struct CreateProjectPayload {
    name: String,
    location: String,
}

#[derive(Serialize)]
struct CreateProjectResponse {
    path: String,
}

// ESP-IDF functionality removed - desktop app focuses on hardware interaction and wavelets
const MENU_CLOSE_FOLDER_EVENT: &str = "menu-close-folder";
const MENU_NEW_PROJECT_EVENT: &str = "menu-new-project";
const MENU_OPEN_PROJECT_EVENT: &str = "menu-open-project";
const MENU_TOGGLE_EXPLORER_EVENT: &str = "menu-toggle-explorer";
const MENU_SHOW_EXPLORER_EVENT: &str = "menu-show-explorer";
const MENU_SHOW_WAVELETS_EVENT: &str = "menu-show-wavelets";
const MENU_SHOW_ISM_EVENT: &str = "menu-show-ism";
const MENU_SHOW_SAMPLER_EVENT: &str = "menu-show-sampler";
const MENU_SHOW_EMWAVER_EVENT: &str = "menu-show-emwaver";
const MENU_INCREASE_LAYOUT_EVENT: &str = "menu-increase-layout";
const MENU_DECREASE_LAYOUT_EVENT: &str = "menu-decrease-layout";
const MENU_RESET_LAYOUT_EVENT: &str = "menu-reset-layout";

// ESP-IDF types and managers removed - desktop app doesn't need ESP-IDF toolchain

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

// Firmware task types removed - ESP-IDF build/flash functionality removed

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

#[derive(Deserialize)]
struct RevealInFinderPayload {
    path: String,
}

#[tauri::command]
async fn reveal_in_finder(payload: RevealInFinderPayload) -> Result<(), String> {
    let path = expand_path(&payload.path);
    let path_str = path
        .to_str()
        .ok_or_else(|| "Path contains invalid characters".to_string())?
        .to_string();
    spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .arg("-R")
                .arg(&path_str)
                .output()
                .map_err(|error| format!("Failed to reveal in Finder: {error}"))?;
        }
        #[cfg(target_os = "windows")]
        {
            Command::new("explorer")
                .arg("/select,")
                .arg(&path_str)
                .output()
                .map_err(|error| format!("Failed to reveal in Explorer: {error}"))?;
        }
        #[cfg(target_os = "linux")]
        {
            let parent_path = Path::new(&path_str)
                .parent()
                .and_then(|p| p.to_str())
                .unwrap_or(&path_str);
            Command::new("xdg-open")
                .arg(parent_path)
                .output()
                .map_err(|error| format!("Failed to reveal in file manager: {error}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Failed to reveal in Finder: {error}"))?
}

// ESP-IDF and shell commands removed - desktop app doesn't need ESP-IDF toolchain or shell sessions


// ESP-IDF helper functions removed

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

// BLE Commands
#[tauri::command]
async fn ble_initialize(state: State<'_, Arc<BLEState>>) -> Result<(), String> {
    state.initialize().await
}

#[tauri::command]
async fn ble_start_scan(state: State<'_, Arc<BLEState>>) -> Result<(), String> {
    state.start_scan().await
}

#[tauri::command]
async fn ble_stop_scan(state: State<'_, Arc<BLEState>>) -> Result<(), String> {
    state.stop_scan().await
}

#[tauri::command]
async fn ble_disconnect(state: State<'_, Arc<BLEState>>) -> Result<(), String> {
    state.disconnect().await
}

#[tauri::command]
async fn ble_send_packet(state: State<'_, Arc<BLEState>>, data: Vec<u8>) -> Result<(), String> {
    state.send_packet(data).await
}

#[tauri::command]
async fn ble_get_status(state: State<'_, Arc<BLEState>>) -> Result<BLEStatus, String> {
    Ok(state.get_status().await)
}

#[tauri::command]
async fn ble_get_notification(state: State<'_, Arc<BLEState>>) -> Result<Option<BLENotification>, String> {
    Ok(state.get_notification().await)
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
                "Show Wavelets",
                true,
                None::<&str>,
            )?;
            let show_ism_item = MenuItem::with_id(
                app,
                "menu-show-ism",
                "Show ISM (CC1101)",
                true,
                None::<&str>,
            )?;
            let show_sampler_item = MenuItem::with_id(
                app,
                "menu-show-sampler",
                "Show Sampler",
                true,
                None::<&str>,
            )?;
            let show_emwaver_item = MenuItem::with_id(
                app,
                "menu-show-emwaver",
                "Show EMWaver",
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
            // Wavelets menu items removed - no longer needed

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
                                submenu.append(&show_ism_item)?;
                                submenu.append(&show_sampler_item)?;
                                submenu.append(&show_emwaver_item)?;
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
                view_menu.append(&show_ism_item)?;
                view_menu.append(&show_sampler_item)?;
                view_menu.append(&show_emwaver_item)?;
                menu.append(&view_menu)?;
            }

            let projects_menu = Submenu::new(app, "Projects", true)?;
            projects_menu.append(&new_item)?;
            projects_menu.append(&open_item)?;
            menu.append(&projects_menu)?;

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
                "menu-show-ism" => {
                    let _ = app.emit(MENU_SHOW_ISM_EVENT, ());
                }
                "menu-show-sampler" => {
                    let _ = app.emit(MENU_SHOW_SAMPLER_EVENT, ());
                }
                "menu-show-emwaver" => {
                    let _ = app.emit(MENU_SHOW_EMWAVER_EVENT, ());
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
                _ => {}
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Arc::new(BLEState::new()))
        .invoke_handler(tauri::generate_handler![
            create_project,
            read_directory,
            read_file,
            write_file,
            reveal_in_finder,
            ble_initialize,
            ble_start_scan,
            ble_stop_scan,
            ble_disconnect,
            ble_send_packet,
            ble_get_status,
            ble_get_notification
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
