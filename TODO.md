# EMWaver Runtime Extensions TODO

## Naming & Vocabulary
- **Wavelet**: user-authored module bundle (manifest + JavaScript) that extends EMWaver.
- **Wavelet Engine**: sandbox runtime inside the native apps that loads, validates, and executes Wavelets.
- **EMWaver Script SDK**: JavaScript API surface exposed to Wavelets (BLE control, logging, storage, timers).
- **EMWaver UI DSL**: declarative primitives (`UI.column`, `UI.button`, etc.) that Wavelets use to describe native UI.

## Proof-of-Concept Scope
- Target screen: upgrade existing Console view with a "Render UI" tab that evaluates a Wavelet.
- Minimum widgets: `column`, `row`, `text`, `button`, `slider`, `logViewer`.
- Sample script:
  ```js
  const root = UI.column({
    children: [
      UI.button({ label: "Pulse LED", onTap: () => Firmware.send("led/pulse") }),
      UI.logViewer({ source: Firmware.logs })
    ]
  });
  UI.render(root);
  ```
- Bridge plan: translate DSL nodes to native components (SwiftUI/Compose), diff updates, marshal callbacks safely.
- Sandbox rules: expose only scoped APIs, run JS off main thread, enforce timeouts, keep modules viewable/editable.
- Packaging format draft: single `wavelet.js` file (metadata via header comment or inline object). Add optional manifest/signing only after the core flow proves out.
- Initial app integration: bundle a default Wavelet script in app assets, let Console view load it in-memory, and prompt the user to register it as a Wavelet that appears in the sidebar/navigation.

## Fragment/Wavelet Strategy
- Keep **Home** fragment native (static buttons, landing UX).
- Keep **Console** fragment native but enhance it to manage Wavelets: existing console tab plus a "Wavelets" tab for loading/activating Wavelet fragments.
- Keep **Sampler** fragment native (depends heavily on MPAndroidChart; complex charting stays in-core).
- Defer **Buttons** fragment (JSON-driven, needs separate design).
- First conversion targets:
  1. **RFID** fragment → Wavelet (simple UI + BLE commands).
  2. **ISM** fragment → Wavelet (similar pattern, next after RFID).
- Goal: each Wavelet occupies a dedicated fragment/screen managed by the host.

## Open Questions
- Define permissions per Wavelet (BLE, storage, network) and verification flow.
- Plan moderation + update channel for third-party Wavelets.
- Document CLI tooling (`emwaver wavelet build`, `emwaver wavelet push`).
- Determine UX for selecting/activating Wavelets and fallbacks when none are installed.
- Stand up a managed backend proxy for OpenAI usage with per-user auth, rate limits (5h / weekly caps), and app-issued tokens so API keys never ship in the APK; migrate Android client to that layer and drop direct curl usage.

## Next-Gen Runtime Goals
- **Capability Graph**: expose all firmware bridges (BLE, IR, CC1101), sandbox filesystem, network client, diagnostics, and task runners through a unified capability registry that Wavelets and AI agents can invoke without bespoke bindings.
- **Sandboxed Filesystem & Data Providers**: provide scoped storage APIs so scripts can persist captured signals, read/write payloads, and access datasets (e.g., IR libraries) via capability providers instead of hard-coded databases.
- **Diagnostics Bus & Console**: deliver structured logs/warnings/errors from Wavelet execution into an in-app console with metadata that LLM tooling can consume for automated debugging.
- **Hot Reload Pipeline**: enable fast Wavelet reloads while preserving hardware sessions when safe, to support on-the-fly edits from desktop tooling or AI-generated scripts.
- **Security Sandbox**: enforce per-capability permissions and policy hooks to keep the expanded runtime safe while still feeling like a “Wavelet OS.”

## UI/UX Overhaul
- Replace the Buttons fragment with an AI-powered Wavelet workbench that:
  - Provides a chat-centric interface for generating/editing Wavelet scripts (e.g., IR remotes) via the capability layer.
  - Streams diagnostics and diff previews, and coordinates with a cloud code-interpreter when heavy signal analysis is required.
- Redesign the Wavelets fragment so it’s a browsing surface:
  - Tap opens the Wavelet preview only.
  - Long-press surfaces a dialog with source code and advanced actions (no inline editing).

