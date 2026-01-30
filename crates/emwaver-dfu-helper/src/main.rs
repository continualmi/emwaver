use emwaver_dfu::{DfuDevice, DfuOpenOptions, DEFAULT_USB_PRODUCT_ID, DEFAULT_USB_VENDOR_ID};
use std::{env, fs, process};

fn main() {
    let args: Vec<String> = env::args().collect();
    let code = match args.get(1).map(|s| s.as_str()) {
        Some("is-connected") => cmd_is_connected(),
        Some("flash") => cmd_flash(&args[2..]),
        _ => {
            eprintln!(
                "usage:\n  emwaver-dfu-helper is-connected\n  emwaver-dfu-helper flash --firmware <path> [--alt <n>] [--verbose]"
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
