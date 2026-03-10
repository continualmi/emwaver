# SecureWaver (`/securewaver`)

Device minting and provisioning desktop app for the EMWaver platform (a **Continuous ML** project).

SecureWaver is the tool used to activate (mint) supported MCU boards as EMWaver devices. It handles:
- paid device minting through backend provisioning flow (DeviceID + Proof),
- firmware flashing in DFU update mode,
- device authenticity verification,
- firmware updates while preserving device identity.

**This tool is being retired.** Minting, firmware flashing, and device activation flows are being embedded directly into the main EMWaver apps (Windows, Android, macOS). Once migration is complete, this folder will be deleted. The backend minting API and device trust model remain unchanged — only the client surface moves.

---

## 1) Purpose and boundaries

SecureWaver operationalizes the EMWaver device trust model — minting is the activation gate for platform access.

### In scope
- Detect supported boards in run mode (USB MIDI) and update mode (DFU).
- Verify authenticity from either:
  - run mode identity opcode path, or
  - update mode identity page read path.
- Request transition to update mode from run mode.
- Flash firmware for the detected board target in update mode.
- Write identity blob (`DeviceID + Proof`) to dedicated flash page.
- Update while preserving existing identity page.
- Operator/user sign-in (Google/Firebase) and session persistence.

### Out of scope
- End-user runtime features (scripts, UI, AI — those live in the main apps).
- Replacing backend authority for minting policy and payment verification.

---

## 2) Stack and layout

## 2.1 Stack

- Tauri v2 desktop app
- Rust backend (`src-tauri/src/*.rs`)
- React + Vite UI (`src/ui/App.tsx`)

## 2.2 Structure

- `src-tauri/src/main.rs` — main command surface + app bootstrap.
- `src-tauri/src/legit_check.rs` — authenticity checks.
- `src-tauri/src/update_mode*.rs` — DFU/update-mode operations.
- `src-tauri/src/usb_midi_sysex.rs` — run-mode USB MIDI SysEx interactions.
- `src-tauri/src/auth_google.rs` — Google/Firebase sign-in flow.
- `src-tauri/src/session_store.rs` — persisted auth session.
- `src/ui/App.tsx` — operator UI flows.

---

## 3) Device trust model in app

SecureWaver consumes (does not define) the trust model:

- Maintain a single **global Root private key** (offline, kept by owner). This Root key is never shipped in apps.
- Apps/backend ship/use the corresponding Root public key for verification.

- device stores `DeviceID(16B)` + `Proof(64B signature)` in flash identity page,
- proof is verified against root public key,
- minting requires backend policy gates (payment verification, rate limits).

### 3.1 Identity page format

Constructed in Rust `build_identity_page(...)`.

Current layout:
- bytes `[0..4]` magic `EMID`
- `[4]` version `1`
- `[5]` device_id_len (`16`)
- `[6]` proof_len (`64`)
- `[7..15]` reserved
- `[16..]` device id then proof bytes

Default identity page address:
- `0x08007800` (single 1KB page design)

---

## 4) Main Tauri commands (Rust)

Exposed from `main.rs` via `invoke_handler`:

Detection and legitimacy:
- `detect_device`
- `check_device_legit_run_mode`
- `check_device_legit_update_mode`
- `request_enter_update_mode`
- `update_mode_detect`

Provision/update:
- `dfu_provision_device`
- `update_device_preserve_identity`

Auth/session:
- `auth_session_get`
- `auth_session_clear`
- `auth_google_sign_in`
- `auth_firebase_refresh`

---

## 5) Provisioning flow

## 5.1 Mint + provision path

UI flow (`App.tsx`) does:
1. ensure user is signed in,
2. call backend `/provisioning/mint` with bearer ID token (payment-gated),
3. receive `{device_id_b64, proof_b64}`,
4. open DFU device,
5. flash firmware for the target board (mass erase implied),
6. write identity page after flashing,
7. emit progress to UI via `emw_flash_progress` events.

Minting is backend-authoritative, payment-gated, and rate-limited.

## 5.2 Update preserving identity

`update_device_preserve_identity` path:
1. read existing identity page from device,
2. refuse update if identity header missing,
3. flash firmware,
4. restore identity page,
5. return success with restored flag.

This protects previously provisioned devices from losing identity on firmware updates.

---

## 6) Device authenticity checks

Two verification paths are surfaced:

1. **Run mode check**
   - uses identity opcode over USB MIDI transport,
   - reads DeviceID and Proof from running firmware.

2. **Update mode check**
   - reads identity page through DFU upload path,
   - verifies same cryptographic proof semantics.

UI labels status as minted/unminted based on verification result.

---

## 7) Operator authentication

Sign-in is Google + Firebase based.

- Rust side obtains session tokens.
- Session persisted in local store (so relaunch can restore state).
- Refresh token flow supported via Firebase securetoken endpoint.
- UI allows backend target selection (production/local) for provisioning API.

Primary envs consumed on auth path:
- `EMWAVER_GOOGLE_CLIENT_ID`
- `EMWAVER_GOOGLE_CLIENT_SECRET`
- `EMWAVER_FIREBASE_WEB_API_KEY`

---

## 8) Firmware source used by SecureWaver

Provision/update commands support:
- bundled firmware payload (`include_bytes!("../../../firmware/emwaver.bin")`), or
- operator-selected custom `.bin`.

UI exposes toggle for bundled vs custom firmware.

---

## 9) UX notes

Current UI (`src/ui/App.tsx`) includes:
- connection panel (run/update mode detection),
- verify certified-original actions,
- enter-update-mode action,
- update-device action,
- mint+provision action,
- progress modal with percent/log lines,
- settings page for backend target mode.

---

## 10) App icon notes

Icon generation pipeline is intentionally documented and scriptable.

Source + generated artifacts:
- source artwork: `src-tauri/icons/icon-art-512.png`
- padded master: `src-tauri/app-icon.png`
- generated bundle icons in `src-tauri/icons/`

Regenerate:

```bash
cd securewaver
npm run gen:icon
```

Optional scaling tweak:

```bash
ICON_SCALE=0.82 npm run gen:icon
```

---

## 11) Local development

From repo root:

```bash
cd securewaver
npm install
npm run tauri dev
```

For UI-only iteration:

```bash
npm run dev
```

(Full provisioning functionality needs compatible hardware + DFU access + backend/auth env config.)

---

## 12) Contributor guardrails

1. Never move minting trust decisions from backend into client-side-only checks.
2. Keep identity page layout in sync with firmware reader expectations.
3. Treat firmware flashing as destructive unless explicitly preserving identity.
4. Keep legitimacy verification messaging clear (transport + verification method).
5. Update this README whenever command surface or provisioning/auth flow changes.
