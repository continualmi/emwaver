# EMWaver Documentation Cleanup Audit

This is a first-pass list of stale or inconsistent documentation found during the open-source README cleanup. It is intentionally an audit, not the cleanup itself.

## Highest-priority inconsistencies

### 1. `.jsx` is described as a separate script type

Current direction: JSX-style UI is part of JavaScript script authoring. Public docs should not imply that `.jsx` is a separate required script format unless the apps truly support/import separate `.jsx` files as first-class user scripts.

Flagged locations:

- `README.md`
  - says "JavaScript or JSX-style scripts"
  - lists "local JavaScript and JSX-style scripts (`.js`, `.jsx`)"
- `docs/PLANNING.md`
  - says "one `.js`/`.jsx` script surface"
- `docs/CROSS_PLATFORM_AGENT_UI_MIGRATION_PLAN.html`
  - repeatedly presents `.js` and `.jsx` as separate script assets/surfaces
- `docs/AGENT_RUNTIME_AND_TOOLS.html`
  - describes scripts using JSX-style UI and imports; likely okay conceptually, but should avoid implying a separate `.jsx` user format if the canonical file extension is `.js`
- `docs/JSX_UI_MIGRATION_PLAN.html`
  - older migration wording around JSX and `.emw` needs reconciliation with the current `.js` runtime
- `web/app/emwaver/docs/scripts/page.tsx`
  - says JSX/import smoke test and talks about UI snapshot contract
- `web/app/emwaver/docs/install/page.tsx`
  - says "create your own JSX-based `.js` file"; this is closer to correct, but should align with final wording
- `apple/README.md`
  - describes `ScriptJSXTranspiler` and JSX subset; likely still useful implementation detail but should clarify user-facing format
- `android/README.md`
  - describes JSX subset used by Android; likely still useful implementation detail

Suggested public wording:

> EMWaver scripts are JavaScript files. Scripts can use JSX-style UI syntax to define native control panels for connected modules.

### 2. UI snapshots are still presented as the Agent/control model

Current direction: the Agent should use named hardware primitives such as `spi_transfer`, GPIO read/write, analog read, and module probes. UI rendering is still valuable for user interfaces, but Agent hardware work should not be framed as screen-reading snapshots or clicking UI events.

Flagged locations:

- `docs/TESTS.md`
  - first paragraph still describes `ui.snapshot`, `ui.event`, `.emw`, CLI, and Gateway as the target hardware automation bench
  - tests `006`, `007`, `008`, `009` still assume CLI/Gateway and snapshot/event flows
- `docs/TRANSPORT_SESSION_ISOLATION_PLAN.md`
  - says "Per-script UI snapshots and event routing"
  - Gateway-based session model
- `docs/MACOS_MULTI_DEVICE_PLAN.md`
  - references UI snapshots/logs/device status and Gateway/CLI orchestration
- `docs/MACOS_SCRIPT_SESSIONS_UI.md`
  - macOS-first session/UI plan still mentions Gateway/browser scope and older snapshot concepts
- `docs/JSX_UI_MIGRATION_PLAN.html`
  - describes snapshots as runtime protocol/test contract
- `web/app/emwaver/docs/scripts/page.tsx`
  - has a "Timing and UI snapshots" section and says Agent/CLI/browser/native automation should inspect rendered UI snapshots
- `docs/AGENT_EVAL_RUNTIME.md`
  - this one is mostly a corrective doc saying snapshot/event/eval were removed; should be kept or summarized, but cross-linked from stale docs
- `docs/AGENT_RUNTIME_AND_TOOLS.html`
  - correctly says no Agent hardware work through UI snapshots, button clicking, or arbitrary JS eval; should become the canonical Agent wording

Suggested direction:

- Keep UI tree/snapshot language only as an internal renderer/debug/test concept.
- Public Agent docs should emphasize direct primitive tools and module probing.
- User-facing scripting docs should emphasize instant native UI panels from JS, not snapshot protocols.

### 3. Gateway/CLI references remain in active docs

Current direction: native apps own their runtime. The old Gateway/CLI/browser architecture is archived. Linux is being rebuilt as a native app, not a Gateway revival.

Flagged active docs:

- `docs/CURRENT.md`
  - says Gateway/CLI/Linux were removed, then also says Linux is being revisited; okay historically, but confusing for public orientation
  - says Windows is deferred past V1, which is now stale if Windows has been tested and is in active release shape
- `docs/ESP32_WIFI_TRANSPORT_PLAN.md`
  - opens with `CLI/browser -> Gateway -> ESP32 Wi-Fi endpoint`
  - has a full "Gateway Contract" section
