#!/usr/bin/env bash
set -euo pipefail

dist_dir="${1:-dist}"
deb="${dist_dir}/EMWaver-linux-amd64.deb"
tarball="${dist_dir}/EMWaver-linux-x64.tar.gz"
app_id="com.continualmi.EMWaver"

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing required file: $1" >&2
    exit 1
  fi
}

require_dir() {
  if [[ ! -d "$1" ]]; then
    echo "Missing required directory: $1" >&2
    exit 1
  fi
}

require_file "${deb}"
require_file "${tarball}"

work_dir="$(mktemp -d)"
trap 'rm -rf "${work_dir}"' EXIT

echo "== Debian package metadata =="
dpkg-deb --info "${deb}"

echo "== Debian package contents =="
dpkg-deb --contents "${deb}" | sed -n '1,160p'

dpkg-deb --extract "${deb}" "${work_dir}/deb-root"
dpkg-deb --control "${deb}" "${work_dir}/deb-control"

required_paths=(
  "usr/bin/emwaver-linux-app"
  "usr/bin/emwaver"
  "usr/libexec/emwaver/emwaver-linux-app"
  "usr/share/applications/${app_id}.desktop"
  "usr/share/metainfo/${app_id}.metainfo.xml"
  "usr/share/icons/hicolor/256x256/apps/${app_id}.png"
  "usr/share/emwaver/default-scripts/emw-kernel.emw"
  "usr/share/emwaver/default-scripts/cc1101.emw"
  "usr/share/emwaver/firmware/emwaver.bin"
  "usr/share/emwaver/tools/emwaver_esp_helper.py"
  "usr/lib/udev/rules.d/99-emwaver.rules"
  "usr/share/doc/emwaver/LICENSE"
  "usr/share/doc/emwaver/NOTICE"
)

for rel in "${required_paths[@]}"; do
  require_file "${work_dir}/deb-root/${rel}"
done

test -x "${work_dir}/deb-root/usr/bin/emwaver-linux-app"
test -x "${work_dir}/deb-root/usr/libexec/emwaver/emwaver-linux-app"
test -x "${work_dir}/deb-root/usr/share/emwaver/tools/emwaver_esp_helper.py"
test -L "${work_dir}/deb-root/usr/bin/emwaver"

grep -Eq 'EMWAVER_DEFAULT_SCRIPTS_DIR.*=/usr/share/emwaver/default-scripts' "${work_dir}/deb-root/usr/bin/emwaver-linux-app"
grep -Eq 'EMWAVER_FIRMWARE_DIR.*=/usr/share/emwaver/firmware' "${work_dir}/deb-root/usr/bin/emwaver-linux-app"
grep -Eq 'EMWAVER_ESP_HELPER_SOURCE.*=/usr/share/emwaver/tools/emwaver_esp_helper.py' "${work_dir}/deb-root/usr/bin/emwaver-linux-app"
grep -q '^Package: emwaver$' "${work_dir}/deb-control/control"
grep -q '^Architecture: amd64$' "${work_dir}/deb-control/control"
grep -q 'libgtk-4-1' "${work_dir}/deb-control/control"
grep -q 'libadwaita-1-0' "${work_dir}/deb-control/control"
grep -q 'libgtksourceview-5-0' "${work_dir}/deb-control/control"

echo "== Desktop/AppStream validation =="
if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "${work_dir}/deb-root/usr/share/applications/${app_id}.desktop"
fi
if command -v appstreamcli >/dev/null 2>&1; then
  appstreamcli validate --no-net "${work_dir}/deb-root/usr/share/metainfo/${app_id}.metainfo.xml" || true
fi

echo "== Tarball contents =="
tar -tzf "${tarball}" | sed -n '1,160p'
tar -xzf "${tarball}" -C "${work_dir}"
require_dir "${work_dir}/EMWaver-linux-x64/usr"
for rel in "${required_paths[@]}"; do
  require_file "${work_dir}/EMWaver-linux-x64/${rel}"
done
require_file "${work_dir}/EMWaver-linux-x64/INSTALL.txt"

echo "Linux package verification passed."
