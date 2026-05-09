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

#include "usb.h"

#include <stdio.h>
#include <string.h>

#include "esp_err.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "emw_target.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "tinyusb.h"
#include "tusb.h"

static const char *TAG = "USB";

enum interface_count {
#if CFG_TUD_MIDI
    ITF_NUM_MIDI = 0,
    ITF_NUM_MIDI_STREAMING,
#endif
    ITF_COUNT,
};

enum usb_endpoints {
    EP_EMPTY = 0,
#if CFG_TUD_MIDI
    EPNUM_MIDI,
#endif
};

#define EMW_MIDI_PACKET_SIZE 4u
#define EMW_SYSEX_BYTES 48u
#define EMW_ENCODED_BYTES 42u
#define EMW_LANE_SIZE 18u
#define EMW_CABLE_NUM 0u
#define EMW_RX_TASK_STACK 4096
#define EMW_RX_BUFFER_SIZE 512u
#define EMW_USB_TX_TIMEOUT_MS 100u

#define TUSB_DESCRIPTOR_TOTAL_LEN (TUD_CONFIG_DESC_LEN + CFG_TUD_MIDI * TUD_MIDI_DESC_LEN)

static const uint8_t s_midi_cfg_desc[] = {
    TUD_CONFIG_DESCRIPTOR(1, ITF_COUNT, 0, TUSB_DESCRIPTOR_TOTAL_LEN, 0, 100),
    TUD_MIDI_DESCRIPTOR(ITF_NUM_MIDI, 4, EPNUM_MIDI, (0x80 | EPNUM_MIDI), 64),
};

#if (TUD_OPT_HIGH_SPEED)
static const uint8_t s_midi_hs_cfg_desc[] = {
    TUD_CONFIG_DESCRIPTOR(1, ITF_COUNT, 0, TUSB_DESCRIPTOR_TOTAL_LEN, 0, 100),
    TUD_MIDI_DESCRIPTOR(ITF_NUM_MIDI, 4, EPNUM_MIDI, (0x80 | EPNUM_MIDI), 512),
};
#endif

static char s_serial_string[13];
static const char *s_string_desc[] = {
    (char[]){0x09, 0x04},
    "EMWaver",
    "EMWaver " EMW_TARGET_DEVICE_NAME_PREFIX,
    s_serial_string,
    "EMWaver MIDI",
};

static QueueHandle_t s_cmd_queue;
static bool s_usb_ready;
static bool s_driver_installed;
static SemaphoreHandle_t s_tx_mutex;
static uint8_t s_rx_buffer[EMW_RX_BUFFER_SIZE];
static uint16_t s_rx_head;
static uint16_t s_rx_tail;
static volatile emw_buffer_type_t s_buffer_type = EMW_BUFFER_PACKET;
static volatile uint8_t s_pending_cmd_lane[EMW_LANE_SIZE];
static volatile bool s_pending_cmd_ready;
static volatile uint16_t s_pending_bs_status;
static volatile bool s_pending_bs_ready;

static void usb_midi_rx_task(void *arg);
static bool decode_payload_7bit_fixed(const uint8_t *in, uint8_t *out);
static void encode_payload_7bit_fixed(const uint8_t *in, uint8_t *out);
static void process_sysex_frame(const uint8_t *sysex);
static void build_serial_string(void);
static esp_err_t send_frame(const uint8_t *frame, bool nonblocking);
static esp_err_t send_status_frame(uint16_t status, bool nonblocking);
static size_t fill_frame_from_pending(uint8_t *frame, const uint8_t *stream_lane);

