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
#include "emw_proto.h"
#include "transport_debug.h"
#include "transport_session.h"

#ifndef EMWAVER_ENABLE_OTA
#define EMWAVER_ENABLE_OTA 1
#endif

#if EMWAVER_ENABLE_OTA
#include "ota_ble_gatt.h"
#endif

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

static uint16_t notification_handle;
static uint16_t notify_conn_handle = BLE_HS_CONN_HANDLE_NONE;
static uint8_t ble_addr_type;
static QueueHandle_t cmd_queue_handle = NULL;

// BLE circular buffer for transmission
#define BLE_RX_BUFFER_SIZE 4096
#define EMW_BLE_SYSEX_BYTES 48u
#define EMW_BLE_ENCODED_BYTES 42u
#define EMW_BLE_FRAME_SIZE 36u
#define EMW_BLE_LANE_SIZE 18u
static uint8_t ble_rxBuffer[BLE_RX_BUFFER_SIZE];
static volatile uint16_t ble_rxBufferHeadPos = 0;
static volatile uint16_t ble_rxBufferTailPos = 0;
static uint8_t ble_transmitter_mode = 0;
static uint8_t ble_sysex_fragment_buffer[EMW_BLE_SYSEX_BYTES];
static uint16_t ble_sysex_fragment_len = 0;

static bool ble_matches_ascii_command_prefix(const uint8_t *data, uint16_t len, const char *prefix)
{
    if (!data || !prefix) {
        return false;
    }

    const size_t prefix_len = strlen(prefix);
    if (len < prefix_len) {
        return false;
    }

    if (memcmp(data, prefix, prefix_len) != 0) {
        return false;
    }

    if (len == prefix_len) {
        return true;
    }

    const uint8_t next = data[prefix_len];
    return next == 0 || next == '\n' || next == '\r' || next == ' ' || next == '\t';
}

static bool ble_decode_payload_7bit_fixed(const uint8_t *in, uint8_t *out)
{
    size_t in_pos = 0;
    size_t out_pos = 0;

    while (in_pos < EMW_BLE_ENCODED_BYTES && out_pos < EMW_BLE_FRAME_SIZE) {
        uint8_t prefix = in[in_pos++];
        for (uint8_t j = 0; j < 7u && out_pos < EMW_BLE_FRAME_SIZE; ++j) {
            if (in_pos >= EMW_BLE_ENCODED_BYTES) {
                return false;
            }
            uint8_t v = (uint8_t)(in[in_pos++] & 0x7Fu);
            if ((prefix & (uint8_t)(1u << j)) != 0u) {
                v |= 0x80u;
            }
            out[out_pos++] = v;
        }
    }

    return out_pos == EMW_BLE_FRAME_SIZE;
}

static void ble_encode_payload_7bit_fixed(const uint8_t *in, uint8_t *out)
{
    size_t in_pos = 0;
    size_t out_pos = 0;

    while (in_pos < EMW_BLE_FRAME_SIZE && out_pos < EMW_BLE_ENCODED_BYTES) {
        uint8_t prefix = 0;
        uint8_t chunk[7] = {0};
        uint8_t chunk_len = 0;

        for (uint8_t j = 0; j < 7u && in_pos < EMW_BLE_FRAME_SIZE; ++j) {
            uint8_t value = in[in_pos++];
            if ((value & 0x80u) != 0u) {
                prefix |= (uint8_t)(1u << j);
            }
            chunk[j] = (uint8_t)(value & 0x7Fu);
            chunk_len++;
        }

        out[out_pos++] = prefix;
        for (uint8_t j = 0; j < chunk_len; ++j) {
            out[out_pos++] = chunk[j];
        }
    }
}

