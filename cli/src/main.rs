fn main() {
    if let Err(err) = emwaver_cli::run() {
        eprintln!("Error: {err}");
        std::process::exit(1);
    }
}
