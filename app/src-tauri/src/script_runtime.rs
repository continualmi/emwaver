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

//! Embedded JavaScript runtime for scripts.
//!
//! This module runs script scripts directly in Rust using Boa JS engine,
//! providing direct USB access without IPC overhead for hardware commands.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use std::process::Command;

use boa_engine::{
    js_string, native_function::NativeFunction, Context, JsArgs, JsNativeError,
    JsResult, JsValue, Source,
};
use boa_engine::value::TryFromJs;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use base64::Engine;

use emwaver_device_core::bridge::{
    BridgeState,
    BridgeRequest,
    dispatch_request,
    sampler_buffer_clear_only,
    sampler_buffer_compress_viewport,
    sampler_buffer_get_bytes,
    sampler_buffer_len_bytes,
    sampler_buffer_packet_count,
    sampler_buffer_read_packets_since,
    sampler_buffer_set_invert_rx,
    send_packet_command_bytes,
    transmit_buffer_bytes,
};

/// Events sent from the script runtime to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum ScriptEvent {
    #[serde(rename = "render")]
    Render { ui: serde_json::Value },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "stopped")]
    Stopped,
}

/// Commands sent to the script runtime from the frontend.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum ScriptCommand {
    #[serde(rename = "callback")]
    Callback { token: String, data: serde_json::Value },
    #[serde(rename = "timer")]
    Timer { id: u64 },
    #[serde(rename = "stop")]
    Stop,
}

/// Shared state accessible from JS native functions.
struct RuntimeState {
    /// Channel to send events to frontend.
    event_tx: mpsc::UnboundedSender<ScriptEvent>,
    /// Channel to send commands back into the runtime (timers, etc.).
    command_tx: mpsc::UnboundedSender<ScriptCommand>,
    /// In-process device bridge for direct USB access.
    device: Arc<BridgeState>,
    /// Tokio runtime handle for async operations.
    rt_handle: tokio::runtime::Handle,

    /// App data directory (desktop) used for scripts that need local storage.
    app_data_dir: PathBuf,

    /// Monotonic timer ids.
    next_timer_id: u64,
    /// Timer registry (setTimeout / setInterval).
    timers: HashMap<u64, TimerEntry>,

    /// Device event subscriptions (event name -> callback token).
    device_event_tokens: Arc<tokio::sync::Mutex<HashMap<String, String>>>,
    /// Device event forwarder task handle.
    device_event_task: Option<tokio::task::JoinHandle<()>>,

    /// Monotonic ids for transmit jobs.
    next_tx_job_id: u64,
    /// Active transmit jobs (id -> join handle).
    tx_jobs: HashMap<u64, tokio::task::JoinHandle<()>>,
}

#[derive(Debug, Clone)]
struct TimerEntry {
    token: String,
    repeat_ms: Option<u64>,
}

/// The script runtime that executes JS scripts with direct hardware access.
pub struct ScriptRuntime {
    event_tx: mpsc::UnboundedSender<ScriptEvent>,
    command_rx: mpsc::UnboundedReceiver<ScriptCommand>,
    command_tx: mpsc::UnboundedSender<ScriptCommand>,
    device: Arc<BridgeState>,
    bootstrap_source: String,
    app_data_dir: PathBuf,
}

impl ScriptRuntime {
    pub fn new(
        device: Arc<BridgeState>,
        bootstrap_source: String,
        app_data_dir: PathBuf,
    ) -> (Self, mpsc::UnboundedSender<ScriptCommand>, mpsc::UnboundedReceiver<ScriptEvent>) {
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        let (command_tx, command_rx) = mpsc::unbounded_channel();

        let runtime = Self {
            event_tx,
            command_rx,
            command_tx: command_tx.clone(),
            device,
            bootstrap_source,
            app_data_dir,
        };

        (runtime, command_tx, event_rx)
    }

