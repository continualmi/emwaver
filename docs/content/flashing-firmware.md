---
title: Flashing Firmware
---

# Flashing Firmware

This page documents manual firmware flashing for EMWaver devices.

## ESP32 (ESP32-S3)

Terminal-based flashing for ESP32-S3 based EMWaver devices:

- EMWaver DIY
- EMWaver Shield
- EMWaver (flagship)

All ESP32 devices use the same ESP32-S3 MCU, so the flashing workflow is the same across the lineup.

### Linux

#### 1) Install ESP-IDF

Follow Espressif’s official “Get Started” guide for ESP-IDF (prereqs + Python tooling):

- https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/get-started/

We recommend keeping ESP-IDF in a dedicated folder under your home directory:

```bash
mkdir -p ~/esp
cd ~/esp
git clone --recursive https://github.com/espressif/esp-idf.git
```

Set the ESP-IDF tools path (recommended so tools live under the same folder):

```bash
export IDF_TOOLS_PATH="$HOME/esp/tools"
```

Then install ESP-IDF tools:

```bash
cd ~/esp/esp-idf
./install.sh esp32s3
```

#### 2) Install `emwaver-cli`

Install the CLI (this gives you the terminal UI and `init` project generator):

```bash
curl -fsSL https://raw.githubusercontent.com/emwaver/emwaver/main/cli/install.sh | sh
```

#### 3) Create a Firmware Project

Create a folder for your firmware project:

```bash
mkdir -p ~/projects/emwaver-firmware
cd ~/projects/emwaver-firmware
```

Run the CLI and initialize a project:

- Launch the interactive menu: `emwaver`
- Choose `Project init`
- Select the components you want (Space toggles, Enter confirms)

Alternatively, you can generate directly:

```bash
emwaver init --target esp32s3 --path .
```

After init, load the ESP-IDF environment:

```bash
source setup.sh
```

#### 4) Build + Flash

1. Connect the device via a **data-capable** USB cable.
2. Find the port (use tab completion after typing `/dev/tty`):
   - Example patterns: `/dev/ttyUSB0`, `/dev/ttyACM0`
3. Build and flash:

```bash
idf.py set-target esp32s3
idf.py build
idf.py -p PORT flash
idf.py -p PORT monitor
```

#### 5) Verify (BLE Shell)

If your computer has Bluetooth enabled, you can verify the firmware by opening a BLE shell:

```bash
emwaver shell
```

Then run a command like `version`.

### macOS

The overall flow is the same as Linux (ESP-IDF + `emwaver-cli` + `idf.py flash`), with these macOS-specific notes:

#### USB-to-Serial Driver (CH34x)

If your device shows up as a CH34* USB-serial bridge, install the WCH serial driver so macOS creates a serial device node.

- Homebrew cask: https://formulae.brew.sh/cask/wch-ch34x-usb-serial-driver

```bash
brew install --cask wch-ch34x-usb-serial-driver
```

#### Find The Port

Ports are typically under `/dev/cu.*`:

- Example patterns: `/dev/cu.usbserial-*`, `/dev/cu.wchusbserial*`

### Windows (WSL2 + usbipd-win)

The easiest way to keep the workflow identical is to flash from **WSL2** (Ubuntu/Debian), and pass the USB device through from Windows using `usbipd-win`.

#### 1) Attach The USB Device To WSL (PowerShell)

Install `usbipd-win`:

```powershell
winget install dorssel.usbipd-win
```

List connected devices and note the `BUSID` for your USB-to-serial device:

```powershell
usbipd list
```

Bind it (example `BUSID` shown):

```powershell
usbipd bind --busid 1-5
```

Attach it to WSL:

```powershell
usbipd attach --busid 1-5 --wsl
```

If the device shows up in Windows Device Manager but not inside WSL, repeat the `usbipd` attach step and re-check `usbipd list`.

#### 2) Verify The Serial Port In WSL

In WSL:

```bash
ls /dev/ttyUSB*
```

If you get permission errors, add your user to `dialout` and re-login (or run `newgrp`):

```bash
sudo usermod -a -G dialout $USER
newgrp dialout
```

#### 3) Build + Flash (Inside WSL)

From here, follow the **Linux** steps above inside WSL (install ESP-IDF, install `emwaver-cli`, run `emwaver init`, then `idf.py -p PORT flash`).

## STM32 (STM32F042)

GUI-based flashing for STM32-based EMWaver devices:

- Infrared Waver
- ISM Waver
- RFID Waver

All STM32 devices in the lineup use the same MCU (STM32F042, 48 MHz, native USB 2.0) and flash over **USB DFU** using ST’s tools.

This guide focuses on Windows because the STM32 workflow is easiest with ST’s GUI tools. The flow is similar on other operating systems.

### 1) Install ST Tools (Windows)

Install:

- STM32CubeIDE (build)
- STM32CubeMX (code generation)
- STM32CubeProgrammer (flash over USB DFU)

Official downloads:

- https://www.st.com/en/development-tools/stm32cubeide.html
- https://www.st.com/en/development-tools/stm32cubeprog.html
- https://www.st.com/en/development-tools/stm32cubemx.html

### 2) Generate a Project (WSL or Windows)

We recommend using WSL (Ubuntu) to run `emwaver-cli` on Windows, then opening the generated project from the Windows filesystem in STM32CubeIDE.

Install `emwaver-cli` (project generator):

```bash
curl -fsSL https://raw.githubusercontent.com/emwaver/emwaver/main/cli/install.sh | sh
```

Generate a project:

```bash
emwaver init --target stm32f042 --path ./my-stm32-proj
```

If you used WSL to generate the project, copy it to a normal Windows path (e.g. `Documents/`) before opening it in STM32CubeIDE.

### 3) Build (STM32CubeIDE)

1. File → Open Projects from File System... → select the project folder.
2. Open the project’s `.ioc` file and click **Generate Code**.
3. Build using the **Release** configuration (Debug may not fit on STM32F042).
4. The output `.elf` is under `Release/`.

### 4) Flash (STM32CubeProgrammer, USB DFU)

Hardware setup:

1. Set the device BOOT/FLASH switch to **flash mode** (gear icon).
2. Connect the device via USB. (Optional: use a small USB-C female-to-female adapter to reduce wear from plugging/unplugging directly.)

Flashing in STM32CubeProgrammer:

1. Select **USB** (not ST-LINK). You should see a USB connector entry (for example, `USB1`).
2. Click **Connect**.
3. Open the firmware `.elf`.
4. Click **Download** to flash.
5. Unplug, switch to **run mode** (play icon), and reconnect to test in the EMWaver app.

### 5) Quick Test (EMWaver App)

1. Switch to **run mode** (play icon) and reconnect the device.
2. Open the EMWaver app and connect to the device to confirm it enumerates and responds.
