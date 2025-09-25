# EMWaver

<div align="center">
  <img src="logo.png" alt="EMWaver Logo" width="250">
  <h3><a href="https://docs.emwaver.com">📚 Website: docs.emwaver.com</a></h3>
</div>

## Overview

EMWaver is a versatile ESP32-S3 development board with a male USB-C connector designed to plug directly into smartphones. It combines multiple wireless technologies in one compact device:

- **CC1101 Transceiver**: For sub-GHz RF communication in ISM bands
- **Infrared**: Built-in IR LED and receiver
- **RFID Support**: Compatible with MFRC522 modules
- **16 GPIO Pins**: For connecting external hardware and sensors
- **USB HID**: Supports BadUSB functionality

## Features

- Direct smartphone connectivity (Android/iOS)
- BLE communication protocol
- 10μs precision signal sampling and transmission
- Simple command-based API

## Documentation

For complete documentation, visit [docs.emwaver.com](https://docs.emwaver.com)

## Command-Line Setup (ESP-IDF 5.5.1)

Follow Espressif's manual workflow if you prefer the command line; the steps below install ESP-IDF v5.5.1 and build EMWaver.

### Linux (Ubuntu/Debian)

```bash
sudo apt-get update && sudo apt-get install -y git wget flex bison gperf python3 python3-pip python3-venv \
    cmake ninja-build ccache libffi-dev libssl-dev dfu-util libusb-1.0-0

mkdir -p ~/esp && cd ~/esp
git clone -b v5.5.1 --recursive https://github.com/espressif/esp-idf.git
cd esp-idf
mkdir -p ~/esp/tools
export IDF_TOOLS_PATH=~/esp/tools
./install.sh esp32s3
source export.sh
idf.py --version  # Expect v5.5.1
rm -rf ../tools/dist  # Optional: drop cached downloads
```

If GitHub downloads are slow, export `IDF_GITHUB_ASSETS=dl.espressif.com/github_assets` before running `install.sh`.

### macOS (Intel & Apple Silicon)

```bash
brew update && brew install cmake ninja dfu-util ccache python@3

mkdir -p ~/esp && cd ~/esp
git clone -b v5.5.1 --recursive https://github.com/espressif/esp-idf.git
cd esp-idf
mkdir -p ~/esp/tools
export IDF_TOOLS_PATH=~/esp/tools
./install.sh esp32s3
source export.sh
idf.py --version
rm -rf ../tools/dist  # Optional: drop cached downloads
```

Install Rosetta on Apple Silicon if toolchain binaries fail (`/usr/sbin/softwareupdate --install-rosetta --agree-to-license`). For SSL certificate warnings, run the bundled `Install Certificates.command` from your Python directory.

### Windows (PowerShell)

```powershell
Set-Location $env:USERPROFILE
New-Item -ItemType Directory -Force -Path $env:USERPROFILE\esp | Out-Null
Set-Location $env:USERPROFILE\esp
git clone -b v5.5.1 --recursive https://github.com/espressif/esp-idf.git
Set-Location esp-idf
New-Item -ItemType Directory -Force -Path $env:USERPROFILE\esp\tools | Out-Null
$env:IDF_TOOLS_PATH = "$env:USERPROFILE\esp\tools"
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
.\install.ps1 esp32s3
.\export.ps1
idf.py --version
Remove-Item -Recurse -Force ..\tools\dist  # Optional: drop cached downloads
```

If PowerShell blocks script execution, reopen the shell after adjusting the execution policy. The ESP-IDF tools default to `%USERPROFILE%\.espressif`; overriding `IDF_TOOLS_PATH` keeps everything under `C:\Users\<you>\esp\tools`.

If you prefer a reusable alias, add `alias get_idf='source ~/emwaver/setup.sh'` to your shell profile so new sessions pick up the toolchain quickly.

### Build & Flash EMWaver Firmware

Once ESP-IDF 5.5.1 is available, clone this repository and build the project instead of the default hello_world example.

```bash
cd ~/projects  # Pick any workspace directory
git clone https://github.com/luispl/emwaver.git
cd emwaver
source setup.sh  # Load ESP-IDF tools into this shell (Linux/macOS, run with 'source' not 'bash')
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/ttyACM0 flash  # Replace with your serial port
idf.py -p /dev/ttyACM0 monitor
```

On Windows, run the same `idf.py` commands in the ESP-IDF PowerShell session after `cd emwaver`. Use `idf.py flash monitor` to chain flashing and serial monitoring in one step.

## License

This project is open source and available under the [LICENSE](LICENSE) file.


