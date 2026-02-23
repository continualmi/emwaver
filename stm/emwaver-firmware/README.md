# EMWaver STM32 Firmware

> Detailed, code-level documentation for the whole STM workspace now lives at `../README.md`.
> Keep this file as a quick project-local summary.

This directory contains the STM32F042G6UX EMWaver firmware implementation using STM32CubeIDE.

## Structure

- `Core/` - Core application code
  - `Inc/` - Header files
  - `Src/` - Source files
  - `Startup/` - Startup assembly files
- `Drivers/` - STM32 HAL/CMSIS vendor sources (vendored to keep builds deterministic without STM32CubeMX)
- `Middlewares/` - STM32 USB device library vendor sources (vendored to keep builds deterministic without STM32CubeMX)
- `USB_DEVICE/` - USB MIDI implementation (class-compliant Audio/MIDI)
  - `App/` - USB application code
  - `Target/` - USB target configuration
- `emwaver-firmware.ioc` - STM32CubeMX project file
- `STM32F042G6UX_FLASH.ld` - Linker script

## Building

Open `emwaver-firmware.ioc` in STM32CubeIDE and build from there.

Requirements:
- `arm-none-eabi-gcc` toolchain with a working C library/sysroot (headers like `stdint.h`/`stdio.h`)
- `make`

To export a `.bin` and update the Android DFU asset (`android/app/src/main/assets/dfu.dfu`), run:

```bash
bash stm/emwaver-firmware/build_android_asset.sh
```

## Communication

- **Protocol**: USB MIDI (SysEx tunnel)
- **Transport**: class-compliant USB MIDI (Audio/MIDI Streaming)

## Features

- USB MIDI communication (SysEx tunnel for fixed 64-byte packets)
- GPIO command protocol (`gpio in/out/read/high/low/pull/info`)
- Sampler stream (`sample start --pin=<encodedPin>`, `sample stop`)
- Retransmit stream (`transmit start --pin=<encodedPin>`, `transmit stop`)
- Version command (`version`) prints a welcome string ending in `1.0.0`

## IDE Files

- `.cproject` - Eclipse CDT project file
- `.project` - Eclipse project file
- `.mxproject` - STM32CubeMX project metadata
