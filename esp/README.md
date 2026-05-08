<div align="center">
  <img src="../docs/content/logo.png" alt="EMWaver Logo" width="250">
</div>

This folder contains the EMWaver ESP32-S3 firmware workspace (ESP-IDF).

# EMWaver ESP32-S3 Firmware

Target device: ESP32-S3 running on ESP-IDF v5.5.1.

This workspace was restored from git history as the starting point for bringing ESP32 support back to EMWaver.

Product direction for this folder:
- ESP32 is a managed EMWaver board class, not a user-built firmware workflow.
- End users should not be asked to install ESP-IDF, build firmware, or flash devices manually.
- The platform direction is multi-transport: BLE for direct proximity workflows, Wi-Fi for remote/autonomous control, and USB where appropriate on ESP32-S3 hardware.
- Apps remain responsible for firmware distribution, setup, and update UX.

## Project Structure

- `main/` - Main application code
- `CMakeLists.txt` - ESP-IDF project CMake configuration
- `sdkconfig` - ESP-IDF configuration file
- `sdkconfig.ci` - CI configuration file
- `dependencies.lock` - Component dependencies lock file
- `setup.sh` - ESP-IDF environment setup script (must be sourced)

## Internal developer setup

The steps below are for internal firmware development only. They are not end-user instructions and must not leak into product UX or customer-facing docs.

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

## Transport direction

Current restored codebase includes historical support for:
- Bluetooth Low Energy (BLE) via NimBLE
- Wi-Fi OTA support
- USB support components

Current reintegration status:
- USB is the active wired transport for the restored ESP32-S3 target.
- Firmware now enumerates as USB MIDI and accepts STM32-style EMWaver SysEx framing.
- BLE is active as the wireless direct-local transport. It advertises the EMWaver GATT service and accepts the same 36-byte EMWaver superframe encoded inside the same SysEx payload used by USB MIDI.
- Binary opcode support now covers the core shared bring-up surface over USB and BLE: version/reset/help, hardware UID, board info, device name, GPIO, ADC pin reads, SPI xfer, sample start/stop, PWM freq/write/stop, and transmit start/stop.
- USB sampling and retransmit now follow the STM32 runtime contract: 18-byte EMW stream lanes, command-lane piggyback during active streaming, `BS` flow-control status packets during retransmit, USB circular RX buffering for transmit data, and opcode-configurable sample/transmit tick timing.
- Wi-Fi transport foundation is active behind `EMWAVER_ENABLE_WIFI_TRANSPORT`: provisioned ESP32-S3 boards join station-mode Wi-Fi from NVS, advertise `_emwaver._tcp` on port `3922` with board/version/capability/local-id TXT records, and expose an authenticated WebSocket at `/v1/ws` carrying the same EMWaver SysEx/superframe bytes as USB MIDI and BLE.
- Station-mode Wi-Fi reconnect uses capped exponential backoff so bad credentials or poor signal do not create a tight reconnect loop.
- On station disconnect, the firmware clears active Wi-Fi auth/session state and stops the WebSocket/mDNS service until a new IP address is acquired.
- Reprovisioning Wi-Fi while station mode is already running clears the active WebSocket/mDNS listener state and reconnects with the new credentials instead of relying on a cold-start station event.
- Initial Wi-Fi provisioning is available through the shared binary command lane (`EMW_OP_WIFI_CONFIG`) so USB MIDI and BLE can chunk SSID/password/hostname/local pairing secret into NVS. The same binary status command reports provisioned, authenticated, and station online/offline state; the older text command path also accepts `wifi provision --ssid=<ssid> --password=<password> --secret=<local-secret> [--hostname=<emwaver-name>]`, plus `wifi status` and `wifi clear` for diagnostics/recovery.
- Wi-Fi provisioning rejects overlong SSID, password, hostname, and pairing-secret values instead of truncating them before NVS storage.
- Provisioned Wi-Fi hostnames must fit the ESP32-S3 mDNS hostname contract: up to 32 letters, numbers, or hyphens, without a leading or trailing hyphen. Invalid stored hostnames fall back to the generated `emwaver-xxxx` name on load.
- Clearing Wi-Fi setup over the binary command lane or text command erases the NVS Wi-Fi namespace, stops the WebSocket/mDNS service, clears authenticated socket state, and stops station mode so recovery does not leave a stale command listener running.
- Wi-Fi WebSocket authentication now verifies an HMAC-SHA256 response over a firmware-issued challenge using the locally provisioned pairing secret. The raw pairing secret is not sent over the Wi-Fi socket, and command frames are rejected until authentication succeeds.
- The auth message must identify itself as `type=auth` with `protocolVersion=1`, and firmware checks the HMAC response with a constant-time comparison before accepting a Wi-Fi command session.
- A Wi-Fi WebSocket client must complete challenge/auth within the firmware auth timeout; otherwise firmware sends `auth timeout` and closes the pending unauthenticated socket so it cannot reserve the active session slot indefinitely.
- A rejected Wi-Fi auth response immediately clears the active socket owner and challenge state before the server drops the WebSocket request.
- The Wi-Fi WebSocket server keeps a single active socket from challenge through authenticated control and rejects another concurrent client as busy instead of letting a second app silently replace the active command owner. When the active WebSocket closes, firmware clears the owner state so the next local client can connect.
- The previous HID/BadUSB experiment is preserved in `main/libraries/usb_hid_legacy.c` but is not part of the active build.
- macOS now auto-connects to ESP32-S3 over USB MIDI first when present, then scans for the EMWaver BLE service and uses BLE for local scripts when no wired runtime is connected.
- `EMW_OP_ENTER_DFU` is intentionally still unsupported on ESP bring-up; update mode is treated as a separate ESP-native flashing path rather than as STM32 DFU parity.

