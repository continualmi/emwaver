#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SKIP_BUILD="${EMWAVER_SKIP_BUILD:-1}"
if [[ "${1:-}" == "--build" ]]; then
  SKIP_BUILD="0"
elif [[ "${1:-}" == "--skip-build" ]]; then
  SKIP_BUILD="1"
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--build|--skip-build]" >&2
  exit 2
fi

export EMWAVER_SKIP_BUILD="$SKIP_BUILD"

echo "Building/copying STM32 DFU assets (EMWAVER_SKIP_BUILD=$EMWAVER_SKIP_BUILD)..."

"$SCRIPT_DIR/emwaver-ism-firmware/build_android_asset.sh"
"$SCRIPT_DIR/emwaver-gpio-firmware/build_android_asset.sh"
"$SCRIPT_DIR/emwaver-ir-firmware/build_android_asset.sh"
"$SCRIPT_DIR/emwaver-rfid-firmware/build_android_asset.sh"

echo "Done."

