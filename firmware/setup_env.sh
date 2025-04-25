#!/bin/bash
# Set the ESP-IDF path for this machine
export IDF_PATH="$HOME/esp/v5.3.2/esp-idf"

if [ -d "$IDF_PATH" ]; then
    source "$IDF_PATH/export.sh"
    echo "ESP-IDF environment sourced from $IDF_PATH"
else
    echo "ESP-IDF not found in $IDF_PATH. Please edit setup_env.sh with the correct path."
fi 