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
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use boa_engine::{
    js_string, native_function::NativeFunction, Context, JsArgs, JsNativeError,
    JsResult, JsValue, Source,
};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use emwaver_device_core::bridge::{
    BridgeState,
    sampler_buffer_clear_only,
    sampler_buffer_compress_viewport,
    sampler_buffer_get_bytes,
    sampler_buffer_len_bytes,
    sampler_buffer_packet_count,
    sampler_buffer_read_packets_since,
    sampler_buffer_set_invert_rx,
    send_packet_command_bytes,
};

/// Events sent from the script runtime to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum ScriptEvent {
    #[serde(rename = "render")]
    Render { ui: serde_json::Value },
    #[serde(rename = "print")]
    Print { message: String },
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
    #[serde(rename = "stop")]
    Stop,
}

/// Shared state accessible from JS native functions.
struct RuntimeState {
    /// Channel to send events to frontend.
    event_tx: mpsc::UnboundedSender<ScriptEvent>,
    /// In-process device bridge for direct USB access.
    device: Arc<BridgeState>,
    /// Registered callback functions (token -> JS function source).
    callbacks: HashMap<String, String>,
    /// Tokio runtime handle for async operations.
    rt_handle: tokio::runtime::Handle,
}

/// The script runtime that executes JS scripts with direct hardware access.
pub struct ScriptRuntime {
    event_tx: mpsc::UnboundedSender<ScriptEvent>,
    command_rx: mpsc::UnboundedReceiver<ScriptCommand>,
    device: Arc<BridgeState>,
    bootstrap_source: String,
}

impl ScriptRuntime {
    pub fn new(
        device: Arc<BridgeState>,
        bootstrap_source: String,
    ) -> (Self, mpsc::UnboundedSender<ScriptCommand>, mpsc::UnboundedReceiver<ScriptEvent>) {
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        let (command_tx, command_rx) = mpsc::unbounded_channel();

        let runtime = Self {
            event_tx,
            command_rx,
            device,
            bootstrap_source,
        };

        (runtime, command_tx, event_rx)
    }

    /// Execute a script script. This blocks until the script completes or is stopped.
    pub fn execute(mut self, script: &str) -> Result<(), String> {
        let rt_handle = tokio::runtime::Handle::current();
        
        // Create shared state
        let state = Rc::new(RefCell::new(RuntimeState {
            event_tx: self.event_tx.clone(),
            device: self.device.clone(),
            callbacks: HashMap::new(),
            rt_handle: rt_handle.clone(),
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

        // Event loop: process commands from frontend (keeps context alive for callbacks)
        eprintln!("[script_runtime] Entering event loop");
        loop {
            match self.command_rx.try_recv() {
                Ok(ScriptCommand::Stop) => {
                    eprintln!("[script_runtime] Received Stop command");
                    let _ = self.event_tx.send(ScriptEvent::Stopped);
                    break;
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
                                try {{
                                    var args = {};
                                    if (args === null || typeof args === 'undefined') {{
                                        args = [];
                                    }}
                                    var argv = Array.isArray(args) ? args : [args];
                                    cb.apply(null, argv);
                                }} catch (e) {{
                                    try {{ print('[callback] error: ' + e); }} catch (_) {{}}
                                }}
                            }}
                        }})();
                        "#,
                        token.replace('\'', "\\'"),
                        data_str,
                    );
                    
                    eprintln!("[script_runtime] Executing invoke script");
                    if let Err(e) = context.eval(Source::from_bytes(&invoke_script)) {
                        eprintln!("[script_runtime] Invoke script error: {}", e);
                        let _ = self.event_tx.send(ScriptEvent::Print {
                            message: format!("Callback error: {}", e),
                        });
                    }
                    // Run Boa's job queue to process Promises from async functions.
                    // We run it multiple times to drain the queue as each await
                    // in an async function chain creates new microtasks.
                    eprintln!("[script_runtime] Running job queue (100 iterations)...");
                    for i in 0..100 {
                        context.run_jobs();
                        if i < 5 {
                            eprintln!("[script_runtime] run_jobs iteration {}", i);
                        }
                    }
                    eprintln!("[script_runtime] Callback processing done");
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
        // _scriptPrint
        let state_print = state.clone();
        // SAFETY: Closure captures Rc<RefCell> which is safe as long as we don't
        // escape references across the Boa GC boundary. We only borrow temporarily.
        let print_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let msg = args.get_or_undefined(0).to_string(ctx)?;
                let st = state_print.borrow();
                let _ = st.event_tx.send(ScriptEvent::Print {
                    message: msg.to_std_string_escaped(),
                });
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptPrint"), 1, print_fn)
            .map_err(|e| format!("Failed to register _scriptPrint: {}", e))?;

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

        // _scriptSendCommandString - THE HOT PATH - direct USB access!
        let state_send = state.clone();
        let send_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let command = args.get_or_undefined(0).to_string(ctx)?;
                let timeout_ms = args
                    .get_or_undefined(1)
                    .to_u32(ctx)
                    .unwrap_or(2000) as u64;

                let cmd_str = command.to_std_string_escaped();
                eprintln!("[_scriptSendCommandString] CALLED: cmd={}, timeout={}ms", cmd_str.trim(), timeout_ms);
                let st = state_send.borrow();
                let device = st.device.clone();
                let rt = st.rt_handle.clone();

                // Execute synchronously using the tokio runtime
                let result = rt.block_on(async {
                    send_packet_command_bytes(&device, cmd_str.as_bytes().to_vec(), timeout_ms, 1)
                        .await
                });

                match result {
                    Ok(bytes) => {

                        // Return as Uint8Array
                        let array = boa_engine::object::builtins::JsUint8Array::from_iter(
                            bytes.into_iter(),
                            ctx,
                        )
                        .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                        Ok(array.into())
                    }
                    Err(e) => Err(JsNativeError::error()
                        .with_message(format!("Send failed: {}", e))
                        .into()),
                }
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptSendCommandString"), 2, send_fn)
            .map_err(|e| format!("Failed to register _scriptSendCommandString: {}", e))?;

        // _scriptShowDialog (stub)
        let dialog_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, _ctx| {
                // TODO: Implement dialog
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptShowDialog"), 2, dialog_fn)
            .map_err(|e| format!("Failed to register _scriptShowDialog: {}", e))?;

        // _scriptImportModule (stub)
        let import_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, _ctx| {
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptImportModule"), 1, import_fn)
            .map_err(|e| format!("Failed to register _scriptImportModule: {}", e))?;

        // _scriptCreateByteArray
        let create_bytes_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let arr = args.get_or_undefined(0);
                if let Some(obj) = arr.as_object() {
                    let len = obj
                        .get(js_string!("length"), ctx)?
                        .to_u32(ctx)
                        .unwrap_or(0);
                    let mut bytes = Vec::with_capacity(len as usize);
                    for i in 0..len {
                        let val = obj.get(i, ctx)?;
                        bytes.push(val.to_u32(ctx).unwrap_or(0) as u8);
                    }
                    let array = boa_engine::object::builtins::JsUint8Array::from_iter(
                        bytes.into_iter(),
                        ctx,
                    )
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                    return Ok(array.into());
                }
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_scriptCreateByteArray"), 1, create_bytes_fn)
            .map_err(|e| format!("Failed to register _scriptCreateByteArray: {}", e))?;

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
