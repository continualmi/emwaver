#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAEMON_DIR="$ROOT/daemon"
SCRIPT_PATH="${EMWAVER_TEST_SCRIPT:-$ROOT/assets/default-scripts/blink.emw}"
if [[ "$SCRIPT_PATH" != /* ]]; then
  SCRIPT_PATH="$ROOT/$SCRIPT_PATH"
fi

echo "== EMWaver rebirth hardware validation =="
echo "repo: $ROOT"
echo "script: $SCRIPT_PATH"
echo

"$ROOT/scripts/check-rust-toolchain.sh"

echo
echo "== Build CLI =="
(cd "$DAEMON_DIR" && cargo build -p emwaver)

echo
echo "== Doctor =="
(cd "$DAEMON_DIR" && cargo run -q -p emwaver -- doctor)

echo
echo "== Devices =="
if ! (cd "$DAEMON_DIR" && cargo run -q -p emwaver -- devices); then
  if [[ "${EMWAVER_DOCTOR_ALLOW_MIDI_UNAVAILABLE:-}" == "1" ]]; then
    echo "device listing skipped: MIDI support unavailable in this hosted environment"
  else
    exit 1
  fi
fi

echo
echo "== UI-only direct runtime =="
tmp="$(mktemp /tmp/emwaver-rebirth-ui.XXXXXX)"
sim_tmp="$(mktemp /tmp/emwaver-rebirth-sim.XXXXXX)"
trap 'rm -f "$tmp" "$sim_tmp"' EXIT
printf 'UI.render(UI.text({ text: "rebirth validation" }));\n' > "$tmp"
(cd "$DAEMON_DIR" && cargo run -q -p emwaver -- run "$tmp" --direct --no-device)

echo
echo "== Simulator-backed direct runtime =="
{
  printf 'pinMode(13, OUTPUT);\n'
  printf 'digitalWrite(13, HIGH);\n'
  printf 'var board = device.boardType({ refresh: true });\n'
  printf 'var value = analogRead(0);\n'
  printf 'UI.render(UI.column({ children: [UI.text({ text: board }), UI.text({ text: String(value) })] }));\n'
} > "$sim_tmp"
(cd "$DAEMON_DIR" && cargo run -q -p emwaver -- run "$sim_tmp" --direct --sim-device)

if [[ -n "${EMWAVER_DEVICE_ID:-}" ]]; then
  echo
  echo "== Hardware direct runtime =="
  echo "device id: $EMWAVER_DEVICE_ID"
  (cd "$DAEMON_DIR" && cargo run -q -p emwaver -- run "$SCRIPT_PATH" --direct --device "$EMWAVER_DEVICE_ID")
else
  cat <<'EOF'

== Hardware direct runtime skipped ==
Set EMWAVER_DEVICE_ID to the id shown by `emwaver devices`, then rerun:

  EMWAVER_DEVICE_ID=0 scripts/rebirth-hardware-validation.sh

Override the hardware script with:

  EMWAVER_TEST_SCRIPT=assets/default-scripts/gpio.emw EMWAVER_DEVICE_ID=0 scripts/rebirth-hardware-validation.sh
EOF
fi

cat <<'EOF'

== Local gateway/native-app hardware validation ==
Manual validation still required:

1. Start the native macOS or Windows app with the board connected.
2. In another terminal, run `emwaver gateway --port 3921`.
3. Open `http://127.0.0.1:3921`.
4. Run a hardware-backed script such as `blink.emw`.
5. Confirm the native app executes the script against the board and the gateway receives `script.started` plus live `ui.snapshot`/plot updates when applicable.
EOF
