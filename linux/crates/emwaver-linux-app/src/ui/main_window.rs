use super::mcp_server;

use adw::prelude::*;
use emwaver_linux_core::{
    default_script_template, AppModel, DeviceRecord, ScriptListItem, ScriptRepository,
    TransportKind,
};
use emwaver_linux_firmware::{
    esp32_flash::{flash_esp32_serial_with_progress, plan_bundled_esp32s3_serial},
    stm32_dfu::{flash_stm32_dfu_with_progress, is_stm32_dfu_connected, plan_bundled_stm32_dfu},
    FirmwarePlan, FirmwareTarget,
};
use emwaver_linux_runtime::{
    execute_javascript_with_modules, PacketHandler, ScriptUiNode, ScriptUiRuntime,
};
use emwaver_linux_transport::{
    ble::{BleTarget, LinuxBleManager, LinuxBleTransport},
    command::{send_command, RESPONSE_BUSY, RESPONSE_ERR, RESPONSE_OK},
    usb::{
        LinuxUsbManager, LinuxUsbMidiTransport, UsbAccessState, UsbDeviceCandidate, UsbDeviceRole,
    },
    wifi::{LinuxWifiManager, LinuxWifiTransport, ManualWifiTarget},
    EmwaverTransport,
};
use gtk::glib::object::IsA;
use gtk::glib::variant::{StaticVariantType, ToVariant};
use gtk::glib::{self, ControlFlow, Propagation};
use gtk::{gio, Align, Orientation, PolicyType};
use sourceview5::prelude::*;
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::env;
use std::rc::Rc;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone)]
struct ScriptUiSessionHandle {
    command_tx: mpsc::Sender<ScriptUiSessionCommand>,
    status_label: gtk::Label,
    busy: Cell<bool>,
}

enum ScriptUiSessionCommand {
    Invoke {
        token: String,
        arguments: Vec<serde_json::Value>,
    },
}

enum ScriptUiSessionEvent {
    Rendered { root: ScriptUiNode, status: String },
    Empty { status: String },
    Log(String),
    ActionFinished(String),
    Failed(String),
}

