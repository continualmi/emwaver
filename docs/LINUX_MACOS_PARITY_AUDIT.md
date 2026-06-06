# Linux/macOS Native Parity Audit

Last updated: 2026-06-06

This is the working checklist for the native Linux GTK4 port against the macOS app and shared Apple script UI. It should stay honest: incomplete Linux surfaces are gaps, not parity.

## Current high-priority gaps

1. Script workspace flow
   - macOS opens to the script list, runs/restores scripts from rows, and opens the editor as a secondary action.
   - Linux now defaults the workspace content to runtime preview, has row-level Run/Edit controls, routes row Run through the same local script runtime path as the toolbar, renders/restores the selected script preview from row Run, and shows an inline Running badge plus per-row Stop control while a local session is active.
   - Needed: support true restore of long-lived preview sessions and keep inline running state live for asynchronous/long-running sessions.

2. Script UI rendering
   - macOS executes default scripts through `ScriptPreviewManager`, transpiles imports/JSX, and renders `ScriptRenderView` nodes.
   - Linux executes the early command/gpio/device JavaScript API and now has local module loading, JSX transform, `__emwUI`/`__emwRender`, typed script tree capture, an initial GTK renderer for common node types, and live handler invocation for tap/change/submit controls through a persistent script UI runtime.
   - Needed: add plot/modal polish, continue broadening control-specific behavior, and validate GTK rendering/event handling on a Linux machine.

3. MCP tool parity
   - Desktop MCP should expose local tools for listing/reading/writing/running scripts, stopping scripts, device status, and hardware primitives.
   - Linux now has the in-app MCP source slice: Settings enablement/token, loopback `POST /mcp`, `list_scripts`/`read_script`/`write_script`/`run_script`/`stop_script`/`device_state`, plus `spi_transfer`/`gpio_read`/`gpio_write`/`analog_read` through the selected USB/BLE/Wi-Fi transport.
   - Needed: validate the Linux app slice on a GTK4/libadwaita host, connect MCP runs to persistent GTK session-worker ownership, and lift or document the Linux SPI 14-byte TX limit if the firmware/runtime command lane changes.

4. Device sheet behavior
   - macOS groups transports by hardware UID, supports transport switching, manual Wi-Fi, ESP32 Wi-Fi provisioning/clear/status, and shows UID probe freshness.
   - Linux groups transports and validates manual Wi-Fi, but does not yet perform Wi-Fi provisioning/clear/status from the GTK sheet.
   - Needed: add ESP32 provisioning commands over selected USB/BLE/Wi-Fi, persist SSID/host/port locally, store Wi-Fi password via Secret Service, and show live status.

5. Background discovery and session ownership
   - macOS polls every 5 seconds, refreshes USB/BLE/Wi-Fi liveness, prunes stale records, keeps BLE discovery active, and rejects active transport switches for busy devices.
   - Linux seeds devices at launch and has the core busy-device guard, but the GTK app does not yet run the continuous discovery/reconcile loop.
   - Needed: GLib/Tokio discovery task, periodic USB/BLE/Wi-Fi refresh, stale pruning, selected-device preservation, and busy-session UI disable states.

6. Firmware update UX
   - macOS presents board-specific next steps, auto-prompts for DFU/update mode, and distinguishes STM32 DFU from ESP32 serial bootloader flows.
   - Linux has board-aware STM32/ESP32 flashing paths and logs, but lacks auto-prompting and complete Linux hardware validation.
   - Needed: automatic update-mode prompt parity, ESP serial candidate selection UX, and validation on a real Linux machine.

7. Settings persistence
   - macOS settings cover local desktop preferences and transport debug preference with native persistence.
   - Linux has the run log visibility surface, but discovery/debug preferences are not yet fully persisted.
   - Needed: XDG-backed discovery/debug settings and live application of those settings.

## Recently closed or improved

- Linux loads the shared `assets/default-scripts` bundle and separates examples, libraries, kernel files, and custom scripts.
- Linux script execution can load bundled library/kernel module sources through a local `require` loader after import-line rewriting.
- Linux runtime can transform uppercase JSX and capture the rendered script UI tree from the shared `emw-jsx.js`/`emw-ui.js` modules.
- Linux GTK can render captured script UI trees for common layout/control nodes instead of showing only a text tree summary.
- Linux script UI preview now keeps a live `ScriptUiRuntime` and invokes captured handler tokens from GTK buttons, tiles, sliders, pickers, toggles, and text-field submit/change callbacks.
- Linux script rows now expose native Run/Edit buttons plus inline running state and row Stop actions, and row Run switches the main content to the live runtime preview instead of requiring the editor/toolbar path.
- Linux editor uses GtkSourceView with syntax highlighting, line numbers, find, go-to-line, and line wrap.
- Linux has USB MIDI, Wi-Fi WebSocket/mDNS, and BlueZ BLE GATT transport paths behind the shared transport trait.
- Linux firmware flow can plan bundled STM32 and ESP32-S3 images and call the local flashing backends.
- Linux desktop MCP settings plus script/status and hardware primitive MCP tools are present in the GTK app source.