Planned EMWaver direction for ESP32:
- BLE remains available for direct nearby workflows.
- Wi-Fi is the path for remote autonomous control without a host.
- USB remains available where the ESP32-S3 hardware/runtime benefits from it.
- Managed EMWaver provisioning, runtime, and update flows take precedence over raw transport-specific tooling.

## Recommended transport architecture

EMWaver should keep **all three transports** in scope for ESP32-S3, but the firmware and apps should still speak **one EMWaver device protocol**.

Recommended rule:
- Keep **USB first** for wired ESP32-S3 sessions because it is deterministic and easy to recover.
- Mirror the existing STM32 EMWaver request/response behavior on ESP32, including superframe command/response semantics.
- Reuse the same **SysEx packet protocol across USB and BLE**, with transport-specific GATT/MIDI framing only at the edge.
- Treat OTA/update paths as a separate concern from the steady-state control/runtime protocol.

This keeps app complexity under control:
- USB and BLE share one codec and runtime behavior,
- Wi-Fi carries the same packet model for the first station-mode runtime slice.

This also avoids the current restored-state problem where:
- BLE is closest to an EMWaver command transport,
- OTA SoftAP remains separate from the station-mode Wi-Fi runtime socket,
- USB is currently HID/BadUSB-oriented rather than an EMWaver device runtime transport.

### Why all transports still make sense

- **BLE** is the best proximity transport for phone-first setup, quick control, and cable-free local sessions.
- **USB** is the most deterministic local transport for development, recovery, high-reliability sessions, and desktop workflows.
- **Wi-Fi** is the transport that enables autonomous remote control without requiring a Raspberry Pi or another always-on host.

This matches the software-first platform direction:
- users can bring a common ESP32-S3 board,
- apps stay responsible for setup/update UX,
- the platform can choose the best transport for the situation instead of forcing one hardware topology.

### Important product distinction

Do **not** introduce a second app-level protocol for ESP32 just because the transport changes.

Instead, split ESP32 into two product modes:

1. **Direct local mode**
   - device is controlled directly by an app over BLE or USB,
   - best for onboarding, setup, nearby control, recovery, and low-friction exploration.

2. **Autonomous network mode**
   - device owns a user-configured network session over Wi-Fi,
   - no Raspberry Pi or desktop host required,
   - apps treat this as a device-direct session, not as a fake host session.

BLE and USB mainly serve the first mode. Wi-Fi mainly serves the second.

The protocol contract should remain the same in both:
- same packet structure,
- same command/response semantics,
- same higher-level app/device behavior,
- different transport bindings only when necessary.

### Recommended firmware layering

Target layering for reintegration:

1. **Core runtime**
   - board metadata (`board_type` and runtime capabilities)
   - local setup state that does not gate hardware access on account ownership
   - script/runtime execution boundary
   - capability registry
   - local session state

2. **EMWaver protocol layer**
   - STM32-compatible SysEx packet contract
   - same request/response semantics across supported boards
   - binary-safe payload support
   - shared message types for local and remote control

3. **Transport adapters**
   - USB transport with STM32-parity behavior first
   - BLE transport that carries the same SysEx packets with chunking/reassembly as needed
   - Wi-Fi local adapter (network setup / local network if needed)
   - Wi-Fi network adapter carrying the same packet model

4. **Update/provisioning services**
   - BLE-assisted onboarding
   - Wi-Fi credential/setup flow
   - signed firmware update flow
   - recovery/fallback transport behavior

The key constraint is that transports should not own the business logic or define separate app-visible protocols.

## ESP update mode direction

ESP32-S3 firmware update should not try to imitate STM32 DFU too closely.

