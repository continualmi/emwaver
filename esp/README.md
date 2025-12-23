<div align="center">
  <img src="../docs/content/logo.png" alt="EMWaver Logo" width="250">
</div>

This folder contains the EMWaver ESP32-S3 firmware (ESP-IDF). For the broader product docs, visit https://luispl77.github.io/emwaver/.

# EMWaver ESP32-S3 Firmware

Target device: ESP32-S3 running on ESP-IDF v5.5.1.

## Project Structure

- `main/` - Main application code
- `CMakeLists.txt` - ESP-IDF project CMake configuration
- `sdkconfig` - ESP-IDF configuration file
- `sdkconfig.ci` - CI configuration file
- `dependencies.lock` - Component dependencies lock file
- `setup.sh` - ESP-IDF environment setup script (must be sourced)

## Linux (Ubuntu/Debian)

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

Clone EMWaver and build/flash from the same shell:

```bash
git clone https://github.com/luispl/emwaver.git ~/emwaver
cd ~/emwaver/esp
source setup.sh  # Must be sourced, not executed, to load ESP-IDF tools
python -m serial.tools.list_ports -v  # Note your board's port (e.g., /dev/ttyACM0)
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/ttyACM0 flash
idf.py -p /dev/ttyACM0 monitor  # Exit with Ctrl+]
```

Use `idf.py -p /dev/ttyACM0 flash monitor` to combine flashing and monitoring.

## macOS (Intel & Apple Silicon)

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

Then clone EMWaver and build/flash:

```bash
git clone https://github.com/luispl/emwaver.git ~/emwaver
cd ~/emwaver/esp
source setup.sh
python -m serial.tools.list_ports -v  # Note the board's port (e.g., /dev/cu.usbmodemXXXX)
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/cu.usbmodemXXXX flash
idf.py -p /dev/cu.usbmodemXXXX monitor  # Exit with Ctrl+]
```

`idf.py -p /dev/cu.usbmodemXXXX flash monitor` performs flash and monitor in one command.

## Windows (ESP-IDF Tools Installer)

1. Download the ESP-IDF Tools Installer (online or offline) from Espressif and launch it (see the v5.5.1 guide: https://docs.espressif.com/projects/esp-idf/en/v5.5.1/esp32c3/get-started/windows-setup.html).
2. During installation:
   - Keep the ESP-IDF and tools paths under 90 characters and free of spaces or non-ASCII characters.
   - Select **ESP-IDF v5.5.1** as the version to install.
   - Point the tools directory to `%USERPROFILE%\\esp\\tools` so it mirrors the Linux/macOS layout.
   - On the final page, tick **Run ESP-IDF PowerShell Environment**.
3. In the ESP-IDF PowerShell window that opens (or from Start Menu → ESP-IDF PowerShell Environment later), run:

```powershell
Set-Location $env:USERPROFILE
git clone https://github.com/luispl/emwaver.git
Set-Location emwaver\\esp
python -m serial.tools.list_ports -v  # Lists COM ports; note the ESP board's COM number
idf.py --version
idf.py set-target esp32s3
idf.py build
idf.py -p COM7 flash  # Replace with the COM port reported above
idf.py -p COM7 monitor  # Exit with Ctrl+]
```

Use `idf.py -p COM7 flash monitor` to combine flashing and serial monitoring. The installer caches downloads in `%USERPROFILE%\\.espressif`; remove `%USERPROFILE%\\esp\\tools\\dist` (or `$env:IDF_TOOLS_PATH\\dist`) if you need to reclaim disk space.

If you prefer a reusable alias, add `alias get_idf='source ~/emwaver/esp/setup.sh'` to your shell profile so new sessions pick up the toolchain quickly.

## Communication

- **Protocol**: Bluetooth Low Energy (BLE) via NimBLE
- **Service UUID**: `45c7158e-0c3b-4e90-a847-452a15b14191`
- **Command Characteristic**: `46c7158e-0c3b-4e90-a847-452a15b14191`
- **Notification Characteristic**: `47c7158e-0c3b-4e90-a847-452a15b14191`

## Features

- BLE server with GATT characteristics
- Command registry system
- SPI support
- Sampler functionality
- MFRC522 RFID library support

# License

This project is open source and available under the `../LICENSE` file.
