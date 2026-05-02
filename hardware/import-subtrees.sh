#!/usr/bin/env bash
set -euo pipefail

# History-preserving hardware imports for the EMWaver monorepo rebirth.
#
# This script intentionally uses `git subtree add`, which creates merge commits.
# Run it only when you are ready to import hardware history into this repo.
#
# Recommended first trial:
#   ./hardware/import-subtrees.sh gpio-waver
#
# Full import:
#   ./hardware/import-subtrees.sh all

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ROOT="${EMWAVER_HARDWARE_SOURCE_ROOT:-/Users/luisml/Documents/emwaver}"

cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to import hardware into a dirty worktree." >&2
  echo "Commit or stash current changes first, then rerun this script." >&2
  exit 1
fi

import_repo() {
  local name="$1"
  local category="$2"
  local source="$SOURCE_ROOT/$name"
  local prefix="hardware/$category/$name"

  if [[ ! -d "$source/.git" ]]; then
    echo "Missing source git repo: $source" >&2
    exit 1
  fi

  if [[ -e "$prefix" ]]; then
    echo "Target prefix already exists: $prefix" >&2
    exit 1
  fi

  echo "Importing $name -> $prefix"
  git subtree add --prefix="$prefix" "$source" main -m "Import $name hardware history"
}

case "${1:-}" in
  gpio-waver)
    import_repo "gpio-waver" "modules"
    ;;
  all)
    import_repo "emwaver-air" "boards"
    import_repo "emwaver-carrier" "boards"
    import_repo "emwaver-core" "boards"
    import_repo "emwaver-link" "boards"
    import_repo "emwaver-shield" "boards"
    import_repo "gpio-waver" "modules"
    import_repo "infrared-waver" "modules"
    import_repo "ism-waver" "modules"
    import_repo "rfid-waver" "modules"
    ;;
  *)
    echo "Usage: $0 gpio-waver|all" >&2
    echo "Set EMWAVER_HARDWARE_SOURCE_ROOT to override source root." >&2
    exit 2
    ;;
esac
