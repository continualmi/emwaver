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

#ifndef USB_H
#define USB_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "command_registry.h"

#ifdef __cplusplus
extern "C" {
#endif

#define EMW_USB_CMD_LANE_SIZE 18u
#define EMW_USB_FRAME_SIZE 36u
#define EMW_USB_RX_BUFFER_OK 0u
#define EMW_USB_RX_BUFFER_NO_DATA 1u

typedef enum {
    EMW_BUFFER_PACKET = 0,
    EMW_BUFFER_CIRCULAR = 1,
    EMW_BUFFER_DOUBLE = 2,
} emw_buffer_type_t;

void usb_init(QueueHandle_t cmd_queue);
bool usb_is_ready(void);
esp_err_t usb_send_cmd_response(uint8_t status, const uint8_t *payload, size_t payload_len);
esp_err_t usb_send_stream_lane(const uint8_t *stream_lane, bool nonblocking);
bool usb_ingest_stream_lane(const uint8_t *stream_lane, uint16_t *bytes_available);
void usb_queue_status_packet(uint16_t status);
void usb_poll_tx(void);
void usb_set_buffer_type(emw_buffer_type_t buffer_type);
emw_buffer_type_t usb_get_buffer_type(void);
void usb_init_rx_buffer(void);
void usb_flush_rx_buffer(void);
void usb_free_rx_buffer(void);
uint16_t usb_get_rx_buffer_bytes_available(void);
uint8_t usb_read_rx_buffer(uint8_t *buf, uint16_t len);

#ifdef __cplusplus
}
#endif

#endif // USB_H
