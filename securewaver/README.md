# SecureWaver (`/securewaver`)

Internal provisioning desktop app for EMWaver manufacturing/service flows.

SecureWaver is **not** a consumer app. It is an internal tool used to:
- validate device authenticity,
- mint/attach identity materials through backend provisioning flow,
- flash/update firmware in DFU update mode,
- preserve or restore identity page during updates.

---

## 1) Purpose and boundaries

SecureWaver exists to operationalize the EMWaver anti-cloning/authenticity strategy.

### In scope
- Detect EMWaver in run mode (USB MIDI) and update mode (DFU).
- Verify authenticity from either:
  - run mode identity opcode path, or
  - update mode identity page read path.
- Request transition to update mode from run mode.
- Flash firmware in update mode.
- Write identity blob (`DeviceID + Proof`) to dedicated flash page.
- Update while preserving existing identity page.
- Operator sign-in (Google/Firebase) and session persistence.

### Out of scope
- End-user runtime features.
- Public app-store distribution usage.
- Replacing backend authority for minting policy.

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

## 3) Security and authenticity model in app

SecureWaver consumes (does not define) the authenticity model:

- device stores `DeviceID(16B)` + `Proof(64B signature)` in flash identity page,
- proof is verified against root public key,
- minting requires backend policy gates.

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
1. ensure operator is signed in,
2. call backend `/provisioning/mint` with bearer ID token,
3. receive `{device_id_b64, proof_b64}`,
4. open DFU device,
5. flash firmware (mass erase implied),
6. write identity page after flashing,
7. emit progress to UI via `emw_flash_progress` events.

Minting is backend-authoritative and policy-gated.

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

UI labels status as certified/non-certified based on verification result.

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
