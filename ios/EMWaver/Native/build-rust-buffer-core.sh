#!/usr/bin/env bash
set -euo pipefail

export PATH="${HOME}/.cargo/bin:${PATH}"

CRATE_DIR="${SRCROOT}/../cli/crates/emwaver-buffer-ios-ffi"
OUT_LIB="${TARGET_TEMP_DIR}/libemwaver_buffer_ios.a"

if ! command -v cargo >/dev/null 2>&1; then
  echo "[emwaver-buffer] cargo not found; install Rust (rustup) and restart Xcode"
  exit 1
fi

if ! command -v rustup >/dev/null 2>&1; then
  echo "[emwaver-buffer] rustup not found; install Rust via rustup and restart Xcode"
  exit 1
fi

if [[ ! -f "${CRATE_DIR}/Cargo.toml" ]]; then
  echo "[emwaver-buffer] Missing Rust crate: ${CRATE_DIR}"
  exit 1
fi

profile_dir="debug"
cargo_profile_args=()
if [[ "${CONFIGURATION}" == "Release" ]]; then
  profile_dir="release"
  cargo_profile_args=(--release)
fi

ensure_target() {
  local t="$1"
  if ! rustup target list --installed | grep -qx "${t}"; then
    echo "[emwaver-buffer] installing rust target ${t}"
    rustup target add "${t}"
  fi
}

libs=()
for arch in ${ARCHS}; do
  case "${PLATFORM_NAME}" in
    iphoneos*)
      case "${arch}" in
        arm64) target="aarch64-apple-ios" ;;
        arm64e) target="arm64e-apple-ios" ;;
        *)
          echo "[emwaver-buffer] Unsupported iphoneos arch: ${arch} (ARCHS=${ARCHS})"
          exit 1
          ;;
      esac
      ;;
    iphonesimulator*)
      case "${arch}" in
        arm64) target="aarch64-apple-ios-sim" ;;
        x86_64) target="x86_64-apple-ios" ;;
        *)
          echo "[emwaver-buffer] Unsupported iphonesimulator arch: ${arch} (ARCHS=${ARCHS})"
          exit 1
          ;;
      esac
      ;;
    *)
      echo "[emwaver-buffer] Unsupported PLATFORM_NAME=${PLATFORM_NAME}"
      exit 1
      ;;
  esac

  ensure_target "${target}"

  echo "[emwaver-buffer] building ${target} (${arch}) [${CONFIGURATION}]"
  (cd "${CRATE_DIR}" && cargo build "${cargo_profile_args[@]}" --target "${target}")

  lib_path="${CRATE_DIR}/target/${target}/${profile_dir}/libemwaver_buffer_ios.a"
  if [[ ! -f "${lib_path}" ]]; then
    echo "[emwaver-buffer] Expected library not found: ${lib_path}"
    exit 1
  fi

  libs+=("${lib_path}")
done

mkdir -p "$(dirname "${OUT_LIB}")"

if [[ ${#libs[@]} -eq 1 ]]; then
  cp -f "${libs[0]}" "${OUT_LIB}"
else
  lipo -create -output "${OUT_LIB}" "${libs[@]}"
fi

if [[ ! -f "${OUT_LIB}" ]]; then
  echo "[emwaver-buffer] Failed to write ${OUT_LIB}"
  exit 1
fi

ls -la "${OUT_LIB}"
echo "[emwaver-buffer] wrote ${OUT_LIB}"
