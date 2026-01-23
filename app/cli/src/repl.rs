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
use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::{bail, Context as _, Result};
use boa_engine::{
    js_string,
    native_function::NativeFunction,
    object::{builtins::JsUint8Array, ObjectInitializer},
    property::PropertyKey,
    Context, JsArgs, JsNativeError, JsValue, Source,
};
use serde_json::json;
use time::{macros::format_description, OffsetDateTime};

use crate::desktop_ipc;

const DEFAULT_TIMEOUT_MS: u64 = 2000;
const BOOTSTRAP_SOURCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../public/default-scripts/script_bootstrap.emw"
));

pub fn run_repl() -> Result<()> {
    desktop_ipc::desktop_ready(2_000)?;

    let repl = Repl::new()?;
    run_repl_loop(repl)
}

pub fn run_code(code: &str) -> Result<()> {
    desktop_ipc::desktop_ready(2_000)?;
    let mut repl = Repl::new()?;
    repl.eval_script(code, Duration::from_secs(15))?;
    Ok(())
}

pub fn run_file(path: PathBuf, interactive: bool) -> Result<()> {
    ensure_emw_path(&path)?;

    desktop_ipc::desktop_ready(2_000)?;
    let code = std::fs::read_to_string(&path)
        .with_context(|| format!("failed to read {}", path.display()))?;

    let mut repl = Repl::new()?;
    repl.eval_script(&code, Duration::from_secs(30))?;

    if interactive {
        return run_repl_loop(repl);
    }

    Ok(())
}

fn run_repl_loop(mut repl: Repl) -> Result<()> {
    repl.print_banner();

    let mut pending = String::new();
    let stdin = io::stdin();
    loop {
        if pending.is_empty() {
            print!(">>> ");
        } else {
            print!("... ");
        }
        io::stdout().flush().ok();

        let mut line = String::new();
        let n = stdin.read_line(&mut line)?;
        if n == 0 {
            break;
        }

        pending.push_str(&line);
        if pending.trim().is_empty() {
            pending.clear();
            continue;
        }

        let outcome = match repl.eval_repl_submission(&pending, Duration::from_secs(15)) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("{e}");
                pending.clear();
                continue;
            }
        };

        match outcome {
            EvalReplOutcome::Incomplete => continue,
            EvalReplOutcome::Exit => break,
            EvalReplOutcome::Done => pending.clear(),
        }
    }

    Ok(())
}

fn ensure_emw_path(path: &PathBuf) -> Result<()> {
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    if ext.eq_ignore_ascii_case("emw") {
        return Ok(());
    }
    bail!("Only .emw scripts are supported ({})", path.display());
}

enum EvalReplOutcome {
    Done,
    Incomplete,
    Exit,
}

struct Repl {
    ctx: Context,
}

impl Repl {
    fn new() -> Result<Self> {
        let mut ctx = Context::default();
        register_natives(&mut ctx)?;
        ctx.eval(Source::from_bytes(BOOTSTRAP_SOURCE))
            .map_err(|e| anyhow::anyhow!("bootstrap error: {e}"))?;
        ctx.eval(Source::from_bytes(
            r#"
                globalThis.__emw_repl_exit = false;
                globalThis.exit = function () { globalThis.__emw_repl_exit = true; };
                globalThis.quit = globalThis.exit;

                globalThis.help = function () {
                    _scriptPrint("EMWaver REPL help");
                    _scriptPrint("- await device.version()");
                    _scriptPrint("- await device.ping()");
                    _scriptPrint("- device (device APIs)");
                    _scriptPrint("- Sampler (sampler APIs)");
                    _scriptPrint("- exit() / quit()");
                };
                globalThis.copyright = function () {
                    _scriptPrint("Copyright (c) 2026 Luis Marnoto");
                };
                globalThis.credits = function () {
                    _scriptPrint("EMWaver contributors");
                };
                globalThis.license = function () {
                    _scriptPrint("Apache-2.0");
                };
            "#,
        ))
        .ok();
        Ok(Self { ctx })
    }

