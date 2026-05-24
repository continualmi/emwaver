# ESP32 Wi-Fi Transport Audit

## Current State

| Area | Status | Notes |
| --- | --- | --- |
| Firmware Wi-Fi endpoint | `implemented / hardware validation pending` | ESP32 exposes a local WebSocket endpoint and mDNS advertisement after Wi-Fi provisioning. |
| Native app Wi-Fi transport | `implemented on supported native surfaces / validating` | Native apps own setup, discovery/manual IP entry, connection state, script execution, and recovery UX. |
| Discovery and diagnostics | `implemented / hardware validation pending` | mDNS and manual host/IP flows should expose reachable, busy, disconnected, and failed states. |
| Remote-by-IP posture | `documented` | Wi-Fi can work over same-LAN or user-owned routed paths such as VPN, Tailscale, SSH tunnel, or port forwarding. |

## Remaining Gates

- Run `013_ESP32_WIFI_LAN_SCRIPT_EXECUTION` on real ESP32-S3 hardware.
- Run `014_ESP32_WIFI_REMOTE_BY_IP_EXECUTION` through a user-owned routed path.
- Record second-client busy behavior and transient network drop recovery.
- Record app build, board model, firmware build, endpoint, script behavior, date, and tester.
