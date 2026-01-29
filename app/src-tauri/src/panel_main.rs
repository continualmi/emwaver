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

use std::io::{self, BufRead};
use std::time::Duration;

use serde::Deserialize;

slint::slint! {
  import { VerticalBox } from "std-widgets.slint";

  export component PanelWindow inherits Window {
    title: "EMWaver Script Panel";
    no-frame: true;
    background: #0b0d10;

    in-out property <string> header: "Script UI (Slint placeholder)";
    in-out property <string> sub: "Waiting for script renderer...";

    Rectangle {
      background: #0b0d10;
      border-width: 1px;
      border-color: #1f2937;

      VerticalBox {
        padding: 14px;
        spacing: 10px;

        Text {
          text: header;
          font-size: 18px;
          color: #e5e7eb;
        }

        Text {
          text: sub;
          font-size: 12px;
          color: #9ca3af;
          wrap: word-wrap;
        }

        Rectangle {
          height: 1px;
          background: #1f2937;
        }

        Text {
          text: "(PoC) This window is spawned by the Tauri app and docked beside it.";
          font-size: 12px;
          color: #9ca3af;
          wrap: word-wrap;
        }
      }
    }
  }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
enum PanelMsg {
    #[serde(rename = "bounds")]
    Bounds { x: i32, y: i32, w: u32, h: u32 },
    #[serde(rename = "set_text")]
    SetText {
        header: Option<String>,
        sub: Option<String>,
    },
    #[serde(rename = "quit")]
    Quit,
}

fn parse_arg_i32(args: &[String], name: &str, default: i32) -> i32 {
    let mut i = 0;
    while i + 1 < args.len() {
        if args[i] == name {
            return args[i + 1].parse::<i32>().unwrap_or(default);
        }
        i += 1;
    }
    default
}

fn parse_arg_u32(args: &[String], name: &str, default: u32) -> u32 {
    let mut i = 0;
    while i + 1 < args.len() {
        if args[i] == name {
            return args[i + 1].parse::<u32>().unwrap_or(default);
        }
        i += 1;
    }
    default
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let x = parse_arg_i32(&args, "--x", 40);
    let y = parse_arg_i32(&args, "--y", 40);
    let w = parse_arg_u32(&args, "--w", 420);
    let h = parse_arg_u32(&args, "--h", 720);

    let ui = PanelWindow::new()?;
    let window = ui.window();

    // Best-effort: position/size may be backend/platform dependent.
    let _ = window.set_position(slint::PhysicalPosition::new(x, y));
    let _ = window.set_size(slint::PhysicalSize::new(w, h));

    let (tx, rx) = std::sync::mpsc::channel::<PanelMsg>();

    // Background stdin reader thread (no UI objects cross threads).
    std::thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines().flatten() {
            let msg: PanelMsg = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if tx.send(msg).is_err() {
                break;
            }
        }
    });

    // UI-thread poller (cheap PoC). Avoids slint::invoke_from_event_loop Send bounds.
    let rx = std::rc::Rc::new(std::cell::RefCell::new(rx));
    let ui2 = ui.as_weak();
    let mut timer = slint::Timer::default();
    timer.start(
        slint::TimerMode::Repeated,
        Duration::from_millis(16),
        move || {
            let Some(ui2) = ui2.upgrade() else {
                let _ = slint::quit_event_loop();
                return;
            };
            loop {
                let msg = match rx.borrow().try_recv() {
                    Ok(m) => m,
                    Err(std::sync::mpsc::TryRecvError::Empty) => break,
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                        let _ = slint::quit_event_loop();
                        return;
                    }
                };

                match msg {
                    PanelMsg::Bounds { x, y, w, h } => {
                        let window = ui2.window();
                        let _ = window.set_position(slint::PhysicalPosition::new(x, y));
                        let _ = window.set_size(slint::PhysicalSize::new(w, h));
                    }
                    PanelMsg::SetText { header, sub } => {
                        if let Some(h) = header {
                            ui2.set_header(h.into());
                        }
                        if let Some(s) = sub {
                            ui2.set_sub(s.into());
                        }
                    }
                    PanelMsg::Quit => {
                        let _ = slint::quit_event_loop();
                        return;
                    }
                }
            }
        },
    );

    ui.run()?;
    Ok(())
}