pub fn build_main_window(app: &adw::Application) {
    let model = Rc::new(RefCell::new(AppModel::default()));
    let script_repository = Rc::new(ScriptRepository::default());
    let mcp_snapshot = Arc::new(Mutex::new(mcp_server::McpDeviceSnapshot::from_model(
        &model.borrow(),
    )));
    let mcp_server_handle = Rc::new(RefCell::new(None::<mcp_server::McpServerHandle>));
    let mcp_last_error = Rc::new(RefCell::new(None::<String>));
    if let Err(error) =
        mcp_server::sync_from_settings(&mcp_server_handle, &script_repository, &mcp_snapshot)
    {
        *mcp_last_error.borrow_mut() = Some(error);
    }
    {
        let model = model.clone();
        let mcp_snapshot = mcp_snapshot.clone();
        glib::timeout_add_local(Duration::from_millis(500), move || {
            if let Ok(mut snapshot) = mcp_snapshot.lock() {
                *snapshot = mcp_server::McpDeviceSnapshot::from_model(&model.borrow());
            }
            ControlFlow::Continue
        });
    }
    let script_items = Rc::new(RefCell::new(Vec::<ScriptListItem>::new()));
    let script_row_indices = Rc::new(RefCell::new(Vec::<Option<usize>>::new()));
    let selected_script = Rc::new(RefCell::new(None::<ScriptListItem>));
    seed_usb_devices(&model);
    seed_ble_devices(&model);
    seed_mdns_wifi_devices(&model);
    seed_manual_wifi_device(&model);

    let window = adw::ApplicationWindow::builder()
        .application(app)
        .title("EMWaver")
        .default_width(1180)
        .default_height(680)
        .build();

    let header_title = gtk::Box::new(Orientation::Vertical, 1);
    header_title.append(
        &gtk::Label::builder()
            .label("EMWaver")
            .css_classes(vec!["heading"])
            .build(),
    );
    header_title.append(
        &gtk::Label::builder()
            .label("Scripts")
            .css_classes(vec!["dim-label"])
            .build(),
    );
    let header = adw::HeaderBar::builder()
        .title_widget(&header_title)
        .build();

    let selected_device_button = gtk::Button::builder()
        .icon_name("network-wired-symbolic")
        .tooltip_text("Select local device")
        .build();
    let selected_device_label = gtk::Label::builder()
        .label(selected_device_title(&model.borrow().selected_device()))
        .ellipsize(gtk::pango::EllipsizeMode::End)
        .xalign(0.0)
        .build();
    let selected_device_box = gtk::Box::new(Orientation::Horizontal, 6);
    selected_device_box.append(&selected_device_button);
    selected_device_box.append(&selected_device_label);
    header.pack_start(&selected_device_box);

    let firmware_button = gtk::Button::builder()
        .icon_name("software-update-available-symbolic")
        .tooltip_text("Firmware")
        .build();
    let mcp_button = gtk::Button::builder()
        .icon_name("network-server-symbolic")
        .tooltip_text("Desktop MCP")
        .build();
    let settings_button = gtk::Button::builder()
        .icon_name("emblem-system-symbolic")
        .tooltip_text("Settings")
        .build();
    header.pack_end(&settings_button);
    header.pack_end(&mcp_button);
    header.pack_end(&firmware_button);

    let source_buffer = make_source_buffer();
    let editor = sourceview5::View::builder()
        .buffer(&source_buffer)
        .show_line_numbers(true)
        .highlight_current_line(true)
        .auto_indent(true)
        .insert_spaces_instead_of_tabs(true)
        .tab_width(4)
        .smart_backspace(true)
        .top_margin(12)
        .bottom_margin(12)
        .left_margin(12)
        .right_margin(12)
        .wrap_mode(gtk::WrapMode::None)
        .build();
    editor.add_css_class("monospace");
    let editor_scroll = gtk::ScrolledWindow::builder()
        .hexpand(true)
        .vexpand(true)
        .hscrollbar_policy(PolicyType::Automatic)
        .vscrollbar_policy(PolicyType::Automatic)
        .child(&editor)
        .build();
    let preview_root = gtk::Box::new(Orientation::Vertical, 12);
    preview_root.set_margin_top(16);
    preview_root.set_margin_bottom(16);
    preview_root.set_margin_start(16);
    preview_root.set_margin_end(16);
    preview_root.append(&runtime_status_label(
        "Run a script to see its runtime output here.",
    ));
    let preview_session = Rc::new(RefCell::new(None::<Rc<ScriptUiSessionHandle>>));
    let preview_scroll = gtk::ScrolledWindow::builder()
        .hexpand(true)
        .vexpand(true)
        .hscrollbar_policy(PolicyType::Automatic)
        .vscrollbar_policy(PolicyType::Automatic)
        .child(&preview_root)
        .build();
    let editor_stack = gtk::Stack::builder()
        .hexpand(true)
        .vexpand(true)
        .transition_type(gtk::StackTransitionType::Crossfade)
        .build();
    editor_stack.add_named(&editor_scroll, Some("editor"));
    editor_stack.add_named(&preview_scroll, Some("preview"));
    editor_stack.set_visible_child_name("preview");
    let script_title = gtk::Label::builder()
        .label("No Script")
        .xalign(0.0)
        .ellipsize(gtk::pango::EllipsizeMode::End)
        .css_classes(vec!["heading"])
        .build();
    let script_kind = gtk::Label::builder()
        .label("JavaScript")
        .xalign(0.0)
        .css_classes(vec!["dim-label"])
        .build();
    let read_only_notice = gtk::Label::builder()
        .label("Bundled scripts, libraries, and kernel files are read-only. Use Make Copy to edit a local version.")
        .wrap(true)
        .xalign(0.0)
        .css_classes(vec!["dim-label"])
        .visible(false)
        .build();
    let search_entry = gtk::SearchEntry::builder()
        .placeholder_text("Find in script")
        .hexpand(true)
        .visible(false)
        .build();
    let find_button = gtk::Button::builder()
        .icon_name("edit-find-symbolic")
        .tooltip_text("Find")
        .build();
    let go_to_line_button = gtk::Button::builder()
        .icon_name("go-jump-symbolic")
        .tooltip_text("Go to line")
        .build();
    let line_wrap_button = gtk::ToggleButton::builder()
        .icon_name("format-justify-fill-symbolic")
        .tooltip_text("Toggle line wrap")
        .build();
    let preview_button = gtk::ToggleButton::builder()
        .icon_name("view-reveal-symbolic")
        .tooltip_text("Toggle runtime output")
        .active(true)
        .build();

    let log_view = gtk::TextView::builder()
        .editable(false)
        .cursor_visible(false)
        .top_margin(10)
        .bottom_margin(10)
        .left_margin(10)
        .right_margin(10)
        .build();
    log_view.add_css_class("monospace");
    log_view.buffer().set_text(
        "Local scripts run immediately. Select a local device to run hardware scripts.\n",
    );
    let run_log_visible = load_run_log_visible();
    let log_scroll = gtk::ScrolledWindow::builder()
        .hexpand(true)
        .vexpand(false)
        .min_content_height(150)
        .max_content_height(180)
        .hscrollbar_policy(PolicyType::Automatic)
        .vscrollbar_policy(PolicyType::Automatic)
        .child(&log_view)
        .build();
    let run_log_expander = gtk::Expander::builder()
        .label("Run Log")
        .expanded(run_log_visible)
        .visible(run_log_visible)
        .child(&log_scroll)
        .build();

    let script_list = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::Single)
        .css_classes(vec!["boxed-list"])
        .build();
    let script_search_entry = gtk::SearchEntry::builder()
        .placeholder_text("Search scripts")
        .hexpand(true)
        .build();

    let library = gtk::Box::new(Orientation::Vertical, 10);
    library.set_vexpand(true);
    library.set_margin_top(12);
    library.set_margin_bottom(12);
    library.set_margin_start(12);
    library.set_margin_end(12);
    let script_list_scroll = gtk::ScrolledWindow::builder()
        .hexpand(true)
        .vexpand(true)
        .hscrollbar_policy(PolicyType::Never)
        .vscrollbar_policy(PolicyType::Automatic)
        .child(&script_list)
        .build();

    library.append(&section_label("Scripts"));
    library.append(&script_search_entry);
    library.append(&script_list_scroll);

    let new_script_button = gtk::Button::builder()
        .icon_name("document-new-symbolic")
        .tooltip_text("New script")
        .halign(Align::Start)
        .build();
    let copy_script_button = gtk::Button::builder()
        .icon_name("edit-copy-symbolic")
        .tooltip_text("Make editable copy")
        .halign(Align::Start)
        .build();
    let save_script_button = gtk::Button::builder()
        .icon_name("document-save-symbolic")
        .tooltip_text("Save script")
        .halign(Align::Start)
        .build();
    let script_actions = gtk::Box::new(Orientation::Horizontal, 8);
    script_actions.append(&new_script_button);
    script_actions.append(&copy_script_button);
    script_actions.append(&save_script_button);
    library.append(&script_actions);

    let content = gtk::Paned::new(Orientation::Horizontal);
    content.set_vexpand(true);
    content.set_start_child(Some(&library));
    content.set_resize_start_child(false);
    content.set_shrink_start_child(false);

    let main_stack = gtk::Box::new(Orientation::Vertical, 10);
    main_stack.set_margin_top(12);
    main_stack.set_margin_bottom(12);
    main_stack.set_margin_start(12);
    main_stack.set_margin_end(12);
    main_stack.append(&editor_toolbar(
        &script_title,
        &script_kind,
        &find_button,
        &go_to_line_button,
        &line_wrap_button,
        &preview_button,
    ));
    main_stack.append(&search_entry);
    main_stack.append(&read_only_notice);
    main_stack.append(&editor_stack);
    main_stack.append(&run_log_expander);

    content.set_end_child(Some(&main_stack));

    let root = gtk::Box::new(Orientation::Vertical, 0);
    root.append(&header);
    root.append(&content);
    window.set_content(Some(&root));

    let active_session = Rc::new(RefCell::new(None));
    let active_script_id = Rc::new(RefCell::new(None::<String>));
    {
        let script_repository = Rc::clone(&script_repository);
        let script_items = Rc::clone(&script_items);
        let script_row_indices = Rc::clone(&script_row_indices);
        let script_list = script_list.clone();
        let script_search_entry = script_search_entry.clone();
        let model = Rc::clone(&model);
        let log_view = log_view.clone();
        let active_session = Rc::clone(&active_session);
        let active_script_id = Rc::clone(&active_script_id);
        let editor_stack = editor_stack.clone();
        let preview_root = preview_root.clone();
        let preview_session = Rc::clone(&preview_session);
        let preview_button = preview_button.clone();
        let action = gio::SimpleAction::new("script-run", Some(&String::static_variant_type()));
        action.connect_activate(move |_, parameter| {
            let Some(script_id) = parameter.and_then(|value| value.get::<String>()) else {
                append_log(&log_view, "No script was provided to run.");
                return;
            };
            select_script_by_id(&script_list, &script_items, &script_row_indices, &script_id);
            let item = script_repository
                .list_scripts()
                .ok()
                .and_then(|scripts| scripts.into_iter().find(|script| script.id == script_id));
            let Some(item) = item else {
                append_log(&log_view, "Script is no longer available.");
                return;
            };
            if !item.is_runnable() {
                append_log(&log_view, &format!("{} is not runnable.", item.name));
                return;
            }
            let source = match script_repository.read_script(&item) {
                Ok(source) => source,
                Err(err) => {
                    append_log(&log_view, &format!("Script load failed: {err}"));
                    return;
                }
            };
            let module_sources = match script_repository.module_sources() {
                Ok(modules) => modules,
                Err(err) => {
                    append_log(&log_view, &format!("Module load failed: {err}"));
                    BTreeMap::new()
                }
            };
            render_source_preview(
                &preview_root,
                &preview_session,
                &log_view,
                &model.borrow().selected_device(),
                &item.name,
                &source,
                &module_sources,
            );
            editor_stack.set_visible_child_name("preview");
            preview_button.set_active(true);
            if active_script_id.borrow().as_deref() == Some(item.id.as_str()) {
                append_log(
                    &log_view,
                    &format!("Restored running script {}.", item.name),
                );
                return;
            }
            let result = model.borrow_mut().run_script(&item.name, source.clone());
            match result {
                Ok(session) => {
                    *active_session.borrow_mut() = Some(session.id);
                    *active_script_id.borrow_mut() = Some(item.id.clone());
                    refresh_script_list(
                        &script_list,
                        &script_repository,
                        &script_items,
                        &script_row_indices,
                        &log_view,
                        script_search_entry.text().as_str(),
                        active_script_id.borrow().as_deref(),
                    );
                    drain_pending_ui_events();
                    append_log(
                        &log_view,
                        &format!(
                            "Started {} on {}.",
                            item.name,
                            selected_device_title(&model.borrow().selected_device())
                        ),
                    );
                    for line in run_selected_script(
                        &model.borrow().selected_device(),
                        &source,
                        &module_sources,
                    ) {
                        append_log(&log_view, &line);
                    }
                    match model.borrow_mut().stop_script(session.id) {
                        Ok(_) => append_log(&log_view, "Script session completed."),
                        Err(err) => {
                            append_log(&log_view, &format!("Session cleanup failed: {err}"))
                        }
                    }
                    *active_session.borrow_mut() = None;
                    *active_script_id.borrow_mut() = None;
                    refresh_script_list(
                        &script_list,
                        &script_repository,
                        &script_items,
                        &script_row_indices,
                        &log_view,
                        script_search_entry.text().as_str(),
                        active_script_id.borrow().as_deref(),
                    );
                }
                Err(err) => append_log(&log_view, &format!("Run failed: {err}")),
            }
        });
        window.add_action(&action);
    }
    {
        let script_items = Rc::clone(&script_items);
        let script_row_indices = Rc::clone(&script_row_indices);
        let script_list = script_list.clone();
        let editor_stack = editor_stack.clone();
        let preview_button = preview_button.clone();
        let action = gio::SimpleAction::new("script-edit", Some(&String::static_variant_type()));
        action.connect_activate(move |_, parameter| {
            let Some(script_id) = parameter.and_then(|value| value.get::<String>()) else {
                return;
            };
            preview_button.set_active(false);
            editor_stack.set_visible_child_name("editor");
            select_script_by_id(&script_list, &script_items, &script_row_indices, &script_id);
        });
        window.add_action(&action);
    }
    {
        let script_repository = Rc::clone(&script_repository);
        let script_items = Rc::clone(&script_items);
        let script_row_indices = Rc::clone(&script_row_indices);
        let script_list = script_list.clone();
        let script_search_entry = script_search_entry.clone();
        let model = Rc::clone(&model);
        let log_view = log_view.clone();
        let active_session = Rc::clone(&active_session);
        let active_script_id = Rc::clone(&active_script_id);
        let action = gio::SimpleAction::new("script-stop", Some(&String::static_variant_type()));
        action.connect_activate(move |_, parameter| {
            let Some(script_id) = parameter.and_then(|value| value.get::<String>()) else {
                return;
            };
            if active_script_id.borrow().as_deref() != Some(script_id.as_str()) {
                append_log(&log_view, "That script is not the active session.");
                return;
            }
            let Some(session_id) = active_session.borrow_mut().take() else {
                append_log(&log_view, "No active script session.");
                *active_script_id.borrow_mut() = None;
                return;
            };
            match model.borrow_mut().stop_script(session_id) {
                Ok(_) => append_log(&log_view, "Stopped script session."),
                Err(err) => append_log(&log_view, &format!("Stop failed: {err}")),
            }
            *active_script_id.borrow_mut() = None;
            refresh_script_list(
                &script_list,
                &script_repository,
                &script_items,
                &script_row_indices,
                &log_view,
                script_search_entry.text().as_str(),
                active_script_id.borrow().as_deref(),
            );
        });
        window.add_action(&action);
    }
    {
        let script_repository = Rc::clone(&script_repository);
        let script_items = Rc::clone(&script_items);
        let script_row_indices = Rc::clone(&script_row_indices);
        let selected_script = Rc::clone(&selected_script);
        let editor = editor.clone();
        let source_buffer = source_buffer.clone();
        let script_title = script_title.clone();
        let script_kind = script_kind.clone();
        let read_only_notice = read_only_notice.clone();
        let save_script_button = save_script_button.clone();
        script_list.connect_row_selected(move |_, row| {
            let Some(row) = row else { return };
            let script_index = {
                let rows = script_row_indices.borrow();
                rows.get(row.index() as usize).copied().flatten()
            };
            let Some(script_index) = script_index else {
                return;
            };
            let item = {
                let items = script_items.borrow();
                items.get(script_index).cloned()
            };
            let Some(item) = item else {
                return;
            };
            match script_repository.read_script(&item) {
                Ok(source) => {
                    source_buffer.set_text(&source);
                    editor.set_editable(item.is_editable());
                    read_only_notice.set_visible(!item.is_editable());
                    script_title.set_label(&item.name);
                    script_kind.set_label(&format!(
                        "{} · {}",
                        item.kind_label(),
                        item.kind_detail()
                    ));
                    save_script_button.set_sensitive(item.is_editable());
                    *selected_script.borrow_mut() = Some(item);
                }
                Err(err) => {
                    script_title.set_label("Script Load Failed");
                    script_kind.set_label(&err.to_string());
                    save_script_button.set_sensitive(false);
                }
            }
        });
    }
    refresh_script_list(
        &script_list,
        &script_repository,
        &script_items,
        &script_row_indices,
        &log_view,
        script_search_entry.text().as_str(),
        active_script_id.borrow().as_deref(),
    );
    script_list.select_row(first_script_row(&script_list, &script_row_indices).as_ref());
    {
        let script_repository = Rc::clone(&script_repository);
        let script_items = Rc::clone(&script_items);
        let script_row_indices = Rc::clone(&script_row_indices);
        let script_list = script_list.clone();
        let selected_script = Rc::clone(&selected_script);
        let source_buffer = source_buffer.clone();
        let log_view = log_view.clone();
        let script_search_entry = script_search_entry.clone();
        let active_script_id = Rc::clone(&active_script_id);
        new_script_button.connect_clicked(move |_| {
            match script_repository.create_script("script.emw", default_script_template()) {
                Ok(item) => {
                    append_log(&log_view, &format!("Created local script {}.", item.name));
                    refresh_script_list(
                        &script_list,
                        &script_repository,
                        &script_items,
                        &script_row_indices,
                        &log_view,
                        script_search_entry.text().as_str(),
                        active_script_id.borrow().as_deref(),
                    );
                    select_script_by_id(&script_list, &script_items, &script_row_indices, &item.id);
                    source_buffer.set_text(default_script_template());
                    *selected_script.borrow_mut() = Some(item);
                }
                Err(err) => append_log(&log_view, &format!("New script failed: {err}")),
            }
        });
    }
    {
        let script_repository = Rc::clone(&script_repository);
        let script_items = Rc::clone(&script_items);
        let script_row_indices = Rc::clone(&script_row_indices);
        let script_list = script_list.clone();
        let selected_script = Rc::clone(&selected_script);
        let log_view = log_view.clone();
        let script_search_entry = script_search_entry.clone();
        let active_script_id = Rc::clone(&active_script_id);
        copy_script_button.connect_clicked(move |_| {
            let Some(item) = selected_script.borrow().clone() else {
                append_log(&log_view, "No selected script to copy.");
                return;
            };
            match script_repository.copy_to_local(&item) {
                Ok(copy) => {
                    append_log(
                        &log_view,
                        &format!("Copied {} to {}.", item.name, copy.name),
                    );
                    refresh_script_list(
                        &script_list,
                        &script_repository,
                        &script_items,
                        &script_row_indices,
                        &log_view,
                        script_search_entry.text().as_str(),
                        active_script_id.borrow().as_deref(),
                    );
                    select_script_by_id(&script_list, &script_items, &script_row_indices, &copy.id);
                }
                Err(err) => append_log(&log_view, &format!("Copy failed: {err}")),
            }
        });
    }
    {
        let script_repository = Rc::clone(&script_repository);
        let selected_script = Rc::clone(&selected_script);
        let source_buffer = source_buffer.clone();
        let log_view = log_view.clone();
        save_script_button.connect_clicked(move |_| {
            let Some(item) = selected_script.borrow().clone() else {
                append_log(&log_view, "No selected script to save.");
                return;
            };
            let source = source_buffer
                .text(&source_buffer.start_iter(), &source_buffer.end_iter(), true)
                .to_string();
            match script_repository.save_script(&item, &source) {
                Ok(()) => append_log(&log_view, &format!("Saved {}.", item.name)),
                Err(err) => append_log(&log_view, &format!("Save failed: {err}")),
            }
        });
    }
    {
        let script_repository = Rc::clone(&script_repository);
        let script_items = Rc::clone(&script_items);
        let script_row_indices = Rc::clone(&script_row_indices);
        let script_list = script_list.clone();
        let log_view = log_view.clone();
        let active_script_id = Rc::clone(&active_script_id);
        script_search_entry.connect_search_changed(move |entry| {
            refresh_script_list(
                &script_list,
                &script_repository,
                &script_items,
                &script_row_indices,
                &log_view,
                entry.text().as_str(),
                active_script_id.borrow().as_deref(),
            );
            script_list.select_row(first_script_row(&script_list, &script_row_indices).as_ref());
        });
    }
    {
        let search_entry = search_entry.clone();
        find_button.connect_clicked(move |_| {
            search_entry.set_visible(!search_entry.is_visible());
            if search_entry.is_visible() {
                search_entry.grab_focus();
            }
        });
    }
    {
        let source_buffer = source_buffer.clone();
        search_entry.connect_search_changed(move |entry| {
            select_first_match(&source_buffer, entry.text().as_str());
        });
    }
    {
        let window = window.clone();
        let editor = editor.clone();
        let source_buffer = source_buffer.clone();
        go_to_line_button.connect_clicked(move |_| {
            present_go_to_line_dialog(&window, &editor, &source_buffer);
        });
    }
    {
        let editor = editor.clone();
        line_wrap_button.connect_toggled(move |button| {
            editor.set_wrap_mode(if button.is_active() {
                gtk::WrapMode::WordChar
            } else {
                gtk::WrapMode::None
            });
        });
    }
    {
        let editor_stack = editor_stack.clone();
        let preview_root = preview_root.clone();
        let preview_session = Rc::clone(&preview_session);
        let selected_script = Rc::clone(&selected_script);
        let source_buffer = source_buffer.clone();
        let script_repository = Rc::clone(&script_repository);
        let model = Rc::clone(&model);
        preview_button.connect_toggled(move |button| {
            if button.is_active() {
                let name = selected_script
                    .borrow()
                    .as_ref()
                    .map(|script| script.name.clone())
                    .unwrap_or_else(|| "No script".to_string());
                let source = source_buffer
                    .text(&source_buffer.start_iter(), &source_buffer.end_iter(), true)
                    .to_string();
                clear_preview_session(&preview_session);
                match script_repository.module_sources() {
                    Ok(modules) => {
                        render_source_preview(
                            &preview_root,
                            &preview_session,
                            &log_view,
                            &model.borrow().selected_device(),
                            &name,
                            &source,
                            &modules,
                        );
                    }
                    Err(err) => {
                        preview_root
                            .append(&runtime_status_label(&format!("Module load failed: {err}")));
                    }
                }
                editor_stack.set_visible_child_name("preview");
            } else {
                clear_preview_session(&preview_session);
                editor_stack.set_visible_child_name("editor");
            }
        });
    }
    {
        let window = window.clone();
        let model = Rc::clone(&model);
        selected_device_button.connect_clicked(move |_| {
            present_device_dialog(&window, &model.borrow().devices());
        });
    }
    {
        let window = window.clone();
        let model = Rc::clone(&model);
        firmware_button.connect_clicked(move |_| {
            present_firmware_dialog(&window, model.borrow().selected_device());
        });
    }
    {
        run_log_expander.connect_expanded_notify(|expander| {
            let _ = save_run_log_visible(expander.is_expanded());
        });
    }
    {
        let window = window.clone();
        let run_log_expander = run_log_expander.clone();
        let script_repository = script_repository.clone();
        let mcp_snapshot = mcp_snapshot.clone();
        let mcp_server_handle = mcp_server_handle.clone();
        let mcp_last_error = mcp_last_error.clone();
        settings_button.connect_clicked(move |_| {
            present_settings_dialog(
                &window,
                &run_log_expander,
                &script_repository,
                &mcp_snapshot,
                &mcp_server_handle,
                &mcp_last_error,
            );
        });
    }
    {
        let window = window.clone();
        let run_log_expander = run_log_expander.clone();
        let script_repository = script_repository.clone();
        let mcp_snapshot = mcp_snapshot.clone();
        let mcp_server_handle = mcp_server_handle.clone();
        let mcp_last_error = mcp_last_error.clone();
        mcp_button.connect_clicked(move |_| {
            present_settings_dialog(
                &window,
                &run_log_expander,
                &script_repository,
                &mcp_snapshot,
                &mcp_server_handle,
                &mcp_last_error,
            );
        });
    }
    add_shortcuts(app, &window);
    window.present();
}

