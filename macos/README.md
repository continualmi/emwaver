# macOS App (`/macos`)

Native macOS EMWaver application (Swift/SwiftUI + Xcode).

This is the desktop Apple host app for local USB workflows, localhost gateway control, Agent client UI, and firmware/update UX on macOS.

The local-first rule is that connected supported boards can run local `.emw` scripts immediately without account sign-in, backend activation, subscription checks, claimed-device cache membership, hardware-UID registration, device minting, or device limits.

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

## 2.1 Auth and account

`macos/EMWaver/EMWaver/Auth/`:
- local Agent API-key manager + model,
- keychain store,
- Agent API-key entry UI.

Auth UX rule:
- Agent API-key entry must remain available even when no EMWaver device is connected, so users can configure optional Agent replies independently of local hardware control.
- supported boards should enter local script/update workflows without a manual claim button or hosted registration step.
- native clients use a user-provided Agent API key and endpoint.
- the app stores the API key in Keychain and uses it as the bearer credential for the configured Agent endpoint.
- local scripts, flashing, and device control must not depend on this key.

## 2.2 Device + transport + host management

Core files include:
- `MacUSBManager.swift`
- `MacWiFiManager.swift`
- `HostSessionManager.swift`
- `RemoteControlHostService.swift`

Responsibilities:
- local USB and BLE host operation,
- localhost gateway app-role integration,
- firmware update tooling for first-party setup on macOS without gating local script execution on account ownership.

