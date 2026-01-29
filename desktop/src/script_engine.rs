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
    JsNativeError,
    JsResult,
    JsValue,
    Source,
};
use tokio::sync::mpsc;

use emwaver_device_core::bridge::{send_packet_command_bytes, BridgeState};

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
}

#[derive(Debug, Clone)]
pub enum ScriptCallbackArg {
    Str(String),
    Num(f64),
    Bool(bool),
}

#[derive(Debug, Clone)]
pub struct ScriptNode {
    pub node_type: String,
    pub id: String,
    pub text: Option<String>,
    pub label: Option<String>,
    pub progress_pct: Option<f32>,

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
                    };
                    if let Err(e) = ctx.eval(Source::from_bytes(&invoke)) {
                        let _ = self.event_tx.send(ScriptEvent::Error {
                            message: format!("Callback error: {e}"),
                        });
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
                progress_pct = n
                    .map(|n| n as f32)
                    .map(|n| n.max(0.0).min(100.0));
            } else if !(v.is_undefined() || v.is_null()) {
                value_str = Some(v.to_string(ctx)?.to_std_string_escaped());
                if v.is_boolean() {
                    checked = Some(v.to_boolean());
                }
            }
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

fn escape_js_string(s: &str) -> String {
    // Escape for single-quoted JS string literal.
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}
