# UI Snapshot Runtime Migration

> **SUPERSEDED** — This document describes an approach that was reversed.
> The native Agent automation direction has moved to named hardware primitive
> tools (`spi_transfer`, `gpio_read`, `gpio_write`, etc.). See
> `docs/AGENT_EVAL_RUNTIME.md` for the current decision and motivation.
>
> The Gateway/CLI slice described here (session list, snapshot, event, stop
> commands) remains valid for browser and CLI sessions. The native Agent tool
> set (`get_ui_snapshot`, `send_ui_event`, and later `eval`) has been removed
> and replaced with typed hardware tools.

Status: partially implemented — Gateway/CLI/default-script slice implemented;
native runtime cleanup stopped and direction reversed (see above).

This migration removes script-visible terminal logging from EMWaver and makes UI
snapshots the only supported state surface for scripts, the CLI, browser flows,
native renderers, and Agent automation.

## Decision

`.emw` scripts are UI programs. Runtime state that a user, CLI, browser, native
app, or Agent needs to inspect must be rendered through `UI.render(...)` and read
back through `ui.snapshot`.

Remove the script logging experiment completely:

- no `console.log`, `console.warn`, or `console.error` in bundled scripts,
- no script-visible `console` object in any runtime engine,
- no `_scriptLog` host hook,
- no `script.log` WebSocket messages,
- no CLI behavior that tails script logs as the primary run output,
- no replacement `print(...)` or generic script logging API.

Host applications may keep internal developer diagnostics in their own process
logs. Those diagnostics are not part of the `.emw` script API and must not be
used as the automation state channel.

## Why

The bundled scripts were designed around interactive UI state and event handlers.
Retrofitting terminal logs creates a second behavior contract for every script:
one path for the real UI and another path for terminal automation. That makes
scripts harder to maintain, forces UI scripts to become command-line programs,
and gives agents a partial view that can drift from what users actually see.

The right contract is one UI model everywhere:

```text
script.run -> script.started -> ui.snapshot
ui.event  -> ui.snapshot
script.stop -> script.stopped
```

The CLI should start scripts, list running sessions, inspect snapshots, send UI
events, and stop sessions. It should not require scripts to emit log lines in
order to be usable from a terminal.

## Target CLI Shape

Final command names can still be adjusted, but the behavior should follow this
model:

```bash
emw run assets/default-scripts/blink.emw
emw scripts
emw ui snapshot <script-instance-id>
emw ui event <script-instance-id> --target <node-id> --name <event-name> --value '<json>'
emw script stop <script-instance-id>
```

`emw run` should start a script through the local Gateway and return after
`script.started`, printing the script instance id, script name, resolved device,
transport, and any startup warning. Long-running terminal attachment should be a
snapshot/event workflow, not a log tail.

`emw scripts` should list active script sessions with enough attribution for
automation:

- script instance id,
- script name,
- device id,
- transport id,
- latest snapshot revision,
- started time,
- current lifecycle state.

`emw ui snapshot` should return the latest stored UI tree for the selected script.
Machine-readable JSON must be supported. A compact human tree view is useful, but
it must be derived from the same snapshot JSON.

`emw ui event` should dispatch the same event payload the browser sends today and
then make the updated snapshot available through `emw ui snapshot`.

## Protocol Target

Gateway inbound messages:

```text
hello
script.run
script.list
script.stop
ui.snapshot.get
ui.event
plot.viewport
```

Gateway outbound messages:

```text
hello.ack
device.status
script.list
script.started
script.stopped
script.error
ui.snapshot
plot.data
```

`script.log` is removed. If a script needs to expose status, errors, progress, or
results, it renders them into the UI tree.

## Migration Work

### 1. Documentation and Policy

- Mark this file as the controlling migration for script observability.
- Remove the shared CLI logging contract from `assets/default-scripts/README.md`.
- Update Gateway CLI docs so `emw run` is described as a session starter, not a
  log-following command.
- Update planning and test docs so agent automation says snapshots/events/status,
  not snapshots/logs.

### 2. Bundled Scripts

- Remove every `console.log(...)` call from `assets/default-scripts/*.emw`.
- Keep or improve visible state in `UI.render(...)` so startup context, selected
  board/pin/module config, action progress, errors, and final results are present
  in snapshots.
- Do not add a replacement logging helper.
- Treat `script_bootstrap.emw` as the UI and hardware API bootstrap only.

### 3. Shared Runtime Engines

Remove script logging support from every script engine surface:

- Rust Gateway runtime under `gateway/backend/emwaver-runtime/`,
- Android runtime bridge,
- Apple shared/native runtime bridge,
- Windows runtime bridge,
- any simulator or test runtime that exposes `.emw` APIs.

Removal includes the script-visible `console` object, `_scriptLog`, log queues,
log event structs, log drain APIs, and tests that assert script log forwarding.
Scripts that call `console.log(...)` should fail like any other reference to an
undefined script symbol during the migration window, then disappear once bundled
and test scripts are cleaned up.

### 4. Gateway and CLI

- Remove `script.log` from the Gateway WebSocket protocol.
- Remove log-drain calls after `script.run`, `ui.event`, timer pumps, and
  `script.stop`.
- Replace long-running `emw run` log streaming with session-oriented commands.
- Persist active session metadata and latest snapshots in the Gateway so CLI
  clients can reconnect and inspect current state without owning the runtime.
- Keep `script.error` for runtime/evaluation failures. Script-level recoverable
  status belongs in `UI.render(...)`.

### 5. Browser and Native Surfaces

- Keep browser and native app renderers centered on the UI tree.
- Remove any script-log panels or script-log forwarding that were added only for
  the CLI experiment.
- Ensure errors surfaced to users are either host/runtime errors or script-rendered
  UI status, not hidden script log text.

### 6. Validation

Add mechanical checks:

```bash
rg -n "console\\.|_scriptLog|script\\.log|ScriptLog|drain_log" \
  assets/default-scripts gateway android apple ios macos windows simulator
```

The only allowed hits after implementation should be migration notes, historical
docs, or tests that intentionally assert the symbols are absent.

Runtime checks:

- `emw gateway serve --sim-device` starts normally.
- `emw run assets/default-scripts/hello.emw` returns a script instance id.
- `emw scripts` lists that script.
- `emw ui snapshot <id> --json` returns the latest UI tree.
- `emw ui event <id> ...` changes the UI snapshot when the script handles the
  event.
- `emw script stop <id>` stops the session and no stale active script remains.
- Gateway frontend verification still covers `script.run`, `ui.snapshot`,
  `ui.event`, and `plot.data`.
- All default scripts run without referencing `console`.

## Completion Gates

- Bundled `.emw` scripts contain no `console.*` calls.
- No runtime exposes a script-visible `console` object or script logging hook.
- Gateway no longer emits or accepts `script.log`.
- CLI run/list/snapshot/event/stop workflows work against the simulator.
- At least one real hardware script run validates snapshot/event automation.
- Docs and tests describe UI snapshots as the sole script state channel.