Recommended rule:
- keep **Run Mode** on ESP as USB MIDI SysEx using the shared EMWaver device protocol,
- keep **Update Mode** on ESP as a separate ESP-native serial flashing path,
- do not make the app depend on `idf.py`,
- do not require the runtime USB MIDI transport to become the flashing transport.

Near-term update strategy:
- the user connects the ESP board using its flash-capable USB serial path,
- the macOS app invokes a bundled flashing helper based on `esptool`,
- the helper writes prebuilt firmware artifacts at known offsets,
- the device reboots back into Run Mode after flashing.

Important product constraint:
- on ESP, `EMW_OP_ENTER_DFU` should be treated as a generic future "enter update mode" concept, not as a requirement for the first macOS flashing flow.
- for the first working product version, manual bootloader entry on some dev boards is acceptable.
- the app should guide the user through bootloader mode instead of pretending all ESP boards support seamless automatic reboot into flashing.

This gives EMWaver a realistic first update path:
- STM32 can keep its DFU-oriented flow,
- ESP32-S3 can use serial flashing with prebuilt binaries,
- both board classes still fit the same managed-firmware product model.

### macOS flashing notes

Current observed behavior on restored ESP32-S3 dev boards:
- macOS can see the flash-capable port as `/dev/cu.usbmodem*`,
- ROM bootloader access may work even when esptool stub upload is unreliable,
- some boards may need manual bootloader entry for reliable flashing.

That means the macOS app should be designed around:
- serial port discovery,
- clear user guidance for entering boot mode,
- conservative serial flashing settings where needed,
- explicit logging when the board fails during stub upload or flash writes.

The app should bundle:
- bootloader image,
- partition table,
- OTA data image if required,
- application image,
- a small ESP flashing helper based on `esptool` behavior.

The app should not bundle:
- the full ESP-IDF,
- `idf.py`,
- developer-only environment assumptions.

### Session model recommendation

Backend/web docs already note that host-backed remote control and future ESP32 direct-to-cloud control are separate paths.

Recommended session model:
- keep current `web <-> host` remote session model for daemon/native-app host-backed boards,
- add a new **device session role** for autonomous ESP32 boards,
- let web/apps attach to either a host session or a device session depending on board class.

That keeps the platform coherent:
- STM32/USB host-backed boards continue to use host ownership where that model fits,
- ESP32-S3 can support both direct local control and direct remote control,
- remote support no longer depends on pretending every board is a host-owned device.

### Transport priority recommendation

Recommended practical priority for reintegration:

1. **USB**
   - bring back as the first reintegrated transport,
   - mirror STM32 behavior as closely as possible,
   - use it as the baseline implementation for the shared protocol on ESP32-S3.

2. **BLE**
   - restore as the main mobile-friendly nearby transport,
   - use it for onboarding, provisioning bootstrap, and direct local control,
   - keep it protocol-compatible with USB rather than inventing BLE-only commands.

3. **Wi-Fi**
   - evolve from OTA-only support into:
     - provisioning/bootstrap,
     - direct device/backend session,
     - remote controller attachment,
     - OTA/update delivery,
     - same EMWaver packet semantics over a Wi-Fi transport binding.

This order gives a stable bring-up path while still aiming at the no-Raspberry-Pi remote-control outcome.

### Guardrails

- Do not require end users to compile firmware, manage ESP-IDF, or flash manually.
- Do not introduce a separate BLE protocol or Wi-Fi protocol at the app layer.
- Do keep STM32-compatible SysEx semantics as the shared device protocol unless there is a very strong platform reason to change it repo-wide.
- Do not couple remote Wi-Fi support to legacy host-session assumptions.
- Do not treat OTA transport code as the final runtime control architecture.
- Do preserve a fallback local transport so recovery is possible when Wi-Fi provisioning fails.

### Near-term implementation direction

The restored code should be treated as a capability source, not as the final architecture.

Near-term steps:
- implement USB first with STM32-compatible EMWaver protocol behavior on ESP32-S3,
- replace or complement current USB HID logic with an EMWaver runtime/control path appropriate for ESP32-S3,
- convert BLE from ASCII-command-only plumbing into the same SysEx packet protocol,
- extend web/backend WS/session design with authenticated device-direct sessions,
- define provisioning flows that let BLE/USB bootstrap Wi-Fi credentials and cloud attach cleanly.

## Features

- BLE server with GATT characteristics
- Command registry system
- SPI support
- Sampler functionality
- MFRC522 RFID library support

## Current status

This folder is a restored baseline, not yet a fully reintegrated supported target. Expect follow-up work in:
- firmware modernization and cleanup,
- direct backend/device session design,
- app-managed provisioning/update flows,
- capability alignment with the current `.emw` runtime model.