void usb_init(QueueHandle_t cmd_queue)
{
    if (s_driver_installed) {
        return;
    }

    s_cmd_queue = cmd_queue;
    s_tx_mutex = xSemaphoreCreateMutex();
    configASSERT(s_tx_mutex != NULL);
    usb_init_rx_buffer();
    build_serial_string();

    tinyusb_config_t const tusb_cfg = {
        .device_descriptor = NULL,
        .string_descriptor = s_string_desc,
        .string_descriptor_count = sizeof(s_string_desc) / sizeof(s_string_desc[0]),
        .external_phy = false,
#if (TUD_OPT_HIGH_SPEED)
        .fs_configuration_descriptor = s_midi_cfg_desc,
        .hs_configuration_descriptor = s_midi_hs_cfg_desc,
        .qualifier_descriptor = NULL,
#else
        .configuration_descriptor = s_midi_cfg_desc,
#endif
    };

    ESP_ERROR_CHECK(tinyusb_driver_install(&tusb_cfg));
    BaseType_t created = xTaskCreate(usb_midi_rx_task, "emw_usb_rx", EMW_RX_TASK_STACK, NULL, 5, NULL);
    configASSERT(created == pdPASS);
    s_driver_installed = true;
    ESP_LOGI(TAG, "usb-midi transport initialized");
}

bool usb_is_ready(void)
{
    return s_usb_ready && tud_midi_mounted();
}

esp_err_t usb_send_cmd_response(uint8_t status, const uint8_t *payload, size_t payload_len)
{
    if (payload_len > (EMW_LANE_SIZE - 1u)) {
        payload_len = EMW_LANE_SIZE - 1u;
    }

    uint8_t lane[EMW_LANE_SIZE] = {0};
    lane[0] = status;
    if (payload && payload_len > 0) {
        memcpy(&lane[1], payload, payload_len);
    }

    if (s_buffer_type != EMW_BUFFER_PACKET) {
        memcpy((void *)s_pending_cmd_lane, lane, sizeof(lane));
        s_pending_cmd_ready = true;
        return ESP_OK;
    }

    uint8_t frame[EMW_USB_FRAME_SIZE] = {0};
    memcpy(frame, lane, sizeof(lane));
    return send_frame(frame, false);
}

esp_err_t usb_send_stream_lane(const uint8_t *stream_lane, bool nonblocking)
{
    uint8_t frame[EMW_USB_FRAME_SIZE] = {0};
    (void)fill_frame_from_pending(frame, stream_lane);
    return send_frame(frame, nonblocking);
}

bool usb_ingest_stream_lane(const uint8_t *stream_lane, uint16_t *bytes_available)
{
    if (!stream_lane || s_buffer_type != EMW_BUFFER_CIRCULAR) {
        return false;
    }

    uint16_t next_head = s_rx_head;
    for (size_t i = 0; i < EMW_LANE_SIZE; ++i) {
        s_rx_buffer[next_head] = stream_lane[i];
        next_head = (uint16_t)((next_head + 1u) % EMW_RX_BUFFER_SIZE);
        if (next_head == s_rx_tail) {
            return false;
        }
    }
    s_rx_head = next_head;

    uint16_t available = usb_get_rx_buffer_bytes_available();
    if (bytes_available) {
        *bytes_available = available;
    }
    return true;
}

void usb_queue_status_packet(uint16_t status)
{
    s_pending_bs_status = status;
    s_pending_bs_ready = true;
}

void usb_poll_tx(void)
{
    if (!s_pending_bs_ready) {
        return;
    }

    if (send_status_frame(s_pending_bs_status, true) == ESP_OK) {
        s_pending_bs_ready = false;
    }
}

void usb_set_buffer_type(emw_buffer_type_t buffer_type)
{
    s_buffer_type = buffer_type;
}

emw_buffer_type_t usb_get_buffer_type(void)
{
    return s_buffer_type;
}

void usb_init_rx_buffer(void)
{
    memset(s_rx_buffer, 0, sizeof(s_rx_buffer));
    s_rx_head = 0;
    s_rx_tail = 0;
}

void usb_flush_rx_buffer(void)
{
    usb_init_rx_buffer();
}

