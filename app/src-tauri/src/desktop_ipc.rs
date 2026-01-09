use std::sync::Arc;

use emwaver_desktop_ipc::{IpcReady, IpcRequest, IpcResponse};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[cfg(unix)]
use tokio::net::UnixListener;
#[cfg(unix)]
use tokio::net::UnixStream;

#[cfg(windows)]
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};

pub fn spawn(app: tauri::AppHandle, device: super::DeviceState, script_state: Arc<super::ScriptState>) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = run(app, device, script_state).await {
            eprintln!("[desktop_ipc] stopped: {err}");
        }
    });
}

async fn run(
    app: tauri::AppHandle,
    device: super::DeviceState,
    script_state: Arc<super::ScriptState>,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        let sock = emwaver_desktop_ipc::socket_path()?;
        if let Some(parent) = sock.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
        }
        let _ = std::fs::remove_file(&sock);

        let listener = UnixListener::bind(&sock)
            .map_err(|e| format!("failed to bind {}: {e}", sock.display()))?;

        loop {
            let (stream, _addr) = listener
                .accept()
                .await
                .map_err(|e| format!("ipc accept failed: {e}"))?;

            tokio::spawn(handle_conn_unix(
                stream,
                app.clone(),
                device.clone(),
                script_state.clone(),
            ));
        }
    }

    #[cfg(windows)]
    {
        loop {
            let server = ServerOptions::new()
                .first_pipe_instance(false)
                .create(emwaver_desktop_ipc::pipe_name())
                .map_err(|e| format!("failed to create named pipe server: {e}"))?;

            let app = app.clone();
            let device = device.clone();
            let script_state = script_state.clone();
            tokio::spawn(async move {
                if let Err(e) = handle_conn_pipe(server, app, device, script_state).await {
                    eprintln!("[desktop_ipc] conn error: {e}");
                }
            });

            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }
}

#[cfg(unix)]
async fn handle_conn_unix(
    mut stream: UnixStream,
    app: tauri::AppHandle,
    device: super::DeviceState,
    script_state: Arc<super::ScriptState>,
) {
    if let Err(e) = handle_conn(&mut stream, app, device, script_state).await {
        eprintln!("[desktop_ipc] conn error: {e}");
    }
}

#[cfg(windows)]
async fn handle_conn_pipe(
    mut server: NamedPipeServer,
    app: tauri::AppHandle,
    device: super::DeviceState,
    script_state: Arc<super::ScriptState>,
) -> Result<(), String> {
    server
        .connect()
        .await
        .map_err(|e| format!("pipe connect failed: {e}"))?;
    handle_conn(&mut server, app, device, script_state).await
}

async fn handle_conn<RW>(
    stream: &mut RW,
    app: tauri::AppHandle,
    device: super::DeviceState,
    script_state: Arc<super::ScriptState>,
) -> Result<(), String>
where
    RW: AsyncReadExt + AsyncWriteExt + Unpin,
{
    let req_bytes = read_frame(stream).await?;
    let req: IpcRequest =
        serde_json::from_slice(&req_bytes).map_err(|e| format!("invalid request json: {e}"))?;

    let (ok, result, error) =
        handle_request(app, device, script_state, req.clone()).await;
    let resp = IpcResponse {
        id: req.id,
        ok,
        result,
        error,
    };
    let resp_bytes =
        serde_json::to_vec(&resp).map_err(|e| format!("failed to encode response: {e}"))?;
    write_frame(stream, &resp_bytes).await?;
    let _ = stream.flush().await;
    Ok(())
}

async fn handle_request(
    app: tauri::AppHandle,
    device: super::DeviceState,
    script_state: Arc<super::ScriptState>,
    req: IpcRequest,
) -> (bool, serde_json::Value, Option<String>) {
    match req.method.as_str() {
        "ping" => {
            let now = emwaver_desktop_ipc::now_ms();
            let ready = IpcReady {
                pid: std::process::id(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                ts_ms: now,
            };
            (true, serde_json::to_value(ready).unwrap_or(serde_json::json!({})), None)
        }
        "script_execute" => {
            let script = req
                .params
                .get("script")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let bootstrap = req
                .params
                .get("bootstrap")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            match super::script_execute_impl(app, device.bridge.clone(), script_state, script, bootstrap).await {
                Ok(()) => (true, serde_json::json!({}), None),
                Err(e) => (false, serde_json::Value::Null, Some(e)),
            }
        }
        "script_stop" => match super::script_stop_impl(script_state) {
            Ok(()) => (true, serde_json::json!({}), None),
            Err(e) => (false, serde_json::Value::Null, Some(e)),
        },
        "script_callback" => {
            let token = req
                .params
                .get("token")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let data = req.params.get("data").cloned().unwrap_or(serde_json::Value::Null);
            match super::script_callback_impl(script_state, token, data) {
                Ok(()) => (true, serde_json::json!({}), None),
                Err(e) => (false, serde_json::Value::Null, Some(e)),
            }
        }
        other => match device.rpc(other, req.params).await {
            Ok(v) => (true, v, None),
            Err(e) => (false, serde_json::Value::Null, Some(e)),
        },
    }
}

async fn read_frame<R: AsyncReadExt + Unpin>(r: &mut R) -> Result<Vec<u8>, String> {
    let len = r
        .read_u32_le()
        .await
        .map_err(|e| format!("ipc read length failed: {e}"))? as usize;
    if len > 8 * 1024 * 1024 {
        return Err(format!("ipc frame too large: {len}"));
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf)
        .await
        .map_err(|e| format!("ipc read body failed: {e}"))?;
    Ok(buf)
}

async fn write_frame<W: AsyncWriteExt + Unpin>(w: &mut W, bytes: &[u8]) -> Result<(), String> {
    let len: u32 = bytes
        .len()
        .try_into()
        .map_err(|_| "ipc frame too large".to_string())?;
    w.write_u32_le(len)
        .await
        .map_err(|e| format!("ipc write length failed: {e}"))?;
    w.write_all(bytes)
        .await
        .map_err(|e| format!("ipc write body failed: {e}"))?;
    Ok(())
}
