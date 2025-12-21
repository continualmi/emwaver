---
title: STM32 (STM32F042) Flashing
---

# STM32 (STM32F042) Flashing

This guide covers manual firmware build + flashing for **STM32-based EMWaver devices**:

- Infrared Waver
- ISM Waver
- RFID Waver

All STM32 devices in the lineup use the same MCU (**STM32F042**, 48 MHz, native USB 2.0) and flash over **USB DFU** using ST’s tools.

<div class="emw-youtube">
  <iframe
    src="https://www.youtube.com/embed/vVpXeJAoiaE"
    title="EMWaver STM32 Flashing"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen
  ></iframe>
</div>

[![EMWavers YouTube Channel](../../assets/emwavers-youtube-channel.jpg){ .emw-icon width="28" }](https://www.youtube.com/@EMWavers)
[EMWavers YouTube Channel](https://www.youtube.com/@EMWavers){ .md-button .md-button--primary }

## 1) Install ST Tools (Windows)

The STM32 workflow is easiest with ST’s GUI tools. Install:

- STM32CubeIDE (build)
- STM32CubeMX (code generation)
- STM32CubeProgrammer (flash over USB DFU)

Official downloads:

- https://www.st.com/en/development-tools/stm32cubeide.html
- https://www.st.com/en/development-tools/stm32cubeprog.html
- https://www.st.com/en/development-tools/stm32cubemx.html

## 2) Generate a Project (`emwaver-cli`)

You can run `emwaver-cli` on Windows or in WSL. If you use WSL, **copy the generated project to a normal Windows folder** (for example `Documents/`) before opening it in STM32CubeIDE (CubeIDE doesn’t like WSL paths).

Install the CLI:

```bash
curl -fsSL https://raw.githubusercontent.com/luispl77/emwaver/main/cli/install.sh | sh
```

Generate a project:

```bash
emwaver init --target stm32f042 --path ./my-stm32-proj
```

## 3) Build (STM32CubeIDE)

1. File → Open Projects from File System... → select the project folder.
2. Open the project’s `.ioc` file and click **Generate Code**.
3. Build using the **Release** configuration (Debug may not fit on STM32F042).
4. The output `.elf` is under `Release/`.

## 4) Flash (STM32CubeProgrammer, USB DFU)

Hardware setup:

1. Set the device BOOT/FLASH switch to **flash mode** (gear icon).
2. Connect the device via USB. (Optional: use a small USB-C female-to-female adapter to reduce wear from plugging/unplugging directly.)

Flashing in STM32CubeProgrammer:

1. Select **USB** (not ST-LINK). You should see a USB connector entry (for example, `USB1`).
2. Click **Connect**.
3. Open the firmware `.elf`.
4. Click **Download** to flash.
5. Unplug, switch to **run mode** (play icon), and reconnect to test in the EMWaver app.

## 5) Quick Test (EMWaver App)

1. Switch to **run mode** (play icon) and reconnect the device.
2. Open the EMWaver app and connect to the device to confirm it enumerates and responds.