fn script_packet_handler(
    device: Option<DeviceRecord>,
    log_tx: mpsc::Sender<ScriptUiSessionEvent>,
) -> PacketHandler {
    let mut bridge = ScriptPacketBridge::new(device, log_tx);
    Box::new(move |packet, timeout_ms| bridge.send(&packet, timeout_ms))
}

struct ScriptPacketBridge {
    device: Option<DeviceRecord>,
    log_tx: mpsc::Sender<ScriptUiSessionEvent>,
    runtime: Option<tokio::runtime::Runtime>,
    transport: Option<Box<dyn EmwaverTransport>>,
    transport_session_source: Option<u8>,
    last_transport_session_heartbeat: Option<Instant>,
}

const EMW_OP_TRANSPORT_SESSION: u8 = 0x0B;
const EMW_TRANSPORT_SESSION_CONNECT: u8 = 0x01;
const EMW_TRANSPORT_SESSION_DISCONNECT: u8 = 0x02;
const EMW_TRANSPORT_SESSION_HEARTBEAT: u8 = 0x03;
const EMW_COMMAND_SOURCE_BLE: u8 = 0x02;
const EMW_COMMAND_SOURCE_WIFI: u8 = 0x03;
const TRANSPORT_SESSION_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(2);

impl ScriptPacketBridge {
    fn new(device: Option<DeviceRecord>, log_tx: mpsc::Sender<ScriptUiSessionEvent>) -> Self {
        Self {
            device,
            log_tx,
            runtime: None,
            transport: None,
            transport_session_source: None,
            last_transport_session_heartbeat: None,
        }
    }

    fn log(&self, line: impl Into<String>) {
        let _ = self.log_tx.send(ScriptUiSessionEvent::Log(line.into()));
    }

    fn send(&mut self, packet: &[u8], timeout_ms: u32) -> Result<Vec<u8>, String> {
        self.ensure_connected()?;
        let device = self
            .device
            .as_ref()
            .ok_or_else(|| "No selected device for script packet send.".to_string())?;
        let transport_name = transport_label(&device.transport);
        let opcode = packet.first().copied().unwrap_or(0);
        let timeout_ms = timeout_ms.max(1);
        self.log(format!(
            "TX {transport_name} opcode=0x{opcode:02X} timeout={timeout_ms}ms bytes={}",
            hex_bytes(packet, 18)
        ));
        self.send_transport_session_heartbeat_if_due()?;
        let runtime = self
            .runtime
            .as_ref()
            .ok_or_else(|| "Script packet runtime is not available.".to_string())?;
        let transport = self
            .transport
            .as_mut()
            .ok_or_else(|| "Script packet transport is not available.".to_string())?;
        let result = runtime.block_on(async {
            tokio::time::timeout(
                Duration::from_millis(timeout_ms as u64),
                send_command(transport.as_mut(), packet),
            )
            .await
        });
        match result {
            Ok(Ok(response)) => {
                self.log(format!(
                    "RX {transport_name} opcode=0x{opcode:02X} bytes={}",
                    hex_bytes(&response, 18)
                ));
                Ok(response)
            }
            Ok(Err(err)) => {
                let message = format!("Device command failed: {err}");
                self.log(format!(
                    "ERR {transport_name} opcode=0x{opcode:02X} {message}"
                ));
                Err(message)
            }
            Err(_) => {
                let message = format!(
                    "Device command timed out waiting for a board response (opcode 0x{opcode:02X}, timeout {timeout_ms}ms)."
                );
                self.log(format!(
                    "TIMEOUT {transport_name} opcode=0x{opcode:02X} after {timeout_ms}ms"
                ));
                Err(message)
            }
        }
    }

    fn send_transport_session_command(
        &mut self,
        subcommand: u8,
        source: u8,
        timeout_ms: u64,
    ) -> Result<Vec<u8>, String> {
        let runtime = self
            .runtime
            .as_ref()
            .ok_or_else(|| "Script packet runtime is not available.".to_string())?;
        let transport = self
            .transport
            .as_mut()
            .ok_or_else(|| "Script packet transport is not available.".to_string())?;
        let command = [EMW_OP_TRANSPORT_SESSION, subcommand, source];
        runtime
            .block_on(async {
                tokio::time::timeout(
                    Duration::from_millis(timeout_ms),
                    send_command(transport.as_mut(), &command),
                )
                .await
            })
            .map_err(|_| "Transport session command timed out.".to_string())?
            .map_err(|err| format!("Transport session command failed: {err}"))
    }

    fn begin_transport_session_if_required(&mut self) -> Result<(), String> {
        let source = match self.device.as_ref().map(|device| &device.transport) {
            Some(TransportKind::Ble) => EMW_COMMAND_SOURCE_BLE,
            Some(TransportKind::Wifi) => EMW_COMMAND_SOURCE_WIFI,
            _ => return Ok(()),
        };
        self.log(format!(
            "SESSION CONNECT {} source=0x{source:02X}",
            self.device
                .as_ref()
                .map(|device| transport_label(&device.transport))
                .unwrap_or("DEVICE")
        ));
        let response =
            self.send_transport_session_command(EMW_TRANSPORT_SESSION_CONNECT, source, 1500)?;
        match response.first().copied() {
            Some(RESPONSE_OK) => {
                self.transport_session_source = Some(source);
                self.last_transport_session_heartbeat = Some(Instant::now());
                self.log("SESSION CONNECTED");
                Ok(())
            }
            Some(RESPONSE_BUSY) => {
                Err("Device is busy with another transport session.".to_string())
            }
            Some(RESPONSE_ERR) => Err("Device rejected the transport session command.".to_string()),
            Some(status) => Err(format!(
                "Device returned unexpected transport session status 0x{status:02X}."
            )),
            None => Err("Device returned an empty transport session response.".to_string()),
        }
    }

    fn send_transport_session_heartbeat_if_due(&mut self) -> Result<(), String> {
        let Some(source) = self.transport_session_source else {
            return Ok(());
        };
        if self
            .last_transport_session_heartbeat
            .map(|instant| instant.elapsed() < TRANSPORT_SESSION_HEARTBEAT_INTERVAL)
            .unwrap_or(false)
        {
            return Ok(());
        }
        let response =
            self.send_transport_session_command(EMW_TRANSPORT_SESSION_HEARTBEAT, source, 1000)?;
        if response.first().copied() == Some(RESPONSE_OK) {
            self.last_transport_session_heartbeat = Some(Instant::now());
            Ok(())
        } else {
            Err("Transport session heartbeat was rejected by the device.".to_string())
        }
    }

    fn end_transport_session(&mut self) {
        let Some(source) = self.transport_session_source.take() else {
            return;
        };
        let _ = self.send_transport_session_command(EMW_TRANSPORT_SESSION_DISCONNECT, source, 1000);
    }

    fn ensure_connected(&mut self) -> Result<(), String> {
        if self.transport.is_some() {
            return Ok(());
        }
        let device = self
            .device
            .as_ref()
            .ok_or_else(|| "No selected device for script packet send.".to_string())?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|err| format!("Failed to create script packet runtime: {err}"))?;
        self.log(format!(
            "CONNECT {} {}",
            transport_label(&device.transport),
            device.display_name
        ));
        let mut transport: Box<dyn EmwaverTransport> = match device.transport {
            TransportKind::Simulator => {
                return Err("Simulator is an internal test transport and is not available in the Linux app UI.".to_string());
            }
            TransportKind::UsbMidi => {
                let candidate = LinuxUsbManager::default()
                    .discover()
                    .map_err(|err| format!("USB discovery failed: {err}"))?
                    .into_iter()
                    .find(|candidate| candidate.id == device.id)
                    .ok_or_else(|| format!("USB device {} is no longer present.", device.id))?;
                Box::new(
                    LinuxUsbMidiTransport::new(candidate)
                        .map_err(|err| format!("USB transport setup failed: {err}"))?,
                )
            }
            TransportKind::Wifi => Box::new(LinuxWifiTransport::new(
                manual_wifi_target_from_device(device)?,
            )),
            TransportKind::Ble => Box::new(LinuxBleTransport::new(ble_target_from_device(device)?)),
            _ => {
                return Err(format!(
                    "{:?} script packet transport is not implemented yet.",
                    device.transport
                ));
            }
        };
        if let Err(err) = runtime.block_on(transport.connect()) {
            let message = format!("Device connect failed: {err}");
            self.log(format!(
                "CONNECT FAILED {} {}",
                transport_label(&device.transport),
                message
            ));
            return Err(message);
        }
        self.log(format!("CONNECTED {}", transport_label(&device.transport)));
        self.runtime = Some(runtime);
        self.transport = Some(transport);
        if let Err(err) = self.begin_transport_session_if_required() {
            self.transport = None;
            self.runtime = None;
            return Err(err);
        }
        Ok(())
    }
}

fn hex_bytes(bytes: &[u8], max: usize) -> String {
    if bytes.is_empty() {
        return "<empty>".to_string();
    }
    let take = bytes.len().min(max);
    let mut text = bytes
        .iter()
        .take(take)
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ");
    if bytes.len() > take {
        text.push_str(&format!(" … (+{})", bytes.len() - take));
    }
    text
}

impl Drop for ScriptPacketBridge {
    fn drop(&mut self) {
        self.end_transport_session();
        if let (Some(runtime), Some(mut transport)) = (self.runtime.as_ref(), self.transport.take())
        {
            let _ = runtime.block_on(transport.close());
        }
    }
}

fn run_selected_script(
    device: &Option<DeviceRecord>,
    source: &str,
    module_sources: &BTreeMap<String, String>,
) -> Vec<String> {
    let Some(device) = device else {
        return vec!["No selected device.".to_string()];
    };
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        return vec!["Failed to create script runtime.".to_string()];
    };

    match device.transport {
        TransportKind::Simulator => vec![
            "Simulator is an internal test transport and is not available in the Linux app UI."
                .to_string(),
        ],
        TransportKind::UsbMidi => runtime.block_on(async {
            let candidate = match LinuxUsbManager::default().discover() {
                Ok(candidates) => candidates
                    .into_iter()
                    .find(|candidate| candidate.id == device.id),
                Err(err) => return vec![format!("USB discovery failed: {err}")],
            };
            let Some(candidate) = candidate else {
                return vec![format!("USB device {} is no longer present.", device.id)];
            };
            let mut transport = match LinuxUsbMidiTransport::new(candidate) {
                Ok(transport) => transport,
                Err(err) => return vec![format!("USB transport setup failed: {err}")],
            };
            if let Err(err) = transport.connect().await {
                return vec![format!("USB connect failed: {err}")];
            }
            let result =
                execute_javascript_with_modules(source, module_sources, &mut transport).await;
            let _ = transport.close().await;
            match result {
                Ok(report) => report.log,
                Err(err) => vec![format!("Script failed: {err}")],
            }
        }),
        TransportKind::Wifi => runtime.block_on(async {
            let target = match manual_wifi_target_from_device(device) {
                Ok(target) => target,
                Err(err) => return vec![err],
            };
            let mut transport = LinuxWifiTransport::new(target);
            if let Err(err) = transport.connect().await {
                return vec![format!("Wi-Fi connect failed: {err}")];
            }
            let result =
                execute_javascript_with_modules(source, module_sources, &mut transport).await;
            let _ = transport.close().await;
            match result {
                Ok(report) => report.log,
                Err(err) => vec![format!("Script failed: {err}")],
            }
        }),
        TransportKind::Ble => runtime.block_on(async {
            let target = match ble_target_from_device(device) {
                Ok(target) => target,
                Err(err) => return vec![err],
            };
            let mut transport = LinuxBleTransport::new(target);
            if let Err(err) = transport.connect().await {
                return vec![format!("BLE connect failed: {err}")];
            }
            let result =
                execute_javascript_with_modules(source, module_sources, &mut transport).await;
            let _ = transport.close().await;
            match result {
                Ok(report) => report.log,
                Err(err) => vec![format!("Script failed: {err}")],
            }
        }),
        _ => vec![format!(
            "{:?} script execution is not implemented yet.",
            device.transport
        )],
    }
}

fn seed_manual_wifi_device(model: &Rc<RefCell<AppModel>>) {
    let Ok(host) = env::var("EMWAVER_WIFI_HOST") else {
        return;
    };
    let port = env::var("EMWAVER_WIFI_PORT")
        .ok()
        .and_then(|raw| raw.parse::<u16>().ok())
        .unwrap_or(emwaver_linux_transport::wifi::DEFAULT_WIFI_PORT);
    let Ok(target) = ManualWifiTarget::new(host, port) else {
        return;
    };
    let mut device = DeviceRecord::new(
        target.id(),
        target.display_name(),
        TransportKind::Wifi,
        None,
    );
    device.connected = true;
    model.borrow_mut().upsert_device(device);
}

fn seed_mdns_wifi_devices(model: &Rc<RefCell<AppModel>>) {
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        return;
    };
    let Ok(records) = runtime.block_on(
        LinuxWifiManager::default()
            .discover_live_mdns_records(emwaver_linux_transport::wifi::WIFI_DISCOVERY_TIMEOUT),
    ) else {
        return;
    };
    for record in records {
        let descriptor = record.descriptor();
        let mut device = DeviceRecord::new(
            descriptor.id.0,
            wifi_record_display_name(&record),
            TransportKind::Wifi,
            descriptor.hardware_uid,
        );
        device.firmware_version = descriptor.firmware_version;
        device.connected = true;
        model.borrow_mut().upsert_device(device);
    }
}

