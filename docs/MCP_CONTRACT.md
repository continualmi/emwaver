# EMWaver MCP Contract

This is the desktop Agent replacement contract. EMWaver apps do not ship a bespoke in-app Agent runtime. Desktop apps expose a local, user-enabled MCP server that routes into the same script engine, console capture, script storage, and device transports used by the human UI.

## Scope

- macOS, Windows, and native Linux host the MCP server in the running app.
- iOS and Android do not host an MCP endpoint.
- The endpoint is loopback-only Streamable HTTP with explicit in-app enablement and a generated local token/pairing secret.
- MCP access must not require EMWaver accounts, cloud activation, hosted relay, subscription checks, hardware ownership, or device registration.

## Implementation Status

- macOS, Windows, and Linux have the first in-app MCP slice in source: Settings exposes enablement, endpoint, and token controls; the app hosts `POST /mcp` on loopback when enabled.
- The first desktop tools are `list_scripts`, `read_script`, `write_script`, and `device_state`.
- Linux app compilation still requires Linux/GTK system libraries; validate that slice on a GTK4/libadwaita host.
- `run_script`, `stop_script`, and hardware primitive tools remain contract work until the script-session and transport mutation paths are routed through MCP.

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `list_scripts` | none | `{ scripts: [{ id, name, path, editable, source_kind }] }` |
| `read_script` | `{ script_id }` | `{ script: { id, name, path, editable, source } }` |
| `write_script` | `{ script_id?, path?, content }` | `{ script: { id, name, path, editable }, created: boolean }` |
| `run_script` | `{ script_id?, source?, name? }` | `{ run_id, ok, status, console: [{ level, text, timestamp }] }` |
| `stop_script` | `{ run_id? }` | `{ ok, status }` |
| `device_state` | none | `{ connected, selected_device?, devices: [...] }` |
| `spi_transfer` | `{ tx: number[], rx_length? }` | `{ rx: number[], ok }` |
| `gpio_read` | `{ pin }` | `{ pin, value }` |
| `gpio_write` | `{ pin, value }` | `{ pin, value, ok }` |
| `analog_read` | `{ pin }` | `{ pin, value }` |

## Result Rules

- Tool results are JSON objects, never plain text.
- Errors include `{ ok: false, error: { code, message, recovery? } }`.
- Hardware tools must report when no selected device is connected instead of probing implicitly.
- Script tools and the app UI resolve the same script roots.
- `run_script` returns the same captured console output the app shows.
