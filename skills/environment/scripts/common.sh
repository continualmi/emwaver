#!/usr/bin/env bash
set -euo pipefail

SETUP_DIR="${HOME}/setup"
ENV_SCRIPT="${SETUP_DIR}/emwaver-env.sh"

ensure_env_script() {
  if [[ -f "${ENV_SCRIPT}" ]]; then
    return 0
  fi

  if [[ ! -d "${SETUP_DIR}" ]]; then
    echo "Setup repo missing; cloning from git@github.com:luispl77/setup.git" >&2
    if ! git clone git@github.com:luispl77/setup.git "${SETUP_DIR}"; then
      echo "Clone failed. Please ensure GitHub SSH access is configured and retry." >&2
      exit 1
    fi
  fi

  if [[ ! -f "${ENV_SCRIPT}" ]]; then
    echo "Attempting to update setup repo to retrieve emwaver-env.sh" >&2
    if ! git -C "${SETUP_DIR}" pull --ff-only; then
      echo "Update failed. Please ensure GitHub SSH access is configured and retry." >&2
      exit 1
    fi
  fi

  if [[ ! -f "${ENV_SCRIPT}" ]]; then
    echo "Environment script still missing after sync: ${ENV_SCRIPT}" >&2
    exit 1
  fi
}