fn seed_ble_devices(model: &Rc<RefCell<AppModel>>) {
    let Ok(candidates) = LinuxBleManager::default().scan() else {
        return;
    };
    for candidate in candidates {
        let descriptor = LinuxBleTransport::new(candidate.target.clone()).descriptor();
        let display_name = match candidate.rssi {
            Some(rssi) => format!("{} ({rssi} dBm)", descriptor.display_name),
            None => descriptor.display_name,
        };
        let mut device = DeviceRecord::new(
            descriptor.id.0,
            display_name,
            TransportKind::Ble,
            descriptor.hardware_uid,
        );
        device.firmware_version = descriptor.firmware_version;
        device.connected = true;
        model.borrow_mut().upsert_device(device);
    }
}

fn wifi_record_display_name(record: &emwaver_linux_transport::wifi::WifiDiscoveryRecord) -> String {
    let board = record
        .board_type
        .as_deref()
        .map(display_board_type)
        .unwrap_or("ESP32");
    format!("{board} Wi-Fi: {}", record.display_name)
}

fn manual_wifi_target_from_device(device: &DeviceRecord) -> Result<ManualWifiTarget, String> {
    let Some(rest) = device.id.strip_prefix("wifi:") else {
        return Err(format!(
            "Wi-Fi device {} is missing a manual target.",
            device.id
        ));
    };
    let Some((host, port)) = rest.rsplit_once(':') else {
        return Err(format!("Wi-Fi device {} is missing a port.", device.id));
    };
    let port = port
        .parse::<u16>()
        .map_err(|_| format!("Wi-Fi device {} has an invalid port.", device.id))?;
    ManualWifiTarget::new(host, port).map_err(|err| err.to_string())
}

fn ble_target_from_device(device: &DeviceRecord) -> Result<BleTarget, String> {
    let Some(rest) = device.id.strip_prefix("ble:") else {
        return Err(format!("BLE device {} is missing a target.", device.id));
    };
    let Some((adapter, address)) = rest.split_once(':') else {
        return Err(format!(
            "BLE device {} is missing a BlueZ adapter and address.",
            device.id
        ));
    };
    BleTarget::new(adapter, address, device.display_name.clone()).map_err(|err| err.to_string())
}

fn display_board_type(board: &str) -> &'static str {
    match board.trim().to_ascii_lowercase().as_str() {
        "esp32s3" | "esp32-s3" => "ESP32-S3",
        "esp32s2" | "esp32-s2" => "ESP32-S2",
        "esp32" => "ESP32",
        _ => "ESP32",
    }
}

fn seed_usb_devices(model: &Rc<RefCell<AppModel>>) {
    let Ok(candidates) = LinuxUsbManager::default().discover() else {
        return;
    };

    for candidate in candidates {
        let access = candidate.access.clone();
        let mut display_name = candidate.display_name();
        if access != UsbAccessState::Accessible {
            display_name = format!("{display_name} ({access:?})");
        }

        let probe = probe_usb_candidate(&candidate);
        if let Some(board_type) = probe.as_ref().and_then(|probe| probe.board_type.as_ref()) {
            display_name = format!("{display_name} - {board_type}");
        }

        let mut device = DeviceRecord::new(
            candidate.id,
            display_name,
            candidate.transport,
            probe.as_ref().and_then(|probe| probe.hardware_uid.clone()),
        );
        device.firmware_version = probe.and_then(|probe| probe.firmware_version);
        device.connected = access == UsbAccessState::Accessible;
        model.borrow_mut().upsert_device(device);
    }
}

fn probe_usb_candidate(
    candidate: &UsbDeviceCandidate,
) -> Option<emwaver_linux_transport::command::DeviceProbe> {
    if candidate.role != UsbDeviceRole::Stm32RunModeMidi
        || candidate.access != UsbAccessState::Accessible
    {
        return None;
    }

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .ok()?;
    runtime
        .block_on(LinuxUsbManager::default().probe_run_mode_candidate(candidate.clone()))
        .ok()
}

fn section_label(text: &str) -> gtk::Label {
    gtk::Label::builder()
        .label(text)
        .halign(Align::Start)
        .css_classes(vec!["heading"])
        .build()
}

fn make_source_buffer() -> sourceview5::Buffer {
    let manager = sourceview5::LanguageManager::default();
    let buffer = manager
        .language("javascript")
        .map(|language| sourceview5::Buffer::with_language(&language))
        .unwrap_or_else(|| sourceview5::Buffer::new(None::<&gtk::TextTagTable>));
    buffer.set_highlight_syntax(true);
    buffer.set_highlight_matching_brackets(true);
    buffer
}

fn editor_toolbar(
    title: &gtk::Label,
    detail: &gtk::Label,
    find_button: &gtk::Button,
    go_to_line_button: &gtk::Button,
    line_wrap_button: &gtk::ToggleButton,
    preview_button: &gtk::ToggleButton,
) -> gtk::Box {
    let toolbar = gtk::Box::new(Orientation::Horizontal, 8);
    toolbar.append(title);
    toolbar.append(detail);
    let spacer = gtk::Box::new(Orientation::Horizontal, 0);
    spacer.set_hexpand(true);
    toolbar.append(&spacer);
    toolbar.append(find_button);
    toolbar.append(go_to_line_button);
    toolbar.append(line_wrap_button);
    toolbar.append(preview_button);
    toolbar
}

fn runtime_status_label(text: &str) -> gtk::Label {
    gtk::Label::builder()
        .label(text)
        .wrap(true)
        .xalign(0.0)
        .css_classes(vec!["dim-label"])
        .build()
}

fn clear_box(container: &gtk::Box) {
    while let Some(child) = container.first_child() {
        container.remove(&child);
    }
}

fn clear_preview_session(session: &Rc<RefCell<Option<Rc<ScriptUiSessionHandle>>>>) {
    *session.borrow_mut() = None;
}

fn render_script_preview_tree(
    preview_root: &gtk::Box,
    session: &Rc<ScriptUiSessionHandle>,
    root: &ScriptUiNode,
    status: &str,
) {
    clear_box(preview_root);
    session.status_label.set_label(status);
    preview_root.append(&section_label("Runtime Output"));
    preview_root.append(&session.status_label);
    preview_root.append(&render_script_node(root, session, preview_root));
}

fn start_script_ui_session(
    device: Option<DeviceRecord>,
    source: String,
    module_sources: BTreeMap<String, String>,
) -> (
    Rc<ScriptUiSessionHandle>,
    mpsc::Receiver<ScriptUiSessionEvent>,
) {
    let (command_tx, command_rx) = mpsc::channel::<ScriptUiSessionCommand>();
    let (event_tx, event_rx) = mpsc::channel::<ScriptUiSessionEvent>();
    let render_event_tx = event_tx.clone();
    thread::spawn(move || {
        let console_event_tx = event_tx.clone();
        let mut runtime = match ScriptUiRuntime::new_with_session_handlers(
            &source,
            &module_sources,
            script_packet_handler(device, event_tx.clone()),
            Box::new(move |tree| {
                let _ = render_event_tx.send(ScriptUiSessionEvent::Rendered {
                    root: tree.root,
                    status: "Rendered from the live script UI runtime.".to_string(),
                });
            }),
            Box::new(move |line| {
                let _ = console_event_tx.send(ScriptUiSessionEvent::Log(line));
            }),
        ) {
            Ok(runtime) => runtime,
            Err(err) => {
                let _ = event_tx.send(ScriptUiSessionEvent::Failed(format!(
                    "Script UI render failed: {err}"
                )));
                return;
            }
        };
        match runtime.tree() {
            Ok(Some(tree)) => {
                let _ = event_tx.send(ScriptUiSessionEvent::Rendered {
                    root: tree.root,
                    status: "Rendered from the live script UI runtime.".to_string(),
                });
            }
            Ok(None) => {
                let _ = event_tx.send(ScriptUiSessionEvent::Empty {
                    status: "No script UI tree was rendered.".to_string(),
                });
            }
            Err(err) => {
                let _ = event_tx.send(ScriptUiSessionEvent::Failed(format!(
                    "Script UI render failed: {err}"
                )));
            }
        }

        while let Ok(command) = command_rx.recv() {
            match command {
                ScriptUiSessionCommand::Invoke { token, arguments } => {
                    let result = runtime.invoke_handler(&token, &arguments);
                    match result {
                        Ok(Some(tree)) => {
                            let _ = event_tx.send(ScriptUiSessionEvent::Rendered {
                                root: tree.root,
                                status: "Updated after script action.".to_string(),
                            });
                            let _ = event_tx.send(ScriptUiSessionEvent::ActionFinished(
                                "Script action completed.".to_string(),
                            ));
                        }
                        Ok(None) => {
                            let _ = event_tx.send(ScriptUiSessionEvent::ActionFinished(
                                "Script action completed.".to_string(),
                            ));
                        }
                        Err(err) => {
                            let _ = event_tx.send(ScriptUiSessionEvent::Failed(format!(
                                "Script action failed: {err}"
                            )));
                        }
                    }
                }
            }
        }
    });
    let status_label = runtime_status_label("Starting live script UI runtime…");
    (
        Rc::new(ScriptUiSessionHandle {
            command_tx,
            status_label,
            busy: Cell::new(false),
        }),
        event_rx,
    )
}

fn render_source_preview(
    preview_root: &gtk::Box,
    session_slot: &Rc<RefCell<Option<Rc<ScriptUiSessionHandle>>>>,
    log_view: &gtk::TextView,
    device: &Option<DeviceRecord>,
    name: &str,
    source: &str,
    module_sources: &BTreeMap<String, String>,
) {
    clear_preview_session(session_slot);
    clear_box(preview_root);
    preview_root.append(&section_label(&format!("{name} Runtime Output")));

    let (session, event_rx) =
        start_script_ui_session(device.clone(), source.to_string(), module_sources.clone());
    preview_root.append(&session.status_label);
    *session_slot.borrow_mut() = Some(Rc::clone(&session));
    poll_script_ui_session_events(
        preview_root.clone(),
        log_view.clone(),
        Rc::downgrade(&session),
        event_rx,
    );
}

fn poll_script_ui_session_events(
    preview_root: gtk::Box,
    log_view: gtk::TextView,
    session: std::rc::Weak<ScriptUiSessionHandle>,
    event_rx: mpsc::Receiver<ScriptUiSessionEvent>,
) {
    let event_rx = Rc::new(RefCell::new(event_rx));
    glib::timeout_add_local(Duration::from_millis(30), move || {
        let Some(session) = session.upgrade() else {
            return ControlFlow::Break;
        };
        while let Ok(event) = event_rx.borrow_mut().try_recv() {
            match event {
                ScriptUiSessionEvent::Rendered { root, status } => {
                    render_script_preview_tree(&preview_root, &session, &root, &status);
                }
                ScriptUiSessionEvent::Empty { status } => {
                    session.busy.set(false);
                    session.status_label.set_label(&status);
                }
                ScriptUiSessionEvent::Log(line) => {
                    append_log(&log_view, &line);
                    session.status_label.set_label(&line);
                }
                ScriptUiSessionEvent::ActionFinished(status) => {
                    session.busy.set(false);
                    session.status_label.set_label(&status);
                }
                ScriptUiSessionEvent::Failed(message) => {
                    session.busy.set(false);
                    session.status_label.set_label(&message);
                }
            }
        }
        ControlFlow::Continue
    });
}

fn invoke_script_action(
    session: &Rc<ScriptUiSessionHandle>,
    token: String,
    action_label: String,
    arguments: Vec<serde_json::Value>,
) {
    if session.busy.replace(true) {
        session
            .status_label
            .set_label("A script action is already running.");
        return;
    }
    session
        .status_label
        .set_label(&format!("Running {action_label}…"));
    if session
        .command_tx
        .send(ScriptUiSessionCommand::Invoke { token, arguments })
        .is_err()
    {
        session.busy.set(false);
        session
            .status_label
            .set_label("Script UI runtime is no longer available.");
    }
}

