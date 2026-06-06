# ESP32 LAN OTA Plan

ESP32 LAN OTA is a future local-first update path for boards already provisioned onto a trusted LAN.

## Direction

- OTA should use same-LAN or user-owned routed reachability such as VPN, SSH tunnel, or Tailscale.
- Native apps may expose app-local OTA/update UI where platform constraints allow.
- OTA should fit the native-app runtime model and the desktop MCP direction where relevant.

## Current Non-Goals

- No public-internet update endpoint on the board.
- No cloud fleet management.
- No backend ownership checks for local board updates.
- No requirement that users build firmware manually.

## Validation Required Before Enabling

- Safe interruption behavior.
- Version/board compatibility checks.
- Recovery path through USB or serial flashing.
- Clear local-only UX for LAN/VPN operation.
