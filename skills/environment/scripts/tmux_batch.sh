#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage: tmux_batch.sh [options] <worktree:script> [<worktree:script> ...]

Run multiple tmux setup scripts sequentially or in parallel.

Options:
  -p, --parallel      Run scripts in parallel (default is sequential)
  -h, --help          Show this help message

Each item must specify the worktree directory and script basename, e.g.:
  ./emwaver-android:tmux_android.sh
  ../store-worktree:tmux_store.sh
EOF
}

mode="sequential"
declare -a items=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--parallel)
      mode="parallel"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        items+=("$1")
        shift
      done
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      items+=("$1")
      shift
      ;;
  esac
done

if [[ ${#items[@]} -eq 0 ]]; then
  echo "No worktree/script pairs specified." >&2
  usage
  exit 1
fi

resolve_script() {
  local name="$1"
  local path="${SCRIPT_DIR}/${name}"
  if [[ ! -x "${path}" ]]; then
    echo "Script not found or not executable: ${path}" >&2
    return 1
  fi
  printf '%s' "${path}"
}

run_entry() {
  local entry="$1"
  local mode="$2"
  local worktree="${entry%%:*}"
  local script_name="${entry#*:}"

  if [[ -z "${worktree}" || -z "${script_name}" || "${worktree}" == "${script_name}" ]]; then
    echo "Invalid entry '${entry}'. Expected format <worktree:script>." >&2
    return 1
  fi

  if [[ ! -d "${worktree}" ]]; then
    echo "Worktree directory not found: ${worktree}" >&2
    return 1
  fi

  local resolved
  resolved="$(resolve_script "${script_name}")" || return 1

  if [[ "${mode}" == "parallel" ]]; then
    (
      cd "${worktree}" && "${resolved}"
    ) &
    echo $!
  else
    (
      cd "${worktree}" && "${resolved}"
    )
  fi
}

if [[ "${mode}" == "parallel" ]]; then
  echo "Running scripts in parallel: ${items[*]}"
  pids=()
  for entry in "${items[@]}"; do
    pid="$(run_entry "${entry}" "parallel")" || exit 1
    pids+=("${pid}")
  done

  status=0
  for pid in "${pids[@]}"; do
    if ! wait "${pid}"; then
      status=1
    fi
  done
  exit "${status}"
else
  echo "Running scripts sequentially: ${items[*]}"
  for entry in "${items[@]}"; do
    run_entry "${entry}" "sequential" || exit 1
  done
fi