static bool ble_enqueue_superframe(const uint8_t *sysex)
{
    if (!sysex || cmd_queue_handle == NULL) {
        return false;
    }
    if (sysex[0] != 0xF0 || sysex[1] != 0x7D ||
        sysex[2] != 'E' || sysex[3] != 'M' || sysex[4] != 'W' ||
        sysex[EMW_BLE_SYSEX_BYTES - 1u] != 0xF7) {
        return false;
    }

    uint8_t decoded[EMW_BLE_FRAME_SIZE];
    if (!ble_decode_payload_7bit_fixed(&sysex[5], decoded)) {
        return false;
    }

    bool cmd_any = false;
    for (size_t i = 0; i < EMW_BLE_LANE_SIZE; ++i) {
        if (decoded[i] != 0) {
            cmd_any = true;
            break;
        }
    }
    if (!cmd_any) {
        return true;
    }

    transport_debug_log_lane(EMW_COMMAND_SOURCE_BLE, "rx", decoded, EMW_BLE_LANE_SIZE);

    command_t cmd = {0};
    cmd.length = EMW_BLE_LANE_SIZE;
    cmd.source = EMW_COMMAND_SOURCE_BLE;
    memcpy(cmd.data, decoded, EMW_BLE_LANE_SIZE);
    return xQueueSendToBack(cmd_queue_handle, &cmd, 0) == pdTRUE;
}

static bool ble_ingest_sysex_fragment(const uint8_t *data, uint16_t len, bool *handled)
{
    if (handled) {
        *handled = false;
    }
    if (!data || len == 0 || cmd_queue_handle == NULL) {
        return false;
    }

    bool saw_sysex_byte = false;
    bool queued = false;

    for (uint16_t i = 0; i < len; ++i) {
        uint8_t value = data[i];

        if (value == 0xF0) {
            ble_sysex_fragment_len = 0;
            saw_sysex_byte = true;
        }

        if (ble_sysex_fragment_len == 0 && value != 0xF0) {
            continue;
        }

        saw_sysex_byte = true;
        if (ble_sysex_fragment_len >= EMW_BLE_SYSEX_BYTES) {
            ble_sysex_fragment_len = 0;
            continue;
        }

        ble_sysex_fragment_buffer[ble_sysex_fragment_len++] = value;

        if (value == 0xF7) {
            if (ble_sysex_fragment_len == EMW_BLE_SYSEX_BYTES) {
                queued = ble_enqueue_superframe(ble_sysex_fragment_buffer) || queued;
            }
            ble_sysex_fragment_len = 0;
        }
    }

    if (handled) {
        *handled = saw_sysex_byte;
    }
    return queued;
}

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

                    bool sysex_handled = false;
                    (void)ble_ingest_sysex_fragment(data, len, &sysex_handled);
                    if (sysex_handled) {
                        return 0;
                    }
                    
                    // If in transmitter mode, add data to circular buffer instead of command queue
                    if (ble_transmitter_mode) {
                        if (!transport_session_allows_stream(EMW_COMMAND_SOURCE_BLE)) {
                            return BLE_ATT_ERR_UNLIKELY;
                        }

                        // Allow an emergency stop command even while in transmitter mode.
                        // Transmit payloads are streamed in larger-than-64B chunks, while
                        // commands are fixed 64B ASCII packets (zero padded).
                        if (len == 64 && ble_matches_ascii_command_prefix(data, len, "transmit stop")) {
                            command_t cmd;
                            cmd.length = len;
                            memcpy(cmd.data, data, len);
                            if (xQueueSendToBack(cmd_queue_handle, &cmd, 10) != pdTRUE) {
                                ESP_LOGE(TAG, "Failed to enqueue BLE command (tx-mode stop)");
                            }
                            return 0;
                        }

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

    return BLE_ATT_ERR_UNLIKELY;
}

// Define GATT services
static const struct ble_gatt_svc_def gatt_svr_core_svcs[] = {
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
        0, // End of services
    },
};

