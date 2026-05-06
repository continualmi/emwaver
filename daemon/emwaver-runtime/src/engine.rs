use anyhow::{Context, Result};
use boa_engine::{
    js_string,
    object::{builtins::JsArray, FunctionObjectBuilder, ObjectInitializer},
    property::Attribute,
    Context as BoaContext, JsValue, NativeFunction, Source,
};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tracing::error;

use crate::ui_tree::UiNode;

pub trait CommandBridge: Send + Sync + 'static {
    fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>>;

    fn get_buffer(&self) -> Vec<u8> {
        Vec::new()
    }

    fn clear_buffer(&self) {}
}

pub struct Engine {
    ctx: Mutex<BoaContext>,

    callbacks: Arc<Mutex<HashMap<String, JsValue>>>,
    timeouts: Arc<Mutex<TimerRegistry>>,

    pub latest_tree: Arc<Mutex<Option<UiNode>>>,
    pub latest_metadata: Arc<Mutex<JsonValue>>,

    _bridge: Arc<dyn CommandBridge>,
}

#[derive(Default)]
struct TimerRegistry {
    next_id: u64,
    timers: HashMap<u64, TimerEntry>,
}

struct TimerEntry {
    due_at: Instant,
    callback: JsValue,
}

impl Engine {
    pub fn new(bootstrap_source: &str, bridge: Arc<dyn CommandBridge>) -> Result<Self> {
        let mut ctx = BoaContext::default();

        let callbacks: Arc<Mutex<HashMap<String, JsValue>>> = Arc::new(Mutex::new(HashMap::new()));
        let timeouts: Arc<Mutex<TimerRegistry>> = Arc::new(Mutex::new(TimerRegistry::default()));
        let latest_tree: Arc<Mutex<Option<UiNode>>> = Arc::new(Mutex::new(None));
        let latest_metadata: Arc<Mutex<JsonValue>> =
            Arc::new(Mutex::new(JsonValue::Object(Default::default())));

        // _scriptRegisterCallback(token, fn)
        {
            let cb_map = callbacks.clone();
            let func = FunctionObjectBuilder::new(ctx.realm(), unsafe {
                NativeFunction::from_closure(move |_this, args, _ctx| {
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
                })
            })
            .name("_scriptRegisterCallback")
            .length(2)
            .build();

            ctx.register_global_property(
                js_string!("_scriptRegisterCallback"),
                func,
                Attribute::all(),
            )
            .map_err(map_js_err)
            .context("register _scriptRegisterCallback")?;
        }

        // _scriptRender(jsonString)
        {
            let tree_store = latest_tree.clone();
            let func = FunctionObjectBuilder::new(ctx.realm(), unsafe {
                NativeFunction::from_closure(move |_this, args, _ctx| {
                    let s = args.get(0).cloned().unwrap_or(JsValue::undefined());
                    let json_str = s
                        .as_string()
                        .map(|s| s.to_std_string().unwrap_or_default())
                        .unwrap_or_default();

                    let v: JsonValue = serde_json::from_str(&json_str).unwrap_or(JsonValue::Null);
                    let parsed: Option<UiNode> = serde_json::from_value(v).ok();
                    *tree_store.lock().unwrap() = parsed;
                    Ok(JsValue::undefined())
                })
            })
            .name("_scriptRender")
            .length(1)
            .build();

            ctx.register_global_property(js_string!("_scriptRender"), func, Attribute::all())
                .map_err(map_js_err)
                .context("register _scriptRender")?;
        }

        // _scriptSleep(ms) (optional)
        {
            let func = FunctionObjectBuilder::new(ctx.realm(), unsafe {
                NativeFunction::from_closure(move |_this, args, _ctx| {
                    let duration_ms = args
                        .get(0)
                        .and_then(|v| v.as_number())
                        .unwrap_or(0.0)
                        .max(0.0);
                    if duration_ms > 0.0 {
                        std::thread::sleep(Duration::from_millis(duration_ms.round() as u64));
                    }
                    Ok(JsValue::undefined())
                })
            })
            .name("_scriptSleep")
            .length(1)
            .build();

            ctx.register_global_property(js_string!("_scriptSleep"), func, Attribute::all())
                .map_err(map_js_err)
                .context("register _scriptSleep")?;
        }

        // setTimeout(callback, ms) / clearTimeout(id)
        {
            let timers = timeouts.clone();
            let func = FunctionObjectBuilder::new(ctx.realm(), unsafe {
                NativeFunction::from_closure(move |_this, args, _ctx| {
                    let callback = args.get(0).cloned().unwrap_or(JsValue::undefined());
                    if callback.as_object().is_none() {
                        return Ok(JsValue::new(0));
                    }

                    let delay_ms = args
                        .get(1)
                        .and_then(|v| v.as_number())
                        .unwrap_or(0.0)
                        .max(0.0);

                    let mut timers = timers.lock().unwrap();
                    timers.next_id = timers.next_id.saturating_add(1).max(1);
                    let id = timers.next_id;
                    timers.timers.insert(
                        id,
                        TimerEntry {
                            due_at: Instant::now() + Duration::from_millis(delay_ms.round() as u64),
                            callback,
                        },
                    );
                    Ok(JsValue::new(id as f64))
                })
            })
            .name("setTimeout")
            .length(2)
            .build();

            ctx.register_global_property(js_string!("setTimeout"), func, Attribute::all())
                .map_err(map_js_err)
                .context("register setTimeout")?;
        }

        {
            let timers = timeouts.clone();
            let func = FunctionObjectBuilder::new(ctx.realm(), unsafe {
                NativeFunction::from_closure(move |_this, args, _ctx| {
                    let id = args.get(0).and_then(|v| v.as_number()).unwrap_or(0.0) as u64;
                    if id != 0 {
                        timers.lock().unwrap().timers.remove(&id);
                    }
                    Ok(JsValue::undefined())
                })
            })
            .name("clearTimeout")
            .length(1)
            .build();

            ctx.register_global_property(js_string!("clearTimeout"), func, Attribute::all())
                .map_err(map_js_err)
                .context("register clearTimeout")?;
        }

        // Minimal filesystem/path API (matches the Apple host surface used by FS.*).
        register_filesystem_api(&mut ctx)?;
        register_sampler_buffer_api(&mut ctx, bridge.clone())?;

        // _scriptSendPacket(bytes: Uint8Array, timeoutMs: number) -> Uint8Array
        {
            let command_bridge = bridge.clone();
            let func = FunctionObjectBuilder::new(ctx.realm(), unsafe {
                NativeFunction::from_closure(move |_this, args, ctx| {
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
                        let len =
                            o.get(js_string!("length"), ctx)?.as_number().unwrap_or(0.0) as usize;
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
                })
            })
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
            timeouts,
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

    pub fn pending_timeout_count(&self) -> usize {
        self.timeouts.lock().unwrap().timers.len()
    }

    pub fn next_timer_due_in(&self) -> Option<Duration> {
        let timers = self.timeouts.lock().unwrap();
        let next_due = timers.timers.values().map(|entry| entry.due_at).min()?;
        Some(next_due.saturating_duration_since(Instant::now()))
    }

    pub fn pump_due_timers(&self, max_callbacks: usize) -> Result<usize> {
        let mut ran = 0usize;
        for _ in 0..max_callbacks {
            let due = {
                let mut timers = self.timeouts.lock().unwrap();
                let Some((&id, _)) = timers
                    .timers
                    .iter()
                    .filter(|(_, entry)| entry.due_at <= Instant::now())
                    .min_by_key(|(_, entry)| entry.due_at)
                else {
                    break;
                };
                timers.timers.remove(&id).map(|entry| entry.callback)
            };

            let Some(callback) = due else {
                break;
            };
            let Some(fobj) = callback.as_object().cloned() else {
                continue;
            };

            let mut ctx = self.ctx.lock().unwrap();
            let this = JsValue::undefined();
            fobj.call(&this, &[], &mut ctx)
                .map_err(map_js_err)
                .map(|_| ())
                .map_err(|e| {
                    error!("timer callback error: {e:#}");
                    e
                })?;
            ran += 1;
        }
        Ok(ran)
    }
}

fn register_filesystem_api(ctx: &mut BoaContext) -> Result<()> {
    let app_data = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, _args, _ctx| {
            Ok(JsValue::from(js_string!(app_data_dir()
                .to_string_lossy()
                .to_string())))
        })
    })
    .name("_scriptAppDataDir")
    .length(0)
    .build();
    ctx.register_global_property(js_string!("_scriptAppDataDir"), app_data, Attribute::all())
        .map_err(map_js_err)
        .context("register _scriptAppDataDir")?;

    let path_join = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let parts =
                js_array_to_strings(args.get(0).cloned().unwrap_or(JsValue::undefined()), ctx)?;
            let mut out = PathBuf::new();
            for part in parts.into_iter().filter(|s| !s.trim().is_empty()) {
                out.push(part);
            }
            Ok(JsValue::from(js_string!(out.to_string_lossy().to_string())))
        })
    })
    .name("_scriptPathJoin")
    .length(1)
    .build();
    ctx.register_global_property(js_string!("_scriptPathJoin"), path_join, Attribute::all())
        .map_err(map_js_err)
        .context("register _scriptPathJoin")?;

    let ensure_dir = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, args, _ctx| {
            let path = js_arg_string(args, 0);
            if !path.trim().is_empty() {
                fs::create_dir_all(path).map_err(|e| {
                    boa_engine::JsError::from_opaque(JsValue::from(js_string!(e.to_string())))
                })?;
            }
            Ok(JsValue::undefined())
        })
    })
    .name("_scriptEnsureDir")
    .length(1)
    .build();
    ctx.register_global_property(js_string!("_scriptEnsureDir"), ensure_dir, Attribute::all())
        .map_err(map_js_err)
        .context("register _scriptEnsureDir")?;

    let read_dir = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let path = js_arg_string(args, 0);
            let names = if path.trim().is_empty() {
                Vec::new()
            } else {
                match fs::read_dir(path) {
                    Ok(entries) => entries
                        .filter_map(Result::ok)
                        .filter_map(|entry| entry.file_name().into_string().ok())
                        .collect::<Vec<_>>(),
                    Err(_) => Vec::new(),
                }
            };
            strings_to_js_array(names, ctx)
        })
    })
    .name("_scriptReadDir")
    .length(1)
    .build();
    ctx.register_global_property(js_string!("_scriptReadDir"), read_dir, Attribute::all())
        .map_err(map_js_err)
        .context("register _scriptReadDir")?;

    let read_text = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, args, _ctx| {
            let path = js_arg_string(args, 0);
            let text = if path.trim().is_empty() {
                String::new()
            } else {
                fs::read_to_string(path).unwrap_or_default()
            };
            Ok(JsValue::from(js_string!(text)))
        })
    })
    .name("_scriptReadFileText")
    .length(1)
    .build();
    ctx.register_global_property(
        js_string!("_scriptReadFileText"),
        read_text,
        Attribute::all(),
    )
    .map_err(map_js_err)
    .context("register _scriptReadFileText")?;

    let write_text = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, args, _ctx| {
            let path = js_arg_string(args, 0);
            let content = js_arg_string(args, 1);
            write_file_text(&path, &content).map_err(|e| {
                boa_engine::JsError::from_opaque(JsValue::from(js_string!(e.to_string())))
            })?;
            Ok(JsValue::undefined())
        })
    })
    .name("_scriptWriteFileText")
    .length(2)
    .build();
    ctx.register_global_property(
        js_string!("_scriptWriteFileText"),
        write_text,
        Attribute::all(),
    )
    .map_err(map_js_err)
    .context("register _scriptWriteFileText")?;

    let read_bytes = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let path = js_arg_string(args, 0);
            let bytes = if path.trim().is_empty() {
                Vec::new()
            } else {
                fs::read(path).unwrap_or_default()
            };
            bytes_to_js_array(bytes, ctx)
        })
    })
    .name("_scriptReadFileBytes")
    .length(1)
    .build();
    ctx.register_global_property(
        js_string!("_scriptReadFileBytes"),
        read_bytes,
        Attribute::all(),
    )
    .map_err(map_js_err)
    .context("register _scriptReadFileBytes")?;

    let write_bytes = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let path = js_arg_string(args, 0);
            let bytes =
                js_value_to_bytes(args.get(1).cloned().unwrap_or(JsValue::undefined()), ctx)?;
            write_file_bytes(&path, &bytes).map_err(|e| {
                boa_engine::JsError::from_opaque(JsValue::from(js_string!(e.to_string())))
            })?;
            Ok(JsValue::undefined())
        })
    })
    .name("_scriptWriteFileBytes")
    .length(2)
    .build();
    ctx.register_global_property(
        js_string!("_scriptWriteFileBytes"),
        write_bytes,
        Attribute::all(),
    )
    .map_err(map_js_err)
    .context("register _scriptWriteFileBytes")?;

    let remove_path = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, args, _ctx| {
            let path = js_arg_string(args, 0);
            if !path.trim().is_empty() {
                let _ = fs::remove_file(&path).or_else(|_| fs::remove_dir_all(&path));
            }
            Ok(JsValue::undefined())
        })
    })
    .name("_scriptRemovePath")
    .length(1)
    .build();
    ctx.register_global_property(
        js_string!("_scriptRemovePath"),
        remove_path,
        Attribute::all(),
    )
    .map_err(map_js_err)
    .context("register _scriptRemovePath")?;

    let rename_path = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, args, _ctx| {
            let from = js_arg_string(args, 0);
            let to = js_arg_string(args, 1);
            if !from.trim().is_empty() && !to.trim().is_empty() {
                if let Some(parent) = PathBuf::from(&to).parent() {
                    fs::create_dir_all(parent).map_err(|e| {
                        boa_engine::JsError::from_opaque(JsValue::from(js_string!(e.to_string())))
                    })?;
                }
                fs::rename(from, to).map_err(|e| {
                    boa_engine::JsError::from_opaque(JsValue::from(js_string!(e.to_string())))
                })?;
            }
            Ok(JsValue::undefined())
        })
    })
    .name("_scriptRenamePath")
    .length(2)
    .build();
    ctx.register_global_property(
        js_string!("_scriptRenamePath"),
        rename_path,
        Attribute::all(),
    )
    .map_err(map_js_err)
    .context("register _scriptRenamePath")?;

    let reveal = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, _args, _ctx| Ok(JsValue::undefined()))
    })
    .name("_scriptRevealInFinder")
    .length(1)
    .build();
    ctx.register_global_property(
        js_string!("_scriptRevealInFinder"),
        reveal,
        Attribute::all(),
    )
    .map_err(map_js_err)
    .context("register _scriptRevealInFinder")?;

    Ok(())
}