Transport behavior:
- `MacUSBManager.swift` currently coordinates CoreMIDI USB, CoreBluetooth BLE, and the app-facing `ScriptDevice` routing surface.
- `MacWiFiManager.swift` owns the first ESP32 Wi-Fi transport slice: local mDNS discovery, manual LAN/VPN host pairing records, WebSocket connection/auth bootstrap, binary packet send/receive, and disconnect handling.
- USB MIDI remains the preferred wired path when present.
- The device sheet now exposes a unified local device list for discovered USB MIDI, ESP32-S3 BLE candidates, and paired/discovered Wi-Fi devices, so multi-board bench work can start with explicit user selection.
- Wi-Fi devices use the same EMWaver SysEx/superframe payload as USB MIDI and BLE once connected. The Wi-Fi edge is a WebSocket transport adapter, not a separate hardware-control protocol.
- macOS opts into Wi-Fi binary envelope version `1` during WebSocket authentication. The envelope adds version, frame kind, sequence id, and payload length around the existing 48-byte SysEx payload while preserving the shared runtime command model; firmware echoes the request sequence id on command responses, and macOS matches synchronous command replies by that sequence.
- macOS only sends Wi-Fi command frames after WebSocket challenge/auth has completed and the selected Wi-Fi record is marked connected.
- macOS validates Wi-Fi envelope payload lengths before sending so oversized local payloads do not wrap the 16-bit envelope length field.
- If no matching Wi-Fi command response arrives before the caller timeout, macOS reports `Wi-Fi command timed out`.
- macOS reserves Wi-Fi envelope sequence `0` for uncorrelated stream/status frames; stream-only retransmit frames use sequence `0`, while command requests start at sequence `1` and skip `0` after wraparound.
- Wi-Fi retransmit buffers use firmware `BS` status frames for host-side pacing, and exact padded `BS` status frames are not appended to the script capture buffer; ordinary stream data that begins with the same bytes is preserved.
- Wi-Fi device metadata is target-aware for ESP32-S2, ESP32-S3, and generic ESP32 records; manual IP records use a generic ESP32 label until mDNS metadata supplies a specific board type.
- Wi-Fi mDNS discovery reads the firmware TXT records for board type and firmware version, so the local device list can show advertised ESP32 metadata instead of relying only on hardcoded defaults.
- Wi-Fi mDNS discovery also tracks the advertised `proto` and `cap` TXT records. Discovered devices without protocol version `1` or without the `wifi` capability are rejected before WebSocket connection/auth, with capability matching kept case/whitespace tolerant for TXT-record compatibility.
- Wi-Fi mDNS discovery prunes unpaired devices that stop advertising while keeping paired/manual records as local fallback entries.
- The initial Wi-Fi UI supports manual host/IP plus port and a local pairing secret. Manual IP remains important for VPN paths where mDNS does not cross subnet boundaries.
- Manual Wi-Fi connection rejects ports outside the valid TCP range before storing a pairing record or opening the WebSocket.
- Manual Wi-Fi connection also requires the host field to be a bare hostname or IP address, with scheme/path/embedded-port input rejected so the separate validated port remains authoritative.
- Manual Wi-Fi connection supports bare IPv6 literals for routed LAN/VPN paths and brackets them only when constructing the WebSocket URL.
- The device sheet seeds a local hostname for Wi-Fi provisioning so the app can immediately store the matching `<hostname>.local` pairing record after setup, while still allowing manual override.
- Manual Wi-Fi hostnames are validated before provisioning and before local pairing persistence, so macOS does not store a local pairing record for a malformed hostname, IP address, or mDNS name.
- The device sheet seeds a local random pairing secret for Wi-Fi setup so users can provision a Wi-Fi-capable ESP32 board without inventing their own secret, while still allowing manual override.
- The device sheet can provision ESP32-S2 or ESP32-S3 Wi-Fi while the board is connected over USB MIDI or BLE where available. It sends SSID, password, hostname, and local pairing secret over the shared binary command lane before the board joins station-mode Wi-Fi and advertises on the LAN.
- The same USB/BLE local setup surface can clear ESP32 Wi-Fi provisioning for recovery after a bad network setup; when a hostname is provided it also removes that local macOS pairing record.
- The USB/BLE local setup surface can also reset only the ESP32 Wi-Fi pairing secret while keeping the existing SSID/password/hostname on the board, updating the matching local macOS pairing record when a hostname or manual host/IP is provided.
- The setup surface can query the ESP32 binary Wi-Fi status opcode over USB/BLE and reports provisioned, station online/offline, current station IP when firmware provides it, reconnecting, last station disconnect reason, authenticated state, and sampler/transmit runtime-active state for local diagnostics.
- During Wi-Fi provisioning, macOS always sends an effective local hostname: the device sheet pre-fills one, and the manager generates an `emwaver-...` fallback if a lower-level caller leaves it blank. The app stores the matching `<hostname>.local` paired-device record immediately so the advertised endpoint can be selected without re-entering the pairing secret.
- Wi-Fi connection authentication waits for the ESP32 firmware challenge, proves the locally stored pairing secret with HMAC-SHA256, and marks the device connected only after the firmware returns `auth ok`.
- Wi-Fi WebSocket sessions that open but do not complete challenge/auth within the local or firmware timeout are disconnected with a specific authentication-timeout error.
- Wi-Fi records report `connecting` while WebSocket challenge/auth is pending, and paired Wi-Fi fallback records that are no longer advertising report `disconnected`, so the local device list distinguishes authentication bootstrap, same-LAN discovery, completed connection, and saved-but-offline endpoints.
- Manual Wi-Fi pairing records are rolled back if authentication fails, times out, or disconnects before `auth ok`, so a bad temporary secret does not replace the last good local pairing.
- Successful Wi-Fi authentication refreshes the local paired-device `lastSeen` timestamp so manual fallback records do not stay stale after real LAN/VPN use.
- If the firmware reports the Wi-Fi command socket is already owned by another session, macOS surfaces a busy-session error instead of treating it as a generic disconnect.
- Wi-Fi pairing records are stored in local macOS app preferences. They are not account-backed, cloud-synced, or used for hardware ownership/activation.
- If auto-connect is enabled and no wired EMWaver runtime is connected, macOS first tries the most recently seen paired Wi-Fi endpoint from local pairing records, then scans for the ESP32-S3 EMWaver BLE GATT service.
- BLE scanning may continue while a device is connected so additional ESP32-S3 boards can be discovered for the multi-device bench path.
- The first multi-device implementation can keep multiple ESP32-S3 BLE peripherals connected and lets the user select the active board for the in-app runtime.
- Gateway-controlled runs can now include a `deviceId`; the macOS app creates a separate remote script runtime per `script.run` request and routes `Device.sendPacket` / `Device.sendCommand` through a targeted device bridge. This enables the initial automation-bench shape of one connected device = one remote script session. Shared capture buffers and mixed USB/BLE concurrent ownership still need hardening before treating every script API as fully isolated.
- The app queries `EMW_OP_HARDWARE_UID_GET` after connection and uses that local hardware UID to merge the same physical device across transports when known. This UID is only for local labels/diagnostics/device-list deduplication; it must not be used for account activation, ownership, device limits, or subscription checks.
- BLE carries the same EMWaver SysEx/superframe payload as USB MIDI; opcodes and command behavior must stay shared in firmware and scripts.

