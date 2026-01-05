/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use base64::Engine;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::runtime::Runtime;

#[cfg(unix)]
use tokio::net::UnixStream;

use emwaver_buffer_core::packet::make_packet64;

use crate::bridge::BridgeRequest;
use crate::daemon;

static PROMPT_PENDING: AtomicBool = AtomicBool::new(true);

#[cfg(unix)]
async fn daemon_subscribe_events(stream: &mut UnixStream) -> Result<()> {
    let req = BridgeRequest {
        id: 999,
        method: "events_subscribe".to_string(),
        params: serde_json::json!({}),
    };
    let bytes = serde_json::to_vec(&req).context("failed to encode events_subscribe")?;
    stream.write_all(&bytes).await.context("failed to write events_subscribe")?;
    stream.write_all(b"\n").await.context("failed to write newline")?;
    stream.flush().await.ok();
    Ok(())
}

pub fn run_shell(verbose: bool) -> Result<()> {
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async { run_shell_async(verbose).await })
}

async fn run_shell_async(verbose: bool) -> Result<()> {
    // Prefer the daemon so connections persist across processes (VS Code, app, etc).
    // On non-unix platforms, the daemon isn't available yet.
    #[cfg(unix)]
    {
        return run_shell_daemon(verbose).await;
    }

    #[cfg(not(unix))]
    {
        bail!("shell is not supported on this platform yet without the daemon");
    }
}