fn register_sampler_buffer_api(ctx: &mut BoaContext, bridge: Arc<dyn CommandBridge>) -> Result<()> {
    let packet_count_bridge = bridge.clone();
    let packet_count = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, _args, _ctx| {
            let len = packet_count_bridge.get_buffer().len();
            let packets = if len == 0 { 0 } else { len.div_ceil(64) };
            Ok(JsValue::new(packets as i32))
        })
    })
    .name("_scriptSamplerBufferGetPacketCount")
    .length(0)
    .build();
    ctx.register_global_property(
        js_string!("_scriptSamplerBufferGetPacketCount"),
        packet_count,
        Attribute::all(),
    )
    .map_err(map_js_err)
    .context("register _scriptSamplerBufferGetPacketCount")?;

    let len_bridge = bridge.clone();
    let len_bytes = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, _args, _ctx| {
            Ok(JsValue::new(len_bridge.get_buffer().len() as i32))
        })
    })
    .name("_scriptSamplerBufferGetLenBytes")
    .length(0)
    .build();
    ctx.register_global_property(
        js_string!("_scriptSamplerBufferGetLenBytes"),
        len_bytes,
        Attribute::all(),
    )
    .map_err(map_js_err)
    .context("register _scriptSamplerBufferGetLenBytes")?;

    let get_bridge = bridge.clone();
    let get_bytes = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, _args, ctx| {
            bytes_to_js_array(get_bridge.get_buffer(), ctx)
        })
    })
    .name("_scriptSamplerBufferGetBytes")
    .length(0)
    .build();
    ctx.register_global_property(
        js_string!("_scriptSamplerBufferGetBytes"),
        get_bytes,
        Attribute::all(),
    )
    .map_err(map_js_err)
    .context("register _scriptSamplerBufferGetBytes")?;

    let clear_bridge = bridge.clone();
    let clear = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, _args, _ctx| {
            clear_bridge.clear_buffer();
            Ok(JsValue::undefined())
        })
    })
    .name("_scriptSamplerBufferClear")
    .length(0)
    .build();
    ctx.register_global_property(
        js_string!("_scriptSamplerBufferClear"),
        clear,
        Attribute::all(),
    )
    .map_err(map_js_err)
    .context("register _scriptSamplerBufferClear")?;

    let read_bridge = bridge.clone();
    let read_packets = FunctionObjectBuilder::new(ctx.realm(), unsafe {
        NativeFunction::from_closure(move |_this, args, ctx| {
            let packet_index = args
                .get(0)
                .and_then(|v| v.as_number())
                .unwrap_or(0.0)
                .max(0.0) as usize;
            let max_packets = args
                .get(1)
                .and_then(|v| v.as_number())
                .unwrap_or(256.0)
                .max(1.0) as usize;
            let data = read_bridge.get_buffer();
            let total_packets = if data.is_empty() {
                0
            } else {
                data.len().div_ceil(64)
            };
            let available_packets = total_packets.saturating_sub(packet_index);
            let to_read = available_packets.min(max_packets);
            let start_byte = packet_index.saturating_mul(64);
            let end_byte = data
                .len()
                .min(start_byte.saturating_add(to_read.saturating_mul(64)));
            let slice = if start_byte < end_byte {
                data[start_byte..end_byte].to_vec()
            } else {
                Vec::new()
            };
            sampler_packets_to_js_object(
                slice,
                packet_index.saturating_add(to_read),
                available_packets,
                ctx,
            )
        })
    })
    .name("_scriptSamplerBufferReadPacketsSince")
    .length(2)
    .build();
    ctx.register_global_property(
        js_string!("_scriptSamplerBufferReadPacketsSince"),
        read_packets,
        Attribute::all(),
    )
    .map_err(map_js_err)
    .context("register _scriptSamplerBufferReadPacketsSince")?;

    Ok(())
}

