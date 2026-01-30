/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

fn main() {
    if let Err(err) = emw::run() {
        eprintln!("Error: {err}");
        std::process::exit(1);
    }
}
