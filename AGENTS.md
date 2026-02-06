# EMWaver Repository Guidelines

## Current Product Direction

EMWaver is now focused on shipping a **single, solid platform**:

- **Transport:** USB only (class-compliant **USB MIDI SysEx**, fixed 64‑byte frames)
- **Hardware:** **STM32 only** (one current-gen board)
- **Firmware:** **one** firmware binary for the platform (no board catalog, no variants)
- **Distribution:** **store-only for apps** (App Store / Play Store / Microsoft Store) + **bundled firmware payloads** (end users should not be building from source)
- **Core UX:** **Script-centered** hardware exploration (script + UI together, fast iteration, no reflashing)
- **Surface area shipped:** Android app, iOS app, macOS app, Windows app

### EMWaver device (board) capabilities (important)

The shipped EMWaver board is intentionally a general-purpose hardware exploration target:

- **Infrared on-board:** **IR receiver + IR transmitter** (so scripts can learn/capture and **emulate remotes**).
- **GPIO + common peripherals:** exposed pins intended for typical low-level hacking modules and buses:
  - **SPI / I2C / UART**
  - **ADC** inputs
  - **PWM / timers**
  - plus the usual digital GPIO modes (in/out, pull-ups, etc.)
- **External modules are expected:** e.g. **CC1101**, **MFRC522**, and similar “plug-on” hardware via SPI/I2C/UART/GPIO.

Store distribution (apps)

- **Apple App Store**: iOS + macOS
- **Google Play Store**: Android
- **Microsoft Store**: Windows

We do **not** publish direct-download installers for end users (`.dmg`, `.apk`, `.exe`).

GitHub Actions are used for CI (and optionally deployment) of **frontend + backend** only.
We do **not** publish GitHub Releases for the apps (or for frontend/backend).

### Infrastructure (current direction)

We deploy **frontend + backend** to **Azure Container Apps**.

- **Backend**: Flask API → Azure Container App (external ingress)
- **Frontend**: Next.js (chat UI + streaming + websocket support) → Azure Container App (external ingress)
- **Container Registry**: Azure Container Registry (ACR)

CI/CD (GitHub Actions):
- Backend deploy workflow: `.github/workflows/deploy-azure-backend.yml`
- Frontend deploy workflow: `.github/workflows/deploy-azure-frontend.yml`

Deployment mechanism (current):
- GitHub Actions logs into Azure using **OIDC** (`azure/login@v2`)
- Builds + pushes images using **`az acr build`** (build happens in Azure; images stored in ACR)
- Updates the Container App revision using **`az containerapp update`**

Notes:
- `NEXT_PUBLIC_*` variables for the frontend are **build-time** (baked into the Next.js bundle). The deploy workflow passes them as **Docker build args**.
- Backend runtime configuration is via Container App environment variables (DB/Blob/auth/etc.).
- We do **not** require ACR username/password GitHub secrets for deploy; ACR pushes happen via Azure auth.

#### Domains & routing (emwavers.com)

**Cloudflare DNS (proxied/orange-cloud):**
- `app.emwavers.com` (CNAME) → Azure Container App FQDN for **emwaver-frontend**
  - `emwaver-frontend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io`
- `api.emwavers.com` (CNAME) → Azure Container App FQDN for **emwaver-backend**
  - `emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io`
- Apex `emwavers.com` (CNAME) → `app.emwavers.com` (so root lands on the frontend)
- `www.emwavers.com` (CNAME) → `emwavers.com`

**Azure Container Apps custom domains:**
- `emwaver-frontend` should have custom hostname `app.emwavers.com` bound with a managed certificate.
- `emwaver-backend` should have custom hostname `api.emwavers.com` bound with a managed certificate.

**Important:** Cloudflare will return **HTTP 525** if Azure is not serving a certificate for the requested hostname (SNI mismatch). This means the Azure custom domain + cert binding is required before Cloudflare proxying will work reliably.

**Azure domain verification (TXT):**
- Azure Container Apps environment uses a verification id exposed as `customDomainVerificationId`.
- Cloudflare TXT records used:
  - `asuid.app` + `asuid.api` → `<customDomainVerificationId>`
  - `_acme-challenge.app` + `_acme-challenge.api` → Azure managed cert `validationToken` values

### Azure CLI usage (agent)

When helpful for Azure resource management and troubleshooting, the agent may run `az` (Azure CLI) commands in the dev environment to inspect/configure resources.
- Prefer **read-only** commands by default.
- For **destructive or security-sensitive** actions (deletes, role changes, key rotation, public exposure), get explicit user confirmation first.

### GitHub CLI usage (agent)

When helpful for repository management, the agent may use `gh` (GitHub CLI) to perform actions like:
- setting GitHub Actions secrets/variables
- viewing workflow runs and logs
- triggering workflows

For sensitive operations (secrets, permissions, destructive actions), get explicit user confirmation first.

> Engineering note: this repo is still the engineering mono-repo, but the *product* is intentionally not “clone repo → toolchain setup → build/flash”.

---

## Platform Thesis

### The Core Thesis

EMWaver is about **hardware exploration**: education, tinkering, rapid “vibe hacking”.

We are **not** trying to be a general-purpose firmware development environment or a deployment platform.

**Guiding metric:**

> **Time to Full Chip Exploit** should be as low as possible.

EMWaver scripts are the essence of EMWaver:

- No compile
- Ultra-fast hardware exploration
- In a single script you develop both:
  - low-level hardware interactions
  - high-level user interfaces

We treat `.emw` as the first-class format for these scripts.

### Explicit Tradeoffs

