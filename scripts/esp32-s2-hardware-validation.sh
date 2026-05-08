#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAEMON_DIR="$ROOT/daemon"
ESP_DIR="$ROOT/esp"
PORT="${EMWAVER_ESP32_S2_PORT:-}"
DEVICE_ID="${EMWAVER_DEVICE_ID:-}"
SSID="${EMWAVER_WIFI_SSID:-}"
PASSWORD="${EMWAVER_WIFI_PASSWORD:-}"
SECRET="${EMWAVER_WIFI_SECRET:-}"
HOSTNAME="${EMWAVER_WIFI_HOSTNAME:-emwaver-s2-test}"
MDNS_INSTANCE="${EMWAVER_MDNS_INSTANCE:-}"

json_string() {
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
  elif command -v python >/dev/null 2>&1; then
    printf '%s' "$1" | python -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
  else
    echo "python is required to encode Wi-Fi values safely" >&2
    return 1
  fi
}

echo "== EMWaver ESP32-S2 hardware validation =="
echo "repo: $ROOT"
echo

"$ROOT/scripts/check-rust-toolchain.sh"

echo
echo "== Build ESP32-S2 firmware =="
(
  cd "$ESP_DIR"
  # shellcheck source=/dev/null
  source setup.sh
  idf.py set-target esp32s2
  idf.py build
)

if [[ -n "$PORT" ]]; then
  echo
  echo "== Flash ESP32-S2 firmware =="
  (
    cd "$ESP_DIR"
    # shellcheck source=/dev/null
    source setup.sh
    idf.py -p "$PORT" flash
  )
else
  cat <<'EOF'

== Flash skipped ==
Set EMWAVER_ESP32_S2_PORT to flash the attached board:

  EMWAVER_ESP32_S2_PORT=/dev/cu.usbmodemXXXX scripts/esp32-s2-hardware-validation.sh
EOF
fi

echo
echo "== Host USB device listing =="
if command -v python >/dev/null 2>&1 && python -c 'import serial.tools.list_ports' >/dev/null 2>&1; then
  python -m serial.tools.list_ports -v
else
  echo "pyserial unavailable; falling back to /dev serial device listing"
  ls /dev/cu.* /dev/tty.* 2>/dev/null || true
fi

echo
echo "== Build EMWaver CLI =="
(cd "$DAEMON_DIR" && cargo build -p emwaver)

echo
echo "== EMWaver device listing =="
(cd "$DAEMON_DIR" && cargo run -q -p emwaver -- devices)

if [[ -z "$DEVICE_ID" ]]; then
  cat <<'EOF'

== Board command validation skipped ==
Set EMWAVER_DEVICE_ID to the ESP32-S2 id shown above, then rerun:

  EMWAVER_DEVICE_ID=0 scripts/esp32-s2-hardware-validation.sh
EOF
  exit 0
fi

board_check="$(mktemp /tmp/emwaver-esp32-s2-board.XXXXXX.emw)"
wifi_check="$(mktemp /tmp/emwaver-esp32-s2-wifi.XXXXXX.emw)"
cleanup() {
  rm -f "$board_check" "$wifi_check"
}
trap cleanup EXIT

cat >"$board_check" <<'EOF'
var board = String(device.boardType({ refresh: true, timeout: 2500 }) || '').trim().toLowerCase();
if (board !== 'esp32s2') {
  throw new Error('expected esp32s2 board identity, got ' + board);
}
UI.render(UI.text({ text: 'ESP32-S2 board identity OK' }));
EOF

echo
echo "== Board identity over USB =="
(cd "$DAEMON_DIR" && cargo run -q -p emwaver -- run "$board_check" --direct --device "$DEVICE_ID")

if [[ -n "$SSID" && -n "$SECRET" ]]; then
  ssid_js="$(json_string "$SSID")"
  password_js="$(json_string "$PASSWORD")"
  secret_js="$(json_string "$SECRET")"
  hostname_js="$(json_string "$HOSTNAME")"

  cat >"$wifi_check" <<EOF
