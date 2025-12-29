/*
 * EMWaver Firmware - BLE Server
 * Copyright (C) 2025 Luís Marnoto
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

#include <string.h>
#include "esp_log.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "host/ble_att.h"
#include "ble_server.h"
#include "command_registry.h"
#include "ota_ble.h"
#include "ota_status.h"

static const char *TAG = "BLE_SERVER";
static const char *DEVICE_NAME = "EMWaver";

// Custom service UUID
static const ble_uuid128_t gatt_svr_svc_uuid =
    BLE_UUID128_INIT(0x91, 0x41, 0xb1, 0x15, 0x2a, 0x45, 0x47, 0xa8,
                     0x90, 0x4e, 0x3b, 0x0c, 0x8e, 0x15, 0xc7, 0x45);

// Command characteristic UUID
static const ble_uuid128_t gatt_cmd_chr_uuid =
    BLE_UUID128_INIT(0x91, 0x41, 0xb1, 0x15, 0x2a, 0x45, 0x47, 0xa8,
                     0x90, 0x4e, 0x3b, 0x0c, 0x8e, 0x15, 0xc7, 0x46);

// Notification characteristic UUID
static const ble_uuid128_t gatt_notif_chr_uuid =
    BLE_UUID128_INIT(0x91, 0x41, 0xb1, 0x15, 0x2a, 0x45, 0x47, 0xa8,
                     0x90, 0x4e, 0x3b, 0x0c, 0x8e, 0x15, 0xc7, 0x47);

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

static uint16_t notification_handle;
static uint16_t ota_status_handle;
static uint16_t notify_conn_handle = BLE_HS_CONN_HANDLE_NONE;
static uint8_t ble_addr_type;
static QueueHandle_t cmd_queue_handle = NULL;

// BLE circular buffer for transmission
#define BLE_RX_BUFFER_SIZE 4096
static uint8_t ble_rxBuffer[BLE_RX_BUFFER_SIZE];
static volatile uint16_t ble_rxBufferHeadPos = 0;
static volatile uint16_t ble_rxBufferTailPos = 0;
static uint8_t ble_transmitter_mode = 0;

// Include this declaration after the existing declarations, before ble_gap_event
static const struct ble_gap_upd_params CI_15_MS = {
    .itvl_min = 12,          // 12 × 1.25 ms = 15 ms
    .itvl_max = 12,          // same
    .latency  = 0,           // no slave latency
    .supervision_timeout = 200, // 2 s
    .min_ce_len = 0,         // leave at 0
    .max_ce_len = 0,
};

// Forward declaration for GAP event handler
static int ble_gap_event(struct ble_gap_event *event, void *arg);

// Debug utility functions
static void print_addr(const void *addr)
{
    const uint8_t *u8p;
    u8p = addr;
    ESP_LOGI(TAG, "%02x:%02x:%02x:%02x:%02x:%02x",
             u8p[5], u8p[4], u8p[3], u8p[2], u8p[1], u8p[0]);
}

// BLE Buffer handling functions
void BLE_InitRxBuffer() {
    memset(ble_rxBuffer, 0, BLE_RX_BUFFER_SIZE);
    ble_rxBufferHeadPos = 0;
    ble_rxBufferTailPos = 0;
}

void BLE_FlushRxBuffer() {
    memset(ble_rxBuffer, 0, BLE_RX_BUFFER_SIZE);
    ble_rxBufferHeadPos = 0;
    ble_rxBufferTailPos = 0;
}

uint16_t BLE_GetRxBufferBytesAvailable() {
    // Properly handle circular buffer wrap-around
    if (ble_rxBufferHeadPos >= ble_rxBufferTailPos) {
        // Simple case - head is ahead of tail
        return ble_rxBufferHeadPos - ble_rxBufferTailPos;
    } else {
        // Wrap-around case - head has wrapped to start of buffer
        return BLE_RX_BUFFER_SIZE - (ble_rxBufferTailPos - ble_rxBufferHeadPos);
    }
}

uint8_t BLE_ReadRxBuffer(uint8_t* Buf, uint16_t Len) {
    uint16_t bytesAvailable = BLE_GetRxBufferBytesAvailable();

    if (bytesAvailable < Len)
        return 1; // Not enough data available

    for (uint8_t i = 0; i < Len; i++) {
        Buf[i] = ble_rxBuffer[ble_rxBufferTailPos];
        ble_rxBufferTailPos = (uint16_t)((uint16_t)(ble_rxBufferTailPos + 1) % BLE_RX_BUFFER_SIZE);
    }

    return 0; // Success
}

void BLE_SendStatusPacket() {
    uint8_t packet[4];
    uint16_t status = BLE_GetRxBufferBytesAvailable();

    ESP_LOGI(TAG, "Sending buffer status: %u bytes available (head=%u, tail=%u)", 
             status, ble_rxBufferHeadPos, ble_rxBufferTailPos);

    // Header
    packet[0] = 'B'; // Header byte 1
    packet[1] = 'S'; // Header byte 2

    // Buffer size
    packet[2] = (uint8_t)(status >> 8);    // High byte
    packet[3] = (uint8_t)(status & 0xFF);  // Low byte

    // Send packet
    ble_server_notify(packet, 4);
}

/* GATT server functions */
static int gatt_svr_chr_access(uint16_t conn_handle, uint16_t attr_handle,
                               struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    const ble_uuid_t *uuid = ctxt->chr->uuid;
    int rc;

    // Only handling command characteristic
    if (ble_uuid_cmp(uuid, &gatt_cmd_chr_uuid.u) == 0) {
        switch (ctxt->op) {
            case BLE_GATT_ACCESS_OP_WRITE_CHR:
                if (cmd_queue_handle != NULL) {
                    // Get data from BLE
                    uint8_t data[256]; // Increase buffer to handle larger chunks (up to MTU)
                    uint16_t len = OS_MBUF_PKTLEN(ctxt->om);
                    
                    // Limit length to prevent overflow (shouldn't be needed if MTU is respected)
                    if (len > sizeof(data)) {
                        len = sizeof(data);
                    }

                    rc = ble_hs_mbuf_to_flat(ctxt->om, data, sizeof(data), &len);
                    if (rc != 0) {
                        return BLE_ATT_ERR_UNLIKELY;
                    }
                    
                    // If in transmitter mode, add data to circular buffer instead of command queue
                    if (ble_transmitter_mode) {
                        // Add data to circular buffer
                        uint16_t tempHeadPos = ble_rxBufferHeadPos;
                        for (uint16_t i = 0; i < len; i++) {
                            ble_rxBuffer[tempHeadPos] = data[i];
                            tempHeadPos = (uint16_t)((uint16_t)(tempHeadPos + 1) % BLE_RX_BUFFER_SIZE);
                            if (tempHeadPos == ble_rxBufferTailPos) {
                                // Buffer is full
                                break;
                            }
                        }
                        ble_rxBufferHeadPos = tempHeadPos;
                        
                        // Send buffer status back
                        BLE_SendStatusPacket();
                    } else {
                        command_t cmd;
                        cmd.length = len;
                        memcpy(cmd.data, data, len); // Use actual received len
                        
                        // Send to command queue
                        if (xQueueSendToBack(cmd_queue_handle, &cmd, 10) != pdTRUE) {
                            ESP_LOGE(TAG, "Failed to enqueue BLE command");
                        } else {
                            ESP_LOGD(TAG, "Received BLE command, length: %d", len);
                        }
                    }
                }
                return 0;
                
            default:
                return BLE_ATT_ERR_UNLIKELY;
        }
    }

    if (ble_uuid_cmp(uuid, &gatt_ota_ctrl_chr_uuid.u) == 0) {
        switch (ctxt->op) {
        case BLE_GATT_ACCESS_OP_WRITE_CHR: {
            uint8_t data[64];
            uint16_t len = OS_MBUF_PKTLEN(ctxt->om);

            if (len > sizeof(data)) {
                len = sizeof(data);
            }

            rc = ble_hs_mbuf_to_flat(ctxt->om, data, sizeof(data), &len);
            if (rc != 0) {
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

            rc = ble_hs_mbuf_to_flat(ctxt->om, data, sizeof(data), &len);
            if (rc != 0) {
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

// Define GATT services
static const struct ble_gatt_svc_def gatt_svr_svcs[] = {
    {
        // Service
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &gatt_svr_svc_uuid.u,
        .characteristics = (struct ble_gatt_chr_def[]) { 
            {
                // Command characteristic (write)
                .uuid = &gatt_cmd_chr_uuid.u,
                .access_cb = gatt_svr_chr_access,
                .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
            }, 
            {
                // Notification characteristic
                .uuid = &gatt_notif_chr_uuid.u,
                .access_cb = gatt_svr_chr_access,
                .flags = BLE_GATT_CHR_F_NOTIFY,
                .val_handle = &notification_handle,
            },
            {
                0, // End of characteristics
            }
        },
    },
    {
        // OTA Service
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &gatt_ota_svc_uuid.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            {
                // OTA control characteristic (write)
                .uuid = &gatt_ota_ctrl_chr_uuid.u,
                .access_cb = gatt_svr_chr_access,
                .flags = BLE_GATT_CHR_F_WRITE,
            },
            {
                // OTA data characteristic (write)
                .uuid = &gatt_ota_data_chr_uuid.u,
                .access_cb = gatt_svr_chr_access,
                .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP,
            },
            {
                // OTA status characteristic (notify)
                .uuid = &gatt_ota_status_chr_uuid.u,
                .access_cb = gatt_svr_chr_access,
                .flags = BLE_GATT_CHR_F_NOTIFY,
                .val_handle = &ota_status_handle,
            },
            {
                0,
            },
        },
    },
    {
        0, // End of services
    },
};

// Initialize GATT server
static int gatt_svr_init(void)
{
    int rc;
    
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

// Host task handles BLE events
static void ble_host_task(void *param)
{
    ESP_LOGI(TAG, "BLE Host Task Started");
    nimble_port_run();
    nimble_port_freertos_deinit();
}

// Start advertising
void ble_server_advertise(void)
{
    struct ble_gap_adv_params adv_params;
    struct ble_hs_adv_fields fields;
    int rc;
    
    // Configure advertising data
    memset(&fields, 0, sizeof(fields));
    
    fields.flags = BLE_HS_ADV_F_DISC_GEN | 
                   BLE_HS_ADV_F_BREDR_UNSUP;
    
    fields.tx_pwr_lvl_is_present = 1;
    fields.tx_pwr_lvl = BLE_HS_ADV_TX_PWR_LVL_AUTO;
    
    fields.name = (uint8_t *)DEVICE_NAME;
    fields.name_len = strlen(DEVICE_NAME);
    fields.name_is_complete = 1;
    
    rc = ble_gap_adv_set_fields(&fields);
    if (rc != 0) {
        ESP_LOGE(TAG, "Error setting advertisement data; rc=%d", rc);
        return;
    }
    
    // Start advertising
    memset(&adv_params, 0, sizeof(adv_params));
    adv_params.conn_mode = BLE_GAP_CONN_MODE_UND;
    adv_params.disc_mode = BLE_GAP_DISC_MODE_GEN;
    
    rc = ble_gap_adv_start(ble_addr_type, NULL, BLE_HS_FOREVER,
                         &adv_params, ble_gap_event, NULL);
    if (rc != 0) {
        ESP_LOGE(TAG, "Error enabling advertisement; rc=%d", rc);
        return;
    }
    
    ESP_LOGI(TAG, "BLE advertising started");
}

// Handle GAP events
static int ble_gap_event(struct ble_gap_event *event, void *arg)
{
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        // Connection established
        if (event->connect.status == 0) {
            ESP_LOGI(TAG, "Connection established");
            notify_conn_handle = event->connect.conn_handle;
            
            // Request connection parameter update for 15ms interval
            int rc = ble_gap_update_params(event->connect.conn_handle, &CI_15_MS);
            if (rc != 0) {
                ESP_LOGW(TAG, "Failed to request conn params update; rc=%d", rc);
            } else {
                ESP_LOGI(TAG, "Requested connection interval: 15ms");
            }
        } else {
            // Connection failed, restart advertising
            ESP_LOGI(TAG, "Connection failed, status: %d", event->connect.status);
            ble_server_advertise();
        }
        break;
        
    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGI(TAG, "Disconnected");
        // Reset connection handle
        notify_conn_handle = BLE_HS_CONN_HANDLE_NONE;
        ota_ble_on_disconnect();
        // Restart advertising
        ble_server_advertise();
        break;
        
    case BLE_GAP_EVENT_ADV_COMPLETE:
        ESP_LOGI(TAG, "Advertising complete");
        ble_server_advertise();
        break;
        
    case BLE_GAP_EVENT_SUBSCRIBE:
        ESP_LOGI(TAG, "Subscribe event; conn_handle=%d attr_handle=%d "
                 "reason=%d prevn=%d curn=%d previ=%d curi=%d\n",
                 event->subscribe.conn_handle,
                 event->subscribe.attr_handle,
                 event->subscribe.reason,
                 event->subscribe.prev_notify,
                 event->subscribe.cur_notify,
                 event->subscribe.prev_indicate,
                 event->subscribe.cur_indicate);
        break;
                 
    case BLE_GAP_EVENT_MTU:
        ESP_LOGI(TAG, "MTU update: %d", event->mtu.value);
        // Log additional information
        ESP_LOGI(TAG, "MTU update for connection handle: %d", event->mtu.conn_handle);
        ESP_LOGI(TAG, "New preferred MTU: %d", ble_att_preferred_mtu());
        break;
    }
    
    return 0;
}

// Callback when NimBLE stack is synced
static void on_sync(void)
{
    int rc;
    
    // Use address type from device configuration
    rc = ble_hs_id_infer_auto(0, &ble_addr_type);
    if (rc != 0) {
        ESP_LOGE(TAG, "Error determining address type; rc=%d", rc);
        return;
    }
    
    // Log device address
    uint8_t addr[6];
    rc = ble_hs_id_copy_addr(ble_addr_type, addr, NULL);
    if (rc == 0) {
        ESP_LOGI(TAG, "Device Address: ");
        print_addr(addr);
    }
    
    // Start advertising
    ble_server_advertise();
}

// Callback for NimBLE host reset
static void on_reset(int reason)
{
    ESP_LOGE(TAG, "BLE host reset, reason: %d", reason);
}

// Send notification to connected client
int ble_server_notify(const uint8_t* data, uint16_t len)
{
    return ble_server_notify_attr(notification_handle, data, len);
}

int ble_server_notify_attr(uint16_t attr_handle, const uint8_t *data, uint16_t len)
{
    struct os_mbuf *om;
    int rc;

    if (notify_conn_handle == BLE_HS_CONN_HANDLE_NONE) {
        return BLE_HS_ENOTCONN;
    }

    if (attr_handle == 0) {
        return BLE_ATT_ERR_UNLIKELY;
    }

    if (data == NULL || len == 0) {
        return 0;
    }

    // Compatibility: command responses and small status notifies are framed as a
    // fixed 64B packet (zero-padded) so clients can parse deterministically.
    // For larger payloads (e.g. sampler streaming), send the full payload
    // unpadded and without truncation (chunked by MTU if needed).
    if (len <= 64) {
        uint8_t padded[64];
        memset(padded, 0, sizeof(padded));
        memcpy(padded, data, len);

        om = ble_hs_mbuf_from_flat(padded, (uint16_t)sizeof(padded));
        if (om == NULL) {
            return BLE_HS_ENOMEM;
        }

        rc = ble_gatts_notify_custom(notify_conn_handle, attr_handle, om);
        if (rc != 0) {
            ESP_LOGE(TAG, "Failed to send notification: %d", rc);
        }
        return rc;
    }

    const uint16_t mtu = ble_att_mtu(notify_conn_handle);
    const uint16_t max_chunk = (mtu > 3) ? (uint16_t)(mtu - 3) : 20;
    uint16_t offset = 0;

    while (offset < len) {
        uint16_t chunk_len = (uint16_t)(len - offset);
        if (chunk_len > max_chunk) {
            chunk_len = max_chunk;
        }

        om = ble_hs_mbuf_from_flat(data + offset, chunk_len);
        if (om == NULL) {
            return BLE_HS_ENOMEM;
        }

        rc = ble_gatts_notify_custom(notify_conn_handle, attr_handle, om);
        if (rc != 0) {
            ESP_LOGE(TAG, "Failed to send notification: %d", rc);
            return rc;
        }

        offset = (uint16_t)(offset + chunk_len);
    }

    return 0;
}

// Set transmission mode
void ble_set_transmitter_mode(uint8_t mode) {
    ble_transmitter_mode = mode;
    if (mode) {
        BLE_InitRxBuffer();
    } else {
        BLE_FlushRxBuffer();
    }
}

// Get bytes available
uint16_t ble_get_rx_bytes_available() {
    return BLE_GetRxBufferBytesAvailable();
}

// Read from buffer
uint8_t ble_read_rx_buffer(uint8_t* buf, uint16_t len) {
    return BLE_ReadRxBuffer(buf, len);
}

// Initialize BLE server
void ble_server_init(QueueHandle_t cmd_queue)
{
    esp_err_t ret;
    
    // Save command queue handle
    cmd_queue_handle = cmd_queue;
    
    // Initialize NimBLE
    ret = nimble_port_init();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to init NimBLE: %d", ret);
        return;
    }
    
    // Configure NimBLE host
    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.reset_cb = on_reset;
    
    // Initialize services
    ble_svc_gap_init();
    ble_svc_gatt_init();
    
    // Initialize GATT server
    ret = gatt_svr_init();
    if (ret != 0) {
        ESP_LOGE(TAG, "Failed to init GATT server: %d", ret);
        return;
    }

    ota_ble_init();
    ota_status_set_attr_handle(ota_status_handle);
    
    // Set device name
    ret = ble_svc_gap_device_name_set(DEVICE_NAME);
    if (ret != 0) {
        ESP_LOGE(TAG, "Failed to set device name: %d", ret);
        return;
    }
    
    // Log the current preferred MTU value
    uint16_t preferred_mtu = ble_att_preferred_mtu();
    ESP_LOGI(TAG, "Current preferred MTU: %d bytes", preferred_mtu);
    
    // Set a larger preferred MTU explicitly (256 bytes)
    ble_att_set_preferred_mtu(256);
    ESP_LOGI(TAG, "Setting preferred MTU to 256 bytes");
    
    // Start BLE host task
    nimble_port_freertos_init(ble_host_task);
    
    ESP_LOGI(TAG, "BLE server initialized");
} 
