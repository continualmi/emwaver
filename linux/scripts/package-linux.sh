#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version="${EMWAVER_LINUX_VERSION:-preview}"
arch="${EMWAVER_LINUX_ARCH:-amd64}"
rust_target="${EMWAVER_LINUX_RUST_TARGET:-release}"
out_dir="${EMWAVER_LINUX_DIST_DIR:-${repo_root}/dist}"
work_dir="${repo_root}/linux/target/package"
app_id="com.continualmi.EMWaver"
package_name="emwaver"
install_root="${work_dir}/${package_name}"

target_bin="${repo_root}/linux/target/${rust_target}/emwaver-linux-app"
if [[ ! -x "${target_bin}" ]]; then
  echo "Missing Linux app binary at ${target_bin}. Run: cargo build --manifest-path linux/Cargo.toml --release -p emwaver-linux-app" >&2
  exit 1
fi

rm -rf "${install_root}"
mkdir -p \
  "${install_root}/usr/bin" \
  "${install_root}/usr/libexec/emwaver" \
  "${install_root}/usr/share/applications" \
  "${install_root}/usr/share/metainfo" \
  "${install_root}/usr/share/emwaver/default-scripts" \
  "${install_root}/usr/share/emwaver/firmware" \
  "${install_root}/usr/share/emwaver/tools" \
  "${install_root}/usr/share/doc/emwaver" \
  "${install_root}/usr/share/icons/hicolor/256x256/apps" \
  "${install_root}/usr/lib/udev/rules.d" \
  "${out_dir}"

install -m 0755 "${target_bin}" "${install_root}/usr/libexec/emwaver/emwaver-linux-app"
cat > "${install_root}/usr/bin/emwaver-linux-app" <<'SH'
#!/usr/bin/env sh
set -eu
: "${EMWAVER_DEFAULT_SCRIPTS_DIR:=/usr/share/emwaver/default-scripts}"
: "${EMWAVER_FIRMWARE_DIR:=/usr/share/emwaver/firmware}"
: "${EMWAVER_ESP_HELPER_SOURCE:=/usr/share/emwaver/tools/emwaver_esp_helper.py}"
export EMWAVER_DEFAULT_SCRIPTS_DIR EMWAVER_FIRMWARE_DIR EMWAVER_ESP_HELPER_SOURCE
exec /usr/libexec/emwaver/emwaver-linux-app "$@"
SH
chmod 0755 "${install_root}/usr/bin/emwaver-linux-app"
ln -s emwaver-linux-app "${install_root}/usr/bin/emwaver"

cp "${repo_root}/linux/resources/${app_id}.desktop" "${install_root}/usr/share/applications/${app_id}.desktop"
cp "${repo_root}/linux/resources/${app_id}.metainfo.xml" "${install_root}/usr/share/metainfo/${app_id}.metainfo.xml"
cp "${repo_root}/linux/resources/udev/99-emwaver.rules" "${install_root}/usr/lib/udev/rules.d/99-emwaver.rules"
cp "${repo_root}/LICENSE" "${install_root}/usr/share/doc/emwaver/LICENSE"
cp "${repo_root}/NOTICE" "${install_root}/usr/share/doc/emwaver/NOTICE"
cp "${repo_root}/README.md" "${install_root}/usr/share/doc/emwaver/README.md"
cp "${repo_root}/macos/EMWaver/EMWaver/Assets.xcassets/AppIcon.appiconset/icon_256x256.png" \
  "${install_root}/usr/share/icons/hicolor/256x256/apps/${app_id}.png"

