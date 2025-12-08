use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use btleplug::api::{
    Central, CentralEvent, CentralState, Characteristic, Manager as _, Peripheral as _, ScanFilter,
    WriteType,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::runtime::Runtime;
use tokio::time::{sleep, timeout};
use tokio_stream::StreamExt;
use uuid::Uuid;

const TARGET_DEVICE_NAME: &str = "EMWaver";
const SERVICE_UUID: Uuid = uuid::uuid!("45c7158e-0c3b-4e90-a847-452a15b14191");
const CMD_CHAR_UUID: Uuid = uuid::uuid!("46c7158e-0c3b-4e90-a847-452a15b14191");
const NOTIF_CHAR_UUID: Uuid = uuid::uuid!("47c7158e-0c3b-4e90-a847-452a15b14191");

static PROMPT_PENDING: AtomicBool = AtomicBool::new(true);

pub fn run_shell(verbose: bool) -> Result<()> {
    let runtime = Runtime::new().context("failed to create async runtime")?;
    runtime.block_on(async { run_shell_async(verbose).await })
}

async fn run_shell_async(verbose: bool) -> Result<()> {
    let manager = Manager::new()
        .await
        .context("failed to initialize BLE manager")?;
    let adapters = manager
        .adapters()
        .await
        .context("failed to list BLE adapters")?;
    let adapter = adapters
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("no BLE adapters found"))?;

    match adapter
        .adapter_state()
        .await
        .context("failed to query Bluetooth power state")?
    {
        CentralState::PoweredOff => {
            println!("Bluetooth appears to be off. Enable Bluetooth and rerun `emwaver shell`.");
            return Ok(());
        }
        CentralState::Unknown => {
            println!(
                "Bluetooth adapter state is unknown. Ensure Bluetooth is enabled if discovery fails."
            );
        }
        CentralState::PoweredOn => {}
    }

    println!("Scanning for EMWaver devices...");
    let peripheral = discover_target(&adapter).await?;
    adapter.stop_scan().await.ok();

    let address = peripheral.address();
    println!("Connecting to EMWaver ({address})...");

    if !peripheral.is_connected().await? {
        peripheral
            .connect()
            .await
            .context("failed to connect to EMWaver")?;
    }

    peripheral
        .discover_services()
        .await
        .context("failed to discover services")?;

    let (cmd_char, notif_char) = locate_characteristics(&peripheral)?;

    peripheral
        .subscribe(&notif_char)
        .await
        .context("failed to enable notifications")?;

    let mut notifications = peripheral
        .notifications()
        .await
        .context("failed to listen for notifications")?;

    let notify_task = tokio::spawn(async move {
        while let Some(event) = notifications.next().await {
            if event.uuid == NOTIF_CHAR_UUID {
                render_notification(&event.value, verbose);
            }
        }
    });

    let repl_result = run_repl(peripheral.clone(), &cmd_char).await;

    notify_task.abort();
    let _ = notify_task.await;

    let _ = timeout(Duration::from_secs(2), peripheral.unsubscribe(&notif_char)).await;
    let _ = timeout(Duration::from_secs(2), peripheral.disconnect()).await;

    repl_result
}

async fn discover_target(adapter: &Adapter) -> Result<Peripheral> {
    let mut events = adapter
        .events()
        .await
        .context("failed to subscribe to adapter events")?;

    adapter
        .start_scan(ScanFilter::default())
        .await
        .context("failed to start BLE scan")?;

    let timeout = Duration::from_secs(20);
    let mut elapsed = Duration::from_millis(0);

    loop {
        tokio::select! {
            maybe_event = events.next() => {
                if let Some(event) = maybe_event {
                    if let Some(peripheral) = handle_event(adapter, event).await? {
                        println!("Found EMWaver device: {}", peripheral.address());
                        return Ok(peripheral);
                    }
                } else {
                    bail!("BLE adapter event stream ended unexpectedly");
                }
            }
            _ = sleep(Duration::from_millis(500)) => {
                elapsed += Duration::from_millis(500);
                if elapsed >= timeout {
                    bail!("timed out scanning for EMWaver device");
                }
            }
        }
    }
}

async fn handle_event(adapter: &Adapter, event: CentralEvent) -> Result<Option<Peripheral>> {
    match event {
        CentralEvent::DeviceDiscovered(id)
        | CentralEvent::DeviceUpdated(id)
        | CentralEvent::DeviceConnected(id) => {
            let peripheral = adapter
                .peripheral(&id)
                .await
                .context("failed to access peripheral")?;
            if let Some(props) = peripheral
                .properties()
                .await
                .context("failed to read peripheral properties")?
            {
                if let Some(name) = props.local_name {
                    if name == TARGET_DEVICE_NAME {
                        return Ok(Some(peripheral));
                    }
                }
            }
            Ok(None)
        }
        CentralEvent::DeviceDisconnected(_) => Ok(None),
        CentralEvent::ManufacturerDataAdvertisement {
            id,
            manufacturer_data: _,
        } => {
            let peripheral = adapter
                .peripheral(&id)
                .await
                .context("failed to access peripheral")?;
            if let Some(props) = peripheral
                .properties()
                .await
                .context("failed to read peripheral properties")?
            {
                if let Some(name) = props.local_name {
                    if name == TARGET_DEVICE_NAME {
                        return Ok(Some(peripheral));
                    }
                }
            }
            Ok(None)
        }
        _ => Ok(None),
    }
}

