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

#include "ota_ble_gatt.h"

#include <string.h>

#include "esp_log.h"
#include "host/ble_hs.h"
#include "nimble/ble.h"

#include "ota_ble.h"
#include "ota_status.h"

static const char *TAG = "OTA_GATT";

#ifndef EMWAVER_ENABLE_OTA
#define EMWAVER_ENABLE_OTA 1
#endif

// OTA service UUID
static const ble_uuid128_t gatt_ota_svc_uuid =
    BLE_UUID128_INIT(0x92, 0x41, 0xb1, 0x15, 0x2a, 0x45, 0x47, 0xa8,
                     0x90, 0x4e, 0x3b, 0x0c, 0x8e, 0x15, 0xc7, 0x45);

// OTA control characteristic UUID (write)
static const ble_uuid128_t gatt_ota_ctrl_chr_uuid =
    BLE_UUID128_INIT(0x93, 0x41, 0xb1, 0x15, 0x2a, 0x45, 0x47, 0xa8,
                     0x90, 0x4e, 0x3b, 0x0c, 0x8e, 0x15, 0xc7, 0x45);

// OTA data characteristic UUID (write no response)
static const ble_uuid128_t gatt_ota_data_chr_uuid =
    BLE_UUID128_INIT(0x94, 0x41, 0xb1, 0x15, 0x2a, 0x45, 0x47, 0xa8,
                     0x90, 0x4e, 0x3b, 0x0c, 0x8e, 0x15, 0xc7, 0x45);

// OTA status characteristic UUID (notify)
static const ble_uuid128_t gatt_ota_status_chr_uuid =
    BLE_UUID128_INIT(0x95, 0x41, 0xb1, 0x15, 0x2a, 0x45, 0x47, 0xa8,
                     0x90, 0x4e, 0x3b, 0x0c, 0x8e, 0x15, 0xc7, 0x45);

static uint16_t g_ota_status_handle;

static int ota_gatt_access(uint16_t conn_handle, uint16_t attr_handle, struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    (void)conn_handle;
    (void)attr_handle;
    (void)arg;

    const ble_uuid_t *uuid = ctxt->chr->uuid;

    if (ble_uuid_cmp(uuid, &gatt_ota_ctrl_chr_uuid.u) == 0) {
        switch (ctxt->op) {
        case BLE_GATT_ACCESS_OP_WRITE_CHR: {
            uint8_t data[64];
            uint16_t len = OS_MBUF_PKTLEN(ctxt->om);
            if (len > sizeof(data)) {
                len = sizeof(data);
            }

            int rc = ble_hs_mbuf_to_flat(ctxt->om, data, sizeof(data), &len);
            if (rc != 0) {
                ESP_LOGW(TAG, "ota ctrl write mbuf_to_flat failed: %d", rc);
                return BLE_ATT_ERR_UNLIKELY;
            }

            if (ota_ble_handle_control_write(data, len) != 0) {
                return BLE_ATT_ERR_UNLIKELY;
            }

            return 0;
        }
        default:
            return BLE_ATT_ERR_UNLIKELY;
        }
    }

    if (ble_uuid_cmp(uuid, &gatt_ota_data_chr_uuid.u) == 0) {
        switch (ctxt->op) {
        case BLE_GATT_ACCESS_OP_WRITE_CHR: {
            uint8_t data[256];
            uint16_t len = OS_MBUF_PKTLEN(ctxt->om);
            if (len > sizeof(data)) {
                len = sizeof(data);
            }

            int rc = ble_hs_mbuf_to_flat(ctxt->om, data, sizeof(data), &len);
            if (rc != 0) {
                ESP_LOGW(TAG, "ota data write mbuf_to_flat failed: %d", rc);
                return BLE_ATT_ERR_UNLIKELY;
            }

            if (ota_ble_handle_data_write(data, len) != 0) {
                return BLE_ATT_ERR_UNLIKELY;
            }

            return 0;
        }
        default:
            return BLE_ATT_ERR_UNLIKELY;
        }
    }

    return BLE_ATT_ERR_UNLIKELY;
}

static const struct ble_gatt_svc_def gatt_ota_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &gatt_ota_svc_uuid.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            {
                .uuid = &gatt_ota_ctrl_chr_uuid.u,
                .access_cb = ota_gatt_access,
                .flags = BLE_GATT_CHR_F_WRITE,
            },
            {
                .uuid = &gatt_ota_data_chr_uuid.u,
                .access_cb = ota_gatt_access,
                .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
            },
            {
                .uuid = &gatt_ota_status_chr_uuid.u,
                .access_cb = ota_gatt_access,
                .flags = BLE_GATT_CHR_F_NOTIFY,
                .val_handle = &g_ota_status_handle,
            },
            {
                0,
            },
        },
    },
    {
        0,
    },
};

const struct ble_gatt_svc_def *ota_ble_gatt_services(void)
{
#if EMWAVER_ENABLE_OTA
    return gatt_ota_svcs;
#else
    return NULL;
#endif
}

void ota_ble_gatt_init(void)
{
#if EMWAVER_ENABLE_OTA
    ota_ble_init();
    ota_status_set_attr_handle(g_ota_status_handle);
#endif
}

void ota_ble_gatt_on_disconnect(void)
{
#if EMWAVER_ENABLE_OTA
    ota_ble_on_disconnect();
#endif
}