We intentionally give up:

- Wireless workflows.
- End-user firmware build/flash/customization workflows.

The board should be useful **only with the client** (Android/iOS/Desktop). That’s the point: the client is the product.

### What We Gain

A very simple platform:

- One board
- One firmware
- Apps on Android / iOS / Desktop

No build/flash loops, and no user-facing wrappers on top of MCU toolchains as a required workflow.

---

## Repository Overview

- **STM32 Firmware:** `stm/emwaver-firmware/` (single firmware)
- **Android:** `android/`
- **iOS:** `ios/`
- **Apple Shared (iOS + macOS):** `apple/` (Swift packages)
- **macOS App (defacto):** `macos/` (SwiftUI)
- **Internal tooling (not shipped):** `cli/` (firmware build + DFU flash)
- **Shared assets:** `assets/` (default scripts, etc.)

### Script sharing / cloud sync safety

- `script_bootstrap.emw` is **INTERNAL** and must **never** be treated as a user/custom script, uploaded to the cloud, or synced/shared between devices.
  - It contains internal EMWaver protocol + script engine bootstrap logic.
  - Only regular user scripts (non-bootstrap) are allowed to be shared/synced.
- **Bundled firmware payload:** `firmware/` (e.g. `firmware/emwaver.bin`) + per-platform copies:
  - Android: `android/app/src/main/assets/firmware/emwaver.bin`
  - iOS: `ios/EMWaver/firmware/emwaver.bin`
  - Apple shared: `apple/EMWaverAppleCore/Resources/Firmware/emwaver.bin`
  - Windows: `windows/EMWaver/Assets/Firmware/emwaver.bin`
- **Website:** `frontend/` (Next.js)
- **Dev env (macOS + Windows):** `DEV_ENV.md` (developer setup checklist; not product docs)

### Repo-local utilities (dev-only)

- Image generation helper (Gemini 2.5 Flash Image): `scripts/gen_image_gemini.py`
  - Model default: `gemini-2.5-flash-image` (txt2img + img2img for edits/variations via `--in`)
  - Requires: Python 3.10+, `pip install google-genai pillow`, and `GEMINI_API_KEY` in env (or repo-root `.env`)
  - Example: `python scripts/gen_image_gemini.py --prompt "Clean product shot, dark studio" --out out.png --overwrite`
  - Example (img2img): `python scripts/gen_image_gemini.py --in ref.png --prompt "Make a subtle variation, keep composition" --out out.png --overwrite`

Notes on dev environment docs:
- `DEV_ENV.md` is a developer-only setup checklist (not end-user/product documentation).
- Use the macOS or Windows section depending on the platform.

Current test suite reference:
- `TESTS.md` is the source of truth for the current manual hardware validation tests (`blink.emw`, CC1101 init/readback with `ism.emw`, sampler capture/retransmit, and servo PWM position control with `pwm.emw`).
- Keep `TESTS.md` focused on currently active tests only unless explicitly asked to expand scope.

Current test code index (set Status to `PASSED` when validated, otherwise leave empty):

| Code | Status |
| --- | --- |
| `001_BLINK_LED_HOST_DEVICE_COMMS` | `PASSED` |
| `002_CC1101_INIT_AND_REGISTER_READBACK` | |
| `003_SAMPLER_CAPTURE_AND_RETRANSMIT_INTEGRITY` | |
| `004_SERVO_PWM_POSITION_CONTROL` | |

## Repository Code Map (curated)

This section is a **manual navigation map**. It intentionally omits the full directory tree and only calls out the places you actually jump to when making changes.

### Apple shared (iOS + macOS) — script runtime + shared UI

- Script runtime core: `apple/EMWaverAppleCore/Sources/EMWaverScriptRuntime/`
  - Entry: `ScriptEngine.swift`
- Script SwiftUI renderer: `apple/EMWaverAppleCore/Sources/EMWaverScriptSwiftUI/`
- USB transport: `apple/EMWaverAppleCore/Sources/EMWaverTransport/`
  - USB MIDI SysEx: `UsbMidiSysex.swift`
- Agent chat (shared): `apple/EMWaverAppleCore/Sources/EMWaverScriptsUI/`
  - Backend API (conversations + SSE): `AgentChatBackend.swift`
  - State/UI: `AgentChatViewModel.swift`, `AgentChatPanelView.swift`
  - macOS right-drawer integration: `ScriptsRootView.swift`

### iOS app

- Auth (Google OAuth + Firebase token exchange, no Firebase SDK): `ios/EMWaver/Auth/`
- Cloud config (backend URL + anon sync gate): `ios/EMWaver/Managers/CloudConfig.swift`
- Main scripts surface (Agent sheet lives here): `ios/EMWaver/Views/ScriptsContainerView.swift`
- Bundled firmware payload: `ios/EMWaver/firmware/emwaver.bin`

### macOS app

- Main scripts surface: `macos/EMWaver/EMWaver/ContentView.swift`
- Auth UI: `macos/EMWaver/EMWaver/Auth/`
- Agent chat UI is shared in AppleCore (do not re-add a modal-only macOS implementation).

### Android app

- Script engine + renderer: `android/app/src/main/java/com/emwaver/emwaverandroidapp/scripts/`
- Cloud (sync/hosts/auth): `android/app/src/main/java/com/emwaver/emwaverandroidapp/cloud/`
- Agent chat (backend client + UI):
  - Backend API (conversations + SSE): `android/.../cloud/agent/AgentBackendApi.java`
  - UI + state: `android/.../ui/agent/`

### Windows app

