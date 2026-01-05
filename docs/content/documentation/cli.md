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

#### macOS note (libusb)

On macOS, the CLI uses a vendored libusb build (no Homebrew libusb required). If you previously installed a build that fails with `Library not loaded: ...libusb-1.0.0.dylib`, reinstall from source:

```bash
cargo install --path cli --bin emwaver --force
```

## Usage

`emwaver init` writes/overwrites the firmware template files in the destination directory.

```bash
# Launch the interactive menu
emwaver

# Daemon: keep a persistent device connection (recommended for shell/workflows)
emwaver start
emwaver status
emwaver connect
emwaver cmd version

# Connect to a nearby EMWaver device (USB MIDI) and open an interactive shell
emwaver shell

# Show raw hex payloads alongside ASCII output
emwaver shell --verbose

# Initialize an STM32F042 CubeIDE/CubeMX project
emwaver init --target stm32f042 --path ./my-stm32-proj

# Build firmware (STM32 CubeMX/CubeIDE)
emwaver build

# Flash firmware (runs CubeMX codegen, builds with `make`, exports `.bin`, then flashes over USB DFU)
emwaver flash

# Standalone STM32 DFU flashing (raw `.bin` or `.dfu` bytes)
emwaver dfu ./firmware.bin
```

## Daemon Notes

The CLI includes a Unix-only local daemon that keeps the USB MIDI connection alive and exposes a local Unix socket for `emwaver shell`, `emwaver daemon ...`, and higher-level workflows (`emwaver buffer/sampler/retransmit`).

See [EMWaver Daemon + CLI](daemon.md) for the full “connect → cmd → workflows” flow.

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
- Linux: `pkg-config` + `libusb` headers may be required (DFU flashing)
- macOS: No additional dependencies
- Windows: No additional dependencies

### STM32 Firmware Requirements

- STM32CubeMX installed (or set `EMWAVER_CUBEMX=/path/to/STM32CubeMX`)
- ARM toolchain: `arm-none-eabi-gcc` + `arm-none-eabi-objcopy` (STM32CubeIDE's bundled toolchain is auto-detected on macOS)
