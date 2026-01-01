/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#include <string.h>

#include "esp_err.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "ble_server.h"
#include "ota_ble.h"
#include "ota_core.h"
#include "ota_status.h"
#include "ota_wifi.h"

static const char *TAG = "OTA_BLE";

enum {
    OTA_CMD_START = 0x01,
    OTA_CMD_ABORT = 0x02,
    OTA_CMD_END = 0x03,
    OTA_CMD_WIFI_START = 0x10,
    OTA_CMD_WIFI_STOP = 0x11,
};

enum {
    OTA_STATUS_READY = 0x10,
    OTA_STATUS_IN_PROGRESS = 0x11,
    OTA_STATUS_VERIFYING = 0x12,
    OTA_STATUS_SUCCESS = 0x13,
    OTA_STATUS_ERROR = 0x14,
    OTA_STATUS_ABORTED = 0x15,
};

static bool g_ble_session_active;
static uint32_t g_last_notified_received;

static void ota_ble_restart_task(void *arg)
{
    (void)arg;
    vTaskDelay(pdMS_TO_TICKS(2000));
    esp_restart();
}

void ota_ble_init(void)
{
    g_ble_session_active = false;
    g_last_notified_received = 0;
    ota_core_init();
    ota_status_init();
}

void ota_ble_on_disconnect(void)
{
    if (!g_ble_session_active) {
        return;
    }

    ESP_LOGW(TAG, "Disconnected during OTA; aborting");
    ota_status_notify(OTA_STATUS_ABORTED, 0x01, ota_core_received_size(), ota_core_total_size());
    ota_core_abort();
    g_ble_session_active = false;
}

static int ota_ble_start(const uint8_t *data, uint16_t len)
{
    if (len < 1 + 4 + 32) {
        return -1;
    }

    if (ota_core_is_active()) {
        ESP_LOGW(TAG, "OTA already active");
        return -1;
    }

    uint32_t total_size = (uint32_t)data[1] |
                          ((uint32_t)data[2] << 8) |
                          ((uint32_t)data[3] << 16) |
                          ((uint32_t)data[4] << 24);

    if (total_size == 0) {
        ESP_LOGE(TAG, "Invalid total size");
        return -1;
    }

    esp_err_t err = ota_core_start(total_size, &data[5]);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "ota_core_start failed: %s", esp_err_to_name(err));
        return -1;
    }

    g_ble_session_active = true;
    g_last_notified_received = 0;
    ota_status_notify(OTA_STATUS_READY, 0x00, 0, total_size);
    return 0;
}

static int ota_ble_end(void)
{
    if (!ota_core_is_active()) {
        return -1;
    }

    ota_status_notify(OTA_STATUS_VERIFYING, 0x00, ota_core_received_size(), ota_core_total_size());

    esp_err_t err = ota_core_finish();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "ota_core_finish failed: %s", esp_err_to_name(err));
        ota_status_notify(OTA_STATUS_ERROR, 0x05, ota_core_received_size(), ota_core_total_size());
        return -1;
    }

    ota_status_notify(OTA_STATUS_SUCCESS, 0x00, ota_core_total_size(), ota_core_total_size());
    g_ble_session_active = false;

    (void)xTaskCreate(ota_ble_restart_task, "ota_restart", 2048, NULL, 5, NULL);
    return 0;
}

int ota_ble_handle_control_write(const uint8_t *data, uint16_t len)
{
    if (len < 1) {
        return 0;
    }

    switch (data[0]) {
    case OTA_CMD_START:
        return ota_ble_start(data, len) == 0 ? 0 : -1;
    case OTA_CMD_ABORT:
        ota_status_notify(OTA_STATUS_ABORTED, 0x00, ota_core_received_size(), ota_core_total_size());
        ota_core_abort();
        g_ble_session_active = false;
        return 0;
    case OTA_CMD_WIFI_START: {
        esp_err_t err = ota_wifi_start_softap();
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Failed to start OTA WiFi softap: %s", esp_err_to_name(err));
            ota_status_notify(OTA_STATUS_ERROR, 0x30, 0, 0);
            return -1;
        }
        return 0;
    }
    case OTA_CMD_WIFI_STOP:
        ota_wifi_stop();
        return 0;
    case OTA_CMD_END:
        return ota_ble_end() == 0 ? 0 : -1;
    default:
        return -1;
    }
}

int ota_ble_handle_data_write(const uint8_t *data, uint16_t len)
{
    if (!ota_core_is_active() || !g_ble_session_active) {
        return -1;
    }

    if (len == 0) {
        return 0;
    }

    esp_err_t err = ota_core_write(data, len);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "ota_core_write failed: %s", esp_err_to_name(err));
        ota_status_notify(OTA_STATUS_ERROR, 0x08, ota_core_received_size(), ota_core_total_size());
        ota_core_abort();
        g_ble_session_active = false;
        return -1;
    }

    uint32_t received = ota_core_received_size();
    uint32_t total = ota_core_total_size();
    if (received - g_last_notified_received >= 4096 || received == total) {
        g_last_notified_received = received;
        ota_status_notify(OTA_STATUS_IN_PROGRESS, 0x00, received, total);
    }

    return 0;
}
