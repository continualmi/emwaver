use emwaver_linux_core::{AppModel, DeviceRecord, ScriptListItem, ScriptRepository, TransportKind};
use emwaver_linux_runtime::execute_javascript_with_modules;
use emwaver_linux_transport::{
    ble::{BleTarget, LinuxBleTransport},
    command::{send_command, RESPONSE_BUSY, RESPONSE_ERR, RESPONSE_OK},
    usb::{LinuxUsbManager, LinuxUsbMidiTransport},
    wifi::{LinuxWifiTransport, ManualWifiTarget},
    EmwaverTransport,
};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::BTreeMap;
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
                "name": "run_script",
                "description": "Run a JavaScript script through the Linux app runtime and selected device.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "script_id": { "type": "string" },
                        "source": { "type": "string" },
                        "name": { "type": "string" }
                    },
                    "required": [],
                    "additionalProperties": false
                }
            },
            {
                "name": "stop_script",
                "description": "Stop an MCP-started Linux script run when persistent MCP sessions are active.",
                "inputSchema": {
                    "type": "object",
                    "properties": { "run_id": { "type": "string" } },
                    "required": [],
                    "additionalProperties": false
                }
            },
            {
                "name": "device_state",
                "description": "Return current EMWaver device, transport, firmware, and discovery state.",
                "inputSchema": empty_schema()
            },
            {
                "name": "spi_transfer",
                "description": "Send an SPI transfer through the selected Linux device.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tx": {
                            "description": "Transmit bytes as an array of 0-255 integers or a hex string.",
                            "oneOf": [
                                { "type": "array", "items": { "type": "integer", "minimum": 0, "maximum": 255 } },
                                { "type": "string" }
                            ]
                        },
                        "rx_len": { "type": "integer", "minimum": 0, "maximum": 62 },
                        "cs": { "type": "integer", "minimum": 0, "maximum": 255 },
                        "timeout_ms": { "type": "integer", "minimum": 1, "maximum": 30000 }
                    },
                    "required": ["tx"],
                    "additionalProperties": false
                }
            },
            {
                "name": "gpio_read",
                "description": "Read one GPIO pin through the selected Linux device.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "pin": { "type": "integer", "minimum": 0, "maximum": 255 },
                        "timeout_ms": { "type": "integer", "minimum": 1, "maximum": 30000 }
                    },
                    "required": ["pin"],
                    "additionalProperties": false
                }
            },
            {
                "name": "gpio_write",
                "description": "Write one GPIO pin high or low through the selected Linux device.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "pin": { "type": "integer", "minimum": 0, "maximum": 255 },
                        "value": { "type": "boolean" },
                        "timeout_ms": { "type": "integer", "minimum": 1, "maximum": 30000 }
                    },
                    "required": ["pin", "value"],
                    "additionalProperties": false
                }
            },
            {
                "name": "analog_read",
                "description": "Read one analog pin through the selected Linux device.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "pin": { "type": "integer", "minimum": 0, "maximum": 255 },
                        "samples": { "type": "integer", "minimum": 1, "maximum": 255 },
                        "timeout_ms": { "type": "integer", "minimum": 1, "maximum": 30000 }
                    },
                    "required": ["pin"],
                    "additionalProperties": false
                }
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
        Some("run_script") => run_script_tool(repository, arguments, snapshot),
        Some("stop_script") => stop_script_tool(arguments),
        Some("device_state") => device_state_tool(snapshot),
        Some("spi_transfer") => spi_transfer_tool(arguments, snapshot),
        Some("gpio_read") => gpio_read_tool(arguments, snapshot),
        Some("gpio_write") => gpio_write_tool(arguments, snapshot),
        Some("analog_read") => analog_read_tool(arguments, snapshot),
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