- Scripts surface (contains right-side Agent pane): `windows/EMWaver/Pages/ScriptsPage.xaml(.cs)`
- Cloud auth/config (Firebase token source): `windows/EMWaver/Services/Cloud/`
- Agent chat backend client + SSE parsing: `windows/EMWaver/Services/Agent/AgentApi.cs`

### Backend (Flask)

- API routes: `backend/emw_backend/routes/`
  - Agent endpoints live under the agent routes file(s) here.

### Firmware (STM32)

- USB MIDI SysEx tunnel glue: `stm/emwaver-firmware/USB_DEVICE/App/usbd_midi_if.c`
- Main firmware logic: `stm/emwaver-firmware/Core/Src/`

### Frontend (Next.js)

- Agent + cloud UI: `frontend/src/app/cloud/`
- Backend client helpers / SSE parsing reference: `frontend/src/lib/`

Web dev (Next.js):
- `cd frontend && npm run dev`

Generated / not-source-of-truth (common):
- `**/target/`, `**/node_modules/`, `android/app/.cxx/`, `stm/**/Debug/`, `stm/**/Release/`

Web dev (Next.js):
- `cd frontend && npm run dev`

Generated / not-source-of-truth (common):
- `**/target/`, `**/node_modules/`, `android/app/.cxx/`, `stm/**/Debug/`, `stm/**/Release/`

