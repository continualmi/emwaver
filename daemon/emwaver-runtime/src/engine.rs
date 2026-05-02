use anyhow::{Context, Result};
use boa_engine::{
    js_string,
    object::{builtins::JsArray, FunctionObjectBuilder, ObjectInitializer},
    property::Attribute,
    Context as BoaContext,
    JsValue,
    NativeFunction,
    Source,
};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::error;

use crate::ui_tree::UiNode;

pub trait CommandBridge: Send + Sync + 'static {
    fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>>;
}

pub struct Engine {
    ctx: Mutex<BoaContext>,

    callbacks: Arc<Mutex<HashMap<String, JsValue>>>,

    pub latest_tree: Arc<Mutex<Option<UiNode>>>,
    pub latest_metadata: Arc<Mutex<JsonValue>>,

    _bridge: Arc<dyn CommandBridge>,
}

impl Engine {
    pub fn new(bootstrap_source: &str, bridge: Arc<dyn CommandBridge>) -> Result<Self> {
        let mut ctx = BoaContext::default();

        let callbacks: Arc<Mutex<HashMap<String, JsValue>>> = Arc::new(Mutex::new(HashMap::new()));
        let latest_tree: Arc<Mutex<Option<UiNode>>> = Arc::new(Mutex::new(None));
        let latest_metadata: Arc<Mutex<JsonValue>> = Arc::new(Mutex::new(JsonValue::Object(Default::default())));

        // _scriptRegisterCallback(token, fn)
        {
            let cb_map = callbacks.clone();
            let func = FunctionObjectBuilder::new(
                ctx.realm(),
                unsafe { NativeFunction::from_closure(move |_this, args, _ctx| {
                    let token = args.get(0).cloned().unwrap_or(JsValue::undefined());
                    let token = token
                        .as_string()
                        .map(|s| s.to_std_string().unwrap_or_default())
                        .unwrap_or_default();

                    let f = args.get(1).cloned().unwrap_or(JsValue::undefined());
                    if token.trim().is_empty() {
                        return Ok(JsValue::undefined());
                    }

                    cb_map.lock().unwrap().insert(token, f);
                    Ok(JsValue::undefined())
                }) },
            )
            .name("_scriptRegisterCallback")
            .length(2)
            .build();

            ctx.register_global_property(js_string!("_scriptRegisterCallback"), func, Attribute::all())
                .map_err(map_js_err)
                .context("register _scriptRegisterCallback")?;
        }

        // _scriptRender(jsonString)
        {
            let tree_store = latest_tree.clone();
            let func = FunctionObjectBuilder::new(
                ctx.realm(),
                unsafe { NativeFunction::from_closure(move |_this, args, _ctx| {
                    let s = args.get(0).cloned().unwrap_or(JsValue::undefined());
                    let json_str = s
                        .as_string()
                        .map(|s| s.to_std_string().unwrap_or_default())
                        .unwrap_or_default();

                    let v: JsonValue = serde_json::from_str(&json_str).unwrap_or(JsonValue::Null);
                    let parsed: Option<UiNode> = serde_json::from_value(v).ok();
                    *tree_store.lock().unwrap() = parsed;
                    Ok(JsValue::undefined())
                }) },
            )
            .name("_scriptRender")
            .length(1)
            .build();

            ctx.register_global_property(js_string!("_scriptRender"), func, Attribute::all())
                .map_err(map_js_err)
                .context("register _scriptRender")?;
        }

        // _scriptSleep(ms) (optional)
        {
            let func = FunctionObjectBuilder::new(
                ctx.realm(),
                unsafe { NativeFunction::from_closure(move |_this, _args, _ctx| Ok(JsValue::undefined())) },
            )
            .name("_scriptSleep")
            .length(1)
            .build();

            ctx.register_global_property(js_string!("_scriptSleep"), func, Attribute::all())
                .map_err(map_js_err)
                .context("register _scriptSleep")?;
        }

        // _scriptSendPacket(bytes: Uint8Array, timeoutMs: number) -> Uint8Array
        {
            let command_bridge = bridge.clone();
            let func = FunctionObjectBuilder::new(
                ctx.realm(),
                unsafe { NativeFunction::from_closure(move |_this, args, ctx| {
                    let bytes = args.get(0).cloned().unwrap_or(JsValue::undefined());
                    let timeout_ms = args
                        .get(1)
                        .and_then(|v| v.as_number())
                        .map(|n| n as i32)
                        .unwrap_or(2000);

                    // Expect Uint8Array. Boa stores typed array data internally; simplest path
                    // is to coerce to a JS Array and read numeric elements.
                    // (This is not the fastest, but OK for now.)
                    let obj = bytes.as_object().cloned();
                    let mut cmd: Vec<u8> = vec![];
                    if let Some(o) = obj {
                        let len = o.get(js_string!("length"), ctx)?.as_number().unwrap_or(0.0) as usize;
                        cmd.reserve(len);
                        for i in 0..len {
                            let v = o.get(i, ctx)?;
                            let b = v.as_number().unwrap_or(0.0) as i32;
                            cmd.push((b & 0xFF) as u8);
                        }
                    }

                    let timeout = (timeout_ms.max(1) as u64).min(10_000);
                    let resp = match command_bridge.send_command(&cmd, timeout) {
                        Ok(Some(resp)) => resp,
                        Ok(None) => Vec::<u8>::new(),
                        Err(_) => vec![0x81u8],
                    };

                    // Return an Array(respBytes)
                    let array = JsArray::new(ctx);
                    for (i, b) in resp.iter().enumerate() {
                        array.set(i, JsValue::new(*b), true, ctx)?;
                    }
                    Ok(array.into())
                }) },
            )
            .name("_scriptSendPacket")
            .length(2)
            .build();

            ctx.register_global_property(js_string!("_scriptSendPacket"), func, Attribute::all())
                .map_err(map_js_err)
                .context("register _scriptSendPacket")?;
        }

        // Load bootstrap.
        ctx.eval(Source::from_bytes(bootstrap_source))
            .map_err(map_js_err)
            .context("failed to eval script_bootstrap.emw")?;

        Ok(Self {
            ctx: Mutex::new(ctx),
            callbacks,
            latest_tree,
            latest_metadata,
            _bridge: bridge,
        })
    }

