use adw::prelude::*;
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
use std::cell::RefCell;
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

    let editor = gtk::TextView::builder()
        .monospace(true)
        .top_margin(12)
        .bottom_margin(12)
        .left_margin(12)
        .right_margin(12)
        .build();
    let editor_scroll = gtk::ScrolledWindow::builder()
        .hexpand(true)
        .vexpand(true)
        .hscrollbar_policy(PolicyType::Automatic)
        .vscrollbar_policy(PolicyType::Automatic)
        .child(&editor)
        .build();
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

    let agent_panel = status_panel(
        "Agent",
        "Optional API-key Agent drawer. Local scripts and device control keep working without it.",
    );
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
    sidebar.append(&agent_panel);
    sidebar.append(&firmware_panel);

    let script_list = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::Single)
        .css_classes(vec!["boxed-list"])
        .build();

    let library = gtk::Box::new(Orientation::Vertical, 10);
    library.set_margin_top(12);
    library.set_margin_bottom(12);
    library.set_margin_start(12);
    library.set_margin_end(12);
    library.append(&section_label("Scripts"));
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
    main_stack.append(&editor_toolbar(&script_title, &script_kind));
    main_stack.append(&read_only_notice);
    main_stack.append(&editor_scroll);
    main_stack.append(&section_label("Run Log"));
    main_stack.append(&log_scroll);
    workspace.set_start_child(Some(&main_stack));
    workspace.set_resize_start_child(true);
    workspace.set_shrink_start_child(false);
    workspace.set_end_child(Some(&sidebar));
    workspace.set_resize_end_child(false);
    workspace.set_shrink_end_child(false);
    content.set_end_child(Some(&workspace));

    let root = gtk::Box::new(Orientation::Vertical, 0);
    root.append(&header);
    root.append(&content);
    window.set_content(Some(&root));

    let active_session = Rc::new(RefCell::new(None));
    {
        let script_repository = Rc::clone(&script_repository);
        let script_items = Rc::clone(&script_items);
        let script_row_indices = Rc::clone(&script_row_indices);
        let selected_script = Rc::clone(&selected_script);
        let editor = editor.clone();
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
                    editor.buffer().set_text(&source);
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
    );
    script_list.select_row(first_script_row(&script_list, &script_row_indices).as_ref());
    {
        let script_repository = Rc::clone(&script_repository);
        let script_items = Rc::clone(&script_items);
        let script_row_indices = Rc::clone(&script_row_indices);
        let script_list = script_list.clone();
        let selected_script = Rc::clone(&selected_script);
        let editor = editor.clone();
        let log_view = log_view.clone();
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
                    );
                    select_script_by_id(&script_list, &script_items, &script_row_indices, &item.id);
                    editor.buffer().set_text(default_script_template());
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
        let editor = editor.clone();
        let log_view = log_view.clone();
        save_script_button.connect_clicked(move |_| {
            let Some(item) = selected_script.borrow().clone() else {
                append_log(&log_view, "No selected script to save.");
                return;
            };
            let buffer = editor.buffer();
            let source = buffer
                .text(&buffer.start_iter(), &buffer.end_iter(), true)
                .to_string();
            match script_repository.save_script(&item, &source) {
                Ok(()) => append_log(&log_view, &format!("Saved {}.", item.name)),
                Err(err) => append_log(&log_view, &format!("Save failed: {err}")),
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
        let editor = editor.clone();
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
            let buffer = editor.buffer();
            let source = buffer
                .text(&buffer.start_iter(), &buffer.end_iter(), true)
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
                        &buffer
                            .text(&buffer.start_iter(), &buffer.end_iter(), true)
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

fn editor_toolbar(title: &gtk::Label, detail: &gtk::Label) -> gtk::Box {
    let toolbar = gtk::Box::new(Orientation::Horizontal, 8);
    toolbar.append(title);
    toolbar.append(detail);
    toolbar
}

fn refresh_script_list(
    list: &gtk::ListBox,
    repository: &ScriptRepository,
    items: &Rc<RefCell<Vec<ScriptListItem>>>,
    row_indices: &Rc<RefCell<Vec<Option<usize>>>>,
    log_view: &gtk::TextView,
) {
    while let Some(row) = list.first_child() {
        list.remove(&row);
    }
    items.borrow_mut().clear();
    row_indices.borrow_mut().clear();

    let scripts = match repository.list_scripts() {
        Ok(scripts) => scripts,
        Err(err) => {
            append_log(log_view, &format!("Script library load failed: {err}"));
            return;
        }
    };

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
