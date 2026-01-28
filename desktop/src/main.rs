use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use std::time::Duration;

slint::include_modules!();

use anyhow::{anyhow, Result};
use emwaver_device_core::bridge::{
    create_bridge_state, dispatch_request, send_packet_command_bytes, BridgeRequest, BridgeState,
};
use emwaver_dfu::{DfuDevice, DfuOpenOptions, DEFAULT_USB_PRODUCT_ID, DEFAULT_USB_VENDOR_ID};

static BUNDLED_FIRMWARE_BYTES: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/emwaver.bin"));

#[derive(Clone)]
struct Backend {
    bridge: Arc<BridgeState>,
    next_id: Arc<AtomicU64>,
}

impl Backend {
    async fn rpc(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let req = BridgeRequest {
            id,
            method: method.to_string(),
            params,
        };
        dispatch_request(self.bridge.clone(), req).await.map_err(|e| anyhow!("{e:#}"))
    }

    async fn midi_status(&self) -> Result<(bool, Option<String>)> {
        let v = self.rpc("midi_status", serde_json::json!({})).await?;
        let connected = v.get("connected").and_then(|x| x.as_bool()).unwrap_or(false);
        let name = v
            .get("device_name")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        Ok((connected, name))
    }

    async fn midi_list_ports(&self) -> Result<Vec<String>> {
        let v = self.rpc("midi_list_ports", serde_json::json!({})).await?;
        Ok(v
            .get("ports")
            .and_then(|x| x.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default())
    }

    async fn midi_connect(&self, port_name: String) -> Result<()> {
        let _ = self
            .rpc("midi_connect", serde_json::json!({ "port_name": port_name }))
            .await?;
        Ok(())
    }

    async fn midi_disconnect(&self) -> Result<()> {
        let _ = self.rpc("midi_disconnect", serde_json::json!({})).await?;
        Ok(())
    }

    async fn buffer_clear(&self) -> Result<()> {
        let _ = self.rpc("buffer_clear", serde_json::json!({})).await?;
        Ok(())
    }
}

fn main() -> Result<(), slint::PlatformError> {
    let app = AppWindow::new()?;

    let rt = tokio::runtime::Runtime::new().expect("Failed to init tokio runtime");
    let bridge = rt
        .block_on(create_bridge_state())
        .expect("Failed to init device bridge");
    let backend = Backend {
        bridge,
        next_id: Arc::new(AtomicU64::new(1)),
    };
    let backend = Arc::new(backend);

    let update_modal_open = Arc::new(AtomicBool::new(false));
    let update_in_progress = Arc::new(AtomicBool::new(false));

    let current_path = std::rc::Rc::new(std::cell::RefCell::new(None::<PathBuf>));
    let log_text = app.global::<AppState>().get_log_text();
    if log_text.trim().is_empty() {
        app.global::<AppState>().set_log_text(
            "EMWaver native desktop (Slint)\n\n- Home: auto-connect + update\n- Editor: open/save scripts\n"
                .into(),
        );
    }

    app.global::<AppState>()
        .set_app_version(env!("CARGO_PKG_VERSION").into());
    app.global::<AppState>().set_page(0);

    // Navigation
    {
        let app_weak = app.as_weak();
        app.global::<AppState>().on_go_home(move || {
            if let Some(app) = app_weak.upgrade() {
                app.global::<AppState>().set_page(0);
            }
        });
    }
    {
        let app_weak = app.as_weak();
        app.global::<AppState>().on_go_editor(move || {
            if let Some(app) = app_weak.upgrade() {
                app.global::<AppState>().set_page(1);
            }
        });
    }

    // Open
    {
        let app_weak = app.as_weak();
        let current_path = current_path.clone();
        app.global::<AppState>().on_open_file(move || {
            let Some(app) = app_weak.upgrade() else {
                return;
            };
            let Some(file) = rfd::FileDialog::new()
                .add_filter("EMWaver scripts", &["emw"])
                .pick_file()
            else {
                return;
            };

            match fs::read_to_string(&file) {
                Ok(contents) => {
                    *current_path.borrow_mut() = Some(file.clone());
                    app.set_editor_text(contents.into());
                    app.global::<AppState>()
                        .set_current_path(display_path(&file).into());
                    append_log(&app, &format!("Opened {}\n", display_path(&file)));
                }
                Err(err) => {
                    append_log(&app, &format!("Open failed: {err}\n"));
                }
            }
        });
    }

    // Save
    {
        let app_weak = app.as_weak();
        let current_path = current_path.clone();
        app.global::<AppState>().on_save_file(move || {
            let Some(app) = app_weak.upgrade() else {
                return;
            };
            let editor_text = app.get_editor_text().to_string();

            let target = if let Some(path) = current_path.borrow().as_ref() {
                Some(path.clone())
            } else {
                rfd::FileDialog::new()
                    .add_filter("EMWaver scripts", &["emw"])
                    .set_file_name("script.emw")
                    .save_file()
            };

            let Some(target) = target else {
                return;
            };

            if let Err(err) = write_text_atomic(&target, &editor_text) {
                append_log(&app, &format!("Save failed: {err}\n"));
                return;
            }

            *current_path.borrow_mut() = Some(target.clone());
            app.global::<AppState>()
                .set_current_path(display_path(&target).into());
            append_log(&app, &format!("Saved {}\n", display_path(&target)));
        });
    }

    // Run (stub)
    {
        let app_weak = app.as_weak();
        app.global::<AppState>().on_run_script(move || {
            let Some(app) = app_weak.upgrade() else {
                return;
            };
            let len = app.get_editor_text().as_bytes().len();
            append_log(&app, &format!("Run (stub): {} bytes\n", len));
        });
    }

    // Disconnect
    {
        let app_weak = app.as_weak();
        let backend = Arc::clone(&backend);
        let handle = rt.handle().clone();
        app.global::<AppState>().on_disconnect(move || {
            let app_weak = app_weak.clone();
            let backend = Arc::clone(&backend);
            handle.spawn(async move {
                let _ = backend.midi_disconnect().await;
                let _ = backend.buffer_clear().await;
                let _ = slint::invoke_from_event_loop(move || {
                    if let Some(app) = app_weak.upgrade() {
                        app.global::<AppState>().set_connected(false);
                        app.global::<AppState>().set_device_name("".into());
                        app.global::<AppState>().set_device_version("".into());
                    }
                });
            });
        });
    }

    // Update modal open/close
    {
        let app_weak = app.as_weak();
        let update_modal_open = Arc::clone(&update_modal_open);
        let backend = Arc::clone(&backend);
        let handle = rt.handle().clone();
        app.global::<AppState>().on_open_update(move || {
            update_modal_open.store(true, Ordering::Relaxed);
            if let Some(app) = app_weak.upgrade() {
                app.global::<AppState>().set_update_error("".into());
                app.global::<AppState>().set_update_done(false);
                app.global::<AppState>().set_update_progress_pct(0);
                app.global::<AppState>().set_update_progress_message("".into());
                app.global::<AppState>().set_update_modal_open(true);
            }

            // Mirror the old behavior: disconnect MIDI so user can enter Update Mode.
            let app_weak2 = app_weak.clone();
            let backend = Arc::clone(&backend);
            handle.spawn(async move {
                let _ = backend.midi_disconnect().await;
                let _ = slint::invoke_from_event_loop(move || {
                    if let Some(app) = app_weak2.upgrade() {
                        app.global::<AppState>().set_connected(false);
                        app.global::<AppState>().set_device_name("".into());
                        app.global::<AppState>().set_device_version("".into());
                    }
                });
            });
        });
    }
    {
        let app_weak = app.as_weak();
        let update_modal_open = Arc::clone(&update_modal_open);
        let update_in_progress = Arc::clone(&update_in_progress);
        app.global::<AppState>().on_close_update(move || {
            if update_in_progress.load(Ordering::Relaxed) {
                return;
            }
            update_modal_open.store(false, Ordering::Relaxed);
            if let Some(app) = app_weak.upgrade() {
                app.global::<AppState>().set_update_modal_open(false);
            }
        });
    }

    // Start DFU flash
    {
        let app_weak = app.as_weak();
        let update_in_progress = Arc::clone(&update_in_progress);
        let handle = rt.handle().clone();
        app.global::<AppState>().on_start_update(move || {
            if update_in_progress.load(Ordering::Relaxed) {
                return;
            }

            update_in_progress.store(true, Ordering::Relaxed);
            if let Some(app) = app_weak.upgrade() {
                app.global::<AppState>().set_update_error("".into());
                app.global::<AppState>().set_update_done(false);
                app.global::<AppState>().set_update_progress_pct(0);
                app.global::<AppState>()
                    .set_update_progress_message("Opening device in Update Mode...".into());
                app.global::<AppState>().set_update_in_progress(true);
            }

            let app_weak2 = app_weak.clone();
            let update_in_progress2 = Arc::clone(&update_in_progress);
            handle.spawn(async move {
                let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

                let mut flash_task = tokio::task::spawn_blocking(move || {
                    let bytes = BUNDLED_FIRMWARE_BYTES;
                    let (mut device, _discovery) = DfuDevice::open_with_options(
                        DEFAULT_USB_VENDOR_ID,
                        DEFAULT_USB_PRODUCT_ID,
                        DfuOpenOptions {
                            alt_setting: None,
                            verbose: false,
                        },
                    )?;
                    device.flash(bytes, 0x0800_0000, move |msg| {
                        let _ = progress_tx.send(msg);
                    })?;
                    Ok::<(), String>(())
                });

                let mut last_pct: i32 = 0;
                loop {
                    tokio::select! {
                        maybe = progress_rx.recv() => {
                            let Some(msg) = maybe else { continue; };
                            if let Some(pct) = parse_pct_from_message(&msg) {
                                last_pct = last_pct.max(pct.min(100).max(0));
                            }
                            let app_weak3 = app_weak2.clone();
                            let msg2 = msg.clone();
                            let pct2 = last_pct;
                            let _ = slint::invoke_from_event_loop(move || {
                                if let Some(app) = app_weak3.upgrade() {
                                    app.global::<AppState>().set_update_progress_message(msg2.into());
                                    app.global::<AppState>().set_update_progress_pct(pct2);
                                }
                            });
                        }
                        done = &mut flash_task => {
                            let res: std::result::Result<std::result::Result<(), String>, tokio::task::JoinError> = done;
                            let final_res: std::result::Result<(), String> = match res {
                                Ok(inner) => inner,
                                Err(e) => Err(format!("DFU task failed: {e}")),
                            };
                            let app_weak3 = app_weak2.clone();
                            let _ = slint::invoke_from_event_loop(move || {
                                if let Some(app) = app_weak3.upgrade() {
                                    match final_res {
                                        Ok(()) => {
                                            app.global::<AppState>().set_update_progress_pct(100);
                                            app.global::<AppState>().set_update_progress_message("Done".into());
                                            app.global::<AppState>().set_update_done(true);
                                        }
                                        Err(err) => {
                                            app.global::<AppState>().set_update_error(err.into());
                                        }
                                    }
                                    app.global::<AppState>().set_update_in_progress(false);
                                }
                            });
                            update_in_progress2.store(false, Ordering::Relaxed);
                            break;
                        }
                    }
                }
            });
        });
    }

    // Auto-connect / status loop
    {
        let app_weak = app.as_weak();
        let backend = Arc::clone(&backend);
        let update_modal_open = Arc::clone(&update_modal_open);
        let update_in_progress = Arc::clone(&update_in_progress);
        let handle = rt.handle().clone();
        handle.spawn(async move {
            let mut last_device_name: Option<String> = None;
            loop {
                tokio::time::sleep(Duration::from_millis(900)).await;

                // Prefer run mode (MIDI) unless user is in update flow.
                let allow_midi = !update_modal_open.load(Ordering::Relaxed)
                    && !update_in_progress.load(Ordering::Relaxed);

                let (connected, name) = backend.midi_status().await.unwrap_or((false, None));
                if connected {
                    let name_str = name.clone().unwrap_or_else(|| "Device".to_string());
                    if last_device_name.as_deref() != Some(&name_str) {
                        last_device_name = Some(name_str.clone());

                        // Query version on (new) connection.
                        let v = send_packet_command_bytes(&backend.bridge, vec![0x01], 1500, 1)
                            .await
                            .ok();
                        let parsed = v.and_then(|resp| {
                            if resp.len() >= 4 && resp[0] == 0x80 {
                                Some(format!("{}.{}.{}", resp[1], resp[2], resp[3]))
                            } else {
                                None
                            }
                        });

                        let app_weak2 = app_weak.clone();
                        let _ = slint::invoke_from_event_loop(move || {
                            if let Some(app) = app_weak2.upgrade() {
                                app.global::<AppState>().set_connected(true);
                                app.global::<AppState>().set_dfu_connected(false);
                                app.global::<AppState>().set_device_name(name_str.clone().into());
                                app.global::<AppState>()
                                    .set_device_version(parsed.unwrap_or_default().into());
                            }
                        });
                    } else {
                        let app_weak2 = app_weak.clone();
                        let _ = slint::invoke_from_event_loop(move || {
                            if let Some(app) = app_weak2.upgrade() {
                                app.global::<AppState>().set_connected(true);
                                app.global::<AppState>().set_dfu_connected(false);
                                app.global::<AppState>()
                                    .set_device_name(name.unwrap_or_default().into());
                            }
                        });
                    }

                    continue;
                }

                last_device_name = None;

                if allow_midi {
                    if let Ok(ports) = backend.midi_list_ports().await {
                        if let Some(first) = ports.into_iter().next() {
                            let _ = backend.midi_connect(first.clone()).await;
                            let app_weak2 = app_weak.clone();
                            let _ = slint::invoke_from_event_loop(move || {
                                if let Some(app) = app_weak2.upgrade() {
                                    append_log(&app, "Connecting...\n");
                                }
                            });
                            continue;
                        }
                    }
                }

                // DFU detect (blocking USB call)
                let dfu_present = tokio::task::spawn_blocking(|| {
                    match DfuDevice::open_with_options(
                        DEFAULT_USB_VENDOR_ID,
                        DEFAULT_USB_PRODUCT_ID,
                        DfuOpenOptions {
                            alt_setting: None,
                            verbose: false,
                        },
                    ) {
                        Ok((_d, _discovery)) => true,
                        Err(err) if err.contains("No DFU device found") => false,
                        Err(_err) => false,
                    }
                })
                .await
                .unwrap_or(false);

                let app_weak2 = app_weak.clone();
                let _ = slint::invoke_from_event_loop(move || {
                    if let Some(app) = app_weak2.upgrade() {
                        app.global::<AppState>().set_connected(false);
                        app.global::<AppState>().set_device_name("".into());
                        app.global::<AppState>().set_device_version("".into());
                        app.global::<AppState>().set_dfu_connected(dfu_present);
                    }
                });
            }
        });
    }

    app.run()
}

fn append_log(app: &AppWindow, msg: &str) {
    let state = app.global::<AppState>();
    let mut cur = state.get_log_text().to_string();
    cur.push_str(msg);
    state.set_log_text(cur.into());
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn write_text_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    // Keep it simple: write directly. If we later care about crash-safety, we can switch
    // to temp + rename.
    fs::write(path, contents)
}

fn parse_pct_from_message(msg: &str) -> Option<i32> {
    let start = msg.find('(')?;
    let end = msg[start..].find('%')? + start;
    let num = msg[start + 1..end].trim();
    num.parse::<i32>().ok()
}