fn app_data_dir() -> PathBuf {
    std::env::var_os("EMWAVER_RUNTIME_APP_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("emwaver-runtime"))
}

fn js_arg_string(args: &[JsValue], index: usize) -> String {
    args.get(index)
        .and_then(|v| v.as_string())
        .map(|s| s.to_std_string().unwrap_or_default())
        .unwrap_or_default()
}

fn js_array_to_strings(value: JsValue, ctx: &mut BoaContext) -> boa_engine::JsResult<Vec<String>> {
    let Some(obj) = value.as_object().cloned() else {
        return Ok(Vec::new());
    };
    let len = obj
        .get(js_string!("length"), ctx)?
        .as_number()
        .unwrap_or(0.0) as usize;
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        let value = obj.get(i, ctx)?;
        out.push(
            value
                .as_string()
                .map(|s| s.to_std_string().unwrap_or_default())
                .unwrap_or_default(),
        );
    }
    Ok(out)
}

fn js_value_to_bytes(value: JsValue, ctx: &mut BoaContext) -> boa_engine::JsResult<Vec<u8>> {
    let Some(obj) = value.as_object().cloned() else {
        return Ok(Vec::new());
    };
    let len = obj
        .get(js_string!("length"), ctx)?
        .as_number()
        .unwrap_or(0.0) as usize;
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        let value = obj.get(i, ctx)?;
        let byte = value.as_number().unwrap_or(0.0) as i32;
        out.push((byte & 0xff) as u8);
    }
    Ok(out)
}

