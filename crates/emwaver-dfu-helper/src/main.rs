use base64::Engine as _;
use emwaver_dfu::{DfuDevice, DfuOpenOptions, DEFAULT_USB_PRODUCT_ID, DEFAULT_USB_VENDOR_ID};
use std::{env, fs, process};

const DEVICE_ID_LEN: usize = 16;
const PROOF_LEN: usize = 64;
const IDENTITY_PAGE_SIZE: usize = 1024;
const DEFAULT_IDENTITY_PAGE_ADDR: u32 = 0x0800_7800;

fn main() {
    let args: Vec<String> = env::args().collect();
    let code = match args.get(1).map(|s| s.as_str()) {
        Some("is-connected") => cmd_is_connected(),
        Some("flash") => cmd_flash(&args[2..]),
        Some("read-identity") => cmd_read_identity(&args[2..]),
        Some("write-identity") => cmd_write_identity(&args[2..]),
        _ => {
            eprintln!(
                "usage:\n  emwaver-dfu-helper is-connected\n  emwaver-dfu-helper flash --firmware <path> [--alt <n>] [--verbose]\n  emwaver-dfu-helper read-identity [--addr <hex>] [--alt <n>] [--verbose]\n  emwaver-dfu-helper write-identity --device-id-b64 <b64> --proof-b64 <b64> [--addr <hex>] [--alt <n>] [--verbose]"
            );
            2
        }
    };
    process::exit(code);
}

fn cmd_is_connected() -> i32 {
    match DfuDevice::open_with_options(
        DEFAULT_USB_VENDOR_ID,
        DEFAULT_USB_PRODUCT_ID,
        DfuOpenOptions {
            alt_setting: None,
            verbose: false,
        },
    ) {
        Ok((_device, _discovery)) => 0,
        Err(err) if err.contains("No DFU device found") => 1,
        Err(err) => {
            eprintln!("{err}");
            2
        }
    }
}

fn cmd_flash(args: &[String]) -> i32 {
    let mut firmware_path: Option<String> = None;
    let mut alt_setting: Option<u8> = None;
    let mut verbose = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--firmware" => {
                i += 1;
                firmware_path = args.get(i).cloned();
            }
            "--alt" => {
                i += 1;
                let v = args.get(i).and_then(|s| s.parse::<u8>().ok()).or(None);
                alt_setting = v;
            }
            "--verbose" => {
                verbose = true;
            }
            other => {
                eprintln!("Unknown argument: {other}");
                return 2;
            }
        }
        i += 1;
    }

    let firmware_path = match firmware_path {
        Some(p) => p,
        None => {
            eprintln!("Missing --firmware <path>");
            return 2;
        }
    };

    let bytes = match fs::read(&firmware_path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("Failed to read {firmware_path}: {e}");
            return 2;
        }
    };

    println!("Using {} ({} bytes)", firmware_path, bytes.len());
    println!("Opening device in Update Mode...");

    let (mut device, _discovery) = match DfuDevice::open_with_options(
        DEFAULT_USB_VENDOR_ID,
        DEFAULT_USB_PRODUCT_ID,
        DfuOpenOptions {
            alt_setting,
            verbose,
        },
    ) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("{e}");
            return 2;
        }
    };

    match device.flash(&bytes, 0x0800_0000, |msg| println!("{msg}")) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{e}");
            2
        }
    }
}

fn build_identity_page(device_id: &[u8], proof: &[u8]) -> Result<Vec<u8>, String> {
    if device_id.len() != DEVICE_ID_LEN {
        return Err(format!("DeviceID must be {DEVICE_ID_LEN} bytes"));
    }
    if proof.len() != PROOF_LEN {
        return Err(format!("Proof must be {PROOF_LEN} bytes"));
    }

    let mut page = vec![0xFFu8; IDENTITY_PAGE_SIZE];
    page[0..4].copy_from_slice(b"EMID");
    page[4] = 1;
    page[5] = DEVICE_ID_LEN as u8;
    page[6] = PROOF_LEN as u8;

    let mut off = 16usize;
    page[off..off + DEVICE_ID_LEN].copy_from_slice(device_id);
    off += DEVICE_ID_LEN;
    page[off..off + PROOF_LEN].copy_from_slice(proof);

    Ok(page)
}