fn run_script_tool(
    repository: &ScriptRepository,
    arguments: Option<&Value>,
    snapshot: &Arc<Mutex<McpDeviceSnapshot>>,
) -> Value {
    let resolved = resolve_run_source(repository, arguments);
    let Ok((name, source)) = resolved else {
        return resolved.err().unwrap_or_else(|| {
            tool_error(
                "script_unavailable",
                "Script unavailable",
                Some("Call list_scripts first, or pass source directly."),
            )
        });
    };

    let selected_device = snapshot
        .lock()
        .ok()
        .and_then(|snapshot| snapshot.selected_device.clone());
    let Some(device) = selected_device else {
        return tool_error(
            "no_selected_device",
            "No selected Linux device is available for run_script",
            Some("Select or connect a device in the Linux app before calling run_script."),
        );
    };

    let modules = repository.module_sources().unwrap_or_default();
    let run_id = uuid::Uuid::new_v4().to_string();
    let lines = run_device_script(device, &source, &modules);
    let ok = !lines.iter().any(|line| {
        let lowered = line.to_lowercase();
        lowered.contains("failed")
            || lowered.contains("not implemented")
            || lowered.contains("not available")
    });

    json!({
        "ok": ok,
        "run_id": run_id,
        "status": if ok { "completed" } else { "failed" },
        "name": name,
        "console": console_json(lines)
    })
}

fn stop_script_tool(_arguments: Option<&Value>) -> Value {
    json!({
        "ok": true,
        "status": "not_running",
        "stopped": 0,
        "note": "Linux MCP run_script currently executes synchronously; persistent MCP run sessions are still pending."
    })
}

