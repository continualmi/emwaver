#include <inttypes.h>
#include <stdbool.h>
#include <string.h>

#include "esp_err.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mbedtls/sha256.h"

#include "ble_server.h"
#include "ota_ble.h"

static const char *TAG = "OTA_BLE";

enum {
    OTA_CMD_START = 0x01,
    OTA_CMD_ABORT = 0x02,
    OTA_CMD_END = 0x03,
};

enum {
    OTA_STATUS_READY = 0x10,
    OTA_STATUS_IN_PROGRESS = 0x11,
    OTA_STATUS_VERIFYING = 0x12,
    OTA_STATUS_SUCCESS = 0x13,
    OTA_STATUS_ERROR = 0x14,
    OTA_STATUS_ABORTED = 0x15,
};

typedef struct {
    bool active;
    esp_ota_handle_t handle;
    const esp_partition_t *partition;
    uint32_t total_size;
    uint32_t received;
    uint8_t expected_sha256[32];
    mbedtls_sha256_context sha256;
    uint16_t status_attr_handle;
    uint32_t last_notified_received;
} ota_session_t;

static ota_session_t g_session;

static void ota_ble_send_status(uint8_t status_code, uint8_t err_code)
{
    if (g_session.status_attr_handle == 0) {
        return;
    }

    uint8_t packet[14];
    packet[0] = 'O';
    packet[1] = 'T';
    packet[2] = 'A';
    packet[3] = 1; /* protocol version */
    packet[4] = status_code;

    uint32_t received = g_session.received;
    uint32_t total = g_session.total_size;

    packet[5] = (uint8_t)(received & 0xFF);
    packet[6] = (uint8_t)((received >> 8) & 0xFF);
    packet[7] = (uint8_t)((received >> 16) & 0xFF);
    packet[8] = (uint8_t)((received >> 24) & 0xFF);

    packet[9] = (uint8_t)(total & 0xFF);
    packet[10] = (uint8_t)((total >> 8) & 0xFF);
    packet[11] = (uint8_t)((total >> 16) & 0xFF);
    packet[12] = (uint8_t)((total >> 24) & 0xFF);

    packet[13] = err_code;

    (void)ble_server_notify_attr(g_session.status_attr_handle, packet, sizeof(packet));
}

static void ota_ble_reset_session(void)
{
    if (g_session.active) {
        esp_ota_abort(g_session.handle);
    }

    memset(&g_session, 0, sizeof(g_session));
}

static void ota_ble_restart_task(void *arg)
{
    (void)arg;
    vTaskDelay(pdMS_TO_TICKS(500));
    esp_restart();
}

void ota_ble_init(void)
{
    memset(&g_session, 0, sizeof(g_session));
}

void ota_ble_set_status_attr_handle(uint16_t attr_handle)
{
    g_session.status_attr_handle = attr_handle;
}

void ota_ble_on_disconnect(void)
{
    if (!g_session.active) {
        return;
    }

    ESP_LOGW(TAG, "Disconnected during OTA; aborting");
    ota_ble_send_status(OTA_STATUS_ABORTED, 0x01);
    ota_ble_reset_session();
}

