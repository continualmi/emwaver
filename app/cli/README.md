# EMWaver CLI

Minimal command-line tooling for EMWaver.

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


### Building from Source

```bash
cd app/cli
cargo build --release
# Binary will be at target/release/emwaver
```

#### macOS note (libusb)

On macOS, the CLI uses a vendored libusb build (no Homebrew libusb required). If you previously installed a build that fails with `Library not loaded: ...libusb-1.0.0.dylib`, reinstall from source:

```bash
cargo install --path app/cli --bin emwaver --force
```

## Usage

```bash
# Build the STM32 firmware (updates the bundled bin used by Desktop)
emwaver build

# Flash the bundled firmware to a device in Update Mode (DFU)
emwaver flash
```

## Development

### Running Tests

No tests (tiny wrapper).

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
