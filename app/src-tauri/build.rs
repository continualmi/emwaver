use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR missing"));
    let repo_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .expect("Expected app/src-tauri to have a repo root at ../..")
        .to_path_buf();

    let firmware_source = repo_root.join("stm/emwaver-firmware/Release/emwaver-firmware.bin");
    println!("cargo:rerun-if-changed={}", firmware_source.display());

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR missing"));
    let firmware_dest = out_dir.join("emwaver.bin");

    let bytes = fs::read(&firmware_source).unwrap_or_else(|err| {
        panic!(
            "Missing STM32 firmware binary at {} ({err}). Build it first (stm/emwaver-firmware).",
            firmware_source.display()
        )
    });
    fs::write(&firmware_dest, bytes).expect("Failed to write bundled firmware into OUT_DIR");

    tauri_build::build()
}