    pub fn run_script(&self, source: &str) -> Result<()> {
        let mut ctx = self.ctx.lock().unwrap();
        ctx.eval(Source::from_bytes(source))
            .map_err(map_js_err)
            .context("script eval failed")?;
        Ok(())
    }

    pub fn dispatch_ui_event(&self, token: &str, args: Vec<JsonValue>) -> Result<()> {
        let cb_opt = { self.callbacks.lock().unwrap().get(token).cloned() };
        let Some(cb) = cb_opt else {
            anyhow::bail!("unknown_handler_token");
        };

        let mut ctx = self.ctx.lock().unwrap();
        let Some(fobj) = cb.as_object().cloned() else {
            anyhow::bail!("handler_not_callable");
        };

        let mut js_args: Vec<JsValue> = Vec::with_capacity(args.len());
        for a in args {
            js_args.push(json_to_js(&mut ctx, &a)?);
        }

        // Call handler
        let this = JsValue::undefined();
        fobj.call(&this, &js_args, &mut ctx)
            .map_err(map_js_err)
            .map(|_| ())
            .map_err(|e| {
                error!("ui event handler error: {e:#}");
                e
            })
    }
}

fn json_to_js(ctx: &mut BoaContext, v: &JsonValue) -> Result<JsValue> {
    Ok(match v {
        JsonValue::Null => JsValue::null(),
        JsonValue::Bool(b) => JsValue::new(*b),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                JsValue::new(i as f64)
            } else if let Some(u) = n.as_u64() {
                JsValue::new(u as f64)
            } else if let Some(f) = n.as_f64() {
                JsValue::new(f)
            } else {
                JsValue::null()
            }
        }
        JsonValue::String(s) => JsValue::from(js_string!(s.as_str())),
        JsonValue::Array(arr) => {
            let array = JsArray::new(ctx);
            for (i, item) in arr.iter().enumerate() {
                let js = json_to_js(ctx, item)?;
                array.set(i, js, true, ctx).map_err(map_js_err)?;
            }
            array.into()
        }
        JsonValue::Object(map) => {
            let mut pairs: Vec<(&str, JsValue)> = Vec::with_capacity(map.len());
            for (k, item) in map.iter() {
                pairs.push((k.as_str(), json_to_js(ctx, item)?));
            }

            let mut init = ObjectInitializer::new(ctx);
            for (k, js) in pairs {
                init.property(js_string!(k), js, Attribute::all());
            }
            init.build().into()
        }
    })
}

fn map_js_err(e: boa_engine::JsError) -> anyhow::Error {
    anyhow::anyhow!(e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct RecordingBridge {
        calls: Mutex<Vec<(Vec<u8>, u64)>>,
        response: Option<Vec<u8>>,
    }

    impl RecordingBridge {
        fn new(response: Option<Vec<u8>>) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                response,
            }
        }
    }

    impl CommandBridge for RecordingBridge {
        fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>> {
            self.calls.lock().unwrap().push((cmd_lane.to_vec(), timeout_ms));
            Ok(self.response.clone())
        }
    }

    #[test]
    fn render_updates_latest_tree() {
        let bridge = Arc::new(RecordingBridge::new(None));
        let command_bridge: Arc<dyn CommandBridge> = bridge.clone();
        let engine = Engine::new("", command_bridge).expect("engine");

        engine
            .run_script(
                r#"_scriptRender(JSON.stringify({
                    id: "root",
                    type: "text",
                    props: { text: "hello" }
                }));"#,
            )
            .expect("run script");

        let tree = engine.latest_tree.lock().unwrap().clone().expect("tree");
        assert_eq!(tree.id, "root");
        assert_eq!(tree.node_type, "text");
        assert_eq!(tree.props.get("text").and_then(|v| v.as_str()), Some("hello"));
    }

    #[test]
    fn send_packet_uses_command_bridge() {
        let bridge = Arc::new(RecordingBridge::new(Some(vec![0x10, 0x20])));
        let command_bridge: Arc<dyn CommandBridge> = bridge.clone();
        let engine = Engine::new("", command_bridge).expect("engine");

        engine
            .run_script("_scriptSendPacket([1, 2, 255], 25);")
            .expect("run script");

        let calls = bridge.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, vec![1, 2, 255]);
        assert_eq!(calls[0].1, 25);
    }
}
