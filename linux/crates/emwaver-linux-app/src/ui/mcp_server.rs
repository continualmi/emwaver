use emwaver_linux_core::{AppModel, DeviceRecord, ScriptListItem, ScriptRepository};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

pub const DEFAULT_PORT: u16 = 3923;
const ENDPOINT_PATH: &str = "/mcp";
const FALLBACK_PROTOCOL_VERSION: &str = "2025-06-18";

#[derive(Clone, Debug, serde::Serialize)]
pub struct McpDeviceSnapshot {
    pub connected: bool,
    pub selected_device: Option<DeviceRecord>,
    pub devices: Vec<DeviceRecord>,
}

impl McpDeviceSnapshot {
    pub fn from_model(model: &AppModel) -> Self {
        let selected_device = model.selected_device();
        Self {
            connected: selected_device
                .as_ref()
                .is_some_and(|device| device.connected),
            selected_device,
            devices: model.devices(),
        }
    }
}

pub struct McpServerHandle {
    shutdown_tx: Option<mpsc::Sender<()>>,
    join: Option<thread::JoinHandle<()>>,
}

impl Drop for McpServerHandle {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

impl McpServerHandle {
    pub fn start(
        repository: ScriptRepository,
        snapshot: Arc<Mutex<McpDeviceSnapshot>>,
    ) -> Result<Self, String> {
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();

        let join = thread::Builder::new()
            .name("emwaver-linux-mcp".to_string())
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_io()
                    .enable_time()
                    .build()
                {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        let _ = ready_tx.send(Err(error.to_string()));
                        return;
                    }
                };

                runtime.block_on(async move {
                    let listener = match TcpListener::bind(("127.0.0.1", DEFAULT_PORT)).await {
                        Ok(listener) => listener,
                        Err(error) => {
                            let _ = ready_tx.send(Err(error.to_string()));
                            return;
                        }
                    };

                    let _ = ready_tx.send(Ok(()));
                    loop {
                        if shutdown_rx.try_recv().is_ok() {
                            break;
                        }

                        match tokio::time::timeout(
                            std::time::Duration::from_millis(250),
                            listener.accept(),
                        )
                        .await
                        {
                            Ok(Ok((stream, _))) => {
                                let repository = repository.clone();
                                let snapshot = snapshot.clone();
                                tokio::spawn(async move {
                                    let _ = handle_client(stream, repository, snapshot).await;
                                });
                            }
                            Ok(Err(_)) => break,
                            Err(_) => continue,
                        }
                    }
                });
            })
            .map_err(|error| error.to_string())?;

        match ready_rx.recv_timeout(std::time::Duration::from_secs(2)) {
            Ok(Ok(())) => Ok(Self {
                shutdown_tx: Some(shutdown_tx),
                join: Some(join),
            }),
            Ok(Err(error)) => {
                let _ = shutdown_tx.send(());
                let _ = join.join();
                Err(error)
            }
            Err(error) => {
                let _ = shutdown_tx.send(());
                let _ = join.join();
                Err(error.to_string())
            }
        }
    }
}

pub fn sync_from_settings(
    handle: &Rc<RefCell<Option<McpServerHandle>>>,
    repository: &ScriptRepository,
    snapshot: &Arc<Mutex<McpDeviceSnapshot>>,
) -> Result<(), String> {
    if mcp_enabled() {
        if handle.borrow().is_none() {
            let started = McpServerHandle::start(repository.clone(), snapshot.clone())?;
            *handle.borrow_mut() = Some(started);
        }
    } else {
        *handle.borrow_mut() = None;
    }
    Ok(())
}

pub fn status_text(
    handle: &Rc<RefCell<Option<McpServerHandle>>>,
    last_error: Option<&str>,
) -> String {
    if !mcp_enabled() {
        return "Disabled".to_string();
    }
    if handle.borrow().is_some() {
        return "Enabled on loopback".to_string();
    }
    last_error
        .filter(|error| !error.is_empty())
        .map(|error| format!("Start failed: {error}"))
        .unwrap_or_else(|| "Starting".to_string())
}

pub fn endpoint_url() -> String {
    format!("http://127.0.0.1:{DEFAULT_PORT}{ENDPOINT_PATH}")
}

