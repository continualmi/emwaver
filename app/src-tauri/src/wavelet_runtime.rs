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

//! Embedded JavaScript runtime for wavelets.
//!
//! This module runs wavelet scripts directly in Rust using Boa JS engine,
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

use emwaver_device_core::bridge::{BridgeState, send_packet_command_bytes};

/// Events sent from the wavelet runtime to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum WaveletEvent {
    #[serde(rename = "render")]
    Render { ui: serde_json::Value },
    #[serde(rename = "print")]
    Print { message: String },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "stopped")]
    Stopped,
}

/// Commands sent to the wavelet runtime from the frontend.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum WaveletCommand {
    #[serde(rename = "callback")]
    Callback { token: String, data: serde_json::Value },
    #[serde(rename = "stop")]
    Stop,
}

/// Shared state accessible from JS native functions.
struct RuntimeState {
    /// Channel to send events to frontend.
    event_tx: mpsc::UnboundedSender<WaveletEvent>,
    /// In-process device bridge for direct USB access.
    device: Arc<BridgeState>,
    /// Registered callback functions (token -> JS function source).
    callbacks: HashMap<String, String>,
    /// Tokio runtime handle for async operations.
    rt_handle: tokio::runtime::Handle,
}

/// The wavelet runtime that executes JS scripts with direct hardware access.
pub struct WaveletRuntime {
    event_tx: mpsc::UnboundedSender<WaveletEvent>,
    command_rx: mpsc::UnboundedReceiver<WaveletCommand>,
    device: Arc<BridgeState>,
    bootstrap_source: String,
}

