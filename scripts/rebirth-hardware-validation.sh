#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATEWAY_BACKEND_DIR="$ROOT/gateway/backend"
EMWAVER_BIN="$GATEWAY_BACKEND_DIR/target/debug/emwaver"
SCRIPT_PATH="${EMWAVER_TEST_SCRIPT:-$ROOT/assets/default-scripts/blink.emw}"
if [[ "$SCRIPT_PATH" != /* ]]; then
  SCRIPT_PATH="$ROOT/$SCRIPT_PATH"
fi
HARDWARE_TRANSPORT="${EMWAVER_HARDWARE_TRANSPORT:-usb}"

echo "== EMWaver rebirth hardware validation =="
echo "repo: $ROOT"
echo "script: $SCRIPT_PATH"
echo "hardware transport: $HARDWARE_TRANSPORT"
echo

"$ROOT/scripts/check-rust-toolchain.sh"

echo
echo "== Build CLI =="
(cd "$GATEWAY_BACKEND_DIR" && cargo build -p emwaver)

run_gateway_script() {
  local port="$1"
  local script="$2"
  shift 2
  local log_path
  log_path="$(mktemp /tmp/emwaver-gateway-hardware.XXXXXX.log)"
  local state_dir
  state_dir="$(mktemp -d /tmp/emwaver-gateway-hardware-state.XXXXXX)"
  EMWAVER_STATE_DIR="$state_dir" "$EMWAVER_BIN" gateway serve --port "$port" "$@" >"$log_path" 2>&1 &
  local pid="$!"
  cleanup_gateway_script() {
    set +e
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
    rm -f "$log_path"
    rm -rf "$state_dir"
  }
  trap cleanup_gateway_script RETURN
  for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
  curl -fsS "http://127.0.0.1:$port/health" >/dev/null
  "$EMWAVER_BIN" run "$script" --port "$port"
}

echo
echo "== Doctor =="
(cd "$GATEWAY_BACKEND_DIR" && cargo run -q -p emwaver -- doctor)

echo
echo "== Devices =="
if ! (cd "$GATEWAY_BACKEND_DIR" && cargo run -q -p emwaver -- devices); then
  if [[ "${EMWAVER_DOCTOR_ALLOW_MIDI_UNAVAILABLE:-}" == "1" ]]; then
    echo "device listing skipped: MIDI support unavailable in this hosted environment"
  else
    exit 1
  fi
fi

echo
echo "== UI-only Gateway runtime =="
tmp="$(mktemp /tmp/emwaver-rebirth-ui.XXXXXX)"
sim_tmp="$(mktemp /tmp/emwaver-rebirth-sim.XXXXXX)"
trap 'rm -f "$tmp" "$sim_tmp"' EXIT
printf 'UI.render(UI.text({ text: "rebirth validation" }));\n' > "$tmp"
run_gateway_script 3951 "$tmp" --no-device

echo
echo "== Simulator-backed Gateway runtime =="
{
  printf 'pinMode(13, OUTPUT);\n'
  printf 'digitalWrite(13, HIGH);\n'
  printf 'var board = device.boardType({ refresh: true });\n'
  printf 'var value = analogRead(0);\n'
  printf 'UI.render(UI.column({ children: [UI.text({ text: board }), UI.text({ text: String(value) })] }));\n'
} > "$sim_tmp"
run_gateway_script 3952 "$sim_tmp" --sim-device

if [[ "$HARDWARE_TRANSPORT" == "ble" ]]; then
  echo
  echo "== Hardware Gateway runtime (BLE) =="
  run_gateway_script 3953 "$SCRIPT_PATH" --ble
elif [[ "$HARDWARE_TRANSPORT" == "usb" && -n "${EMWAVER_DEVICE_ID:-}" ]]; then
  echo
  echo "== Hardware Gateway runtime (USB MIDI/SysEx) =="
  echo "device id: $EMWAVER_DEVICE_ID"
  run_gateway_script 3953 "$SCRIPT_PATH" --device "$EMWAVER_DEVICE_ID"
else
  cat <<'EOF'

== Hardware Gateway runtime skipped ==
Set EMWAVER_DEVICE_ID to the id shown by `emwaver devices`, then rerun:

  EMWAVER_DEVICE_ID=0 scripts/rebirth-hardware-validation.sh

For BLE:

  EMWAVER_HARDWARE_TRANSPORT=ble scripts/rebirth-hardware-validation.sh

Override the hardware script with:

  EMWAVER_TEST_SCRIPT=assets/default-scripts/gpio.emw EMWAVER_DEVICE_ID=0 scripts/rebirth-hardware-validation.sh
EOF
fi

cat <<'EOF'

== Local Gateway hardware validation ==
Gateway-backed hardware validation is also handled by scripts/rebirth-linux-validation.sh.
For Linux Gateway validation:

  EMWAVER_DEVICE_ID=0 scripts/rebirth-linux-validation.sh
  EMWAVER_HARDWARE_TRANSPORT=ble scripts/rebirth-linux-validation.sh

Native apps are self-contained and are no longer Gateway runtime owners.
EOF
