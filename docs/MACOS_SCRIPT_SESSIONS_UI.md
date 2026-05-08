# macOS Script Sessions UI

Status: implemented in the macOS shared scripts UI path.

## Goal

The macOS app should treat script runs like terminal sessions: running a second script starts another session instead of replacing or stopping the first one.

Users must be able to tell from the toolbar, immediately, where a script will run before pressing Run.

## Required UX

### Toolbar

The toolbar should always expose the active script target:

```text
[ESP32-S3 / B57C47 ▼]
```

Requirements:
- Device target is visible before running.
- Device target is selectable from connected/discovered local devices.
- The selected transport is visible with a USB/BLE icon.
- The selected device is marked with a checkmark in the dropdown.
- User-facing language should say local sessions / devices, not remote.

### Run behavior

Pressing Run should create a new session by default:

```text
script + selected device -> new ScriptPreviewManager/session
```

It must not:
- ask to stop the current script,
- replace the current script runtime,
- imply only one script can run,
- hide the selected target device.

The old macOS confirmation:

```text
Stop current script? / Stop & Run
```

should not appear for the normal macOS multi-session path.

### Script list sessions

The app should show running sessions in the main script list instead of a separate sessions pane:

```text
cc1101.emw    ▶ ESP32-S3 / FB7E94    [stop]
rfm69.emw     ▶ ESP32-S3 / B57C47     [stop]
```

Each script row should show:
- script name,
- target device label/id,
- running/stopped state,
- stop button,
- click/select to restore that script UI.

## Initial implementation direction

1. Keep individual `.emw` scripts single-device for now.
2. Add a macOS-native script session manager owned by `ContentView` or a dedicated observable object.
3. Normal script Run in `ScriptsRootView` should call a macOS run handler instead of directly reusing the single shared `previewManager`.
4. The run handler creates a new `ScriptPreviewManager` for the selected device and stores it as a session.
5. The visible script UI should render the selected session's `ScriptRenderView`.
6. The toolbar device picker should use `MacUSBManager.localDevices` and selected local device id.
7. Existing gateway/local-control sessions can be merged later, but this task is macOS-first.

## Non-goals for first pass

- Multi-device APIs inside a single `.emw` script.
- Fully hardened per-device response buffers.
- Gateway/browser UI changes.
- Cloud/account-backed device selection.

## Local-first constraints

- No account, cloud activation, hosted relay, subscription check, or ownership verification for local script runs.
- Hardware UID may be used only for local labels, diagnostics, and deduplication.
- Hardware UID must not become an activation/account/device-limit gate.

## Acceptance checklist

- [x] Toolbar clearly shows selected device before Run.
- [x] User can change selected target device from the toolbar.
- [x] Running one script then pressing Run on another starts a second session.
- [x] No Stop & Run confirmation appears in the normal macOS path.
- [x] The script list shows script name and target device.
- [x] Clicking a session restores that script UI.
- [x] Stop button stops only that session.
- [ ] Two ESP32-S3 BLE scripts can be run concurrently once hardware is available.
