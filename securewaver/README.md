# SecureWaver

Internal **device provisioning** app for EMWaver.

Goal: provide a simple GUI for manufacturing/provisioning steps:
- Generate the offline **Root keypair** (one-time)
- For each device: mint a **DeviceID** and **Proof = Sign_root(DeviceID)**
- Flash firmware and flash `DeviceID+Proof` onto the device via DFU
- (Later) verify cloud gating flows against the backend

> This tool is internal and is not shipped to end users.

## App icon (macOS Dock sizing + transparency)

macOS applies the rounded-corner mask itself (from the app bundle icon), so our source artwork should be **square PNG with alpha**, not pre-rounded.

We also pad the artwork so it doesn’t feel “too big” in the Dock.

- Source artwork (un-padded): `src-tauri/icons/icon-art-512.png`
- Generated padded 1024 master: `src-tauri/app-icon.png` (default scale 0.84)
- Generated bundle icons: `src-tauri/icons/icon.icns`, `src-tauri/icons/icon.png`, etc.

Regenerate:

```bash
cd securewaver
npm run gen:icon
```

To tweak padding, set `ICON_SCALE` (e.g. `ICON_SCALE=0.82 npm run gen:icon`).
