use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use base64::Engine as _;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn next_id() -> u64 {
    let t = emwaver_desktop_ipc::now_ms();
    let seq = NEXT_ID.fetch_add(1, Ordering::Relaxed) & 0xFFFF;
    (t << 16) | seq
}

pub fn desktop_ready(max_age_ms: u64) -> Result<emwaver_desktop_ipc::IpcReady> {
    let value = rpc_ok(
        "ping",
        serde_json::json!({}),
        Duration::from_millis(max_age_ms.max(1)),
    )?;
    let ready: emwaver_desktop_ipc::IpcReady =
        serde_json::from_value(value).context("invalid ping response")?;
    Ok(ready)
}

pub fn rpc(
    method: &str,
    params: serde_json::Value,
    timeout: Duration,
) -> Result<emwaver_desktop_ipc::IpcResponse> {
    let id = next_id();
    let request = emwaver_desktop_ipc::IpcRequest {
        id,
        method: method.to_string(),
        params,
    };

    block_on(async move {
        let req_bytes = serde_json::to_vec(&request).context("failed to encode request")?;
        let resp_bytes = tokio::time::timeout(timeout, async {
            let mut stream = connect().await?;
            write_frame(&mut stream, &req_bytes).await?;
            stream.flush().await.ok();
            read_frame(&mut stream).await
        })
        .await
        .map_err(|_| anyhow::anyhow!("timeout waiting for Desktop response ({method})"))??;

        let resp: emwaver_desktop_ipc::IpcResponse =
            serde_json::from_slice(&resp_bytes).context("invalid response")?;
        Ok(resp)
    })
}

pub fn rpc_ok(method: &str, params: serde_json::Value, timeout: Duration) -> Result<serde_json::Value> {
    let resp = rpc(method, params, timeout)?;
    if !resp.ok {
        bail!("{}", resp.error.unwrap_or_else(|| "unknown error".to_string()));
    }
    Ok(resp.result)
}

pub fn decode_b64(s: &str) -> Result<Vec<u8>> {
    base64::engine::general_purpose::STANDARD
        .decode(s.as_bytes())
        .context("invalid base64")
}

fn block_on<T>(fut: impl std::future::Future<Output = Result<T>>) -> Result<T> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("failed to start tokio runtime")?
        .block_on(fut)
}

#[cfg(unix)]
async fn connect() -> Result<tokio::net::UnixStream> {
    let sock = emwaver_desktop_ipc::socket_path().map_err(anyhow::Error::msg)?;
    tokio::net::UnixStream::connect(&sock)
        .await
        .with_context(|| {
            format!(
                "EMWaver Desktop is not running (failed to connect to {})",
                sock.display()
            )
        })
}

#[cfg(windows)]
async fn connect() -> Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    use tokio::net::windows::named_pipe::ClientOptions;
    ClientOptions::new()
        .open(emwaver_desktop_ipc::pipe_name())
        .with_context(|| "EMWaver Desktop is not running (failed to open named pipe)".to_string())
}

async fn read_frame<R: AsyncReadExt + Unpin>(r: &mut R) -> Result<Vec<u8>> {
    let len = r.read_u32_le().await.context("ipc read length failed")? as usize;
    if len > 8 * 1024 * 1024 {
        bail!("ipc frame too large: {len}");
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf).await.context("ipc read body failed")?;
    Ok(buf)
}

async fn write_frame<W: AsyncWriteExt + Unpin>(w: &mut W, bytes: &[u8]) -> Result<()> {
    let len: u32 = bytes
        .len()
        .try_into()
        .map_err(|_| anyhow::anyhow!("ipc frame too large"))?;
    w.write_u32_le(len).await.context("ipc write length failed")?;
    w.write_all(bytes).await.context("ipc write body failed")?;
    Ok(())
}