fn render_script_node(
    node: &ScriptUiNode,
    session: &Rc<ScriptUiSessionHandle>,
    preview_root: &gtk::Box,
) -> gtk::Widget {
    match node.node_type.as_str() {
        "column" => {
            let column = gtk::Box::new(Orientation::Vertical, node_spacing(node));
            apply_node_padding(&column, node);
            for child in &node.children {
                column.append(&render_script_node(child, session, preview_root));
            }
            column.upcast()
        }
        "row" => {
            let row = gtk::Box::new(Orientation::Horizontal, node_spacing(node));
            apply_node_padding(&row, node);
            for child in &node.children {
                row.append(&render_script_node(child, session, preview_root));
            }
            row.upcast()
        }
        "card" => {
            let content = gtk::Box::new(Orientation::Vertical, node_spacing(node));
            apply_node_padding_or_default(&content, node, 16);
            if node.props.contains_key("title") || node.props.contains_key("subtitle") {
                let header = gtk::Box::new(Orientation::Vertical, 3);
                if let Some(title) = node_prop_string(node, "title") {
                    header.append(
                        &gtk::Label::builder()
                            .label(title)
                            .xalign(0.0)
                            .css_classes(vec!["heading"])
                            .build(),
                    );
                }
                if let Some(subtitle) = node_prop_string(node, "subtitle") {
                    header.append(
                        &gtk::Label::builder()
                            .label(subtitle)
                            .wrap(true)
                            .xalign(0.0)
                            .css_classes(vec!["dim-label"])
                            .build(),
                    );
                }
                content.append(&header);
            }
            for child in &node.children {
                content.append(&render_script_node(child, session, preview_root));
            }
            gtk::Frame::builder().child(&content).build().upcast()
        }
        "tile" => {
            let content = gtk::Box::new(Orientation::Vertical, 2);
            apply_node_padding_or_default(&content, node, 10);
            if node.children.is_empty() {
                if let Some(title) = node_prop_string(node, "title") {
                    content.append(
                        &gtk::Label::builder()
                            .label(title.to_uppercase())
                            .wrap(true)
                            .xalign(0.0)
                            .css_classes(vec!["dim-label"])
                            .build(),
                    );
                }
                if let Some(value) = node_prop_string(node, "value") {
                    let value_label = gtk::Label::builder()
                        .label(value)
                        .wrap(true)
                        .xalign(0.0)
                        .build();
                    if node_prop_bool(node, "monospaceValue").unwrap_or(false) {
                        value_label.add_css_class("monospace");
                    }
                    content.append(&value_label);
                }
                if let Some(subtitle) = node_prop_string(node, "subtitle") {
                    content.append(
                        &gtk::Label::builder()
                            .label(subtitle)
                            .wrap(true)
                            .xalign(0.0)
                            .css_classes(vec!["dim-label"])
                            .build(),
                    );
                }
            } else {
                for child in &node.children {
                    content.append(&render_script_node(child, session, preview_root));
                }
            }
            content.set_hexpand(true);
            let disabled = node_prop_bool(node, "disabled").unwrap_or(false);
            if let Some(token) = node.handlers.get("tap").cloned().filter(|_| !disabled) {
                let button = gtk::Button::builder().child(&content).build();
                button.add_css_class("flat");
                let session = Rc::clone(session);
                let action_label = node_label(node);
                button.connect_clicked(move |_| {
                    invoke_script_action(&session, token.clone(), action_label.clone(), Vec::new());
                });
                button.upcast()
            } else {
                content.set_sensitive(!disabled);
                gtk::Frame::builder().child(&content).build().upcast()
            }
        }
        "text" => {
            let text = node_text(node);
            let mut builder = gtk::Label::builder().label(text).wrap(true).xalign(0.0);
            if matches!(
                node_prop_string(node, "font").as_deref(),
                Some("title" | "title2" | "title3" | "headline")
            ) {
                builder = builder.css_classes(vec!["heading"]);
            }
            let label = builder.build();
            if matches!(
                node_prop_string(node, "fontDesign").as_deref(),
                Some("monospaced")
            ) {
                label.add_css_class("monospace");
            }
            label.upcast()
        }
        "button" => {
            let action_label = node_label(node);
            let button = gtk::Button::builder().label(&action_label).build();
            if let Some(token) = node.handlers.get("tap").cloned() {
                button.set_tooltip_text(Some(&format!("Script action {token}")));
                let session = Rc::clone(session);
                button.connect_clicked(move |_| {
                    invoke_script_action(&session, token.clone(), action_label.clone(), Vec::new());
                });
            }
            button.upcast()
        }
        "slider" => {
            let min = node_prop_f64(node, "min").unwrap_or(0.0);
            let max = node_prop_f64(node, "max").unwrap_or(1.0);
            let step = node_prop_f64(node, "step").unwrap_or(1.0).max(0.000_001);
            let scale = gtk::Scale::with_range(Orientation::Horizontal, min, max, step);
            scale.set_value(node_prop_f64(node, "value").unwrap_or(min));
            if let Some(token) = node.handlers.get("change").cloned() {
                let session = Rc::clone(session);
                let action_label = node_label(node);
                scale.connect_value_changed(move |scale| {
                    invoke_script_action(
                        &session,
                        token.clone(),
                        action_label.clone(),
                        vec![serde_json::json!(scale.value())],
                    );
                });
            }
            scale.upcast()
        }
        "logViewer" => {
            let view = gtk::TextView::builder()
                .editable(false)
                .cursor_visible(false)
                .top_margin(8)
                .bottom_margin(8)
                .left_margin(8)
                .right_margin(8)
                .build();
            view.add_css_class("monospace");
            view.buffer().set_text(&node_text(node));
            gtk::ScrolledWindow::builder()
                .min_content_height(node_prop_i32(node, "minHeight").unwrap_or(120))
                .hscrollbar_policy(PolicyType::Automatic)
                .vscrollbar_policy(PolicyType::Automatic)
                .child(&view)
                .build()
                .upcast()
        }
        "scroll" => {
            let content = gtk::Box::new(Orientation::Vertical, node_spacing(node));
            apply_node_padding(&content, node);
            for child in &node.children {
                content.append(&render_script_node(child, session, preview_root));
            }
            gtk::ScrolledWindow::builder()
                .hexpand(true)
                .vexpand(true)
                .hscrollbar_policy(PolicyType::Automatic)
                .vscrollbar_policy(PolicyType::Automatic)
                .child(&content)
                .build()
                .upcast()
        }
        "textField" => {
            let entry = gtk::Entry::builder()
                .text(node_prop_string(node, "value").unwrap_or_default())
                .placeholder_text(node_prop_string(node, "placeholder").unwrap_or_default())
                .build();
            if let Some(token) = node.handlers.get("change").cloned() {
                let session = Rc::clone(session);
                let action_label = node_label(node);
                entry.connect_changed(move |entry| {
                    invoke_script_action(
                        &session,
                        token.clone(),
                        action_label.clone(),
                        vec![serde_json::json!(entry.text().to_string())],
                    );
                });
            }
            if let Some(token) = node.handlers.get("submit").cloned() {
                let session = Rc::clone(session);
                let action_label = node_label(node);
                entry.connect_activate(move |entry| {
                    invoke_script_action(
                        &session,
                        token.clone(),
                        action_label.clone(),
                        vec![serde_json::json!(entry.text().to_string())],
                    );
                });
            }
            entry.upcast()
        }
        "textEditor" => {
            let view = gtk::TextView::builder()
                .wrap_mode(gtk::WrapMode::WordChar)
                .top_margin(8)
                .bottom_margin(8)
                .left_margin(8)
                .right_margin(8)
                .build();
            view.buffer()
                .set_text(&node_prop_string(node, "value").unwrap_or_default());
            gtk::ScrolledWindow::builder()
                .min_content_height(node_prop_i32(node, "minHeight").unwrap_or(140))
                .child(&view)
                .build()
                .upcast()
        }
        "picker" => {
            let container = gtk::Box::new(Orientation::Vertical, 6);
            if let Some(label) = node_prop_string(node, "label") {
                container.append(
                    &gtk::Label::builder()
                        .label(label)
                        .xalign(0.0)
                        .css_classes(vec!["heading"])
                        .build(),
                );
            }
            let combo = gtk::ComboBoxText::new();
            combo.set_hexpand(true);
            block_combo_scroll_changes(&combo);
            let selected = node_prop_string(node, "selected").unwrap_or_default();
            if let Some(options) = node
                .props
                .get("options")
                .and_then(serde_json::Value::as_array)
            {
                let mut active_index = None;
                for (index, option) in options.iter().enumerate() {
                    let value = option
                        .get("value")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or_default();
                    let label = option
                        .get("label")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or(value);
                    combo.append(Some(value), label);
                    if value == selected {
                        active_index = Some(index as u32);
                    }
                }
                if let Some(index) = active_index {
                    combo.set_active(Some(index));
                }
            }
            if let Some(token) = node.handlers.get("change").cloned() {
                let session = Rc::clone(session);
                let action_label = node_label(node);
                combo.connect_changed(move |combo| {
                    let value = combo.active_id().map(|value| value.to_string());
                    invoke_script_action(
                        &session,
                        token.clone(),
                        action_label.clone(),
                        vec![serde_json::json!(value.unwrap_or_default())],
                    );
                });
            }
            container.append(&combo);
            container.upcast()
        }
        "toggle" => {
            let toggle = gtk::CheckButton::builder()
                .label(node_label(node))
                .active(node_prop_bool(node, "value").unwrap_or(false))
                .build();
            if let Some(token) = node.handlers.get("change").cloned() {
                let session = Rc::clone(session);
                let action_label = node_label(node);
                toggle.connect_toggled(move |toggle| {
                    invoke_script_action(
                        &session,
                        token.clone(),
                        action_label.clone(),
                        vec![serde_json::json!(toggle.is_active())],
                    );
                });
            }
            toggle.upcast()
        }
        "grid" => {
            if let Some(min_width) = node_prop_i32(node, "minColumnWidth") {
                let flow = gtk::FlowBox::builder()
                    .column_spacing(node_spacing(node) as u32)
                    .row_spacing(node_spacing(node) as u32)
                    .selection_mode(gtk::SelectionMode::None)
                    .homogeneous(true)
                    .min_children_per_line(1)
                    .max_children_per_line(6)
                    .build();
                flow.set_hexpand(true);
                for child in &node.children {
                    let widget = render_script_node(child, session, preview_root);
                    widget.set_size_request(min_width, -1);
                    widget.set_hexpand(true);
                    flow.insert(&widget, -1);
                }
                flow.upcast()
            } else {
                let grid = gtk::Grid::builder()
                    .column_spacing(node_spacing(node))
                    .row_spacing(node_spacing(node))
                    .build();
                let columns = node_prop_i32(node, "columns").unwrap_or(2).max(1);
                for (index, child) in node.children.iter().enumerate() {
                    grid.attach(
                        &render_script_node(child, session, preview_root),
                        (index as i32) % columns,
                        (index as i32) / columns,
                        1,
                        1,
                    );
                }
                grid.upcast()
            }
        }
        "plot" => runtime_status_label("Plot rendering is pending for Linux GTK.").upcast(),
        "modal" => {
            let content = gtk::Box::new(Orientation::Vertical, node_spacing(node));
            apply_node_padding(&content, node);
            content.append(
                &gtk::Label::builder()
                    .label(node_label(node))
                    .xalign(0.0)
                    .build(),
            );
            for child in &node.children {
                content.append(&render_script_node(child, session, preview_root));
            }
            gtk::Frame::builder().child(&content).build().upcast()
        }
        "spacer" => {
            let spacer = gtk::Box::new(Orientation::Vertical, 0);
            spacer.set_vexpand(true);
            spacer.upcast()
        }
        "divider" => gtk::Separator::new(Orientation::Horizontal).upcast(),
        "progress" => {
            let progress = gtk::ProgressBar::new();
            if let Some(value) = node_prop_f64(node, "value") {
                progress.set_fraction(value.clamp(0.0, 1.0));
            } else {
                progress.pulse();
            }
            progress.upcast()
        }
        _ => runtime_status_label(&format!("Unsupported script UI node: {}", node.node_type))
            .upcast(),
    }
}

fn apply_node_padding_or_default(
    widget: &impl IsA<gtk::Widget>,
    node: &ScriptUiNode,
    fallback: i32,
) {
    apply_node_padding(widget, node);
    if !node.props.contains_key("padding") {
        widget.set_margin_top(fallback);
        widget.set_margin_bottom(fallback);
        widget.set_margin_start(fallback);
        widget.set_margin_end(fallback);
    }
}

fn block_combo_scroll_changes(combo: &gtk::ComboBoxText) {
    let scroll = gtk::EventControllerScroll::new(
        gtk::EventControllerScrollFlags::VERTICAL
            | gtk::EventControllerScrollFlags::HORIZONTAL
            | gtk::EventControllerScrollFlags::DISCRETE,
    );
    scroll.set_propagation_phase(gtk::PropagationPhase::Capture);
    scroll.connect_scroll(|_, _, _| Propagation::Stop);
    combo.add_controller(scroll);
}

fn apply_node_padding(widget: &impl IsA<gtk::Widget>, node: &ScriptUiNode) {
    if let Some(padding) = node_prop_i32(node, "padding") {
        widget.set_margin_top(padding);
        widget.set_margin_bottom(padding);
        widget.set_margin_start(padding);
        widget.set_margin_end(padding);
        return;
    }
    if let Some(padding) = node
        .props
        .get("padding")
        .and_then(serde_json::Value::as_object)
    {
        widget.set_margin_top(json_i32(padding.get("top")).unwrap_or(0));
        widget.set_margin_bottom(json_i32(padding.get("bottom")).unwrap_or(0));
        widget.set_margin_start(json_i32(padding.get("leading")).unwrap_or(0));
        widget.set_margin_end(json_i32(padding.get("trailing")).unwrap_or(0));
    }
}

fn node_text(node: &ScriptUiNode) -> String {
    node_prop_string(node, "text")
        .or_else(|| node_prop_string(node, "label"))
        .unwrap_or_default()
}

fn node_label(node: &ScriptUiNode) -> String {
    node_prop_string(node, "label")
        .or_else(|| node_prop_string(node, "text"))
        .unwrap_or_else(|| node.node_type.clone())
}

fn node_spacing(node: &ScriptUiNode) -> i32 {
    node_prop_i32(node, "spacing").unwrap_or(8)
}

