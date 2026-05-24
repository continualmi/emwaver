# ESP32 Wi-Fi Transport Plan

ESP32 Wi-Fi transport is a LAN/VPN-capable transport for supported ESP32-class boards.

## Product Shape

```text
native app -> local runtime -> ESP32 Wi-Fi endpoint
```

The transport is intended for same-LAN use and user-owned routed paths such as VPN, Tailscale, SSH tunnel, or explicit port forwarding. It is part of the same native-app runtime model as USB and BLE.

## Firmware Contract

- ESP32 stores Wi-Fi credentials only after setup over an already-local USB or BLE path.
- ESP32 advertises `_emwaver._tcp` through mDNS while online.
- The control WebSocket listens on port `3922` by default.
- Command frames use the same EMWaver command semantics as other transports.
- Only one active control client should own the board at a time; a second client should receive a busy response or connection refusal.

## Native App Contract

Native apps own Wi-Fi setup, discovery, manual IP entry, connection status, script execution, and recovery UX.

Required app behavior:

- discover boards through mDNS when available;
- allow manual host/IP + port entry;
- show clear reachable, busy, connection-failed, and disconnected states;
- route normal JavaScript scripts to the selected Wi-Fi device;
- recover through USB/BLE when Wi-Fi credentials or network state are broken;
- preserve per-device command/session isolation.

## Validation Gates

- `013_ESP32_WIFI_LAN_SCRIPT_EXECUTION`: same-LAN mDNS/IP execution, second-client busy handling, Wi-Fi drop recovery, and USB/BLE recovery.
- `014_ESP32_WIFI_REMOTE_BY_IP_EXECUTION`: user-owned routed/private-IP execution.

Record the board model, firmware build, provisioning transport, endpoint, app build, observed script behavior, busy handling, reconnect behavior, date, and tester before marking either gate passed.