fn cmd_read_identity(args: &[String]) -> i32 {
    let mut addr: u32 = DEFAULT_IDENTITY_PAGE_ADDR;
    let mut alt_setting: Option<u8> = None;
    let mut verbose = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--addr" => {
                i += 1;
                let raw = args.get(i).cloned().unwrap_or_default();
                let raw = raw.trim_start_matches("0x");
                addr = u32::from_str_radix(raw, 16).unwrap_or(DEFAULT_IDENTITY_PAGE_ADDR);
            }
            "--alt" => {
                i += 1;
                let v = args.get(i).and_then(|s| s.parse::<u8>().ok()).or(None);
                alt_setting = v;
            }
            "--verbose" => {
                verbose = true;
            }
            other => {
                eprintln!("Unknown argument: {other}");
                return 2;
            }
        }
        i += 1;
    }

    let (mut device, _discovery) = match DfuDevice::open_with_options(
        DEFAULT_USB_VENDOR_ID,
        DEFAULT_USB_PRODUCT_ID,
        DfuOpenOptions {
            alt_setting,
            verbose,
        },
    ) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("{e}");
            return 2;
        }
    };

    if let Err(e) = device.set_address_pointer(addr) {
        eprintln!("{e}");
        return 2;
    }

    let mut buf = vec![0u8; IDENTITY_PAGE_SIZE];
    let n = match device.read_block(2, &mut buf) {
        Ok(n) => n,
        Err(e) => {
            eprintln!("{e}");
            return 2;
        }
    };

    if n != IDENTITY_PAGE_SIZE {
        eprintln!("Identity page read returned {n} bytes (expected {IDENTITY_PAGE_SIZE})");
        return 2;
    }

    // Parse out DeviceID + Proof if header is present.
    let magic_ok = buf.len() >= 16 && &buf[0..4] == b"EMID";
    let ver_ok = magic_ok && buf[4] == 1;
    let len_ok = ver_ok && buf[5] == DEVICE_ID_LEN as u8 && buf[6] == PROOF_LEN as u8;

    println!("PAGE_ADDR=0x{addr:08x}");
    println!("PAGE_B64={}", base64::engine::general_purpose::STANDARD.encode(&buf));
    println!("HAS_HEADER={}", if len_ok { "1" } else { "0" });

    if len_ok {
        let device_id = &buf[16..(16 + DEVICE_ID_LEN)];
        let proof_off = 16 + DEVICE_ID_LEN;
        let proof = &buf[proof_off..(proof_off + PROOF_LEN)];
        println!(
            "DEVICE_ID_B64={}",
            base64::engine::general_purpose::STANDARD.encode(device_id)
        );
        println!(
            "PROOF_B64={}",
            base64::engine::general_purpose::STANDARD.encode(proof)
        );
    }

    0
}

fn cmd_write_identity(args: &[String]) -> i32 {
    let mut device_id_b64: Option<String> = None;
    let mut proof_b64: Option<String> = None;
    let mut addr: u32 = DEFAULT_IDENTITY_PAGE_ADDR;
    let mut alt_setting: Option<u8> = None;
    let mut verbose = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--device-id-b64" => {
                i += 1;
                device_id_b64 = args.get(i).cloned();
            }
            "--proof-b64" => {
                i += 1;
                proof_b64 = args.get(i).cloned();
            }
            "--addr" => {
                i += 1;
                let raw = args.get(i).cloned().unwrap_or_default();
                let raw = raw.trim_start_matches("0x");
                addr = u32::from_str_radix(raw, 16).unwrap_or(DEFAULT_IDENTITY_PAGE_ADDR);
            }
            "--alt" => {
                i += 1;
                let v = args.get(i).and_then(|s| s.parse::<u8>().ok()).or(None);
                alt_setting = v;
            }
            "--verbose" => {
                verbose = true;
            }
            other => {
                eprintln!("Unknown argument: {other}");
                return 2;
            }
        }
        i += 1;
    }

    let device_id_b64 = match device_id_b64 {
        Some(v) => v,
        None => {
            eprintln!("Missing --device-id-b64 <b64>");
            return 2;
        }
    };
    let proof_b64 = match proof_b64 {
        Some(v) => v,
        None => {
            eprintln!("Missing --proof-b64 <b64>");
            return 2;
        }
    };

    let device_id = match base64::engine::general_purpose::STANDARD.decode(&device_id_b64) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Invalid base64 device id: {e}");
            return 2;
        }
    };
    let proof = match base64::engine::general_purpose::STANDARD.decode(&proof_b64) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Invalid base64 proof: {e}");
            return 2;
        }
    };

    let page = match build_identity_page(&device_id, &proof) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{e}");
            return 2;
        }
    };

    let (mut device, _discovery) = match DfuDevice::open_with_options(
        DEFAULT_USB_VENDOR_ID,
        DEFAULT_USB_PRODUCT_ID,
        DfuOpenOptions {
            alt_setting,
            verbose,
        },
    ) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("{e}");
            return 2;
        }
    };

    if let Err(e) = device.set_address_pointer(addr) {
        eprintln!("{e}");
        return 2;
    }

    if let Err(e) = device.write_block(2, &page) {
        eprintln!("{e}");
        return 2;
    }

    println!("Identity page written to 0x{addr:08x}");
    0
}