Fast “where is X?” index:
- **Script engines** → Android: `.../scripts/ScriptEngine.java`; Apple (iOS + macOS): `apple/EMWaverAppleCore/Sources/EMWaverScriptRuntime/ScriptEngine.swift`
- **Script UI renderers** → Android: `.../scripts/ScriptRenderView.java`; Apple (iOS + macOS): `apple/EMWaverAppleCore/Sources/EMWaverScriptSwiftUI/ScriptRenderView.swift`
- **USB MIDI SysEx tunnel** → Firmware: `stm/.../USB_DEVICE/App/usbd_midi_if.c`; Android: `.../UsbMidiSysex.java`; Apple (iOS + macOS): `apple/EMWaverAppleCore/Sources/EMWaverTransport/UsbMidiSysex.swift`
- **Shared buffer/framing core** → implemented natively per-platform (Swift/Java/C#), keep on-wire semantics stable

## Product Spec & Goals (No Phases)

This section is the **current EMWaver spec**. It replaces the old “phase plan” framing.

### Primary Product Goal

EMWaver is a **script-first hardware exploration control plane**.

- Users explore hardware by writing/running **`.emw` scripts**.
- A script defines both:
  - device/hardware interactions, and
  - a UI that makes the script usable/repeatable.

The product is not “a firmware IDE” and not “a user-facing MCU toolchain wrapper”.

### Execution Contract (the only first-class primitive)

- **Run a `.emw` file** against a connected device.
- Scripts own the UI via `UI.*` + `UI.render(...)`.
- Script output is surfaced through UI/log components and saved artifacts (signals, files).

We intentionally avoid extra modes:
- No REPL.
- No string-eval execution (`-c`).
- No user-facing CLI workflows.

### Storage Model (Local-first + Optional Cloud)

- **Local-first always**:
  - scripts are stored locally,
  - signals/artifacts are stored locally.
- **Sign-in is optional**.
- When signed in, the app performs **sync/backup** to cloud.

### Cloud Sync (Files)

**Auth contract (backend):**
- Clients call authenticated endpoints with `Authorization: Bearer <firebase_id_token>`.
- Backend verifies Firebase ID tokens and scopes all access by `uid`.

**Storage architecture (shipping direction):**
- **Azure Blob Storage** stores the file bytes at: `u/<firebase_uid>/<name>`.
- **Postgres** stores the authoritative file index + metadata in `user_files`.
  - `firebase_uid`, `name`, `blob_key`, `mtime_ms`, `size_bytes`, `content_type`, `etag`.
- **Flat namespace:** `name` must not contain `/` (no folders/prefixes in v1).
- **Legacy:** the old `files` table is deprecated and should not exist in new DBs.

**Client storage (shipping direction):**
- Android stores *all* user files in a single local folder (`filesDir/scripts/`).
- UI views filter by extension:
  - scripts: `.emw`
  - signals/artifacts: `.raw`, `.txt`

**Sync policy (v1, intentionally simple):**
- List everything every time.
- Compare by filename + `mtime_ms`.
- **Important:** on-device filesystem mtimes may be 1s-resolution. Treat "same second" as equal to avoid endless "cloud newer" prompts.
- Overwrites are **confirmed by the user** (no silent overwrite when both sides changed).
  - if cloud newer → prompt to overwrite local
  - if local newer → prompt to overwrite cloud
- Deletes are **manual** (user-driven): delete modal includes "Also delete from cloud" (default ON when signed in).
- No backcompat/versioning.

### Web Dashboard (Fast Feedback Loop)

We maintain a **Next.js Dashboard** (`/cloud`) as a first-class development surface:
- Account (Firebase login/logout)
- File management (list/view/upload/delete/edit)
- Script UX iteration (web preview/runtime)
- (next) agent + remote sessions surfaces

This dashboard exists to speed iteration without waiting on native app rebuild/release cycles.

### Remote Sessions (Control From Anywhere)

Core idea: **any running EMWaver app instance can be a Host Session**.

- A Host Session is an app that is signed in and running.
- If a USB EMWaver device is attached to that host, it can bridge real hardware.
- Other surfaces can drive a Host Session under the same account:
  - host → host (desktop app controlling another host app)
  - mobile → host
  - web → host

**Note:** hosts can also act as controllers (a host controlling other hosts) by opening an additional WS connection as `role=web` and attaching to another `hostSessionId`.

**Current implementation status (presence + discovery):**
- Backend supports presence via `POST /v1/hosts/heartbeat` and listing via `GET /v1/hosts`.
- **Heartbeats (host presence):** macOS ✅, iOS ✅, Android ✅, Windows ✅.
- **Host list UI:** Web dashboard ✅, macOS ✅, iOS ✅, Android ✅, Windows ✅.
- Frontend/web can **list/manage** hosts, but does **not** act as a host session (no heartbeat).

**Transport direction (control plane):**
- WebSocket from clients to backend.
- Backend routes messages to Host Sessions for the same `uid`.

#### Remote Script Control (Controller ↔ Host) — Initial Architecture

Goal: allow the web dashboard to **fully drive** scripts running on a Host Session with minimal limitations vs native UI.

**Core principle:** the WS transports the **same Script UI contract** used locally:
- Host publishes **UI state changes** (snapshot + incremental patches).
- Remote client publishes **UI interaction events** (generic primitives), addressed to stable node ids.

##### Topology
- `frontend (Next.js)` ⇄ `backend (Flask)` ⇄ `host session (native app)`
- Backend is a **router + authz gate** (no UI semantics). It validates session ownership and forwards frames.

##### WS Concepts
- **Connection**: one WS per signed-in client.
- **Multiplexing**: messages carry `hostSessionId` and `scriptInstanceId` so one WS can control multiple hosts/scripts.
- **Versioning**: first message is `hello`/`capabilities` to negotiate protocol version and optional features.

##### Current Implementation (v1: Web + macOS + Android + iOS + Windows)
Implemented now (controller ⇄ backend ⇄ native host):
- Web dashboard controller ✅
- macOS controller ✅ (RemoteControlClientService.swift)
- Android controller ✅ (RemoteControlClientService.java)
- iOS controller ⏳ (planned)
- Windows controller ⏳ (planned)
- **Backend WS endpoint:** `GET /v1/ws`
  - Browser auth uses `?token=<firebase_id_token>` because the browser WS API cannot set `Authorization` headers.
  - Host sessions also connect outbound to this endpoint.
- **Backend routing model:** in-memory router keyed by `uid` + `hostSessionId`.
  - **Requires a single backend worker** (no cross-worker sharing). Production runs with a WS-capable Gunicorn worker.
  - Host must have heartbeated `hostSessionId` first; backend verifies ownership before accepting `role=host`.
- **Handshake:** first frame must be `hello`:
  - Web: `{type:"hello", role:"web", protocolVersion:1}`
  - Host: `{type:"hello", role:"host", protocolVersion:1, hostSessionId}`
- **Attach/subscribe:** web sends `host.attach {hostSessionId}` (backend acks `host.attached` and forwards attach to host).
- **Run scripts (temporary v1 API):** web sends `script.run {hostSessionId, name, source}`
  - macOS runs via `ScriptPreviewManager` and emits `script.started {scriptInstanceId}`.
  - Android runs via the existing `ScriptsFragment` ScriptEngine path and emits `script.started {scriptInstanceId}`.
  - Note: v1 runs **script source pushed from web** (downloaded from cloud files) instead of referencing host-local script names.
- **UI state (v1):** host emits **`ui.snapshot` only** on each ScriptTree update (rev increments).
  - `ui.patch` / `ui.ack` are planned but not implemented yet.
- **UI events (v1):** web emits `ui.event {scriptInstanceId, targetNodeId, name, payload}`.
  - Host maps `name` to `ScriptEventType` and dispatches to the handler token found on the targeted node.

##### Host UX (Remote Control Indicator)
Native hosts should make it obvious when remote control is active:
- macOS: show a small `Remote` toolbar indicator when `host.attach` has been received; clicking it opens the remote-controlled script UI **in-app** (overlay, not a modal).
- iOS: show a small toolbar indicator when remote control is active; tapping opens an in-app overlay showing the remote-controlled script UI.
- Android: show a small banner on the Scripts preview surface when remote control is active.
- Windows: show a small banner over the Preview pane when remote control is active.
- Hosts persist best-effort: `active_script_name` in heartbeat status, and a local "remote active script name" for quick UX restore.

##### UI State (Host → Remote)
- `ui.snapshot`: full ScriptTree + `rev` (authoritative revision).
- `ui.patch`: incremental updates from `rev` → `rev+1` (replace props, insert/remove/move children, update signal-bound values).
- Remote sends `ui.ack {rev}` so host can drop old deltas / decide to resync.

**Requirements:**
- Every node has a **stable `nodeId`** for the lifetime of a `scriptInstanceId`.
- Patches must be **orderable** and **idempotent** (safe to reapply / ignore if already applied).
- If remote is behind (gap in `rev`), host sends a new `ui.snapshot`.

##### UI Events (Remote → Host)
Remote does **not** send “buttonClicked” only. It sends a small set of **generic interaction primitives** so the transport is not limiting:
- pointer: `pointerDown` / `pointerMove` / `pointerUp` (+ pointerId, buttons, x/y in element-local space)
- scroll: `scroll` (+ dx/dy)
- keyboard: `keyDown` / `keyUp` (+ key, code, modifiers, repeat)
- text: `textInput` plus IME composition (`compositionStart/Update/End`) + selection ranges
- focus: `focus` / `blur`
- semantic helpers (optional): `activate`, `valueChange`

Event envelope:
- `targetNodeId` (required)
- `baseRev` (remote’s last applied UI rev)
- `payload` (event-specific)

Host dispatch:
- Events are injected into the **same ScriptEngine/ScriptSignalStore dispatch path** used by native renderers.
- If `baseRev` is stale, host may best-effort dispatch or request resync (host is authoritative).

##### Optional Geometry (Parity for drags/sliders/canvas)
To preserve “native-feeling” interactions, host may include per-node geometry for interactive nodes:
- `bounds` (x,y,w,h) for hit-testing / coordinate mapping
- geometry is advisory; UI state remains authoritative

##### Reliability / Backpressure
- Throttle high-frequency events (`pointerMove`) client-side.
- Host may respond with `rateLimit` / `busy`.
- Add `ping/pong` and track RTT for UX.

##### Security
- Backend enforces: same `uid`, hostSession ownership, and “allow remote control” (host opt-in).
- Strict schema validation; reject unknown message types; cap message sizes.

### Web UI Runtime (Browser-rendered Script UI)

Direction: the frontend will be able to **render EMWaver script UI in the browser**.

- Styling is web-native; **functional equivalence** is the goal.
- The same script UI/events contract is used by humans, hosts-as-controllers, and agents.
- Later, device I/O and UI events can be routed over Remote Sessions.

### Agent-Controlled Hosts (Tools Plan)

Repo-wide agent prompt (source of truth):
- `AGENT_SYSTEM_PROMPT.md` (used by backend and, later, all host surfaces)

We will add a set of **LLM tools** that let an agent control a Host Session the same way a human does:

#### Core idea

- The agent attaches to a host session (controller role).
- The host runs scripts and publishes UI state (`ui.snapshot` now, `ui.patch` later).
- The agent reads the UI tree, decides what to do, and sends `ui.event` messages.
- This loop continues until a goal is achieved (e.g. “measure a waveform”, “sweep a register”, “dump memory”).

#### Why UI-driven tools (instead of a separate agent API)

- **One contract**: everything funnels through Script UI + events.
- **Human reproducibility**: you can replay what the agent did by performing the same UI interactions.
- **Cross-platform**: same protocol works for web/macOS/Android/iOS/Windows.
- **Safety**: host retains authority (can prompt / deny / require local confirmation for dangerous actions).

#### Proposed tool surface (v1)

Tools are conceptual here; implementation can live in the backend agent runtime or host-local agent, but the wire protocol is the same.

0) `web.fetch(url, options?)`
- Fetches a URL and returns extracted, readable content (text/markdown) + metadata.
- Primary goal: let the agent pull **online hardware databases** (especially **IR remote code databases**) and transform them into fresh, runnable `.emw` scripts (e.g. “emulate this specific remote”).
- Keep it standard and safe: follow redirects conservatively, cap response size, and prefer text extraction over arbitrary binary downloads.

