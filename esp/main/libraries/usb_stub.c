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

void usb_init(QueueHandle_t cmd_queue)
{
    (void)cmd_queue;
}

bool usb_is_ready(void)
{
    return false;
}

esp_err_t usb_send_cmd_response(uint8_t status, const uint8_t *payload, size_t payload_len)
{
    (void)status;
    (void)payload;
    (void)payload_len;
    return ESP_FAIL;
}

esp_err_t usb_send_stream_lane(const uint8_t *stream_lane, bool nonblocking)
{
    (void)stream_lane;
    (void)nonblocking;
    return ESP_FAIL;
}

bool usb_ingest_stream_lane(const uint8_t *stream_lane, uint16_t *bytes_available)
{
    (void)stream_lane;
    (void)bytes_available;
    return false;
}

void usb_queue_status_packet(uint16_t status)
{
    (void)status;
}

void usb_poll_tx(void)
{
}

void usb_set_buffer_type(emw_buffer_type_t buffer_type)
{
    (void)buffer_type;
}

emw_buffer_type_t usb_get_buffer_type(void)
{
    return EMW_BUFFER_PACKET;
}

void usb_init_rx_buffer(void)
{
}

void usb_flush_rx_buffer(void)
{
}

void usb_free_rx_buffer(void)
{
}

uint16_t usb_get_rx_buffer_bytes_available(void)
{
    return 0;
}

uint8_t usb_read_rx_buffer(uint8_t *buf, uint16_t len)
{
    (void)buf;
    (void)len;
    return EMW_USB_RX_BUFFER_NO_DATA;
}
