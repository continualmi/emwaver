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
- Packaging format draft: `wavelet.json` manifest + `main.js`; later add signing, repo sync, sharing UX.

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
