use anyhow::Result;
use serialport::SerialPort;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;

const CHUNK_SIZE: usize = 4096; // 4KB chunks for UART transmission

#[derive(Debug)]
pub struct FileInfo {
    pub name: String,
    pub size: usize,
    pub hash: Option<String>,
    pub file_type: String,
}

pub fn push_file(path: &Path, _force: bool, port: &mut Box<dyn SerialPort>) -> Result<()> {
    // Check if file exists
    if !path.exists() {
        return Err(anyhow::anyhow!("File not found: {}", path.display()));
    }

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow::anyhow!("Invalid filename"))?;

    // Read file
    let mut file = File::open(path)?;
    let mut file_data = Vec::new();
    file.read_to_end(&mut file_data)?;

    let file_size = file_data.len();

    // Calculate SHA256 hash
    let mut hasher = Sha256::new();
    hasher.update(&file_data);
    let hash = format!("{:x}", hasher.finalize());

    println!("Pushing {} ({} bytes)...", filename, file_size);

    // Detect file type from extension
    let file_type = if filename.ends_with(".js") {
        "wavelet"
    } else if filename.ends_with(".raw") {
        "signal"
    } else {
        "unknown"
    };

    // Send start command
    let start_cmd = format!(
        "sync --action start --name \"{}\" --size {} --type {}\n",
        filename, file_size, file_type
    );

    port.write_all(start_cmd.as_bytes())?;
    port.flush()?;

    // Wait for "ok" response
    if !wait_for_ok(port)? {
        return Err(anyhow::anyhow!("Start command failed"));
    }

    // Send file in chunks
    let total_chunks = (file_size + CHUNK_SIZE - 1) / CHUNK_SIZE;
    let mut seq = 0;

    for chunk in file_data.chunks(CHUNK_SIZE) {
        // Convert chunk to hex string
        let hex_data: String = chunk.iter().map(|b| format!("{:02x}", b)).collect();

        let chunk_cmd = format!("sync --action chunk --seq {} --data {}\n", seq, hex_data);

        port.write_all(chunk_cmd.as_bytes())?;
        port.flush()?;

        // Wait for "ok" response
        if !wait_for_ok(port)? {
            return Err(anyhow::anyhow!("Chunk {} failed", seq));
        }

        // Show progress
        let progress = (seq + 1) * 100 / total_chunks;
        print_progress(progress, seq + 1, total_chunks, chunk.len(), file_size);

        seq += 1;
    }

    // Send commit command
    let commit_cmd = format!("sync --action commit --hash {}\n", hash);

    port.write_all(commit_cmd.as_bytes())?;
    port.flush()?;

    // Wait for final "ok"
    if !wait_for_ok(port)? {
        return Err(anyhow::anyhow!("Commit command failed"));
    }

    println!("\n✓ Transfer complete: {} ({} bytes)", filename, file_size);

    Ok(())
}

pub fn pull_file(name: &str, _output: Option<&Path>, port: &mut Box<dyn SerialPort>) -> Result<()> {
    println!("Pulling {} from device...", name);

    // Send get command
    let get_cmd = format!("sync --action get --name \"{}\"\n", name);

    port.write_all(get_cmd.as_bytes())?;
    port.flush()?;

    // Wait for "ok" response
    if !wait_for_ok(port)? {
        return Err(anyhow::anyhow!("Get command failed"));
    }

    // TODO: Implement receiving file chunks from device
    println!("File pull not yet fully implemented (waiting for firmware response)");

    Ok(())
}

pub fn list_files(_long: bool, port: &mut Box<dyn SerialPort>) -> Result<()> {
    println!("Listing files on device...");

    // Send list command
    let list_cmd = "sync --action list\n";

    println!("DEBUG: Sending command: {}", list_cmd.trim());
    port.write_all(list_cmd.as_bytes())?;
    port.flush()?;

    // Wait for "ok" response
    match wait_for_ok(port) {
        Ok(true) => {}
        Ok(false) => {
            return Err(anyhow::anyhow!("Device returned error for list command"));
        }
        Err(e) => {
            return Err(anyhow::anyhow!(
                "No response from device (is Android app connected via BLE?): {}",
                e
            ));
        }
    }

    // Now wait for JSON response from Android
    let response = wait_for_json_response(port)?;

    if let Some(json_str) = response {
        // Parse JSON
        // Expected format: {"op":"list-response","files":[{"name":"...","size":123}],"count":2}
        println!();
        println!("Files on device:");
        println!();

        // Simple parsing - look for file entries
        if json_str.contains("\"files\"") {
            // For now, just show the raw JSON nicely
            // TODO: Proper JSON parsing with serde_json
            println!("{}", json_str);
        } else {
            println!("No files found");
        }
    } else {
        println!("No response from device");
    }

    Ok(())
}

