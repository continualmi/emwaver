---
title: Flashing Firmware (ESP32)
---

# Flashing Firmware (ESP32)

This page documents manual, terminal-based firmware flashing for ESP32-based EMWaver devices:

- EMWaver DIY
- EMWaver Shield
- EMWaver (flagship)

## Linux

### 1) Install ESP-IDF

Follow Espressif’s official “Get Started” guide for ESP-IDF (prereqs + Python tooling):

- https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/get-started/

We recommend keeping ESP-IDF in a dedicated folder under your home directory:

```bash
mkdir -p ~/ESP_on_home/ESP
cd ~/ESP_on_home/ESP
git clone --recursive https://github.com/espressif/esp-idf.git
```

Set the ESP-IDF tools path (recommended so tools live under the same folder):

```bash
export IDF_TOOLS_PATH="$HOME/ESP_on_home/ESP/tools"
```

Then install ESP-IDF tools:

```bash
cd ~/ESP_on_home/ESP/esp-idf
./install.sh
```

### 2) Install `emwaver-cli`

Install the CLI (this gives you the interactive terminal UI and `init` project generator):

```bash
curl -fsSL https://raw.githubusercontent.com/emwaver/emwaver/main/cli/install.sh | sh
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
idf.py -p <PORT> flash
idf.py -p <PORT> monitor
```

## macOS (Coming Soon)

The overall flow is the same as Linux (ESP-IDF + `emwaver-cli` + `idf.py flash`), with these macOS-specific notes:

### USB-to-Serial Driver (CH34x)

If your device shows up as a CH34* USB-serial bridge, install the WCH serial driver so macOS creates a serial device node.

- Driver: WCH CH34x serial (vendor-provided)

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

From here, follow the **Linux** steps above inside WSL (install ESP-IDF, install `emwaver-cli`, run `emwaver init`, then `idf.py -p <PORT> flash`).

## Device Notes

### EMWaver DIY

- TODO: Add the exact port/connector to use for flashing and the bootloader button sequence.

### EMWaver Shield

- TODO: Add the exact port/connector to use for flashing and the bootloader button sequence.

### EMWaver (Flagship)

- TODO: Add the exact port/connector to use for flashing and the bootloader button sequence.
