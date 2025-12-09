# EMWaver CLI

Command-line interface for interacting with EMWaver devices.

## Installation

### Quick Install (Linux/macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/luispl77/emwaver/main/cli/install.sh | sh
```

This will:
- Detect your platform (Linux/macOS)
- Download the appropriate binary
- Install it to `~/.local/bin/emwaver`
- Add it to your PATH

### Manual Installation

1. Download the binary for your platform from [Releases](https://github.com/luispl77/emwaver/releases)
2. Make it executable: `chmod +x emwaver`
3. Move it to a directory in your PATH (e.g., `~/.local/bin/` or `/usr/local/bin/`)

### Building from Source

```bash
cd cli
cargo build --release
# Binary will be at target/release/emwaver
```

## Usage

```bash
# Connect to a nearby EMWaver device and open an interactive shell
emwaver shell

# Show raw hex payloads alongside ASCII output
emwaver shell --verbose
```

## Development

### Running Tests

```bash
cargo test
```

### Building for Different Platforms

```bash
# Linux x86_64
cargo build --release --target x86_64-unknown-linux-gnu

# macOS (Intel)
cargo build --release --target x86_64-apple-darwin

# macOS (Apple Silicon)
cargo build --release --target aarch64-apple-darwin

# Windows
cargo build --release --target x86_64-pc-windows-msvc
```

## Requirements

- Rust 1.78+ (for Cargo.lock v4 support)
- Linux: `libbluetooth-dev` and `pkg-config` for BLE support
- macOS: No additional dependencies
- Windows: No additional dependencies