1) `hosts.list`
- Returns available hosts (`hostSessionId`, name, platform, lastSeen, status).

2) `remote.attach(hostSessionId)`
- Establish a controller WS connection and attach.
- Returns an `attachmentId` (multiplex key) and current connection status.

3) `remote.runScript(attachmentId, name, source | cloudFileName)`
- Starts script on host.
- Returns `scriptInstanceId`.

4) `remote.waitForUi(attachmentId, scriptInstanceId, minRev?)`
- Blocks until a new `ui.snapshot` (or patch) arrives.
- Returns `{rev, root, metadata}`.

5) `remote.sendUiEvent(attachmentId, scriptInstanceId, targetNodeId, eventName, payload, baseRev)`
- Sends UI event.
- Returns an ack/result (v1 may just return “sent”; later add explicit `ui.event.ack`).

6) `remote.stopScript(attachmentId, scriptInstanceId)` (optional)

#### UI tree interpretation (agent)

The agent needs a *stable, inspectable representation* of the UI:
- node `id`, `type`, and `props` are the primary semantic surface.
- `handlers` existence is a hint that an element is interactive.
- The agent should not rely on pixel geometry; it should navigate by structure and labels.

We should provide helper utilities:
- `ui.find(root, {type?, label?, text?, propEquals?}) -> nodeId`
- `ui.describe(root) -> compact natural-language summary` (for model context)

#### Event policy

- Prefer **semantic events**: `tap`, `change`, `submit`, `select`.
- Reserve low-level pointer/keyboard events for later.
- Always include `baseRev` so hosts can reject/force resync when stale.

#### Observability (UI-only by default)

We intentionally avoid introducing a separate “console/log/monitor” side-channel for agents.

**Rule:** the agent observes *only what a human would see*:
- the Script UI tree (via `ui.snapshot` / `ui.patch`)
- lifecycle/errors (`script.started`, `script.stopped`, `script.error`)

If a script needs to communicate progress, measurements, or outputs, it should do so through **UI nodes** (text/logViewer/plot/etc.) rendered in the normal Script UI.

(We can add richer streaming later if absolutely necessary, but it should still be representable as UI state to keep the model and product coherent.)

#### Safety & authorization (must-have)

- Backend enforces same `uid` and that the controller is allowed to attach.
- Host can advertise a capability: `allowRemoteControl: true/false`.
- Host can require a local confirmation policy for dangerous actions:
  - e.g. “hardware write”, “DFU flash”, “GPIO drive”, “high voltage enable”.

#### Multi-host orchestration

Agents will frequently coordinate:
- one host connected to hardware ("lab rig")
- another host providing UI/log capture
- plus cloud compute for reasoning

The protocol must support multiple concurrent attachments (multiplexed by hostSessionId and scriptInstanceId).

### Agents as Remote Controllers (UI-driven)