Local-first gateway behavior:
- `RemoteControlHostService` can connect directly to the localhost gateway as `role=app`.
- Default local gateway URL is `ws://127.0.0.1:3921/v1/ws`.
- Override with `EMWAVER_LOCAL_GATEWAY_URL`.
- Disable local gateway connection with `EMWAVER_LOCAL_GATEWAY_DISABLED=1`.
- Local gateway app-role control is opt-in from Settings by default; set `EMWAVER_LOCAL_GATEWAY_AUTO_CONNECT=1` for development sessions that should connect automatically.
- When enabled and the gateway is not running, reconnect attempts use capped exponential backoff to avoid noisy fixed polling.
- In local gateway mode, the macOS app owns `.emw` execution and USB/device transport; the gateway only forwards browser/CLI control messages.

Local Debug builds create a derived-data-only ESP helper wrapper from `tools/emwaver-esp-helper/emwaver_esp_helper.py` when PyInstaller is unavailable. Release packaging should still use a frozen helper bundle.

## 2.3 UI surfaces

Representative views:
- `SettingsView.swift`
- firmware/device connection sheets.

Script sessions:
- macOS owns local multi-session script runs through a native session manager.
- The toolbar exposes the selected local device before Run, including the active USB/BLE transport icon and a local identifier suffix.
- Running a script from the shared scripts UI creates or restores a local session from the normal script list instead of using a separate sessions pane.
- Running sessions appear inline beside their script names, and each row owns its stop control.
- Each local session owns its own `ScriptPreviewManager` and targets the selected local device id through the existing macOS transport bridge.

Agent configuration on macOS:
- local development loads repo-root `.env` into process environment at app startup,
- the macOS Agent interface/runtime calls the MGPT responses endpoint configured by `EMWAVER_AGENT_ENDPOINT` or `CONTINUAL_AGENT_ENDPOINT`,
- the shared Apple Agent client creates a persistent MGPT universe from stored prompt `emwaver-prompt` and then sends `universe` + `userInput`,
- provider selection, private prompts, tool policy, and metering belong server-side on MGPT,
- the macOS client should use a user-provided Agent API key stored locally/keychain-backed, and local scripts/hardware must work without it.

## 3) Firmware update, optional account setup, and tooling

Firmware update UI/logic:
- `FirmwareUpdateManager.swift`
- `FirmwareUpdateSheet.swift`

Tooling helper path:
- `macos/EMWaver/Tools/emwaver-dfu-helper`
- `macos/EMWaver/Tools/README.md`

The helper is bundled for update flows and should be version-synced with firmware/update expectations.

The macOS app bundles the canonical committed firmware image at `firmware/emwaver.bin`. Keep that file updated from the current STM32 ELF with `stm/update_firmware_bins.sh` whenever STM firmware changes. Firmware source changes must be built before completion so the relevant `.bin` artifacts are ready for the macOS app flashing flow; for ESP32 changes, run the ESP-IDF build so `esp/build/emwaveresp.bin` and companion bootloader/partition/OTA images are current.

Current macOS responsibility in this area:
- local script execution for connected supported boards without account/backend activation gates,
- first-party firmware setup/update flows for supported devices,
- local Agent key entry for optional Agent replies,
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

As with other app folders, avoid relying on Linux agent environment for native app compilation validation.

---

## 6) Contributor guardrails

1. Keep macOS-specific host UI and settings here; move shared logic to `/apple`.
2. Keep remote-control protocol compatibility aligned with the localhost gateway and other local clients.
3. Ensure firmware update helper integration remains stable when changing update flow.
4. Document any new app-level env/config toggles in this README.

---

## 7) Documentation maintenance rule

If you touch host management, firmware update flow, or auth/entitlement UX architecture in macOS app, update this README in the same PR.
