# ESP32 Wi-Fi Transport Audit

## Current State

| Area | Status | Notes |
| --- | --- | --- |
| Firmware Wi-Fi endpoint | `implemented / hardware validation pending` | ESP32 exposes a local WebSocket endpoint and mDNS advertisement after Wi-Fi provisioning. |
| Gateway Wi-Fi transport | `implemented / hardware validation pending` | Gateway can start with `--wifi <host-or-ip>` and `--wifi-port <port>`. |
| Discovery and diagnostics | `implemented / hardware validation pending` | `emwaver devices`, `emwaver devices --wifi <host>`, and `emwaver doctor --wifi <host>` support Wi-Fi endpoint discovery/probing. |
| Native app Wi-Fi setup | `implemented on supported native surfaces` | Native apps may keep app-local setup and execution. They are not Gateway backends. |
| Remote posture | `documented` | Remote use is user-owned LAN/VPN/SSH/Tailscale/private routing only. |

## Remaining Gates

- Run `008_ESP32_WIFI_LAN_SCRIPT_EXECUTION` on real ESP32-S3 hardware.
- Run `009_ESP32_WIFI_VPN_BY_IP_EXECUTION` through a user-owned routed path.
- Record second-client busy behavior and transient network drop recovery.