// Helper: wait for JSON response from device
fn wait_for_json_response(port: &mut Box<dyn SerialPort>) -> Result<Option<String>> {
    let mut buffer = [0u8; 2048];
    let timeout = Duration::from_secs(10);
    port.set_timeout(timeout)?;

    let start = std::time::Instant::now();
    let mut accumulated = String::new();

    while start.elapsed() < timeout {
        match port.read(&mut buffer) {
            Ok(n) if n > 0 => {
                let chunk = String::from_utf8_lossy(&buffer[0..n]);
                accumulated.push_str(&chunk);

                // Look for JSON object (starts with { and ends with })
                if accumulated.contains('{') && accumulated.contains('}') {
                    // Extract JSON
                    if let Some(start_idx) = accumulated.find('{') {
                        if let Some(end_idx) = accumulated[start_idx..].find('}') {
                            let json = &accumulated[start_idx..start_idx + end_idx + 1];
                            return Ok(Some(json.to_string()));
                        }
                    }
                }
            }
            Ok(_) => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                return Err(e.into());
            }
        }
    }

    Ok(None)
}

pub fn list_local_files(path: Option<&Path>, long: bool) -> Result<()> {
    let search_path = path.unwrap_or(Path::new("."));

    if !search_path.exists() {
        return Err(anyhow::anyhow!("Path not found: {}", search_path.display()));
    }

    println!("Local files in {}:", search_path.display());
    println!();

    let mut files: Vec<FileInfo> = Vec::new();

    // Scan directory for .js and .raw files
    if search_path.is_dir() {
        for entry in fs::read_dir(search_path)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_file() {
                if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                    if filename.ends_with(".js") || filename.ends_with(".raw") {
                        let metadata = fs::metadata(&path)?;
                        let size = metadata.len() as usize;

                        let file_type = if filename.ends_with(".js") {
                            "wavelet"
                        } else if filename.ends_with(".raw") {
                            "signal"
                        } else {
                            "unknown"
                        };

                        let hash = if long {
                            Some(calculate_file_hash(&path)?)
                        } else {
                            None
                        };

                        files.push(FileInfo {
                            name: filename.to_string(),
                            size,
                            hash,
                            file_type: file_type.to_string(),
                        });
                    }
                }
            }
        }
    }

    if files.is_empty() {
        println!("No .js or .raw files found");
        return Ok(());
    }

    // Sort by name
    files.sort_by(|a, b| a.name.cmp(&b.name));

    let total_count = files.len();

    if long {
        // Detailed listing
        for file in &files {
            println!(
                "{:<30} {:>10}  {}  {}",
                file.name,
                format_bytes(file.size),
                file.file_type,
                file.hash.as_deref().unwrap_or("")
            );
        }
    } else {
        // Simple listing
        for file in &files {
            println!(
                "{:<30} {:>10}  {}",
                file.name,
                format_bytes(file.size),
                file.file_type
            );
        }
    }

    println!("\nTotal: {} files", total_count);

    Ok(())
}

pub fn sync_status(verbose: bool, port: &mut Box<dyn SerialPort>) -> Result<()> {
    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║              EMWaver Sync Status                         ║");
    println!("╚══════════════════════════════════════════════════════════╝");
    println!();

    let port_name = port.name().unwrap_or("unknown".to_string());
    println!("📡 Connection:");
    println!("   Serial Port: {}", port_name);
    println!("   Status:      ✓ Connected");
    println!();

    if verbose {
        println!("🔧 Configuration:");
        println!("   Baud Rate:   115200");
        println!("   Chunk Size:  4 KB");
        println!("   Protocol:    UART → Firmware → BLE → Android");
        println!();
    }

    println!("💾 Available Commands:");
    println!("   emwaver sync push <file>      - Upload file to device");
    println!("   emwaver sync pull <name>      - Download file from device");
    println!("   emwaver sync list             - List remote files");
    println!("   emwaver sync ls-local         - List local files");
    println!("   emwaver sync clone            - Clone all remote files");
    println!("   emwaver sync push-all         - Upload all local files");
    println!("   emwaver sync diff [file]      - Show differences");
    println!();

    println!("✓ Ready for sync operations");

    Ok(())
}

pub fn remove_file(name: &str, force: bool, _port: &mut Box<dyn SerialPort>) -> Result<()> {
    if !force {
        print!("Remove {} from device? [y/N] ", name);
        std::io::stdout().flush()?;

        let mut response = String::new();
        std::io::stdin().read_line(&mut response)?;

        if !response.trim().eq_ignore_ascii_case("y") {
            println!("Cancelled");
            return Ok(());
        }
    }

    println!("Removing {} from device...", name);

    // TODO: Implement remove command
    println!("Remove not yet implemented (needs firmware support)");

    Ok(())
}

