# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in EMWaver, please report it responsibly.

**Do not open a public GitHub issue.**

Instead, email **security@continualmi.com** with:

- A clear description of the vulnerability
- Steps to reproduce
- Affected components (app, firmware, transport, website)
- Any potential impact

We aim to acknowledge reports within 48 hours and provide an initial assessment
within 5 business days.

## Scope

The following components are in scope:

- Native apps (iOS, Android, macOS, Windows, Linux)
- Firmware (STM32, ESP32)
- Transport protocols (USB MIDI, BLE, Wi-Fi/WebSocket)
- The public website at [emwaver.ai](https://emwaver.ai)
- The shared Apple package (`apple/`)
- Rust crates under `crates/` and `linux/crates/`

The following are out of scope:

- Historical architectures archived outside the active native-app path
- Third-party services outside the EMWaver native app, firmware, and website codebase
- Social engineering attacks
- Denial of service against the public website

## Supported Versions

EMWaver is in an early open-source release. We support the latest preview
release assets under the `emwaver-preview` GitHub Release tag and the latest
`main` branch. Mobile app store distributions (App Store, Google Play) are
updated through their respective store review cycles.

## Local-First Security

EMWaver is a local-first platform. Local hardware control does not require
accounts, cloud activation, or hosted relay. Security reports about the
local-first boundary (e.g., ways the app could be coerced into requiring
network access for core hardware control) are particularly interesting to us.

Desktop MCP access is planned as a user-enabled loopback-only local endpoint.
Reports about local endpoint exposure, token handling, or unintended remote
hardware access are in scope.