fn resolve_run_source(
    repository: &ScriptRepository,
    arguments: Option<&Value>,
) -> Result<(String, String), Value> {
    if let Some(source) = arguments
        .and_then(|value| value.get("source"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        let name = arguments
            .and_then(|value| value.get("name"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("MCP Script");
        return Ok((name.to_string(), source.to_string()));
    }

    let Some(script_id) = arguments
        .and_then(|value| value.get("script_id"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    else {
        return Err(tool_error(
            "missing_script",
            "run_script requires script_id or source",
            Some("Call list_scripts first, or pass source directly."),
        ));
    };

    let scripts = repository
        .list_scripts()
        .map_err(|error| tool_error("list_scripts_failed", &error.to_string(), None))?;
    let Some(script) = scripts
        .into_iter()
        .find(|script| script.id.eq_ignore_ascii_case(script_id))
    else {
        return Err(tool_error(
            "script_not_found",
            &format!("Script not found: {script_id}"),
            Some("Call list_scripts again; the script may have been renamed or deleted."),
        ));
    };
    let source = repository
        .read_script(&script)
        .map_err(|error| tool_error("script_read_failed", &error.to_string(), None))?;
    Ok((script.name, source))
}

fn run_device_script(
    device: DeviceRecord,
    source: &str,
    module_sources: &BTreeMap<String, String>,
) -> Vec<String> {
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        return vec!["Failed to create script runtime.".to_string()];
    };

    match device.transport {
        TransportKind::Simulator => vec![
            "Simulator is an internal test transport and is not available in the Linux app UI."
                .to_string(),
        ],
        TransportKind::UsbMidi => runtime.block_on(async {
            let candidate = match LinuxUsbManager::default().discover() {
                Ok(candidates) => candidates
                    .into_iter()
                    .find(|candidate| candidate.id == device.id),
                Err(err) => return vec![format!("USB discovery failed: {err}")],
            };
            let Some(candidate) = candidate else {
                return vec![format!("USB device {} is no longer present.", device.id)];
            };
            let mut transport = match LinuxUsbMidiTransport::new(candidate) {
                Ok(transport) => transport,
                Err(err) => return vec![format!("USB transport setup failed: {err}")],
            };
            run_with_transport(source, module_sources, &mut transport).await
        }),
        TransportKind::Wifi => runtime.block_on(async {
            let target = match manual_wifi_target_from_device(&device) {
                Ok(target) => target,
                Err(err) => return vec![err],
            };
            let mut transport = LinuxWifiTransport::new(target);
            run_with_transport(source, module_sources, &mut transport).await
        }),
        TransportKind::Ble => runtime.block_on(async {
            let target = match ble_target_from_device(&device) {
                Ok(target) => target,
                Err(err) => return vec![err],
            };
            let mut transport = LinuxBleTransport::new(target);
            run_with_transport(source, module_sources, &mut transport).await
        }),
        other => vec![format!(
            "{other:?} script execution is not implemented yet."
        )],
    }
}

async fn run_with_transport(
    source: &str,
    module_sources: &BTreeMap<String, String>,
    transport: &mut dyn EmwaverTransport,
) -> Vec<String> {
    if let Err(err) = transport.connect().await {
        return vec![format!("Transport connect failed: {err}")];
    }
    let result = execute_javascript_with_modules(source, module_sources, transport).await;
    let _ = transport.close().await;
    match result {
        Ok(report) => report.log,
        Err(err) => vec![format!("Script failed: {err}")],
    }
}

fn spi_transfer_tool(arguments: Option<&Value>, snapshot: &Arc<Mutex<McpDeviceSnapshot>>) -> Value {
    let tx = match byte_array_arg(arguments, "tx") {
        Ok(bytes) => bytes,
        Err(error) => return error,
    };
    let cs = match byte_arg(arguments, "cs", Some(4)) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let rx_len = match byte_arg(arguments, "rx_len", Some(0)) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let timeout_ms = match timeout_arg(arguments) {
        Ok(value) => value,
        Err(error) => return error,
    };

    if tx.len() > 14 {
        return tool_error(
            "spi_tx_too_large",
            "Linux MCP SPI transfer currently supports up to 14 TX bytes per command lane.",
            Some("Send a shorter transfer or run a JavaScript script that owns the needed transaction sequence."),
        );
    }

    let mut command = Vec::with_capacity(4 + tx.len());
    command.extend_from_slice(&[0x50, cs, rx_len, tx.len() as u8]);
    command.extend_from_slice(&tx);
    let wanted = if rx_len > 0 {
        rx_len as usize
    } else {
        tx.len()
    };

    match send_primitive(snapshot, &command, timeout_ms) {
        Ok(response) => {
            let payload = response.payload;
            let rx = payload.into_iter().take(wanted).collect::<Vec<_>>();
            json!({
                "ok": true,
                "status": response.status,
                "rx": rx,
                "payload": response_payload_json(response.raw_payload)
            })
        }
        Err(error) => error,
    }
}

fn gpio_read_tool(arguments: Option<&Value>, snapshot: &Arc<Mutex<McpDeviceSnapshot>>) -> Value {
    let pin = match byte_arg(arguments, "pin", None) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let timeout_ms = match timeout_arg(arguments) {
        Ok(value) => value,
        Err(error) => return error,
    };

    match send_primitive(snapshot, &[0x10, 0x02, pin], timeout_ms) {
        Ok(response) => {
            let value = response.payload.first().copied().unwrap_or(0) != 0;
            json!({
                "ok": true,
                "status": response.status,
                "pin": pin,
                "value": value,
                "payload": response_payload_json(response.raw_payload)
            })
        }
        Err(error) => error,
    }
}

fn gpio_write_tool(arguments: Option<&Value>, snapshot: &Arc<Mutex<McpDeviceSnapshot>>) -> Value {
    let pin = match byte_arg(arguments, "pin", None) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let Some(value) = arguments
        .and_then(|value| value.get("value"))
        .and_then(Value::as_bool)
    else {
        return tool_error("missing_value", "gpio_write requires boolean value", None);
    };
    let timeout_ms = match timeout_arg(arguments) {
        Ok(value) => value,
        Err(error) => return error,
    };

    match send_primitive(
        snapshot,
        &[0x10, if value { 0x03 } else { 0x04 }, pin],
        timeout_ms,
    ) {
        Ok(response) => json!({
            "ok": true,
            "status": response.status,
            "pin": pin,
            "value": value,
            "payload": response_payload_json(response.raw_payload)
        }),
        Err(error) => error,
    }
}

fn analog_read_tool(arguments: Option<&Value>, snapshot: &Arc<Mutex<McpDeviceSnapshot>>) -> Value {
    let pin = match byte_arg(arguments, "pin", None) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let samples = match byte_arg(arguments, "samples", Some(1)) {
        Ok(value) => value.max(1),
        Err(error) => return error,
    };
    let timeout_ms = match timeout_arg(arguments) {
        Ok(value) => value,
        Err(error) => return error,
    };

    match send_primitive(snapshot, &[0x20, 0x00, pin, samples], timeout_ms) {
        Ok(response) => {
            let payload = response.payload;
            let readings = payload
                .chunks(2)
                .filter_map(|chunk| {
                    if chunk.len() == 2 {
                        Some(u16::from_le_bytes([chunk[0], chunk[1]]))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>();
            json!({
                "ok": true,
                "status": response.status,
                "pin": pin,
                "samples": samples,
                "readings": readings,
                "payload": response_payload_json(response.raw_payload)
            })
        }
        Err(error) => error,
    }
}

struct PrimitiveResponse {
    status: String,
    payload: Vec<u8>,
    raw_payload: Vec<u8>,
}

fn send_primitive(
    snapshot: &Arc<Mutex<McpDeviceSnapshot>>,
    command: &[u8],
    timeout_ms: u64,
) -> Result<PrimitiveResponse, Value> {
    let selected_device = snapshot
        .lock()
        .ok()
        .and_then(|snapshot| snapshot.selected_device.clone());
    let Some(device) = selected_device else {
        return Err(tool_error(
            "no_selected_device",
            "No selected Linux device is available for hardware tool calls",
            Some("Select or connect a device in the Linux app before calling hardware tools."),
        ));
    };

    if !device.connected {
        return Err(tool_error(
            "device_not_connected",
            "The selected Linux device is not connected",
            Some("Reconnect or select a connected device in the Linux app."),
        ));
    }

    let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        return Err(tool_error(
            "runtime_unavailable",
            "Failed to create Linux MCP transport runtime",
            None,
        ));
    };

    runtime.block_on(async {
        let mut transport = open_transport_for_device(&device).await.map_err(|err| {
            tool_error(
                "transport_unavailable",
                &format!("Could not open selected device transport: {err}"),
                None,
            )
        })?;
        let result =
            send_primitive_with_transport(&mut *transport, &device.transport, command, timeout_ms)
                .await;
        let _ = transport.close().await;
        result
    })
}

async fn open_transport_for_device(
    device: &DeviceRecord,
) -> Result<Box<dyn EmwaverTransport>, String> {
    let mut transport: Box<dyn EmwaverTransport> = match device.transport {
        TransportKind::Simulator => {
            return Err(
                "Simulator is an internal test transport and is not available in the Linux app UI."
                    .to_string(),
            );
        }
        TransportKind::UsbMidi => {
            let candidate = LinuxUsbManager::default()
                .discover()
                .map_err(|err| format!("USB discovery failed: {err}"))?
                .into_iter()
                .find(|candidate| candidate.id == device.id)
                .ok_or_else(|| format!("USB device {} is no longer present.", device.id))?;
            Box::new(
                LinuxUsbMidiTransport::new(candidate)
                    .map_err(|err| format!("USB transport setup failed: {err}"))?,
            )
        }
        TransportKind::Wifi => Box::new(LinuxWifiTransport::new(manual_wifi_target_from_device(
            device,
        )?)),
        TransportKind::Ble => Box::new(LinuxBleTransport::new(ble_target_from_device(device)?)),
        _ => {
            return Err(format!(
                "{:?} hardware primitive transport is not implemented yet.",
                device.transport
            ));
        }
    };
    transport
        .connect()
        .await
        .map_err(|err| format!("Transport connect failed: {err}"))?;
    Ok(transport)
}

async fn send_primitive_with_transport(
    transport: &mut dyn EmwaverTransport,
    kind: &TransportKind,
    command: &[u8],
    timeout_ms: u64,
) -> Result<PrimitiveResponse, Value> {
    let session_source = match kind {
        TransportKind::Ble => Some(0x02),
        TransportKind::Wifi => Some(0x03),
        _ => None,
    };

    if let Some(source) = session_source {
        claim_transport_session(transport, source).await?;
    }

    let command_result = match tokio::time::timeout(
        std::time::Duration::from_millis(timeout_ms.max(1)),
        send_command(transport, command),
    )
    .await
    {
        Ok(result) => result.map_err(|err| tool_error("command_failed", &err.to_string(), None)),
        Err(_) => Err(tool_error(
            "command_timeout",
            "Timed out waiting for a board response",
            None,
        )),
    };

    if let Some(source) = session_source {
        let _ = release_transport_session(transport, source).await;
    }

    primitive_response(command_result?)
}

async fn claim_transport_session(
    transport: &mut dyn EmwaverTransport,
    source: u8,
) -> Result<(), Value> {
    let response = send_command(transport, &[0x0B, 0x01, source])
        .await
        .map_err(|err| tool_error("transport_session_failed", &err.to_string(), None))?;
    match response.first().copied() {
        Some(RESPONSE_OK) => Ok(()),
        Some(RESPONSE_BUSY) => Err(tool_error(
            "device_busy",
            "Device is busy with another transport session",
            None,
        )),
        Some(RESPONSE_ERR) => Err(tool_error(
            "transport_session_rejected",
            "Device rejected the transport session command",
            None,
        )),
        Some(status) => Err(tool_error(
            "transport_session_unexpected",
            &format!("Device returned unexpected transport session status 0x{status:02X}"),
            None,
        )),
        None => Err(tool_error(
            "transport_session_empty",
            "Device returned an empty transport session response",
            None,
        )),
    }
}

async fn release_transport_session(
    transport: &mut dyn EmwaverTransport,
    source: u8,
) -> Result<(), Value> {
    send_command(transport, &[0x0B, 0x02, source])
        .await
        .map(|_| ())
        .map_err(|err| tool_error("transport_session_release_failed", &err.to_string(), None))
}

fn primitive_response(response: Vec<u8>) -> Result<PrimitiveResponse, Value> {
    let Some(status) = response.first().copied() else {
        return Err(tool_error(
            "empty_response",
            "Device returned an empty response",
            None,
        ));
    };
    if status != RESPONSE_OK {
        return Err(tool_error(
            "device_rejected",
            &format!("Device returned status 0x{status:02X}"),
            None,
        ));
    }
    let raw_payload = response.into_iter().skip(1).collect::<Vec<_>>();
    let significant_len = raw_payload
        .iter()
        .rposition(|byte| *byte != 0)
        .map(|index| index + 1)
        .unwrap_or(0);
    Ok(PrimitiveResponse {
        status: "ok".to_string(),
        payload: raw_payload[..significant_len].to_vec(),
        raw_payload,
    })
}

fn response_payload_json(payload: Vec<u8>) -> Value {
    json!({
        "bytes": payload,
        "hex": payload.iter().map(|byte| format!("{byte:02X}")).collect::<Vec<_>>().join(" ")
    })
}

fn manual_wifi_target_from_device(device: &DeviceRecord) -> Result<ManualWifiTarget, String> {
    let Some(rest) = device.id.strip_prefix("wifi:") else {
        return Err(format!(
            "Wi-Fi device {} is missing a manual target.",
            device.id
        ));
    };
    let Some((host, port)) = rest.rsplit_once(':') else {
        return Err(format!("Wi-Fi device {} is missing a port.", device.id));
    };
    let port = port
        .parse::<u16>()
        .map_err(|_| format!("Wi-Fi device {} has an invalid port.", device.id))?;
    ManualWifiTarget::new(host, port).map_err(|err| err.to_string())
}

fn ble_target_from_device(device: &DeviceRecord) -> Result<BleTarget, String> {
    let Some(rest) = device.id.strip_prefix("ble:") else {
        return Err(format!("BLE device {} is missing a target.", device.id));
    };
    let Some((adapter, address)) = rest.split_once(':') else {
        return Err(format!(
            "BLE device {} is missing a BlueZ adapter and address.",
            device.id
        ));
    };
    BleTarget::new(adapter, address, device.display_name.clone()).map_err(|err| err.to_string())
}

fn console_json(lines: Vec<String>) -> Vec<Value> {
    lines
        .into_iter()
        .map(|line| {
            let level = if line.contains("[error]") || line.to_lowercase().contains("failed") {
                "error"
            } else if line.contains("[warn]") {
                "warning"
            } else {
                "info"
            };
            json!({
                "level": level,
                "text": line,
                "timestamp": chrono_like_timestamp()
            })
        })
        .collect()
}

fn chrono_like_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| format!("{}.{:03}Z", duration.as_secs(), duration.subsec_millis()))
        .unwrap_or_else(|_| "0.000Z".to_string())
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

fn timeout_arg(arguments: Option<&Value>) -> Result<u64, Value> {
    int_arg(arguments, "timeout_ms", Some(1500), 1, 30_000).map(|value| value as u64)
}

fn byte_arg(arguments: Option<&Value>, key: &str, default: Option<u8>) -> Result<u8, Value> {
    int_arg(arguments, key, default.map(i64::from), 0, 255).map(|value| value as u8)
}

fn int_arg(
    arguments: Option<&Value>,
    key: &str,
    default: Option<i64>,
    min: i64,
    max: i64,
) -> Result<i64, Value> {
    let Some(value) = arguments.and_then(|value| value.get(key)) else {
        if let Some(default) = default {
            return Ok(default);
        }
        return Err(tool_error(
            &format!("missing_{key}"),
            &format!("{key} is required"),
            None,
        ));
    };
    let Some(number) = value
        .as_i64()
        .or_else(|| value.as_u64().map(|value| value as i64))
    else {
        return Err(tool_error(
            &format!("invalid_{key}"),
            &format!("{key} must be an integer"),
            None,
        ));
    };
    if number < min || number > max {
        return Err(tool_error(
            &format!("invalid_{key}"),
            &format!("{key} must be between {min} and {max}"),
            None,
        ));
    }
    Ok(number)
}

fn byte_array_arg(arguments: Option<&Value>, key: &str) -> Result<Vec<u8>, Value> {
    let Some(value) = arguments.and_then(|value| value.get(key)) else {
        return Err(tool_error(
            &format!("missing_{key}"),
            &format!("{key} is required"),
            None,
        ));
    };

    if let Some(items) = value.as_array() {
        let mut out = Vec::with_capacity(items.len());
        for item in items {
            let Some(number) = item
                .as_i64()
                .or_else(|| item.as_u64().map(|value| value as i64))
            else {
                return Err(tool_error(
                    &format!("invalid_{key}"),
                    &format!("{key} must contain only integers"),
                    None,
                ));
            };
            if !(0..=255).contains(&number) {
                return Err(tool_error(
                    &format!("invalid_{key}"),
                    &format!("{key} bytes must be between 0 and 255"),
                    None,
                ));
            }
            out.push(number as u8);
        }
        return Ok(out);
    }

    if let Some(text) = value.as_str() {
        return parse_hex_bytes(text).map_err(|message| {
            tool_error(
                &format!("invalid_{key}"),
                &format!("{key}: {message}"),
                None,
            )
        });
    }

    Err(tool_error(
        &format!("invalid_{key}"),
        &format!("{key} must be an array of bytes or a hex string"),
        None,
    ))
}

fn parse_hex_bytes(text: &str) -> Result<Vec<u8>, String> {
    let parts = text
        .split(|character: char| {
            character.is_ascii_whitespace() || character == ',' || character == ':'
        })
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.len() == 1 {
        let raw = parts[0].trim_start_matches("0x").trim_start_matches("0X");
        if raw.contains("0x") || raw.contains("0X") {
            return Err("compact hex strings cannot contain repeated 0x prefixes".to_string());
        }
        if raw.len() % 2 != 0 {
            return Err("hex string must contain an even number of digits".to_string());
        }
        return raw
            .as_bytes()
            .chunks(2)
            .map(|chunk| {
                let part = std::str::from_utf8(chunk)
                    .map_err(|_| "hex string is not valid UTF-8".to_string())?;
                u8::from_str_radix(part, 16).map_err(|_| format!("invalid hex byte '{part}'"))
            })
            .collect();
    }

    parts
        .into_iter()
        .map(|part| {
            let raw = part.trim_start_matches("0x").trim_start_matches("0X");
            u8::from_str_radix(raw, 16).map_err(|_| format!("invalid hex byte '{part}'"))
        })
        .collect()
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
