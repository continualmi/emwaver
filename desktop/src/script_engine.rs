use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use boa_engine::{
    js_string,
    native_function::NativeFunction,
    value::TryFromJs,
    Context,
    JsArgs,
    JsString,
    JsNativeError,
    JsResult,
    JsValue,
    Source,
};
use boa_engine::object::{builtins::JsArray, ObjectInitializer};
use base64::Engine as _;
use serde_json::json;
use tokio::sync::mpsc;

use emwaver_device_core::bridge::{
    dispatch_request, sampler_buffer_clear_only, sampler_buffer_compress_viewport,
    sampler_buffer_get_bytes, sampler_buffer_len_bytes, sampler_buffer_packet_count,
    sampler_buffer_read_packets_since, sampler_buffer_set_invert_rx, send_packet_command_bytes,
    transmit_buffer_bytes, BridgeRequest, BridgeState,
};

#[derive(Debug, Clone)]
pub struct ScriptOption {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone)]
pub enum ScriptEvent {
    Render { tree: ScriptNode },
    Error { message: String },
    Stopped,
}

#[derive(Debug, Clone)]
pub enum ScriptCommand {
    Stop,
    Timer { id: u64 },
    Callback { token: String, arg: Option<ScriptCallbackArg> },
    DeviceEvent { event: String, data_json: String },
}

#[derive(Debug, Clone)]
pub enum ScriptCallbackArg {
    Str(String),
    Num(f64),
    Bool(bool),
    Json(String),
}

#[derive(Debug, Clone)]
pub struct ScriptNode {
    pub node_type: String,
    pub id: String,
    pub text: Option<String>,
    pub label: Option<String>,
    pub progress_pct: Option<f32>,

    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub disabled: Option<bool>,
    pub open: Option<bool>,

    pub plot_points: Option<u32>,
    pub plot_height: Option<f32>,
    pub overlay_text: Option<String>,
    pub error_text: Option<String>,

    pub value_num: Option<f64>,
    pub value_str: Option<String>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub selected: Option<String>,
    pub options: Vec<ScriptOption>,
    pub placeholder: Option<String>,
    pub checked: Option<bool>,

    pub handlers: HashMap<String, String>,
    pub children: Vec<ScriptNode>,
}

#[derive(Debug)]
struct TimerEntry {
    token: String,
    repeat_ms: Option<u64>,
    handle: tokio::task::JoinHandle<()>,
}

struct RuntimeState {
    event_tx: mpsc::UnboundedSender<ScriptEvent>,
    command_tx: mpsc::UnboundedSender<ScriptCommand>,
    device: Arc<BridgeState>,
    rt_handle: tokio::runtime::Handle,

    device_event_task: Option<tokio::task::JoinHandle<()>>,
    device_event_tokens: HashMap<String, Vec<String>>,
    next_callback_id: u64,

    next_timer_id: u64,
    timers: HashMap<u64, TimerEntry>,
}

pub struct ScriptRuntime {
    event_tx: mpsc::UnboundedSender<ScriptEvent>,
    command_rx: mpsc::UnboundedReceiver<ScriptCommand>,
    command_tx: mpsc::UnboundedSender<ScriptCommand>,

    device: Arc<BridgeState>,
    rt_handle: tokio::runtime::Handle,
    bootstrap_source: String,
}

impl ScriptRuntime {
    pub fn new(
        device: Arc<BridgeState>,
        rt_handle: tokio::runtime::Handle,
        bootstrap_source: String,
    ) -> (
        Self,
        mpsc::UnboundedSender<ScriptCommand>,
        mpsc::UnboundedReceiver<ScriptEvent>,
    ) {
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        let (command_tx, command_rx) = mpsc::unbounded_channel();
        let runtime = Self {
            event_tx,
            command_rx,
            command_tx: command_tx.clone(),
            device,
            rt_handle,
            bootstrap_source,
        };
        (runtime, command_tx, event_rx)
    }

