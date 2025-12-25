# EMWaver STM32 ISM Firmware

This directory contains the STM32F042G6UX ISM/CC1101 firmware implementation using STM32CubeIDE.

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
- `emwaver-firmware.ioc` - STM32CubeMX project file
- `STM32F042G6UX_FLASH.ld` - Linker script

## Building

Open `emwaver-firmware.ioc` in STM32CubeIDE and build from there.

Requirements:
- `arm-none-eabi-gcc` toolchain with a working C library/sysroot (headers like `stdint.h`/`stdio.h`)
- `make`

To export a `.bin` and update the Android DFU asset (`android/app/src/main/assets/dfu.dfu`), run:

```bash
bash stm/emwaver-ism-firmware/build_android_asset.sh
```

## Communication

- **Protocol**: USB CDC (USB Serial)
- **Baud Rate**: 115200
- **Interface**: Virtual COM Port

## Features

- USB CDC communication
- CC1101 SPI register access (ISM)

## IDE Files

- `.cproject` - Eclipse CDT project file
- `.project` - Eclipse project file
- `.mxproject` - STM32CubeMX project metadata