    fn print_banner(&self) {
        let version = env!("CARGO_PKG_VERSION");
        let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
        let fmt = format_description!("[month repr:short] [day padding:none] [year]");
        let date = now
            .format(&fmt)
            .unwrap_or_else(|_| "unknown date".to_string());

        println!("EMWaver {version} ({date})");
        println!("Type \"help\", \"copyright\", \"credits\" or \"license\" for more information.");
        println!();
        println!("Ctrl-D or exit() to quit");
    }

    fn eval_repl_submission(&mut self, code: &str, timeout: Duration) -> Result<EvalReplOutcome> {
        match self.eval_repl(code, timeout)? {
            EvalResult::Incomplete => Ok(EvalReplOutcome::Incomplete),
            EvalResult::Exit => Ok(EvalReplOutcome::Exit),
            EvalResult::Done { value } => {
                if let Some(v) = value {
                    println!("{v}");
                }
                Ok(EvalReplOutcome::Done)
            }
        }
    }

    fn eval_script(&mut self, code: &str, timeout: Duration) -> Result<()> {
        match self.eval_any(code, timeout)? {
            EvalResult::Incomplete => bail!("incomplete input"),
            EvalResult::Exit => Ok(()),
            EvalResult::Done { .. } => Ok(()),
        }
    }

    fn eval_repl(&mut self, code: &str, timeout: Duration) -> Result<EvalResult> {
        self.eval_any(code, timeout)
    }

    fn eval_any(&mut self, code: &str, timeout: Duration) -> Result<EvalResult> {
        match code.trim() {
            "help" | "copyright" | "credits" | "license" => {
                let name = code.trim();
                return self.eval_any(&format!("{name}()"), timeout);
            }
            _ => {}
        }

        let code_trim = code.trim_start();
        let looks_like_top_level_await =
            code_trim.starts_with("await ") || code_trim.contains("\nawait ");

        // First try direct eval (preserves top-level bindings for "Python-like" REPL behavior).
        match self.ctx.eval(Source::from_bytes(code)) {
            Ok(v) => {
                if self.should_exit()? {
                    return Ok(EvalResult::Exit);
                }
                if v.is_undefined() {
                    return Ok(EvalResult::Done { value: None });
                }
                let s = js_value_to_repr(&v, &mut self.ctx)?;
                self.set_last_value(&v)?;
                return Ok(EvalResult::Done { value: Some(s) });
            }
            Err(e) => {
                let msg = e.to_string();
                if is_incomplete_error(&msg) {
                    return Ok(EvalResult::Incomplete);
                }

                // If the input used top-level `await`, re-run inside an async wrapper.
                // Boa's error strings for top-level await aren't consistent, so also use a
                // cheap syntactic heuristic.
                if looks_like_top_level_await || is_top_level_await_error(&msg) {
                    return self.eval_async(code, timeout);
                }

                bail!("{e}")
            }
        }
    }

    fn eval_async(&mut self, code: &str, timeout: Duration) -> Result<EvalResult> {
        let expr = code.trim();
        let expr = expr.strip_suffix(';').unwrap_or(expr).trim();

        // Expression-first wrapper: supports `await device.version()` and `x = await ...`.
        // Falls back to statement wrapper for things like `let x = await ...`.
        let expr_wrapper = async_expr_wrapper(expr);
        match self.ctx.eval(Source::from_bytes(&expr_wrapper)) {
            Ok(_) => {}
            Err(e) => {
                let msg = e.to_string();
                if is_incomplete_error(&msg) {
                    return Ok(EvalResult::Incomplete);
                }

                let stmt_wrapper = async_stmt_wrapper(code);
                match self.ctx.eval(Source::from_bytes(&stmt_wrapper)) {
                    Ok(_) => {}
                    Err(e2) => {
                        let msg2 = e2.to_string();
                        if is_incomplete_error(&msg2) {
                            return Ok(EvalResult::Incomplete);
                        }
                        bail!("{e2}")
                    }
                }
            }
        }

        self.wait_async_done(timeout)?;
        if self.should_exit()? {
            return Ok(EvalResult::Exit);
        }

        let value = self.take_async_value()?;
        Ok(EvalResult::Done { value })
    }

