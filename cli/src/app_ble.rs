use anyhow::{Context, Result};
use btleplug::api::{
    Central, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType,
};
use btleplug::platform::{Manager, Peripheral};
use std::fs;
use std::path::Path;
use std::time::Duration;
use tokio::time::timeout;
use uuid::Uuid;

// EMWaver App BLE GATT Server (Android/iOS phone acts as peripheral)
const FILE_SYNC_SERVICE_UUID: Uuid = Uuid::from_u128(0x50c7158e_0c3b_4e90_a847_452a15b14190);
const FILE_SYNC_CHAR_UUID: Uuid = Uuid::from_u128(0x51c7158e_0c3b_4e90_a847_452a15b14191);

#[derive(Debug)]
pub struct FileInfo {
    pub name: String,
    pub size: usize,
}

pub struct AppConnection {
    peripheral: Peripheral,
    file_char: Characteristic,
}

impl AppConnection {
    pub async fn connect() -> Result<Self> {
        println!("🔍 Scanning for EMWaver phone...");

        let manager = Manager::new().await?;
        let adapters = manager.adapters().await?;
        let adapter = adapters
            .into_iter()
            .next()
            .context("No Bluetooth adapter found")?;

        adapter.start_scan(ScanFilter::default()).await?;

        // Poll every 500ms for up to 10 seconds, stop as soon as we find EMWaver service
        for attempt in 1..=20 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            
            let peripherals = adapter.peripherals().await?;
            
            for peripheral in peripherals {
                if let Some((name, reason)) = Self::identify_candidate(&peripheral).await {
                    println!("📱 Found {} ({}) after {}s", name, reason, attempt as f32 * 0.5);
                    
                    match Self::attach_to_candidate(peripheral, &name).await {
                        Ok(connection) => {
                            let _ = adapter.stop_scan().await;
                            return Ok(connection);
                        }
                        Err(err) => {
                            eprintln!("⚠️  Unable to connect to {}: {}", name, err);
                        }
                    }
                }
            }
        }

        let _ = adapter.stop_scan().await;

