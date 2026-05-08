#!/bin/bash
# Helper to source the ESP-IDF environment.
# Always run as `source setup.sh` so the current shell inherits the paths.

# Detect if the script is being run instead of sourced.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo "Please run this script using 'source setup.sh' so ESP-IDF variables apply to your shell." >&2
    exit 1
fi

legacy_root="${HOME}/esp"
default_root="${HOME}/esp"
older_root="${HOME}/ESP_on_home/ESP"

idf_root=""
if [[ -d "${default_root}/esp-idf" ]]; then
    idf_root="${default_root}/esp-idf"
elif [[ -d "${HOME}/ESP/esp-idf" ]]; then
    idf_root="${HOME}/ESP/esp-idf"
elif [[ -d "${older_root}/esp-idf" ]]; then
    idf_root="${older_root}/esp-idf"
else
    idf_root="${default_root}/esp-idf"
fi

export_script="${idf_root}/export.sh"

tools_default=""
if [[ -d "${default_root}/tools" ]]; then
    tools_default="${default_root}/tools"
elif [[ -d "${HOME}/ESP/tools" ]]; then
    tools_default="${HOME}/ESP/tools"
elif [[ -d "${older_root}/tools" ]]; then
    tools_default="${older_root}/tools"
else
    tools_default="${legacy_root}/tools"
fi

if [[ -z "${IDF_TOOLS_PATH:-}" && -d "${tools_default}" ]]; then
    export IDF_TOOLS_PATH="${tools_default}"
fi

# If ESP-IDF was installed with a different system Python than the one
# currently first on PATH (for example Homebrew vs pyenv), point export.sh
# at the existing virtualenv so sourcing remains stable across shells.
if [[ -z "${IDF_PYTHON_ENV_PATH:-}" && -d "${IDF_TOOLS_PATH}/python_env" ]]; then
    python_env_matches=()
    for python_env_match in "${IDF_TOOLS_PATH}"/python_env/idf*_py*_env; do
        [[ -d "${python_env_match}" ]] && python_env_matches+=("${python_env_match}")
    done
    if (( ${#python_env_matches[@]} > 0 )); then
        export IDF_PYTHON_ENV_PATH="${python_env_matches[0]}"
    fi
fi

if [[ ! -f "${export_script}" ]]; then
    echo "ESP-IDF export script not found at ${export_script}." >&2
    echo "Install ESP-IDF under ${default_root} (recommended) or ${legacy_root}." >&2
    return 1 2>/dev/null || exit 1
fi

# shellcheck disable=SC1090
source "${export_script}"

echo "ESP-IDF environment loaded from ${export_script}" >&2
