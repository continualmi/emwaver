/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

#include "transport_session.h"

#include "emw_proto.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "usb.h"

#define TRANSPORT_SESSION_TIMEOUT_MS 5000u

static volatile uint8_t s_active_source = EMW_TRANSPORT_SOURCE_NONE;
static volatile TickType_t s_last_activity_tick;

static void expire_stale_claim(void)
{
    if (s_active_source == EMW_TRANSPORT_SOURCE_NONE) {
        return;
    }

    const TickType_t now = xTaskGetTickCount();
    const TickType_t timeout_ticks = pdMS_TO_TICKS(TRANSPORT_SESSION_TIMEOUT_MS);
    if ((now - s_last_activity_tick) > timeout_ticks) {
        s_active_source = EMW_TRANSPORT_SOURCE_NONE;
    }
}

static bool is_transport_session_status(const command_t *cmd)
{
    return cmd && cmd->length == EMW_USB_CMD_LANE_SIZE &&
           cmd->data[0] == EMW_OP_TRANSPORT_SESSION &&
           cmd->data[1] == EMW_TRANSPORT_SESSION_STATUS;
}

static bool is_transport_session_connect(const command_t *cmd)
{
    return cmd && cmd->length == EMW_USB_CMD_LANE_SIZE &&
           cmd->data[0] == EMW_OP_TRANSPORT_SESSION &&
           cmd->data[1] == EMW_TRANSPORT_SESSION_CONNECT;
}

static bool is_allowed_discovery_command(const command_t *cmd)
{
    if (!cmd || cmd->length != EMW_USB_CMD_LANE_SIZE) {
        return false;
    }

    switch (cmd->data[0]) {
        case EMW_OP_VERSION:
        case EMW_OP_HARDWARE_UID_GET:
        case EMW_OP_BOARD_GET:
        case EMW_OP_NAME_GET:
            return true;
        case EMW_OP_WIFI_CONFIG:
            return cmd->data[1] == EMW_WIFI_CFG_STATUS;
        case EMW_OP_TRANSPORT_SESSION:
            return cmd->data[1] == EMW_TRANSPORT_SESSION_STATUS;
        default:
            return false;
    }
}

bool transport_session_allows_command(const command_t *cmd)
{
    if (!cmd) {
        return false;
    }

    expire_stale_claim();

    if (is_transport_session_connect(cmd)) {
        return s_active_source == EMW_TRANSPORT_SOURCE_NONE ||
               s_active_source == cmd->source;
    }

    if (is_transport_session_status(cmd) || is_allowed_discovery_command(cmd)) {
        return true;
    }

    if (s_active_source == EMW_TRANSPORT_SOURCE_NONE) {
        return false;
    }

    if (s_active_source != cmd->source) {
        return false;
    }

    s_last_activity_tick = xTaskGetTickCount();
    return true;
}

bool transport_session_allows_stream(uint8_t source)
{
    expire_stale_claim();
    return s_active_source != EMW_TRANSPORT_SOURCE_NONE &&
           s_active_source == source;
}

uint8_t transport_session_active_source(void)
{
    expire_stale_claim();
    return s_active_source;
}

bool transport_session_connect(uint8_t source)
{
    expire_stale_claim();
    if (source == EMW_TRANSPORT_SOURCE_NONE) {
        return false;
    }
    if (s_active_source != EMW_TRANSPORT_SOURCE_NONE && s_active_source != source) {
        return false;
    }
    s_active_source = source;
    s_last_activity_tick = xTaskGetTickCount();
    return true;
}

bool transport_session_disconnect(uint8_t source)
{
    expire_stale_claim();
    if (s_active_source == EMW_TRANSPORT_SOURCE_NONE) {
        return true;
    }
    if (s_active_source != source) {
        return false;
    }
    s_active_source = EMW_TRANSPORT_SOURCE_NONE;
    return true;
}

bool transport_session_heartbeat(uint8_t source)
{
    expire_stale_claim();
    if (s_active_source != source || source == EMW_TRANSPORT_SOURCE_NONE) {
        return false;
    }
    s_last_activity_tick = xTaskGetTickCount();
    return true;
}
