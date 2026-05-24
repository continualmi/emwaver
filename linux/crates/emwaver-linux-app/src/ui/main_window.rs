use adw::prelude::*;
use emwaver_linux_agent::{AgentClient, AgentRequest};
use emwaver_linux_core::{
    default_script_template, AppModel, DeviceRecord, ScriptListItem, ScriptRepository,
    TransportKind,
};
use emwaver_linux_runtime::execute_javascript;
use emwaver_linux_transport::{
    simulator::SimulatorTransport,
    usb::{
        LinuxUsbManager, LinuxUsbMidiTransport, UsbAccessState, UsbDeviceCandidate, UsbDeviceRole,
    },
    EmwaverTransport,
};
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
            agent_status_label.set_label(agent_status_text().as_str());
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
            let Some(Some(script_index)) = script_row_indices.borrow().get(row.index() as usize)
            else {
                return;
            };
            let Some(item) = script_items.borrow().get(*script_index).cloned() else {
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
        firmware_button.connect_clicked(move |_| {
            present_status_dialog(
                &window,
                "Firmware",
                "Linux firmware management is local and board-aware. STM32 DFU and ESP32 serial flashing are implemented behind the firmware crate boundary and will be surfaced here as the GTK flow is completed.",
            );
        });
    }
    {
        let window = window.clone();
        settings_button.connect_clicked(move |_| {
            present_status_dialog(
                &window,
                "Settings",
                "Settings will hold local-only preferences such as Agent endpoint/API key storage, script folder location, and transport diagnostics. Local hardware access must not depend on an account.",
            );
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
        _ => vec![format!(
            "{:?} script execution is not implemented yet.",
            device.transport
        )],
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
        .label("Agent replies require EMWAVER_AGENT_ENDPOINT and EMWAVER_AGENT_API_KEY until the Secret Service settings UI lands. Local scripts, devices, and firmware remain available without them.")
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
            setup.set_label("Set EMWAVER_AGENT_ENDPOINT to a public /api/mgpt/... route and EMWAVER_AGENT_API_KEY for this preview build. Secret Service settings UI is still pending.");
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
    env::var("EMWAVER_AGENT_API_KEY")
        .ok()
        .is_some_and(|key| !key.trim().is_empty())
        && env::var("EMWAVER_AGENT_ENDPOINT")
            .ok()
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
    let Some(api_key) = env::var("EMWAVER_AGENT_API_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty())
    else {
        return Err(
            "Add an MGPT API key to enable Agent replies. Local scripts and hardware are still available."
                .to_string(),
        );
    };
    let endpoint = env::var("EMWAVER_AGENT_ENDPOINT")
        .map_err(|_| "Set EMWAVER_AGENT_ENDPOINT to a public /api/mgpt/... route.".to_string())?;
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

fn present_device_dialog(parent: &adw::ApplicationWindow, devices: &[DeviceRecord]) {
    let dialog = gtk::Dialog::builder()
        .transient_for(parent)
        .modal(true)
        .title("Local Devices")
        .default_width(620)
        .default_height(460)
        .build();
    dialog.add_button("Close", gtk::ResponseType::Close);

    let content = dialog.content_area();
    let root = gtk::Box::new(Orientation::Vertical, 14);
    root.set_margin_top(18);
    root.set_margin_bottom(18);
    root.set_margin_start(18);
    root.set_margin_end(18);
    root.append(
        &gtk::Label::builder()
            .label("Select a discovered local transport for the next script session.")
            .wrap(true)
            .xalign(0.0)
            .css_classes(vec!["dim-label"])
            .build(),
    );

    let list = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(vec!["boxed-list"])
        .build();
    for device in devices {
        let row = gtk::Box::new(Orientation::Horizontal, 12);
        row.set_margin_top(10);
        row.set_margin_bottom(10);
        row.set_margin_start(10);
        row.set_margin_end(10);

        let copy = gtk::Box::new(Orientation::Vertical, 2);
        copy.append(
            &gtk::Label::builder()
                .label(&device.display_name)
                .xalign(0.0)
                .build(),
        );
        copy.append(
            &gtk::Label::builder()
                .label(device_detail_line(device))
                .xalign(0.0)
                .css_classes(vec!["dim-label"])
                .build(),
        );

        row.append(&gtk::Image::from_icon_name(transport_icon_name(
            &device.transport,
        )));
        row.append(&copy);
        list.append(&gtk::ListBoxRow::builder().child(&row).build());
    }
    root.append(&list);
    content.append(&root);

    dialog.connect_response(|dialog, _| dialog.close());
    dialog.present();
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

fn device_detail_line(device: &DeviceRecord) -> String {
    let mut parts = vec![format!("{:?}", device.transport)];
    if let Some(version) = device.firmware_version.as_ref() {
        parts.push(format!("EMWaver {version}"));
    }
    if let Some(uid) = device.hardware_uid.as_ref() {
        parts.push(format!("UID {uid}"));
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