impl WaveletRuntime {
    pub fn new(
        device: Arc<BridgeState>,
        bootstrap_source: String,
    ) -> (Self, mpsc::UnboundedSender<WaveletCommand>, mpsc::UnboundedReceiver<WaveletEvent>) {
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

    /// Execute a wavelet script. This blocks until the script completes or is stopped.
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
            if (typeof globalThis.__waveletCallbacks === 'undefined') {
                globalThis.__waveletCallbacks = {};
            }
        "#;
        let _ = context.eval(Source::from_bytes(setup_callbacks));

        // Execute bootstrap + script
        let full_script = format!("{}\n{}", self.bootstrap_source, script);
        
        match context.eval(Source::from_bytes(&full_script)) {
            Ok(_) => {}
            Err(e) => {
                let msg = format!("Wavelet execution error: {}", e);
                let _ = self.event_tx.send(WaveletEvent::Error { message: msg.clone() });
                return Err(msg);
            }
        }

        // Event loop: process commands from frontend (keeps context alive for callbacks)
        eprintln!("[wavelet_runtime] Entering event loop");
        loop {
            match self.command_rx.try_recv() {
                Ok(WaveletCommand::Stop) => {
                    eprintln!("[wavelet_runtime] Received Stop command");
                    let _ = self.event_tx.send(WaveletEvent::Stopped);
                    break;
                }
                Ok(WaveletCommand::Callback { token, data }) => {
                    eprintln!("[wavelet_runtime] Received Callback: token={}, data={:?}", token, data);
                    // Invoke the registered callback via the global registry
                    // Most wavelet callbacks (like button onTap) take no arguments
                    let data_str = serde_json::to_string(&data).unwrap_or_else(|_| "[]".to_string());
                    let invoke_script = format!(
                        r#"
                        (function() {{
                            var cb = globalThis.__waveletCallbacks['{}'];
                            print('[callback] Looking for token: {}');
                            print('[callback] Callback type: ' + typeof cb);
                            if (typeof cb === 'function') {{
                                try {{
                                    var args = {};
                                    print('[callback] Invoking callback...');
                                    var result = cb.apply(null, Array.isArray(args) && args.length === 0 ? [] : [args]);
                                    print('[callback] Callback returned: ' + typeof result);
                                    if (result && typeof result.then === 'function') {{
                                        print('[callback] Result is a Promise, attaching handlers');
                                        result.then(function(v) {{
                                            print('[callback] Promise RESOLVED: ' + v);
                                        }}).catch(function(e) {{
                                            print('[callback] Promise REJECTED: ' + e);
                                        }});
                                    }}
                                }} catch (e) {{
                                    print('[callback] Sync error: ' + e);
                                }}
                            }} else {{
                                print('[callback] Callback not found: {}');
                            }}
                        }})();
                        "#,
                        token.replace('\'', "\\'"),
                        token.replace('\'', "\\'"),
                        data_str,
                        token.replace('\'', "\\'")
                    );
                    
                    eprintln!("[wavelet_runtime] Executing invoke script");
                    if let Err(e) = context.eval(Source::from_bytes(&invoke_script)) {
                        eprintln!("[wavelet_runtime] Invoke script error: {}", e);
                        let _ = self.event_tx.send(WaveletEvent::Print {
                            message: format!("Callback error: {}", e),
                        });
                    }
                    // Run Boa's job queue to process Promises from async functions.
                    // We run it multiple times to drain the queue as each await
                    // in an async function chain creates new microtasks.
                    eprintln!("[wavelet_runtime] Running job queue (100 iterations)...");
                    for i in 0..100 {
                        context.run_jobs();
                        if i < 5 {
                            eprintln!("[wavelet_runtime] run_jobs iteration {}", i);
                        }
                    }
                    eprintln!("[wavelet_runtime] Callback processing done");
                }
                Err(mpsc::error::TryRecvError::Empty) => {
                    // No commands, yield briefly
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(mpsc::error::TryRecvError::Disconnected) => {
                    eprintln!("[wavelet_runtime] Channel disconnected, exiting loop");
                    break;
                }
            }
        }

        Ok(())
    }

    fn register_natives(context: &mut Context, state: Rc<RefCell<RuntimeState>>) -> Result<(), String> {
        // _waveletPrint
        let state_print = state.clone();
        // SAFETY: Closure captures Rc<RefCell> which is safe as long as we don't
        // escape references across the Boa GC boundary. We only borrow temporarily.
        let print_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let msg = args.get_or_undefined(0).to_string(ctx)?;
                let st = state_print.borrow();
                let _ = st.event_tx.send(WaveletEvent::Print {
                    message: msg.to_std_string_escaped(),
                });
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_waveletPrint"), 1, print_fn)
            .map_err(|e| format!("Failed to register _waveletPrint: {}", e))?;

        // _waveletRender
        let state_render = state.clone();
        let render_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let node = args.get_or_undefined(0);
                // Convert JS value to JSON
                let json = js_value_to_json(node, ctx)?;
                let st = state_render.borrow();
                let _ = st.event_tx.send(WaveletEvent::Render { ui: json });
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_waveletRender"), 1, render_fn)
            .map_err(|e| format!("Failed to register _waveletRender: {}", e))?;

        // _waveletRegisterCallback - stores callback in global registry for later invocation
        let register_cb_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let token = args.get_or_undefined(0);
                let callback = args.get_or_undefined(1);
                
                let token_str = token.to_string(ctx)?.to_std_string_escaped();
                eprintln!("[_waveletRegisterCallback] Registering callback: token={}", token_str);
                
                // Store callback in globalThis.__waveletCallbacks[token] = fn
                let global = ctx.global_object();
                let callbacks_obj = global.get(js_string!("__waveletCallbacks"), ctx)?;
                
                if let Some(callbacks) = callbacks_obj.as_object() {
                    let token_key = token.to_string(ctx)?;
                    callbacks.set(token_key, callback.clone(), false, ctx)?;
                    eprintln!("[_waveletRegisterCallback] Stored callback in global registry");
                } else {
                    eprintln!("[_waveletRegisterCallback] ERROR: __waveletCallbacks not found!");
                }
                
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_waveletRegisterCallback"), 2, register_cb_fn)
            .map_err(|e| format!("Failed to register _waveletRegisterCallback: {}", e))?;

        // _waveletSendCommandString - THE HOT PATH - direct USB access!
        let state_send = state.clone();
        let send_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let command = args.get_or_undefined(0).to_string(ctx)?;
                let timeout_ms = args
                    .get_or_undefined(1)
                    .to_u32(ctx)
                    .unwrap_or(2000) as u64;

                let cmd_str = command.to_std_string_escaped();
                eprintln!("[_waveletSendCommandString] CALLED: cmd={}, timeout={}ms", cmd_str.trim(), timeout_ms);
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
            .register_global_builtin_callable(js_string!("_waveletSendCommandString"), 2, send_fn)
            .map_err(|e| format!("Failed to register _waveletSendCommandString: {}", e))?;

        // _waveletShowDialog (stub)
        let dialog_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, _ctx| {
                // TODO: Implement dialog
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_waveletShowDialog"), 2, dialog_fn)
            .map_err(|e| format!("Failed to register _waveletShowDialog: {}", e))?;

        // _waveletImportModule (stub)
        let import_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, _ctx| {
                Ok(JsValue::undefined())
            })
        };
        context
            .register_global_builtin_callable(js_string!("_waveletImportModule"), 1, import_fn)
            .map_err(|e| format!("Failed to register _waveletImportModule: {}", e))?;

        // _waveletCreateByteArray
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
            .register_global_builtin_callable(js_string!("_waveletCreateByteArray"), 1, create_bytes_fn)
            .map_err(|e| format!("Failed to register _waveletCreateByteArray: {}", e))?;

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
