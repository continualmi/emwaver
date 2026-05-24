use adw::prelude::*;
use emwaver_linux_agent::{
    clear_agent_api_key_secret_tool, load_agent_configuration, save_agent_endpoint,
    store_agent_api_key_secret_tool, AgentClient, AgentCredentialSource, AgentRequest,
};
use emwaver_linux_core::{
    default_script_template, AppModel, DeviceRecord, ScriptListItem, ScriptRepository,
    TransportKind,
};
use emwaver_linux_firmware::{
    esp32_flash::{flash_esp32_serial_with_progress, plan_bundled_esp32s3_serial},
    stm32_dfu::{flash_stm32_dfu_with_progress, is_stm32_dfu_connected, plan_bundled_stm32_dfu},
    FirmwarePlan, FirmwareTarget,
};
use emwaver_linux_runtime::execute_javascript;
use emwaver_linux_transport::{
    simulator::SimulatorTransport,
    usb::{
        LinuxUsbManager, LinuxUsbMidiTransport, UsbAccessState, UsbDeviceCandidate, UsbDeviceRole,
    },
    wifi::{LinuxWifiManager, LinuxWifiTransport, ManualWifiTarget},
    EmwaverTransport,
};
use gtk::glib::object::IsA;
use gtk::{gio, Align, Orientation, PolicyType};
use sourceview5::prelude::*;
use std::cell::RefCell;
use std::env;
use std::rc::Rc;

