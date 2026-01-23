/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::Mutex,
    thread,
};
use tauri::{AppHandle, Emitter};

#[cfg(target_os = "macos")]
use portable_pty::{native_pty_system, CommandBuilder, PtySize};

pub const PTY_OUTPUT_EVENT: &str = "pty-output";

#[derive(Deserialize)]
pub struct PtyStartPayload {
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// When true, spawn `emwaver shell` instead of a system shell.
    pub emwaver_shell: Option<bool>,
}

#[derive(Serialize)]
pub struct PtyStartResponse {
    pub session_id: String,
}

#[derive(Deserialize)]
pub struct PtyWritePayload {
    pub session_id: String,
    pub data: String,
}

#[derive(Deserialize)]
pub struct PtyResizePayload {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Deserialize)]
pub struct PtyStopPayload {
    pub session_id: String,
}

#[derive(Clone, Serialize)]
pub struct PtyOutputEvent {
    pub session_id: String,
    pub data: Vec<u8>,
}

struct PtySession {
    #[cfg(target_os = "macos")]
    master: Box<dyn portable_pty::MasterPty + Send>,
    #[cfg(target_os = "macos")]
    child: Box<dyn portable_pty::Child + Send>,
    #[cfg(target_os = "macos")]
    writer: Box<dyn Write + Send>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start(
        &self,
        app: AppHandle,
        payload: PtyStartPayload,
    ) -> Result<PtyStartResponse, String> {
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app, payload);
            return Err("PTY is currently supported on macOS only.".into());
        }

        #[cfg(target_os = "macos")]
        {
            let system = native_pty_system();
            let pair = system
                .openpty(PtySize {
                    rows: payload.rows,
                    cols: payload.cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|error| format!("Failed to create PTY: {error}"))?;

            // When the desktop app is launched via `npm run tauri dev`, npm injects environment
            // variables like `npm_config_prefix` that can trigger warnings in nvm-powered shells.
            // Wrap the spawn in `/usr/bin/env -u ...` to ensure a clean interactive session.
            let mut cmd = CommandBuilder::new("/usr/bin/env");
            cmd.arg("-u");
            cmd.arg("npm_config_prefix");
            cmd.arg("-u");
            cmd.arg("NPM_CONFIG_PREFIX");

            if payload.emwaver_shell.unwrap_or(false) {
                // Dedicated device shell (no general-purpose system commands).
                // Prefer repo-local CLI binary in dev so prompt/banner changes apply
                // without needing a separate `cargo install`.
                let app_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .map(PathBuf::from);
                let debug_cli = app_dir
                    .as_ref()
                    .map(|dir| dir.join("cli/target/debug/emwaver"));
                let release_cli = app_dir
                    .as_ref()
                    .map(|dir| dir.join("cli/target/release/emwaver"));

                if debug_cli.as_ref().is_some_and(|path| path.exists()) {
                    cmd.arg(debug_cli.unwrap());
                } else if release_cli.as_ref().is_some_and(|path| path.exists()) {
                    cmd.arg(release_cli.unwrap());
                } else {
                    cmd.arg("emwaver");
                }
                cmd.arg("shell");
            } else {
                cmd.arg("/bin/zsh");
                cmd.arg("-l");
                cmd.arg("-i");
            }

            if let Some(cwd) = payload.cwd.as_deref() {
                cmd.cwd(cwd);
            }

            cmd.env("TERM", "xterm-256color");
            cmd.env("COLORTERM", "truecolor");
            cmd.env("LANG", "en_US.UTF-8");
            cmd.env("LC_ALL", "en_US.UTF-8");

            let child = pair
                .slave
                .spawn_command(cmd)
                .map_err(|error| format!("Failed to spawn shell: {error}"))?;

            let mut reader = pair
                .master
                .try_clone_reader()
                .map_err(|error| format!("Failed to open PTY reader: {error}"))?;
            let writer = pair
                .master
                .take_writer()
                .map_err(|error| format!("Failed to open PTY writer: {error}"))?;

            let session_id = uuid::Uuid::new_v4().to_string();
            let session_id_clone = session_id.clone();
            let app_clone = app.clone();

            thread::spawn(move || {
                let mut buffer = [0u8; 8192];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(n) => {
                            let payload = PtyOutputEvent {
                                session_id: session_id_clone.clone(),
                                data: buffer[..n].to_vec(),
                            };
                            let _ = app_clone.emit(PTY_OUTPUT_EVENT, payload);
                        }
                        Err(_) => break,
                    }
                }
            });

            let session = PtySession {
                master: pair.master,
                child,
                writer,
            };

            self.sessions
                .lock()
                .map_err(|_| "PTY manager lock poisoned".to_string())?
                .insert(session_id.clone(), session);

            Ok(PtyStartResponse { session_id })
        }
    }

    pub fn write(&self, payload: PtyWritePayload) -> Result<(), String> {
        #[cfg(not(target_os = "macos"))]
        {
            let _ = payload;
            return Err("PTY is currently supported on macOS only.".into());
        }

        #[cfg(target_os = "macos")]
        {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| "PTY manager lock poisoned".to_string())?;
            let session = sessions
                .get_mut(&payload.session_id)
                .ok_or_else(|| "PTY session not found".to_string())?;
            session
                .writer
                .write_all(payload.data.as_bytes())
                .map_err(|error| format!("Failed to write to PTY: {error}"))?;
            session
                .writer
                .flush()
                .map_err(|error| format!("Failed to flush PTY: {error}"))?;
            Ok(())
        }
    }

    pub fn resize(&self, payload: PtyResizePayload) -> Result<(), String> {
        #[cfg(not(target_os = "macos"))]
        {
            let _ = payload;
            return Err("PTY is currently supported on macOS only.".into());
        }

        #[cfg(target_os = "macos")]
        {
            let sessions = self
                .sessions
                .lock()
                .map_err(|_| "PTY manager lock poisoned".to_string())?;
            let session = sessions
                .get(&payload.session_id)
                .ok_or_else(|| "PTY session not found".to_string())?;
            session
                .master
                .resize(PtySize {
                    rows: payload.rows,
                    cols: payload.cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|error| format!("Failed to resize PTY: {error}"))?;
            Ok(())
        }
    }

    pub fn stop(&self, payload: PtyStopPayload) -> Result<(), String> {
        #[cfg(not(target_os = "macos"))]
        {
            let _ = payload;
            return Err("PTY is currently supported on macOS only.".into());
        }

        #[cfg(target_os = "macos")]
        {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| "PTY manager lock poisoned".to_string())?;
            if let Some(mut session) = sessions.remove(&payload.session_id) {
                let _ = session.child.kill();
            }
            Ok(())
        }
    }
}
