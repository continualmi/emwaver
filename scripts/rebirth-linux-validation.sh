#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== EMWaver rebirth Linux validation =="
echo "repo: $ROOT"
echo

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "warning: this runbook is intended for Linux; current system is $(uname -s)" >&2
fi

echo "== Host diagnostics =="
echo "kernel: $(uname -srmo)"
if command -v groups >/dev/null 2>&1; then
  echo "groups: $(groups)"
fi

echo
echo "== MIDI/USB diagnostics =="
if command -v aconnect >/dev/null 2>&1; then
  aconnect -l || true
else
  echo "missing: aconnect (install alsa-utils for ALSA MIDI diagnostics)"
fi

if command -v lsusb >/dev/null 2>&1; then
  lsusb || true
else
  echo "missing: lsusb (install usbutils for USB diagnostics)"
fi

if [[ -e /dev/snd/seq ]]; then
  echo "ok: /dev/snd/seq exists"
else
  echo "missing: /dev/snd/seq (ALSA sequencer unavailable; load snd-seq or check container/device permissions)"
fi

echo
echo "== Bluetooth diagnostics =="
if command -v bluetoothctl >/dev/null 2>&1; then
  bluetoothctl show || true
else
  echo "missing: bluetoothctl (install bluez for BLE diagnostics)"
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl is-active bluetooth || true
else
  echo "missing: systemctl"
fi

echo
echo "== Generic rebirth hardware validation =="
"$ROOT/scripts/rebirth-hardware-validation.sh"

cat <<'EOF'

== Linux permission notes ==
If the board is visible to `lsusb` but not to `emwaver devices`:

1. Install ALSA MIDI tools:
   sudo apt-get install alsa-utils libasound2-dev

2. Make sure the ALSA sequencer exists:
   sudo modprobe snd-seq

3. Check user/device permissions. Depending on distro and board mode, the user may need membership in groups such as `audio`, `plugdev`, or `dialout`, followed by a logout/login.

4. Rerun with the selected MIDI device id:
   EMWAVER_DEVICE_ID=0 scripts/rebirth-linux-validation.sh

For BLE:

1. Install BlueZ tools:
   sudo apt-get install bluez

2. Confirm the Bluetooth service is running:
   systemctl status bluetooth

3. Confirm EMWaver can scan:
   cd daemon && cargo run -q -p emwaver -- devices

4. Run through the BLE transport:
   EMWAVER_HARDWARE_TRANSPORT=ble scripts/rebirth-linux-validation.sh
EOF
