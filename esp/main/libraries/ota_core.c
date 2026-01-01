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

#include "ota_core.h"

#include <inttypes.h>
#include <string.h>

#include "esp_log.h"
#include "esp_ota_ops.h"
#include "mbedtls/sha256.h"

static const char *TAG = "OTA_CORE";

typedef struct {
    bool active;
    esp_ota_handle_t handle;
    const esp_partition_t *partition;
    uint32_t total_size;
    uint32_t received;
    uint8_t expected_sha256[32];
    mbedtls_sha256_context sha256;
    bool sha256_active;
} ota_core_session_t;

static ota_core_session_t g_session;

void ota_core_init(void)
{
    memset(&g_session, 0, sizeof(g_session));
}

bool ota_core_is_active(void)
{
    return g_session.active;
}

uint32_t ota_core_total_size(void)
{
    return g_session.total_size;
}

uint32_t ota_core_received_size(void)
{
    return g_session.received;
}

void ota_core_abort(void)
{
    if (g_session.active) {
        esp_ota_abort(g_session.handle);
    }
    if (g_session.sha256_active) {
        mbedtls_sha256_free(&g_session.sha256);
    }
    memset(&g_session, 0, sizeof(g_session));
}

esp_err_t ota_core_start(uint32_t total_size, const uint8_t expected_sha256[32])
{
    if (g_session.active) {
        return ESP_ERR_INVALID_STATE;
    }

    if (total_size == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    const esp_partition_t *update_partition = esp_ota_get_next_update_partition(NULL);
    if (update_partition == NULL) {
        ESP_LOGE(TAG, "No OTA partition available");
        return ESP_ERR_NOT_FOUND;
    }

    ESP_LOGI(TAG, "OTA begin: total=%" PRIu32 " bytes, target=%s @ 0x%" PRIx32,
             total_size, update_partition->label, (uint32_t)update_partition->address);

    esp_ota_handle_t handle = 0;
    esp_err_t err = esp_ota_begin(update_partition, total_size, &handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_begin failed: %s", esp_err_to_name(err));
        return err;
    }

    memset(&g_session, 0, sizeof(g_session));
    g_session.active = true;
    g_session.handle = handle;
    g_session.partition = update_partition;
    g_session.total_size = total_size;
    g_session.received = 0;
    memcpy(g_session.expected_sha256, expected_sha256, 32);

    mbedtls_sha256_init(&g_session.sha256);
    if (mbedtls_sha256_starts(&g_session.sha256, 0) != 0) {
        ESP_LOGE(TAG, "sha256_starts failed");
        ota_core_abort();
        return ESP_FAIL;
    }
    g_session.sha256_active = true;

    return ESP_OK;
}

esp_err_t ota_core_write(const uint8_t *data, size_t len)
{
    if (!g_session.active) {
        return ESP_ERR_INVALID_STATE;
    }

    if (len == 0) {
        return ESP_OK;
    }

    if (g_session.received + (uint32_t)len > g_session.total_size) {
        ESP_LOGE(TAG, "Write exceeds declared size");
        return ESP_ERR_INVALID_SIZE;
    }

    esp_err_t err = esp_ota_write(g_session.handle, data, len);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_write failed: %s", esp_err_to_name(err));
        return err;
    }

    if (mbedtls_sha256_update(&g_session.sha256, data, len) != 0) {
        ESP_LOGE(TAG, "sha256_update failed");
        return ESP_FAIL;
    }

    g_session.received += (uint32_t)len;
    return ESP_OK;
}

esp_err_t ota_core_finish(void)
{
    if (!g_session.active) {
        return ESP_ERR_INVALID_STATE;
    }

    if (g_session.received != g_session.total_size) {
        ESP_LOGE(TAG, "OTA size mismatch: received=%" PRIu32 " total=%" PRIu32,
                 g_session.received, g_session.total_size);
        ota_core_abort();
        return ESP_ERR_INVALID_SIZE;
    }

    uint8_t computed_sha[32];
    if (mbedtls_sha256_finish(&g_session.sha256, computed_sha) != 0) {
        ESP_LOGE(TAG, "sha256_finish failed");
        ota_core_abort();
        return ESP_FAIL;
    }
    mbedtls_sha256_free(&g_session.sha256);
    g_session.sha256_active = false;

    if (memcmp(computed_sha, g_session.expected_sha256, sizeof(computed_sha)) != 0) {
        ESP_LOGE(TAG, "SHA-256 mismatch");
        ota_core_abort();
        return ESP_ERR_INVALID_CRC;
    }

    esp_err_t err = esp_ota_end(g_session.handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_end failed: %s", esp_err_to_name(err));
        ota_core_abort();
        return err;
    }

    err = esp_ota_set_boot_partition(g_session.partition);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_set_boot_partition failed: %s", esp_err_to_name(err));
        ota_core_abort();
        return err;
    }

    g_session.active = false;
    return ESP_OK;
}

