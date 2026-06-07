#!/usr/bin/env bash
set -euo pipefail

app_id="com.continualmi.EMWaver"

required_files=(
  "/usr/bin/emwaver-linux-app"
  "/usr/bin/emwaver"
  "/usr/libexec/emwaver/emwaver-linux-app"
  "/usr/share/applications/${app_id}.desktop"
  "/usr/share/metainfo/${app_id}.metainfo.xml"
  "/usr/share/icons/hicolor/256x256/apps/${app_id}.png"
  "/usr/share/emwaver/default-scripts/emw-kernel.emw"
  "/usr/share/emwaver/default-scripts/cc1101.emw"
  "/usr/share/emwaver/firmware/emwaver.bin"
  "/usr/share/emwaver/tools/emwaver_esp_helper.py"
  "/usr/lib/udev/rules.d/99-emwaver.rules"
)

for file in "${required_files[@]}"; do
  if [[ ! -e "${file}" ]]; then
    echo "Installed file missing: ${file}" >&2
    exit 1
  fi
done

test -x /usr/bin/emwaver-linux-app
test -x /usr/libexec/emwaver/emwaver-linux-app
test -x /usr/share/emwaver/tools/emwaver_esp_helper.py
command -v emwaver-linux-app >/dev/null
command -v emwaver >/dev/null

if command -v ldd >/dev/null 2>&1; then
  echo "== Shared library check =="
  ldd /usr/libexec/emwaver/emwaver-linux-app | tee /tmp/emwaver-linux-ldd.txt
  if grep -q 'not found' /tmp/emwaver-linux-ldd.txt; then
    echo "Missing shared library dependency." >&2
    exit 1
  fi
fi

if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "/usr/share/applications/${app_id}.desktop"
fi
if command -v appstreamcli >/dev/null 2>&1; then
  appstreamcli validate --no-net "/usr/share/metainfo/${app_id}.metainfo.xml" || true
fi

# GUI smoke test. A healthy app should start and keep running until timeout.
# Exit 124 from timeout means the app remained alive long enough under Xvfb.
if command -v xvfb-run >/dev/null 2>&1 && command -v dbus-run-session >/dev/null 2>&1; then
  echo "== Headless GTK launch smoke =="
  set +e
  dbus-run-session -- xvfb-run -a timeout 8s emwaver-linux-app
  code=$?
  set -e
  if [[ "${code}" != "124" && "${code}" != "0" ]]; then
    echo "Headless launch smoke failed with exit code ${code}." >&2
    exit "${code}"
  fi
fi

echo "Installed Linux package verification passed."
