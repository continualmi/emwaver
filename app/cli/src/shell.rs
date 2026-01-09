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

use std::io::{self, Write};
use std::time::Duration;

use anyhow::Result;

use crate::desktop_ipc;

pub fn run_shell(verbose: bool) -> Result<()> {
    desktop_ipc::desktop_ready(2_000)?;

    let version_info = match desktop_ipc::rpc_ok(
        "send_command",
        serde_json::json!({
            "text": "version",
            "timeout_ms": 1500u64,
            "packets": 1u32
        }),
        Duration::from_secs(2),
    ) {
        Ok(v) => {
            let bytes_b64 = v.get("bytes_b64").and_then(|v| v.as_str()).unwrap_or("");
            let bytes = desktop_ipc::decode_b64(bytes_b64).unwrap_or_default();
            String::from_utf8_lossy(&bytes).trim().to_string()
        }
        Err(_) => "Unknown".to_string(),
    };

    println!("EMWaver shell (Desktop-backed). Connected to: {}", version_info);
    println!("Type 'exit' to quit.");

    let mut line = String::new();
    loop {
        print!("emw> ");
        io::stdout().flush().ok();
        line.clear();
        let n = io::stdin().read_line(&mut line)?;
        if n == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.eq_ignore_ascii_case("exit") || trimmed.eq_ignore_ascii_case("quit") {
            break;
        }

        let value = match desktop_ipc::rpc_ok(
            "send_command",
            serde_json::json!({
                "text": trimmed,
                "timeout_ms": 1500u64,
                "packets": 1u32
            }),
            Duration::from_secs(7),
        ) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("{e}");
                continue;
            }
        };

        let bytes_b64 = value.get("bytes_b64").and_then(|v| v.as_str()).unwrap_or("");
        let bytes = desktop_ipc::decode_b64(bytes_b64).unwrap_or_default();
        if verbose {
            let mut hex = String::new();
            for (i, b) in bytes.iter().enumerate() {
                use std::fmt::Write;
                let _ = write!(
                    &mut hex,
                    "{:02X}{}",
                    b,
                    if i + 1 == bytes.len() { "" } else { " " }
                );
            }
            println!("hex: {hex}");
        }
        println!("{}", String::from_utf8_lossy(&bytes).trim_matches(['\0', '\n', '\r']));
    }

    Ok(())
}

