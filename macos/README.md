# macOS App (`/macos`)

Native macOS EMWaver application (Swift/SwiftUI + Xcode).

This is the desktop Apple host app for local USB/BLE/Wi-Fi workflows, desktop MCP migration work, and firmware/update UX on macOS.

The local-first rule is that connected supported boards can run local JavaScript scripts immediately through the native app. Hardware UIDs may be used for local labels/diagnostics, not product activation or ownership gates.

Important board-class split:
- STM32 boards currently use the DFU-oriented update path.
- ESP32 boards should use a separate serial flashing flow.
- The macOS app should not assume that all supported boards share one update-mode transport.

---

## 1) Project layout

- Xcode project: `macos/EMWaver/EMWaver.xcodeproj`
- App source root: `macos/EMWaver/EMWaver/`
- Tests:
  - `macos/EMWaver/EMWaverTests/`
  - `macos/EMWaver/EMWaverUITests/`
- Tools:
  - `macos/EMWaver/Tools/` (includes helper binaries/docs)

Entry points:
- `EMWaverApp.swift`
- `ContentView.swift`

---

## 2) Main code areas

## 2.1 MCP migration

The legacy Agent API-key manager, MGPT endpoint plumbing, and in-app Agent
entry UI have been removed from the macOS app. `KeychainStore.swift` remains as
local utility storage for app-owned credentials such as Wi-Fi setup details.

Migration rule:
- keep supported boards entering local script/update workflows without a manual claim button or hosted registration step,
- route external-agent access through the future local in-app MCP server instead of app-level Agent chat,
- local scripts, flashing, and device control must not depend on any key.

## 2.2 Device + transport + host management

Core files include:
- `MacUSBManager.swift`
- `MacWiFiManager.swift`
- `HostSessionManager.swift`

Responsibilities:
- local USB and BLE host operation,
- native local script/runtime integration,
- firmware update tooling for first-party setup on macOS without gating local script execution on account ownership.

