# EMWaver STM32 GPIO Firmware

This directory contains the STM32F042G6UX GPIO firmware implementation using STM32CubeIDE.

## Structure

- `Core/` - Core application code
  - `Inc/` - Header files
  - `Src/` - Source files
  - `Startup/` - Startup assembly files
- `Drivers/` - HAL and CMSIS drivers
  - `CMSIS/` - CMSIS core files
  - `STM32F0xx_HAL_Driver/` - STM32 HAL drivers
- `Middlewares/` - Middleware libraries
  - `ST/STM32_USB_Device_Library/` - USB Device library
- `USB_DEVICE/` - USB CDC implementation
  - `App/` - USB application code
  - `Target/` - USB target configuration
- `emwaver-gpio-firmware.ioc` - STM32CubeMX project file
- `STM32F042G6UX_FLASH.ld` - Linker script

## Building

Open `emwaver-gpio-firmware.ioc` in STM32CubeIDE and build from there.

Requirements:
- `arm-none-eabi-gcc` toolchain with a working C library/sysroot (headers like `stdint.h`/`stdio.h`)
- `make`

To export a `.bin` and update the Android DFU asset (`android/app/src/main/assets/dfu.dfu`), run:

```bash
bash stm/emwaver-gpio-firmware/build_android_asset.sh
```

## Communication

- **Protocol**: USB CDC (USB Serial)
- **Baud Rate**: 115200
- **Interface**: Virtual COM Port

## Features

- USB CDC communication
- GPIO command protocol (`gpio in/out/read/high/low/pull/info`)
- Version command (`version`) prints a firmware-specific welcome string ending in `1.0.0`

## IDE Files

- `.cproject` - Eclipse CDT project file
- `.project` - Eclipse project file
- `.mxproject` - STM32CubeMX project metadata