- `docs/ESP32_WIFI_REMOTE_ACCESS.md`
  - uses "EMWaver app or Gateway"
  - gives `emwaver gateway serve --wifi ...` and `emwaver run ...` examples
- `docs/ESP32_WIFI_TRANSPORT_AUDIT.md`
  - still audits Gateway Wi-Fi transport
- `docs/ESP32_LAN_OTA_PLAN.md`
  - says Gateway may later expose a terminal/browser OTA helper
- `docs/TESTS.md`
  - CLI/Gateway-centered test bench
- `docs/TRANSPORT_SESSION_ISOLATION_PLAN.md`
  - Gateway session architecture
- `docs/MACOS_MULTI_DEVICE_PLAN.md`
  - multiple Gateway/CLI orchestration sections
- `macos/README.md`
  - has a "Gateway boundary" section saying browser/CLI use the Rust Gateway backend
  - says keep remote-control protocol aligned with localhost gateway
- `docs/MGPT_UNIVERSE_AGENT_PLAN.md`
  - says Browser Gateway Agent tooling should be implemented if reintroduced

Archived docs can keep Gateway history, but active docs should either be updated or moved to `docs/archive/`.

### 4. Windows status is inconsistent

Current direction from recent validation: Windows app was tested with `cc1101.js` and can read/write registers. Public docs should not say Windows is deferred unless it is still intentionally non-release.

Flagged locations:

- `docs/CURRENT.md`
  - says Windows is deferred past V1
- `docs/PLANNING.md`
  - says Windows is deferred past V1 and requires a separate Windows toolchain
- `docs/WINUI_TO_WPF_MIGRATION.html`
  - says update planning to note Windows is now WPF, no longer deferred
- `README.md`
  - now lists Windows as active, which conflicts with the two planning docs above

Suggested direction:

- Update `docs/CURRENT.md` and `docs/PLANNING.md` to reflect Windows as an active native app with validation status.
- Keep toolchain limitations as contributor notes, not product status.

### 5. Linux status is inconsistent across docs

Current direction: Linux app port is active/in progress as native Rust + GTK4/libadwaita.

Flagged locations:

- `README.md`
  - says Linux is in progress
- `docs/CURRENT.md`
  - says prior Linux support was removed and Linux is being revisited as native app; mostly okay but reads as contradictory
- `docs/DROP_GATEWAY_AND_LINUX.md`
  - says Linux is not supported; historically correct, but stale if linked as current without context
- `docs/PLANNING.md`
  - says Linux is candidate plan / after V1 mobile work, maybe stale if the port is active now
- `web/app/emwaver/docs/install/page.tsx`
  - says Linux packaging is planned after V1 mobile launch and Linux is coming soon after V1
- `web/app/emwaver/install/page.tsx`
  - has "Linux coming soon" in install chips
- `docs/LINUX_GTK4_PORT_PLAN.html`
  - strong current native app plan; likely should become canonical

Suggested direction:

- Make `docs/LINUX_GTK4_PORT_PLAN.html` the canonical Linux direction.
- Add a short note to `docs/DROP_GATEWAY_AND_LINUX.md` that it is a historical removal record, not the current Linux-app status.

### 6. Public docs still use internal/business wording

The public README has been improved, but several docs still contain internal strategy wording that may be wrong tone for open source.

Flagged locations:

- `docs/CURRENT.md`
  - "Paid Agent API is optional and is the primary business model"
- `docs/LINUX_GTK4_PORT_PLAN.html`
  - card labeled "Business"
- `docs/AGENT_API.md`
  - contains product/business/API boundary details that may be useful but should be separated from public user docs
- `docs/MGPT_UNIVERSE_AGENT_PLAN.md`
  - heavy MGPT/MDL implementation boundary language; may be internal architecture rather than public docs
- `ios/README.md`, `macos/README.md`, `apple/README.md`
  - mention MDL-only `/backend-api/...` routes; okay for contributor docs, but not user-facing docs

Suggested direction:

- Keep public docs focused on capabilities and local-first behavior.
- Move internal backend boundary notes into contributor/internal docs if needed.

### 7. Defensive cloud/relay/account wording is repeated heavily

Some local-first explanation is important, but public docs can sound defensive when they repeatedly mention cloud activation, hosted relay, subscription checks, device ownership, etc.

Flagged locations include:

- `docs/CURRENT.md`
- `docs/ESP32_WIFI_TRANSPORT_PLAN.md`
- `docs/ESP32_WIFI_REMOTE_ACCESS.md`
- `docs/PLANNING.md`
- `docs/TESTS.md`
- `docs/LINUX_GTK4_PORT_PLAN.html`
- `macos/README.md`
- `android/README.md`
- `README.md` contribution section