// Initialize GATT server
static int gatt_svr_init(void)
{
    int rc;

    rc = ble_gatts_count_cfg(gatt_svr_core_svcs);
    if (rc != 0) {
        return rc;
    }

#if EMWAVER_ENABLE_OTA
    const struct ble_gatt_svc_def *ota_svcs = ota_ble_gatt_services();
    if (ota_svcs != NULL) {
        rc = ble_gatts_count_cfg(ota_svcs);
        if (rc != 0) {
            return rc;
        }
    }
#endif

    rc = ble_gatts_add_svcs(gatt_svr_core_svcs);
    if (rc != 0) {
        return rc;
    }

#if EMWAVER_ENABLE_OTA
    if (ota_svcs != NULL) {
        rc = ble_gatts_add_svcs(ota_svcs);
        if (rc != 0) {
            return rc;
        }
    }
#endif
    
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
    struct ble_hs_adv_fields rsp_fields;
    int rc;
    
    // Configure advertising data
    memset(&fields, 0, sizeof(fields));
    
    fields.flags = BLE_HS_ADV_F_DISC_GEN | 
                   BLE_HS_ADV_F_BREDR_UNSUP;
    
    fields.tx_pwr_lvl_is_present = 1;
    fields.tx_pwr_lvl = BLE_HS_ADV_TX_PWR_LVL_AUTO;
    
    fields.uuids128 = &gatt_svr_svc_uuid;
    fields.num_uuids128 = 1;
    fields.uuids128_is_complete = 1;
    
    rc = ble_gap_adv_set_fields(&fields);
    if (rc != 0) {
        ESP_LOGE(TAG, "Error setting advertisement data; rc=%d", rc);
        return;
    }

    memset(&rsp_fields, 0, sizeof(rsp_fields));
    rsp_fields.name = (uint8_t *)DEVICE_NAME;
    rsp_fields.name_len = strlen(DEVICE_NAME);
    rsp_fields.name_is_complete = 1;

    rc = ble_gap_adv_rsp_set_fields(&rsp_fields);
    if (rc != 0) {
        ESP_LOGE(TAG, "Error setting scan response data; rc=%d", rc);
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
            ble_sysex_fragment_len = 0;
            
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
        ble_sysex_fragment_len = 0;
#if EMWAVER_ENABLE_OTA
        ota_ble_gatt_on_disconnect();
#endif
        // Restart advertising
        ble_server_advertise();
        break;
        
    case BLE_GAP_EVENT_ADV_COMPLETE:
        ESP_LOGI(TAG, "Advertising complete");
        ble_server_advertise();
        break;
        
    case BLE_GAP_EVENT_SUBSCRIBE:
        ESP_LOGD(TAG, "Subscribe event; conn_handle=%d attr_handle=%d "
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
        ESP_LOGD(TAG, "MTU update: %d", event->mtu.value);
        // Log additional information
        ESP_LOGD(TAG, "MTU update for connection handle: %d", event->mtu.conn_handle);
        ESP_LOGD(TAG, "New preferred MTU: %d", ble_att_preferred_mtu());
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

int ble_server_send_superframe(const uint8_t *frame)
{
    if (!frame) {
        return BLE_ATT_ERR_UNLIKELY;
    }

    uint8_t encoded[EMW_BLE_ENCODED_BYTES];
    uint8_t sysex[EMW_BLE_SYSEX_BYTES];
    ble_encode_payload_7bit_fixed(frame, encoded);

    sysex[0] = 0xF0;
    sysex[1] = 0x7D;
    sysex[2] = 'E';
    sysex[3] = 'M';
    sysex[4] = 'W';
    memcpy(&sysex[5], encoded, sizeof(encoded));
    sysex[EMW_BLE_SYSEX_BYTES - 1u] = 0xF7;

    return ble_server_notify(sysex, sizeof(sysex));
}

int ble_server_send_cmd_response(uint8_t status, const uint8_t *payload, uint16_t payload_len)
{
    if (payload_len > (EMW_BLE_LANE_SIZE - 1u)) {
        payload_len = EMW_BLE_LANE_SIZE - 1u;
    }

    uint8_t frame[EMW_BLE_FRAME_SIZE] = {0};
    frame[0] = status;
    if (payload && payload_len > 0) {
        memcpy(&frame[1], payload, payload_len);
    }
    return ble_server_send_superframe(frame);
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
    esp_log_level_set("NimBLE", ESP_LOG_WARN);
    
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

#if EMWAVER_ENABLE_OTA
    ota_ble_gatt_init();
#endif
    
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
