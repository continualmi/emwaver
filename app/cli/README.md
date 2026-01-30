# EMWaver CLI

Internal command-line tooling for EMWaver (not shipped).

## Building from source

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

## Notes

- Desktop support targets are macOS + Windows only (no Linux).
- No tests (tiny wrapper).

### STM32 Firmware Requirements

- STM32CubeMX installed (or set `EMWAVER_CUBEMX=/path/to/STM32CubeMX`)
- ARM toolchain: `arm-none-eabi-gcc` + `arm-none-eabi-objcopy` (STM32CubeIDE's bundled toolchain is auto-detected on macOS)