Suggested direction:

- Public phrasing: "scripts and hardware control run locally by default."
- Contributor guardrail phrasing can remain stricter in `AGENTS.md` and subsystem READMEs.

### 8. Website docs have stale install/status details

Flagged locations:

- `web/app/emwaver/docs/page.tsx`
  - says Android through Google Play internal test/APK, macOS DMG, Windows preview EXE/ZIP; likely okay but should be checked against current install reality
- `web/app/emwaver/docs/install/page.tsx`
  - says Linux after V1 / coming soon after V1
  - says JSX-based `.js`, probably okay after final wording pass
- `web/app/emwaver/install/page.tsx`
  - install chip list includes Linux coming soon; check against active Linux port status
- `web/app/emwaver/docs/scripts/page.tsx`
  - most stale script model page: JSX imports, UI snapshot contract, Agent/CLI/browser automation through snapshots
- `web/app/emwaver/docs/hardware/pinout/page.tsx`
  - has "Pinout coming soon" placeholders; check if hardware folders now have enough pinout detail to replace this

### 9. Archived docs are okay but need clearer separation

Files under `docs/archive/` are expected to contain old Gateway, Rebirth, `.emw`, packaging, and launch planning language. The issue is not their content; the issue is when active docs link to them as if they are current.

Archived files with intentionally stale language:

- `docs/archive/REBIRTH.md`
- `docs/archive/LAUNCH_MVP.md`
- `docs/archive/PACKAGING.md`
- `docs/archive/TESTS_REBIRTH.md`
- `docs/archive/UI_SNAPSHOT_RUNTIME_MIGRATION.md`
- `docs/archive/REBIRTH_AUDIT.md`
- `docs/archive/REBIRTH_ISSUES.md`

Suggested direction:

- Add/verify an archive README warning that archived docs are historical.
- Avoid linking archived docs from public quick-start paths.

## Suggested cleanup order

1. Fix public-facing docs first:
   - `README.md`
   - `web/app/emwaver/docs/scripts/page.tsx`
   - `web/app/emwaver/docs/install/page.tsx`
   - `web/app/emwaver/docs/page.tsx`
2. Fix orientation/planning docs:
   - `docs/CURRENT.md`
   - `docs/PLANNING.md`
   - `docs/SCHEDULE.md`
3. Replace Gateway-centered Wi-Fi docs with native-app Wi-Fi docs:
   - `docs/ESP32_WIFI_TRANSPORT_PLAN.md`
   - `docs/ESP32_WIFI_REMOTE_ACCESS.md`
   - `docs/ESP32_WIFI_TRANSPORT_AUDIT.md`
4. Replace snapshot/CLI test suite with native-app + Agent primitive tooling tests:
   - `docs/TESTS.md`
   - `docs/AGENT_EVAL_RUNTIME.md`
   - `docs/AGENT_RUNTIME_AND_TOOLS.html`
5. Clean platform READMEs:
   - `macos/README.md`
   - `apple/README.md`
   - `android/README.md`
   - `ios/README.md`
   - `windows/README.md`
6. Move or relabel stale planning docs that are no longer active:
   - `docs/TRANSPORT_SESSION_ISOLATION_PLAN.md`
   - `docs/MACOS_MULTI_DEVICE_PLAN.md`
   - `docs/MACOS_SCRIPT_SESSIONS_UI.md`
   - `docs/JSX_UI_MIGRATION_PLAN.html`
   - `docs/CROSS_PLATFORM_AGENT_UI_MIGRATION_PLAN.html`

## Canonical wording candidates

### Scripts

> EMWaver scripts are JavaScript files. Scripts can call hardware primitives directly and can use JSX-style UI syntax to create instant native panels for connected modules.

### Agent

> When enabled, the Agent can use the same hardware interface exposed to scripts: SPI transfers, GPIO reads/writes, analog reads, and module probes. It can inspect connected hardware, debug wiring and protocol failures, and help generate script/UI panels.

### Transports

> EMWaver supports USB, BLE, and Wi-Fi transports depending on the board. USB-C gives direct plug-in control, BLE supports cable-free mobile use, and Wi-Fi supports LAN/VPN-style remote control for boards designed around it.

### Hardware

> EMWaver is a family of open hardware designs and native apps, not one fixed device. The hardware folder contains multiple board designs for compact USB-C control, sub-GHz radio, infrared, GPIO, RFID, and ESP32-S3 wireless workflows.
