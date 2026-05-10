# ESP32 Wi-Fi Transport Plan

ESP32 Wi-Fi transport is a local-first LAN/VPN transport for supported ESP32 class boards.

## Product Shape

```text
CLI/browser -> Gateway -> ESP32 Wi-Fi endpoint
native app -> native runtime -> ESP32 Wi-Fi endpoint
```

The transport is intended for same-LAN, VPN, Tailscale, SSH-tunnel, or explicit user-owned port-forwarded paths. EMWaver does not provide a hosted relay, cloud registry, account gate, subscription check, or device ownership service for this path.

## Firmware Contract

- ESP32 stores Wi-Fi credentials only after setup over an already-local USB or BLE path.
- ESP32 advertises `_emwaver._tcp` through mDNS while online.
- The control WebSocket listens on port `3922` by default.
- Command frames use the same EMWaver raw SysEx command lane semantics as other transports.
- Only one active control client should own the board at a time; a second client should receive a busy response or connection refusal.

## Gateway Contract

Gateway owns terminal/browser Wi-Fi execution:

```bash
emwaver gateway serve --wifi 192.168.1.44 --wifi-port 3922
emwaver run assets/default-scripts/blink.emw
```

Useful commands:

```bash
emwaver devices
emwaver devices --wifi 192.168.1.44
emwaver doctor --wifi 192.168.1.44
```

`emwaver run` requires a running Gateway. It does not accept transport flags.

## Native App Contract

Native apps may keep Wi-Fi setup, discovery, manual IP entry, and app-local runtime execution. They are self-contained native surfaces and do not attach to Gateway as runtime owners.

## Validation Gates

- `008_ESP32_WIFI_LAN_SCRIPT_EXECUTION`: same-LAN mDNS/IP execution, second-client busy handling, Wi-Fi drop recovery, and USB/BLE recovery.
- `009_ESP32_WIFI_VPN_BY_IP_EXECUTION`: user-owned VPN/private-IP execution without hosted relay or account paths.

Record the board model, firmware build, provisioning transport, endpoint, exact commands, observed script behavior, busy handling, reconnect behavior, date, and tester before marking either gate passed.
