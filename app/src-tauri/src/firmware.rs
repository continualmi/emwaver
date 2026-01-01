use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use tauri::Emitter;

#[derive(Deserialize)]
pub struct FirmwareBuildPayload {
    pub start_dir: Option<String>,
    pub project: Option<String>,
    pub codegen: Option<String>,
    pub verbose: Option<bool>,
}

#[derive(Deserialize)]
pub struct FirmwareFlashPayload {
    pub start_dir: Option<String>,
    pub project: Option<String>,
    pub port: Option<String>,
    pub codegen: Option<String>,
    pub dfu_alt: Option<u8>,
    pub verbose: Option<bool>,
}

#[derive(Clone, Serialize)]
struct FirmwareProgressEvent {
    message: String,
    stream: String,
    timestamp_ms: u64,
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

fn parse_codegen_mode(value: Option<String>) -> Result<emw::CodegenMode, String> {
    match value.as_deref().unwrap_or("auto") {
        "auto" => Ok(emw::CodegenMode::Auto),
        "always" => Ok(emw::CodegenMode::Always),
        "never" => Ok(emw::CodegenMode::Never),
        other => Err(format!("Unknown codegen mode `{other}` (expected auto|always|never)")),
    }
}

fn emit_progress(app: &tauri::AppHandle, progress: emw::firmware::FirmwareProgress) {
    let (stream, message) = match progress {
        emw::firmware::FirmwareProgress::Info(msg) => ("info", msg),
        emw::firmware::FirmwareProgress::Stdout(msg) => ("stdout", msg),
        emw::firmware::FirmwareProgress::Stderr(msg) => ("stderr", msg),
    };

    let _ = app.emit(
        "firmware-progress",
        FirmwareProgressEvent {
            message,
            stream: stream.to_string(),
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        },
    );
}

#[tauri::command]
pub async fn firmware_build(app: tauri::AppHandle, payload: FirmwareBuildPayload) -> Result<(), String> {
    let app_handle = app.clone();
    let start_dir = payload
        .start_dir
        .as_deref()
        .map(expand_path)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let project = payload.project.as_deref().map(expand_path);
    let codegen = parse_codegen_mode(payload.codegen)?;
    let verbose = payload.verbose.unwrap_or(false);

    tauri::async_runtime::spawn_blocking(move || {
        let mut on_event = |event| emit_progress(&app_handle, event);
        emw::firmware::build_at_streaming(start_dir, project, codegen, verbose, true, &mut on_event)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Task failed: {error}"))?
}

#[tauri::command]
pub async fn firmware_flash(app: tauri::AppHandle, payload: FirmwareFlashPayload) -> Result<(), String> {
    let app_handle = app.clone();
    let start_dir = payload
        .start_dir
        .as_deref()
        .map(expand_path)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let project = payload.project.as_deref().map(expand_path);
    let codegen = parse_codegen_mode(payload.codegen)?;
    let verbose = payload.verbose.unwrap_or(false);

    tauri::async_runtime::spawn_blocking(move || {
        let mut on_event = |event| emit_progress(&app_handle, event);
        emw::firmware::flash_at_streaming(
            start_dir,
            project,
            payload.port,
            codegen,
            payload.dfu_alt,
            verbose,
            true,
            &mut on_event,
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Task failed: {error}"))?
}
