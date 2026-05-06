#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAEMON_DIR="$ROOT/daemon"
GATEWAY_DIR="$ROOT/gateway"
GATEWAY_SIM_PORT="${EMWAVER_LINUX_GATEWAY_SIM_PORT:-3944}"
GATEWAY_HARDWARE_PORT="${EMWAVER_LINUX_GATEWAY_HARDWARE_PORT:-3945}"
GATEWAY_SERVICE_PORT="${EMWAVER_LINUX_GATEWAY_SERVICE_PORT:-3946}"
HARDWARE_TRANSPORT="${EMWAVER_HARDWARE_TRANSPORT:-usb}"
SCRIPT_PATH="${EMWAVER_TEST_SCRIPT:-$ROOT/assets/default-scripts/blink.emw}"
if [[ "$SCRIPT_PATH" != /* ]]; then
  SCRIPT_PATH="$ROOT/$SCRIPT_PATH"
fi
GATEWAY_EVENT_TARGET_ID="${EMWAVER_GATEWAY_EVENT_TARGET_ID:-blink.toggle}"

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

echo
echo "== Gateway daemon simulator validation =="
EMWAVER_GATEWAY_PORT="$GATEWAY_SIM_PORT" EMWAVER_GATEWAY_DAEMON_SIM_MODE=fallback "$ROOT/scripts/rebirth-gateway-daemon-sim-validation.sh"

run_systemd_user_service_validation() {
  local gateway_log
  gateway_log="$(mktemp /tmp/emwaver-linux-systemd-gateway.XXXXXX.log)"
  local state_dir
  state_dir="$(mktemp -d /tmp/emwaver-linux-systemd-state.XXXXXX)"
  local gateway_pid=""
  export EMWAVER_STATE_DIR="$state_dir"

  cleanup_systemd_user_service() {
    set +e
    (cd "$DAEMON_DIR" && cargo run -q -p emwaver -- service uninstall >/dev/null 2>&1 || true)
    if [[ -n "$gateway_pid" ]] && kill -0 "$gateway_pid" >/dev/null 2>&1; then
      kill "$gateway_pid" >/dev/null 2>&1 || true
      wait "$gateway_pid" >/dev/null 2>&1 || true
    fi
    rm -f "$gateway_log"
    rm -rf "$state_dir"
    unset EMWAVER_STATE_DIR
  }
  trap cleanup_systemd_user_service RETURN

  (cd "$GATEWAY_DIR" && EMWAVER_GATEWAY_PORT="$GATEWAY_SERVICE_PORT" npm run start:built >"$gateway_log" 2>&1) &
  gateway_pid=$!

  for _ in {1..80}; do
    if curl -fsS "http://127.0.0.1:$GATEWAY_SERVICE_PORT/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done

  curl -fsS "http://127.0.0.1:$GATEWAY_SERVICE_PORT/health"
  echo
  (cd "$DAEMON_DIR" && cargo run -q -p emwaver -- service install --port "$GATEWAY_SERVICE_PORT" --sim-device --now)

  node "$ROOT/scripts/verify-gateway-daemon-render.mjs" "$GATEWAY_SERVICE_PORT" emwaver-daemon
  (cd "$DAEMON_DIR" && cargo run -q -p emwaver -- service uninstall)
}

echo
echo "== Linux systemd user service validation =="
(cd "$DAEMON_DIR" && cargo run -q -p emwaver -- service print-unit --port "$GATEWAY_SIM_PORT" --sim-device >/tmp/emwaver-daemon.service)
grep -F "emwaver daemon serve" /tmp/emwaver-daemon.service >/dev/null
grep -F -- "--sim-device" /tmp/emwaver-daemon.service >/dev/null
grep -F -- "--port $GATEWAY_SIM_PORT" /tmp/emwaver-daemon.service >/dev/null
echo "ok: systemd user unit generation includes daemon serve, port, and simulator transport"

if [[ "${EMWAVER_VALIDATE_SYSTEMD:-0}" == "1" ]]; then
  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "skipped: EMWAVER_VALIDATE_SYSTEMD=1 requires Linux"
  elif ! command -v systemctl >/dev/null 2>&1; then
    echo "skipped: systemctl unavailable"
  elif ! systemctl --user show-environment >/dev/null 2>&1; then
    echo "skipped: systemd user manager unavailable; enable linger or run in a login session"
  else
    run_systemd_user_service_validation
  fi
else
  cat <<EOF
skipped: set EMWAVER_VALIDATE_SYSTEMD=1 on a Linux login session to install,
start, render through, and uninstall the systemd user service on port $GATEWAY_SERVICE_PORT.
EOF
fi

run_gateway_hardware_validation() {
  local gateway_log
  gateway_log="$(mktemp /tmp/emwaver-linux-gateway-hardware.XXXXXX.log)"
  local gateway_pid=""
  cleanup_gateway_hardware() {
    if [[ -n "$gateway_pid" ]] && kill -0 "$gateway_pid" >/dev/null 2>&1; then
      kill "$gateway_pid" >/dev/null 2>&1 || true
      wait "$gateway_pid" >/dev/null 2>&1 || true
    fi
    rm -f "$gateway_log"
  }
  trap cleanup_gateway_hardware RETURN

  local args=(gateway --port "$GATEWAY_HARDWARE_PORT" --daemon-fallback)
  if [[ "$HARDWARE_TRANSPORT" == "ble" ]]; then
    args+=(--ble)
  elif [[ "$HARDWARE_TRANSPORT" == "usb" && -n "${EMWAVER_DEVICE_ID:-}" ]]; then
    args+=(--device "$EMWAVER_DEVICE_ID")
  else
    return 1
  fi

  (cd "$DAEMON_DIR" && cargo run -q -p emwaver -- "${args[@]}" >"$gateway_log" 2>&1) &
  gateway_pid=$!

  for _ in {1..80}; do
    if curl -fsS "http://127.0.0.1:$GATEWAY_HARDWARE_PORT/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done

  curl -fsS "http://127.0.0.1:$GATEWAY_HARDWARE_PORT/health"
  echo
  node "$ROOT/scripts/verify-gateway-daemon-render.mjs" "$GATEWAY_HARDWARE_PORT" emwaver-daemon "$SCRIPT_PATH" "$GATEWAY_EVENT_TARGET_ID"
}

if [[ "$HARDWARE_TRANSPORT" == "ble" || -n "${EMWAVER_DEVICE_ID:-}" ]]; then
  echo
  echo "== Gateway daemon hardware validation =="
  echo "script: $SCRIPT_PATH"
  echo "hardware transport: $HARDWARE_TRANSPORT"
  run_gateway_hardware_validation
else
  cat <<'EOF'

== Gateway daemon hardware validation skipped ==
Set EMWAVER_DEVICE_ID for USB or EMWAVER_HARDWARE_TRANSPORT=ble for BLE, then rerun:

  EMWAVER_DEVICE_ID=0 scripts/rebirth-linux-validation.sh
  EMWAVER_HARDWARE_TRANSPORT=ble scripts/rebirth-linux-validation.sh

If EMWAVER_TEST_SCRIPT points at a script other than blink.emw, set
EMWAVER_GATEWAY_EVENT_TARGET_ID to a UI node id that dispatches an event and
causes a second UI snapshot.
EOF
fi

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
