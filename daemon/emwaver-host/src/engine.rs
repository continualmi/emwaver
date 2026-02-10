use anyhow::{Context, Result};
use rquickjs::{Context as JsContext, Function, Runtime, Value as JsValue};
use rquickjs::prelude::Func;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::{error, info};

use crate::device::Device;
use crate::ui_tree::UiNode;

pub struct Engine {
    _rt: Runtime,
    ctx: JsContext,

    callbacks: Arc<Mutex<HashMap<String, Function<'static>>>>,

    pub latest_tree: Arc<Mutex<Option<UiNode>>>,
    pub latest_metadata: Arc<Mutex<Value>>,
}

impl Engine {
    pub fn new(bootstrap_source: &str, device: Arc<Device>) -> Result<Self> {
        let rt = Runtime::new()?;
        let ctx = JsContext::full(&rt)?;

        // Shared state.
        let callbacks: Arc<Mutex<HashMap<String, Function<'static>>>> = Arc::new(Mutex::new(HashMap::new()));
        let latest_tree: Arc<Mutex<Option<UiNode>>> = Arc::new(Mutex::new(None));
        let latest_metadata: Arc<Mutex<Value>> = Arc::new(Mutex::new(Value::Object(Default::default())));

        // Install host functions.
        {
            let globals = ctx.globals();

            // _scriptRegisterCallback(token, fn)
            let cb_map = callbacks.clone();
            let register = Func::new("_scriptRegisterCallback", move |token: String, func: Function| {
                // NOTE: QuickJS functions are GC'd; for simplicity we keep them alive by
                // converting to a 'static handle. This is a TODO: use proper persistent handles.
                let func_static: Function<'static> = unsafe { std::mem::transmute(func) };
                cb_map.lock().unwrap().insert(token, func_static);
            });
            globals.set("_scriptRegisterCallback", register)?;

            // _scriptRender(node)
            let tree_store = latest_tree.clone();
            let render = Func::new("_scriptRender", move |node: JsValue| {
                let v: Value = rquickjs::serde::from_value(node).unwrap_or(Value::Null);
                // The bootstrap passes a full tree root node object.
                let parsed: Option<UiNode> = serde_json::from_value(v).ok();
                *tree_store.lock().unwrap() = parsed;
            });
            globals.set("_scriptRender", render)?;

            // _scriptSleep(ms)
            let sleep_fn = Func::new("_scriptSleep", move |_ms: i32| {
                // TODO: integrate with tokio time; for now, no-op.
            });
            globals.set("_scriptSleep", sleep_fn)?;

            // _scriptSendPacket(bytes, timeoutMs) -> Uint8Array (synchronous)
            let dev = device.clone();
            let send_packet = Func::new("_scriptSendPacket", move |bytes: rquickjs::TypedArray<u8>, timeout_ms: i32| {
                let cmd: Vec<u8> = bytes.as_bytes().to_vec();
                let timeout = (timeout_ms.max(1) as u64).min(10_000);

                match dev.send_command(&cmd, timeout) {
                    Ok(Some(resp)) => resp,
                    Ok(None) => Vec::<u8>::new(),
                    Err(_) => vec![0x81u8],
                }
            });
            globals.set("_scriptSendPacket", send_packet)?;
        }

        // Load bootstrap.
        ctx.eval::<(), _>(bootstrap_source)
            .context("failed to eval script_bootstrap.emw")?;

        Ok(Self {
            _rt: rt,
            ctx,
            callbacks,
            latest_tree,
            latest_metadata,
        })
    }

    pub fn run_script(&self, source: &str) -> Result<()> {
        self.ctx.eval::<(), _>(source).context("script eval failed")?;
        Ok(())
    }

    pub fn dispatch_ui_event(&self, token: &str, args: Vec<Value>) -> Result<()> {
        let cb_opt = { self.callbacks.lock().unwrap().get(token).cloned() };
        let Some(cb) = cb_opt else {
            anyhow::bail!("unknown_handler_token");
        };

        self.ctx.with(|ctx| {
            // Convert args to JS values.
            let mut js_args: Vec<JsValue> = Vec::with_capacity(args.len());
            for a in args {
                js_args.push(rquickjs::serde::to_value(ctx, &a).unwrap_or(JsValue::Undefined));
            }

            match cb.call::<(), _>(js_args) {
                Ok(_) => Ok(()),
                Err(e) => {
                    error!("ui event handler error: {e}");
                    Err(anyhow::anyhow!("handler_error"))
                }
            }
        })
    }
}