fn node_prop_string(node: &ScriptUiNode, key: &str) -> Option<String> {
    node.props
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn node_prop_bool(node: &ScriptUiNode, key: &str) -> Option<bool> {
    node.props.get(key).and_then(serde_json::Value::as_bool)
}

fn node_prop_f64(node: &ScriptUiNode, key: &str) -> Option<f64> {
    node.props.get(key).and_then(|value| {
        value
            .as_f64()
            .or_else(|| value.as_str().and_then(|raw| raw.parse::<f64>().ok()))
    })
}

fn node_prop_i32(node: &ScriptUiNode, key: &str) -> Option<i32> {
    json_i32(node.props.get(key))
}

fn json_i32(value: Option<&serde_json::Value>) -> Option<i32> {
    value.and_then(|value| {
        value
            .as_i64()
            .and_then(|number| i32::try_from(number).ok())
            .or_else(|| value.as_f64().map(|number| number.round() as i32))
            .or_else(|| value.as_str().and_then(|raw| raw.parse::<i32>().ok()))
    })
}

fn select_first_match(buffer: &sourceview5::Buffer, query: &str) {
    let query = query.trim();
    if query.is_empty() {
        return;
    }
    let source = buffer
        .text(&buffer.start_iter(), &buffer.end_iter(), true)
        .to_string();
    let Some(byte_offset) = source.to_lowercase().find(&query.to_lowercase()) else {
        return;
    };
    let char_offset = source[..byte_offset].chars().count() as i32;
    let char_len = query.chars().count() as i32;
    let start = buffer.iter_at_offset(char_offset);
    let end = buffer.iter_at_offset(char_offset + char_len);
    buffer.select_range(&start, &end);
}

fn present_go_to_line_dialog(
    parent: &adw::ApplicationWindow,
    editor: &sourceview5::View,
    buffer: &sourceview5::Buffer,
) {
    let dialog = gtk::Dialog::builder()
        .transient_for(parent)
        .modal(true)
        .title("Go to Line")
        .default_width(320)
        .build();
    dialog.add_button("Cancel", gtk::ResponseType::Cancel);
    dialog.add_button("Go", gtk::ResponseType::Accept);

    let entry = gtk::Entry::builder()
        .input_purpose(gtk::InputPurpose::Number)
        .text("1")
        .activates_default(true)
        .margin_top(16)
        .margin_bottom(16)
        .margin_start(16)
        .margin_end(16)
        .build();
    dialog.set_default_response(gtk::ResponseType::Accept);
    dialog.content_area().append(&entry);

    let editor = editor.clone();
    let buffer = buffer.clone();
    dialog.connect_response(move |dialog, response| {
        if response == gtk::ResponseType::Accept {
            if let Ok(line) = entry.text().trim().parse::<i32>() {
                let line = line.clamp(1, buffer.line_count().max(1)) - 1;
                if let Some(mut iter) = buffer.iter_at_line(line) {
                    buffer.place_cursor(&iter);
                    editor.scroll_to_iter(&mut iter, 0.2, true, 0.0, 0.2);
                    editor.grab_focus();
                }
            }
        }
        dialog.close();
    });
    dialog.present();
}

fn refresh_script_list(
    list: &gtk::ListBox,
    repository: &ScriptRepository,
    items: &Rc<RefCell<Vec<ScriptListItem>>>,
    row_indices: &Rc<RefCell<Vec<Option<usize>>>>,
    log_view: &gtk::TextView,
    filter_query: &str,
    active_script_id: Option<&str>,
) {
    while let Some(row) = list.first_child() {
        list.remove(&row);
    }
    items.borrow_mut().clear();
    row_indices.borrow_mut().clear();

    let mut scripts = match repository.list_scripts() {
        Ok(scripts) => scripts,
        Err(err) => {
            append_log(log_view, &format!("Script library load failed: {err}"));
            return;
        }
    };
    let filter_query = filter_query.trim().to_lowercase();
    if !filter_query.is_empty() {
        scripts.retain(|script| {
            script.name.to_lowercase().contains(&filter_query)
                || script.kind_label().to_lowercase().contains(&filter_query)
                || script
                    .section_title()
                    .to_lowercase()
                    .contains(&filter_query)
        });
    }

    let mut current_section = String::new();
    for script in scripts {
        let section = script.section_title();
        if section != current_section {
            current_section = section.to_string();
            let mut row_indices = row_indices.borrow_mut();
            append_script_section(list, &mut row_indices, section);
        }

        let index = items.borrow().len();
        {
            let mut row_indices = row_indices.borrow_mut();
            append_script_row(list, &mut row_indices, &script, index, active_script_id);
        }
        items.borrow_mut().push(script);
    }
}

fn append_script_section(list: &gtk::ListBox, row_indices: &mut Vec<Option<usize>>, title: &str) {
    let label = gtk::Label::builder()
        .label(title)
        .xalign(0.0)
        .css_classes(vec!["dim-label"])
        .margin_top(12)
        .margin_bottom(4)
        .margin_start(10)
        .margin_end(10)
        .build();
    let item = gtk::ListBoxRow::builder().child(&label).build();
    item.set_activatable(false);
    item.set_selectable(false);
    list.append(&item);
    row_indices.push(None);
}

fn append_script_row(
    list: &gtk::ListBox,
    row_indices: &mut Vec<Option<usize>>,
    script: &ScriptListItem,
    index: usize,
    active_script_id: Option<&str>,
) {
    let is_running = active_script_id == Some(script.id.as_str());
    let row = gtk::Box::new(Orientation::Horizontal, 10);
    row.set_margin_top(10);
    row.set_margin_bottom(10);
    row.set_margin_start(10);
    row.set_margin_end(10);
    let text = gtk::Box::new(Orientation::Vertical, 2);
    text.set_hexpand(true);
    text.append(
        &gtk::Label::builder()
            .label(&script.name)
            .xalign(0.0)
            .ellipsize(gtk::pango::EllipsizeMode::End)
            .build(),
    );
    let detail = gtk::Box::new(Orientation::Horizontal, 8);
    detail.append(
        &gtk::Label::builder()
            .label(format!(
                "{} · {}",
                script.kind_label(),
                script.kind_detail()
            ))
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );
    if is_running {
        detail.append(
            &gtk::Label::builder()
                .label("Running")
                .css_classes(vec!["success"])
                .build(),
        );
    }
    text.append(&detail);
    row.append(&text);

    let controls = gtk::Box::new(Orientation::Horizontal, 4);
    let run_button = gtk::Button::builder()
        .icon_name("media-playback-start-symbolic")
        .tooltip_text(if is_running {
            "Restore running script"
        } else {
            "Run script"
        })
        .sensitive(script.is_runnable())
        .build();
    run_button.set_action_name(Some("win.script-run"));
    run_button.set_action_target_value(Some(&script.id.to_variant()));
    controls.append(&run_button);

    if is_running {
        let stop_button = gtk::Button::builder()
            .icon_name("media-playback-stop-symbolic")
            .tooltip_text("Stop running script")
            .build();
        stop_button.set_action_name(Some("win.script-stop"));
        stop_button.set_action_target_value(Some(&script.id.to_variant()));
        controls.append(&stop_button);
    }

    let edit_button = gtk::Button::builder()
        .icon_name(if script.is_editable() {
            "document-edit-symbolic"
        } else {
            "view-visible-symbolic"
        })
        .tooltip_text(if script.is_editable() {
            "Edit script"
        } else {
            "View script"
        })
        .build();
    edit_button.set_action_name(Some("win.script-edit"));
    edit_button.set_action_target_value(Some(&script.id.to_variant()));
    controls.append(&edit_button);
    row.append(&controls);

    let item = gtk::ListBoxRow::builder().child(&row).build();
    item.set_activatable(true);
    item.set_selectable(true);
    list.append(&item);
    row_indices.push(Some(index));
}

fn first_script_row(
    list: &gtk::ListBox,
    row_indices: &Rc<RefCell<Vec<Option<usize>>>>,
) -> Option<gtk::ListBoxRow> {
    row_indices
        .borrow()
        .iter()
        .position(Option::is_some)
        .and_then(|index| list.row_at_index(index as i32))
}

fn select_script_by_id(
    list: &gtk::ListBox,
    items: &Rc<RefCell<Vec<ScriptListItem>>>,
    row_indices: &Rc<RefCell<Vec<Option<usize>>>>,
    id: &str,
) {
    let items = items.borrow();
    let row_indices = row_indices.borrow();
    for (row_index, script_index) in row_indices.iter().enumerate() {
        let Some(script_index) = script_index else {
            continue;
        };
        if items
            .get(*script_index)
            .map(|script| script.id == id)
            .unwrap_or(false)
        {
            list.select_row(list.row_at_index(row_index as i32).as_ref());
            return;
        }
    }
}

fn selected_device_title(device: &Option<DeviceRecord>) -> String {
    device
        .as_ref()
        .map(|device| device.display_name.clone())
        .unwrap_or_else(|| "No Device".to_string())
}

fn load_run_log_visible() -> bool {
    mcp_server::read_run_log_visible()
}

fn save_run_log_visible(visible: bool) -> std::io::Result<()> {
    mcp_server::write_run_log_visible(visible)
}

fn present_settings_dialog(
    parent: &adw::ApplicationWindow,
    run_log_expander: &gtk::Expander,
    script_repository: &Rc<ScriptRepository>,
    mcp_snapshot: &Arc<Mutex<mcp_server::McpDeviceSnapshot>>,
    mcp_server_handle: &Rc<RefCell<Option<mcp_server::McpServerHandle>>>,
    mcp_last_error: &Rc<RefCell<Option<String>>>,
) {
    let dialog = gtk::Dialog::builder()
        .transient_for(parent)
        .modal(true)
        .title("Settings")
        .default_width(620)
        .default_height(620)
        .build();
    dialog.add_button("Close", gtk::ResponseType::Close);

    let root = gtk::Box::new(Orientation::Vertical, 16);
    root.set_margin_top(20);
    root.set_margin_bottom(20);
    root.set_margin_start(20);
    root.set_margin_end(20);

    let workspace_card = gtk::Box::new(Orientation::Vertical, 8);
    workspace_card.set_margin_top(12);
    workspace_card.set_margin_bottom(12);
    workspace_card.set_margin_start(12);
    workspace_card.set_margin_end(12);
    workspace_card.append(&section_label("Workspace"));
    let show_run_log = gtk::CheckButton::builder()
        .label("Show Run Log")
        .active(run_log_expander.is_visible())
        .build();
    workspace_card.append(&show_run_log);
    workspace_card.append(
        &gtk::Label::builder()
            .label("This applies immediately to the current window.")
            .wrap(true)
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );
    root.append(&gtk::Frame::builder().child(&workspace_card).build());

    let device_card = gtk::Box::new(Orientation::Vertical, 8);
    device_card.set_margin_top(12);
    device_card.set_margin_bottom(12);
    device_card.set_margin_start(12);
    device_card.set_margin_end(12);
    device_card.append(&section_label("Device Access"));
    device_card.append(
        &gtk::Label::builder()
            .label("Local scripts and hardware control work immediately without an EMWaver account, cloud activation, or subscription check.")
            .wrap(true)
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );
    root.append(&gtk::Frame::builder().child(&device_card).build());

    let mcp_card = gtk::Box::new(Orientation::Vertical, 8);
    mcp_card.set_margin_top(12);
    mcp_card.set_margin_bottom(12);
    mcp_card.set_margin_start(12);
    mcp_card.set_margin_end(12);
    mcp_card.append(&section_label("Desktop MCP"));
    let enable_mcp = gtk::CheckButton::builder()
        .label("Enable local MCP server")
        .active(mcp_server::mcp_enabled())
        .build();
    mcp_card.append(&enable_mcp);

    let mcp_status_label = gtk::Label::builder()
        .label(mcp_server::status_text(
            mcp_server_handle,
            mcp_last_error.borrow().as_deref(),
        ))
        .xalign(0.0)
        .css_classes(vec!["dim-label"])
        .build();
    mcp_card.append(&settings_row("Status", &mcp_status_label));

    let endpoint_entry = gtk::Entry::builder()
        .text(mcp_server::endpoint_url())
        .editable(false)
        .hexpand(true)
        .build();
    mcp_card.append(&settings_row("Endpoint", &endpoint_entry));

    let token_entry = gtk::Entry::builder()
        .text(mcp_server::mcp_token())
        .editable(false)
        .hexpand(true)
        .build();
    let reset_token = gtk::Button::builder().label("Reset").build();
    let token_box = gtk::Box::new(Orientation::Horizontal, 8);
    token_box.append(&token_entry);
    token_box.append(&reset_token);
    mcp_card.append(&settings_row("Token", &token_box));
    mcp_card.append(
        &gtk::Label::builder()
            .label("Use the endpoint with a local MCP client that supports Streamable HTTP. Send the token as a Bearer authorization header.")
            .wrap(true)
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );
    let docs_box = gtk::Box::new(Orientation::Horizontal, 8);
    docs_box.append(
        &gtk::LinkButton::builder()
            .label("EMWaver MCP docs")
            .uri("https://emwaver.ai/docs/mcp")
            .build(),
    );
    docs_box.append(
        &gtk::LinkButton::builder()
            .label("Official MCP docs")
            .uri("https://modelcontextprotocol.io/docs/getting-started/intro")
            .build(),
    );
    mcp_card.append(&docs_box);
    root.append(&gtk::Frame::builder().child(&mcp_card).build());

    {
        let run_log_expander = run_log_expander.clone();
        show_run_log.connect_toggled(move |button| {
            let visible = button.is_active();
            run_log_expander.set_visible(visible);
            run_log_expander.set_expanded(visible);
            let _ = save_run_log_visible(visible);
        });
    }

    {
        let script_repository = script_repository.clone();
        let mcp_snapshot = mcp_snapshot.clone();
        let mcp_server_handle = mcp_server_handle.clone();
        let mcp_last_error = mcp_last_error.clone();
        let mcp_status_label = mcp_status_label.clone();
        enable_mcp.connect_toggled(move |button| {
            let enabled = button.is_active();
            let _ = mcp_server::set_mcp_enabled(enabled);
            let result = mcp_server::sync_from_settings(
                &mcp_server_handle,
                &script_repository,
                &mcp_snapshot,
            );
            *mcp_last_error.borrow_mut() = result.err();
            mcp_status_label.set_label(&mcp_server::status_text(
                &mcp_server_handle,
                mcp_last_error.borrow().as_deref(),
            ));
        });
    }

    {
        let token_entry = token_entry.clone();
        reset_token.connect_clicked(move |_| {
            if let Ok(token) = mcp_server::reset_mcp_token() {
                token_entry.set_text(&token);
            }
        });
    }

    dialog.content_area().append(&root);

    dialog.connect_response(move |dialog, _| dialog.close());
    dialog.present();
}

fn settings_row(label: &str, child: &impl IsA<gtk::Widget>) -> gtk::Box {
    let row = gtk::Box::new(Orientation::Horizontal, 12);
    row.append(
        &gtk::Label::builder()
            .label(label)
            .width_chars(14)
            .xalign(0.0)
            .build(),
    );
    row.append(child);
    row
}

fn user_visible_devices(devices: &[DeviceRecord]) -> Vec<DeviceRecord> {
    devices
        .iter()
        .filter(|device| device.transport != TransportKind::Simulator)
        .cloned()
        .collect()
}

fn present_device_dialog(parent: &adw::ApplicationWindow, devices: &[DeviceRecord]) {
    let visible_devices = user_visible_devices(devices);
    let dialog = gtk::Dialog::builder()
        .transient_for(parent)
        .modal(true)
        .title("Devices")
        .default_width(720)
        .default_height(620)
        .build();
    dialog.add_button("Close", gtk::ResponseType::Close);

    let content = dialog.content_area();
    let scroll = gtk::ScrolledWindow::builder()
        .hexpand(true)
        .vexpand(true)
        .hscrollbar_policy(PolicyType::Never)
        .vscrollbar_policy(PolicyType::Automatic)
        .build();
    let root = gtk::Box::new(Orientation::Vertical, 16);
    root.set_margin_top(20);
    root.set_margin_bottom(20);
    root.set_margin_start(20);
    root.set_margin_end(20);

    let selected = visible_devices.iter().find(|device| device.connected);
    root.append(&device_status_card(selected));
    root.append(&local_devices_card(&visible_devices));
    root.append(&manual_wifi_card());
    root.append(&firmware_device_card(selected));
    root.append(&linux_permissions_card());

    scroll.set_child(Some(&root));
    content.append(&scroll);

    dialog.connect_response(|dialog, _| dialog.close());
    dialog.present();
}

fn device_status_card(selected: Option<&DeviceRecord>) -> gtk::Frame {
    let card = gtk::Box::new(Orientation::Horizontal, 12);
    card.set_margin_top(12);
    card.set_margin_bottom(12);
    card.set_margin_start(12);
    card.set_margin_end(12);
    let icon = selected
        .map(|device| transport_icon_name(&device.transport))
        .unwrap_or("network-wired-disconnected-symbolic");
    card.append(&gtk::Image::from_icon_name(icon));
    let copy = gtk::Box::new(Orientation::Vertical, 3);
    copy.set_hexpand(true);
    copy.append(
        &gtk::Label::builder()
            .label(selected.map_or("Disconnected", |device| {
                if device.connected {
                    "Connected"
                } else {
                    "Discovered"
                }
            }))
            .xalign(0.0)
            .css_classes(vec!["heading"])
            .build(),
    );
    copy.append(
        &gtk::Label::builder()
            .label(
                selected.map(device_status_summary).unwrap_or_else(|| {
                    "No local EMWaver device is currently selected.".to_string()
                }),
            )
            .wrap(true)
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );
    card.append(&copy);
    gtk::Frame::builder().child(&card).build()
}

fn local_devices_card(devices: &[DeviceRecord]) -> gtk::Frame {
    let root = gtk::Box::new(Orientation::Vertical, 10);
    root.set_margin_top(12);
    root.set_margin_bottom(12);
    root.set_margin_start(12);
    root.set_margin_end(12);
    root.append(&section_label("Local Devices"));
    root.append(
        &gtk::Label::builder()
            .label("Discovered USB, BLE, and Wi-Fi transports are grouped by local hardware UID when available.")
            .wrap(true)
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );
    let list = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(vec!["boxed-list"])
        .build();
    if devices.is_empty() {
        let empty = gtk::Label::builder()
            .label("No EMWaver devices discovered yet.")
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .margin_top(10)
            .margin_bottom(10)
            .margin_start(10)
            .margin_end(10)
            .build();
        list.append(&gtk::ListBoxRow::builder().child(&empty).build());
    } else {
        for group in grouped_devices(devices) {
            list.append(
                &gtk::ListBoxRow::builder()
                    .child(&device_group_row(&group))
                    .build(),
            );
        }
    }
    root.append(&list);
    gtk::Frame::builder().child(&root).build()
}

fn device_group_row(group: &[DeviceRecord]) -> gtk::Box {
    let preferred = group
        .iter()
        .min_by_key(|device| transport_sort_key(&device.transport))
        .expect("device group is non-empty");
    let row = gtk::Box::new(Orientation::Horizontal, 12);
    row.set_margin_top(10);
    row.set_margin_bottom(10);
    row.set_margin_start(10);
    row.set_margin_end(10);

    row.append(&gtk::Image::from_icon_name(transport_icon_name(
        &preferred.transport,
    )));

    let copy = gtk::Box::new(Orientation::Vertical, 3);
    copy.set_hexpand(true);
    copy.append(
        &gtk::Label::builder()
            .label(&preferred.display_name)
            .xalign(0.0)
            .ellipsize(gtk::pango::EllipsizeMode::End)
            .build(),
    );
    copy.append(
        &gtk::Label::builder()
            .label(device_group_detail_line(group))
            .wrap(true)
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );
    row.append(&copy);

    let transports = gtk::Box::new(Orientation::Horizontal, 6);
    for device in group {
        let badge = gtk::Label::builder()
            .label(transport_label(&device.transport))
            .tooltip_text(device_detail_line(device))
            .css_classes(vec!["dim-label"])
            .build();
        transports.append(&badge);
    }
    row.append(&transports);
    row
}

fn manual_wifi_card() -> gtk::Frame {
    let root = gtk::Box::new(Orientation::Vertical, 10);
    root.set_margin_top(12);
    root.set_margin_bottom(12);
    root.set_margin_start(12);
    root.set_margin_end(12);
    root.append(&section_label("Manual Wi-Fi"));
    root.append(
        &gtk::Label::builder()
            .label("Connect to a user-owned LAN/VPN host. Enter a bare hostname or IP address; do not include ws://, paths, or a port in the host field.")
            .wrap(true)
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );

    let form = gtk::Box::new(Orientation::Horizontal, 8);
    let host_entry = gtk::Entry::builder()
        .placeholder_text("emwaver.local or 192.168.1.42")
        .hexpand(true)
        .build();
    let port_entry = gtk::Entry::builder()
        .text("3922")
        .width_chars(6)
        .input_purpose(gtk::InputPurpose::Number)
        .build();
    let validate_button = gtk::Button::builder().label("Validate").build();
    form.append(&host_entry);
    form.append(&port_entry);
    form.append(&validate_button);
    root.append(&form);

    let status = gtk::Label::builder()
        .label("Set EMWAVER_WIFI_HOST and optional EMWAVER_WIFI_PORT before launch to add this manual Wi-Fi target to the local device list. Live mDNS records are added automatically when the board advertises _emwaver._tcp.local.")
        .wrap(true)
        .xalign(0.0)
        .css_classes(vec!["dim-label"])
        .build();
    root.append(&status);

    {
        let host_entry = host_entry.clone();
        let port_entry = port_entry.clone();
        let status = status.clone();
        validate_button.connect_clicked(move |_| {
            let port = port_entry.text().trim().parse::<u16>().unwrap_or(0);
            match ManualWifiTarget::new(host_entry.text().trim(), port) {
                Ok(target) if target.port > 0 => status.set_label(&format!(
                    "Manual Wi-Fi target accepted: {}:{}. Restart with EMWAVER_WIFI_HOST={} EMWAVER_WIFI_PORT={} to add it as a selectable Wi-Fi device.",
                    target.host, target.port, target.host, target.port
                )),
                Ok(_) => status.set_label("Wi-Fi port must be between 1 and 65535."),
                Err(err) => status.set_label(&err.to_string()),
            }
        });
    }

    gtk::Frame::builder().child(&root).build()
}

fn firmware_device_card(selected: Option<&DeviceRecord>) -> gtk::Frame {
    let root = gtk::Box::new(Orientation::Horizontal, 12);
    root.set_margin_top(12);
    root.set_margin_bottom(12);
    root.set_margin_start(12);
    root.set_margin_end(12);
    root.append(&gtk::Image::from_icon_name(
        "software-update-available-symbolic",
    ));
    let copy = gtk::Box::new(Orientation::Vertical, 3);
    copy.set_hexpand(true);
    copy.append(
        &gtk::Label::builder()
            .label("Firmware")
            .xalign(0.0)
            .css_classes(vec!["heading"])
            .build(),
    );
    copy.append(
        &gtk::Label::builder()
            .label(firmware_device_summary(selected))
            .wrap(true)
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );
    root.append(&copy);
    let action = gtk::Button::builder()
        .label(
            if selected
                .map(|device| inferred_board_type(device).starts_with("ESP32"))
                .unwrap_or(false)
            {
                "Flash Firmware"
            } else {
                "Update Firmware"
            },
        )
        .sensitive(selected.is_some())
        .build();
    root.append(&action);
    gtk::Frame::builder().child(&root).build()
}

fn linux_permissions_card() -> gtk::Frame {
    let root = gtk::Box::new(Orientation::Vertical, 8);
    root.set_margin_top(12);
    root.set_margin_bottom(12);
    root.set_margin_start(12);
    root.set_margin_end(12);
    root.append(&section_label("Linux Permissions"));
    root.append(
        &gtk::Label::builder()
            .label("Install linux/resources/udev/99-emwaver.rules, reload udev rules, then reconnect the board if USB access is unavailable. Core local control remains account-free.")
            .wrap(true)
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );
    gtk::Frame::builder().child(&root).build()
}

fn grouped_devices(devices: &[DeviceRecord]) -> Vec<Vec<DeviceRecord>> {
    let mut groups: Vec<Vec<DeviceRecord>> = Vec::new();
    for device in devices {
        let key = device
            .hardware_uid
            .as_ref()
            .map(|uid| format!("uid:{uid}"))
            .unwrap_or_else(|| format!("transport:{}:{:?}", device.id, device.transport));
        if let Some(group) = groups.iter_mut().find(|group| {
            group
                .first()
                .map(|existing| {
                    existing
                        .hardware_uid
                        .as_ref()
                        .map(|uid| format!("uid:{uid}"))
                        .unwrap_or_else(|| {
                            format!("transport:{}:{:?}", existing.id, existing.transport)
                        })
                        == key
                })
                .unwrap_or(false)
        }) {
            group.push(device.clone());
        } else {
            groups.push(vec![device.clone()]);
        }
    }
    for group in groups.iter_mut() {
        group.sort_by_key(|device| transport_sort_key(&device.transport));
    }
    groups.sort_by(|left, right| {
        left.first()
            .map(|device| device.display_name.to_lowercase())
            .cmp(
                &right
                    .first()
                    .map(|device| device.display_name.to_lowercase()),
            )
    });
    groups
}

fn device_status_summary(device: &DeviceRecord) -> String {
    format!(
        "{} over {}. {}",
        inferred_board_type(device),
        transport_label(&device.transport),
        device_detail_line(device)
    )
}

fn device_group_detail_line(group: &[DeviceRecord]) -> String {
    let Some(preferred) = group.first() else {
        return String::new();
    };
    let mut parts = vec![inferred_board_type(preferred)];
    if let Some(uid) = preferred.hardware_uid.as_ref() {
        parts.push(format!("UID {}", uid_suffix(uid)));
    } else {
        parts.push("UID unavailable".to_string());
    }
    if let Some(version) = preferred.firmware_version.as_ref() {
        parts.push(format!("EMWaver {version}"));
    }
    parts.push(format!(
        "{} transport{}",
        group.len(),
        if group.len() == 1 { "" } else { "s" }
    ));
    parts.join("  ")
}

fn firmware_device_summary(selected: Option<&DeviceRecord>) -> String {
    let Some(device) = selected else {
        return "Connect a supported board to enable board-aware STM32 DFU or ESP32 serial firmware actions.".to_string();
    };
    if inferred_board_type(device).starts_with("ESP32") {
        "ESP32 firmware uses bundled bootloader, partition table, OTA data, and app images; no ESP-IDF end-user workflow.".to_string()
    } else {
        "STM32 firmware update uses the local Rust DFU backend with bundled firmware and udev diagnostics.".to_string()
    }
}

fn inferred_board_type(device: &DeviceRecord) -> String {
    let text = format!(
        "{} {}",
        device.display_name.to_lowercase(),
        device
            .firmware_version
            .as_deref()
            .unwrap_or_default()
            .to_lowercase()
    );
    if text.contains("esp32-s3") || text.contains("esp32s3") {
        "ESP32-S3".to_string()
    } else if text.contains("esp32") {
        "ESP32".to_string()
    } else if text.contains("stm32") || matches!(device.transport, TransportKind::UsbMidi) {
        "STM32F042".to_string()
    } else {
        "Unknown board".to_string()
    }
}

fn uid_suffix(uid: &str) -> String {
    uid.chars()
        .rev()
        .take(12)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}

fn present_firmware_dialog(parent: &adw::ApplicationWindow, selected: Option<DeviceRecord>) {
    let board = selected
        .as_ref()
        .map(inferred_board_type)
        .unwrap_or_else(|| "STM32F042".to_string());
    let is_esp = board.starts_with("ESP32");
    let stm32_plan = plan_bundled_stm32_dfu();
    let esp32_plan = plan_bundled_esp32s3_serial();
    let dfu_connected = is_stm32_dfu_connected();

    let dialog = gtk::Dialog::builder()
        .transient_for(parent)
        .modal(true)
        .title("Firmware")
        .default_width(720)
        .default_height(560)
        .build();
    dialog.add_button("Close", gtk::ResponseType::Close);

    let content = dialog.content_area();
    let root = gtk::Box::new(Orientation::Vertical, 14);
    root.set_margin_top(20);
    root.set_margin_bottom(20);
    root.set_margin_start(20);
    root.set_margin_end(20);

    root.append(&firmware_status_card(
        selected.as_ref(),
        &board,
        &stm32_plan,
        &esp32_plan,
        &dfu_connected,
    ));
    root.append(&firmware_plan_card(
        if is_esp {
            esp32_plan.as_ref().ok()
        } else {
            stm32_plan.as_ref().ok()
        },
        if is_esp {
            "ESP32-S3 serial image plan"
        } else {
            "STM32 DFU image plan"
        },
    ));

    let log_view = gtk::TextView::builder()
        .editable(false)
        .cursor_visible(false)
        .top_margin(8)
        .bottom_margin(8)
        .left_margin(8)
        .right_margin(8)
        .build();
    log_view.add_css_class("monospace");
    log_view.buffer().set_text(&firmware_initial_log(
        &board,
        &stm32_plan,
        &esp32_plan,
        &dfu_connected,
    ));
    let log_scroll = gtk::ScrolledWindow::builder()
        .hexpand(true)
        .vexpand(true)
        .min_content_height(170)
        .hscrollbar_policy(PolicyType::Automatic)
        .vscrollbar_policy(PolicyType::Automatic)
        .child(&log_view)
        .build();

    let actions = gtk::Box::new(Orientation::Horizontal, 8);
    let validate_button = gtk::Button::builder().label("Validate Bundle").build();
    let flash_button = gtk::Button::builder()
        .label(if is_esp { "Flash ESP32" } else { "Flash STM32" })
        .sensitive(if is_esp {
            esp32_plan.is_ok()
        } else {
            stm32_plan.is_ok()
        })
        .build();
    actions.append(&validate_button);
    actions.append(&flash_button);
    root.append(&actions);
    root.append(&section_label("Update Log"));
    root.append(&log_scroll);

    {
        let log_view = log_view.clone();
        validate_button.connect_clicked(move |_| {
            append_log(&log_view, "Validating bundled firmware assets...");
            match plan_bundled_stm32_dfu() {
                Ok(plan) => append_log(
                    &log_view,
                    &format!("STM32 bundle OK: {}", firmware_plan_summary(&plan)),
                ),
                Err(err) => append_log(&log_view, &format!("STM32 bundle error: {err}")),
            }
            match plan_bundled_esp32s3_serial() {
                Ok(plan) => append_log(
                    &log_view,
                    &format!("ESP32-S3 bundle OK: {}", firmware_plan_summary(&plan)),
                ),
                Err(err) => append_log(&log_view, &format!("ESP32-S3 bundle error: {err}")),
            }
        });
    }
    {
        let log_view = log_view.clone();
        let is_esp = is_esp;
        flash_button.connect_clicked(move |button| {
            button.set_sensitive(false);
            if is_esp {
                append_log(
                    &log_view,
                    "Starting ESP32 serial flash with bundled firmware...",
                );
                append_log(
                    &log_view,
                    "Hold BOOT/RESET as needed so the flash-capable serial port is in bootloader mode.",
                );
                match plan_bundled_esp32s3_serial() {
                    Ok(plan) => match flash_esp32_serial_with_progress(&plan, None, |line| {
                        append_log(&log_view, line)
                    }) {
                        Ok(()) => append_log(
                            &log_view,
                            "ESP32 firmware installed. Reconnect the device in Run Mode.",
                        ),
                        Err(err) => append_log(&log_view, &format!("ESP32 serial flash failed: {err}")),
                    },
                    Err(err) => append_log(&log_view, &format!("ESP32 plan failed: {err}")),
                }
            } else {
                append_log(&log_view, "Starting STM32 DFU flash with bundled firmware...");
                match plan_bundled_stm32_dfu() {
                    Ok(plan) => match flash_stm32_dfu_with_progress(&plan, |line| {
                        append_log(&log_view, line)
                    }) {
                        Ok(()) => append_log(
                            &log_view,
                            "STM32 firmware installed. Disconnect and reconnect the device to continue.",
                        ),
                        Err(err) => {
                            append_log(&log_view, &format!("STM32 DFU flash failed: {err}"))
                        }
                    },
                    Err(err) => append_log(&log_view, &format!("STM32 plan failed: {err}")),
                }
            }
            button.set_sensitive(true);
        });
    }

    content.append(&root);
    dialog.connect_response(|dialog, _| dialog.close());
    dialog.present();
}

fn firmware_status_card(
    selected: Option<&DeviceRecord>,
    board: &str,
    stm32_plan: &Result<FirmwarePlan, emwaver_linux_firmware::FirmwareError>,
    esp32_plan: &Result<FirmwarePlan, emwaver_linux_firmware::FirmwareError>,
    dfu_connected: &Result<bool, emwaver_linux_firmware::FirmwareError>,
) -> gtk::Frame {
    let root = gtk::Box::new(Orientation::Horizontal, 12);
    root.set_margin_top(12);
    root.set_margin_bottom(12);
    root.set_margin_start(12);
    root.set_margin_end(12);
    root.append(&gtk::Image::from_icon_name(
        "software-update-available-symbolic",
    ));
    let copy = gtk::Box::new(Orientation::Vertical, 4);
    copy.set_hexpand(true);
    copy.append(
        &gtk::Label::builder()
            .label(format!("{board} Firmware"))
            .xalign(0.0)
            .css_classes(vec!["heading"])
            .build(),
    );
    copy.append(
        &gtk::Label::builder()
            .label(firmware_status_text(
                selected,
                board,
                stm32_plan,
                esp32_plan,
                dfu_connected,
            ))
            .wrap(true)
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );
    root.append(&copy);
    gtk::Frame::builder().child(&root).build()
}

fn firmware_plan_card(plan: Option<&FirmwarePlan>, title: &str) -> gtk::Frame {
    let root = gtk::Box::new(Orientation::Vertical, 8);
    root.set_margin_top(12);
    root.set_margin_bottom(12);
    root.set_margin_start(12);
    root.set_margin_end(12);
    root.append(&section_label(title));
    if let Some(plan) = plan {
        root.append(
            &gtk::Label::builder()
                .label(firmware_plan_summary(plan))
                .wrap(true)
                .xalign(0.0)
                .css_classes(vec!["dim-label"])
                .build(),
        );
        for image in &plan.images {
            root.append(
                &gtk::Label::builder()
                    .label(match image.offset {
                        Some(offset) => format!("0x{offset:05x}  {}", image.path),
                        None => image.path.clone(),
                    })
                    .wrap(true)
                    .xalign(0.0)
                    .css_classes(vec!["monospace"])
                    .build(),
            );
        }
    } else {
        root.append(
            &gtk::Label::builder()
                .label("Bundled firmware assets are missing or invalid. Validate the bundle for details.")
                .wrap(true)
                .xalign(0.0)
                .css_classes(vec!["dim-label"])
                .build(),
        );
    }
    gtk::Frame::builder().child(&root).build()
}

fn firmware_status_text(
    selected: Option<&DeviceRecord>,
    board: &str,
    stm32_plan: &Result<FirmwarePlan, emwaver_linux_firmware::FirmwareError>,
    esp32_plan: &Result<FirmwarePlan, emwaver_linux_firmware::FirmwareError>,
    dfu_connected: &Result<bool, emwaver_linux_firmware::FirmwareError>,
) -> String {
    let mut lines = Vec::new();
    lines.push(
        selected
            .map(|device| format!("Selected device: {}", device.display_name))
            .unwrap_or_else(|| "No run-mode device selected.".to_string()),
    );
    lines.push(match dfu_connected {
        Ok(true) => "STM32 update mode detected.".to_string(),
        Ok(false) => "STM32 update mode not detected.".to_string(),
        Err(err) => format!("STM32 update-mode probe failed: {err}"),
    });
    if board.starts_with("ESP32") {
        lines.push(match esp32_plan {
            Ok(plan) => format!(
                "ESP32 bundled image plan ready: {} images.",
                plan.images.len()
            ),
            Err(err) => format!("ESP32 bundled image plan failed: {err}"),
        });
        lines.push("ESP32 serial flashing uses the bundled esptool-compatible helper with fixed-offset images. Manual BOOT/RESET may be required on development boards.".to_string());
    } else {
        lines.push(match stm32_plan {
            Ok(plan) => format!("STM32 bundled DFU plan ready: {} image.", plan.images.len()),
            Err(err) => format!("STM32 bundled DFU plan failed: {err}"),
        });
    }
    lines.join("\n")
}

fn firmware_initial_log(
    board: &str,
    stm32_plan: &Result<FirmwarePlan, emwaver_linux_firmware::FirmwareError>,
    esp32_plan: &Result<FirmwarePlan, emwaver_linux_firmware::FirmwareError>,
    dfu_connected: &Result<bool, emwaver_linux_firmware::FirmwareError>,
) -> String {
    let mut lines = vec![format!("Firmware sheet opened for {board}.")];
    lines.push(match dfu_connected {
        Ok(true) => "STM32 DFU: update-mode device is present.".to_string(),
        Ok(false) => "STM32 DFU: no update-mode device detected.".to_string(),
        Err(err) => format!("STM32 DFU probe error: {err}"),
    });
    lines.push(match stm32_plan {
        Ok(plan) => format!("STM32 plan: {}", firmware_plan_summary(plan)),
        Err(err) => format!("STM32 plan error: {err}"),
    });
    lines.push(match esp32_plan {
        Ok(plan) => format!("ESP32-S3 plan: {}", firmware_plan_summary(plan)),
        Err(err) => format!("ESP32-S3 plan error: {err}"),
    });
    lines.join("\n") + "\n"
}

fn firmware_plan_summary(plan: &FirmwarePlan) -> String {
    let target = match plan.target {
        FirmwareTarget::Stm32Dfu => "STM32 DFU",
        FirmwareTarget::Esp32Serial => "ESP32 serial",
    };
    format!(
        "{target}, {} image{}, manual bootloader: {}",
        plan.images.len(),
        if plan.images.len() == 1 { "" } else { "s" },
        if plan.requires_manual_bootloader {
            "yes"
        } else {
            "no"
        }
    )
}

fn device_detail_line(device: &DeviceRecord) -> String {
    let mut parts = vec![transport_label(&device.transport).to_string()];
    if let Some(version) = device.firmware_version.as_ref() {
        parts.push(format!("EMWaver {version}"));
    }
    if let Some(uid) = device.hardware_uid.as_ref() {
        parts.push(format!("UID {}", uid_suffix(uid)));
    }
    if device.busy {
        parts.push("busy".to_string());
    } else if device.connected {
        parts.push("ready".to_string());
    } else {
        parts.push("unavailable".to_string());
    }
    parts.join("  ")
}

fn transport_label(transport: &TransportKind) -> &'static str {
    match transport {
        TransportKind::Ble => "BLE",
        TransportKind::Wifi => "Wi-Fi",
        TransportKind::Simulator => "Internal test transport",
        TransportKind::UsbMidi => "USB MIDI",
        TransportKind::UsbSerial => "USB Serial",
        TransportKind::UsbVendor => "USB",
    }
}