    /// Execute a script script. This blocks until the script completes or is stopped.
    pub fn execute(mut self, script: &str) -> Result<(), String> {
        let rt_handle = tokio::runtime::Handle::current();

        // Desktop Script semantics: sync-only (no async/await, no Promise jobs).
        // Keep this check lightweight and explicit.
        if script.contains("await") || script.contains("async ") || script.contains("async\n") || script.contains("async\t") {
            let msg = "Script error: async/await is not supported on desktop (sync-only scripts)".to_string();
            let _ = self.event_tx.send(ScriptEvent::Error { message: msg.clone() });
            return Err(msg);
        }
        
        // Create shared state
        let state = Rc::new(RefCell::new(RuntimeState {
            event_tx: self.event_tx.clone(),
            command_tx: self.command_tx.clone(),
            device: self.device.clone(),
            rt_handle: rt_handle.clone(),

            app_data_dir: self.app_data_dir.clone(),

            next_timer_id: 1,
            timers: HashMap::new(),

            device_event_tokens: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            device_event_task: None,

            next_tx_job_id: 1,
            tx_jobs: HashMap::new(),
        }));

        // Create Boa JS context
        let mut context = Context::default();

        // Register native functions
        Self::register_natives(&mut context, state.clone())?;

        // Setup global callback registry in JS
        let setup_callbacks = r#"
            if (typeof globalThis.__scriptCallbacks === 'undefined') {
                globalThis.__scriptCallbacks = {};
            }
        "#;
        let _ = context.eval(Source::from_bytes(setup_callbacks));

        // Execute bootstrap + script
        let full_script = format!("{}\n{}", self.bootstrap_source, script);
        
        match context.eval(Source::from_bytes(&full_script)) {
            Ok(_) => {}
            Err(e) => {
                let msg = format!("Script execution error: {}", e);
                let _ = self.event_tx.send(ScriptEvent::Error { message: msg.clone() });
                return Err(msg);
            }
        }

        // Event loop: process commands from frontend (keeps context alive for callbacks).
        //
        // NOTE: Desktop script semantics are synchronous (no async/await, no Promises).
        // We intentionally do not drain Boa's job queue here.
        eprintln!("[script_runtime] Entering event loop");
        loop {
            match self.command_rx.try_recv() {
                Ok(ScriptCommand::Stop) => {
                    eprintln!("[script_runtime] Received Stop command");
                    {
                        let mut st = state.borrow_mut();
                        for (_id, handle) in st.tx_jobs.drain() {
                            handle.abort();
                        }
                        st.timers.clear();
                        if let Some(handle) = st.device_event_task.take() {
                            handle.abort();
                        }
                    }
                    let _ = self.event_tx.send(ScriptEvent::Stopped);
                    break;
                }
                Ok(ScriptCommand::Timer { id }) => {
                    let entry = {
                        let st = state.borrow();
                        st.timers.get(&id).cloned()
                    };
                    let Some(entry) = entry else {
                        continue;
                    };

                    let invoke_script = format!(
                        r#"
                        (function() {{
                            var cb = globalThis.__scriptCallbacks['{}'];
                            if (typeof cb === 'function') {{
                                cb();
                            }}
                        }})();
                        "#,
                        entry.token.replace('\'', "\\'"),
                    );

                    if let Err(e) = context.eval(Source::from_bytes(&invoke_script)) {
                        let _ = self.event_tx.send(ScriptEvent::Error {
                            message: format!("Timer callback error: {}", e),
                        });
                    }

                    // Reschedule intervals.
                    if let Some(period_ms) = entry.repeat_ms {
                        let tx = {
                            let st = state.borrow();
                            st.command_tx.clone()
                        };
                        let rt = {
                            let st = state.borrow();
                            st.rt_handle.clone()
                        };
                        rt.spawn(async move {
                            tokio::time::sleep(Duration::from_millis(period_ms)).await;
                            let _ = tx.send(ScriptCommand::Timer { id });
                        });
                    } else {
                        // One-shot: cleanup.
                        let mut st = state.borrow_mut();
                        st.timers.remove(&id);
                    }
                }
                Ok(ScriptCommand::Callback { token, data }) => {
                    eprintln!("[script_runtime] Received Callback: token={}, data={:?}", token, data);
                    // Invoke the registered callback via the global registry
                    // Most script callbacks (like button onTap) take no arguments
                    let data_str = serde_json::to_string(&data).unwrap_or_else(|_| "[]".to_string());
                    let invoke_script = format!(
                        r#"
                        (function() {{
                            var cb = globalThis.__scriptCallbacks['{}'];
                            if (typeof cb === 'function') {{
                                var args = {};
                                if (args === null || typeof args === 'undefined') {{
                                    args = [];
                                }}
                                var argv = Array.isArray(args) ? args : [args];
                                cb.apply(null, argv);
                            }}
                        }})();
                        "#,
                        token.replace('\'', "\\'"),
                        data_str,
                    );
                    
                    eprintln!("[script_runtime] Executing invoke script");
                    if let Err(e) = context.eval(Source::from_bytes(&invoke_script)) {
                        eprintln!("[script_runtime] Invoke script error: {}", e);
                        let _ = self.event_tx.send(ScriptEvent::Error {
                            message: format!("Callback error: {}", e),
                        });
                    }
                }
                Err(mpsc::error::TryRecvError::Empty) => {
                    // No commands, yield briefly
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(mpsc::error::TryRecvError::Disconnected) => {
                    eprintln!("[script_runtime] Channel disconnected, exiting loop");
                    break;
                }
            }
        }

        Ok(())
    }

    fn register_natives(context: &mut Context, state: Rc<RefCell<RuntimeState>>) -> Result<(), String> {
        // _scriptRender
        let state_render = state.clone();
        let render_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let node = args.get_or_undefined(0);
                // Convert JS value to JSON
                let json = js_value_to_json(node, ctx)?;
                let st = state_render.borrow();
                let _ = st.event_tx.send(ScriptEvent::Render { ui: json });
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptRender"), 1, render_fn)
            .map_err(|e| format!("Failed to register _scriptRender: {}", e))?;

        // _scriptRegisterCallback - stores callback in global registry for later invocation
        let register_cb_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let token = args.get_or_undefined(0);
                let callback = args.get_or_undefined(1);
                
                let token_str = token.to_string(ctx)?.to_std_string_escaped();
                eprintln!("[_scriptRegisterCallback] Registering callback: token={}", token_str);
                
                // Store callback in globalThis.__scriptCallbacks[token] = fn
                let global = ctx.global_object();
                let callbacks_obj = global.get(js_string!("__scriptCallbacks"), ctx)?;
                
                if let Some(callbacks) = callbacks_obj.as_object() {
                    let token_key = token.to_string(ctx)?;
                    callbacks.set(token_key, callback.clone(), false, ctx)?;
                    eprintln!("[_scriptRegisterCallback] Stored callback in global registry");
                } else {
                    eprintln!("[_scriptRegisterCallback] ERROR: __scriptCallbacks not found!");
                }
                
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptRegisterCallback"), 2, register_cb_fn)
            .map_err(|e| format!("Failed to register _scriptRegisterCallback: {}", e))?;

        // _scriptSendPacket(bytes: Uint8Array, timeoutMs: number) -> Uint8Array
        let state_send_pkt = state.clone();
        let send_pkt_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let bytes_value = args.get_or_undefined(0);
                let timeout_ms = args
                    .get_or_undefined(1)
                    .to_u32(ctx)
                    .unwrap_or(2000) as u64;

                let array = boa_engine::object::builtins::JsUint8Array::try_from_js(&bytes_value, ctx)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                let bytes = array.iter(ctx).collect::<Vec<u8>>();

                let st = state_send_pkt.borrow();
                let device = st.device.clone();
                let rt = st.rt_handle.clone();

                let result = rt.block_on(async {
                    send_packet_command_bytes(&device, bytes, timeout_ms, 1).await
                });

                match result {
                    Ok(resp) => {
                        let out = boa_engine::object::builtins::JsUint8Array::from_iter(
                            resp.into_iter(),
                            ctx,
                        )
                        .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                        Ok(out.into())
                    }
                    Err(e) => Err(JsNativeError::error()
                        .with_message(format!("Send failed: {}", e))
                        .into()),
                }
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptSendPacket"), 2, send_pkt_fn)
            .map_err(|e| format!("Failed to register _scriptSendPacket: {}", e))?;

        // _scriptSleep - blocking sleep for sampler capture workflows.
        let sleep_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let ms = args
                    .get_or_undefined(0)
                    .to_u32(ctx)
                    .unwrap_or(0) as u64;
                std::thread::sleep(Duration::from_millis(ms));
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptSleep"), 1, sleep_fn)
            .map_err(|e| format!("Failed to register _scriptSleep: {}", e))?;

        // Timers (setTimeout / setInterval) used by scripts like blink() and sampler polling.
        // These must be non-blocking so ScriptCommand::Stop remains responsive.

        let set_timeout_state = state.clone();
        let set_timeout_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let cb = args.get_or_undefined(0);
                if !cb.is_callable() {
                    return Ok(JsValue::from(f64::NAN));
                }

                let ms = args
                    .get_or_undefined(1)
                    .to_u32(ctx)
                    .unwrap_or(0) as u64;

                let (id, token, tx, rt_handle) = {
                    let mut st = set_timeout_state.borrow_mut();
                    let id = st.next_timer_id;
                    st.next_timer_id = st.next_timer_id.saturating_add(1);
                    let token = format!("__timer:{}", id);
                    st.timers.insert(
                        id,
                        TimerEntry {
                            token: token.clone(),
                            repeat_ms: None,
                        },
                    );
                    (id, token, st.command_tx.clone(), st.rt_handle.clone())
                };

                // Store callback in global registry.
                let global = ctx.global_object();
                let callbacks_obj = global.get(js_string!("__scriptCallbacks"), ctx)?;
                if let Some(callbacks) = callbacks_obj.as_object() {
                    callbacks.set(js_string!(token.as_str()), cb.clone(), false, ctx)?;
                }

                rt_handle.spawn(async move {
                    tokio::time::sleep(Duration::from_millis(ms)).await;
                    let _ = tx.send(ScriptCommand::Timer { id });
                });

                Ok(JsValue::from(id as f64))
            })
        };
        context
            .register_global_builtin_callable(js_string!("setTimeout"), 2, set_timeout_fn)
            .map_err(|e| format!("Failed to register setTimeout: {}", e))?;

        let clear_timeout_state = state.clone();
        let clear_timeout_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let id = args
                    .get_or_undefined(0)
                    .to_u32(ctx)
                    .unwrap_or(0) as u64;

                let token = {
                    let mut st = clear_timeout_state.borrow_mut();
                    st.timers.remove(&id).map(|t| t.token)
                };
                if let Some(token) = token {
                    let global = ctx.global_object();
                    let callbacks_obj = global.get(js_string!("__scriptCallbacks"), ctx)?;
                    if let Some(callbacks) = callbacks_obj.as_object() {
                        let _ = callbacks.delete_property_or_throw(js_string!(token.as_str()), ctx);
                    }
                }

                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("clearTimeout"), 1, clear_timeout_fn)
            .map_err(|e| format!("Failed to register clearTimeout: {}", e))?;

        let set_interval_state = state.clone();
        let set_interval_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let cb = args.get_or_undefined(0);
                if !cb.is_callable() {
                    return Ok(JsValue::from(f64::NAN));
                }

                let ms = args
                    .get_or_undefined(1)
                    .to_u32(ctx)
                    .unwrap_or(0) as u64;
                let period_ms = std::cmp::max(1, ms);

                let (id, token, tx, rt_handle) = {
                    let mut st = set_interval_state.borrow_mut();
                    let id = st.next_timer_id;
                    st.next_timer_id = st.next_timer_id.saturating_add(1);
                    let token = format!("__timer:{}", id);
                    st.timers.insert(
                        id,
                        TimerEntry {
                            token: token.clone(),
                            repeat_ms: Some(period_ms),
                        },
                    );
                    (id, token, st.command_tx.clone(), st.rt_handle.clone())
                };

                let global = ctx.global_object();
                let callbacks_obj = global.get(js_string!("__scriptCallbacks"), ctx)?;
                if let Some(callbacks) = callbacks_obj.as_object() {
                    callbacks.set(js_string!(token.as_str()), cb.clone(), false, ctx)?;
                }

                rt_handle.spawn(async move {
                    tokio::time::sleep(Duration::from_millis(period_ms)).await;
                    let _ = tx.send(ScriptCommand::Timer { id });
                });

                Ok(JsValue::from(id as f64))
            })
        };
        context
            .register_global_builtin_callable(js_string!("setInterval"), 2, set_interval_fn)
            .map_err(|e| format!("Failed to register setInterval: {}", e))?;

        let clear_interval_state = state.clone();
        let clear_interval_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let id = args
                    .get_or_undefined(0)
                    .to_u32(ctx)
                    .unwrap_or(0) as u64;

                let token = {
                    let mut st = clear_interval_state.borrow_mut();
                    st.timers.remove(&id).map(|t| t.token)
                };
                if let Some(token) = token {
                    let global = ctx.global_object();
                    let callbacks_obj = global.get(js_string!("__scriptCallbacks"), ctx)?;
                    if let Some(callbacks) = callbacks_obj.as_object() {
                        let _ = callbacks.delete_property_or_throw(js_string!(token.as_str()), ctx);
                    }
                }

                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("clearInterval"), 1, clear_interval_fn)
            .map_err(|e| format!("Failed to register clearInterval: {}", e))?;

        // ---------------------------------------------------------------------
        // Desktop helpers: app data dir + filesystem + buffer helpers
        // ---------------------------------------------------------------------

        // _scriptAppDataDir() -> string
        let state_app_dir = state.clone();
        let app_dir_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, _ctx| {
                let st = state_app_dir.borrow();
                let s = st.app_data_dir.to_string_lossy().replace('\\', "/");
                Ok(JsValue::from(js_string!(s.as_str())))
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptAppDataDir"), 0, app_dir_fn)
            .map_err(|e| format!("Failed to register _scriptAppDataDir: {}", e))?;

        // _scriptPathJoin(parts: string[]) -> string
        let path_join_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let parts_value = args.get_or_undefined(0);
                let parts_obj = parts_value
                    .as_object()
                    .ok_or_else(|| JsNativeError::error().with_message("_scriptPathJoin expects an array"))?;
                let len = parts_obj
                    .get(js_string!("length"), ctx)?
                    .to_u32(ctx)
                    .unwrap_or(0) as usize;
                let mut out = PathBuf::new();
                for i in 0..len {
                    let part = parts_obj.get(i as u32, ctx)?.to_string(ctx)?.to_std_string_escaped();
                    if part.is_empty() {
                        continue;
                    }
                    if out.as_os_str().is_empty() {
                        out = PathBuf::from(part);
                    } else {
                        out = out.join(part);
                    }
                }
                let s = out.to_string_lossy().replace('\\', "/");
                Ok(JsValue::from(js_string!(s.as_str())))
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptPathJoin"), 1, path_join_fn)
            .map_err(|e| format!("Failed to register _scriptPathJoin: {}", e))?;

        // _scriptEnsureDir(path: string)
        let state_ensure_dir = state.clone();
        let ensure_dir_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let raw = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let st = state_ensure_dir.borrow();
                let path = resolve_scoped_path(&st.app_data_dir, &raw)
                    .map_err(|e| JsNativeError::error().with_message(e))?;
                std::fs::create_dir_all(&path)
                    .map_err(|e| JsNativeError::error().with_message(format!("ensureDir failed: {e}")))?;
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptEnsureDir"), 1, ensure_dir_fn)
            .map_err(|e| format!("Failed to register _scriptEnsureDir: {}", e))?;

        // _scriptReadDir(path: string) -> {name,path,kind}[]
        let state_read_dir = state.clone();
        let read_dir_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let raw = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let st = state_read_dir.borrow();
                let path = resolve_scoped_path(&st.app_data_dir, &raw)
                    .map_err(|e| JsNativeError::error().with_message(e))?;
                let mut entries = std::fs::read_dir(&path)
                    .map_err(|e| JsNativeError::error().with_message(format!("readDir failed: {e}")))?
                    .collect::<Result<Vec<_>, std::io::Error>>()
                    .map_err(|e| JsNativeError::error().with_message(format!("readDir failed: {e}")))?;
                entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

                let arr = boa_engine::object::builtins::JsArray::new(ctx);
                for (idx, entry) in entries.into_iter().enumerate() {
                    let p = entry.path();
                    let name = entry
                        .file_name()
                        .into_string()
                        .unwrap_or_else(|_| "".to_string());
                    let kind = if p.is_dir() { "directory" } else { "file" };
                    let path_str = p.to_string_lossy().replace('\\', "/");
                    let obj = boa_engine::object::ObjectInitializer::new(ctx)
                        .property(js_string!("name"), JsValue::from(js_string!(name.as_str())), boa_engine::property::Attribute::all())
                        .property(
                            js_string!("path"),
                            JsValue::from(js_string!(path_str.as_str())),
                            boa_engine::property::Attribute::all(),
                        )
                        .property(js_string!("kind"), JsValue::from(js_string!(kind)), boa_engine::property::Attribute::all())
                        .build();
                    arr.set(idx as u32, obj, true, ctx)?;
                }
                Ok(arr.into())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptReadDir"), 1, read_dir_fn)
            .map_err(|e| format!("Failed to register _scriptReadDir: {}", e))?;

        // _scriptReadFileText(path: string) -> string
        let state_read_text = state.clone();
        let read_text_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let raw = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let st = state_read_text.borrow();
                let path = resolve_scoped_path(&st.app_data_dir, &raw)
                    .map_err(|e| JsNativeError::error().with_message(e))?;
                let text = std::fs::read_to_string(&path)
                    .map_err(|e| JsNativeError::error().with_message(format!("readFileText failed: {e}")))?;
                Ok(JsValue::from(js_string!(text.as_str())))
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptReadFileText"), 1, read_text_fn)
            .map_err(|e| format!("Failed to register _scriptReadFileText: {}", e))?;

        // _scriptWriteFileText(path: string, content: string)
        let state_write_text = state.clone();
        let write_text_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let raw = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let content = args.get_or_undefined(1).to_string(ctx)?.to_std_string_escaped();
                let st = state_write_text.borrow();
                let path = resolve_scoped_path(&st.app_data_dir, &raw)
                    .map_err(|e| JsNativeError::error().with_message(e))?;
                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                std::fs::write(&path, content)
                    .map_err(|e| JsNativeError::error().with_message(format!("writeFileText failed: {e}")))?;
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptWriteFileText"), 2, write_text_fn)
            .map_err(|e| format!("Failed to register _scriptWriteFileText: {}", e))?;

        // _scriptReadFileBytes(path: string) -> Uint8Array
        let state_read_bytes = state.clone();
        let read_bytes_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let raw = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let st = state_read_bytes.borrow();
                let path = resolve_scoped_path(&st.app_data_dir, &raw)
                    .map_err(|e| JsNativeError::error().with_message(e))?;
                let bytes = std::fs::read(&path)
                    .map_err(|e| JsNativeError::error().with_message(format!("readFileBytes failed: {e}")))?;
                let array = boa_engine::object::builtins::JsUint8Array::from_iter(bytes.into_iter(), ctx)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(array.into())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptReadFileBytes"), 1, read_bytes_fn)
            .map_err(|e| format!("Failed to register _scriptReadFileBytes: {}", e))?;

        // _scriptWriteFileBytes(path: string, bytes: Uint8Array)
        let state_write_bytes = state.clone();
        let write_bytes_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let raw = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let bytes_value = args.get_or_undefined(1);
                let array = boa_engine::object::builtins::JsUint8Array::try_from_js(&bytes_value, ctx)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                let bytes = array.iter(ctx).collect::<Vec<u8>>();

                let st = state_write_bytes.borrow();
                let path = resolve_scoped_path(&st.app_data_dir, &raw)
                    .map_err(|e| JsNativeError::error().with_message(e))?;
                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                std::fs::write(&path, bytes)
                    .map_err(|e| JsNativeError::error().with_message(format!("writeFileBytes failed: {e}")))?;
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptWriteFileBytes"), 2, write_bytes_fn)
            .map_err(|e| format!("Failed to register _scriptWriteFileBytes: {}", e))?;

        // _scriptRemovePath(path: string)
        let state_remove_path = state.clone();
        let remove_path_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let raw = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let st = state_remove_path.borrow();
                let path = resolve_scoped_path(&st.app_data_dir, &raw)
                    .map_err(|e| JsNativeError::error().with_message(e))?;
                if path.is_dir() {
                    std::fs::remove_dir_all(&path)
                        .map_err(|e| JsNativeError::error().with_message(format!("removePath failed: {e}")))?;
                } else if path.is_file() {
                    std::fs::remove_file(&path)
                        .map_err(|e| JsNativeError::error().with_message(format!("removePath failed: {e}")))?;
                }
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptRemovePath"), 1, remove_path_fn)
            .map_err(|e| format!("Failed to register _scriptRemovePath: {}", e))?;

        // _scriptRenamePath(from: string, to: string)
        let state_rename_path = state.clone();
        let rename_path_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let from_raw = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let to_raw = args.get_or_undefined(1).to_string(ctx)?.to_std_string_escaped();
                let st = state_rename_path.borrow();
                let from = resolve_scoped_path(&st.app_data_dir, &from_raw)
                    .map_err(|e| JsNativeError::error().with_message(e))?;
                let to = resolve_scoped_path(&st.app_data_dir, &to_raw)
                    .map_err(|e| JsNativeError::error().with_message(e))?;
                if let Some(parent) = to.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                std::fs::rename(&from, &to)
                    .map_err(|e| JsNativeError::error().with_message(format!("renamePath failed: {e}")))?;
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptRenamePath"), 2, rename_path_fn)
            .map_err(|e| format!("Failed to register _scriptRenamePath: {}", e))?;

        // _scriptRevealInFinder(path: string)
        let state_reveal = state.clone();
        let reveal_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let raw = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let st = state_reveal.borrow();
                let path = resolve_scoped_path(&st.app_data_dir, &raw)
                    .map_err(|e| JsNativeError::error().with_message(e))?;
                let path_str = path.to_string_lossy().to_string();

                #[cfg(target_os = "macos")]
                {
                    let _ = Command::new("open").arg("-R").arg(&path_str).output();
                }
                #[cfg(target_os = "windows")]
                {
                    let _ = Command::new("explorer").arg("/select,").arg(&path_str).output();
                }
                #[cfg(target_os = "linux")]
                {
                    let parent = Path::new(&path_str)
                        .parent()
                        .and_then(|p| p.to_str())
                        .unwrap_or(&path_str);
                    let _ = Command::new("xdg-open").arg(parent).output();
                }

                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptRevealInFinder"), 1, reveal_fn)
            .map_err(|e| format!("Failed to register _scriptRevealInFinder: {}", e))?;

        // _scriptBufferSetBytes(bytes: Uint8Array) -> number
        let state_buffer_set = state.clone();
        let buffer_set_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let bytes_value = args.get_or_undefined(0);
                let array = boa_engine::object::builtins::JsUint8Array::try_from_js(&bytes_value, ctx)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                let bytes = array.iter(ctx).collect::<Vec<u8>>();

                let st = state_buffer_set.borrow();
                let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
                let req = BridgeRequest {
                    id: 0,
                    method: "buffer_set_bytes".to_string(),
                    params: serde_json::json!({ "data_b64": b64 }),
                };
                let device = Arc::clone(&st.device);
                let rt = st.rt_handle.clone();
                let result = rt.block_on(async { dispatch_request(device, req).await });
                match result {
                    Ok(v) => {
                        let len = v.get("len_bytes").and_then(|x| x.as_u64()).unwrap_or(0);
                        Ok(JsValue::from(len as f64))
                    }
                    Err(e) => Err(JsNativeError::error().with_message(format!("buffer_set_bytes failed: {e}")).into()),
                }
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptBufferSetBytes"), 1, buffer_set_fn)
            .map_err(|e| format!("Failed to register _scriptBufferSetBytes: {}", e))?;

        // _scriptBufferSaveBytesFile(path: string)
        let state_buffer_save_file = state.clone();
        let buffer_save_file_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let raw = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let st = state_buffer_save_file.borrow();
                let path = resolve_scoped_path(&st.app_data_dir, &raw)
                    .map_err(|e| JsNativeError::error().with_message(e))?;
                let req = BridgeRequest {
                    id: 0,
                    method: "buffer_save_bytes_file".to_string(),
                    params: serde_json::json!({ "path": path.to_string_lossy().to_string() }),
                };
                let device = Arc::clone(&st.device);
                let rt = st.rt_handle.clone();
                let result = rt.block_on(async { dispatch_request(device, req).await });
                match result {
                    Ok(_) => Ok(JsValue::undefined()),
                    Err(e) => Err(JsNativeError::error().with_message(format!("buffer_save_bytes_file failed: {e}")).into()),
                }
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptBufferSaveBytesFile"), 1, buffer_save_file_fn)
            .map_err(|e| format!("Failed to register _scriptBufferSaveBytesFile: {}", e))?;

        // _scriptBufferBuildSignedRawTimings(samplePeriodUs: number) -> string
        let state_build_timings = state.clone();
        let build_timings_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let period = args.get_or_undefined(0).to_u32(ctx).unwrap_or(0) as u64;
                let st = state_build_timings.borrow();
                let params = if period > 0 {
                    serde_json::json!({ "sample_period_us": period })
                } else {
                    serde_json::json!({})
                };
                let req = BridgeRequest {
                    id: 0,
                    method: "buffer_build_signed_raw_timings".to_string(),
                    params,
                };
                let device = Arc::clone(&st.device);
                let rt = st.rt_handle.clone();
                let result = rt.block_on(async { dispatch_request(device, req).await });
                match result {
                    Ok(v) => {
                        let timings = v.get("timings").and_then(|x| x.as_str()).unwrap_or("");
                        Ok(JsValue::from(js_string!(timings)))
                    }
                    Err(e) => Err(JsNativeError::error().with_message(format!("build_timings failed: {e}")).into()),
                }
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptBufferBuildSignedRawTimings"), 1, build_timings_fn)
            .map_err(|e| format!("Failed to register _scriptBufferBuildSignedRawTimings: {}", e))?;

        // _scriptDeviceTransmitBufferStart(bytes: Uint8Array, doneToken?: string) -> number
        let state_tx_start = state.clone();
        let tx_start_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let bytes_value = args.get_or_undefined(0);
                let done_token = args.get_or_undefined(1);
                let done_token = if done_token.is_undefined() || done_token.is_null() {
                    None
                } else {
                    Some(done_token.to_string(ctx)?.to_std_string_escaped())
                };

                let array = boa_engine::object::builtins::JsUint8Array::try_from_js(&bytes_value, ctx)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                let bytes = array.iter(ctx).collect::<Vec<u8>>();

                let (id, tx, device, rt) = {
                    let mut st = state_tx_start.borrow_mut();
                    let id = st.next_tx_job_id;
                    st.next_tx_job_id = st.next_tx_job_id.saturating_add(1);
                    (id, st.command_tx.clone(), Arc::clone(&st.device), st.rt_handle.clone())
                };

                let handle = rt.spawn(async move {
                    let result = transmit_buffer_bytes(&device, bytes).await;
                    if let Err(err) = result {
                        let _ = tx.send(ScriptCommand::Callback {
                            token: "__script_internal_error".to_string(),
                            data: serde_json::json!([format!("Transmit failed: {err:#}")]),
                        });
                    }
                    if let Some(token) = done_token {
                        let _ = tx.send(ScriptCommand::Callback { token, data: serde_json::Value::Null });
                    }
                });

                {
                    let mut st = state_tx_start.borrow_mut();
                    st.tx_jobs.insert(id, handle);
                }

                Ok(JsValue::from(id as f64))
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptDeviceTransmitBufferStart"), 2, tx_start_fn)
            .map_err(|e| format!("Failed to register _scriptDeviceTransmitBufferStart: {}", e))?;

        // _scriptOnDeviceEvent(eventName: string, fn: Function)
        // Subscribes to BridgeState event stream and forwards matching events into the JS callback.
        let state_on_device_event = state.clone();
        let on_device_event_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let name = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let cb = args.get_or_undefined(1);
                if !cb.is_callable() {
                    return Ok(JsValue::undefined());
                }

                let token = format!("__device_event:{}", name);

                // Store callback in global registry.
                let global = ctx.global_object();
                let callbacks_obj = global.get(js_string!("__scriptCallbacks"), ctx)?;
                if let Some(callbacks) = callbacks_obj.as_object() {
                    callbacks.set(js_string!(token.as_str()), cb.clone(), false, ctx)?;
                }

                // Update subscription map.
                let (sub_map, maybe_start, device, cmd_tx, rt) = {
                    let st = state_on_device_event.borrow();
                    let sub_map = Arc::clone(&st.device_event_tokens);
                    let start = st.device_event_task.is_none();
                    let device = Arc::clone(&st.device);
                    let cmd_tx = st.command_tx.clone();
                    let rt = st.rt_handle.clone();
                    (sub_map, start, device, cmd_tx, rt)
                };

                {
                    let sub_map_clone = Arc::clone(&sub_map);
                    rt.block_on(async {
                        let mut guard = sub_map_clone.lock().await;
                        guard.insert(name.clone(), token.clone());
                    });
                }

                if maybe_start {
                    let sub_map_for_task = Arc::clone(&sub_map);
                    let mut events = device.event_tx.subscribe();
                    let handle = rt.spawn(async move {
                        loop {
                            let line = match events.recv().await {
                                Ok(bytes) => bytes,
                                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                            };
                            let trimmed = std::str::from_utf8(&line).unwrap_or("").trim();
                            if trimmed.is_empty() {
                                continue;
                            }
                            let value: serde_json::Value = match serde_json::from_str(trimmed) {
                                Ok(v) => v,
                                Err(_) => continue,
                            };
                            let Some(event_name) = value.get("event").and_then(|v| v.as_str()) else {
                                continue;
                            };
                            let token_opt = {
                                let guard = sub_map_for_task.lock().await;
                                guard.get(event_name).cloned()
                            };
                            let Some(token) = token_opt else {
                                continue;
                            };
                            let payload = value.get("data").cloned().unwrap_or(serde_json::Value::Null);
                            let _ = cmd_tx.send(ScriptCommand::Callback { token, data: payload });
                        }
                    });

                    let st = &mut *state_on_device_event.borrow_mut();
                    st.device_event_task = Some(handle);
                }

                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptOnDeviceEvent"), 2, on_device_event_fn)
            .map_err(|e| format!("Failed to register _scriptOnDeviceEvent: {}", e))?;

        // _scriptSamplerBufferGetPacketCount
        let state_sampler_pkt_count = state.clone();
        let sampler_pkt_count_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, _ctx| {
                let st = state_sampler_pkt_count.borrow();
                let count = sampler_buffer_packet_count(&st.device)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(JsValue::from(count as f64))
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptSamplerBufferGetPacketCount"), 0, sampler_pkt_count_fn)
            .map_err(|e| format!("Failed to register _scriptSamplerBufferGetPacketCount: {}", e))?;

        // _scriptSamplerBufferGetLenBytes
        let state_sampler_len = state.clone();
        let sampler_len_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, _ctx| {
                let st = state_sampler_len.borrow();
                let len = sampler_buffer_len_bytes(&st.device)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(JsValue::from(len as f64))
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptSamplerBufferGetLenBytes"), 0, sampler_len_fn)
            .map_err(|e| format!("Failed to register _scriptSamplerBufferGetLenBytes: {}", e))?;

        // _scriptSamplerBufferGetBytes
        let state_sampler_bytes = state.clone();
        let sampler_get_bytes_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, ctx| {
                let st = state_sampler_bytes.borrow();
                let bytes = sampler_buffer_get_bytes(&st.device)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                let array = boa_engine::object::builtins::JsUint8Array::from_iter(
                    bytes.into_iter(),
                    ctx,
                )
                .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(array.into())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptSamplerBufferGetBytes"), 0, sampler_get_bytes_fn)
            .map_err(|e| format!("Failed to register _scriptSamplerBufferGetBytes: {}", e))?;

        // _scriptSamplerBufferClear
        let state_sampler_clear = state.clone();
        let sampler_clear_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, _ctx| {
                let st = state_sampler_clear.borrow();
                sampler_buffer_clear_only(&st.device)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptSamplerBufferClear"), 0, sampler_clear_fn)
            .map_err(|e| format!("Failed to register _scriptSamplerBufferClear: {}", e))?;

        // _scriptSamplerBufferSetInvertRx
        let state_sampler_invert = state.clone();
        let sampler_invert_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, _ctx| {
                let enabled = args.get_or_undefined(0).to_boolean();
                let st = state_sampler_invert.borrow();
                sampler_buffer_set_invert_rx(&st.device, enabled)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptSamplerBufferSetInvertRx"), 1, sampler_invert_fn)
            .map_err(|e| format!("Failed to register _scriptSamplerBufferSetInvertRx: {}", e))?;

        // _scriptSamplerBufferReadPacketsSince(packetIndex, maxPackets)
        let state_sampler_read = state.clone();
        let sampler_read_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let packet_index = args
                    .get_or_undefined(0)
                    .to_u32(ctx)
                    .unwrap_or(0) as u64;
                let max_packets = args
                    .get_or_undefined(1)
                    .to_u32(ctx)
                    .unwrap_or(256) as usize;

                let st = state_sampler_read.borrow();
                let packets = sampler_buffer_read_packets_since(&st.device, packet_index, max_packets)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;

                let data = boa_engine::object::builtins::JsUint8Array::from_iter(
                    packets.data.into_iter(),
                    ctx,
                )
                .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;

                let obj = boa_engine::object::ObjectInitializer::new(ctx)
                    .property(js_string!("data"), data, boa_engine::property::Attribute::all())
                    .property(
                        js_string!("nextPacketIndex"),
                        JsValue::from(packets.next_packet_index as f64),
                        boa_engine::property::Attribute::all(),
                    )
                    .property(
                        js_string!("availablePackets"),
                        JsValue::from(packets.available_packets as f64),
                        boa_engine::property::Attribute::all(),
                    )
                    .build();

                Ok(obj.into())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptSamplerBufferReadPacketsSince"), 2, sampler_read_fn)
            .map_err(|e| format!("Failed to register _scriptSamplerBufferReadPacketsSince: {}", e))?;

        // _scriptSamplerBufferCompressViewport(startBit, endBit, bins)
        let state_sampler_compress = state.clone();
        let sampler_compress_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let start_bit = args
                    .get_or_undefined(0)
                    .to_u32(ctx)
                    .unwrap_or(0) as usize;
                let end_bit = args
                    .get_or_undefined(1)
                    .to_u32(ctx)
                    .unwrap_or(0) as usize;
                let bins = args
                    .get_or_undefined(2)
                    .to_u32(ctx)
                    .unwrap_or(0) as usize;

                let st = state_sampler_compress.borrow();
                let (buffer_len_bytes, time_values, data_values) =
                    sampler_buffer_compress_viewport(&st.device, start_bit, end_bit, bins)
                        .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;

                let time_values = boa_engine::object::builtins::JsArray::from_iter(
                    time_values.into_iter().map(|v| JsValue::from(v as f64)),
                    ctx,
                );
                let data_values = boa_engine::object::builtins::JsArray::from_iter(
                    data_values.into_iter().map(|v| JsValue::from(v as f64)),
                    ctx,
                );

                let obj = boa_engine::object::ObjectInitializer::new(ctx)
                    .property(
                        js_string!("bufferLenBytes"),
                        JsValue::from(buffer_len_bytes as f64),
                        boa_engine::property::Attribute::all(),
                    )
                    .property(js_string!("timeValues"), time_values, boa_engine::property::Attribute::all())
                    .property(js_string!("dataValues"), data_values, boa_engine::property::Attribute::all())
                    .build();

                Ok(obj.into())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptSamplerBufferCompressViewport"), 3, sampler_compress_fn)
            .map_err(|e| format!("Failed to register _scriptSamplerBufferCompressViewport: {}", e))?;

        Ok(())
    }
}

/// Convert a Boa JsValue to serde_json::Value
fn js_value_to_json(value: &JsValue, ctx: &mut Context) -> JsResult<serde_json::Value> {
    match value {
        JsValue::Undefined | JsValue::Null => Ok(serde_json::Value::Null),
        JsValue::Boolean(b) => Ok(serde_json::Value::Bool(*b)),
        JsValue::Integer(n) => Ok(serde_json::Value::Number((*n).into())),
        JsValue::Rational(n) => {
            if let Some(num) = serde_json::Number::from_f64(*n) {
                Ok(serde_json::Value::Number(num))
            } else {
                Ok(serde_json::Value::Null)
            }
        }
        JsValue::String(s) => Ok(serde_json::Value::String(s.to_std_string_escaped())),
        JsValue::Object(obj) => {
            // Check if it's an array
            if obj.is_array() {
                let len = obj
                    .get(js_string!("length"), ctx)?
                    .to_u32(ctx)
                    .unwrap_or(0);
                let mut arr = Vec::with_capacity(len as usize);
                for i in 0..len {
                    let item = obj.get(i, ctx)?;
                    arr.push(js_value_to_json(&item, ctx)?);
                }
                Ok(serde_json::Value::Array(arr))
            } else {
                // It's an object
                let keys = obj.own_property_keys(ctx)?;
                let mut map = serde_json::Map::new();
                for key in keys {
                    let key_str = match &key {
                        boa_engine::property::PropertyKey::String(s) => s.to_std_string_escaped(),
                        boa_engine::property::PropertyKey::Symbol(s) => format!("Symbol({})", s.description().map(|d| d.to_std_string_escaped()).unwrap_or_default()),
                        boa_engine::property::PropertyKey::Index(i) => i.get().to_string(),
                    };
                    let val = obj.get(key, ctx)?;
                    map.insert(key_str, js_value_to_json(&val, ctx)?);
                }
                Ok(serde_json::Value::Object(map))
            }
        }
        _ => Ok(serde_json::Value::Null),
    }
}

fn resolve_scoped_path(root: &Path, input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Empty path".to_string());
    }

    let candidate = {
        let p = PathBuf::from(trimmed);
        if p.is_absolute() {
            p
        } else {
            root.join(p)
        }
    };

    // Normalize `.` and `..` without touching the filesystem.
    let mut normalized = PathBuf::new();
    for comp in candidate.components() {
        use std::path::Component;
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(comp.as_os_str()),
        }
    }

    if !normalized.starts_with(root) {
        return Err("Path escapes app data dir".to_string());
    }
    Ok(normalized)
}
