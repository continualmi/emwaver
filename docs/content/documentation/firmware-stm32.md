---
title: STM32F042 Firmware (STM32CubeIDE)
---

# STM32F042 Firmware (STM32CubeIDE)

The STM32 firmware lives in `stm/emwaver-firmware/` and targets the **STM32F042** family of EMWaver devices.

## Devices (STM32 Family)

This firmware applies to the smaller STM32-based devices (all built around **STM32F042**, 48 MHz, native USB 2.0), including:

- **Infrared Waver**
- **ISM Waver**
- **RFID Waver**

## Tooling

The STM32 workflow uses ST’s tools:

- **STM32CubeIDE** (project import + build)
- **STM32CubeMX** (generates init/startup code from the `.ioc`)
- **STM32CubeProgrammer** (USB DFU flashing)

## Build (CubeIDE)

1. Open the project from `stm/emwaver-firmware/` in **STM32CubeIDE**.
2. Open `emwaver-firmware.ioc` and click **Generate Code**.
3. Build using the **Release** configuration (Debug often won’t fit).
4. The build output includes an `.elf` under the `Release/` output folder.

## Flash (USB DFU)

1. Put the device into DFU/flash mode using the boot switch (gear icon in the tutorial).
2. Connect via USB.
3. In **STM32CubeProgrammer** select **USB** and connect to the DFU device.
4. Load the generated `.elf` and download/flash.
5. Flip the boot switch back to “run” (play icon) before using the device normally.

For the full step-by-step guide, see **Flashing Firmware → STM32 (STM32F042)**.

## Communication (USB CDC)

The STM32 family communicates over **USB CDC** (virtual serial port), typically at **115200**.

The higher-level command protocol is documented in [Transport & Command Format](protocol.md).

