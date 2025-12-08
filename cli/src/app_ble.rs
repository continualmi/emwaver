use anyhow::{Context, Result};
use btleplug::api::{
    Central, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType,
};
use btleplug::platform::{Manager, Peripheral};
use std::fs;
use std::path::{Path, PathBuf};
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
    fn cache_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".emwaver")
            .join("connection.cache")
    }

    pub async fn connect() -> Result<Self> {
        let manager = Manager::new().await?;
        let adapters = manager.adapters().await?;
        let adapter = adapters
            .into_iter()
            .next()
            .context("No Bluetooth adapter found")?;

        adapter.start_scan(ScanFilter::default()).await?;

        // Poll every 300ms for up to 8 seconds
        for _attempt in 1..=26 {
            tokio::time::sleep(Duration::from_millis(300)).await;
            
            let peripherals = adapter.peripherals().await?;
            
            for peripheral in peripherals {
                if let Some((name, _reason)) = Self::identify_candidate(&peripheral).await {
                    match Self::attach_to_candidate(peripheral.clone(), &name).await {
                        Ok(connection) => {
                            let _ = adapter.stop_scan().await;
                            return Ok(connection);
                        }
                        Err(_) => continue,
                    }
                }
            }
        }

        let _ = adapter.stop_scan().await;

        Err(anyhow::anyhow!(
            "EMWaver phone not found. Make sure:\n  \
             1. Android/iOS app is running\n  \
             2. Bluetooth is enabled on phone\n  \
             3. App is advertising file sync service"
        ))
    }

    async fn try_cached_connection() -> Result<Self> {
        let cache_path = Self::cache_path();
        if !cache_path.exists() {
            return Err(anyhow::anyhow!("No cache"));
        }

        let cached_addr = fs::read_to_string(&cache_path)?;
        
        let manager = Manager::new().await?;
        let adapters = manager.adapters().await?;
        let adapter = adapters
            .into_iter()
            .next()
            .context("No Bluetooth adapter found")?;

        adapter.start_scan(ScanFilter::default()).await?;
        tokio::time::sleep(Duration::from_millis(1500)).await;

        let peripherals = adapter.peripherals().await?;
        let _ = adapter.stop_scan().await;

        for peripheral in peripherals {
            if let Ok(Some(props)) = peripheral.properties().await {
                if props.address.to_string() == cached_addr.trim() {
                    if peripheral.is_connected().await? {
                        // Already connected, reuse it
                        let file_char = peripheral
                            .characteristics()
                            .iter()
                            .find(|c| c.uuid == FILE_SYNC_CHAR_UUID)
                            .ok_or_else(|| anyhow::anyhow!("Characteristic not found"))?
                            .clone();
                        
                        return Ok(Self {
                            peripheral,
                            file_char,
                        });
                    }

                    // Try to reconnect
                    if let Ok(connection) = Self::attach_to_candidate(peripheral, "cached device").await {
                        return Ok(connection);
                    }
                }
            }
        }

        Err(anyhow::anyhow!("Cached device not available"))
    }

    fn cache_device(address: &str) -> Result<()> {
        let cache_path = Self::cache_path();
        if let Some(parent) = cache_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(cache_path, address)?;
        Ok(())
    }

    pub async fn list_files(&self, long: bool) -> Result<()> {
        let response = self.send_and_receive(r#"{"op":"list"}"#).await?;
        self.display_file_list(&response, long)?;

        Ok(())
    }

    pub async fn clone_repository(&self, force: bool) -> Result<()> {
        let directory = PathBuf::from("emwaver_files");

        if directory.exists() && !force {
            return Err(anyhow::anyhow!(
                "emwaver_files/ already exists. Use --force to overwrite."
            ));
        }

        // Create directory structure
        fs::create_dir_all(&directory)?;
        let emwaver_dir = directory.join(".emwaver");
        fs::create_dir_all(&emwaver_dir)?;

        // Get file list
        let response = self.send_and_receive(r#"{"op":"list"}"#).await?;
        let files = self.parse_file_list(&response)?;

        if files.is_empty() {
            println!("No files to clone");
            return Ok(());
        }

        println!("Cloning {} files into emwaver_files/", files.len());

        // Pull each file
        for file_info in files.iter() {
            let pull_request = format!(r#"{{"op":"pull","name":"{}"}}"#, file_info.name);
            let pull_response = self.send_and_receive(&pull_request).await?;
            self.save_pulled_file(&pull_response, &directory)?;
        }

        println!("✓ Cloned {} files", files.len());

        Ok(())
    }

    pub async fn push(&self, yes: bool) -> Result<()> {
        let directory = PathBuf::from("emwaver_files");
        
        if !directory.exists() {
            return Err(anyhow::anyhow!(
                "Not in an emwaver repository. Run 'emw clone' first."
            ));
        }

        // Get all local files
        let mut local_files = Vec::new();
        for entry in fs::read_dir(&directory)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if !name.starts_with('.') {
                        local_files.push(name.to_string());
                    }
                }
            }
        }

        if local_files.is_empty() {
            println!("No local files to push");
            return Ok(());
        }

        println!("Will upload {} files to device (overwrites remote)\n", local_files.len());
        for file in &local_files {
            println!("  + {}", file);
        }

        if !yes {
            use std::io::{self, Write};
            print!("\nPush these files? [Y/n] ");
            io::stdout().flush()?;

            let mut response = String::new();
            io::stdin().read_line(&mut response)?;

            if !response.trim().is_empty() && !response.trim().eq_ignore_ascii_case("y") {
                println!("Cancelled");
                return Ok(());
            }
        }

        for file in local_files {
            let path = directory.join(&file);
            let content = fs::read(&path)?;
            let encoded = base64_encode(&content);
            let request = format!(
                r#"{{"op":"push","name":"{}","size":{},"data":"{}"}}"#,
                file, content.len(), encoded
            );
            self.send_and_receive(&request).await?;
        }

        println!("✓ Pushed all files");
        Ok(())
    }

    pub async fn pull(&self, yes: bool) -> Result<()> {
        let directory = PathBuf::from("emwaver_files");
        
        if !directory.exists() {
            return Err(anyhow::anyhow!(
                "Not in an emwaver repository. Run 'emw clone' first."
            ));
        }

        // Get remote files
        let response = self.send_and_receive(r#"{"op":"list"}"#).await?;
        let remote_files = self.parse_file_list(&response)?;

        if remote_files.is_empty() {
            println!("No remote files to pull");
            return Ok(());
        }

        println!("Will download {} files from device (overwrites local)\n", remote_files.len());
        for file in &remote_files {
            println!("  - {}", file.name);
        }

        if !yes {
            use std::io::{self, Write};
            print!("\nPull these files? [Y/n] ");
            io::stdout().flush()?;

            let mut response = String::new();
            io::stdin().read_line(&mut response)?;

            if !response.trim().is_empty() && !response.trim().eq_ignore_ascii_case("y") {
                println!("Cancelled");
                return Ok(());
            }
        }

        for file_info in remote_files {
            let request = format!(r#"{{"op":"pull","name":"{}"}}"#, file_info.name);
            let response = self.send_and_receive(&request).await?;
            self.save_pulled_file(&response, &directory)?;
        }

        println!("✓ Pulled all files");
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
        if name != "cached device" {
            println!("🔗 Connecting to {}...", name);
        }

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

        if name != "cached device" {
            println!("✓ Connected to {} via BLE", name);
        }

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

        // Receive response (may be chunked)
        timeout(Duration::from_secs(60), async {
            let mut buffer = Vec::new();
            
            loop {
                match tokio::time::timeout(Duration::from_millis(100), stream.next()).await {
                    Ok(Some(notification)) if notification.uuid == FILE_SYNC_CHAR_UUID => {
                        buffer.extend_from_slice(&notification.value);
                        
                        // Try to parse as complete JSON
                        if let Ok(s) = String::from_utf8(buffer.clone()) {
                            if s.trim_end().ends_with('}') {
                                let open_braces = s.chars().filter(|&c| c == '{').count();
                                let close_braces = s.chars().filter(|&c| c == '}').count();
                                if open_braces == close_braces && open_braces > 0 {
                                    // Additional validation: if it contains "data", it must have a closing quote
                                    if let Some(idx) = s.find("\"data\":\"") {
                                        let rest = &s[idx + 8..];
                                        if !rest.contains('"') {
                                            return Err(anyhow::anyhow!("Corrupted response: missing data termination"));
                                        }
                                    }
                                    return Ok(s);
                                }
                            }
                        }
                    }
                    Ok(Some(_)) => continue,
                    Ok(None) => return Err(anyhow::anyhow!("Stream ended")),
                    Err(_) => {
                        // No notification for 100ms, assume complete
                        if !buffer.is_empty() {
                            return String::from_utf8(buffer).context("Invalid UTF-8 in response");
                        }
                        return Err(anyhow::anyhow!("No response received"));
                    }
                }
            }
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

#[derive(Debug)]
enum Change {
    Upload(String),
    Download(String),
    Delete(String),
}

impl Change {
    fn is_empty(changes: &[Change]) -> bool {
        changes.is_empty()
    }
}

async fn compute_changes(directory: &Path, conn: &AppConnection) -> Result<Vec<Change>> {
    use std::collections::{HashMap, HashSet};

    // Get local files
    let mut local_files = HashMap::new();
    if directory.exists() {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if !name.starts_with('.') {
                        let metadata = fs::metadata(&path)?;
                        local_files.insert(name.to_string(), metadata.len() as usize);
                    }
                }
            }
        }
    }

    // Get remote files
    let response = conn.send_and_receive(r#"{"op":"list"}"#).await?;
    let remote_files = conn.parse_file_list(&response)?;
    let remote_map: HashMap<String, usize> = remote_files
        .into_iter()
        .map(|f| (f.name, f.size))
        .collect();

    let mut changes = Vec::new();
    let local_names: HashSet<_> = local_files.keys().cloned().collect();
    let remote_names: HashSet<_> = remote_map.keys().cloned().collect();

    // Files to upload (new or modified)
    for name in &local_names {
        if let Some(&local_size) = local_files.get(name) {
            if let Some(&remote_size) = remote_map.get(name) {
                if local_size != remote_size {
                    changes.push(Change::Upload(name.clone()));
                }
            } else {
                changes.push(Change::Upload(name.clone()));
            }
        }
    }

    // Files to download (new on remote)
    for name in remote_names.difference(&local_names) {
        changes.push(Change::Download(name.clone()));
    }

    Ok(changes)
}

fn print_changes(changes: &[Change]) {
    println!("Changes to be synced:\n");
    
    let mut uploads = Vec::new();
    let mut downloads = Vec::new();
    let mut deletes = Vec::new();

    for change in changes {
        match change {
            Change::Upload(f) => uploads.push(f),
            Change::Download(f) => downloads.push(f),
            Change::Delete(f) => deletes.push(f),
        }
    }

    if !uploads.is_empty() {
        println!("  Upload to device:");
        for file in uploads {
            println!("    + {}", file);
        }
        println!();
    }

    if !downloads.is_empty() {
        println!("  Download from device:");
        for file in downloads {
            println!("    - {}", file);
        }
        println!();
    }

    if !deletes.is_empty() {
        println!("  Delete from device:");
        for file in deletes {
            println!("    × {}", file);
        }
        println!();
    }
}

pub async fn show_status(_verbose: bool) -> Result<()> {
    let directory = PathBuf::from("emwaver_files");
    
    if !directory.exists() {
        println!("Not in an emwaver repository. Run 'emw clone' first.");
        return Ok(());
    }

    let conn = AppConnection::connect().await?;
    let changes = compute_changes(&directory, &conn).await?;

    if changes.is_empty() {
        println!("Already up to date");
    } else {
        print_changes(&changes);
        println!("Run 'emw sync' to apply these changes");
    }

    Ok(())
}