EMWaver’s “final form” is: **an agent can operate real hardware by driving the same script UI that humans drive**.

Agents are **not a separate control path**. They must use the same primitives and transport surfaces humans use:
- attach to a host session
- run scripts
- observe UI + script lifecycle/errors
- emit UI events / parameter changes

This keeps the system debuggable (you can always reproduce an agent action by doing the same UI interactions yourself) and prevents a parallel, untestable “agent-only” API.

Placement is layered:
- **Cloud agent** (high power models) for heavy reasoning and automation.
- **Local-on-host agent** (smaller model) for low latency, offline, privacy-sensitive work.

#### Agent Chat (Backend-backed)

We ship a **basic Agent chat** UI that talks to the backend (same behavior across surfaces):

Backend endpoints (persisted per-user conversations):
- `GET  /v1/agent/conversations`
- `POST /v1/agent/conversations`
- `GET  /v1/agent/conversations/<conversation_id>/messages`
- `POST /v1/agent/chat/stream` (SSE streaming; emits `delta`/`done`/`error` events)

Auth:
- Uses `Authorization: Bearer <firebase_id_token>`.
- If not signed in, chat should prompt for sign-in (no anon chat).

Backend URL config:
- Uses the same backend base URL config as Cloud Sync (`EMWAVER_BACKEND_URL` and platform-specific persisted overrides).

Conversation persistence:
- Apple (macOS/iOS): `UserDefaults` key `emwaver.agent.conversationId`
- Android: `SharedPreferences` key `emwaver.agent.conversationId`
- Windows: `ApplicationData.Current.LocalSettings["emwaver.agent.conversationId"]`

UI placement (by platform):
- **macOS:** Agent chat lives in the **right-side drawer panel** inside `ScriptsRootView` (icon: `sparkles`). Do **not** open Agent chat as a modal.
- **iOS:** Agent chat is presented as a sheet (`sparkles` toolbar button) showing the shared `AgentChatPanelView`.
- **Android:** Agent chat is a bottom sheet (top menu → Agent).
- **Windows:** Agent chat is the right-side Agent pane in `ScriptsPage` (toggled from the toolbar).

### Long-term Hardware Direction: EMArm

We expect a next product tentatively called **EMArm**:
- a machine/rig that an agent can control remotely
- explicitly bridging **high-power hosts + cloud connectivity** to **low-level electronics**
  (modules, sensors, actuators) via USB-connected EMWaver devices.

## Project Structure & Module Organization

STM32 firmware lives in `stm/` (CubeMX/CubeIDE project). Treat CubeMX-generated output as generated code; keep handwritten logic in intended user-edit regions and prefer regeneration over manual edits to generated layers.

Apps live under `android/`, `ios/`, and `macos/`.

## Transport / Buffer Model

