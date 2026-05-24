mod ui;

use adw::prelude::*;
use gtk::gio;

fn main() {
    let app = adw::Application::builder()
        .application_id("com.continualmi.EMWaver")
        .flags(gio::ApplicationFlags::HANDLES_OPEN)
        .build();

    app.connect_activate(|app| {
        ui::main_window::build_main_window(app);
    });

    app.run();
}