    pub fn execute(mut self, script: &str) -> Result<(), String> {
        // Desktop script semantics: sync-only.
        if script.contains("await") || script.contains("async ") || script.contains("async\n") {
            let msg = "Script error: async/await is not supported (sync-only scripts)".to_string();
            let _ = self.event_tx.send(ScriptEvent::Error { message: msg.clone() });
            return Err(msg);
        }

        let state = Rc::new(RefCell::new(RuntimeState {
            event_tx: self.event_tx.clone(),
            command_tx: self.command_tx.clone(),
            device: self.device.clone(),
            rt_handle: self.rt_handle.clone(),

            device_event_task: None,
            device_event_tokens: HashMap::new(),
            next_callback_id: 1,

            next_timer_id: 1,
            timers: HashMap::new(),
        }));

        let mut ctx = Context::default();
        Self::register_natives(&mut ctx, state.clone())?;

        // Ensure callback registry exists.
        let _ = ctx.eval(Source::from_bytes(
            "if (typeof globalThis.__scriptCallbacks === 'undefined') { globalThis.__scriptCallbacks = {}; }",
        ));

        let full_script = format!("{}\n{}", self.bootstrap_source, script);
        if let Err(e) = ctx.eval(Source::from_bytes(&full_script)) {
            let msg = format!("Script execution error: {e}");
            let _ = self.event_tx.send(ScriptEvent::Error { message: msg.clone() });
            return Err(msg);
        }

        // Command loop.
        loop {
            match self.command_rx.try_recv() {
                Ok(ScriptCommand::Stop) => {
                    {
                        let mut st = state.borrow_mut();
                        for (_id, entry) in st.timers.drain() {
                            entry.handle.abort();
                        }

                        if let Some(task) = st.device_event_task.take() {
                            task.abort();
                        }
                        st.device_event_tokens.clear();
                    }
                    let _ = self.event_tx.send(ScriptEvent::Stopped);
                    break;
                }
                Ok(ScriptCommand::Timer { id }) => {
                    let entry = {
                        let st = state.borrow();
                        st.timers.get(&id).map(|t| (t.token.clone(), t.repeat_ms))
                    };
                    let Some((token, repeat_ms)) = entry else {
                        continue;
                    };

                    let invoke = format!(
                        "(function() {{ var cb = globalThis.__scriptCallbacks['{}']; if (typeof cb === 'function') {{ cb(); }} }})();",
                        token.replace('\\', "\\\\").replace('\'', "\\'")
                    );
                    if let Err(e) = ctx.eval(Source::from_bytes(&invoke)) {
                        let _ = self.event_tx.send(ScriptEvent::Error {
                            message: format!("Timer callback error: {e}"),
                        });
                    }

                    if let Some(period_ms) = repeat_ms {
                        // Reschedule interval.
                        let (tx, rt) = {
                            let st = state.borrow();
                            (st.command_tx.clone(), st.rt_handle.clone())
                        };
                        rt.spawn(async move {
                            tokio::time::sleep(Duration::from_millis(period_ms)).await;
                            let _ = tx.send(ScriptCommand::Timer { id });
                        });
                    } else {
                        // One-shot cleanup.
                        let mut st = state.borrow_mut();
                        if let Some(entry) = st.timers.remove(&id) {
                            entry.handle.abort();
                        }
                        let cleanup = format!(
                            "try {{ delete globalThis.__scriptCallbacks['{}']; }} catch (e) {{}}",
                            token.replace('\\', "\\\\").replace('\'', "\\'")
                        );
                        let _ = ctx.eval(Source::from_bytes(&cleanup));
                    }
                }
                Ok(ScriptCommand::Callback { token, arg }) => {
                    let token_escaped = token.replace('\\', "\\\\").replace('\'', "\\'");
                    let invoke = match arg {
                        None => format!(
                            "(function() {{ var cb = globalThis.__scriptCallbacks['{}']; if (typeof cb === 'function') {{ cb(); }} }})();",
                            token_escaped
                        ),
                        Some(ScriptCallbackArg::Str(s)) => {
                            let arg_escaped = escape_js_string(&s);
                            format!(
                                "(function() {{ var cb = globalThis.__scriptCallbacks['{}']; if (typeof cb === 'function') {{ cb('{}'); }} }})();",
                                token_escaped, arg_escaped
                            )
                        }
                        Some(ScriptCallbackArg::Num(n)) => {
                            let num = if n.is_finite() { n } else { 0.0 };
                            format!(
                                "(function() {{ var cb = globalThis.__scriptCallbacks['{}']; if (typeof cb === 'function') {{ cb({}); }} }})();",
                                token_escaped, num
                            )
                        }
                        Some(ScriptCallbackArg::Bool(b)) => {
                            format!(
                                "(function() {{ var cb = globalThis.__scriptCallbacks['{}']; if (typeof cb === 'function') {{ cb({}); }} }})();",
                                token_escaped,
                                if b { "true" } else { "false" }
                            )
                        }
                        Some(ScriptCallbackArg::Json(json)) => {
                            let arg_escaped = escape_js_string(&json);
                            format!(
                                "(function() {{ var cb = globalThis.__scriptCallbacks['{}']; if (typeof cb === 'function') {{ try {{ cb(JSON.parse('{}')); }} catch (e) {{ cb(null); }} }} }})();",
                                token_escaped, arg_escaped
                            )
                        }
                    };
                    if let Err(e) = ctx.eval(Source::from_bytes(&invoke)) {
                        let _ = self.event_tx.send(ScriptEvent::Error {
                            message: format!("Callback error: {e}"),
                        });
                    }
                }
                Ok(ScriptCommand::DeviceEvent { event, data_json }) => {
                    let tokens = {
                        let st = state.borrow();
                        st.device_event_tokens
                            .get(&event)
                            .cloned()
                            .unwrap_or_default()
                    };
                    if tokens.is_empty() {
                        continue;
                    }
                    for token in tokens {
                        let token_escaped = token.replace('\\', "\\\\").replace('\'', "\\'");
                        let arg_escaped = escape_js_string(&data_json);
                        let invoke = format!(
                            "(function() {{ var cb = globalThis.__scriptCallbacks['{}']; if (typeof cb === 'function') {{ try {{ cb(JSON.parse('{}')); }} catch (e) {{ cb(null); }} }} }})();",
                            token_escaped, arg_escaped
                        );
                        if let Err(e) = ctx.eval(Source::from_bytes(&invoke)) {
                            let _ = self.event_tx.send(ScriptEvent::Error {
                                message: format!("Device event callback error: {e}"),
                            });
                        }
                    }
                }
                Err(mpsc::error::TryRecvError::Empty) => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(mpsc::error::TryRecvError::Disconnected) => break,
            }
        }

        Ok(())
    }

