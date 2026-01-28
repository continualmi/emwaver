use std::{env, fs, path::PathBuf};

fn main() {
    slint_build::compile("ui/main.slint").expect("Failed to compile Slint UI");

    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR missing"));
    let repo_root = manifest_dir
        .parent()
        .expect("Expected desktop/ to have a repo root at ..")
        .to_path_buf();

    let firmware_repo_path = repo_root.join("app/src-tauri/firmware/emwaver.bin");
    println!("cargo:rerun-if-changed={}", firmware_repo_path.display());

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR missing"));
    let firmware_dest = out_dir.join("emwaver.bin");

    let bytes = fs::read(&firmware_repo_path).unwrap_or_else(|err| {
        panic!(
            "Missing bundled firmware at {} ({err}). Run `emwaver build` to generate it.",
            firmware_repo_path.display()
        )
    });
    fs::write(&firmware_dest, bytes).expect("Failed to write bundled firmware into OUT_DIR");
}
