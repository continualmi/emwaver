/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

#include "transport_debug.h"

#include <stdio.h>
#include <string.h>

#include "command_registry.h"
#include "esp_log.h"

static const char *TAG = "TRANSPORT";
static volatile bool s_transport_debug_enabled;

static void debug_transport_command(const char *mode);
static const char *source_name(uint8_t source);

void transport_debug_register_commands(void)
{
    (void)register_command(
        "debug transport",
        (void *)debug_transport_command,
        (const cmd_arg_spec_t[]){
            {"mode", CMD_ARG_STRING, true},
            {NULL, CMD_ARG_DONE, false},
        });
}

bool transport_debug_is_enabled(void)
{
    return s_transport_debug_enabled;
}

void transport_debug_log_lane(uint8_t source,
                              const char *direction,
                              const uint8_t *lane,
                              size_t lane_len,
                              uint16_t wifi_sequence)
{
    if (!s_transport_debug_enabled || !direction || !lane || lane_len == 0) {
        return;
    }

    char hex[160];
    size_t offset = 0;
    for (size_t i = 0; i < lane_len && offset + 4u < sizeof(hex); ++i) {
        int written = snprintf(&hex[offset],
                               sizeof(hex) - offset,
                               "%s%02x",
                               i == 0 ? "" : " ",
                               lane[i]);
        if (written <= 0) {
            break;
        }
        offset += (size_t)written;
    }
    hex[offset] = '\0';

    if (source == EMW_COMMAND_SOURCE_WIFI) {
        ESP_LOGI(TAG,
                 "[%s] %s seq=%u op=%02x lane=%s",
                 source_name(source),
                 direction,
                 (unsigned)wifi_sequence,
                 lane[0],
                 hex);
        return;
    }

    ESP_LOGI(TAG,
             "[%s] %s op=%02x lane=%s",
             source_name(source),
             direction,
             lane[0],
             hex);
}

static void debug_transport_command(const char *mode)
{
    if (!mode) {
        command_send_err("debug mode");
        return;
    }

    if (strcmp(mode, "on") == 0 || strcmp(mode, "1") == 0 || strcmp(mode, "true") == 0) {
        s_transport_debug_enabled = true;
        command_send_ok((const uint8_t *)"transport debug on", strlen("transport debug on"));
        return;
    }

    if (strcmp(mode, "off") == 0 || strcmp(mode, "0") == 0 || strcmp(mode, "false") == 0) {
        s_transport_debug_enabled = false;
        command_send_ok((const uint8_t *)"transport debug off", strlen("transport debug off"));
        return;
    }

    if (strcmp(mode, "status") == 0) {
        const char *status = s_transport_debug_enabled ? "transport debug on" : "transport debug off";
        command_send_ok((const uint8_t *)status, strlen(status));
        return;
    }

    command_send_err("debug mode");
}

static const char *source_name(uint8_t source)
{
    switch (source) {
        case EMW_COMMAND_SOURCE_USB:
            return "usb";
        case EMW_COMMAND_SOURCE_BLE:
            return "ble";
        case EMW_COMMAND_SOURCE_WIFI:
            return "wifi";
        default:
            return "unknown";
    }
}
