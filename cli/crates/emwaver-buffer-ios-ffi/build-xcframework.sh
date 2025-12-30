#!/usr/bin/env bash
set -euo pipefail

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
crate_dir="${here}"
repo_root="$(cd -- "${here}/../../.." && pwd)"

out_dir="${repo_root}/ios/EMWaver/Native"
xcframework_path="${out_dir}/EmwaverBufferCore.xcframework"

header_dir="${crate_dir}/include"

export PATH="${HOME}/.cargo/bin:${PATH}"

rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios-sim >/dev/null

cd "${crate_dir}"

cargo build --release --target aarch64-apple-ios
cargo build --release --target aarch64-apple-ios-sim
cargo build --release --target x86_64-apple-ios-sim

device_lib="${crate_dir}/target/aarch64-apple-ios/release/libemwaver_buffer_ios.a"
sim_arm64_lib="${crate_dir}/target/aarch64-apple-ios-sim/release/libemwaver_buffer_ios.a"
sim_x86_lib="${crate_dir}/target/x86_64-apple-ios-sim/release/libemwaver_buffer_ios.a"

sim_universal_lib="${crate_dir}/target/ios-sim-universal/release/libemwaver_buffer_ios.a"
mkdir -p "$(dirname "${sim_universal_lib}")"
lipo -create -output "${sim_universal_lib}" "${sim_arm64_lib}" "${sim_x86_lib}"

rm -rf "${xcframework_path}"
mkdir -p "${out_dir}"

xcodebuild -create-xcframework \
  -library "${device_lib}" -headers "${header_dir}" \
  -library "${sim_universal_lib}" -headers "${header_dir}" \
  -output "${xcframework_path}"

echo "Built: ${xcframework_path}"

