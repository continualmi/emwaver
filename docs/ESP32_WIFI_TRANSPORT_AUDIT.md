# ESP32 Wi-Fi Transport Completion Audit

This audit maps `docs/ESP32_WIFI_TRANSPORT_PLAN.md` to concrete repository evidence. It is not a substitute for real hardware validation.

Status legend: `[x]` = implemented or documented with repository evidence, `[ ]` = not yet verified.

## Objective

Implement the ESP32 Wi-Fi transport on macOS and ESP32 firmware so an ESP32 board can run the same `.emw` hardware-control protocol over a trusted local LAN or user-owned VPN, without accounts, cloud relay, activation, hosted device registry, cloud script storage, or subscription checks.

## Prompt-to-Artifact Checklist

| Requirement | Evidence | Status |
| --- | --- | --- |
| ESP32 station-mode Wi-Fi transport exists behind a feature gate | `esp/main/Kconfig.projbuild`, `esp/main/libraries/wifi_transport.c`, `esp/README.md` | `[x]` |
| ESP32 stores SSID/password in NVS and owns the stable default hostname | `wifi_transport_provision`, `default_hostname`, `save_config`, `load_config` in `esp/main/libraries/wifi_transport.c` | `[x]` |
| USB/BLE local provisioning command lane exists | `handle_wifi_config_opcode` in `esp/main/libraries/init.c`; macOS setup UI in `DeviceConnectionSheet.swift` | `[x]` |
| Local clear path exists | `wifi_transport_clear_config`; macOS `Clear Setup` control | `[x]` |
| LAN-trust WebSocket server runs at `/v1/ws` on port `3922` | `WIFI_CONTROL_PORT`, `WIFI_WS_PATH`, `ws_handler` in `wifi_transport.c` | `[x]` |
| Firmware accepts command sessions immediately after WebSocket open and rejects concurrent clients as busy | `ws_handler`, `close_active_session` in `wifi_transport.c` | `[x]` |
| Wi-Fi WebSocket frames carry the same raw 48-byte EMWaver SysEx payload used by USB/BLE | `ws_handler`, `enqueue_sysex`, `send_superframe` in firmware; `MacWiFiManager.send`, `sendCommand`, and UID probing | `[x]` |
| Wi-Fi has no transport envelope or sequence layer in macOS/firmware/daemon | removed firmware wrapping helpers, macOS wrapping helpers, and daemon auth/wrapping helpers | `[x]` |
| Sampler/retransmit lanes can use Wi-Fi through the same SysEx superframe shape | `sampler.c`, `wifi_transport_send_stream_lane`, `wifi_transport_send_buffer_status`; macOS routes received SysEx into the same device session parser | `[x]` |
| mDNS advertises `_emwaver._tcp` after WebSocket handler readiness | `start_server`, `publish_mdns` in `wifi_transport.c` | `[x]` |
| mDNS TXT includes protocol, board, firmware, capability, and local id metadata | `publish_mdns` in `wifi_transport.c` | `[x]` |
| Manual IP/hostname fallback exists for LAN/VPN paths | macOS `MacWiFiManager.webSocketURL`; daemon `wifi_websocket_url`; gateway manual daemon start | `[x]` |
| macOS discovers, filters, and connects Wi-Fi devices | `MacWiFiManager.swift`, `MacUSBManager.swift`, `DeviceConnectionSheet.swift` | `[x]` |
| macOS connects discovered/manual Wi-Fi endpoints without additional local transport credentials | `MacWiFiManager.swift`, `macos/README.md` | `[x]` |
| macOS validates manual host and port input before connection | `MacWiFiManager.isValidManualHost`, `DeviceConnectionSheet.parsedWiFiPort`, `EMWaverTests.swift` | `[x]` |
| Daemon supports discovery, direct run, doctor, and gateway fallback over raw-SysEx Wi-Fi | `daemon/emwaver-device/src/wifi.rs`, `daemon/emwaver/src/main.rs` | `[x]` |
| Gateway can list UID-validated Wi-Fi endpoints and start daemon with manual Wi-Fi args | `gateway/src/server.ts`, gateway runtime panel code, `gateway/README.md` | `[x]` |
| OTA SoftAP does not leave station-mode runtime listener active | `esp/main/libraries/ota_wifi.c`, `wifi_transport_suspend_runtime`, `wifi_transport_resume_runtime` | `[x]` |
| User-owned LAN/VPN remote-access docs exist | `docs/ESP32_WIFI_REMOTE_ACCESS.md`; root `README.md` doc index | `[x]` |
| Manual hardware test gates exist | `docs/TESTS.md` codes `008_ESP32_WIFI_LAN_SCRIPT_EXECUTION` and `009_ESP32_WIFI_VPN_BY_IP_EXECUTION` | `[x]` |
| ESP32-S3 compile validation passes | `idf.py -B build-esp32s3-check esp-idf/main/libmain.a` was run after the latest firmware session cleanup changes | `[x]` |
| ESP32-S2 isolated compile validation passes | `idf.py -B /tmp/emwaver-s2-wifi-check -DSDKCONFIG=/tmp/emwaver-s2-wifi-sdkconfig set-target esp32s2 esp-idf/main/libmain.a` was run after the latest firmware session cleanup changes | `[x]` |
| macOS compile/test validation passes | `xcodebuild -quiet -project macos/EMWaver/EMWaver.xcodeproj -scheme EMWaver -destination 'platform=macOS' test -only-testing:EMWaverTests` was run after the raw-SysEx Wi-Fi simplification | `[x]` |
| Same-LAN script execution on real ESP32-S3 hardware passes | `docs/TESTS.md` code `008_ESP32_WIFI_LAN_SCRIPT_EXECUTION` | `[ ]` |
| VPN-by-IP script execution on real ESP32-S3 hardware passes | `docs/TESTS.md` code `009_ESP32_WIFI_VPN_BY_IP_EXECUTION` | `[ ]` |

## Completion Result

The implementation is code-complete for macOS/firmware/daemon/gateway raw-SysEx Wi-Fi parity. Remaining completion gates require real ESP32-S3 hardware validation for same-LAN script execution and VPN-by-IP execution.

Do not mark `docs/ESP32_WIFI_TRANSPORT_PLAN.md` complete until `008_ESP32_WIFI_LAN_SCRIPT_EXECUTION` and `009_ESP32_WIFI_VPN_BY_IP_EXECUTION` pass and are recorded in `docs/TESTS.md`.