fn strings_to_js_array(names: Vec<String>, ctx: &mut BoaContext) -> boa_engine::JsResult<JsValue> {
    let array = JsArray::new(ctx);
    for (i, name) in names.iter().enumerate() {
        array.set(i, JsValue::from(js_string!(name.as_str())), true, ctx)?;
    }
    Ok(array.into())
}

fn bytes_to_js_array(bytes: Vec<u8>, ctx: &mut BoaContext) -> boa_engine::JsResult<JsValue> {
    let array = JsArray::new(ctx);
    for (i, byte) in bytes.iter().enumerate() {
        array.set(i, JsValue::new(*byte), true, ctx)?;
    }
    Ok(array.into())
}

fn sampler_packets_to_js_object(
    data: Vec<u8>,
    next_packet_index: usize,
    available_packets: usize,
    ctx: &mut BoaContext,
) -> boa_engine::JsResult<JsValue> {
    let data = bytes_to_js_array(data, ctx)?;
    let mut init = ObjectInitializer::new(ctx);
    init.property(js_string!("data"), data, Attribute::all());
    init.property(
        js_string!("nextPacketIndex"),
        JsValue::new(next_packet_index as i32),
        Attribute::all(),
    );
    init.property(
        js_string!("availablePackets"),
        JsValue::new(available_packets as i32),
        Attribute::all(),
    );
    Ok(init.build().into())
}