        Err(anyhow::anyhow!(
            "EMWaver phone not found. Make sure:\n  \
             1. Android/iOS app is running\n  \
             2. Bluetooth is enabled on phone\n  \
             3. App is advertising file sync service\n  \
             4. Check logcat: adb logcat | grep BLEFileSyncServer"
        ))
    }

    pub async fn list_files(&self, long: bool) -> Result<()> {
        println!("📋 Listing files on phone...");

        let response = self.send_and_receive(r#"{"op":"list"}"#).await?;
        self.display_file_list(&response, long)?;

        Ok(())
    }

    pub async fn clone_repository(&self, directory: &Path, force: bool) -> Result<()> {
        println!(
            "📦 Cloning EMWaver repository to {}...",
            directory.display()
        );

        // Check if directory exists
        if directory.exists() && !force {
            return Err(anyhow::anyhow!(
                "Directory already exists. Use --force to overwrite."
            ));
        }

        // Create directory structure
        fs::create_dir_all(directory)?;
        let emwaver_dir = directory.join(".emwaver");
        fs::create_dir_all(&emwaver_dir)?;

        println!("✓ Created .emwaver directory");

        // Get file list
        let response = self.send_and_receive(r#"{"op":"list"}"#).await?;
        let files = self.parse_file_list(&response)?;

        if files.is_empty() {
            println!("No files to clone");
            return Ok(());
        }

        println!("\n📥 Pulling {} files...", files.len());

        // Pull each file
        for (i, file_info) in files.iter().enumerate() {
            println!("[{}/{}] Pulling {}...", i + 1, files.len(), file_info.name);

            let pull_request = format!(r#"{{"op":"pull","name":"{}"}}"#, file_info.name);
            let pull_response = self.send_and_receive(&pull_request).await?;

            // Parse response and save file
            self.save_pulled_file(&pull_response, directory)?;
        }

        println!("\n✓ Clone complete!");
        println!("\nNext steps:");
        println!("  cd {}", directory.display());
        println!("  emwaver list    # View files");
        println!("  emwaver push <file>  # Push changes");

        Ok(())
    }

    pub async fn push_file(&self, path: &Path, _force: bool) -> Result<()> {
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| anyhow::anyhow!("Invalid filename"))?;

        println!("📤 Pushing {} to phone...", filename);

        // Read file
        let content = fs::read(path)?;
        let size = content.len();

        // Encode as base64
        let encoded = base64_encode(&content);

        // Send push request
        let request = format!(
            r#"{{"op":"push","name":"{}","size":{},"data":"{}"}}"#,
            filename, size, encoded
        );

        // Wait for response
        let response = self.send_and_receive(&request).await?;

        // Check if successful
        if response.contains("\"status\":\"ok\"") {
            println!("✓ Upload complete: {} ({} bytes)", filename, size);
            Ok(())
        } else {
            Err(anyhow::anyhow!("Push failed: {}", response))
        }
    }

    pub async fn pull_file(&self, name: &str, output: Option<&Path>) -> Result<()> {
        println!("📥 Pulling {} from phone...", name);

        // Send pull request
        let request = format!(r#"{{"op":"pull","name":"{}"}}"#, name);
        let response = self.send_and_receive(&request).await?;

        // Save file
        let output_path = output.unwrap_or_else(|| Path::new("."));
        self.save_pulled_file(&response, output_path)?;

        println!("✓ Pull complete");

        Ok(())
    }

    pub async fn remove_file(&self, name: &str, force: bool) -> Result<()> {
        if !force {
            print!("Remove {} from phone? [y/N] ", name);
            use std::io::{self, Write};
            io::stdout().flush()?;

            let mut response = String::new();
            io::stdin().read_line(&mut response)?;

            if !response.trim().eq_ignore_ascii_case("y") {
                println!("Cancelled");
                return Ok(());
            }
        }

        println!("🗑️  Removing {} from phone...", name);

        // Send remove request
        let request = format!(r#"{{"op":"remove","name":"{}"}}"#, name);
        let response = self.send_and_receive(&request).await?;

        if response.contains("\"status\":\"ok\"") {
            println!("✓ Removed {}", name);
            Ok(())
        } else {
            Err(anyhow::anyhow!("Remove failed: {}", response))
        }
    }

    pub async fn show_status(&self, _verbose: bool) -> Result<()> {
        println!("╔══════════════════════════════════════════════════════════╗");
        println!("║              EMWaver Status                              ║");
        println!("╚══════════════════════════════════════════════════════════╝");
        println!();
        println!("📡 Connection:");
        println!("   Device:  EMWaver Phone");
        println!("   Status:  ✓ Connected via BLE");
        println!();
        println!("💾 Available Commands:");
        println!("   emwaver clone <dir>    - Clone all files to directory");
        println!("   emwaver list           - List files on phone");
        println!("   emwaver push <file>    - Upload file to phone");
        println!("   emwaver pull <name>    - Download file from phone");
        println!("   emwaver rm <name>      - Remove file from phone");
        println!();
        Ok(())
    }

    async fn identify_candidate(peripheral: &Peripheral) -> Option<(String, String)> {
        match peripheral.properties().await {
            Ok(Some(properties)) => {
                let name = properties
                    .local_name
                    .clone()
                    .unwrap_or_else(|| "Unknown device".into());

                if properties.services.contains(&FILE_SYNC_SERVICE_UUID) {
                    return Some((name, "advertises file sync service".into()));
                }

                if properties
                    .local_name
                    .as_ref()
                    .map(|value| value.to_ascii_lowercase().contains("emwaver"))
                    .unwrap_or(false)
                {
                    return Some((name, "device name matches EMWaver".into()));
                }

                None
            }
            _ => None,
        }
    }

    async fn attach_to_candidate(peripheral: Peripheral, name: &str) -> Result<Self> {
        println!("🔗 Connecting to {}...", name);

        peripheral.connect().await?;
        peripheral.discover_services().await?;

        let has_service = peripheral
            .services()
            .iter()
            .any(|service| service.uuid == FILE_SYNC_SERVICE_UUID);

        if !has_service {
            let _ = peripheral.disconnect().await;
            return Err(anyhow::anyhow!(
                "{} does not expose the EMWaver file sync service",
                name
            ));
        }

        let file_char = peripheral
            .characteristics()
            .iter()
            .find(|c| c.uuid == FILE_SYNC_CHAR_UUID)
            .cloned()
            .context("File sync characteristic not found")?;

        println!("✓ Connected to {} via BLE", name);

        Ok(Self {
            peripheral,
            file_char,
        })
    }

    async fn send_and_receive(&self, request: &str) -> Result<String> {
        use tokio_stream::StreamExt;

        // Subscribe and start listening BEFORE sending request
        self.peripheral.subscribe(&self.file_char).await?;
        let mut stream = self.peripheral.notifications().await?;
        
        // Wait for subscription to register
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Send request
        self.peripheral
            .write(
                &self.file_char,
                request.as_bytes(),
                WriteType::WithoutResponse,
            )
            .await?;

        // Wait for response
        timeout(Duration::from_secs(10), async {
            while let Some(notification) = stream.next().await {
                if notification.uuid == FILE_SYNC_CHAR_UUID {
                    return String::from_utf8(notification.value)
                        .context("Invalid UTF-8 in response");
                }
            }
            Err(anyhow::anyhow!("No response received"))
        })
        .await
        .context("Timeout waiting for response")?
    }

    fn parse_file_list(&self, json: &str) -> Result<Vec<FileInfo>> {
        // Simple JSON parsing for MVP
        // Expected: {"op":"list-response","files":[{"name":"x.js","size":123}]}

        let mut files = Vec::new();

        // Basic parsing - look for file objects
        if let Some(files_start) = json.find("\"files\":[") {
            let after_bracket = &json[files_start + 9..];
            if let Some(files_end) = after_bracket.find(']') {
                let files_str = &after_bracket[..files_end];

                // Split by },{
                for file_obj in files_str.split("},{") {
                    if let (Some(name_start), Some(size_start)) =
                        (file_obj.find("\"name\":\""), file_obj.find("\"size\":"))
                    {
                        let name_substr = &file_obj[name_start + 8..];
                        if let Some(name_end) = name_substr.find('"') {
                            let name = &name_substr[..name_end];

                            let size_substr = &file_obj[size_start + 7..];
                            let size_str: String =
                                size_substr.chars().take_while(|c| c.is_numeric()).collect();

                            if let Ok(size) = size_str.parse() {
                                files.push(FileInfo {
                                    name: name.to_string(),
                                    size,
                                });
                            }
                        }
                    }
                }
            }
        }

        Ok(files)
    }

    fn display_file_list(&self, json: &str, long: bool) -> Result<()> {
        let files = self.parse_file_list(json)?;

        if files.is_empty() {
            println!("No files found");
            return Ok(());
        }

        println!();
        println!("Files on phone:");
        println!();

        for file in &files {
            if long {
                println!("  {:<30} {:>10}", file.name, format_bytes(file.size));
            } else {
                println!("  {}", file.name);
            }
        }

        println!();
        println!("Total: {} files", files.len());

        Ok(())
    }

    fn save_pulled_file(&self, json: &str, output_dir: &Path) -> Result<()> {
        // Parse response: {"op":"pull-response","name":"x.js","data":"base64..."}

        let name = if let Some(name_start) = json.find("\"name\":\"") {
            let name_substr = &json[name_start + 8..];
            if let Some(name_end) = name_substr.find('"') {
                &name_substr[..name_end]
            } else {
                return Err(anyhow::anyhow!("Invalid pull response: missing name"));
            }
        } else {
            return Err(anyhow::anyhow!("Invalid pull response: no name field"));
        };

        let data = if let Some(data_start) = json.find("\"data\":\"") {
            let data_substr = &json[data_start + 8..];
            if let Some(data_end) = data_substr.find('"') {
                &data_substr[..data_end]
            } else {
                return Err(anyhow::anyhow!("Invalid pull response: missing data"));
            }
        } else {
            return Err(anyhow::anyhow!("Invalid pull response: no data field"));
        };

        // Decode base64
        let content = base64_decode(data)?;

        // Write to file
        let output_path = output_dir.join(name);
        fs::write(&output_path, &content)?;

        println!(
            "  Saved to {} ({} bytes)",
            output_path.display(),
            content.len()
        );

        Ok(())
    }
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();

    for chunk in data.chunks(3) {
        let b1 = chunk[0];
        let b2 = chunk.get(1).copied().unwrap_or(0);
        let b3 = chunk.get(2).copied().unwrap_or(0);

        result.push(CHARS[(b1 >> 2) as usize] as char);
        result.push(CHARS[(((b1 & 0x03) << 4) | (b2 >> 4)) as usize] as char);
        result.push(if chunk.len() > 1 {
            CHARS[(((b2 & 0x0f) << 2) | (b3 >> 6)) as usize] as char
        } else {
            '='
        });
        result.push(if chunk.len() > 2 {
            CHARS[(b3 & 0x3f) as usize] as char
        } else {
            '='
        });
    }

    result
}

fn base64_decode(s: &str) -> Result<Vec<u8>> {
    let mut result = Vec::new();
    let chars: Vec<u8> = s
        .bytes()
        .filter(|&b| b != b'=' && b != b'\n' && b != b'\r')
        .collect();

    for chunk in chars.chunks(4) {
        let b1 = decode_char(chunk[0])?;
        let b2 = decode_char(chunk.get(1).copied().unwrap_or(b'A'))?;
        let b3 = decode_char(chunk.get(2).copied().unwrap_or(b'A'))?;
        let b4 = decode_char(chunk.get(3).copied().unwrap_or(b'A'))?;

        result.push(((b1 << 2) | (b2 >> 4)) as u8);
        if chunk.len() > 2 {
            result.push(((b2 << 4) | (b3 >> 2)) as u8);
        }
        if chunk.len() > 3 {
            result.push(((b3 << 6) | b4) as u8);
        }
    }

    Ok(result)
}

fn decode_char(c: u8) -> Result<u8> {
    Ok(match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        b'/' => 63,
        _ => return Err(anyhow::anyhow!("Invalid base64 character")),
    })
}

fn format_bytes(bytes: usize) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}