void usb_free_rx_buffer(void)
{
    s_rx_head = 0;
    s_rx_tail = 0;
}

uint16_t usb_get_rx_buffer_bytes_available(void)
{
    return (uint16_t)((s_rx_head + EMW_RX_BUFFER_SIZE - s_rx_tail) % EMW_RX_BUFFER_SIZE);
}

uint8_t usb_read_rx_buffer(uint8_t *buf, uint16_t len)
{
    if (!buf) {
        return EMW_USB_RX_BUFFER_NO_DATA;
    }

    if (usb_get_rx_buffer_bytes_available() < len) {
        return EMW_USB_RX_BUFFER_NO_DATA;
    }

    for (uint16_t i = 0; i < len; ++i) {
        buf[i] = s_rx_buffer[s_rx_tail];
        s_rx_tail = (uint16_t)((s_rx_tail + 1u) % EMW_RX_BUFFER_SIZE);
    }

    return EMW_USB_RX_BUFFER_OK;
}

static void usb_midi_rx_task(void *arg)
{
    (void)arg;

    uint8_t packet[EMW_MIDI_PACKET_SIZE];
    uint8_t sysex[EMW_SYSEX_BYTES];
    size_t sysex_len = 0;

    for (;;) {
        s_usb_ready = tud_ready();

        bool had_work = false;
        while (tud_midi_available()) {
            had_work = true;
            if (!tud_midi_packet_read(packet)) {
                break;
            }

            if (sysex_len == 0 && packet[1] != 0xF0) {
                continue;
            }

            if (sysex_len + 3u > sizeof(sysex)) {
                sysex_len = 0;
                continue;
            }

            sysex[sysex_len++] = packet[1];
            sysex[sysex_len++] = packet[2];
            sysex[sysex_len++] = packet[3];

            if (sysex_len == sizeof(sysex)) {
                process_sysex_frame(sysex);
                sysex_len = 0;
            }
        }

        usb_poll_tx();
        vTaskDelay(pdMS_TO_TICKS(had_work ? 1 : 10));
    }
}

static void process_sysex_frame(const uint8_t *sysex)
{
    if (!sysex) {
        return;
    }

    if (sysex[0] != 0xF0 || sysex[1] != 0x7D ||
        sysex[2] != 'E' || sysex[3] != 'M' || sysex[4] != 'W' ||
        sysex[EMW_SYSEX_BYTES - 1u] != 0xF7) {
        return;
    }

    uint8_t decoded[EMW_USB_FRAME_SIZE];
    if (!decode_payload_7bit_fixed(&sysex[5], decoded)) {
        return;
    }

    const uint8_t *stream_lane = &decoded[EMW_LANE_SIZE];
    if (s_buffer_type == EMW_BUFFER_CIRCULAR) {
        uint16_t bytes_available = 0;
        if (usb_ingest_stream_lane(stream_lane, &bytes_available)) {
            usb_queue_status_packet(bytes_available);
        }
    }

    bool cmd_any = false;
    for (size_t i = 0; i < EMW_LANE_SIZE; ++i) {
        if (decoded[i] != 0) {
            cmd_any = true;
            break;
        }
    }

    if (!cmd_any || s_cmd_queue == NULL) {
        return;
    }

    command_t cmd = {0};
    cmd.length = EMW_LANE_SIZE;
    cmd.source = EMW_COMMAND_SOURCE_USB;
    memcpy(cmd.data, decoded, EMW_LANE_SIZE);
    if (xQueueSendToBack(s_cmd_queue, &cmd, 0) != pdTRUE) {
        ESP_LOGW(TAG, "usb rx queue full; dropping frame");
    }
}