Transport behavior:
- `MacUSBManager.swift` currently coordinates CoreMIDI USB, CoreBluetooth BLE, and the app-facing `ScriptDevice` routing surface.
- `MacWiFiManager.swift` owns the first ESP32 Wi-Fi transport slice: local mDNS discovery, manual LAN/VPN hosts, WebSocket connection, binary packet send/receive, and disconnect handling.
- USB MIDI remains the preferred wired path when present.
- The device sheet now exposes a unified local device list for discovered USB MIDI, ESP32-S3 BLE candidates, and discovered Wi-Fi devices, so multi-board bench work can start with explicit user selection.
- Wi-Fi devices use the same EMWaver SysEx/superframe payload as USB MIDI and BLE once connected. The Wi-Fi edge is a WebSocket transport adapter, not a separate hardware-control protocol.
- macOS sends and receives the existing 48-byte EMWaver SysEx payload directly over the WebSocket. There is no Wi-Fi-specific envelope or sequence layer.
- macOS only sends Wi-Fi command frames after WebSocket connection has completed and the selected Wi-Fi record is marked connected.
- If no matching Wi-Fi command response arrives before the caller timeout, macOS reports `Wi-Fi command timed out`.
- Wi-Fi retransmit buffers use firmware `BS` status frames for host-side pacing, and exact padded `BS` status frames are not appended to the script capture buffer; ordinary stream data that begins with the same bytes is preserved.
- Wi-Fi device metadata is target-aware for ESP32-S2, ESP32-S3, and generic ESP32 records; manual IP records use a generic ESP32 label until mDNS metadata supplies a specific board type.
- Wi-Fi mDNS discovery reads the firmware TXT records for board type and firmware version, so the local device list can show advertised ESP32 metadata instead of relying only on hardcoded defaults.
- Wi-Fi mDNS discovery also tracks the advertised `proto` and `cap` TXT records. Discovered devices without protocol version `1` or without the `wifi` capability are rejected before WebSocket connection, with capability matching kept case/whitespace tolerant for TXT-record compatibility.
- Wi-Fi device presence is confirmed by the hardware UID command over the WebSocket. mDNS/manual records are only addresses to try; the local device list only shows a Wi-Fi endpoint after a fresh valid 6-byte UID response, and UID liveness failure removes it.
- Wi-Fi mDNS discovery prunes devices that stop advertising from the visible local device list unless the endpoint is currently connected.
- The Wi-Fi UI supports manual host/IP plus port. Manual IP remains important for VPN paths where mDNS does not cross subnet boundaries.
- Manual Wi-Fi connection rejects ports outside the valid TCP range before opening the WebSocket.
- The Wi-Fi manual-connect UI also requires the port text to parse as a valid TCP port instead of silently falling back to `3922` for malformed input.
- Manual Wi-Fi connection also requires the host field to be a bare hostname or IP address, with scheme/path/embedded-port input rejected so the separate validated port remains authoritative.
- Manual Wi-Fi connection supports bare IPv6 literals for routed LAN/VPN paths and brackets them only when constructing the WebSocket URL.
- The local device selector is the preferred transport for the next script run only, and it only lists transports after a real hardware UID has been read. Discovery and UID checks continue across transports; automatic script-target selection ranks USB, then BLE, then Wi-Fi unless the user explicitly selects a transport.
- ESP32 script runs claim the selected USB/BLE/Wi-Fi transport before script control starts, keep that claim alive with a **transport session heartbeat** (opcode `0x0B` sub-opcode `0x03`, sent every 2 seconds, echoed by firmware), and release it when the script stops. Discovery and UID/status probes may continue on other transports, but control traffic stays locked to the selected transport during the script session. Because the protocol is a single serial bus, heartbeats interleave naturally with commands and responses without contention.
- If a script is already running for a hardware UID, macOS rejects another local script run or active transport switch for that same device until the running script stops.
- The ESP32 firmware owns the default local hostname and advertises it through mDNS.
- The device sheet can provision ESP32-S2 or ESP32-S3 Wi-Fi while the board is connected over USB MIDI, BLE, or Wi-Fi. It sends SSID and password over the shared binary command lane before the board joins station-mode Wi-Fi and advertises on the LAN.
- The same USB/BLE local setup surface can clear ESP32 Wi-Fi provisioning for recovery after a bad network setup.
- The setup surface can query the ESP32 binary Wi-Fi status opcode over USB MIDI, BLE, or Wi-Fi and reports provisioned, station online/offline, current station IP when firmware provides it, reconnecting, last station disconnect reason, connected socket state, and sampler/transmit runtime-active state for local diagnostics.
- Wi-Fi control uses LAN/VPN reachability as the trust boundary. If the Mac can reach the ESP32 WebSocket, it can control the board; use trusted LANs, VPNs, or SSH tunnels only.
- Wi-Fi records report `connecting` while WebSocket connection is pending, so the local device list distinguishes same-LAN discovery and completed connection without showing saved-but-offline endpoints as live devices.
- If the firmware reports the Wi-Fi command socket is already owned by another session, macOS surfaces a busy-session error instead of treating it as a generic disconnect.
- macOS runs a lightweight 5-second connection poll across the unified transport manager. The poll refreshes USB MIDI candidates, reconciles stale active USB/BLE/Wi-Fi state, prunes BLE devices that stop advertising, republishes the device list, keeps BLE discovery active when auto-connect is enabled, and retries the existing auto-connect path. Separately, a 2-second transport session heartbeat (opcode `0x0B`/`0x03`) runs on the active transport to detect silent disconnections that OS-level transport events miss.
- The device list only shows Wi-Fi devices that are actively advertised, manually entered in the current app session, or connected, so old `.local` endpoints do not look like plugged-in devices on launch.
- If auto-connect is enabled and no wired EMWaver runtime is connected, macOS tries advertised Wi-Fi endpoints, then scans for the ESP32-S3 EMWaver BLE GATT service.
- BLE scanning may continue while a device is connected so additional ESP32-S3 boards can be discovered for the multi-device bench path.
- The first multi-device implementation can keep multiple ESP32-S3 BLE peripherals connected and lets the user select the active board for the in-app runtime.
- The app queries `EMW_OP_HARDWARE_UID_GET` after USB/BLE connection, refreshes connected USB/BLE UID checks during the regular 5-second connection poll, and uses that local hardware UID to merge the same physical device across transports when known. Wi-Fi uses fresh UID probe responses every 5 seconds as its live connection metric, not a cached UID. This UID is only for local labels/diagnostics/device-list deduplication.
- BLE carries the same EMWaver SysEx/superframe payload as USB MIDI; opcodes and command behavior must stay shared in firmware and scripts.

Runtime boundary:
- The macOS app is self-contained and owns its native script UI, local transport managers, MCP bridge surface, and firmware/update flows.
- Do not add a separate local daemon or CLI control plane as the macOS runtime path. The desktop MCP server should live in the running app.

Local Debug builds create a derived-data-only ESP helper wrapper from `tools/emwaver-esp-helper/emwaver_esp_helper.py` when PyInstaller is unavailable. Release packaging should still use a frozen helper bundle.

Desktop app updates:
- macOS uses Sparkle 2 for the app-level `Check for Updates...` menu item.
- the Sparkle feed URL is `https://emwaver.ai/updates/macos/appcast.xml`;
- release builds need a real Sparkle EdDSA public key in `SPARKLE_PUBLIC_ED_KEY`, with release artifacts signed by the matching private key;
- the macOS release workflow signs the app/DMG with a Developer ID Application certificate, notarizes the DMG with App Store Connect API credentials, staples the ticket, then generates the Sparkle appcast from the notarized DMG;
- app updates are independent of EMWaver accounts, model/API keys, and local hardware access.