fn write_file_text(path: &str, content: &str) -> std::io::Result<()> {
    if path.trim().is_empty() {
        return Ok(());
    }
    let path = PathBuf::from(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)
}

fn write_file_bytes(path: &str, bytes: &[u8]) -> std::io::Result<()> {
    if path.trim().is_empty() {
        return Ok(());
    }
    let path = PathBuf::from(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, bytes)
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
        buffer: Mutex<Vec<u8>>,
    }

    impl RecordingBridge {
        fn new(response: Option<Vec<u8>>) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                response,
                buffer: Mutex::new(Vec::new()),
            }
        }
    }

    impl CommandBridge for RecordingBridge {
        fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>> {
            self.calls
                .lock()
                .unwrap()
                .push((cmd_lane.to_vec(), timeout_ms));
            Ok(self.response.clone())
        }

        fn get_buffer(&self) -> Vec<u8> {
            self.buffer.lock().unwrap().clone()
        }

        fn clear_buffer(&self) {
            self.buffer.lock().unwrap().clear();
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
        assert_eq!(
            tree.props.get("text").and_then(|v| v.as_str()),
            Some("hello")
        );
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

    #[test]
    fn script_errors_are_reported() {
        let bridge = Arc::new(RecordingBridge::new(None));
        let command_bridge: Arc<dyn CommandBridge> = bridge.clone();
        let engine = Engine::new("", command_bridge).expect("engine");

        let err = engine
            .run_script("throw new Error('boom');")
            .expect_err("script error");
        assert!(format!("{err:#}").contains("script eval failed"));
    }

    #[test]
    fn dispatch_ui_event_invokes_registered_callback() {
        let bridge = Arc::new(RecordingBridge::new(None));
        let command_bridge: Arc<dyn CommandBridge> = bridge.clone();
        let engine = Engine::new("", command_bridge).expect("engine");

        engine
            .run_script(
                r#"_scriptRegisterCallback("button-token", function(label) {
                    _scriptRender(JSON.stringify({
                        id: "root",
                        type: "text",
                        props: { text: label }
                    }));
                });"#,
            )
            .expect("register callback");

        engine
            .dispatch_ui_event(
                "button-token",
                vec![JsonValue::String("clicked".to_string())],
            )
            .expect("dispatch event");

        let tree = engine.latest_tree.lock().unwrap().clone().expect("tree");
        assert_eq!(tree.id, "root");
        assert_eq!(
            tree.props.get("text").and_then(|v| v.as_str()),
            Some("clicked")
        );
    }

    #[test]
    fn dispatch_ui_event_rejects_unknown_token() {
        let bridge = Arc::new(RecordingBridge::new(None));
        let command_bridge: Arc<dyn CommandBridge> = bridge.clone();
        let engine = Engine::new("", command_bridge).expect("engine");

        let err = engine
            .dispatch_ui_event("missing", vec![])
            .expect_err("unknown handler");
        assert_eq!(err.to_string(), "unknown_handler_token");
    }

    #[test]
    fn set_timeout_runs_when_pumped() {
        let bridge = Arc::new(RecordingBridge::new(None));
        let command_bridge: Arc<dyn CommandBridge> = bridge.clone();
        let engine = Engine::new("", command_bridge).expect("engine");

        engine
            .run_script(
                r#"setTimeout(function() {
                    _scriptRender(JSON.stringify({
                        id: "root",
                        type: "text",
                        props: { text: "timer" }
                    }));
                }, 0);"#,
            )
            .expect("schedule timer");

        assert_eq!(engine.pending_timeout_count(), 1);
        assert_eq!(engine.pump_due_timers(8).expect("pump timers"), 1);
        assert_eq!(engine.pending_timeout_count(), 0);

        let tree = engine.latest_tree.lock().unwrap().clone().expect("tree");
        assert_eq!(
            tree.props.get("text").and_then(|v| v.as_str()),
            Some("timer")
        );
    }

    #[test]
    fn clear_timeout_cancels_timer() {
        let bridge = Arc::new(RecordingBridge::new(None));
        let command_bridge: Arc<dyn CommandBridge> = bridge.clone();
        let engine = Engine::new("", command_bridge).expect("engine");

        engine
            .run_script(
                r#"var id = setTimeout(function() {
                    _scriptRender(JSON.stringify({ id: "root", type: "text" }));
                }, 0);
                clearTimeout(id);"#,
            )
            .expect("schedule and cancel timer");

        assert_eq!(engine.pending_timeout_count(), 0);
        assert_eq!(engine.pump_due_timers(8).expect("pump timers"), 0);
        assert!(engine.latest_tree.lock().unwrap().is_none());
    }

    #[test]
    fn bootstrap_every_reschedules_with_timer_pump() {
        let bridge = Arc::new(RecordingBridge::new(None));
        let command_bridge: Arc<dyn CommandBridge> = bridge.clone();
        let bootstrap = include_str!("../../../assets/default-scripts/script_bootstrap.emw");
        let engine = Engine::new(bootstrap, command_bridge).expect("engine");

        engine
            .run_script(
                r#"var count = 0;
                every(1, function() {
                    count += 1;
                    UI.render(UI.text({ text: String(count) }));
                });"#,
            )
            .expect("schedule every");

        assert_eq!(engine.pending_timeout_count(), 1);
        std::thread::sleep(Duration::from_millis(2));
        assert_eq!(engine.pump_due_timers(1).expect("pump first tick"), 1);
        assert_eq!(engine.pending_timeout_count(), 1);
        std::thread::sleep(Duration::from_millis(2));
        assert_eq!(engine.pump_due_timers(1).expect("pump second tick"), 1);

        let tree = engine.latest_tree.lock().unwrap().clone().expect("tree");
        assert_eq!(tree.props.get("text").and_then(|v| v.as_str()), Some("2"));
    }

    #[test]
    fn bootstrap_fs_api_reads_writes_and_renames_local_files() {
        let bridge = Arc::new(RecordingBridge::new(None));
        let command_bridge: Arc<dyn CommandBridge> = bridge.clone();
        let bootstrap = include_str!("../../../assets/default-scripts/script_bootstrap.emw");
        let engine = Engine::new(bootstrap, command_bridge).expect("engine");
        let base =
            std::env::temp_dir().join(format!("emwaver-runtime-fs-test-{}", std::process::id()));
        let base_js = base.to_string_lossy().replace('\\', "\\\\");

        engine
            .run_script(&format!(
                r#"var base = "{base_js}";
                FS.ensureDir(base);
                var a = FS.join(base, "a.txt");
                var b = FS.join(base, "nested", "b.txt");
                FS.writeText(a, "hello");
                if (FS.readText(a) !== "hello") throw new Error("readText mismatch");
                FS.rename(a, b);
                if (FS.readText(b) !== "hello") throw new Error("rename/read mismatch");
                FS.writeBytes(FS.join(base, "bytes.bin"), [1, 2, 255]);
                var bytes = FS.readBytes(FS.join(base, "bytes.bin"));
                if (bytes.length !== 3 || bytes[0] !== 1 || bytes[2] !== 255) throw new Error("bytes mismatch");
                var names = FS.readDir(base);
                if (names.indexOf("nested") < 0 || names.indexOf("bytes.bin") < 0) throw new Error("readDir mismatch");
                FS.remove(base);
                UI.render(UI.text({{ text: "fs-ok" }}));"#
            ))
            .expect("run fs script");

        let tree = engine.latest_tree.lock().unwrap().clone().expect("tree");
        assert_eq!(
            tree.props.get("text").and_then(|v| v.as_str()),
            Some("fs-ok")
        );
        assert!(!base.exists());
    }

    #[test]
    fn bootstrap_sampler_buffer_api_reads_bridge_buffer() {
        let bridge = Arc::new(RecordingBridge::new(None));
        bridge
            .buffer
            .lock()
            .unwrap()
            .extend((0..130).map(|v| (v & 0xff) as u8));
        let command_bridge: Arc<dyn CommandBridge> = bridge.clone();
        let bootstrap = include_str!("../../../assets/default-scripts/script_bootstrap.emw");
        let engine = Engine::new(bootstrap, command_bridge).expect("engine");

        engine
            .run_script(
                r#"if (Sampler.lenBytes() !== 130) throw new Error("len mismatch");
                if (Sampler.packetCount() !== 3) throw new Error("packet count mismatch");
                var all = Sampler.getBytes();
                if (all.length !== 130 || all[129] !== 129) throw new Error("getBytes mismatch");
                var chunk = Sampler.readPacketsSince({ packetIndex: 1, maxPackets: 1 });
                if (chunk.data.length !== 64 || chunk.data[0] !== 64) throw new Error("chunk mismatch");
                if (chunk.nextPacketIndex !== 2 || chunk.availablePackets !== 2) throw new Error("packet metadata mismatch");
                Sampler.clear();
                if (Sampler.lenBytes() !== 0) throw new Error("clear mismatch");
                UI.render(UI.text({ text: "sampler-ok" }));"#,
            )
            .expect("run sampler buffer script");

        let tree = engine.latest_tree.lock().unwrap().clone().expect("tree");
        assert_eq!(
            tree.props.get("text").and_then(|v| v.as_str()),
            Some("sampler-ok")
        );
    }
}
