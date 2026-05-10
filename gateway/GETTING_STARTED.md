# Gateway Getting Started

The EMWaver Gateway is the localhost backend and browser UI for terminal/browser `.emw` workflows. It is not a separate broker in front of native apps. The Rust Gateway owns transports, runtime execution, HTTP routes, and `/v1/ws`; the React app is the browser UI served by that backend.

Native macOS, Windows, iOS, and Android apps stay self-contained. They do not attach to Gateway as runtime owners.

## Development Setup

Build the frontend assets:

```bash
cd gateway/frontend
npm ci
npm run build
```

Run the Gateway from the Rust workspace:

```bash
cd ../backend
cargo run -p emwaver -- gateway serve
```

Open:

```text
http://127.0.0.1:3921
```

## CLI Flow

`emw run` talks to a running Gateway. It does not run scripts in-process. `emwaver` is the full binary name; `emw` is the intended shortcut.

```bash
cd gateway/backend
cargo run -p emwaver -- gateway serve --sim-device
```

In another terminal:

```bash
cd gateway/backend
cargo run -p emwaver -- run ../../assets/default-scripts/blink.emw
```

Gateway starts the local webserver and polls all supported transports. The explicit modes are for special cases:

```bash
emw gateway serve --sim-device
emw gateway serve --no-device
emw gateway serve --wifi 192.168.1.44 --wifi-port 3922 # manual Wi-Fi seed
```

Select defaults once, then omit flags on normal runs:

```bash
emw settings
emw device set uid:d83bdaa4ec7c
emw transport set auto
emw run assets/default-scripts/hello.emw
```

## WebSocket Flow

Connect to:

```text
ws://127.0.0.1:3921/v1/ws
```

Send:

```json
{ "type": "hello", "role": "web", "protocolVersion": 1 }
```

Then send:

```json
{
  "type": "script.run",
  "name": "hello.emw",
  "source": "UI.render(UI.text({ text: \"hello\" }));",
  "deviceId": "uid:d83bdaa4ec7c",
  "transport": "auto"
}
```

Expected messages:

- `hello.ack`
- `device.status`
- `script.started`
- `ui.snapshot`

## Bundled Examples

Gateway serves bundled scripts from:

```text
assets/default-scripts/
```

The browser UI loads them through:

```text
GET /v1/examples
```

## Browser UI

The browser UI includes:

- bundled example list,
- local Gateway/device status,
- `.emw` editor,
- editor/preview switch,
- Run/Stop controls,
- live `ui.snapshot` rendering,
- `ui.event` dispatch,
- `plot.data` rendering.

Agent UI and related tooling should be implemented in TypeScript/client code. Rust should remain focused on local backend communication with EMWaver devices.

## Local-First Behavior

Gateway must not require:

- Continual MI sign-in,
- cloud activation,
- subscription checks,
- hosted relay,
- hosted host/session discovery,
- cloud script storage.

Remote use should be user-owned infrastructure around the local tool, such as SSH, VPN, Tailscale, or explicit port forwarding.