fn locate_characteristics(peripheral: &Peripheral) -> Result<(Characteristic, Characteristic)> {
    let mut cmd_char = None;
    let mut notif_char = None;

    for service in peripheral.services() {
        if service.uuid == SERVICE_UUID {
            for characteristic in service.characteristics.iter() {
                if characteristic.uuid == CMD_CHAR_UUID {
                    cmd_char = Some(characteristic.clone());
                }
                if characteristic.uuid == NOTIF_CHAR_UUID {
                    notif_char = Some(characteristic.clone());
                }
            }
        }
    }

    let cmd = cmd_char.ok_or_else(|| anyhow!("command characteristic not found"))?;
    let notif = notif_char.ok_or_else(|| anyhow!("notification characteristic not found"))?;

    Ok((cmd, notif))
}

async fn run_repl(peripheral: Peripheral, cmd_char: &Characteristic) -> Result<()> {
    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut line = String::new();

    loop {
        if PROMPT_PENDING.swap(false, Ordering::SeqCst) {
            print_prompt()?;
        }
        line.clear();

        tokio::select! {
            res = reader.read_line(&mut line) => {
                let bytes_read = res.context("failed to read input")?;
                if bytes_read == 0 {
                    println!("\nEnd of input, exiting shell.");
                    break;
                }

                let trimmed = line.trim_end_matches(['\r', '\n']);
                if trimmed.eq_ignore_ascii_case("exit") || trimmed.eq_ignore_ascii_case("quit") {
                    println!("Exiting shell.");
                    break;
                }
                if trimmed.is_empty() {
                    PROMPT_PENDING.store(true, Ordering::SeqCst);
                    continue;
                }

                match parse_command(trimmed) {
                    Ok(payload) => {
                        if let Err(err) = peripheral.write(cmd_char, &payload, WriteType::WithResponse).await {
                            println!("Write failed: {err}");
                        }
                    }
                    Err(err) => {
                        println!("Parse error: {err}");
                    }
                }
                PROMPT_PENDING.store(true, Ordering::SeqCst);
            }
            _ = tokio::signal::ctrl_c() => {
                print!("\r\x1b[K");
                io::stdout().flush().ok();
                println!("Use 'exit' to leave the EMWaver shell.");
                PROMPT_PENDING.store(true, Ordering::SeqCst);
            }
        }
    }

    Ok(())
}

fn parse_command(input: &str) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut idx = 0;
    let data = input.as_bytes();

    while idx < data.len() {
        if data[idx] == b'[' {
            let end = input[idx + 1..]
                .find(']')
                .map(|off| idx + 1 + off)
                .ok_or_else(|| anyhow!("missing closing ']'"))?;
            let content = input[idx + 1..end].trim();
            let value = parse_bracket_value(content)?;
            bytes.push(value);
            idx = end + 1;
        } else {
            bytes.push(data[idx]);
            idx += 1;
        }
    }

    Ok(bytes)
}

fn parse_bracket_value(content: &str) -> Result<u8> {
    if content.is_empty() {
        bail!("empty value inside brackets");
    }

    let value = if let Some(stripped) = content
        .strip_prefix("0x")
        .or_else(|| content.strip_prefix("0X"))
    {
        u8::from_str_radix(stripped, 16).context("invalid hex value")?
    } else {
        u8::from_str_radix(content, 10).context("invalid decimal value")?
    };

    Ok(value)
}

fn render_notification(data: &[u8], verbose: bool) {
    if data.is_empty() {
        return;
    }

    let ascii = data
        .iter()
        .map(|&b| match b {
            0x20..=0x7E => b as char,
            _ => '.',
        })
        .collect::<String>();

    if verbose {
        let hex = data
            .iter()
            .map(|b| format!("{:02X}", b))
            .collect::<Vec<_>>()
            .join(" ");
        print!("\r\x1b[K");
        io::stdout().flush().ok();
        println!("<- hex:   {hex}");
        println!("<- ascii: {ascii}");
    } else {
        print!("\r\x1b[K");
        io::stdout().flush().ok();
        println!("<- {ascii}");
    }
    if let Err(err) = print_prompt() {
        eprintln!("Failed to print prompt: {err}");
    }
    PROMPT_PENDING.store(false, Ordering::SeqCst);
}

fn print_prompt() -> Result<()> {
    print!("<emwaver> ");
    io::stdout().flush().context("failed to flush stdout")
}
