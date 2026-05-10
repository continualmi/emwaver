# ESP32 LAN OTA Plan

ESP32 LAN OTA is a future local-first update path for boards already provisioned onto a trusted LAN.

## Direction

- OTA should use user-owned LAN/VPN/SSH/Tailscale reachability.
- OTA must not require EMWaver accounts, hosted device registration, subscription checks, or hosted relay.
- Native apps may expose app-local OTA/update UI where platform constraints allow.
- Gateway may later expose a local terminal/browser OTA helper, but the current Gateway consolidation focuses on script execution transports.

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
