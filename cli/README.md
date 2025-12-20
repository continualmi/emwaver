# EMWaver CLI

Command-line interface for interacting with EMWaver devices.

## Installation

### Manual Installation (Recommended)

1. Go to [Releases](https://github.com/luispl77/emwaver/releases) and download the binary for your platform:
   - **Linux**: `emwaver-cli-linux-x86_64`
   - **macOS Intel**: `emwaver-cli-macos-x86_64`
   - **macOS Apple Silicon**: `emwaver-cli-macos-aarch64`
   - **Windows**: `emwaver-cli-windows-x86_64.exe`

2. **Linux/macOS**: Make it executable and install:
   ```bash
   chmod +x emwaver-cli-linux-x86_64  # or macos version
   mkdir -p ~/.local/bin
   mv emwaver-cli-linux-x86_64 ~/.local/bin/emwaver
   # Add to PATH (add to ~/.bashrc or ~/.zshrc):
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
   source ~/.bashrc
   ```

3. **Windows**: Add the `.exe` file to your PATH or run it directly.

### Quick Install Script (If Available)

If you have access to the install script:
```bash
curl -fsSL https://raw.githubusercontent.com/luispl77/emwaver/main/cli/install.sh | sh
```

**Note**: This requires the repository to be public or access to the install script.

### Building from Source

```bash
cd cli
cargo build --release
# Binary will be at target/release/emwaver
```

## Usage

`emwaver init` writes/overwrites the firmware template files in the destination directory.

```bash
# Launch the interactive menu
emwaver

# Connect to a nearby EMWaver device and open an interactive shell
emwaver shell

# Show raw hex payloads alongside ASCII output
emwaver shell --verbose

# Initialize a new ESP32-S3 firmware project in the current folder
emwaver init --target esp32s3

# Initialize in a specific folder (created if missing)
emwaver init --target esp32s3 --path ./my-firmware

# Initialize with optional components
emwaver init --target esp32s3 --components gpio,sampler,cc1101

# Initialize with optional components into a specific folder
emwaver init --target esp32s3 --path ./my-firmware --components gpio,cc1101
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