## 2.3 UI surfaces

Representative views:
- `SettingsView.swift`
- firmware/device connection sheets.
- app update menu entry through Sparkle (`MacAppUpdateController.swift`).
- app version/build display through `MacAppBuildInfo.swift`.

Script sessions:
- macOS owns local multi-session script runs through a native session manager.
- The toolbar exposes the selected local device before Run, including the active USB/BLE transport icon and a local identifier suffix.
- Running a script from the shared scripts UI creates or restores a local session from the normal script list instead of using a separate sessions pane.
- Running sessions appear inline beside their script names, and each row owns its stop control.
- Each local session owns its own `ScriptPreviewManager` and targets the selected local device id through the existing macOS transport bridge.

Desktop MCP direction on macOS:
- the macOS app should expose a local, user-enabled MCP server over loopback Streamable HTTP,
- MCP tools route into the existing script engine, console capture, script storage, and device transports,
- the planned tool surface includes `list_scripts`, `read_script`, `run_script`, `write_script`, `device_state`, `spi_transfer`, `gpio_read`, `gpio_write`, and `analog_read`,
- production model prompts, provider routing, and metering do not belong in the macOS app.

## 3) Firmware update, optional account setup, and tooling

Firmware update UI/logic:
- `FirmwareUpdateManager.swift`
- `FirmwareUpdateSheet.swift`

Tooling helper path:
- `macos/EMWaver/Tools/emwaver-dfu-helper`
- `macos/EMWaver/Tools/README.md`

The helper is bundled for update flows and should be version-synced with firmware/update expectations.

The macOS app bundles the canonical committed firmware images from `firmware/`. Keep those files updated from the current STM32 ELF with `stm/update_firmware_bins.sh` whenever STM firmware changes. For ESP changes, build each supported ESP-IDF target and copy its four output binaries into `firmware/` using the target prefix (`emwaver-esp32-*` for classic ESP32, `emwaver-esp32s2-*` for ESP32-S2, `emwaver-esp32s3-*` for ESP32-S3). The app build phase requires all supported ESP image sets.

Current macOS responsibility in this area:
- local script execution for connected supported boards without account/backend activation gates,
- first-party firmware setup/update flows for supported devices,
- desktop MCP bridge work for external agents,
- avoid requiring supported-board hardware UID reads in Run Mode before local use,
- bundled or operator-selected custom firmware images,
- operator-readable progress and diagnostic logging for update sessions.

### Board-specific update model

STM32 update flow:
- run-mode connection over USB,
- if firmware is missing optional metadata commands, keep local control/update guidance independent of account registration,
- enter DFU/update mode from the app,
- flash through the DFU helper.

ESP32 update flow:
- run-mode connection over USB remains separate from flashing,
- flashing is performed over the board's flash-capable USB serial port,
- the app should bundle a small helper based on `esptool` behavior,
- the app should use prebuilt firmware images rather than ESP-IDF project logic,
- manual bootloader entry is acceptable for the first shipping version on boards where automatic entry is unreliable,
- when an ESP32 board is connected, "Enter Update Mode" should present the BOOT/RESET sequence instead of sending the STM32 DFU opcode.

Explicit non-goal:
- do not bundle `idf.py` or the full ESP-IDF inside the macOS app.
- `idf.py` is a developer/build wrapper, not an end-user firmware update runtime.

What the macOS app should eventually do for ESP:
- detect available `/dev/cu.*` serial candidates,
- help the user identify the correct ESP flash port,
- present bootloader instructions when the board needs manual entry,
- invoke the bundled ESP flashing helper with bundled images and fixed offsets,
- return the user to Run Mode after flashing completes.

---

## 4) Shared code boundary

This app should consume shared reusable Apple logic from `/apple/EMWaverAppleCore`.

macOS folder should hold platform-specific host/UI integrations and desktop-specific behavior, not duplicated cross-platform script core logic.

---

## 5) Build/run

Open the macOS Xcode project and run the `EMWaver` scheme.

As with other app folders, avoid relying on this automation environment for native app compilation validation.

---

## 6) Contributor guardrails

1. Keep macOS-specific host UI and settings here; move shared logic to `/apple`.
2. Keep USB/BLE/Wi-Fi transport behavior aligned with the shared native-app contracts.
3. Ensure firmware update helper integration remains stable when changing update flow.
4. Document any new app-level env/config toggles in this README.

---

## 7) Documentation maintenance rule

If you touch host management, firmware update flow, or auth/entitlement UX architecture in macOS app, update this README in the same PR.
