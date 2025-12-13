/*
 * SPDX-FileCopyrightText: 2017-2023 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "host/ble_hs.h"
#include "host/ble_uuid.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

// Custom service UUID (generate your own using a UUID generator)
static const ble_uuid128_t gatt_svr_svc_uuid =
    BLE_UUID128_INIT(0x91, 0x41, 0xb1, 0x15, 0x2a, 0x45, 0x47, 0xa8,
                     0x90, 0x4e, 0x3b, 0x0c, 0x8e, 0x15, 0xc7, 0x45);

// Custom characteristic UUID
static const ble_uuid128_t gatt_svr_chr_uuid =
    BLE_UUID128_INIT(0x91, 0x41, 0xb1, 0x15, 0x2a, 0x45, 0x47, 0xa8,
                     0x90, 0x4e, 0x3b, 0x0c, 0x8e, 0x15, 0xc7, 0x46);

// Move this declaration to the top with other static declarations, before any functions
static uint16_t gatt_svr_chr_val_handle;
static QueueHandle_t ble_data_queue = NULL;
static uint16_t notify_conn_handle = BLE_HS_CONN_HANDLE_NONE;

// Add this function to send data back to the phone
int gatt_svr_notify(const char* data) {
    struct os_mbuf *om;
    int rc;

    if (notify_conn_handle == BLE_HS_CONN_HANDLE_NONE) {
        return BLE_HS_ENOTCONN;
    }

    om = ble_hs_mbuf_from_flat(data, strlen(data));
    if (om == NULL) {
        return BLE_HS_ENOMEM;
    }

    rc = ble_gattc_notify_custom(notify_conn_handle, gatt_svr_chr_val_handle, om);
    if (rc != 0) {
        ESP_LOGE("BLE_SERVER", "Failed to send notification: %d", rc);
    }
    return rc;
}

void gatt_svr_set_queue(QueueHandle_t queue) {
    ble_data_queue = queue;
}

void gatt_svr_set_notify_conn_handle(uint16_t conn_handle) {
    notify_conn_handle = conn_handle;
}

static int
gatt_svr_chr_write(struct os_mbuf *om, uint16_t min_len, uint16_t max_len,
                   void *dst, uint16_t *len)
{
    uint16_t om_len;
    int rc;

    om_len = OS_MBUF_PKTLEN(om);
    if (om_len < min_len || om_len > max_len) {
        return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }

    rc = ble_hs_mbuf_to_flat(om, dst, max_len, len);
    if (rc != 0) {
        return BLE_ATT_ERR_UNLIKELY;
    }

    return 0;
}

static int
gatt_svr_chr_access(uint16_t conn_handle, uint16_t attr_handle,
                    struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    const char *tag = "BLE_SERVER";
    uint16_t len;
    char buf[100];
    int rc;

    switch (ctxt->op) {
        case BLE_GATT_ACCESS_OP_WRITE_CHR:
            rc = gatt_svr_chr_write(ctxt->om, 0, sizeof(buf) - 1, buf, &len);
            if (rc != 0) {
                return rc;
            }

            buf[len] = '\0';
            ESP_LOGI(tag, "Received data: %s", buf);

            if (ble_data_queue != NULL) {
                if (xQueueSend(ble_data_queue, buf, pdMS_TO_TICKS(100)) != pdTRUE) {
                    ESP_LOGE(tag, "Failed to send data to queue");
                }
            }
            return 0;

        case BLE_GATT_ACCESS_OP_READ_CHR:
            // Handle read requests if needed
            return 0;

        default:
            return BLE_ATT_ERR_UNLIKELY;
    }
}

static const struct ble_gatt_svc_def gatt_svr_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &gatt_svr_svc_uuid.u,
        .characteristics = (struct ble_gatt_chr_def[]) { {
            .uuid = &gatt_svr_chr_uuid.u,
            .access_cb = gatt_svr_chr_access,
            .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_NOTIFY,
            .val_handle = &gatt_svr_chr_val_handle,
        }, {
            0,
        } },
    },
    {
        0,
    },
};

int
gatt_svr_init(void)
{
    int rc;

    ble_svc_gap_init();
    ble_svc_gatt_init();

    rc = ble_gatts_count_cfg(gatt_svr_svcs);
    if (rc != 0) {
        return rc;
    }

    rc = ble_gatts_add_svcs(gatt_svr_svcs);
    if (rc != 0) {
        return rc;
    }

    return 0;
}
