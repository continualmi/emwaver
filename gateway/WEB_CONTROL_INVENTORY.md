# Web Control UI Inventory

This inventory supports `REBIRTH-020`.

The current hardware/script control surface lives mostly in `web/src/app/cloud/page.tsx`. It mixes local-preview behavior, cloud file management, hosted remote host attachment, auth, Pro gating, and script UI rendering. The gateway migration should keep the useful control/editor pieces and remove hosted cloud dependencies from the local path.

## Summary

Move or share:

- `.emw` script editor/viewer layout,
- bundled example script list,
- editor/preview mode switch,
- live `script.run` send path,
- `ui.snapshot` receive path,
- `ui.event` dispatch path,
- `RemoteEmwUi` and shared UI renderer,
- plot viewport/data support.

Keep in hosted `web/`:

- public site/docs/media,
- account pages,
- subscription pages,
- cloud file APIs,
- hosted host/session APIs,
- hosted Agent routes until the new API-key Agent contract exists.

Delete or hide from gateway local mode:

- sign-in gate,
- Continual Pro gate,
- cloud file browser,
- hosted host selector,
- hosted heartbeat/session discovery assumptions,
- backend token WebSocket URL construction.

## File Classification

| File | Classification | Notes |
| --- | --- | --- |
| `web/src/app/cloud/page.tsx` | `split` | Main dashboard/control surface. Extract editor, example script list, preview/live renderer, and WebSocket message handling into gateway-local UI. Remove auth, Pro gating, cloud files, hosted host selection, and hosted backend WebSocket assumptions from gateway path. |
| `web/src/components/EmwUiRenderer.tsx` | `share` | Generic declarative UI renderer. This is useful for both hosted and local gateway UI. |
| `web/src/components/RemoteEmwUi.tsx` | `share` | Adapter from remote/local UI tree protocol to `EmwUiRenderer`. Should become protocol-neutral enough for gateway. |
| `web/src/components/EmwUiPreview.tsx` | `share` | Browser preview renderer for UI-only script evaluation. Useful in gateway editor preview mode. |
| `web/src/lib/emwUiRuntime.ts` | `share or replace later` | Browser-only UI preview evaluator with hardware stubs. Useful for preview mode, but not the real runtime. Gateway live mode should use the shared `.emw` runtime. |
| `web/src/lib/exampleEmwScripts.ts` | `share` | Generated bundled examples used by dashboard. Gateway should consume examples directly or from a shared generated package. |
| `web/src/lib/remoteSessions.ts` | `split` | Message type definitions are reusable. `backendWsUrl(idToken)` is hosted/cloud-specific and should not be used by gateway. |
| `web/src/lib/remoteAttach.ts` | `replace` | Hosted attach helper depends on backend token URL and `host.attach`. Gateway should use a local WebSocket helper instead. |
| `web/src/lib/backend.ts` | `keep in web` | Cloud files, hosted hosts, Agent conversations, and backend fetch helpers. Gateway local control should not depend on this. |
| `web/src/lib/clientSession.ts` | `keep in web` | Continual sign-in/session helper. Gateway local control should not depend on this. |
| `web/src/lib/hostPrefs.ts` | `replace` | Hosted selected-host preference. Gateway may need local device preference later, but not hosted host ids. |
| `web/src/components/DashboardDevicesPanel.tsx` | `replace or split` | Currently account/device oriented. Gateway needs local device status instead. |
| `web/src/components/AccountPill.tsx` | `keep in web` | Account/subscription UI only. |
| `web/src/components/AccountPanel.tsx` | `keep in web` | Account/subscription UI only. |
| `web/src/components/EmwAuthGoogleButton.tsx` | `keep in web` | Auth UI only. |
| `web/src/app/cloud/agent/page.tsx` | `keep in web for now` | Hosted Agent UI. Later gateway gets a new API-key Agent panel with a different contract. |

## `web/src/app/cloud/page.tsx` Sections

Useful for gateway:

- file type helpers and utility formatting around lines 25-83.
- selected script/editor state around lines 91-94.
- remote/live UI state around lines 95-114, after removing hosted host/session assumptions.
- WebSocket message handling for `script.started`, `script.stopped`, `ui.snapshot`, `plot.data`, and `script.error` around lines 379-480.
- `script.run` send path around lines 520-537, after replacing `hostSessionId`/host attach with local gateway behavior.
- example scripts list around lines 770-788.
- editor/preview switch around lines 829-849.
- live `RemoteEmwUi` rendering and `ui.event` dispatch around lines 880-904.
- browser preview fallback using `evalEmwUi` around lines 905-924.
- text editor area around lines 928-936.

Cloud-specific, do not move into gateway local mode:

- `SiteHeader`, `AccountPill`, `DashboardDevicesPanel`, auth imports, and backend imports around lines 4-23.
- account/token/pro/files state around lines 86-90.
- entitlement and cloud file/host refresh around lines 126-147.
- session loading/sign-in/sign-out around lines 162-205 and 238-247.
- hosted host connection setup via `backendWsUrl(tok)` and `host.attach` around lines 279-321.
- hosted reconnect behavior requiring `idToken` and selected hosted host around lines 333-377 and 503-518.
- cloud file open/save/upload/delete around lines 554-631.
- Pro preview/sign-in/upgrade UI around lines 647-739.
- cloud host selector around lines 660-680.
- Cloud Files list around lines 790-822.
- Save button gating on `proAccess` around lines 870-876.

## Local Gateway UI Target

The gateway UI should start simpler than the current cloud dashboard:

```text
left pane:
  example scripts
  local open/save later
  local device status

main pane:
  .emw editor
  preview/live segmented control
  run/stop controls
  rendered UI tree

agent pane later:
  API-key state
  prompt input
  script/error context
```

No sign-in, Pro, cloud file browser, or hosted host selector should be required.

## Local WebSocket Helper Target

Replace hosted helpers with a gateway-local helper:

```ts
localGatewayWsUrl(portOrBaseUrl): string
connectLocalGateway(callbacks): WebSocket
```

The helper should send:

- `hello` with role `web`,
- `script.run`,
- `script.stop`,
- `ui.event`,
- plot viewport messages if retained.

The helper should receive:

- `hello.ack`,
- local device status,
- `script.started`,
- `script.stopped`,
- `script.error`,
- `ui.snapshot`,
- `plot.data`.

## Migration Notes

- Keep protocol message types close to `remoteSessions.ts`, but move hosted URL/auth concerns out of the shared type module.
- `RemoteEmwUi` can be renamed later if the tree is no longer strictly remote.
- `evalEmwUi` remains useful for disabled preview mode, but live mode must run through the Rust/shared runtime.
- The first gateway UI can ignore cloud files and use bundled examples only.
- Local file open/save can be added after gateway script execution works.
