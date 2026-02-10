#!/usr/bin/env bash
set -euo pipefail

# Use sudo only when not root
if [[ "${EUID}" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

refresh_auth() {
  if ! command -v az >/dev/null 2>&1; then
    echo "az not found after install." >&2
    return 1
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "gh not found after install." >&2
    return 1
  fi

  GH_AUTH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  if [ -n "${GH_AUTH_TOKEN}" ]; then
    if [ "${GH_PERSIST_AUTH:-0}" = "1" ]; then
      printf '%s\n' "${GH_AUTH_TOKEN}" | env -u GH_TOKEN -u GITHUB_TOKEN gh auth login --with-token
      gh auth setup-git
      echo "GitHub CLI authenticated and persisted."
    else
      echo "GitHub token detected in env; using env-token auth (not persisted)."
    fi
  else
    echo "No GH_TOKEN/GITHUB_TOKEN provided; skipping GitHub auth."
  fi

  if [ -n "${AZURE_CLIENT_ID:-}" ] && [ -n "${AZURE_CLIENT_SECRET:-}" ] && [ -n "${AZURE_TENANT_ID:-}" ]; then
    az login --service-principal \
      --username "${AZURE_CLIENT_ID}" \
      --password "${AZURE_CLIENT_SECRET}" \
      --tenant "${AZURE_TENANT_ID}" >/dev/null
    if [ -n "${AZURE_SUBSCRIPTION_ID:-}" ]; then
      az account set --subscription "${AZURE_SUBSCRIPTION_ID}"
    fi
    echo "Azure CLI authenticated."
  else
    echo "Missing Azure SP env vars; skipping Azure auth."
  fi

  # Verification summary (no secrets emitted)
  az account show >/dev/null 2>&1 && echo "az auth: OK" || echo "az auth: MISSING"
  gh auth status >/dev/null 2>&1 && echo "gh auth: OK" || echo "gh auth: MISSING"
}

# Basic deps
${SUDO} apt-get update
${SUDO} apt-get install -y ca-certificates curl gnupg lsb-release

# -----------------------------
# Install Azure CLI (az)
# -----------------------------
${SUDO} mkdir -p /etc/apt/keyrings
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
  | gpg --dearmor \
  | ${SUDO} tee /etc/apt/keyrings/microsoft.gpg >/dev/null
${SUDO} chmod go+r /etc/apt/keyrings/microsoft.gpg

AZ_DIST_CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/azure-cli/ ${AZ_DIST_CODENAME} main" \
  | ${SUDO} tee /etc/apt/sources.list.d/azure-cli.list >/dev/null

# -----------------------------
# Install GitHub CLI (gh)
# -----------------------------
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | ${SUDO} tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
${SUDO} chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | ${SUDO} tee /etc/apt/sources.list.d/github-cli.list >/dev/null

# Install tools
${SUDO} apt-get update
${SUDO} apt-get install -y azure-cli gh

# Keep installer self-contained so it still works if copied to /tmp or run standalone.
refresh_auth