pub fn clone_all(directory: &Path, _force: bool, _port: &mut Box<dyn SerialPort>) -> Result<()> {
    println!(
        "Cloning all files from device to {}...",
        directory.display()
    );

    // Create directory if it doesn't exist
    if !directory.exists() {
        fs::create_dir_all(directory)?;
        println!("Created directory: {}", directory.display());
    }

    // TODO: Get file list from device, then pull each file
    println!("Clone not yet fully implemented (needs list + pull)");

    Ok(())
}

pub fn push_all(path: Option<&Path>, force: bool, port: &mut Box<dyn SerialPort>) -> Result<()> {
    let search_path = path.unwrap_or(Path::new("."));

    println!("Pushing all files from {}...", search_path.display());

    let mut count = 0;

    for entry in fs::read_dir(search_path)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_file() {
            if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                if filename.ends_with(".js") || filename.ends_with(".raw") {
                    println!("\n[{}/??] Pushing {}...", count + 1, filename);

                    match push_file(&path, force, port) {
                        Ok(_) => count += 1,
                        Err(e) => eprintln!("Error pushing {}: {}", filename, e),
                    }
                }
            }
        }
    }

    println!("\n✓ Pushed {} files", count);

    Ok(())
}

pub fn pull_all(output: &Path, _force: bool, _port: &mut Box<dyn SerialPort>) -> Result<()> {
    println!("Pulling all files to {}...", output.display());

    // Create directory if it doesn't exist
    if !output.exists() {
        fs::create_dir_all(output)?;
    }

    // TODO: Get file list, then pull each file
    println!("Pull-all not yet fully implemented (needs list + pull)");

    Ok(())
}

pub fn show_diff(file: Option<&str>, _port: &mut Box<dyn SerialPort>) -> Result<()> {
    if let Some(filename) = file {
        println!("Comparing local and remote versions of {}...", filename);
        // TODO: Pull remote file, compare hashes or content
    } else {
        println!("Comparing all files...");
        // TODO: List both local and remote, show differences
    }

    println!("Diff not yet implemented (needs list + hash comparison)");

    Ok(())
}

pub fn show_info(name: &str, _port: &mut Box<dyn SerialPort>) -> Result<()> {
    println!("Getting info for {}...", name);

    // TODO: Query device for file metadata
    println!("Info not yet implemented (needs firmware support)");

    Ok(())
}

// Helper: calculate SHA256 hash of a file
fn calculate_file_hash(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];

    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

// Helper: wait for "ok" response from device
fn wait_for_ok(port: &mut Box<dyn SerialPort>) -> Result<bool> {
    let mut buffer = [0u8; 1024];
    let timeout = Duration::from_secs(5);
    port.set_timeout(timeout)?;

    let start = std::time::Instant::now();
    let mut accumulated = String::new();

    println!("DEBUG: Waiting for device response...");

    while start.elapsed() < timeout {
        match port.read(&mut buffer) {
            Ok(n) if n > 0 => {
                let chunk = String::from_utf8_lossy(&buffer[0..n]);
                print!("DEBUG: Received: {}", chunk);
                accumulated.push_str(&chunk);

                // Check for "ok" response
                if accumulated.contains("ok") {
                    println!("DEBUG: Got 'ok' response");
                    return Ok(true);
                }

                // Check for error response
                if accumulated.contains("err") {
                    eprintln!("Device error: {}", accumulated.trim());
                    return Ok(false);
                }
            }
            Ok(_) => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(e) => {
                return Err(e.into());
            }
        }
    }

    println!("DEBUG: Timeout! Accumulated: '{}'", accumulated);
    Err(anyhow::anyhow!("Timeout waiting for device response"))
}

// Helper: print progress bar
fn print_progress(
    percentage: usize,
    current: usize,
    total: usize,
    _chunk_bytes: usize,
    total_bytes: usize,
) {
    const BAR_WIDTH: usize = 40;
    let filled = (percentage * BAR_WIDTH) / 100;
    let empty = BAR_WIDTH - filled;

    print!("\r[");
    print!("{}", "=".repeat(filled));
    if filled < BAR_WIDTH {
        print!(">");
    }
    print!("{}", " ".repeat(empty.saturating_sub(1)));
    print!(
        "] {}% ({}/{} chunks, {} bytes)",
        percentage,
        current,
        total,
        format_bytes(total_bytes)
    );

    std::io::stdout().flush().ok();
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