static int ota_ble_start(const uint8_t *data, uint16_t len)
{
    if (len < 1 + 4 + 32) {
        return -1;
    }

    if (g_session.active) {
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

    const esp_partition_t *update_partition = esp_ota_get_next_update_partition(NULL);
    if (update_partition == NULL) {
        ESP_LOGE(TAG, "No OTA partition available");
        return -1;
    }

    ESP_LOGI(TAG, "Starting OTA: total=%" PRIu32 " bytes, target=%s @ 0x%" PRIx32,
             total_size, update_partition->label, (uint32_t)update_partition->address);

    esp_ota_handle_t handle = 0;
    esp_err_t err = esp_ota_begin(update_partition, total_size, &handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_begin failed: %s", esp_err_to_name(err));
        return -1;
    }

    memset(&g_session, 0, sizeof(g_session));
    g_session.active = true;
    g_session.handle = handle;
    g_session.partition = update_partition;
    g_session.total_size = total_size;
    g_session.received = 0;
    memcpy(g_session.expected_sha256, &data[5], 32);

    mbedtls_sha256_init(&g_session.sha256);
    if (mbedtls_sha256_starts(&g_session.sha256, 0) != 0) {
        ESP_LOGE(TAG, "sha256_starts failed");
        ota_ble_reset_session();
        return -1;
    }

    g_session.last_notified_received = 0;
    ota_ble_send_status(OTA_STATUS_READY, 0x00);
    return 0;
}

static int ota_ble_end(void)
{
    if (!g_session.active) {
        return -1;
    }

    if (g_session.received != g_session.total_size) {
        ESP_LOGE(TAG, "OTA size mismatch: received=%" PRIu32 " total=%" PRIu32,
                 g_session.received, g_session.total_size);
        ota_ble_send_status(OTA_STATUS_ERROR, 0x02);
        ota_ble_reset_session();
        return -1;
    }

    ota_ble_send_status(OTA_STATUS_VERIFYING, 0x00);

    uint8_t computed_sha[32];
    if (mbedtls_sha256_finish(&g_session.sha256, computed_sha) != 0) {
        ESP_LOGE(TAG, "sha256_finish failed");
        ota_ble_send_status(OTA_STATUS_ERROR, 0x03);
        ota_ble_reset_session();
        return -1;
    }
    mbedtls_sha256_free(&g_session.sha256);

    if (memcmp(computed_sha, g_session.expected_sha256, sizeof(computed_sha)) != 0) {
        ESP_LOGE(TAG, "SHA-256 mismatch");
        ota_ble_send_status(OTA_STATUS_ERROR, 0x04);
        ota_ble_reset_session();
        return -1;
    }

    esp_err_t err = esp_ota_end(g_session.handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_end failed: %s", esp_err_to_name(err));
        ota_ble_send_status(OTA_STATUS_ERROR, 0x05);
        ota_ble_reset_session();
        return -1;
    }

    err = esp_ota_set_boot_partition(g_session.partition);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_set_boot_partition failed: %s", esp_err_to_name(err));
        ota_ble_send_status(OTA_STATUS_ERROR, 0x06);
        ota_ble_reset_session();
        return -1;
    }

    ota_ble_send_status(OTA_STATUS_SUCCESS, 0x00);
    g_session.active = false;

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
        ota_ble_send_status(OTA_STATUS_ABORTED, 0x00);
        ota_ble_reset_session();
        return 0;
    case OTA_CMD_END:
        return ota_ble_end() == 0 ? 0 : -1;
    default:
        return -1;
    }
}

int ota_ble_handle_data_write(const uint8_t *data, uint16_t len)
{
    if (!g_session.active) {
        return -1;
    }

    if (len == 0) {
        return 0;
    }

    if (g_session.received + (uint32_t)len > g_session.total_size) {
        ESP_LOGE(TAG, "Write exceeds declared size");
        ota_ble_send_status(OTA_STATUS_ERROR, 0x07);
        ota_ble_reset_session();
        return -1;
    }

    esp_err_t err = esp_ota_write(g_session.handle, data, len);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_write failed: %s", esp_err_to_name(err));
        ota_ble_send_status(OTA_STATUS_ERROR, 0x08);
        ota_ble_reset_session();
        return -1;
    }

    if (mbedtls_sha256_update(&g_session.sha256, data, len) != 0) {
        ESP_LOGE(TAG, "sha256_update failed");
        ota_ble_send_status(OTA_STATUS_ERROR, 0x09);
        ota_ble_reset_session();
        return -1;
    }

    g_session.received += (uint32_t)len;

    if (g_session.received - g_session.last_notified_received >= 4096 ||
        g_session.received == g_session.total_size) {
        g_session.last_notified_received = g_session.received;
        ota_ble_send_status(OTA_STATUS_IN_PROGRESS, 0x00);
    }

    return 0;
}