pub fn mcp_enabled() -> bool {
    read_settings_json()
        .get("mcpEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

pub fn set_mcp_enabled(enabled: bool) -> std::io::Result<()> {
    write_settings_key("mcpEnabled", json!(enabled))
}

pub fn mcp_token() -> String {
    read_settings_json()
        .get("mcpToken")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| reset_mcp_token().unwrap_or_else(|_| new_token()))
}

pub fn reset_mcp_token() -> std::io::Result<String> {
    let token = new_token();
    write_settings_key("mcpToken", json!(token))?;
    Ok(token)
}

pub fn read_run_log_visible() -> bool {
    read_settings_json()
        .get("runLogVisible")
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

pub fn write_run_log_visible(visible: bool) -> std::io::Result<()> {
    write_settings_key("runLogVisible", json!(visible))
}

fn new_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

async fn handle_client(
    mut stream: TcpStream,
    repository: ScriptRepository,
    snapshot: Arc<Mutex<McpDeviceSnapshot>>,
) -> std::io::Result<()> {
    let request = read_http_request(&mut stream).await?;
    if request.method.to_uppercase() != "POST" || request.path != ENDPOINT_PATH {
        write_response(
            &mut stream,
            404,
            "Not Found",
            json_rpc_error(Value::Null, -32004, "Unknown MCP endpoint"),
        )
        .await?;
        return Ok(());
    }

    if !is_authorized(&request) {
        write_response(
            &mut stream,
            401,
            "Unauthorized",
            json_rpc_error(Value::Null, -32001, "MCP bearer token is required"),
        )
        .await?;
        return Ok(());
    }

    let (status, body) = handle_json_rpc(&request.body, &repository, &snapshot);
    if status == 202 {
        write_empty_response(&mut stream, 202, "Accepted").await
    } else {
        write_response(&mut stream, status, "OK", body).await
    }
}

fn is_authorized(request: &HttpRequest) -> bool {
    let Some(authorization) = request.headers.get("authorization") else {
        return false;
    };
    let Some(token) = authorization.strip_prefix("Bearer ") else {
        return false;
    };
    token.trim() == mcp_token()
}

fn handle_json_rpc(
    body: &[u8],
    repository: &ScriptRepository,
    snapshot: &Arc<Mutex<McpDeviceSnapshot>>,
) -> (u16, Value) {
    let Ok(value) = serde_json::from_slice::<Value>(body) else {
        return (
            200,
            json_rpc_error(Value::Null, -32700, "Invalid JSON request"),
        );
    };

    match value {
        Value::Array(items) => {
            let responses: Vec<Value> = items
                .into_iter()
                .filter_map(|item| handle_single_json_rpc(item, repository, snapshot))
                .collect();
            if responses.is_empty() {
                (202, Value::Null)
            } else {
                (200, Value::Array(responses))
            }
        }
        Value::Object(_) => {
            if let Some(response) = handle_single_json_rpc(value, repository, snapshot) {
                (200, response)
            } else {
                (202, Value::Null)
            }
        }
        _ => (
            200,
            json_rpc_error(Value::Null, -32600, "JSON-RPC request must be an object"),
        ),
    }
}

fn handle_single_json_rpc(
    request: Value,
    repository: &ScriptRepository,
    snapshot: &Arc<Mutex<McpDeviceSnapshot>>,
) -> Option<Value> {
    let id = request.get("id").cloned();
    let id = id?;
    let Some(method) = request.get("method").and_then(Value::as_str) else {
        return Some(json_rpc_error(id, -32600, "Missing JSON-RPC method"));
    };

    let result = match method {
        "initialize" => initialize_result(request.get("params")),
        "tools/list" => tools_list_result(),
        "tools/call" => tools_call_result(request.get("params"), repository, snapshot),
        _ => {
            return Some(json_rpc_error(
                id,
                -32601,
                &format!("Unsupported MCP method: {method}"),
            ))
        }
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn initialize_result(params: Option<&Value>) -> Value {
    let protocol_version = params
        .and_then(|value| value.get("protocolVersion"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or(FALLBACK_PROTOCOL_VERSION);

    json!({
        "protocolVersion": protocol_version,
        "capabilities": { "tools": {} },
        "serverInfo": {
            "name": "EMWaver Linux",
            "version": env!("CARGO_PKG_VERSION")
        }
    })
}

fn tools_list_result() -> Value {
    json!({
        "tools": [
            {
                "name": "list_scripts",
                "description": "List bundled and local JavaScript scripts visible to the Linux app.",
                "inputSchema": empty_schema()
            },
            {
                "name": "read_script",
                "description": "Read one script by script_id from the same roots used by the app UI.",
                "inputSchema": {
                    "type": "object",
                    "properties": { "script_id": { "type": "string" } },
                    "required": ["script_id"],
                    "additionalProperties": false
                }
            },
            {
                "name": "write_script",
                "description": "Create or update a local JavaScript script in the Linux app script folder.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "script_id": { "type": "string" },
                        "path": { "type": "string" },
                        "content": { "type": "string" }
                    },
                    "required": ["content"],
                    "additionalProperties": false
                }
            },
            {
                "name": "device_state",
                "description": "Return current EMWaver device, transport, firmware, and discovery state.",
                "inputSchema": empty_schema()
            }
        ]
    })
}

fn tools_call_result(
    params: Option<&Value>,
    repository: &ScriptRepository,
    snapshot: &Arc<Mutex<McpDeviceSnapshot>>,
) -> Value {
    let name = params
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str);
    let arguments = params.and_then(|value| value.get("arguments"));

    let structured = match name {
        Some("list_scripts") => list_scripts_tool(repository),
        Some("read_script") => read_script_tool(repository, arguments),
        Some("write_script") => write_script_tool(repository, arguments),
        Some("device_state") => device_state_tool(snapshot),
        _ => tool_error(
            "unsupported_tool",
            &format!("Unsupported MCP tool: {}", name.unwrap_or("<missing>")),
            None,
        ),
    };

    json!({
        "content": [
            {
                "type": "text",
                "text": serde_json::to_string(&structured).unwrap_or_else(|_| "{}".to_string())
            }
        ],
        "structuredContent": structured
    })
}

fn list_scripts_tool(repository: &ScriptRepository) -> Value {
    match repository.list_scripts() {
        Ok(scripts) => json!({
            "ok": true,
            "scripts": scripts.into_iter().map(script_json).collect::<Vec<_>>()
        }),
        Err(error) => tool_error("list_scripts_failed", &error.to_string(), None),
    }
}

fn write_script_tool(repository: &ScriptRepository, arguments: Option<&Value>) -> Value {
    let Some(content) = arguments
        .and_then(|value| value.get("content"))
        .and_then(Value::as_str)
    else {
        return tool_error("missing_content", "write_script requires content", None);
    };

    if let Some(script_id) = arguments
        .and_then(|value| value.get("script_id"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        let Ok(scripts) = repository.list_scripts() else {
            return tool_error("script_not_found", "Could not list scripts", None);
        };
        let Some(script) = scripts
            .into_iter()
            .find(|script| script.id.eq_ignore_ascii_case(script_id))
        else {
            return tool_error(
                "script_not_found",
                &format!("Script not found: {script_id}"),
                Some("Call list_scripts again; the script may have been renamed or deleted."),
            );
        };
        if !script.is_editable() {
            return tool_error(
                "script_read_only",
                "Bundled scripts are read-only",
                Some("Create a local script with path and content, or copy the bundled script in the app UI first."),
            );
        }

        return match repository.save_script(&script, content) {
            Ok(()) => json!({
                "ok": true,
                "created": false,
                "script": script_json(script)
            }),
            Err(error) => tool_error("script_write_failed", &error.to_string(), None),
        };
    }

    let file_name = local_script_file_name(
        arguments
            .and_then(|value| value.get("path"))
            .and_then(Value::as_str),
    );

    if let Ok(scripts) = repository.list_scripts() {
        if let Some(script) = scripts
            .into_iter()
            .find(|script| script.is_editable() && script.name.eq_ignore_ascii_case(&file_name))
        {
            return match repository.save_script(&script, content) {
                Ok(()) => json!({
                    "ok": true,
                    "created": false,
                    "script": script_json(script)
                }),
                Err(error) => tool_error("script_write_failed", &error.to_string(), None),
            };
        }
    }

    match repository.create_script(&file_name, content) {
        Ok(script) => json!({
            "ok": true,
            "created": true,
            "script": script_json(script)
        }),
        Err(error) => tool_error("script_write_failed", &error.to_string(), None),
    }
}

fn read_script_tool(repository: &ScriptRepository, arguments: Option<&Value>) -> Value {
    let Some(script_id) = arguments
        .and_then(|value| value.get("script_id"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    else {
        return tool_error(
            "missing_script_id",
            "read_script requires script_id",
            Some("Call list_scripts first and pass one returned script id."),
        );
    };

    let Ok(scripts) = repository.list_scripts() else {
        return tool_error("script_not_found", "Could not list scripts", None);
    };
    let Some(script) = scripts
        .into_iter()
        .find(|script| script.id.eq_ignore_ascii_case(script_id))
    else {
        return tool_error(
            "script_not_found",
            &format!("Script not found: {script_id}"),
            Some("Call list_scripts again; the script may have been renamed or deleted."),
        );
    };

    match repository.read_script(&script) {
        Ok(source) => {
            let mut script_value = script_json(script);
            if let Value::Object(ref mut object) = script_value {
                object.insert("source".to_string(), Value::String(source));
            }
            json!({ "ok": true, "script": script_value })
        }
        Err(error) => tool_error("script_read_failed", &error.to_string(), None),
    }
}

fn device_state_tool(snapshot: &Arc<Mutex<McpDeviceSnapshot>>) -> Value {
    let snapshot = snapshot
        .lock()
        .map(|snapshot| snapshot.clone())
        .unwrap_or(McpDeviceSnapshot {
            connected: false,
            selected_device: None,
            devices: vec![],
        });
    json!({
        "ok": true,
        "connected": snapshot.connected,
        "mode": if snapshot.connected { "RunMode" } else { "Disconnected" },
        "selected_device": snapshot.selected_device,
        "devices": snapshot.devices
    })
}

fn script_json(script: ScriptListItem) -> Value {
    json!({
        "id": script.id,
        "name": script.name,
        "path": script.path,
        "editable": script.is_editable(),
        "source_kind": script.kind_label().to_lowercase().replace(' ', "_")
    })
}

fn local_script_file_name(path: Option<&str>) -> String {
    let raw = path
        .and_then(|value| std::path::Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("mcp-script.js");
    if raw.to_lowercase().ends_with(".js") {
        raw.to_string()
    } else {
        format!("{raw}.js")
    }
}

fn empty_schema() -> Value {
    json!({
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
    })
}

fn tool_error(code: &str, message: &str, recovery: Option<&str>) -> Value {
    let mut error = json!({
        "code": code,
        "message": message
    });
    if let Some(recovery) = recovery {
        error["recovery"] = Value::String(recovery.to_string());
    }
    json!({
        "ok": false,
        "error": error
    })
}

fn json_rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    })
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    headers: std::collections::BTreeMap<String, String>,
    body: Vec<u8>,
}

async fn read_http_request(stream: &mut TcpStream) -> std::io::Result<HttpRequest> {
    let mut buffer = Vec::new();
    let mut scratch = [0_u8; 8192];
    loop {
        let read = stream.read(&mut scratch).await?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&scratch[..read]);
        if parse_http_request(&buffer).is_some() {
            break;
        }
        if buffer.len() > 10 * 1024 * 1024 {
            break;
        }
    }
    parse_http_request(&buffer)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid HTTP request"))
}

fn parse_http_request(buffer: &[u8]) -> Option<HttpRequest> {
    let header_end = buffer.windows(4).position(|window| window == b"\r\n\r\n")?;
    let header = std::str::from_utf8(&buffer[..header_end]).ok()?;
    let mut lines = header.split("\r\n");
    let mut request_line = lines.next()?.split_whitespace();
    let method = request_line.next()?.to_string();
    let path = request_line.next()?.to_string();

    let mut headers = std::collections::BTreeMap::new();
    for line in lines {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        headers.insert(key.trim().to_lowercase(), value.trim().to_string());
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let body_start = header_end + 4;
    if buffer.len() < body_start + content_length {
        return None;
    }
    Some(HttpRequest {
        method,
        path,
        headers,
        body: buffer[body_start..body_start + content_length].to_vec(),
    })
}

async fn write_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    body: Value,
) -> std::io::Result<()> {
    let body = serde_json::to_vec(&body).unwrap_or_else(|_| b"{}".to_vec());
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(&body).await?;
    stream.shutdown().await
}

async fn write_empty_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
) -> std::io::Result<()> {
    let header =
        format!("HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    stream.write_all(header.as_bytes()).await?;
    stream.shutdown().await
}

fn read_settings_json() -> Value {
    let Ok(body) = fs::read_to_string(app_settings_path()) else {
        return json!({});
    };
    serde_json::from_str::<Value>(&body).unwrap_or_else(|_| json!({}))
}

fn write_settings_key(key: &str, value: Value) -> std::io::Result<()> {
    let path = app_settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut body = read_settings_json();
    if !body.is_object() {
        body = json!({});
    }
    if let Value::Object(ref mut object) = body {
        object.insert(key.to_string(), value);
    }
    fs::write(path, serde_json::to_string_pretty(&body)?)
}

fn app_settings_path() -> PathBuf {
    if let Some(config_home) = env::var_os("XDG_CONFIG_HOME").filter(|value| !value.is_empty()) {
        return PathBuf::from(config_home).join("emwaver").join("app.json");
    }
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config")
        .join("emwaver")
        .join("app.json")
}
