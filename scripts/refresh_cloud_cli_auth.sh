#!/usr/bin/env bash
set -euo pipefail

# Re-auth helper intended for reused/cached containers where CLI install may already
# exist but auth state is gone. Safe to run multiple times.

if ! command -v az >/dev/null 2>&1; then
  echo "az not found; run scripts/setup_cloud_cli_tools.sh first." >&2
  exit 1
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "gh not found; run scripts/setup_cloud_cli_tools.sh first." >&2
  exit 1
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
