# Gateway Getting Started

The EMWaver gateway is the localhost browser control surface for local `.emw` hardware control.

Current status: restored local dashboard. It serves a React script-control UI, exposes `/v1/ws`, and can preview simple script UI without cloud auth. Real hardware execution depends on the native app connecting to the gateway as the local runtime owner.

## Run In Development

From the repo root:

```bash
cd gateway
npm ci
npm run dev
```

Open:

```text
http://127.0.0.1:3921
```

## Port Override

```bash
EMWAVER_GATEWAY_PORT=3930 npm run dev
```

The Rust CLI wrapper is intended to support:

```bash
emwaver gateway --port 3930
```

On machines with Rust/Cargo available, the development wrapper should eventually be:

```bash
./daemon/dev gateway --port 3930
```

## Current WebSocket Flow

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
  "source": "UI.render(UI.text({ text: \"hello\" }));"
}
```

Expected messages:

- `hello.ack`
- `device.status`
- `script.started`
- `ui.snapshot`

## Bundled Examples

The gateway serves bundled scripts from:

```text
assets/default-scripts/
```

The local UI loads them through:

```text
GET /v1/examples
```

This keeps the localhost control surface aligned with the repo's canonical `.emw` examples instead of maintaining a separate gateway-only script list.

## Browser UI

The gateway UI restores the useful parts of the old web script dashboard:

- bundled example list,
- `.emw` editor,
- editor/preview switch,
- Run/Stop controls,
- live `ui.snapshot` rendering,
- `ui.event` dispatch,
- `plot.data` rendering,
- optional Agent panel.

It intentionally omits EMWaver sign-in, Pro gates, cloud files, hosted host selectors, hosted relay assumptions, and subscription checks.

## Account-Free Behavior

The gateway must not require:

- Continual MI sign-in,
- cloud activation,
- subscription checks,
- hosted relay,
- hosted host/session discovery.

Agent features may require an API key later, but missing Agent configuration must not block local script control.

## Optional Agent

The local gateway includes an Agent panel. It is optional and does not affect local script execution.

To enable it against a Continual MI Agent endpoint:

```bash
EMWAVER_AGENT_API_KEY=... EMWAVER_AGENT_ENDPOINT=https://... npm run dev
```

Without those variables, `/v1/agent` returns `agent_not_configured` and the rest of the gateway continues to work.

## Current Limitations

- Preview mode uses a small browser UI evaluator for `UI.render` shape only.
- Real hardware command execution requires the native app to connect as the local runtime owner.
- UI handler dispatch is acknowledged but not executed yet.
- The production local path should use shared runtime/device code extracted from the current daemon host rather than expanding this TypeScript evaluator into a second runtime.