fn transport_sort_key(transport: &TransportKind) -> u8 {
    match transport {
        TransportKind::UsbMidi | TransportKind::UsbSerial | TransportKind::UsbVendor => 0,
        TransportKind::Wifi => 1,
        TransportKind::Ble => 2,
        TransportKind::Simulator => 3,
    }
}

fn transport_icon_name(transport: &TransportKind) -> &'static str {
    match transport {
        TransportKind::Ble => "network-wireless-symbolic",
        TransportKind::Wifi => "network-wireless-symbolic",
        TransportKind::Simulator => "dialog-information-symbolic",
        TransportKind::UsbMidi | TransportKind::UsbSerial | TransportKind::UsbVendor => {
            "network-wired-symbolic"
        }
    }
}

fn append_log(log_view: &gtk::TextView, line: &str) {
    let buffer = log_view.buffer();
    let mut end = buffer.end_iter();
    buffer.insert(&mut end, &format!("{line}\n"));
}

fn drain_pending_ui_events() {
    let context = gtk::glib::MainContext::default();
    while context.pending() {
        context.iteration(false);
    }
}

fn add_shortcuts(app: &adw::Application, window: &adw::ApplicationWindow) {
    let quit = gio::SimpleAction::new("quit", None);
    let quit_window = window.clone();
    quit.connect_activate(move |_, _| quit_window.close());
    app.add_action(&quit);
    app.set_accels_for_action("app.quit", &["<primary>q"]);

    let about = gio::SimpleAction::new("about", None);
    let about_parent = window.clone();
    about.connect_activate(move |_, _| {
        let dialog = gtk::AboutDialog::builder()
            .transient_for(&about_parent)
            .modal(true)
            .program_name("EMWaver")
            .logo_icon_name("com.continualmi.EMWaver")
            .authors(vec!["Continual MI"])
            .version(env!("CARGO_PKG_VERSION"))
            .build();
        dialog.present();
    });
    app.add_action(&about);
}
