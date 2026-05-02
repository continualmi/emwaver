# EMWaver Gateway

The EMWaver gateway is the local-first browser control surface and WebSocket bridge.

It is intended to run on the same machine as the native EMWaver app. It acts as a localhost host controller for the macOS/Windows app, not as a third-party core service. It serves a browser UI and exposes local HTTP/WebSocket APIs for sending `.emw` scripts to the native app, rendering app-produced UI snapshots in the browser, dispatching UI events back to the app, and reporting local app/device status.

The gateway is not the hosted EMWaver web app.

## Purpose

The gateway should make this local flow possible:

```bash
emwaver gateway
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
  <-> native EMWaver macOS/Windows app
  <-> app-owned .emw runtime and device transport
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
- `EMWAVER_BACKEND_URL`,
- `EMWAVER_ID_TOKEN`,
- subscription checks,
- backend device ownership.

An internal local host/session id may still be used if it keeps the protocol compatible, but it should not represent a hosted cloud session.

The gateway should not become a second backend runtime or third-party control service. The native macOS/Windows app owns real `.emw` execution and hardware/device transport; gateway only controls and renders that local app session.

## Security Model

The gateway should bind to localhost by default.

Exposing the gateway beyond `127.0.0.1` is user-owned risk. Remote usage should be documented through user-managed infrastructure such as SSH, VPN, Tailscale, or explicit port forwarding.

The launch direction is:

- same machine: `http://127.0.0.1:<port>`,
- remote power-user workflow: SSH into the machine that owns the hardware,
- no required Continual MI cloud relay for local hardware control.

## Relationship To `web/`

`web/` should trend toward mostly static public pages, docs, downloads, and product information. Existing auth, cloud dashboard, hosted relay, and backend control surfaces in `web/` are migration debt unless explicitly needed for optional hosted services or paid Agent/API usage.

`gateway/` owns the localhost hardware control surface and should receive the full `.emw` script editor, renderer, live UI, event dispatch, plot, local file, and Agent-assisted control experience migrated from `web/`.

Gateway scripts and local project state should stay on the user's device. Browser-local open/save and app-local files are acceptable; cloud script storage, account-backed project libraries, and script sync are not part of the core local gateway path.

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

The current gateway server supports `hello`, `script.run`, `script.stop`, `ui.event`, `script.started`, `script.error`, and `ui.snapshot` over `/v1/ws`. Browser clients connect with role `web`; the native EMWaver app should connect with role `app` or `host`. Real hardware command execution and UI handler dispatch stay in the native app.
