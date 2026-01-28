use std::fs;
use std::path::{Path, PathBuf};

slint::include_modules!();

fn main() -> Result<(), slint::PlatformError> {
    let app = AppWindow::new()?;

    let current_path = std::rc::Rc::new(std::cell::RefCell::new(None::<PathBuf>));
    let log_text = app.global::<AppState>().get_log_text();
    if log_text.trim().is_empty() {
        app.global::<AppState>().set_log_text(
            "EMWaver native desktop (Slint)\n\n- Open a .emw file\n- Edit\n- Save\n- Run (stub)\n"
                .into(),
        );
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
