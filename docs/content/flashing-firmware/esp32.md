---
title: ESP32 (ESP32-S3) Flashing
---

# ESP32 (ESP32-S3) Flashing

This guide covers manual firmware build + flashing for **ESP32-S3 based EMWaver devices**:

- EMWaver DIY
- EMWaver Shield
- EMWaver (flagship)

All ESP32 devices use the same **ESP32-S3** MCU, so the flashing workflow is the same across the lineup (including standalone ESP32-S3 dev boards).

<div class="emw-youtube">
  <iframe
    src="https://www.youtube.com/embed/L5RjArbZA84"
    title="EMWaver ESP32 Flashing"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen
  ></iframe>
</div>

[![EMWavers YouTube Channel](../assets/emwavers-youtube-channel.jpg){ .emw-icon width="28" }](https://www.youtube.com/@EMWavers)
[EMWavers YouTube Channel](https://www.youtube.com/@EMWavers){ .md-button .md-button--primary }

## Linux

### 1) Install ESP-IDF

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

### 2) Install `emwaver-cli`

Install the CLI (this gives you the terminal UI and `init` project generator):

```bash
curl -fsSL https://raw.githubusercontent.com/luispl77/emwaver/main/cli/install.sh | sh
```

### 3) Create a Firmware Project

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

### 4) Build + Flash

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

### 5) Verify (BLE Shell)

If your computer has Bluetooth enabled, you can verify the firmware by opening a BLE shell:

```bash
emwaver shell
```

Then run a command like `version`.

## macOS

The overall flow is the same as Linux (ESP-IDF + `emwaver-cli` + `idf.py flash`), with these macOS-specific notes:

### USB-to-Serial Driver (CH34x)

If your device shows up as a CH34* USB-serial bridge, install the WCH serial driver so macOS creates a serial device node.

- Homebrew cask: https://formulae.brew.sh/cask/wch-ch34x-usb-serial-driver

```bash
brew install --cask wch-ch34x-usb-serial-driver
```

### Find The Port

Ports are typically under `/dev/cu.*`:

- Example patterns: `/dev/cu.usbserial-*`, `/dev/cu.wchusbserial*`

## Windows (WSL2 + usbipd-win)

The easiest way to keep the workflow identical is to flash from **WSL2** (Ubuntu/Debian), and pass the USB device through from Windows using `usbipd-win`.

### 1) Attach The USB Device To WSL (PowerShell)

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

### 2) Verify The Serial Port In WSL

In WSL:

```bash
ls /dev/ttyUSB*
```

If you get permission errors, add your user to `dialout` and re-login (or run `newgrp`):

```bash
sudo usermod -a -G dialout $USER
newgrp dialout
```

### 3) Build + Flash (Inside WSL)

From here, follow the **Linux** steps above inside WSL (install ESP-IDF, install `emwaver-cli`, run `emwaver init`, then `idf.py -p PORT flash`).