static bool decode_payload_7bit_fixed(const uint8_t *in, uint8_t *out)
{
    size_t in_pos = 0;
    size_t out_pos = 0;

    while (in_pos < EMW_ENCODED_BYTES && out_pos < EMW_USB_FRAME_SIZE) {
        uint8_t prefix = in[in_pos++];
        for (uint8_t j = 0; j < 7u && out_pos < EMW_USB_FRAME_SIZE; ++j) {
            if (in_pos >= EMW_ENCODED_BYTES) {
                return false;
            }
            uint8_t v = (uint8_t)(in[in_pos++] & 0x7Fu);
            if ((prefix & (uint8_t)(1u << j)) != 0u) {
                v |= 0x80u;
            }
            out[out_pos++] = v;
        }
    }

    return out_pos == EMW_USB_FRAME_SIZE;
}

static void encode_payload_7bit_fixed(const uint8_t *in, uint8_t *out)
{
    size_t in_pos = 0;
    size_t out_pos = 0;

    while (in_pos < EMW_USB_FRAME_SIZE && out_pos < EMW_ENCODED_BYTES) {
        uint8_t prefix = 0;
        uint8_t chunk[7] = {0};
        uint8_t chunk_len = 0;

        for (uint8_t j = 0; j < 7u && in_pos < EMW_USB_FRAME_SIZE; ++j) {
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

static esp_err_t send_frame(const uint8_t *frame, bool nonblocking)
{
    if (!frame || !usb_is_ready()) {
        return ESP_ERR_INVALID_STATE;
    }

    TickType_t wait_ticks = nonblocking ? 0 : pdMS_TO_TICKS(EMW_USB_TX_TIMEOUT_MS);
    if (!s_tx_mutex || xSemaphoreTake(s_tx_mutex, wait_ticks) != pdTRUE) {
        return nonblocking ? ESP_ERR_TIMEOUT : ESP_FAIL;
    }

    uint8_t encoded[EMW_ENCODED_BYTES];
    uint8_t sysex[EMW_SYSEX_BYTES];
    encode_payload_7bit_fixed(frame, encoded);

    sysex[0] = 0xF0;
    sysex[1] = 0x7D;
    sysex[2] = 'E';
    sysex[3] = 'M';
    sysex[4] = 'W';
    memcpy(&sysex[5], encoded, sizeof(encoded));
    sysex[EMW_SYSEX_BYTES - 1u] = 0xF7;

    uint32_t written = tud_midi_stream_write(EMW_CABLE_NUM, sysex, sizeof(sysex));
    xSemaphoreGive(s_tx_mutex);

    return (written == sizeof(sysex)) ? ESP_OK : (nonblocking ? ESP_ERR_TIMEOUT : ESP_FAIL);
}

static esp_err_t send_status_frame(uint16_t status, bool nonblocking)
{
    uint8_t frame[EMW_USB_FRAME_SIZE] = {0};
    frame[EMW_LANE_SIZE + 0u] = 'B';
    frame[EMW_LANE_SIZE + 1u] = 'S';
    frame[EMW_LANE_SIZE + 2u] = (uint8_t)(status >> 8);
    frame[EMW_LANE_SIZE + 3u] = (uint8_t)(status & 0xFFu);
    (void)fill_frame_from_pending(frame, NULL);
    return send_frame(frame, nonblocking);
}

static size_t fill_frame_from_pending(uint8_t *frame, const uint8_t *stream_lane)
{
    if (!frame) {
        return 0;
    }

    if (s_pending_cmd_ready) {
        memcpy(&frame[0], (const void *)s_pending_cmd_lane, EMW_LANE_SIZE);
        s_pending_cmd_ready = false;
    }
    if (stream_lane) {
        memcpy(&frame[EMW_LANE_SIZE], stream_lane, EMW_LANE_SIZE);
    }
    return EMW_USB_FRAME_SIZE;
}

static void build_serial_string(void)
{
    uint8_t mac[6] = {0};
    ESP_ERROR_CHECK(esp_efuse_mac_get_default(mac));
    snprintf(s_serial_string, sizeof(s_serial_string), "%02X%02X%02X%02X%02X%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}