EMWaver uses **fixed 64-byte framing** over a USB MIDI SysEx tunnel, with an append-only RX capture and cursor parsing model implemented **natively per-platform** (Swift/Java/C#).

Keep on-wire semantics stable:

- `PACKET_SIZE = 64`
- Binary opcode protocol inside the 64B frames (no command strings)
- status/flow-control frames (e.g. `BS` for retransmit pacing)

### Mini-Frame (Single-Callback) Plan

We are restructuring the USB MIDI SysEx tunnel to be:

- Predictable: 1 USB OUT callback == 1 EMW frame
- Simple: no SysEx accumulation, no multi-transaction decode bursts
- Low CPU/IRQ load: bounded work inside the USB receive callback

Motivation

- The current 128B superframe (2x64 lanes) requires a full SysEx message that typically spans multiple USB bulk OUT transactions.
- That forces the firmware to accumulate SysEx bytes until `0xF7`, then run a large decode/copy burst.
- During retransmit (timed output), this receive-side burst work competes with timer ISR timing and can create glitches.

New on-wire frame (fixed-size)

- Always send exactly 64 USB bytes per OUT transaction.
- This is 16 USB-MIDI event packets (4 bytes each).
- Each event packet carries 3 MIDI bytes => 48 MIDI bytes per transaction.
- Those 48 MIDI bytes are a complete SysEx message (no spanning):
  - `F0 7D 'E' 'M' 'W' <42 encoded bytes> F7`
  - Note: we drop the previous `0x01` version byte to fit cleanly.
- The `<42 encoded bytes>` use the existing 7-bit prefix/MSB scheme.
- 42 encoded bytes decode to 36 raw bytes.
- 36 raw bytes split into two 18-byte lanes:
  - cmd lane: 18 bytes
  - stream/sampler lane: 18 bytes

Behavioral rules

- Firmware RX: single-pass decode directly in the USB MIDI receive callback.
  - No `sysex_buf`, no `sysex_feed_byte`, no `handle_complete_sysex`.
  - If `Len != 64` or header mismatches, ignore the transaction.
- Firmware protocol: all requests/responses must fit within the 18-byte cmd lane.
  - The host is responsible for not sending oversized requests.
  - Firmware does not fragment and does not attempt to “detect/repair” oversize requests.

Throughput target

- Retransmit needs ~100 kbit/s (~12.5 kB/s).
- With an 18-byte stream lane, sending 1 frame per 1ms yields ~18 kB/s (~144 kbit/s), which meets the target.

## Scripts

Scripts are user-authored extension bundles (manifest + EMWaver scripts) that plug into the Script Engine sandbox.

- **Functional parity, native rendering**: the same `.emw` script must be functionally equivalent across Android/iOS/Desktop, but UI is rendered using platform-native controls and platform-default styling. Visual parity is not a goal (and differences are expected).
- **Share core logic when possible**: prefer shared implementation of protocol/buffering/compression (e.g. Rust buffer core), shared `.emw` scripts + bootstrap, and shared DFU/bootloader tooling when feasible, to keep script behavior and device semantics aligned across platforms.
- **Cross-platform semantics**: the Script API and observable runtime behavior must be the same across Android/iOS/Desktop (avoid host-dependent sync/async differences).
- **Sync-only execution**: scripts and the standard library are strictly synchronous across all platforms (no Promises, no `async`/`await`).
- **Unified scripting engine**: ScriptEngine is the single runtime.
- **In-script logging**: scripts surface output through script UI components.

### Apple Desktop Direction (macOS SwiftUI)

We are converging the Desktop experience (starting with macOS) toward a **native-only UI** to avoid WebView overhead and IPC/serialization bottlenecks.

Core motivation:

- WebUI + Rust bridges require cross-boundary transport and often **full UI-tree serialization** (JSON), which becomes a bottleneck for high-frequency UI updates during hardware exploration.

Apple target architecture (mirrors Android/iOS):

- **One process**: SwiftUI renderer + JavaScriptCore runtime + CoreMIDI transport in-process.
- **UI thread owns UI**: all UI updates occur on the SwiftUI main thread.
- **Script worker**: scripts execute off-main; only minimal UI events are marshaled to the main thread.
- **Typed UI model**: avoid JSON UI-tree transport; prefer typed models or small typed “diff” events.
- **Shared Apple code**: keep iOS + macOS parity via Swift packages in `apple/`.

### Windows Desktop Direction (WinUI 3, Windows 11)

We want a **Windows-only, native** desktop app that runs extremely well on **Windows 11**.

Windows target architecture (mirrors Android/iOS/macOS):

- **One process**: WinUI 3 renderer + embedded script runtime + Windows MIDI transport in-process.
- **UI thread owns UI**: UI updates remain on the WinUI dispatcher thread.
- **Script worker**: scripts execute off-UI-thread; only UI events/state deltas are marshaled onto the UI thread.
- **Buffer core implementation**: kept native per-platform; align behavior with comments + tests (TX pacing, `BS` status parsing, sampler bit compression)
- **Transport remains native**: USB MIDI SysEx I/O is implemented with Windows APIs; Rust is used for pure logic only.

## Cross-Cutting Practices

- Keep changes scoped and avoid bundling unrelated work.
- UI across the product (script-rendered UI and “app UI”) should prefer platform-native elements over custom widgets/skins; aim for a purist, default-native look that stays elegant.
- Never commit secrets.
- Prefer ecosystem tooling (Gradle/Xcode/Cargo) for *developer builds*, but do not turn developer build/flash into a product requirement.

## Project Playbooks

### STM32 Firmware (`/stm`)

- **Single firmware**: `stm/emwaver-firmware/` is the only supported device firmware.
- **USB MIDI only**: the transport is class-compliant USB MIDI with the EMWaver SysEx tunnel.
- **End users**: do not document “build from source” as a required workflow.
- **Internal/dev**: DFU may still be used for development/manufacturing, but keep that out of the core product narrative.

#### CubeMX (Optional)

The repo is set up to be **self-contained for firmware builds** (no STM32CubeMX required) by vendoring:
- `stm/emwaver-firmware/Drivers/` (HAL/CMSIS)
- `stm/emwaver-firmware/Middlewares/` (USB Device library)
- `stm/emwaver-firmware/USB_DEVICE/Target/usbd_conf.c/.h` (tracked; not generated on-demand)

Use CubeMX only when you intentionally need to change clocks/pins/peripheral config and regenerate scaffolding.

**Important caveat:** the STM32F0 CubeMX firmware packs don’t expose a “USB MIDI” device class in the UI. Regeneration will typically target classes like CDC/HID and can overwrite USB scaffolding. If you regenerate:
- Expect `USB_DEVICE/*` and `Core/Src/main.c` generated sections to churn.
- You may need to re-apply EMWaver-specific USB MIDI pieces (`USB_DEVICE/App/usbd_midi.*`, registration in `USB_DEVICE/App/usb_device.c`, and MIDI-oriented config in `USB_DEVICE/Target/usbd_conf.*`).
- Keep handwritten logic inside `/* USER CODE BEGIN/END */` blocks; CubeMX will rewrite outside those regions.

### Android (`/android`)

- Native Android app.
- USB transport + Script workflows must stay aligned with iOS and Desktop.

> **Agent Note:** Don’t run Gradle builds unless explicitly requested.

### iOS (`/ios`)

- SwiftUI app using **USB MIDI (CoreMIDI)** transport.
- Treat iOS as first-class: iPhone USB‑C works directly; Lightning works via Apple’s USB host adapter.

> **Agent Note:** Don’t run `xcodebuild`; leave builds to Xcode.

### Windows (`/windows`)

- Native Windows 11 app (WinUI 3).
- Keep the same `.emw` script semantics as Android/iOS/macOS (sync-only).
- USB MIDI SysEx transport is native Windows; buffering/compression/pacing is implemented in managed code.

Windows code map (navigate fast)

Workspace / project

- Solution: `windows/EMWaver.sln`
- App project: `windows/EMWaver/EMWaver.csproj`
  - Bundled scripts are linked from `assets/default-scripts/*.emw` into the app output as `Assets/DefaultScripts/*.emw`.
  - Native DLLs under `windows/EMWaver/Native/*.dll` are copied to the app root (so `DllImport` can find them).

App bootstrap + shell

- Entry: `windows/EMWaver/Program.cs`
- App object: `windows/EMWaver/App.xaml`, `windows/EMWaver/App.xaml.cs`
- Main window + top command bar: `windows/EMWaver/MainWindow.xaml`, `windows/EMWaver/MainWindow.xaml.cs`
  - Hosts the page frame (`ContentFrame`) and wires toolbar state from pages.

Pages

- Scripts (main UX): `windows/EMWaver/Pages/ScriptsPage.xaml`, `windows/EMWaver/Pages/ScriptsPage.xaml.cs`
  - Script list + preview renderer + **plain text editor** (`TextBox` named `EditorBox`).
  - Preview and editor are mutually exclusive (toggle in the page).
- Device: `windows/EMWaver/Pages/DevicePage.xaml`, `windows/EMWaver/Pages/DevicePage.xaml.cs`
- Settings: `windows/EMWaver/Pages/SettingsPage.xaml`, `windows/EMWaver/Pages/SettingsPage.xaml.cs`

Script storage

- Repository: `windows/EMWaver/Services/ScriptRepository.cs`
  - Local scripts dir: `%LocalAppData%\EMWaver\Scripts`
  - Bundled scripts dir (in app output): `Assets/DefaultScripts`
  - Bundled firmware payload (in app output): `Assets/Firmware/emwaver.bin`
  - Bundled scripts are read-only; users can copy them to local.

Scripting runtime + UI renderer

- JS runtime + host bridges: `windows/EMWaver/Scripting/ScriptEngine.cs` (Jint)
- Script UI model: `windows/EMWaver/Scripting/ScriptModel.cs`
- Renderer: `windows/EMWaver/Scripting/Render/ScriptRenderer.cs`
- Plot + helpers: `windows/EMWaver/Scripting/Render/ScriptPlotControl.cs`, `windows/EMWaver/Scripting/Render/ScriptPropParsers.cs`, `windows/EMWaver/Scripting/PlotBufferStore.cs`

Transport / device

- Device manager (high-level): `windows/EMWaver/Services/WindowsDeviceManager.cs`
- USB MIDI SysEx tunnel: `windows/EMWaver/Services/UsbMidiSysex.cs`
- Service singleton wiring: `windows/EMWaver/Services/AppServices.cs`

Firmware update / DFU

- DFU helpers + device-side update flow: `windows/EMWaver/Services/Dfu.cs`
- Update orchestration/state: `windows/EMWaver/Services/FirmwareUpdateManager.cs`
- UI: `windows/EMWaver/Dialogs/FirmwareUpdateDialog.xaml`, `windows/EMWaver/Dialogs/FirmwareUpdateDialog.xaml.cs`

Cloud (auth + files + hosts)

- Cloud feature wiring: `windows/EMWaver/Services/Cloud/CloudAuthManager.cs`, `windows/EMWaver/Services/Cloud/CloudConfig.cs`
- Firebase auth: `windows/EMWaver/Services/Cloud/FirebaseAuthService.cs`
- Google OAuth (PKCE): `windows/EMWaver/Services/Cloud/GoogleOAuthPkce.cs`, `windows/EMWaver/Services/Cloud/PkceUtil.cs`
- Files client: `windows/EMWaver/Services/Cloud/CloudFilesClient.cs`
- Host sessions (presence + list):
  - Heartbeat sender: `windows/EMWaver/Services/Cloud/HostSessionManager.cs`
  - Hosts API client: `windows/EMWaver/Services/Cloud/CloudHostsClient.cs`
  - Hosts UI page: `windows/EMWaver/Pages/HostsPage.xaml`, `windows/EMWaver/Pages/HostsPage.xaml.cs`

Native interop

- Legacy/unused (do not use as product dependency): `windows/EMWaver/Interop/ScintillaWin32.cs`

> **Agent Note:** In this agent environment on Windows, avoid running builds (MSBuild/WinUI XAML compilation). After code changes, wait for the user to build/run locally; this environment frequently hits file locks/permission issues.

### CLI (`/cli`)

- Rust crate/binary (`emw` → `emwaver`) kept intentionally minimal for internal/dev use (not shipped).
- Shared Rust core lives under `crates/`:
  - `crates/emwaver-dfu` (DFU/update helpers)
  - `crates/emwaver-dfu-helper` (macOS bundled helper executable used by the macOS app’s DFU flow)
- Current scope: firmware `build` and DFU `flash` only.

#### Script REPL

Removed (scripts are run via the apps).

### Website (`/frontend`)

- Next.js website.
- This is the only public-facing documentation surface (we no longer ship MkDocs from `docs/`).

#### Hardware pages

- **Order** (`/order`): placeholder UX for device ordering.
  - No vendor branding.
  - **No fabrication/manufacturing artifacts** are published (no Gerbers/BOM/CPL/pick-and-place/case STLs/CAD exports).

## Agent Workflow Guardrails

- Prefer making changes in the working tree first and showing a diff/summary.
- **Do not run builds/tests on your own** (e.g. `./gradlew`, Android Studio builds, `xcodebuild`, MSBuild) unless the user explicitly asks. This environment often can’t build anyway.
- **If you change code, always `git commit` + `git push`** (don’t wait to be asked), unless the user explicitly says not to push (or asks you to keep changes uncommitted).
├─ crates/                                   # Shared Rust crates (dev/internal only)
│  ├─ emwaver-dfu/                            # DFU/update helpers (used by internal CLI)
│  └─ emwaver-dfu-helper/                     # DFU helper binary (bundled in macOS app as `emwaver-dfu-helper`)
