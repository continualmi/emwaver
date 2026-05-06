# EMWaver Gateway

The EMWaver gateway is the local-first browser control surface and WebSocket bridge.

It is intended to run on the same machine as the native EMWaver app. It acts as a localhost host controller for the macOS/Windows app, not as a third-party core service. It serves a browser UI and exposes local HTTP/WebSocket APIs for sending `.emw` scripts to the native app, rendering app-produced UI snapshots in the browser, dispatching UI events back to the app, and reporting local app/device status.

The gateway is not the hosted EMWaver web app.

## Purpose

The gateway should make this local flow possible:

```bash
emwaver gateway
emwaver gateway --daemon-fallback
```

or:

```bash
emwaver web
```

Then open:

```text
http://127.0.0.1:<port>
```

The browser UI should talk directly to the local gateway:

```text
localhost browser UI
  <-> localhost WebSocket
  <-> native EMWaver macOS/Windows app or Linux/headless emwaver daemon host
  <-> app/daemon-owned .emw runtime and device transport
  <-> board firmware
```

## Local Responsibilities

The gateway owns the local host-controller plane:

- serve the browser control UI,
- expose a local WebSocket endpoint,
- forward `script.run` messages to the native app,
- render `ui.snapshot` messages produced by the native app,
- forward `ui.event` messages to the native app,
- report local device status,
- avoid account, cloud activation, subscription, and hosted relay requirements.

## Protocol Direction

The local gateway should reuse the existing EMWaver control protocol shape where practical:

- `hello`
- `script.run`
- `script.started`
- `script.error`
- `ui.snapshot`
- `ui.event`
- local device status/list messages

Unlike the old hosted path, the local gateway should not require:

- hosted `/v1/hosts/heartbeat`,
- remote session discovery,
- backend URL configuration,
- identity-token configuration,
- subscription checks,
- backend device ownership.

An internal local host/session id may still be used if it keeps the protocol compatible, but it should not represent a hosted cloud session.

The gateway should not become a second backend runtime or third-party control service. The native macOS/Windows app owns real `.emw` execution and hardware/device transport; gateway only controls and renders that local app session.

On Linux and other no-GUI hosts, the Rust daemon fills the same local runtime-owner role:

```bash
emwaver start
```

or, split across terminals:

```bash
emwaver gateway
emwaver daemon serve --sim-device
```

The daemon connects to `/v1/ws` as `role=host`, receives `script.run` and `ui.event`, executes scripts through `emwaver-runtime`, sends hardware commands through `emwaver-device`, and streams `ui.snapshot` back through the gateway. USB MIDI/SysEx is the default daemon transport; `emwaver gateway --daemon-fallback --ble` selects the ESP32 BLE GATT transport using the same SysEx/superframe envelope. The gateway remains a localhost bridge and web renderer; it does not own BLE/USB/MIDI hardware directly.

Runtime-owner preference is:

```text
native app role=app
  then daemon role=host
  then offline
```

This lets `emwaver gateway --daemon-fallback` provide a headless fallback while still allowing a running native app to take priority when it is connected to the same gateway.

## Security Model

The gateway should bind to localhost by default.

Exposing the gateway beyond `127.0.0.1` is user-owned risk. Remote usage should be documented through user-managed infrastructure such as SSH, VPN, Tailscale, or explicit port forwarding.

The launch direction is:

- same machine: `http://127.0.0.1:<port>`,
- remote power-user workflow: SSH into the machine that owns the hardware,
- no required Continual MI cloud relay for local hardware control.

## Relationship To `web/`

`web/` owns mostly static public pages, docs, downloads, and product information. Hosted auth, cloud dashboard, relay, provisioning/minting, cloud file storage, and EMWaver backend control surfaces have been removed from the current web app route set. Paid Agent/API usage belongs to the future Continual MI/MGPT backend instead of an EMWaver cloud runtime.

`gateway/` owns the localhost hardware control surface and should receive the full `.emw` script editor, renderer, live UI, event dispatch, plot, local file, and Agent-assisted control experience migrated from `web/`.

Gateway scripts and local project state should stay on the user's device. Browser-local open/save and app-local files are acceptable; cloud script storage, account-backed project libraries, script sync, hardware-UID registration, device minting, and device limits are not part of the core local gateway path.

## Initial Implementation Targets

The first gateway implementation should:

1. start a local HTTP server,
2. serve a minimal control UI,
3. expose a local WebSocket endpoint,
4. accept `script.run`,
5. forward scripts to a locally connected native app,
6. render UI snapshots from that app,
7. work without account or cloud configuration.

## Development

From `gateway/`:

```bash
npm install
npm run dev
```

The default URL is:

```text
http://127.0.0.1:3921
```

Override the port with:

```bash
EMWAVER_GATEWAY_PORT=3930 npm run dev
```

The CLI wrapper also supports:

```bash
emwaver gateway --port 3930
```

If the selected port is already in use, the gateway exits with a specific port-conflict message. Browser auto-open is intentionally deferred until the local control UI is migrated beyond the prototype page.

The current gateway server supports `hello`, `script.run`, `script.stop`, `ui.event`, `plot.viewport`, `script.started`, `script.stopped`, `script.error`, `ui.snapshot`, and `plot.data` over `/v1/ws`. Browser clients connect with role `web`; the native EMWaver app should connect with role `app`; the Rust daemon should connect with role `host`. Real hardware command execution and UI handler dispatch stay in the connected app/daemon runtime owner.

The gateway browser surface is a React dashboard restored from the old web script control UI, with hosted account, subscription, cloud file, and hosted host-selection behavior removed. It keeps the local script editor, bundled examples, preview/live switch, Run/Stop controls, UI snapshot rendering, UI events, Agent panel, and plot support.

The current browser renderer supports the bundled-script UI node set: `column`, `row`, `grid`, `text`, `button`, `tile`, `slider`, `picker`, `textField`, `textEditor`, `scroll`, `card`, `divider`, `spacer`, `progress`, `logViewer`, and `plot`.
