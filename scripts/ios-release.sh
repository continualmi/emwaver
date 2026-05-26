#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ios_dir="${repo_root}/ios"
lane="${1:-release_upload}"

case "${lane}" in
  test|archive|beta|release_upload|app_store_upload|release) ;;
  *)
    echo "Usage: scripts/ios-release.sh [test|archive|beta|release_upload|app_store_upload|release]" >&2
    exit 2
    ;;
esac

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild is required. Run this on a Mac with Xcode installed." >&2
  exit 1
fi

if ! command -v bundle >/dev/null 2>&1; then
  echo "Bundler is required. Install it with: gem install bundler" >&2
  exit 1
fi

cd "${ios_dir}"

export BUNDLE_PATH="${BUNDLE_PATH:-${ios_dir}/vendor/bundle}"
export FASTLANE_SKIP_UPDATE_CHECK="${FASTLANE_SKIP_UPDATE_CHECK:-1}"

if [ ! -f "Gemfile.lock" ]; then
  bundle install
else
  bundle check || bundle install
fi

bundle exec fastlane ios "${lane}"
