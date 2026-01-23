use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR missing"));
    let repo_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .expect("Expected app/src-tauri to have a repo root at ../..")
        .to_path_buf();

    let firmware_repo_override = repo_root.join("app/src-tauri/firmware/emwaver.bin");
    println!(
        "cargo:rerun-if-changed={}",
        firmware_repo_override.display()
    );
    // We intentionally bundle a repo-tracked binary.

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR missing"));
    let firmware_dest = out_dir.join("emwaver.bin");

    let bytes = fs::read(&firmware_repo_override).unwrap_or_else(|err| {
        panic!(
            "Missing bundled firmware at {} ({err}). Run `emwaver build` to generate it.",
            firmware_repo_override.display()
        )
    });
    fs::write(&firmware_dest, bytes).expect("Failed to write bundled firmware into OUT_DIR");

    tauri_build::build()
}