    fn should_exit(&mut self) -> Result<bool> {
        let global = self.ctx.global_object();
        let flag = global
            .get(js_string!("__emw_repl_exit"), &mut self.ctx)
            .unwrap_or(JsValue::from(false));
        Ok(flag.to_boolean())
    }

    fn set_last_value(&mut self, v: &JsValue) -> Result<()> {
        let global = self.ctx.global_object();
        global
            .set(js_string!("_"), v.clone(), false, &mut self.ctx)
            .ok();
        Ok(())
    }

    fn wait_async_done(&mut self, timeout: Duration) -> Result<()> {
        let deadline = Instant::now() + timeout;
        loop {
            self.ctx.run_jobs();
            let global = self.ctx.global_object();
            let done = global
                .get(js_string!("__emw_repl_done"), &mut self.ctx)
                .unwrap_or(JsValue::from(false))
                .to_boolean();
            if done {
                break;
            }
            if Instant::now() >= deadline {
                bail!("timeout waiting for async result");
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        Ok(())
    }

    fn take_async_value(&mut self) -> Result<Option<String>> {
        let global = self.ctx.global_object();
        let err = global
            .get(js_string!("__emw_repl_error"), &mut self.ctx)
            .unwrap_or(JsValue::undefined());
        if !err.is_undefined() {
            let msg = js_value_to_repr(&err, &mut self.ctx)?;
            bail!("{msg}");
        }

        let value = global
            .get(js_string!("__emw_repl_value"), &mut self.ctx)
            .unwrap_or(JsValue::undefined());
        if value.is_undefined() {
            return Ok(None);
        }
        let s = js_value_to_repr(&value, &mut self.ctx)?;
        self.set_last_value(&value)?;
        Ok(Some(s))
    }
}

enum EvalResult {
    Done { value: Option<String> },
    Incomplete,
    Exit,
}

fn is_incomplete_error(msg: &str) -> bool {
    let m = msg.to_ascii_lowercase();
    m.contains("unexpected end") || m.contains("unterminated")
}

fn is_top_level_await_error(msg: &str) -> bool {
    let m = msg.to_ascii_lowercase();
    // Boa error messages for top-level await vary across contexts.
    // Keep this broad and rely on additional syntactic heuristics in the caller.
    m.contains("await")
}

fn async_expr_wrapper(code: &str) -> String {
    format!(
        r#"
            globalThis.__emw_repl_done = false;
            globalThis.__emw_repl_error = undefined;
            globalThis.__emw_repl_value = undefined;
            Promise.resolve((async () => {{ return ({}); }})())
                .then((v) => {{ globalThis.__emw_repl_value = v; globalThis.__emw_repl_done = true; }})
                .catch((e) => {{ globalThis.__emw_repl_error = e; globalThis.__emw_repl_done = true; }});
        "#,
        code
    )
}

fn async_stmt_wrapper(code: &str) -> String {
    format!(
        r#"
            globalThis.__emw_repl_done = false;
            globalThis.__emw_repl_error = undefined;
            globalThis.__emw_repl_value = undefined;
            Promise.resolve((async () => {{
                {}
            }})())
                .then((v) => {{ globalThis.__emw_repl_value = v; globalThis.__emw_repl_done = true; }})
                .catch((e) => {{ globalThis.__emw_repl_error = e; globalThis.__emw_repl_done = true; }});
        "#,
        code
    )
}

fn js_value_to_repr(value: &JsValue, ctx: &mut Context) -> Result<String> {
    let s = value
        .to_string(ctx)
        .map_err(|e| anyhow::anyhow!("{e}"))?
        .to_std_string_escaped();
    Ok(s)
}

fn register_natives(ctx: &mut Context) -> Result<()> {
    // _scriptPrint(message: string)
    let print_fn = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let msg = args.get_or_undefined(0).to_string(ctx)?;
            let mut stdout = io::stdout();
            let _ = stdout.write_all(msg.to_std_string_escaped().as_bytes());
            let _ = stdout.write_all(b"\n");
            let _ = stdout.flush();
            Ok(JsValue::undefined())
        })
    };
    ctx.register_global_builtin_callable(js_string!("_scriptPrint"), 1, print_fn)
        .map_err(|e| anyhow::anyhow!("Failed to register _scriptPrint: {e}"))?;

    // _scriptRender(node: object) (no-op in CLI)
    let render_fn =
        unsafe { NativeFunction::from_closure(move |_this, _args, _ctx| Ok(JsValue::undefined())) };
    ctx.register_global_builtin_callable(js_string!("_scriptRender"), 1, render_fn)
        .map_err(|e| anyhow::anyhow!("Failed to register _scriptRender: {e}"))?;

    // _scriptRegisterCallback(token, fn) (no-op in CLI)
    let reg_cb_fn =
        unsafe { NativeFunction::from_closure(move |_this, _args, _ctx| Ok(JsValue::undefined())) };
    ctx.register_global_builtin_callable(js_string!("_scriptRegisterCallback"), 2, reg_cb_fn)
        .map_err(|e| anyhow::anyhow!("Failed to register _scriptRegisterCallback: {e}"))?;

    // _scriptSleep(ms)
    let sleep_fn = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let ms = args.get_or_undefined(0).to_u32(ctx).unwrap_or(0) as u64;
            std::thread::sleep(Duration::from_millis(ms));
            Ok(JsValue::undefined())
        })
    };
    ctx.register_global_builtin_callable(js_string!("_scriptSleep"), 1, sleep_fn)
        .map_err(|e| anyhow::anyhow!("Failed to register _scriptSleep: {e}"))?;

    // _scriptConnectionStatus(): string
    let conn_fn = unsafe {
        NativeFunction::from_closure(move |_this, _args, _ctx| {
            let value = desktop_ipc::rpc_ok("connection_status", json!({}), Duration::from_secs(2))
                .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
            let connected = value
                .get("connected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let s = if connected {
                "connected"
            } else {
                "disconnected"
            };
            Ok(JsValue::from(js_string!(s)))
        })
    };
    ctx.register_global_builtin_callable(js_string!("_scriptConnectionStatus"), 0, conn_fn)
        .map_err(|e| anyhow::anyhow!("Failed to register _scriptConnectionStatus: {e}"))?;

    // _scriptSendCommandString(command: string, timeoutMs: number): Uint8Array
    let send_fn = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let command = args.get_or_undefined(0).to_string(ctx)?;
            let timeout_ms = args
                .get_or_undefined(1)
                .to_u32(ctx)
                .unwrap_or(DEFAULT_TIMEOUT_MS as u32) as u64;
            let text = command.to_std_string_escaped();
            let value = desktop_ipc::rpc_ok(
                "send_command",
                json!({
                    "text": text,
                    "timeout_ms": timeout_ms,
                    "packets": 1u32
                }),
                Duration::from_millis(timeout_ms.saturating_add(5_000).max(1)),
            )
            .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;

            let bytes_b64 = value
                .get("bytes_b64")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let bytes = desktop_ipc::decode_b64(bytes_b64)
                .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
            let array = JsUint8Array::from_iter(bytes.into_iter(), ctx)
                .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
            Ok(array.into())
        })
    };
    ctx.register_global_builtin_callable(js_string!("_scriptSendCommandString"), 2, send_fn)
        .map_err(|e| anyhow::anyhow!("Failed to register _scriptSendCommandString: {e}"))?;

    // Sampler/buffer bridge functions used by script_bootstrap.
    register_sampler_natives(ctx)?;

    Ok(())
}

