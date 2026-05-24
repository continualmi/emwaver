use adw::prelude::*;
use emwaver_linux_core::{AppModel, DeviceRecord, TransportKind};
use emwaver_linux_transport::{
    simulator::SimulatorTransport,
    usb::{LinuxUsbManager, UsbAccessState, UsbDeviceCandidate, UsbDeviceRole},
    EmwaverTransport,
};
use gtk::{gio, Align, Orientation};
use std::cell::RefCell;
use std::rc::Rc;

pub fn build_main_window(app: &adw::Application) {
    let model = Rc::new(RefCell::new(AppModel::default()));
    seed_simulator_device(&model);
    seed_usb_devices(&model);

    let window = adw::ApplicationWindow::builder()
        .application(app)
        .title("EMWaver")
        .default_width(1180)
        .default_height(780)
        .build();

    let header = adw::HeaderBar::builder()
        .title_widget(&gtk::Label::new(Some("EMWaver Linux")))
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

    let device_list = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::Single)
        .css_classes(vec!["boxed-list"])
        .build();
    refresh_device_list(&device_list, &model.borrow().devices());

    let editor = gtk::TextView::builder()
        .monospace(true)
        .top_margin(12)
        .bottom_margin(12)
        .left_margin(12)
        .right_margin(12)
        .build();
    editor
        .buffer()
        .set_text("gpio.write(13, 1);\nawait delay(250);\ngpio.write(13, 0);\n");

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
        .set_text("Simulator ready. Local scripts do not require an Agent key.\n");

    let agent_panel = status_panel(
        "Agent",
        "Optional public /api/mgpt endpoint. Missing API key disables Agent replies only.",
    );
    let firmware_panel = status_panel(
        "Firmware",
        "STM32 DFU and ESP32 serial update flows are local and board-aware.",
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

    let content = gtk::Paned::new(Orientation::Horizontal);
    content.set_start_child(Some(&sidebar));
    content.set_resize_start_child(false);
    content.set_shrink_start_child(false);

    let main_stack = gtk::Box::new(Orientation::Vertical, 10);
    main_stack.set_margin_top(12);
    main_stack.set_margin_bottom(12);
    main_stack.set_margin_start(12);
    main_stack.set_margin_end(12);
    main_stack.append(&section_label("Script"));
    main_stack.append(&editor);
    main_stack.append(&section_label("Log"));
    main_stack.append(&log_view);
    content.set_end_child(Some(&main_stack));

    let root = gtk::Box::new(Orientation::Vertical, 0);
    root.append(&header);
    root.append(&content);
    window.set_content(Some(&root));

    let active_session = Rc::new(RefCell::new(None));
    {
        let model = Rc::clone(&model);
        let editor = editor.clone();
        let log_view = log_view.clone();
        let active_session = Rc::clone(&active_session);
        run_button.connect_clicked(move |_| {
            let buffer = editor.buffer();
            let source = buffer
                .text(&buffer.start_iter(), &buffer.end_iter(), true)
                .to_string();
            let result = model.borrow_mut().run_script("Untitled.js", source);
            match result {
                Ok(session) => {
                    *active_session.borrow_mut() = Some(session.id);
                    append_log(&log_view, "Started simulator script session.");
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

fn refresh_device_list(list: &gtk::ListBox, devices: &[DeviceRecord]) {
    while let Some(row) = list.first_child() {
        list.remove(&row);
    }
    for device in devices {
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
        list.append(&row);
    }
}

fn section_label(text: &str) -> gtk::Label {
    gtk::Label::builder()
        .label(text)
        .halign(Align::Start)
        .css_classes(vec!["heading"])
        .build()
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

fn append_log(log_view: &gtk::TextView, line: &str) {
    let buffer = log_view.buffer();
    let mut end = buffer.end_iter();
    buffer.insert(&mut end, &format!("{line}\n"));
}

fn add_shortcuts(app: &adw::Application, window: &adw::ApplicationWindow) {
    let quit = gio::SimpleAction::new("quit", None);
    let window = window.clone();
    quit.connect_activate(move |_, _| window.close());
    app.add_action(&quit);
    app.set_accels_for_action("app.quit", &["<primary>q"]);

    let about = gio::SimpleAction::new("about", None);
    about.connect_activate(move |_, _| {
        let dialog = adw::AboutWindow::builder()
            .application_name("EMWaver")
            .application_icon("com.continualmi.EMWaver")
            .developer_name("Continual MI")
            .version(env!("CARGO_PKG_VERSION"))
            .build();
        dialog.present();
    });
    app.add_action(&about);
}
