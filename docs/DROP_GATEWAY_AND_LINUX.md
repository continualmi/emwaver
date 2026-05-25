# Gateway Removal (Historical)

> Historical decision record (May 2026): why the Gateway/CLI/browser architecture was removed. The current native Linux app under `linux/` is unrelated — this document covers only the old Gateway-era Linux path.

## Decision

The `gateway/` directory, all CLI release packaging, and the old Linux support path were removed from EMWaver.

Supported platforms immediately after that removal were **iOS, Android, macOS, and Windows**. Linux is now being rebuilt as a native app.

---

## What the Gateway Was

The gateway was a layered architecture designed to let a web browser control EMWaver hardware through a local CLI process:

```
Browser (localhost:3921)
    ↕  HTTP / WebSocket
Node.js server (gateway/frontend — served the SPA)
    ↕  WebSocket relay
Rust daemon (gateway/backend — owned BLE/USB transport)
    ↕  BLE / USB MIDI SysEx
Board
```

The Rust backend (`gateway/backend/emwaver/src/main.rs`, ~5200 lines) handled device scanning, BLE transport, USB MIDI SysEx, script execution, and a WebSocket host protocol. The Node.js/React frontend (`gateway/frontend/`, ~1500 lines) served the browser SPA and relayed events between the browser client and the Rust daemon. The CLI binary (`emwaver`) orchestrated both layers, managing process lifecycle, port assignment, daemon autostart, and restart-on-binary-change logic.

The result was three moving parts that all had to agree on protocol state simultaneously — any restart, timing issue, or transport hiccup in any layer could break the session for the browser without a clear recovery path.

---

## Why It Didn't Work

### The transport chain was fundamentally unstable

Every user interaction crossed at least four hops: browser → Node.js gateway → Rust daemon → hardware. The WebSocket relay between the Node.js server and the Rust daemon was the persistent failure point. On macOS, the native app talks directly to the hardware with no relay; that path is stable. On the gateway path, reconnection logic had to be threaded through all three layers. When it failed it failed silently from the browser's perspective.

Work invested in improving this reliability:
- Gateway restart commands and auto-restart on binary change (`53fe77757`, `1fa755672`)
- Duplicate gateway process prevention
- Stale BLE device handling, scan recovery on macOS
- Session isolation and transport boundary auditing

None of these fundamentally fixed the problem because the problem was architectural: a relay-based transport between independent OS processes over local sockets is much harder to keep coherent than a single in-process native stack.

### The gateway required a GUI anyway — just a browser one

The stated purpose of the gateway was to give Linux users a graphical interface via the browser. But EMWaver as a product genuinely requires a GUI. Managing devices, viewing signal captures, building control panels, running scripts — none of this is practical in a terminal. The gateway existed to paper over the absence of a native Linux app, not to provide a real alternative to one.

A browser-based UI backed by a two-process local relay is not a practical GUI for hardware interaction. Latency across the relay is perceptible. State desync between the browser and the daemon creates subtle bugs. Error surfaces multiply. The result was a worse experience than just saying Linux is not a supported platform.

### Linux usage was negligible

Linux users account for a very small fraction of real EMWaver usage. The platforms where EMWaver actually runs are phones (Android, iOS) and desktop apps (macOS, Windows). Maintaining a separate Linux path — with its own CI workflows (`gateway-ci.yml`, `gateway-backend-ci.yml`, `cli-gateway-release.yml`), its own packaging pipeline, its own DBus build deps, its own systemd service installer — for near-zero users was not a justified cost.

### The CLI's remaining use case was absorbed into the native apps

The only compelling argument for keeping the CLI was AI agent integration: Codex, Claude Code, and similar tools could use it to script hardware interactions without a GUI. That integration is now being built directly into the native apps. The CLI is no longer the only path to agent-driven hardware control.

---

## What Was Removed

### `/gateway`

The entire gateway directory: Rust backend (device transport, script execution, WebSocket host protocol), Node.js/React frontend (SPA, browser client, remote session management), build scripts, verification scripts, documentation, and migration notes.

### CI workflows

- `.github/workflows/gateway-ci.yml`
- `.github/workflows/gateway-backend-ci.yml`
- `.github/workflows/cli-gateway-release.yml`

### Scripts

- `scripts/verify-gateway-render.mjs`
- `scripts/rebirth-gateway-sim-validation.sh`

### Parity contract

- `docs/parity/features/gateway.json`

### Web — Linux and CLI references

All mentions of Linux, the CLI, the localhost gateway, the daemon, and related install instructions were removed from:

- `web/app/emwaver/page.tsx`
- `web/app/emwaver/install/page.tsx`
- `web/app/emwaver/docs/page.tsx`
- `web/app/emwaver/docs/install/page.tsx`

The install page now shows: macOS DMG, Windows installer, Windows ZIP, Android APK — plus the App Store and Google Play coming-soon sections for iOS and Android.

### Platform logos

The `ubuntu.svg` logo was removed from `web/public/emwaver/logos/`. Remaining: `apple.svg`, `windows.svg`, and the Android/iOS badge assets.

---

## What Was Not Removed

The Rust crates in `crates/` (`emwaver-dfu`, `emwaver-dfu-helper`) are unrelated to the gateway and remain. The firmware, hardware, and simulator directories are unaffected. The native macOS, Windows, iOS, and Android apps are unaffected.

---

## Supported Platforms Immediately After This Historical Change

| Platform | Method        | Status at the time          |
|----------|---------------|-----------------------------|
| macOS    | Native app    | Active                      |
| Windows  | Native app    | Active                      |
| Android  | Native app    | Active (APK preview)        |
| iOS      | Native app    | Active (TestFlight / store) |
| Linux    | —             | Old path removed            |

---

## The Right Call

EMWaver is a hardware control product. Hardware control needs a real GUI: device lists, signal plots, script editors, control panels. Building and maintaining a browser-based relay stack to approximate that on a platform with negligible adoption was the wrong tradeoff. Cutting it clears significant dead weight from the codebase, eliminates flaky CI, and lets the platform focus on the native apps where the product actually works.