cp "${repo_root}"/assets/default-scripts/*.js "${install_root}/usr/share/emwaver/default-scripts/"
cp "${repo_root}/firmware/emwaver.bin" "${install_root}/usr/share/emwaver/firmware/emwaver.bin"

if [[ -f "${repo_root}/tools/emwaver-esp-helper/emwaver_esp_helper.py" ]]; then
  cp "${repo_root}/tools/emwaver-esp-helper/emwaver_esp_helper.py" "${install_root}/usr/share/emwaver/tools/emwaver_esp_helper.py"
  chmod 0755 "${install_root}/usr/share/emwaver/tools/emwaver_esp_helper.py"
fi

# ESP32 serial flashing needs all four images. Package them when a build tree is available,
# but do not fail preview packaging if ESP firmware has not been built in CI yet.
for src in \
  "esp/build/bootloader/bootloader.bin:esp32s3/bootloader.bin" \
  "esp/build/partition_table/partition-table.bin:esp32s3/partition-table.bin" \
  "esp/build/ota_data_initial.bin:esp32s3/ota_data_initial.bin" \
  "esp/build/emwaveresp.bin:esp32s3/emwaveresp.bin"; do
  from="${src%%:*}"
  to="${src#*:}"
  if [[ -f "${repo_root}/${from}" ]]; then
    mkdir -p "$(dirname "${install_root}/usr/share/emwaver/firmware/${to}")"
    cp "${repo_root}/${from}" "${install_root}/usr/share/emwaver/firmware/${to}"
  fi
done

if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "${install_root}/usr/share/applications/${app_id}.desktop"
fi
if command -v appstreamcli >/dev/null 2>&1; then
  appstreamcli validate --no-net "${install_root}/usr/share/metainfo/${app_id}.metainfo.xml" || true
fi

archive_root="${work_dir}/archive"
rm -rf "${archive_root}"
mkdir -p "${archive_root}/EMWaver-linux-x64"
cp -a "${install_root}/usr" "${archive_root}/EMWaver-linux-x64/"
cat > "${archive_root}/EMWaver-linux-x64/INSTALL.txt" <<TXT
EMWaver Linux preview

Tarball install:
  sudo cp -a usr/* /usr/
  sudo udevadm control --reload-rules
  sudo udevadm trigger

Or install the .deb package from the same release when available.
TXT

tar -C "${archive_root}" -czf "${out_dir}/EMWaver-linux-x64.tar.gz" "EMWaver-linux-x64"

# Build a simple Debian package for Ubuntu/Debian preview users.
deb_root="${work_dir}/deb"
rm -rf "${deb_root}"
mkdir -p "${deb_root}"
cp -a "${install_root}" "${deb_root}/${package_name}"
mkdir -p "${deb_root}/${package_name}/DEBIAN"
installed_size="$(du -sk "${deb_root}/${package_name}/usr" | awk '{print $1}')"
cat > "${deb_root}/${package_name}/DEBIAN/control" <<CONTROL
Package: emwaver
Version: ${version}
Section: electronics
Priority: optional
Architecture: ${arch}
Maintainer: Continual MI <support@continualmi.com>
Installed-Size: ${installed_size}
Depends: libgtk-4-1, libadwaita-1-0, libgtksourceview-5-0, libgraphene-1.0-0, libusb-1.0-0, python3
Recommends: bluez, libsecret-tools
Homepage: https://emwaver.ai
Description: Local-first electronics scripting lab
 EMWaver turns supported MCU boards into a scriptable local hardware lab through
 native apps, managed firmware, and JavaScript scripts.
CONTROL
cat > "${deb_root}/${package_name}/DEBIAN/postinst" <<'POSTINST'
#!/usr/bin/env sh
set -e
if command -v udevadm >/dev/null 2>&1; then
  udevadm control --reload-rules || true
  udevadm trigger || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q /usr/share/icons/hicolor || true
fi
exit 0
POSTINST
chmod 0755 "${deb_root}/${package_name}/DEBIAN/postinst"

dpkg-deb --build --root-owner-group "${deb_root}/${package_name}" "${out_dir}/EMWaver-linux-amd64.deb"

echo "Built Linux packages:"
ls -lh "${out_dir}/EMWaver-linux-x64.tar.gz" "${out_dir}/EMWaver-linux-amd64.deb"
