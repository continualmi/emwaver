#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

ELF="$SCRIPT_DIR/Release/emwaver-firmware.elf"
BIN="$SCRIPT_DIR/Release/emwaver-firmware.bin"
ANDROID_ASSET="$REPO_ROOT/android/app/src/main/assets/dfu.dfu"

verbose() {
  [[ "${EMWAVER_VERBOSE:-0}" == "1" ]]
}

try_use_cubeide_toolchain() {
  local ide_app
  for ide_app in \
    /Applications/STM32CubeIDE.app \
    "$HOME/Applications/STM32CubeIDE.app" \
    ; do
    [[ -d "$ide_app" ]] || continue

    local ide_root="$ide_app/Contents/Eclipse"
    [[ -d "$ide_root" ]] || continue

    local gcc_path=""
    gcc_path="$(find "$ide_root" -maxdepth 8 -type f -name arm-none-eabi-gcc -path '*/bin/arm-none-eabi-gcc' -print -quit 2>/dev/null || true)"
    if [[ -n "$gcc_path" ]]; then
      local bin_dir
      bin_dir="$(dirname "$gcc_path")"
      export PATH="$bin_dir:$PATH"
      verbose && echo "Using STM32CubeIDE toolchain: $bin_dir"
      return 0
    fi
  done

  return 1
}

toolchain_ok() {
  command -v arm-none-eabi-gcc >/dev/null 2>&1 || return 1
  command -v arm-none-eabi-objcopy >/dev/null 2>&1 || return 1

  local test_c
  test_c="$(mktemp -t emwaver_toolchain_test.XXXXXX.c)"
  trap 'rm -f "$test_c"' RETURN
  cat >"$test_c" <<'EOF'
#include <stdint.h>
#include <stdio.h>
int main(void) { return 0; }
EOF

  arm-none-eabi-gcc -mcpu=cortex-m0 -mthumb -c "$test_c" -o /dev/null >/dev/null 2>&1
}

if [[ -n "${EMWAVER_ARM_TOOLCHAIN_BIN:-}" ]]; then
  if [[ -d "${EMWAVER_ARM_TOOLCHAIN_BIN}" ]]; then
    export PATH="${EMWAVER_ARM_TOOLCHAIN_BIN}:$PATH"
    verbose && echo "Using EMWAVER_ARM_TOOLCHAIN_BIN: ${EMWAVER_ARM_TOOLCHAIN_BIN}"
  else
    echo "error: EMWAVER_ARM_TOOLCHAIN_BIN is not a directory: ${EMWAVER_ARM_TOOLCHAIN_BIN}" >&2
    exit 1
  fi
fi

try_use_cubeide_toolchain || true

if ! toolchain_ok; then
  cat >&2 <<EOF
error: missing/invalid ARM toolchain.

This build expects a complete \`arm-none-eabi-gcc\` + newlib toolchain (headers like \`stdint.h\`/\`stdio.h\`).
Options:
- Install ST "GNU Tools for STM32" and ensure \`arm-none-eabi-gcc\` is on PATH, or
- Install STM32CubeIDE and rerun (this script auto-detects its bundled toolchain).

Debug:
- arm-none-eabi-gcc: $(command -v arm-none-eabi-gcc || echo "not found")
EOF
  exit 1
fi

JOBS="4"
if command -v sysctl >/dev/null 2>&1; then
  JOBS="$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
elif command -v nproc >/dev/null 2>&1; then
  JOBS="$(nproc 2>/dev/null || echo 4)"
fi

verbose && arm-none-eabi-gcc --version | head -n 1

echo "Building STM32 firmware (Release)..."
make -C "$SCRIPT_DIR/Release" -j"$JOBS" all

if [[ ! -f "$ELF" ]]; then
  echo "error: expected ELF not found: $ELF" >&2
  exit 1
fi

echo "Exporting binary: $BIN"
arm-none-eabi-objcopy -O binary "$ELF" "$BIN"

if [[ ! -f "$ANDROID_ASSET" ]]; then
  echo "error: expected Android asset not found: $ANDROID_ASSET" >&2
  exit 1
fi

echo "Updating Android asset: $ANDROID_ASSET"
cp -f "$BIN" "$ANDROID_ASSET"

echo "Done."
echo "  ELF: $ELF"
echo "  BIN: $BIN"
echo "  Android asset: $ANDROID_ASSET"