pub fn build_main_window(app: &adw::Application) {
    let model = Rc::new(RefCell::new(AppModel::default()));
    let script_repository = Rc::new(ScriptRepository::default());
    let script_items = Rc::new(RefCell::new(Vec::<ScriptListItem>::new()));
    let script_row_indices = Rc::new(RefCell::new(Vec::<Option<usize>>::new()));
    let selected_script = Rc::new(RefCell::new(None::<ScriptListItem>));
    seed_simulator_device(&model);
    seed_usb_devices(&model);
    seed_mdns_wifi_devices(&model);
    seed_manual_wifi_device(&model);

    let window = adw::ApplicationWindow::builder()
        .application(app)
        .title("EMWaver")
        .default_width(1180)
        .default_height(780)
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

    let run_button = gtk::Button::builder()
        .icon_name("media-playback-start-symbolic")
        .tooltip_text("Run selected script")
        .build();
    let stop_button = gtk::Button::builder()
        .icon_name("media-playback-stop-symbolic")
        .tooltip_text("Stop active script")
        .build();
    header.pack_start(&run_button);
    header.pack_start(&stop_button);
    let agent_toggle_button = gtk::ToggleButton::builder()
        .icon_name("chat-message-new-symbolic")
        .tooltip_text("Show Agent")
        .build();
    header.pack_start(&agent_toggle_button);

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
    header.pack_end(&selected_device_box);

    let firmware_button = gtk::Button::builder()
        .icon_name("software-update-available-symbolic")
        .tooltip_text("Firmware")
        .build();
    let settings_button = gtk::Button::builder()
        .icon_name("emblem-system-symbolic")
        .tooltip_text("Settings")
        .build();
    header.pack_end(&settings_button);
    header.pack_end(&firmware_button);

    let device_list = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::Single)
        .css_classes(vec!["boxed-list"])
        .build();
    let device_keys = Rc::new(RefCell::new(refresh_device_list(
        &device_list,
        &model.borrow().devices(),
    )));
    device_list.select_row(device_list.row_at_index(0).as_ref());

    let source_buffer = make_source_buffer();
    let editor = sourceview5::View::builder()
        .buffer(&source_buffer)
        .monospace(true)
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
    let editor_scroll = gtk::ScrolledWindow::builder()
        .hexpand(true)
        .vexpand(true)
        .hscrollbar_policy(PolicyType::Automatic)
        .vscrollbar_policy(PolicyType::Automatic)
        .child(&editor)
        .build();
    let preview_label = gtk::Label::builder()
        .label("Run a script to preview its UI here.")
        .wrap(true)
        .xalign(0.0)
        .yalign(0.0)
        .margin_top(16)
        .margin_bottom(16)
        .margin_start(16)
        .margin_end(16)
        .css_classes(vec!["dim-label"])
        .build();
    let preview_scroll = gtk::ScrolledWindow::builder()
        .hexpand(true)
        .vexpand(true)
        .hscrollbar_policy(PolicyType::Automatic)
        .vscrollbar_policy(PolicyType::Automatic)
        .child(&preview_label)
        .build();
    let editor_stack = gtk::Stack::builder()
        .hexpand(true)
        .vexpand(true)
        .transition_type(gtk::StackTransitionType::Crossfade)
        .build();
    editor_stack.add_named(&editor_scroll, Some("editor"));
    editor_stack.add_named(&preview_scroll, Some("preview"));
    editor_stack.set_visible_child_name("editor");
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
        .tooltip_text("Toggle script preview")
        .build();

    let log_view = gtk::TextView::builder()
        .editable(false)
        .monospace(true)
        .cursor_visible(false)
        .top_margin(10)
        .bottom_margin(10)
        .left_margin(10)
        .right_margin(10)
        .build();
    log_view
        .buffer()
        .set_text("Simulator ready. Local scripts run without an Agent key.\n");
    let log_scroll = gtk::ScrolledWindow::builder()
        .hexpand(true)
        .vexpand(true)
        .min_content_height(150)
        .hscrollbar_policy(PolicyType::Automatic)
        .vscrollbar_policy(PolicyType::Automatic)
        .child(&log_view)
        .build();

    let firmware_panel = status_panel(
        "Firmware",
        "Managed STM32 DFU and ESP32 serial update flows stay local and board-aware.",
    );

    let sidebar = gtk::Box::new(Orientation::Vertical, 12);
    sidebar.set_margin_top(12);
    sidebar.set_margin_bottom(12);
    sidebar.set_margin_start(12);
    sidebar.set_margin_end(12);
    sidebar.append(&section_label("Devices"));
    sidebar.append(&device_list);
    sidebar.append(&firmware_panel);

    let agent_messages = gtk::Box::new(Orientation::Vertical, 8);
    agent_messages.set_margin_top(8);
    agent_messages.set_margin_bottom(8);
    agent_messages.set_margin_start(8);
    agent_messages.set_margin_end(8);
    append_agent_message(
        &agent_messages,
        "Agent",
        "Add an MGPT API key to enable Agent replies. Local scripts and hardware stay available without it.",
    );
    let agent_input = gtk::TextView::builder()
        .wrap_mode(gtk::WrapMode::WordChar)
        .top_margin(8)
        .bottom_margin(8)
        .left_margin(8)
        .right_margin(8)
        .height_request(72)
        .build();
    let agent_status_label = gtk::Label::builder()
        .label(agent_status_text())
        .wrap(true)
        .xalign(0.0)
        .css_classes(vec!["dim-label"])
        .build();
    let agent_send_button = gtk::Button::builder()
        .label("Send")
        .tooltip_text("Send message to Agent")
        .build();
    let agent_stop_button = gtk::Button::builder()
        .label("Stop")
        .tooltip_text("Stop Agent request")
        .sensitive(false)
        .build();
    let agent_panel = build_agent_panel(
        &agent_messages,
        &agent_input,
        &agent_status_label,
        &agent_send_button,
        &agent_stop_button,
    );

    let script_list = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::Single)
        .css_classes(vec!["boxed-list"])
        .build();
    let script_search_entry = gtk::SearchEntry::builder()
        .placeholder_text("Search scripts")
        .hexpand(true)
        .build();

    let library = gtk::Box::new(Orientation::Vertical, 10);
    library.set_margin_top(12);
    library.set_margin_bottom(12);
    library.set_margin_start(12);
    library.set_margin_end(12);
    library.append(&section_label("Scripts"));
    library.append(&script_search_entry);
    library.append(&script_list);

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
    content.set_start_child(Some(&library));
    content.set_resize_start_child(false);
    content.set_shrink_start_child(false);

    let workspace = gtk::Paned::new(Orientation::Horizontal);
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
    main_stack.append(&section_label("Run Log"));
    main_stack.append(&log_scroll);
    workspace.set_start_child(Some(&main_stack));
    workspace.set_resize_start_child(true);
    workspace.set_shrink_start_child(false);
    workspace.set_end_child(Some(&sidebar));
    workspace.set_resize_end_child(false);
    workspace.set_shrink_end_child(false);

    let agent_workspace = gtk::Paned::new(Orientation::Horizontal);
    agent_workspace.set_start_child(Some(&workspace));
    agent_workspace.set_resize_start_child(true);
    agent_workspace.set_shrink_start_child(false);
    agent_workspace.set_end_child(Some(&agent_panel));
    agent_workspace.set_resize_end_child(false);
    agent_workspace.set_shrink_end_child(false);
    agent_panel.set_visible(false);
    content.set_end_child(Some(&agent_workspace));

    let root = gtk::Box::new(Orientation::Vertical, 0);
    root.append(&header);
    root.append(&content);
    window.set_content(Some(&root));

    let active_session = Rc::new(RefCell::new(None));
    {
        let agent_panel = agent_panel.clone();
        agent_toggle_button.connect_toggled(move |button| {
            let active = button.is_active();
            agent_panel.set_visible(active);
            button.set_tooltip_text(Some(if active { "Hide Agent" } else { "Show Agent" }));
        });
    }
    {
        let agent_input = agent_input.clone();
        let agent_messages = agent_messages.clone();
        let agent_status_label = agent_status_label.clone();
        let source_buffer = source_buffer.clone();
        let model = Rc::clone(&model);
        let log_view = log_view.clone();
        agent_send_button.connect_clicked(move |_| {
            let buffer = agent_input.buffer();
            let message = buffer
                .text(&buffer.start_iter(), &buffer.end_iter(), true)
                .trim()
                .to_string();
            if message.is_empty() {
                return;
            }
            buffer.set_text("");
            append_agent_message(&agent_messages, "You", &message);
            match send_agent_message(
                &message,
                &source_buffer,
                &model.borrow().selected_device(),
                &log_view,
            ) {
                Ok(reply) => append_agent_message(&agent_messages, "Agent", &reply),
                Err(err) => append_agent_message(&agent_messages, "Agent", &err),
            }
            let status = agent_status_text();
            agent_status_label.set_label(&status);
        });
    }
    {
        agent_stop_button.connect_clicked(|_| {});
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
        let run_button = run_button.clone();
        let save_script_button = save_script_button.clone();
        script_list.connect_row_selected(move |_, row| {
            let Some(row) = row else { return };
            let Some(script_index) = ({
                let rows = script_row_indices.borrow();
                rows.get(row.index() as usize).copied().flatten()
            }) else {
                return;
            };
            let Some(item) = script_items.borrow().get(script_index).cloned() else {
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
                    run_button.set_sensitive(item.is_runnable());
                    save_script_button.set_sensitive(item.is_editable());
                    *selected_script.borrow_mut() = Some(item);
                }
                Err(err) => {
                    script_title.set_label("Script Load Failed");
                    script_kind.set_label(&err.to_string());
                    run_button.set_sensitive(false);
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
        new_script_button.connect_clicked(move |_| {
            match script_repository.create_script("script.js", default_script_template()) {
                Ok(item) => {
                    append_log(&log_view, &format!("Created local script {}.", item.name));
                    refresh_script_list(
                        &script_list,
                        &script_repository,
                        &script_items,
                        &script_row_indices,
                        &log_view,
                        script_search_entry.text().as_str(),
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
        script_search_entry.connect_search_changed(move |entry| {
            refresh_script_list(
                &script_list,
                &script_repository,
                &script_items,
                &script_row_indices,
                &log_view,
                entry.text().as_str(),
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
        let preview_label = preview_label.clone();
        let selected_script = Rc::clone(&selected_script);
        preview_button.connect_toggled(move |button| {
            if button.is_active() {
                let name = selected_script
                    .borrow()
                    .as_ref()
                    .map(|script| script.name.clone())
                    .unwrap_or_else(|| "No script".to_string());
                preview_label.set_label(&format!(
                    "{name} preview\n\nScript UI rendering will appear here after the Linux ScriptRenderView parity layer is ported. Running a script still uses the local runtime and selected device."
                ));
                editor_stack.set_visible_child_name("preview");
            } else {
                editor_stack.set_visible_child_name("editor");
            }
        });
    }
    {
        let model = Rc::clone(&model);
        let selected_device_label = selected_device_label.clone();
        let device_keys = Rc::clone(&device_keys);
        device_list.connect_row_selected(move |_, row| {
            let Some(row) = row else { return };
            let Some(key) = device_keys.borrow().get(row.index() as usize).cloned() else {
                return;
            };
            model.borrow_mut().select_device(key);
            selected_device_label
                .set_label(&selected_device_title(&model.borrow().selected_device()));
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
        let window = window.clone();
        settings_button.connect_clicked(move |_| {
            present_settings_dialog(&window);
        });
    }
    {
        let model = Rc::clone(&model);
        let source_buffer = source_buffer.clone();
        let selected_script = Rc::clone(&selected_script);
        let log_view = log_view.clone();
        let active_session = Rc::clone(&active_session);
        run_button.connect_clicked(move |_| {
            let Some(item) = selected_script.borrow().clone() else {
                append_log(&log_view, "No selected script.");
                return;
            };
            if !item.is_runnable() {
                append_log(&log_view, &format!("{} is not runnable.", item.name));
                return;
            }
            let source = source_buffer
                .text(&source_buffer.start_iter(), &source_buffer.end_iter(), true)
                .to_string();
            let result = model.borrow_mut().run_script(&item.name, source);
            match result {
                Ok(session) => {
                    *active_session.borrow_mut() = Some(session.id);
                    append_log(
                        &log_view,
                        &format!(
                            "Started script session on {}.",
                            selected_device_title(&model.borrow().selected_device())
                        ),
                    );
                    let execution_log = run_selected_script(
                        &model.borrow().selected_device(),
                        &source_buffer
                            .text(&source_buffer.start_iter(), &source_buffer.end_iter(), true)
                            .to_string(),
                    );
                    for line in execution_log {
                        append_log(&log_view, &line);
                    }
                    match model.borrow_mut().stop_script(session.id) {
                        Ok(_) => append_log(&log_view, "Script session completed."),
                        Err(err) => {
                            append_log(&log_view, &format!("Session cleanup failed: {err}"))
                        }
                    }
                    *active_session.borrow_mut() = None;
                }
                Err(err) => append_log(&log_view, &format!("Run failed: {err}")),
            }
        });
    }
    {
        let model = Rc::clone(&model);
        let log_view = log_view.clone();
        let active_session = Rc::clone(&active_session);
        stop_button.connect_clicked(move |_| {
            let Some(session_id) = active_session.borrow_mut().take() else {
                append_log(&log_view, "No active script session.");
                return;
            };
            match model.borrow_mut().stop_script(session_id) {
                Ok(_) => append_log(&log_view, "Stopped simulator script session."),
                Err(err) => append_log(&log_view, &format!("Stop failed: {err}")),
            }
        });
    }

    add_shortcuts(app, &window);
    window.present();
}

fn run_selected_script(device: &Option<DeviceRecord>, source: &str) -> Vec<String> {
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
        TransportKind::Simulator => runtime.block_on(async {
            let mut transport = match SimulatorTransport::default_fixture() {
                Ok(transport) => transport,
                Err(err) => return vec![format!("Simulator setup failed: {err}")],
            };
            if let Err(err) = transport.connect().await {
                return vec![format!("Simulator connect failed: {err}")];
            }
            match execute_javascript(source, &mut transport).await {
                Ok(report) => report.log,
                Err(err) => vec![format!("Script failed: {err}")],
            }
        }),
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
            let result = execute_javascript(source, &mut transport).await;
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
            let result = execute_javascript(source, &mut transport).await;
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

fn display_board_type(board: &str) -> &'static str {
    match board.trim().to_ascii_lowercase().as_str() {
        "esp32s3" | "esp32-s3" => "ESP32-S3",
        "esp32s2" | "esp32-s2" => "ESP32-S2",
        "esp32" => "ESP32",
        _ => "ESP32",
    }
}

fn seed_simulator_device(model: &Rc<RefCell<AppModel>>) {
    let Ok(transport) = SimulatorTransport::default_fixture() else {
        return;
    };
    let descriptor = transport.descriptor();
    let mut device = DeviceRecord::new(
        descriptor.id.0,
        descriptor.display_name,
        TransportKind::Simulator,
        descriptor.hardware_uid,
    );
    device.firmware_version = descriptor.firmware_version;
    device.connected = true;
    model.borrow_mut().upsert_device(device);
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

fn refresh_device_list(list: &gtk::ListBox, devices: &[DeviceRecord]) -> Vec<String> {
    while let Some(row) = list.first_child() {
        list.remove(&row);
    }
    let mut keys = Vec::new();
    for device in devices {
        keys.push(device.identity_key());
        let row = gtk::Box::new(Orientation::Vertical, 2);
        row.set_margin_top(10);
        row.set_margin_bottom(10);
        row.set_margin_start(10);
        row.set_margin_end(10);
        row.append(
            &gtk::Label::builder()
                .label(&device.display_name)
                .xalign(0.0)
                .build(),
        );
        row.append(
            &gtk::Label::builder()
                .label(format!(
                    "{:?}  {}",
                    device.transport,
                    device.hardware_uid.as_deref().unwrap_or("no uid")
                ))
                .xalign(0.0)
                .css_classes(vec!["dim-label"])
                .build(),
        );
        let item = gtk::ListBoxRow::builder().child(&row).build();
        item.set_activatable(true);
        item.set_selectable(true);
        list.append(&item);
    }
    keys
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

fn build_agent_panel(
    messages: &gtk::Box,
    input: &gtk::TextView,
    status: &gtk::Label,
    send_button: &gtk::Button,
    stop_button: &gtk::Button,
) -> gtk::Frame {
    let root = gtk::Box::new(Orientation::Vertical, 8);
    root.set_size_request(340, -1);
    root.set_margin_top(10);
    root.set_margin_bottom(10);
    root.set_margin_start(10);
    root.set_margin_end(10);

    let header = gtk::Box::new(Orientation::Horizontal, 8);
    let title = gtk::Box::new(Orientation::Vertical, 2);
    title.set_hexpand(true);
    title.append(
        &gtk::Label::builder()
            .label("Agent")
            .xalign(0.0)
            .css_classes(vec!["heading"])
            .build(),
    );
    title.append(
        &gtk::Label::builder()
            .label("MGPT · /api/mgpt/respond")
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );
    let key_button = gtk::Button::builder()
        .label("API Key")
        .tooltip_text("Configure Agent API key")
        .build();
    header.append(&title);
    header.append(&key_button);
    root.append(&header);

    let conversation_row = gtk::Box::new(Orientation::Horizontal, 6);
    let conversation = gtk::DropDown::from_strings(&["Chat"]);
    conversation.set_hexpand(true);
    let new_chat = gtk::Button::builder()
        .icon_name("list-add-symbolic")
        .tooltip_text("New Agent chat")
        .build();
    let rename_chat = gtk::Button::builder()
        .icon_name("document-edit-symbolic")
        .tooltip_text("Rename Agent chat")
        .build();
    let delete_chat = gtk::Button::builder()
        .icon_name("user-trash-symbolic")
        .tooltip_text("Delete Agent chat")
        .build();
    conversation_row.append(&conversation);
    conversation_row.append(&new_chat);
    conversation_row.append(&rename_chat);
    conversation_row.append(&delete_chat);
    root.append(&conversation_row);

    let setup = gtk::Label::builder()
        .label("Agent replies require a public /api/mgpt/... endpoint and API key in Settings or environment. Local scripts, devices, and firmware remain available without them.")
        .wrap(true)
        .xalign(0.0)
        .css_classes(vec!["dim-label"])
        .visible(!agent_configured())
        .build();
    root.append(&setup);

    let suggestion_grid = gtk::Grid::builder()
        .column_spacing(6)
        .row_spacing(6)
        .build();
    let suggestions = [
        (
            "Connect over USB",
            "How do I connect an EMWaver device over USB?",
        ),
        (
            "Script a board",
            "Help me write a script for a connected board.",
        ),
        ("Blink GPIO", "Help me write a script to blink a GPIO pin."),
        ("IR capture", "How do I capture and replay an IR remote?"),
    ];
    for (index, (label, prompt)) in suggestions.iter().enumerate() {
        let button = gtk::Button::builder().label(*label).build();
        let input = input.clone();
        let prompt = prompt.to_string();
        button.connect_clicked(move |_| {
            input.buffer().set_text(&prompt);
            input.grab_focus();
        });
        suggestion_grid.attach(&button, (index % 2) as i32, (index / 2) as i32, 1, 1);
    }
    root.append(&suggestion_grid);

    let messages_scroll = gtk::ScrolledWindow::builder()
        .hexpand(true)
        .vexpand(true)
        .hscrollbar_policy(PolicyType::Never)
        .vscrollbar_policy(PolicyType::Automatic)
        .child(messages)
        .build();
    root.append(&messages_scroll);

    let composer = gtk::Box::new(Orientation::Vertical, 6);
    let status_row = gtk::Box::new(Orientation::Horizontal, 6);
    status_row.append(status);
    status_row.append(stop_button);
    composer.append(&status_row);
    let input_row = gtk::Box::new(Orientation::Horizontal, 6);
    let input_scroll = gtk::ScrolledWindow::builder()
        .hexpand(true)
        .hscrollbar_policy(PolicyType::Never)
        .vscrollbar_policy(PolicyType::Automatic)
        .child(input)
        .build();
    input_row.append(&input_scroll);
    input_row.append(send_button);
    composer.append(&input_row);
    root.append(&composer);

    {
        let setup = setup.clone();
        key_button.connect_clicked(move |_| {
            setup.set_label("Open Settings to store the Agent API key with Secret Service, or set EMWAVER_AGENT_ENDPOINT and EMWAVER_AGENT_API_KEY for development.");
            setup.set_visible(true);
        });
    }
    {
        let messages = messages.clone();
        new_chat.connect_clicked(move |_| {
            while let Some(child) = messages.first_child() {
                messages.remove(&child);
            }
            append_agent_message(
                &messages,
                "Agent",
                "New local Agent chat. The current script and device context are sent with each request when an API key is configured.",
            );
        });
    }
    {
        let messages = messages.clone();
        rename_chat.connect_clicked(move |_| {
            append_agent_message(
                &messages,
                "Agent",
                "Rename chat UI is pending local chat persistence.",
            );
        });
    }
    {
        let messages = messages.clone();
        delete_chat.connect_clicked(move |_| {
            while let Some(child) = messages.first_child() {
                messages.remove(&child);
            }
            append_agent_message(&messages, "Agent", "Agent messages cleared.");
        });
    }

    gtk::Frame::builder().child(&root).build()
}

fn append_agent_message(messages: &gtk::Box, role: &str, text: &str) {
    let bubble = gtk::Box::new(Orientation::Vertical, 3);
    bubble.set_margin_top(6);
    bubble.set_margin_bottom(6);
    bubble.set_margin_start(6);
    bubble.set_margin_end(6);
    bubble.append(
        &gtk::Label::builder()
            .label(role)
            .xalign(0.0)
            .css_classes(vec!["heading"])
            .build(),
    );
    bubble.append(
        &gtk::Label::builder()
            .label(text)
            .wrap(true)
            .selectable(true)
            .xalign(0.0)
            .build(),
    );
    messages.append(&gtk::Frame::builder().child(&bubble).build());
}

fn agent_configured() -> bool {
    let config = load_agent_configuration();
    config
        .api_key
        .as_ref()
        .is_some_and(|key| !key.trim().is_empty())
        && config
            .endpoint
            .as_ref()
            .is_some_and(|endpoint| endpoint.contains("/api/mgpt/"))
}

fn agent_status_text() -> String {
    if agent_configured() {
        "The Agent sees your message, selected script, selected device, and recent run log."
            .to_string()
    } else {
        "Agent key missing. Local scripts and hardware stay available.".to_string()
    }
}

fn send_agent_message(
    message: &str,
    source_buffer: &sourceview5::Buffer,
    selected_device: &Option<DeviceRecord>,
    log_view: &gtk::TextView,
) -> Result<String, String> {
    let config = load_agent_configuration();
    let Some(api_key) = config.api_key.filter(|key| !key.trim().is_empty()) else {
        return Err(
            "Add an MGPT API key to enable Agent replies. Local scripts and hardware are still available."
                .to_string(),
        );
    };
    let endpoint = config
        .endpoint
        .ok_or_else(|| "Set the Agent endpoint to a public /api/mgpt/... route.".to_string())?;
    let client = AgentClient::new(endpoint, Some(api_key)).map_err(|err| err.to_string())?;
    let selected_script = source_buffer
        .text(&source_buffer.start_iter(), &source_buffer.end_iter(), true)
        .to_string();
    let log_buffer = log_view.buffer();
    let logs = log_buffer
        .text(&log_buffer.start_iter(), &log_buffer.end_iter(), true)
        .lines()
        .rev()
        .take(16)
        .map(str::to_string)
        .collect::<Vec<_>>();
    let request = AgentRequest {
        universe: None,
        user_input: message.to_string(),
        selected_script: Some(selected_script),
        device_summary: Some(selected_device_title(selected_device)),
        recent_logs: logs,
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|err| format!("Failed to create Agent runtime: {err}"))?;
    runtime
        .block_on(client.send(&request))
        .map(|response| response.message)
        .map_err(|err| err.to_string())
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
            append_script_row(list, &mut row_indices, &script, index);
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
) {
    let row = gtk::Box::new(Orientation::Vertical, 2);
    row.set_margin_top(10);
    row.set_margin_bottom(10);
    row.set_margin_start(10);
    row.set_margin_end(10);
    row.append(
        &gtk::Label::builder()
            .label(&script.name)
            .xalign(0.0)
            .ellipsize(gtk::pango::EllipsizeMode::End)
            .build(),
    );
    row.append(
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

fn status_panel(title: &str, body: &str) -> gtk::Frame {
    let panel = gtk::Box::new(Orientation::Vertical, 4);
    panel.set_margin_top(10);
    panel.set_margin_bottom(10);
    panel.set_margin_start(10);
    panel.set_margin_end(10);
    panel.append(
        &gtk::Label::builder()
            .label(title)
            .xalign(0.0)
            .css_classes(vec!["heading"])
            .build(),
    );
    panel.append(
        &gtk::Label::builder()
            .label(body)
            .wrap(true)
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );
    gtk::Frame::builder().child(&panel).build()
}

fn selected_device_title(device: &Option<DeviceRecord>) -> String {
    device
        .as_ref()
        .map(|device| device.display_name.clone())
        .unwrap_or_else(|| "No Device".to_string())
}

fn present_settings_dialog(parent: &adw::ApplicationWindow) {
    let config = load_agent_configuration();
    let dialog = gtk::Dialog::builder()
        .transient_for(parent)
        .modal(true)
        .title("Settings")
        .default_width(720)
        .default_height(520)
        .build();
    dialog.add_button("Close", gtk::ResponseType::Close);
    dialog.add_button("Clear Agent Key", gtk::ResponseType::Other(1));
    dialog.add_button("Save", gtk::ResponseType::Accept);

    let root = gtk::Box::new(Orientation::Vertical, 16);
    root.set_margin_top(20);
    root.set_margin_bottom(20);
    root.set_margin_start(20);
    root.set_margin_end(20);

    let agent_card = gtk::Box::new(Orientation::Vertical, 10);
    agent_card.set_margin_top(12);
    agent_card.set_margin_bottom(12);
    agent_card.set_margin_start(12);
    agent_card.set_margin_end(12);
    agent_card.append(&section_label("Agent"));
    agent_card.append(
        &gtk::Label::builder()
            .label("Add an MGPT API key to enable Agent replies. Local scripts, device control, and firmware update remain available without a key.")
            .wrap(true)
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );

    let endpoint_entry = gtk::Entry::builder()
        .placeholder_text("https://.../api/mgpt/respond")
        .text(config.endpoint.as_deref().unwrap_or(""))
        .hexpand(true)
        .build();
    let endpoint_row = settings_row("Endpoint", &endpoint_entry);
    agent_card.append(&endpoint_row);

    let key_entry = gtk::Entry::builder()
        .placeholder_text(match config.api_key_source {
            AgentCredentialSource::Env => "Configured by environment",
            AgentCredentialSource::SecretService => "Stored in Secret Service",
            AgentCredentialSource::Missing => "Paste API key to store locally",
        })
        .visibility(false)
        .hexpand(true)
        .build();
    let key_row = settings_row("API Key", &key_entry);
    agent_card.append(&key_row);

    let key_source = match config.api_key_source {
        AgentCredentialSource::Env => "Current key source: environment variable. Saving here stores a new Secret Service key, but the environment value keeps priority until unset.",
        AgentCredentialSource::SecretService => "Current key source: Secret Service.",
        AgentCredentialSource::Missing => "No Agent key is configured.",
    };
    let status = gtk::Label::builder()
        .label(key_source)
        .wrap(true)
        .xalign(0.0)
        .css_classes(vec!["dim-label"])
        .build();
    agent_card.append(&status);
    root.append(&gtk::Frame::builder().child(&agent_card).build());

    let device_card = gtk::Box::new(Orientation::Vertical, 8);
    device_card.set_margin_top(12);
    device_card.set_margin_bottom(12);
    device_card.set_margin_start(12);
    device_card.set_margin_end(12);
    device_card.append(&section_label("Device Access"));
    device_card.append(
        &gtk::Label::builder()
            .label("Local scripts and hardware control work immediately without an EMWaver account, cloud activation, subscription check, or Agent key.")
            .wrap(true)
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );
    root.append(&gtk::Frame::builder().child(&device_card).build());

    let diagnostics_card = gtk::Box::new(Orientation::Vertical, 8);
    diagnostics_card.set_margin_top(12);
    diagnostics_card.set_margin_bottom(12);
    diagnostics_card.set_margin_start(12);
    diagnostics_card.set_margin_end(12);
    diagnostics_card.append(&section_label("Device Diagnostics"));
    diagnostics_card.append(
        &gtk::CheckButton::builder()
            .label("Log transport packets on ESP serial")
            .active(true)
            .tooltip_text("Matches the macOS debug logging preference; Linux persistence for this toggle is staged with the settings store.")
            .build(),
    );
    diagnostics_card.append(
        &gtk::Label::builder()
            .label("When enabled, ESP32-S3 firmware logs BLE, USB, and Wi-Fi command packets on the serial monitor. The app can turn firmware transport logging off after connection metadata checks.")
            .wrap(true)
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );
    root.append(&gtk::Frame::builder().child(&diagnostics_card).build());

    dialog.content_area().append(&root);

    dialog.connect_response(move |dialog, response| match response {
        gtk::ResponseType::Accept => {
            let endpoint = endpoint_entry.text().to_string();
            match save_agent_endpoint(Some(&endpoint)) {
                Ok(()) => {
                    let key = key_entry.text().to_string();
                    if key.trim().is_empty() {
                        status.set_label("Saved Agent endpoint. Existing Agent key was unchanged.");
                    } else {
                        match store_agent_api_key_secret_tool(&key) {
                            Ok(()) => status
                                .set_label("Saved Agent endpoint and API key to Secret Service."),
                            Err(err) => status.set_label(&format!(
                                "Saved endpoint, but Secret Service key storage failed: {err}"
                            )),
                        }
                    }
                }
                Err(err) => status.set_label(&err.to_string()),
            }
        }
        gtk::ResponseType::Other(1) => match clear_agent_api_key_secret_tool() {
            Ok(()) => status.set_label("Cleared Agent API key from Secret Service."),
            Err(err) => status.set_label(&format!("Secret Service clear failed: {err}")),
        },
        _ => dialog.close(),
    });
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

fn present_device_dialog(parent: &adw::ApplicationWindow, devices: &[DeviceRecord]) {
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

    let selected = devices.iter().find(|device| device.connected);
    root.append(&device_status_card(selected));
    root.append(&local_devices_card(devices));
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
            .label("Discovered USB, BLE, Wi-Fi, and simulator transports are grouped by local hardware UID when available.")
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
        .label("Set EMWAVER_WIFI_HOST and optional EMWAVER_WIFI_PORT before launch to add this manual Wi-Fi target to the local device list. mDNS discovery is still pending behind Avahi/D-Bus.")
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
    } else if matches!(device.transport, TransportKind::Simulator) {
        "Simulator".to_string()
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

fn present_status_dialog(parent: &adw::ApplicationWindow, title: &str, body: &str) {
    let dialog = gtk::Dialog::builder()
        .transient_for(parent)
        .modal(true)
        .title(title)
        .default_width(520)
        .build();
    dialog.add_button("Close", gtk::ResponseType::Close);
    let content = dialog.content_area();
    let label = gtk::Label::builder()
        .label(body)
        .wrap(true)
        .xalign(0.0)
        .margin_top(18)
        .margin_bottom(18)
        .margin_start(18)
        .margin_end(18)
        .build();
    content.append(&label);
    dialog.connect_response(|dialog, _| dialog.close());
    dialog.present();
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
        .monospace(true)
        .cursor_visible(false)
        .top_margin(8)
        .bottom_margin(8)
        .left_margin(8)
        .right_margin(8)
        .build();
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
        TransportKind::Simulator => "Simulator",
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
        TransportKind::Simulator => "applications-engineering-symbolic",
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
