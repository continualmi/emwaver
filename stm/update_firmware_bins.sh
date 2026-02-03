#!/usr/bin/env bash
set -euo pipefail

# Update all bundled firmware .bin copies from a built .elf.
#
# Usage:
#   stm/update_firmware_bins.sh [path/to/emwaver.elf]
#
# Defaults:
#   - repo-root/emwaver10.elf if present
#
# Requirements:
#   - arm-none-eabi-objcopy (GNU objcopy for ARM embedded toolchains)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ELF_PATH="${1:-}" 
if [[ -z "${ELF_PATH}" ]]; then
  if [[ -f "$REPO_ROOT/emwaver10.elf" ]]; then
    ELF_PATH="$REPO_ROOT/emwaver10.elf"
  else
    echo "error: no .elf provided, and default $REPO_ROOT/emwaver10.elf not found" >&2
    exit 2
  fi
fi

if [[ ! -f "$ELF_PATH" ]]; then
  echo "error: elf not found: $ELF_PATH" >&2
  exit 2
fi

if ! command -v arm-none-eabi-objcopy >/dev/null 2>&1; then
  echo "error: arm-none-eabi-objcopy not found in PATH" >&2
  echo "hint: install the ARM GNU toolchain (or run this on a dev machine that has it)" >&2
  exit 3
fi

TMP_BIN="$(mktemp -t emwaver_firmware_XXXXXX.bin)"
trap 'rm -f "$TMP_BIN"' EXIT

arm-none-eabi-objcopy -O binary "$ELF_PATH" "$TMP_BIN"

TARGETS=(
  "$REPO_ROOT/firmware/emwaver.bin"
  "$REPO_ROOT/android/app/src/main/assets/ota/emwaver.bin"
  "$REPO_ROOT/ios/EMWaver/ota/emwaver.bin"
  "$REPO_ROOT/windows/EMWaver/Assets/ota/emwaver.bin"
  "$REPO_ROOT/apple/EMWaverAppleCore/Resources/ota/emwaver.bin"
)

for out in "${TARGETS[@]}"; do
  mkdir -p "$(dirname "$out")"
  cp -f "$TMP_BIN" "$out"
done

echo "Updated firmware bins from: $ELF_PATH"
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "${TARGETS[0]}" | awk '{print "sha256: " $1}'
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${TARGETS[0]}" | awk '{print "sha256: " $1}'
fi

printf 'Wrote:\n'
for out in "${TARGETS[@]}"; do
  echo "  - ${out#$REPO_ROOT/}"
done