    fn register_natives(ctx: &mut Context, state: Rc<RefCell<RuntimeState>>) -> Result<(), String> {
        // _scriptRender(node)
        let state_render = state.clone();
        let render_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let node = args.get_or_undefined(0);
                let tree = parse_script_node(&node, ctx)?;
                let st = state_render.borrow();
                let _ = st.event_tx.send(ScriptEvent::Render { tree });
                Ok(JsValue::undefined())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptRender"), 1, render_fn)
            .map_err(|e| format!("Failed to register _scriptRender: {e}"))?;

        // _scriptRegisterCallback(token, fn)
        let register_cb_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let token = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let callback = args.get_or_undefined(1);
                if token.is_empty() || !callback.is_callable() {
                    return Ok(JsValue::undefined());
                }

                let global = ctx.global_object();
                let callbacks_obj = global.get(js_string!("__scriptCallbacks"), ctx)?;
                if callbacks_obj.is_undefined() {
                    let _ = ctx.eval(Source::from_bytes(
                        "globalThis.__scriptCallbacks = {};",
                    ));
                }
                let callbacks_obj = global.get(js_string!("__scriptCallbacks"), ctx)?;
                if let Some(callbacks) = callbacks_obj.as_object() {
                    callbacks.set(js_string!(token.as_str()), callback.clone(), false, ctx)?;
                }
                Ok(JsValue::undefined())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptRegisterCallback"), 2, register_cb_fn)
            .map_err(|e| format!("Failed to register _scriptRegisterCallback: {e}"))?;

        // _scriptSendPacket(bytes: Uint8Array, timeoutMs: number) -> Uint8Array
        let state_send = state.clone();
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

                let st = state_send.borrow();
                let device = st.device.clone();
                let rt = st.rt_handle.clone();

                let result = rt.block_on(async {
                    send_packet_command_bytes(&device, bytes, timeout_ms, 1).await
                });

                match result {
                    Ok(resp) => {
                        let out = boa_engine::object::builtins::JsUint8Array::from_iter(resp.into_iter(), ctx)
                            .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                        Ok(out.into())
                    }
                    Err(e) => Err(JsNativeError::error()
                        .with_message(format!("Send failed: {e}"))
                        .into()),
                }
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptSendPacket"), 2, send_pkt_fn)
            .map_err(|e| format!("Failed to register _scriptSendPacket: {e}"))?;

        // _scriptSleep(ms) (blocking)
        let sleep_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let ms = args.get_or_undefined(0).to_u32(ctx).unwrap_or(0) as u64;
                std::thread::sleep(Duration::from_millis(ms));
                Ok(JsValue::undefined())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptSleep"), 1, sleep_fn)
            .map_err(|e| format!("Failed to register _scriptSleep: {e}"))?;

        // Timers (setTimeout/clearTimeout + setInterval/clearInterval)
        let set_timeout_state = state.clone();
        let set_timeout_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let cb = args.get_or_undefined(0);
                if !cb.is_callable() {
                    return Ok(JsValue::from(f64::NAN));
                }
                let ms = args.get_or_undefined(1).to_u32(ctx).unwrap_or(0) as u64;

                let (id, token, tx, rt, join) = {
                    let mut st = set_timeout_state.borrow_mut();
                    let id = st.next_timer_id;
                    st.next_timer_id = st.next_timer_id.saturating_add(1);
                    let token = format!("__timer:{id}");
                    let tx = st.command_tx.clone();
                    let rt = st.rt_handle.clone();
                    let join = rt.spawn({
                        let tx2 = tx.clone();
                        async move {
                            tokio::time::sleep(Duration::from_millis(ms)).await;
                            let _ = tx2.send(ScriptCommand::Timer { id });
                        }
                    });
                    (id, token, tx, rt, join)
                };

                // Store callback in global registry.
                let global = ctx.global_object();
                let callbacks_obj = global.get(js_string!("__scriptCallbacks"), ctx)?;
                if let Some(callbacks) = callbacks_obj.as_object() {
                    callbacks.set(js_string!(token.as_str()), cb.clone(), false, ctx)?;
                }

                {
                    let mut st = set_timeout_state.borrow_mut();
                    st.timers.insert(
                        id,
                        TimerEntry {
                            token,
                            repeat_ms: None,
                            handle: join,
                        },
                    );
                }

                let _ = (tx, rt); // keep for symmetry; avoids refactor churn.
                Ok(JsValue::from(id as f64))
            })
        };
        ctx.register_global_builtin_callable(js_string!("setTimeout"), 2, set_timeout_fn)
            .map_err(|e| format!("Failed to register setTimeout: {e}"))?;

        let clear_timeout_state = state.clone();
        let clear_timeout_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let id = args.get_or_undefined(0).to_u32(ctx).unwrap_or(0) as u64;
                let entry = {
                    let mut st = clear_timeout_state.borrow_mut();
                    st.timers.remove(&id)
                };
                if let Some(entry) = entry {
                    entry.handle.abort();
                    let global = ctx.global_object();
                    let callbacks_obj = global.get(js_string!("__scriptCallbacks"), ctx)?;
                    if let Some(callbacks) = callbacks_obj.as_object() {
                        let _ = callbacks.delete_property_or_throw(js_string!(entry.token.as_str()), ctx);
                    }
                }
                Ok(JsValue::undefined())
            })
        };
        ctx.register_global_builtin_callable(js_string!("clearTimeout"), 1, clear_timeout_fn)
            .map_err(|e| format!("Failed to register clearTimeout: {e}"))?;

        let set_interval_state = state.clone();
        let set_interval_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let cb = args.get_or_undefined(0);
                if !cb.is_callable() {
                    return Ok(JsValue::from(f64::NAN));
                }
                let ms = args.get_or_undefined(1).to_u32(ctx).unwrap_or(0) as u64;
                let period_ms = std::cmp::max(1, ms);

                let (id, token, join) = {
                    let mut st = set_interval_state.borrow_mut();
                    let id = st.next_timer_id;
                    st.next_timer_id = st.next_timer_id.saturating_add(1);
                    let token = format!("__timer:{id}");
                    let tx = st.command_tx.clone();
                    let rt = st.rt_handle.clone();
                    let join = rt.spawn(async move {
                        tokio::time::sleep(Duration::from_millis(period_ms)).await;
                        let _ = tx.send(ScriptCommand::Timer { id });
                    });
                    (id, token, join)
                };

                let global = ctx.global_object();
                let callbacks_obj = global.get(js_string!("__scriptCallbacks"), ctx)?;
                if let Some(callbacks) = callbacks_obj.as_object() {
                    callbacks.set(js_string!(token.as_str()), cb.clone(), false, ctx)?;
                }

                {
                    let mut st = set_interval_state.borrow_mut();
                    st.timers.insert(
                        id,
                        TimerEntry {
                            token,
                            repeat_ms: Some(period_ms),
                            handle: join,
                        },
                    );
                }

                Ok(JsValue::from(id as f64))
            })
        };
        ctx.register_global_builtin_callable(js_string!("setInterval"), 2, set_interval_fn)
            .map_err(|e| format!("Failed to register setInterval: {e}"))?;

        let clear_interval_state = state.clone();
        let clear_interval_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let id = args.get_or_undefined(0).to_u32(ctx).unwrap_or(0) as u64;
                let entry = {
                    let mut st = clear_interval_state.borrow_mut();
                    st.timers.remove(&id)
                };
                if let Some(entry) = entry {
                    entry.handle.abort();
                    let global = ctx.global_object();
                    let callbacks_obj = global.get(js_string!("__scriptCallbacks"), ctx)?;
                    if let Some(callbacks) = callbacks_obj.as_object() {
                        let _ = callbacks.delete_property_or_throw(js_string!(entry.token.as_str()), ctx);
                    }
                }
                Ok(JsValue::undefined())
            })
        };
        ctx.register_global_builtin_callable(js_string!("clearInterval"), 1, clear_interval_fn)
            .map_err(|e| format!("Failed to register clearInterval: {e}"))?;

        // -----------------------------------------------------------------
        // Sampler buffer API (desktop host)
        // -----------------------------------------------------------------

        let sampler_count_state = state.clone();
        let sampler_packet_count_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, _ctx| {
                let st = sampler_count_state.borrow();
                let n = sampler_buffer_packet_count(&st.device)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(JsValue::from(n as f64))
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptSamplerBufferGetPacketCount"), 0, sampler_packet_count_fn)
            .map_err(|e| format!("Failed to register _scriptSamplerBufferGetPacketCount: {e}"))?;

        let sampler_len_state = state.clone();
        let sampler_len_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, _ctx| {
                let st = sampler_len_state.borrow();
                let n = sampler_buffer_len_bytes(&st.device)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(JsValue::from(n as f64))
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptSamplerBufferGetLenBytes"), 0, sampler_len_fn)
            .map_err(|e| format!("Failed to register _scriptSamplerBufferGetLenBytes: {e}"))?;

        let sampler_get_state = state.clone();
        let sampler_get_bytes_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, ctx| {
                let st = sampler_get_state.borrow();
                let bytes = sampler_buffer_get_bytes(&st.device)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                let out = boa_engine::object::builtins::JsUint8Array::from_iter(
                    bytes.into_iter(),
                    ctx,
                )
                .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(out.into())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptSamplerBufferGetBytes"), 0, sampler_get_bytes_fn)
            .map_err(|e| format!("Failed to register _scriptSamplerBufferGetBytes: {e}"))?;

        let sampler_clear_state = state.clone();
        let sampler_clear_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, _ctx| {
                let st = sampler_clear_state.borrow();
                sampler_buffer_clear_only(&st.device)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(JsValue::undefined())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptSamplerBufferClear"), 0, sampler_clear_fn)
            .map_err(|e| format!("Failed to register _scriptSamplerBufferClear: {e}"))?;

        let sampler_invert_state = state.clone();
        let sampler_invert_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, _ctx| {
                let enabled = args.get_or_undefined(0).to_boolean();
                let st = sampler_invert_state.borrow();
                sampler_buffer_set_invert_rx(&st.device, enabled)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(JsValue::undefined())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptSamplerBufferSetInvertRx"), 1, sampler_invert_fn)
            .map_err(|e| format!("Failed to register _scriptSamplerBufferSetInvertRx: {e}"))?;

        let sampler_read_state = state.clone();
        let sampler_read_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let packet_index = args.get_or_undefined(0).to_u32(ctx).unwrap_or(0) as u64;
                let max_packets = args.get_or_undefined(1).to_u32(ctx).unwrap_or(256) as usize;
                let st = sampler_read_state.borrow();
                let resp = sampler_buffer_read_packets_since(&st.device, packet_index, max_packets)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;

                let data = boa_engine::object::builtins::JsUint8Array::from_iter(resp.data.into_iter(), ctx)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;

                let obj = ObjectInitializer::new(ctx)
                    .property(js_string!("data"), data, boa_engine::property::Attribute::all())
                    .property(js_string!("nextPacketIndex"), JsValue::from(resp.next_packet_index as f64), boa_engine::property::Attribute::all())
                    .property(js_string!("availablePackets"), JsValue::from(resp.available_packets as f64), boa_engine::property::Attribute::all())
                    .build();
                Ok(obj.into())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptSamplerBufferReadPacketsSince"), 2, sampler_read_fn)
            .map_err(|e| format!("Failed to register _scriptSamplerBufferReadPacketsSince: {e}"))?;

        let sampler_comp_state = state.clone();
        let sampler_comp_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let start_bit = args.get_or_undefined(0).to_u32(ctx).unwrap_or(0) as usize;
                let end_bit = args.get_or_undefined(1).to_u32(ctx).unwrap_or(0) as usize;
                let bins = args.get_or_undefined(2).to_u32(ctx).unwrap_or(0) as usize;
                let st = sampler_comp_state.borrow();
                let (buffer_len_bytes, time_values, data_values) =
                    sampler_buffer_compress_viewport(&st.device, start_bit, end_bit, bins)
                        .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;

                let time_arr =
                    JsArray::from_iter(time_values.into_iter().map(|v| JsValue::from(v as f64)), ctx);
                let data_arr =
                    JsArray::from_iter(data_values.into_iter().map(|v| JsValue::from(v as f64)), ctx);

                let time_val: JsValue = time_arr.into();
                let data_val: JsValue = data_arr.into();

                let obj = ObjectInitializer::new(ctx)
                    .property(js_string!("bufferLenBytes"), JsValue::from(buffer_len_bytes as f64), boa_engine::property::Attribute::all())
                    .property(js_string!("buffer_len_bytes"), JsValue::from(buffer_len_bytes as f64), boa_engine::property::Attribute::all())
                    .property(js_string!("timeValues"), time_val.clone(), boa_engine::property::Attribute::all())
                    .property(js_string!("time_values"), time_val, boa_engine::property::Attribute::all())
                    .property(js_string!("dataValues"), data_val.clone(), boa_engine::property::Attribute::all())
                    .property(js_string!("data_values"), data_val, boa_engine::property::Attribute::all())
                    .build();
                Ok(obj.into())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptSamplerBufferCompressViewport"), 3, sampler_comp_fn)
            .map_err(|e| format!("Failed to register _scriptSamplerBufferCompressViewport: {e}"))?;

        // -----------------------------------------------------------------
        // Buffer + transmit helpers used by the Sampler UI.
        // -----------------------------------------------------------------

        let buffer_set_state = state.clone();
        let buffer_set_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let bytes_value = args.get_or_undefined(0);
                let array = boa_engine::object::builtins::JsUint8Array::try_from_js(&bytes_value, ctx)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                let bytes = array.iter(ctx).collect::<Vec<u8>>();

                let st = buffer_set_state.borrow();
                let bytes_b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                let req = BridgeRequest {
                    id: 0,
                    method: "buffer_set_bytes".to_string(),
                    params: json!({"data_b64": bytes_b64}),
                };
                let v = st
                    .rt_handle
                    .block_on(async { dispatch_request(st.device.clone(), req).await })
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                let len_bytes = v.get("len_bytes").and_then(|x| x.as_u64()).unwrap_or(0);
                Ok(JsValue::from(len_bytes as f64))
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptBufferSetBytes"), 1, buffer_set_fn)
            .map_err(|e| format!("Failed to register _scriptBufferSetBytes: {e}"))?;

        let buffer_save_state = state.clone();
        let buffer_save_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let path = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                if path.is_empty() {
                    return Ok(JsValue::undefined());
                }
                let st = buffer_save_state.borrow();
                let req = BridgeRequest {
                    id: 0,
                    method: "buffer_save_bytes_file".to_string(),
                    params: json!({"path": path}),
                };
                st.rt_handle
                    .block_on(async { dispatch_request(st.device.clone(), req).await })
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(JsValue::undefined())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptBufferSaveBytesFile"), 1, buffer_save_fn)
            .map_err(|e| format!("Failed to register _scriptBufferSaveBytesFile: {e}"))?;

        let buffer_timings_state = state.clone();
        let buffer_timings_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let period_us = args.get_or_undefined(0).to_u32(ctx).unwrap_or(0) as u64;
                let st = buffer_timings_state.borrow();
                let req = BridgeRequest {
                    id: 0,
                    method: "buffer_build_signed_raw_timings".to_string(),
                    params: json!({"sample_period_us": period_us}),
                };
                let v = st
                    .rt_handle
                    .block_on(async { dispatch_request(st.device.clone(), req).await })
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                let timings = v.get("timings").and_then(|x| x.as_str()).unwrap_or("");
                Ok(JsValue::from(JsString::from(timings)))
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptBufferBuildSignedRawTimings"), 1, buffer_timings_fn)
            .map_err(|e| format!("Failed to register _scriptBufferBuildSignedRawTimings: {e}"))?;

        let tx_state = state.clone();
        let tx_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let bytes_value = args.get_or_undefined(0);
                let done_token = args.get_or_undefined(1).to_string(ctx)?.to_std_string_escaped();
                let array = boa_engine::object::builtins::JsUint8Array::try_from_js(&bytes_value, ctx)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                let bytes = array.iter(ctx).collect::<Vec<u8>>();

                let (device, rt, command_tx) = {
                    let st = tx_state.borrow();
                    (st.device.clone(), st.rt_handle.clone(), st.command_tx.clone())
                };

                rt.spawn(async move {
                    let _ = transmit_buffer_bytes(&device, bytes).await;
                    if !done_token.is_empty() {
                        let _ = command_tx.send(ScriptCommand::Callback {
                            token: done_token,
                            arg: None,
                        });
                    }
                });

                Ok(JsValue::undefined())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptDeviceTransmitBufferStart"), 2, tx_fn)
            .map_err(|e| format!("Failed to register _scriptDeviceTransmitBufferStart: {e}"))?;

        // -----------------------------------------------------------------
        // Device events (best-effort): allow scripts to listen for JSON events
        // emitted by the device bridge (e.g. tx_progress).
        // -----------------------------------------------------------------

        let on_event_state = state.clone();
        let on_event_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let event_name = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let cb = args.get_or_undefined(1);
                if event_name.is_empty() || !cb.is_callable() {
                    return Ok(JsValue::undefined());
                }

                // Register callback in global registry.
                let token = {
                    let mut st = on_event_state.borrow_mut();
                    let id = st.next_callback_id;
                    st.next_callback_id = st.next_callback_id.saturating_add(1);
                    let token = format!("__device_event:{}:{id}", event_name);
                    st.device_event_tokens
                        .entry(event_name.clone())
                        .or_default()
                        .push(token.clone());
                    token
                };

                let global = ctx.global_object();
                let callbacks_obj = global.get(js_string!("__scriptCallbacks"), ctx)?;
                if callbacks_obj.is_undefined() {
                    let _ = ctx.eval(Source::from_bytes("globalThis.__scriptCallbacks = {};"));
                }
                let callbacks_obj = global.get(js_string!("__scriptCallbacks"), ctx)?;
                if let Some(callbacks) = callbacks_obj.as_object() {
                    callbacks.set(js_string!(token.as_str()), cb.clone(), false, ctx)?;
                }

                // Start event pump once.
                {
                    let mut st = on_event_state.borrow_mut();
                    if st.device_event_task.is_none() {
                        let mut rx = st.device.event_tx.subscribe();
                        let tx = st.command_tx.clone();
                        st.device_event_task = Some(st.rt_handle.spawn(async move {
                            loop {
                                let Ok(buf) = rx.recv().await else { continue; };
                                let parsed: serde_json::Value = match serde_json::from_slice(&buf) {
                                    Ok(v) => v,
                                    Err(_) => continue,
                                };
                                let ev = parsed.get("event").and_then(|v| v.as_str());
                                let data = parsed.get("data");
                                let Some(ev) = ev else { continue; };
                                let data_json = data
                                    .and_then(|d| serde_json::to_string(d).ok())
                                    .unwrap_or_else(|| "null".to_string());
                                let _ = tx.send(ScriptCommand::DeviceEvent {
                                    event: ev.to_string(),
                                    data_json,
                                });
                            }
                        }));
                    }
                }

                Ok(JsValue::from(JsString::from(token.as_str())))
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptOnDeviceEvent"), 2, on_event_fn)
            .map_err(|e| format!("Failed to register _scriptOnDeviceEvent: {e}"))?;

        // -----------------------------------------------------------------
        // Filesystem helpers (best-effort)
        // -----------------------------------------------------------------

        let app_data_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, _ctx| {
                let home = std::env::var("HOME").unwrap_or_default();
                let path = if home.is_empty() {
                    String::new()
                } else {
                    format!("{home}/Library/Application Support/EMWaver")
                };
                Ok(JsValue::from(JsString::from(path.as_str())))
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptAppDataDir"), 0, app_data_fn)
            .map_err(|e| format!("Failed to register _scriptAppDataDir: {e}"))?;

        let path_join_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let parts_val = args.get_or_undefined(0);
                let mut out = std::path::PathBuf::new();
                if let Some(arr) = parts_val.as_object() {
                    let len = arr.get(js_string!("length"), ctx)?.to_u32(ctx).unwrap_or(0) as usize;
                    for i in 0..len {
                        let p = arr.get(i as u32, ctx)?.to_string(ctx)?.to_std_string_escaped();
                        if p.is_empty() {
                            continue;
                        }
                        if out.as_os_str().is_empty() {
                            out = std::path::PathBuf::from(p);
                        } else {
                            out.push(p);
                        }
                    }
                }
                let s = out.to_string_lossy().to_string();
                Ok(JsValue::from(JsString::from(s.as_str())))
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptPathJoin"), 1, path_join_fn)
            .map_err(|e| format!("Failed to register _scriptPathJoin: {e}"))?;

        let ensure_dir_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let path = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                if path.is_empty() {
                    return Ok(JsValue::undefined());
                }
                std::fs::create_dir_all(&path)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(JsValue::undefined())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptEnsureDir"), 1, ensure_dir_fn)
            .map_err(|e| format!("Failed to register _scriptEnsureDir: {e}"))?;

        let read_dir_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let path = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let mut entries: Vec<JsValue> = Vec::new();
                if !path.is_empty() {
                    if let Ok(rd) = std::fs::read_dir(&path) {
                        for e in rd.flatten() {
                            let s = e.path().to_string_lossy().to_string();
                            entries.push(JsValue::from(JsString::from(s.as_str())));
                        }
                    }
                }
                let arr = JsArray::from_iter(entries, ctx);
                Ok(arr.into())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptReadDir"), 1, read_dir_fn)
            .map_err(|e| format!("Failed to register _scriptReadDir: {e}"))?;

        let read_text_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let path = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let text = std::fs::read_to_string(&path)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(JsValue::from(JsString::from(text.as_str())))
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptReadFileText"), 1, read_text_fn)
            .map_err(|e| format!("Failed to register _scriptReadFileText: {e}"))?;

        let write_text_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let path = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let content = args.get_or_undefined(1).to_string(ctx)?.to_std_string_escaped();
                std::fs::write(&path, content)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(JsValue::undefined())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptWriteFileText"), 2, write_text_fn)
            .map_err(|e| format!("Failed to register _scriptWriteFileText: {e}"))?;

        let read_bytes_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let path = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let bytes = std::fs::read(&path)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                let out = boa_engine::object::builtins::JsUint8Array::from_iter(bytes.into_iter(), ctx)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(out.into())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptReadFileBytes"), 1, read_bytes_fn)
            .map_err(|e| format!("Failed to register _scriptReadFileBytes: {e}"))?;

        let write_bytes_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let path = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let bytes_value = args.get_or_undefined(1);
                let array = boa_engine::object::builtins::JsUint8Array::try_from_js(&bytes_value, ctx)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                let bytes = array.iter(ctx).collect::<Vec<u8>>();
                std::fs::write(&path, bytes)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(JsValue::undefined())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptWriteFileBytes"), 2, write_bytes_fn)
            .map_err(|e| format!("Failed to register _scriptWriteFileBytes: {e}"))?;

        let remove_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let path = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                if path.is_empty() {
                    return Ok(JsValue::undefined());
                }
                let p = std::path::PathBuf::from(&path);
                if p.is_dir() {
                    let _ = std::fs::remove_dir_all(&p);
                } else {
                    let _ = std::fs::remove_file(&p);
                }
                Ok(JsValue::undefined())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptRemovePath"), 1, remove_fn)
            .map_err(|e| format!("Failed to register _scriptRemovePath: {e}"))?;

        let rename_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let from = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                let to = args.get_or_undefined(1).to_string(ctx)?.to_std_string_escaped();
                std::fs::rename(&from, &to)
                    .map_err(|e| JsNativeError::error().with_message(e.to_string()))?;
                Ok(JsValue::undefined())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptRenamePath"), 2, rename_fn)
            .map_err(|e| format!("Failed to register _scriptRenamePath: {e}"))?;

        let reveal_fn = unsafe {
            NativeFunction::from_closure(move |_this, args, ctx| {
                let path = args.get_or_undefined(0).to_string(ctx)?.to_std_string_escaped();
                if !path.is_empty() {
                    #[cfg(target_os = "macos")]
                    {
                        let _ = std::process::Command::new("open")
                            .arg("-R")
                            .arg(&path)
                            .status();
                    }
                }
                Ok(JsValue::undefined())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptRevealInFinder"), 1, reveal_fn)
            .map_err(|e| format!("Failed to register _scriptRevealInFinder: {e}"))?;

        // -----------------------------------------------------------------
        // Signals (optional API used by some scripts)
        // -----------------------------------------------------------------

        let list_signals_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, ctx| {
                let arr = JsArray::from_iter(std::iter::empty::<JsValue>(), ctx);
                Ok(arr.into())
            })
        };
        ctx.register_global_builtin_callable(js_string!("_scriptListSignals"), 0, list_signals_fn)
            .map_err(|e| format!("Failed to register _scriptListSignals: {e}"))?;

        let read_signal_fn = unsafe {
            NativeFunction::from_closure(move |_this, _args, _ctx| Ok(JsValue::null()))
        };
        ctx.register_global_builtin_callable(js_string!("_scriptReadSignal"), 1, read_signal_fn)
            .map_err(|e| format!("Failed to register _scriptReadSignal: {e}"))?;

        Ok(())
    }
}

fn parse_script_node(value: &JsValue, ctx: &mut Context) -> JsResult<ScriptNode> {
    let Some(obj) = value.as_object() else {
        return Err(JsNativeError::error()
            .with_message("UI.render expects an object")
            .into());
    };

    let node_type = obj
        .get(js_string!("type"), ctx)?
        .to_string(ctx)?
        .to_std_string_escaped();
    let id = obj
        .get(js_string!("id"), ctx)?
        .to_string(ctx)?
        .to_std_string_escaped();

    let mut text: Option<String> = None;
    let mut label: Option<String> = None;
    let mut progress_pct: Option<f32> = None;

    let mut title: Option<String> = None;
    let mut subtitle: Option<String> = None;
    let mut disabled: Option<bool> = None;
    let mut open: Option<bool> = None;

    let mut plot_points: Option<u32> = None;
    let mut plot_height: Option<f32> = None;
    let mut overlay_text: Option<String> = None;
    let mut error_text: Option<String> = None;

    let mut value_num: Option<f64> = None;
    let mut value_str: Option<String> = None;
    let mut min: Option<f64> = None;
    let mut max: Option<f64> = None;
    let mut step: Option<f64> = None;
    let mut selected: Option<String> = None;
    let mut options: Vec<ScriptOption> = Vec::new();
    let mut placeholder: Option<String> = None;
    let mut checked: Option<bool> = None;

    let props_val = obj.get(js_string!("props"), ctx)?;
    if let Some(props) = props_val.as_object() {
        if let Ok(v) = props.get(js_string!("text"), ctx) {
            if !(v.is_undefined() || v.is_null()) {
                text = Some(v.to_string(ctx)?.to_std_string_escaped());
            }
        }
        if let Ok(v) = props.get(js_string!("label"), ctx) {
            if !(v.is_undefined() || v.is_null()) {
                label = Some(v.to_string(ctx)?.to_std_string_escaped());
            }
        }
        if let Ok(v) = props.get(js_string!("value"), ctx) {
            if v.is_number() {
                let n = v.to_number(ctx).ok();
                value_num = n;
                if node_type == "progress" {
                    progress_pct = n.map(|n| {
                        let f = n as f32;
                        if f <= 1.0 {
                            (f * 100.0).max(0.0).min(100.0)
                        } else {
                            f.max(0.0).min(100.0)
                        }
                    });
                } else {
                    progress_pct = n
                        .map(|n| n as f32)
                        .map(|n| n.max(0.0).min(100.0));
                }
            } else if !(v.is_undefined() || v.is_null()) {
                value_str = Some(v.to_string(ctx)?.to_std_string_escaped());
                if v.is_boolean() {
                    checked = Some(v.to_boolean());
                }
            }
        }

        if let Ok(v) = props.get(js_string!("title"), ctx) {
            if !(v.is_undefined() || v.is_null()) {
                title = Some(v.to_string(ctx)?.to_std_string_escaped());
            }
        }
        if let Ok(v) = props.get(js_string!("subtitle"), ctx) {
            if !(v.is_undefined() || v.is_null()) {
                subtitle = Some(v.to_string(ctx)?.to_std_string_escaped());
            }
        }
        if let Ok(v) = props.get(js_string!("disabled"), ctx) {
            if v.is_boolean() {
                disabled = Some(v.to_boolean());
            }
        }
        if let Ok(v) = props.get(js_string!("open"), ctx) {
            if v.is_boolean() {
                open = Some(v.to_boolean());
            }
        }

        if let Ok(v) = props.get(js_string!("height"), ctx) {
            if v.is_number() {
                plot_height = v
                    .to_number(ctx)
                    .ok()
                    .map(|n| n as f32)
                    .map(|n| n.max(60.0).min(1200.0));
            }
        }
        if let Ok(v) = props.get(js_string!("overlayText"), ctx) {
            if !(v.is_undefined() || v.is_null()) {
                overlay_text = Some(v.to_string(ctx)?.to_std_string_escaped());
            }
        }
        if let Ok(v) = props.get(js_string!("errorText"), ctx) {
            if !(v.is_undefined() || v.is_null()) {
                error_text = Some(v.to_string(ctx)?.to_std_string_escaped());
            }
        }
        if let Ok(v) = props.get(js_string!("dataY"), ctx) {
            plot_points = array_len(&v, ctx);
        }

        if let Ok(v) = props.get(js_string!("min"), ctx) {
            if v.is_number() {
                min = v.to_number(ctx).ok();
            }
        }
        if let Ok(v) = props.get(js_string!("max"), ctx) {
            if v.is_number() {
                max = v.to_number(ctx).ok();
            }
        }

        // Plot nodes use xMin/xMax.
        if node_type == "plot" {
            if let Ok(v) = props.get(js_string!("xMin"), ctx) {
                if v.is_number() {
                    min = v.to_number(ctx).ok();
                }
            }
            if let Ok(v) = props.get(js_string!("xMax"), ctx) {
                if v.is_number() {
                    max = v.to_number(ctx).ok();
                }
            }
        }
        if let Ok(v) = props.get(js_string!("step"), ctx) {
            if v.is_number() {
                step = v.to_number(ctx).ok();
            }
        }

        if let Ok(v) = props.get(js_string!("selected"), ctx) {
            if !(v.is_undefined() || v.is_null()) {
                selected = Some(v.to_string(ctx)?.to_std_string_escaped());
            }
        }

        if let Ok(v) = props.get(js_string!("options"), ctx) {
            options = parse_options(&v, ctx);
        }

        if let Ok(v) = props.get(js_string!("placeholder"), ctx) {
            if !(v.is_undefined() || v.is_null()) {
                placeholder = Some(v.to_string(ctx)?.to_std_string_escaped());
            }
        }

        if let Ok(v) = props.get(js_string!("checked"), ctx) {
            if v.is_boolean() {
                checked = Some(v.to_boolean());
            }
        }
    }

    let mut handlers: HashMap<String, String> = HashMap::new();
    let handlers_val = obj.get(js_string!("handlers"), ctx)?;
    if let Some(h) = handlers_val.as_object() {
        for key in ["tap", "change", "submit", "close", "viewport", "select", "cursor"] {
            if let Ok(v) = h.get(js_string!(key), ctx) {
                if !(v.is_undefined() || v.is_null()) {
                    let token = v.to_string(ctx)?.to_std_string_escaped();
                    if !token.is_empty() {
                        handlers.insert(key.to_string(), token);
                    }
                }
            }
        }
    }

    let mut children: Vec<ScriptNode> = Vec::new();
    let children_val = obj.get(js_string!("children"), ctx)?;
    if let Some(arr) = children_val.as_object() {
        let len = arr
            .get(js_string!("length"), ctx)?
            .to_u32(ctx)
            .unwrap_or(0) as usize;
        children.reserve(len);
        for i in 0..len {
            let child_val = arr.get(i as u32, ctx)?;
            if child_val.is_null() || child_val.is_undefined() {
                continue;
            }
            children.push(parse_script_node(&child_val, ctx)?);
        }
    }

    Ok(ScriptNode {
        node_type,
        id,
        text,
        label,
        progress_pct,

        title,
        subtitle,
        disabled,
        open,

        plot_points,
        plot_height,
        overlay_text,
        error_text,

        value_num,
        value_str,
        min,
        max,
        step,
        selected,
        options,
        placeholder,
        checked,

        handlers,
        children,
    })
}

fn parse_options(value: &JsValue, ctx: &mut Context) -> Vec<ScriptOption> {
    let Some(arr) = value.as_object() else {
        return Vec::new();
    };

    let len = arr
        .get(js_string!("length"), ctx)
        .ok()
        .and_then(|v| v.to_u32(ctx).ok())
        .unwrap_or(0) as usize;

    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        let child = match arr.get(i as u32, ctx) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let Some(opt) = child.as_object() else {
            continue;
        };

        let label = opt
            .get(js_string!("label"), ctx)
            .ok()
            .filter(|v| !(v.is_undefined() || v.is_null()))
            .and_then(|v| v.to_string(ctx).ok())
            .map(|s| s.to_std_string_escaped())
            .unwrap_or_else(|| format!("Option {}", i + 1));

        let value = opt
            .get(js_string!("value"), ctx)
            .ok()
            .filter(|v| !(v.is_undefined() || v.is_null()))
            .and_then(|v| v.to_string(ctx).ok())
            .map(|s| s.to_std_string_escaped())
            .unwrap_or_default();

        out.push(ScriptOption { label, value });
    }
    out
}

fn array_len(value: &JsValue, ctx: &mut Context) -> Option<u32> {
    let Some(arr) = value.as_object() else {
        return None;
    };
    arr.get(js_string!("length"), ctx)
        .ok()
        .and_then(|v| v.to_u32(ctx).ok())
}

fn escape_js_string(s: &str) -> String {
    // Escape for single-quoted JS string literal.
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}
