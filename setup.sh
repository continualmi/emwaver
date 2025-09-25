#!/bin/bash
# Helper to source the ESP-IDF environment from ~/esp/esp-idf/export.sh.
# Always run as `source setup.sh` so the current shell inherits the paths.

# Detect if the script is being run instead of sourced.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo "Please run this script using 'source setup.sh' so ESP-IDF variables apply to your shell." >&2
    exit 1
fi

idf_root="${HOME}/esp/esp-idf"
export_script="${idf_root}/export.sh"
tools_default="${HOME}/esp/tools"

if [[ -z "${IDF_TOOLS_PATH:-}" && -d "${tools_default}" ]]; then
    export IDF_TOOLS_PATH="${tools_default}"
fi

if [[ ! -f "${export_script}" ]]; then
    echo "ESP-IDF export script not found at ${export_script}." >&2
    echo "Make sure ESP-IDF v5.5.1 is installed under ~/esp." >&2
    return 1 2>/dev/null || exit 1
fi

# shellcheck disable=SC1090
source "${export_script}"

echo "ESP-IDF environment loaded from ${export_script}" >&2
