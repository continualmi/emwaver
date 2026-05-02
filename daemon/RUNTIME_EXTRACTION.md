# Runtime Extraction Plan

This document supports `REBIRTH-010`, `REBIRTH-011`, `REBIRTH-013`, and `REBIRTH-015`.

The current daemon host already contains the ingredients needed for a local-first CLI/gateway runtime:

- `.emw` script evaluation through Boa,
- script bootstrap loading,
- UI tree capture and callback dispatch,
- USB MIDI/SysEx device transport,
- EMWaver superframe protocol helpers,
- hosted WebSocket host loop.

The rebirth direction requires separating reusable runtime/device pieces from the hosted daemon loop for CLI/daemon work. The localhost gateway should not own this runtime; it should bridge browser control to the native EMWaver app, which owns real `.emw` execution and hardware transport.

## Current Extraction Status

Initial extraction is implemented:

```text
daemon/emwaver-runtime/
  src/engine.rs
  src/ui_tree.rs

daemon/emwaver-device/
  src/device.rs
  src/protocol.rs
```

`emwaver-host` now consumes these crates instead of owning the runtime/device modules directly. Verified with:

```bash
cd daemon
cargo build -p emwaver-host -p emwaver
```

Remaining extraction work:

- decide whether `emwaver run` should stay a gateway controller command or also get a direct headless runtime mode.

## Previous Coupling

Before this extraction, the files were:

```text
daemon/emwaver-host/src/engine.rs
  Boa runtime, UI callback registry, _scriptRender, _scriptSendPacket, script eval, UI event dispatch

daemon/emwaver-host/src/device.rs
  MIDI port discovery, MIDI input/output ownership, SysEx framing, command/response bridge

daemon/emwaver-host/src/protocol.rs
  SysEx/superframe protocol helpers

daemon/emwaver-host/src/ui_tree.rs
  streamed UI node model and handler lookup

daemon/emwaver-host/src/main.rs
  hosted backend heartbeat, outbound /v1/ws connection, remote message loop
```

The problem was that CLI and gateway work needed `engine`, `device`, `protocol`, and `ui_tree` without inheriting the hosted backend heartbeat and outbound WebSocket loop.

## Target Workspace Shape

```text
daemon/
  emwaver-runtime/
    src/lib.rs
    src/engine.rs
    src/ui_tree.rs

  emwaver-device/
    src/lib.rs
    src/device.rs
    src/protocol.rs

  emwaver-host/
    hosted daemon wrapper

  emwaver/
    CLI wrapper
```

## `emwaver-runtime`

Responsibilities:

- load/evaluate bootstrap source,
- evaluate `.emw` script source,
- expose latest UI tree,
- expose metadata,
- dispatch UI events by handler token,
- define runtime errors,
- depend on an abstract command bridge instead of a concrete MIDI device.

Suggested trait:

```rust
pub trait CommandBridge: Send + Sync + 'static {
    fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> anyhow::Result<Option<Vec<u8>>>;
}
```

`Engine` accepts `Arc<dyn CommandBridge>` instead of `Arc<Device>`, so it no longer depends on the concrete MIDI transport crate.

This allows:

- real hardware bridge for CLI/gateway/daemon,
- no-op bridge for tests,
- future simulated bridge for docs/examples.

## `emwaver-device`

Responsibilities:

- list visible device ports,
- connect to a selected/default device,
- own MIDI input/output connections,
- encode/decode SysEx superframes,
- send command packets,
- receive command responses and streaming data.

Public API direction:

```rust
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub likely_emwaver: bool,
}

pub fn list_devices() -> anyhow::Result<Vec<DeviceInfo>>;

pub struct Device { ... }

impl Device {
    pub fn connect_auto(self: &Arc<Self>) -> anyhow::Result<()>;
    pub fn connect_by_id(self: &Arc<Self>, id: &str) -> anyhow::Result<()>;
}
```

`emwaver-host` adapts `Device` to `emwaver_runtime::CommandBridge` with a small host-side wrapper. This keeps `emwaver-runtime` independent of `emwaver-device`.

## `emwaver-host`

After extraction, `emwaver-host` should become a thin hosted wrapper:

1. load env/config,
2. load bootstrap,
3. connect device,
4. create runtime engine,
5. heartbeat hosted backend,
6. connect outbound `/v1/ws`,
7. map remote messages to runtime calls.

No runtime internals should live here after extraction.

## `emwaver` CLI

After extraction, CLI can add:

```bash
emwaver run path/to/script.emw
emwaver run path/to/script.emw --device <id>
emwaver devices
emwaver doctor
```

`emwaver run` should:

1. read script file,
2. load bootstrap,
3. connect default/selected device,
4. create runtime engine,
5. evaluate script,
6. print script errors and optionally latest UI snapshot summary.

Initial non-interactive `run` does not need full terminal UI rendering.

## Gateway Relationship

The TypeScript gateway should not become a second hardware runtime.

The production gateway shape should:

- serve the browser control UI,
- accept browser WebSocket connections,
- accept native app WebSocket connections,
- forward `script.run`, `script.stop`, `ui.event`, and plot messages to the native app,
- relay `script.started`, `script.error`, `script.stopped`, `ui.snapshot`, and plot data back to the browser.

The native app owns local runtime/device execution. Rust extraction is still useful for daemon/CLI reuse, but it is not required to make the gateway bridge to the native app.

## Tests

Runtime tests should use a no-op or scripted `CommandBridge`:

- evaluate `UI.render(UI.text(...))`,
- verify latest UI tree,
- verify script error reporting,
- verify callback registration and UI event dispatch,
- verify `_scriptSendPacket` forwards bytes to the bridge.

Device tests can cover pure protocol helpers without hardware:

- superframe encode/decode round-trip,
- invalid SysEx rejection,
- lane sizing.

Hardware tests remain manual until device test rigs exist.

## Extraction Order

1. Create `emwaver-device` and move `protocol.rs`.
2. Move pure protocol tests into `emwaver-device`.
3. Move `device.rs` into `emwaver-device`.
4. Create `emwaver-runtime` and move `ui_tree.rs`.
5. Move `engine.rs` into `emwaver-runtime`.
6. Update `emwaver-host` to use both crates.
7. Update `emwaver` CLI `devices` to use `emwaver-device`.
8. Add `emwaver run`.
9. Replace concrete `Device` dependency with `CommandBridge`.
10. Keep gateway production work as a browser-to-native-app bridge.

Items 1, 2, 3, 4, 5, 6, 7, 8, and 9 are implemented and build-verified. Selected-device daemon startup is implemented with `emwaver daemon start --device-id <id>` and `EMWAVER_DEVICE_ID`.

## Remaining Verification

The initial runtime/device extraction is build-verified. Keep the broader runtime work open until:

- daemon behavior is verified after those APIs land,
- `emwaver run --device <id>` behavior is decided and tested if direct runtime mode is added.
