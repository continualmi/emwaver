# EMWaver MCP Contract

Desktop EMWaver apps expose a local, user-enabled MCP server that routes into the same script engine, console capture, script storage, and device transports used by the human UI.

## Scope

- macOS, Windows, and native Linux host the MCP server in the running app.
- iOS and Android do not host an MCP endpoint.
- The endpoint is loopback-only Streamable HTTP with explicit in-app enablement and a generated local token/pairing secret.
- MCP access must not require EMWaver accounts, cloud activation, hosted relay, subscription checks, hardware ownership, or device registration.

## Current Status

- macOS, Windows, and Linux have the first in-app MCP slice in source: Settings exposes enablement, endpoint, and token controls; the app hosts `POST /mcp` on loopback when enabled.
- The desktop tools implemented in source are `list_scripts`, `read_script`, `write_script`, `run_script`, `stop_script`, `device_state`, `spi_transfer`, `gpio_read`, `gpio_write`, and `analog_read`.
- macOS and Windows keep MCP-started run sessions alive until `stop_script`; Linux keeps MCP-started run records with cancellable worker tasks, but still needs full GTK session-worker ownership for live UI/event parity.
- Linux app compilation still requires Linux/GTK system libraries; validate that slice on a GTK4/libadwaita host.
- Linux hardware primitive tools use the selected USB/BLE/Wi-Fi transport. BLE and Wi-Fi primitive calls claim the firmware transport session before sending the command and release it afterward when practical.
- Linux SPI primitive transfers are currently constrained by the Linux command lane to 14 TX bytes per call.

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `list_scripts` | none | `{ scripts: [{ id, name, path, editable, source_kind }] }` |
| `read_script` | `{ script_id }` | `{ script: { id, name, path, editable, source } }` |
| `write_script` | `{ script_id?, path?, content }` | `{ script: { id, name, path, editable }, created: boolean }` |
| `run_script` | `{ script_id?, source?, name? }` | `{ run_id, ok, status, console: [{ level, text, timestamp }] }` |
| `stop_script` | `{ run_id? }` | `{ ok, status }` |
| `device_state` | none | `{ connected, selected_device?, devices: [...] }` |
| `spi_transfer` | `{ tx: number[] \| string, rx_len?, cs?, timeout_ms? }` | `{ rx: number[], payload, ok }` |
| `gpio_read` | `{ pin, timeout_ms? }` | `{ pin, value, payload }` |
| `gpio_write` | `{ pin, value, timeout_ms? }` | `{ pin, value, payload, ok }` |
| `analog_read` | `{ pin, samples?, timeout_ms? }` | `{ pin, readings: number[], payload }` |

## Result Rules

- Tool results are JSON objects, never plain text.
- Errors include `{ ok: false, error: { code, message, recovery? } }`.
- Hardware tools must report when no selected device is connected instead of probing implicitly.
- Script tools and the app UI resolve the same script roots.
- `run_script` returns captured console output available at start time; `stop_script` returns the current stored console snapshot for MCP-started runs.
