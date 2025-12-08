# EMWaver Transition Plan

_Timestamp: 2025-12-08T16:17:38.335Z_

## Guiding Principles
- **All open source.** Firmware, mobile apps, and desktop app remain public with no proprietary backend.
- **No accounts / no backend.** We rely solely on GitHub (REST API + git) for file transport; no custom cloud service.
- **Git as source of truth.** Wavelet `.js` files and signal assets live in a repository that both phone and desktop apps sync.
- **Faster iteration.** Desktop app provides the rich editor and preview environment so wavelets can be authored/tested locally without phone round-trips.
- **Git-centric workflow.** CLI/desktop app connects directly to hardware; no tethering through mobile app needed.

## High-Level Changes
1. **Remove Agent Fragment/View (LLM Assistant UI)**
   - Drop the Agent fragment/view entirely (the AI LLM assistant UI component) since GitHub-connected editors already provide AI access off-device.
   - Remove from Android: `AgentFragment` and related code.
   - Remove from iOS: `AgentsView`, `AgentService`, `AgentViewModel` and related code.

2. **Remove BLE File Sync**
   - Delete BLE file-sync server/client code paths from Android/iOS and CLI.
   - Remove CLI sync commands (`emwaver sync`, `emwaver clone`, `emwaver push`, `emwaver pull`, etc.).
   - Remove BLE file sync service/characteristics from mobile apps.
   - Simplify mobile apps to operate purely on local storage plus GitHub repo sync.

3. **Introduce Git Fragment on Mobile**
   - New UI section dedicated to cloning/pulling/pushing a configured GitHub repo containing wavelet assets.
   - Use GitHub REST API (token-based) for authentication and operations; no backend relay.
   - Provide status indicators, conflict warnings, and manual refresh controls.

4. **Reposition Desktop App**
   - Rename `ide/` to `app/` to reflect that it's the EMWaver app on desktop.
   - Desktop app mirrors all mobile views/fragments (same UI components as Android/iOS) but clones the repo locally and adds advanced editing + preview tools.
   - Dedicated to wavelet authoring/testing and hardware interaction.

5. **Wavelet Workflow**
   - Desktop app becomes primary authoring environment with live preview.
   - Changes committed/pushed to GitHub; mobile apps pull when needed (e.g., to run wavelets on hardware).
   - Phones can still edit via lightweight editors (Codex, mobile IDEs) by committing directly to GitHub when away from desktop.

## Immediate Tasks
1. **Remove Agent Fragment/View**
   - Remove `AgentFragment` and related UI code from Android.
   - Remove `AgentsView`, `AgentService`, `AgentViewModel` from iOS.
   - Remove navigation items and menu entries referencing Agent.

2. **Remove BLE File Sync**
   - Remove CLI sync commands and related BLE services from Android/iOS.
   - Remove file sync BLE characteristics and service UUIDs.
   - Update documentation to reflect Git-based workflow.

3. **Desktop App Restructure**
   - Rename `ide/` folder to `app/`.
   - Port all mobile views/fragments to desktop (wavelets, IR, sampler, Git fragment, etc.).
   - Audit dependencies; ensure build targets macOS/Windows/Linux with unified UI (likely leveraging existing framework).

4. **Git Fragment Implementation**
   - Design UI/UX for repo setup (token entry, repo selection).
   - Implement git operations via REST or JGit/libgit2 depending on platform.
   - Ensure offline cache and conflict resolution messaging.

5. **Wavelet Preview Improvements**
   - Port mobile preview components to desktop.
   - Enhance editor (syntax highlighting, linting, templates).

6. **Docs & Migration Guide**
   - Provide step-by-step instructions for configuring GitHub access on both desktop and mobile apps.
   - Document Git-based workflow for wavelet development.

## Open Questions
- Preferred git implementation per platform (REST-only vs. embedded git client).
- Token management UX (per-device storage, revocation).
- Handling large binary assets (signals) within git (LFS? compression?).

---
This plan establishes a Git-centric workflow that enables fully open-source, account-free operation across desktop and mobile environments.