#[cfg(unix)]
async fn run_shell_daemon(verbose: bool) -> Result<()> {
    let socket = daemon::ensure_daemon_running(None)?;

    // Connect (scan + pick first matching device) if not already connected.
    println!("Connecting to EMWaver via daemon...");
    let _ = daemon::daemon_rpc(
        &socket,
        BridgeRequest {
            id: 1,
            method: "connect".to_string(),
            params: serde_json::json!({
                "port_name": null,
            }),
        },
        Duration::from_secs(20),
    )
    .await?;

    // Listen for async notifications/events and render them like the old shell.
    let events_socket = socket.clone();
    let notify_task = tokio::spawn(async move {
        let stream = UnixStream::connect(&events_socket).await;
        let Ok(mut stream) = stream else {
            return;
        };
        // This connection is dedicated to events; enable forwarding on it.
        if daemon_subscribe_events(&mut stream).await.is_err() {
            return;
        }
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        loop {
            line.clear();
            let n = match reader.read_line(&mut line).await {
                Ok(v) => v,
                Err(_) => break,
            };
            if n == 0 {
                break;
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let value: serde_json::Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let Some(event) = value.get("event").and_then(|v| v.as_str()) else {
                continue;
            };
            let data = value.get("data").cloned().unwrap_or_default();
            match event {
                "rx_bytes" => {
                    if let Some(bytes_b64) = data.get("bytes_b64").and_then(|v| v.as_str()) {
                        if let Ok(bytes) = base64::engine::general_purpose::STANDARD
                            .decode(bytes_b64.as_bytes())
                        {
                            render_notification(&bytes, verbose);
                        }
                    }
                }
                "connected" => {
                    if let Some(addr) = data.get("address").and_then(|v| v.as_str()) {
                        print!("\r\x1b[K");
                        let _ = io::stdout().flush();
                        println!("Connected: {addr}");
                        let _ = print_prompt();
                    }
                }
                "disconnected" => {
                    print!("\r\x1b[K");
                    let _ = io::stdout().flush();
                    println!("Disconnected.");
                    let _ = print_prompt();
                }
                _ => {}
            }
        }
    });

    let repl_result = run_repl_daemon(socket).await;

    notify_task.abort();
    let _ = notify_task.await;

    repl_result
}

#[cfg(unix)]
async fn run_repl_daemon(socket: std::path::PathBuf) -> Result<()> {
    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut line = String::new();

    loop {
        if PROMPT_PENDING.swap(false, Ordering::SeqCst) {
            print_prompt()?;
        }
        line.clear();

        tokio::select! {
            res = reader.read_line(&mut line) => {
                let bytes_read = res.context("failed to read input")?;
                if bytes_read == 0 {
                    println!("\nEnd of input, exiting shell.");
                    break;
                }

                let trimmed = line.trim_end_matches(['\r', '\n']);
                if trimmed.eq_ignore_ascii_case("exit") || trimmed.eq_ignore_ascii_case("quit") {
                    println!("Exiting shell.");
                    break;
                }
                if trimmed.eq_ignore_ascii_case("clear") {
                    clear_screen();
                    PROMPT_PENDING.store(true, Ordering::SeqCst);
                    continue;
                }
                if trimmed.is_empty() {
                    PROMPT_PENDING.store(true, Ordering::SeqCst);
                    continue;
                }

                match parse_command(trimmed) {
                    Ok(payload) => {
                        let bytes_b64 = base64::engine::general_purpose::STANDARD.encode(payload);
                        let res = daemon::daemon_rpc(
                            &socket,
                            BridgeRequest {
                                id: 2,
                                method: "write".to_string(),
                                params: serde_json::json!({ "bytes_b64": bytes_b64 }),
                            },
                            Duration::from_secs(2),
                        )
                        .await;
                        if let Err(err) = res {
                            println!("Write failed: {err}");
                        }
                    }
                    Err(err) => {
                        println!("Parse error: {err}");
                    }
                }
                PROMPT_PENDING.store(true, Ordering::SeqCst);
            }
            _ = tokio::signal::ctrl_c() => {
                print!("\r\x1b[K");
                io::stdout().flush().ok();
                println!("Use 'exit' to leave the EMWaver shell.");
                PROMPT_PENDING.store(true, Ordering::SeqCst);
            }
        }
    }

    Ok(())
}

fn parse_command(input: &str) -> Result<[u8; emwaver_buffer_core::PACKET_SIZE]> {
    let mut bytes = Vec::new();
    let mut idx = 0;
    let data = input.as_bytes();

    while idx < data.len() {
        if data[idx] == b'[' {
            let end = input[idx + 1..]
                .find(']')
                .map(|off| idx + 1 + off)
                .ok_or_else(|| anyhow!("missing closing ']'"))?;
            let content = input[idx + 1..end].trim();
            let value = parse_bracket_value(content)?;
            bytes.push(value);
            idx = end + 1;
        } else {
            bytes.push(data[idx]);
            idx += 1;
        }
    }

    make_packet64(&bytes).map_err(|e| anyhow!(e))
}

fn parse_bracket_value(content: &str) -> Result<u8> {
    if content.is_empty() {
        bail!("empty value inside brackets");
    }

    let value = if let Some(stripped) = content
        .strip_prefix("0x")
        .or_else(|| content.strip_prefix("0X"))
    {
        u8::from_str_radix(stripped, 16).context("invalid hex value")?
    } else {
        u8::from_str_radix(content, 10).context("invalid decimal value")?
    };

    Ok(value)
}

fn render_notification(data: &[u8], verbose: bool) {
    if data.is_empty() {
        return;
    }

    let ascii = data
        .iter()
        .map(|&b| match b {
            0x20..=0x7E => b as char,
            _ => '.',
        })
        .collect::<String>();

    // Clear current line and print notification
    print!("\r\x1b[K");
    if verbose {
        let hex = data
            .iter()
            .map(|b| format!("{:02X}", b))
            .collect::<Vec<_>>()
            .join(" ");
        println!("hex:   {hex}");
        println!("ascii: {ascii}");
    } else {
        println!("{ascii}");
    }
    io::stdout().flush().ok();
    
    // Print prompt on a fresh line
    if let Err(err) = print_prompt() {
        eprintln!("Failed to print prompt: {err}");
    }
    PROMPT_PENDING.store(false, Ordering::SeqCst);
}

fn clear_screen() {
    print!("\x1b[2J\x1b[H");
    io::stdout().flush().ok();
}

fn print_prompt() -> Result<()> {
    print!("<emw> ");
    io::stdout().flush().context("failed to flush stdout")
}