fn register_sampler_natives(ctx: &mut Context) -> Result<()> {
    // _scriptSamplerBufferGetPacketCount()
    let pkt_count_fn = unsafe {
        NativeFunction::from_closure(move |_this, _args, _ctx| {
            let value =
                desktop_ipc::rpc_ok("buffer_get_packet_count", json!({}), Duration::from_secs(2))
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
            let count = value
                .get("packet_count")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            Ok(JsValue::from(count as f64))
        })
    };
    ctx.register_global_builtin_callable(
        js_string!("_scriptSamplerBufferGetPacketCount"),
        0,
        pkt_count_fn,
    )
    .map_err(|e| anyhow::anyhow!("Failed to register _scriptSamplerBufferGetPacketCount: {e}"))?;

    // _scriptSamplerBufferGetLenBytes()
    let len_fn = unsafe {
        NativeFunction::from_closure(move |_this, _args, _ctx| {
            let value =
                desktop_ipc::rpc_ok("buffer_get_len_bytes", json!({}), Duration::from_secs(2))
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
            let len = value.get("len_bytes").and_then(|v| v.as_u64()).unwrap_or(0);
            Ok(JsValue::from(len as f64))
        })
    };
    ctx.register_global_builtin_callable(js_string!("_scriptSamplerBufferGetLenBytes"), 0, len_fn)
        .map_err(|e| anyhow::anyhow!("Failed to register _scriptSamplerBufferGetLenBytes: {e}"))?;

    // _scriptSamplerBufferGetBytes()
    let get_bytes_fn = unsafe {
        NativeFunction::from_closure(move |_this, _args, ctx| {
            let value = desktop_ipc::rpc_ok("buffer_get_bytes", json!({}), Duration::from_secs(2))
                .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
            let data_b64 = value.get("data_b64").and_then(|v| v.as_str()).unwrap_or("");
            let bytes = desktop_ipc::decode_b64(data_b64)
                .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
            let array = JsUint8Array::from_iter(bytes.into_iter(), ctx)
                .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
            Ok(array.into())
        })
    };
    ctx.register_global_builtin_callable(
        js_string!("_scriptSamplerBufferGetBytes"),
        0,
        get_bytes_fn,
    )
    .map_err(|e| anyhow::anyhow!("Failed to register _scriptSamplerBufferGetBytes: {e}"))?;

    // _scriptSamplerBufferClear()
    let clear_fn = unsafe {
        NativeFunction::from_closure(move |_this, _args, _ctx| {
            desktop_ipc::rpc_ok("sampler_buffer_clear", json!({}), Duration::from_secs(2))
                .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
            Ok(JsValue::undefined())
        })
    };
    ctx.register_global_builtin_callable(js_string!("_scriptSamplerBufferClear"), 0, clear_fn)
        .map_err(|e| anyhow::anyhow!("Failed to register _scriptSamplerBufferClear: {e}"))?;

    // _scriptSamplerBufferSetInvertRx(enabled)
    let invert_fn = unsafe {
        NativeFunction::from_closure(move |_this, args, _ctx| {
            let enabled = args.get_or_undefined(0).to_boolean();
            desktop_ipc::rpc_ok(
                "buffer_set_invert_rx",
                json!({ "enabled": enabled }),
                Duration::from_secs(2),
            )
            .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
            Ok(JsValue::undefined())
        })
    };
    ctx.register_global_builtin_callable(
        js_string!("_scriptSamplerBufferSetInvertRx"),
        1,
        invert_fn,
    )
    .map_err(|e| anyhow::anyhow!("Failed to register _scriptSamplerBufferSetInvertRx: {e}"))?;

    // _scriptSamplerBufferReadPacketsSince(packetIndex, maxPackets)
    let read_fn = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let packet_index = args.get_or_undefined(0).to_u32(ctx).unwrap_or(0) as u64;
            let max_packets = args.get_or_undefined(1).to_u32(ctx).unwrap_or(256) as u64;
            let value = desktop_ipc::rpc_ok(
                "buffer_read_packets_since",
                json!({ "packet_index": packet_index, "max_packets": max_packets }),
                Duration::from_secs(5),
            )
            .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
            let data_b64 = value.get("data_b64").and_then(|v| v.as_str()).unwrap_or("");
            let bytes = desktop_ipc::decode_b64(data_b64)
                .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
            let next_idx = value
                .get("next_packet_index")
                .and_then(|v| v.as_u64())
                .unwrap_or(packet_index);
            let avail = value
                .get("available_packets")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);

            let data = JsUint8Array::from_iter(bytes.into_iter(), ctx)
                .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
            let obj = ObjectInitializer::new(ctx)
                .property(
                    js_string!("data"),
                    data,
                    boa_engine::property::Attribute::all(),
                )
                .property(
                    js_string!("nextPacketIndex"),
                    JsValue::from(next_idx as f64),
                    boa_engine::property::Attribute::all(),
                )
                .property(
                    js_string!("availablePackets"),
                    JsValue::from(avail as f64),
                    boa_engine::property::Attribute::all(),
                )
                .build();
            Ok(obj.into())
        })
    };
    ctx.register_global_builtin_callable(
        js_string!("_scriptSamplerBufferReadPacketsSince"),
        2,
        read_fn,
    )
    .map_err(|e| anyhow::anyhow!("Failed to register _scriptSamplerBufferReadPacketsSince: {e}"))?;

    // _scriptSamplerBufferCompressViewport(startBit, endBit, bins)
    let compress_fn = unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let start_bit = args.get_or_undefined(0).to_u32(ctx).unwrap_or(0) as u64;
            let end_bit = args.get_or_undefined(1).to_u32(ctx).unwrap_or(0) as u64;
            let bins = args.get_or_undefined(2).to_u32(ctx).unwrap_or(0) as u64;
            let value = desktop_ipc::rpc_ok(
                "buffer_compress_viewport",
                json!({ "range_start": start_bit, "range_end": end_bit, "number_bins": bins }),
                Duration::from_secs(10),
            )
            .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;

            let buffer_len = value
                .get("buffer_len_bytes")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let time_values = value
                .get("time_values")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let data_values = value
                .get("data_values")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            let time_arr = boa_engine::object::builtins::JsArray::from_iter(
                time_values
                    .into_iter()
                    .map(|v| JsValue::from(v.as_i64().unwrap_or(0) as f64)),
                ctx,
            );
            let data_arr = boa_engine::object::builtins::JsArray::from_iter(
                data_values
                    .into_iter()
                    .map(|v| JsValue::from(v.as_i64().unwrap_or(0) as f64)),
                ctx,
            );

            let obj = ObjectInitializer::new(ctx)
                .property(
                    js_string!("bufferLenBytes"),
                    JsValue::from(buffer_len as f64),
                    boa_engine::property::Attribute::all(),
                )
                .property(
                    js_string!("timeValues"),
                    time_arr,
                    boa_engine::property::Attribute::all(),
                )
                .property(
                    js_string!("dataValues"),
                    data_arr,
                    boa_engine::property::Attribute::all(),
                )
                .build();
            Ok(obj.into())
        })
    };
    ctx.register_global_builtin_callable(
        js_string!("_scriptSamplerBufferCompressViewport"),
        3,
        compress_fn,
    )
    .map_err(|e| anyhow::anyhow!("Failed to register _scriptSamplerBufferCompressViewport: {e}"))?;

    Ok(())
}
