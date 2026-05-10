# EMWaver Rebirth Audit

This audit tracks the current local-first rebirth objective.

## Current Objective

Make `gateway/` the single owner of EMWaver's local backend, CLI, runtime, transports, and browser frontend for terminal/browser workflows.

The desired runtime model is:

```text
CLI -> Gateway -> device
browser -> Gateway -> device
native apps -> self-contained native runtime -> device
```

## Completed Code Work

- `gateway/backend/` now contains the Rust Gateway backend workspace, CLI, runtime crate, transport crate, and install/service helper.
- `gateway/frontend/` now contains the React browser UI, Vite build, verification script, and frontend assets.
- `emwaver gateway serve` runs the localhost webserver and runtime owner in one Rust process.
- `emwaver run` sends `script.run` to a running Gateway over localhost WebSocket.
- Direct/local CLI script execution was removed from the public CLI.
- Native macOS and Windows Gateway host services and settings were removed.
- Rust Agent CLI/backend routes were removed. Agent UI/tooling belongs in TypeScript/client code and native Agent surfaces.
- Packaging scripts and Gateway validation scripts use the consolidated Gateway path.

## Validation Evidence

Latest local validation for this migration is tracked in `TESTS_REBIRTH.md`.

Required final reruns before closing the objective:

```bash
cd gateway/backend
cargo fmt --check
cargo build -q -p emwaver
cargo test -q -p emwaver-runtime -p emwaver-device

cd ../frontend
npm run typecheck
npm run build
npm run verify

cd ../..
bash -n gateway/backend/install/install.sh scripts/*.sh
scripts/rebirth-gateway-sim-validation.sh
scripts/rebirth-install-smoke.sh
```

macOS native validation should use compact logs, for example:

```bash
xcodebuild -quiet -project macos/EMWaver/EMWaver.xcodeproj -scheme EMWaver -configuration Debug build
```

Windows native validation requires a Windows workstation with the required .NET/WinUI SDK.

## Remaining Gaps

- Finish the active-doc cleanup so user-facing docs do not describe removed command surfaces or native app Gateway host behavior.
- Run the final local validation pass after docs and script changes settle.
- Run real hardware validation for USB/MIDI, BLE, and ESP32 Wi-Fi Gateway transports.