var EMW_OP_WIFI_CONFIG = 0x0a;
var EMW_WIFI_CFG_BEGIN = 0x00;
var EMW_WIFI_CFG_FIELD = 0x01;
var EMW_WIFI_CFG_APPLY = 0x02;
var EMW_WIFI_CFG_STATUS = 0x04;
var EMW_WIFI_FIELD_SSID = 0x00;
var EMW_WIFI_FIELD_PASSWORD = 0x01;
var EMW_WIFI_FIELD_SECRET = 0x02;
var EMW_WIFI_FIELD_HOSTNAME = 0x03;

function sendWifiPacket(bytes) {
  if (typeof __emwSendPacket !== 'function') {
    throw new Error('raw EMW packet helper unavailable');
  }
  return __emwSendPacket(new Uint8Array(bytes), 3000);
}

function putField(field, value) {
  var text = String(value || '');
  var offset = 0;
  while (offset < text.length) {
    var chunk = text.slice(offset, offset + 13);
    var bytes = [EMW_OP_WIFI_CONFIG, EMW_WIFI_CFG_FIELD, field, offset, chunk.length];
    for (var i = 0; i < chunk.length; i += 1) bytes.push(chunk.charCodeAt(i) & 0xff);
    sendWifiPacket(bytes);
    offset += chunk.length;
  }
}

sendWifiPacket([EMW_OP_WIFI_CONFIG, EMW_WIFI_CFG_BEGIN]);
putField(EMW_WIFI_FIELD_SSID, $ssid_js);
putField(EMW_WIFI_FIELD_PASSWORD, $password_js);
putField(EMW_WIFI_FIELD_SECRET, $secret_js);
putField(EMW_WIFI_FIELD_HOSTNAME, $hostname_js);
sendWifiPacket([EMW_OP_WIFI_CONFIG, EMW_WIFI_CFG_APPLY]);

var statusResp = sendWifiPacket([EMW_OP_WIFI_CONFIG, EMW_WIFI_CFG_STATUS]);
var provisioned = statusResp[1] === 1;
if (!provisioned) {
  throw new Error('Wi-Fi provisioning did not persist');
}
UI.render(UI.text({ text: 'ESP32-S2 Wi-Fi provisioning accepted' }));
EOF

  echo
  echo "== Wi-Fi provisioning over USB =="
  (cd "$DAEMON_DIR" && cargo run -q -p emwaver -- run "$wifi_check" --direct --device "$DEVICE_ID")
else
  cat <<'EOF'

== Wi-Fi provisioning skipped ==
Set EMWAVER_WIFI_SSID and EMWAVER_WIFI_SECRET to validate provisioning.
EMWAVER_WIFI_PASSWORD is optional for open networks.
EOF
fi

echo
echo "== mDNS discovery =="
if command -v dns-sd >/dev/null 2>&1; then
  dns_log="$(mktemp /tmp/emwaver-esp32-s2-mdns.XXXXXX.log)"
  dns-sd -B _emwaver._tcp local >"$dns_log" 2>&1 &
  dns_pid=$!
  sleep 5
  kill "$dns_pid" >/dev/null 2>&1 || true
  wait "$dns_pid" >/dev/null 2>&1 || true
  cat "$dns_log"
  rm -f "$dns_log"

  if [[ -n "$MDNS_INSTANCE" ]]; then
    dns-sd -L "$MDNS_INSTANCE" _emwaver._tcp local
  else
    cat <<'EOF'

Set EMWAVER_MDNS_INSTANCE to the instance name shown above to inspect TXT records:

  EMWAVER_MDNS_INSTANCE=<name> scripts/esp32-s2-hardware-validation.sh

Expected TXT records: board=esp32s2 and cap=wifi,usb.
EOF
  fi
else
  echo "dns-sd unavailable; inspect _emwaver._tcp with the platform mDNS browser."
fi
