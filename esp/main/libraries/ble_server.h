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

#ifndef H_BLE_SERVER_
#define H_BLE_SERVER_

#include <stdint.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

#ifdef __cplusplus
extern "C" {
#endif

// Initialize BLE server
void ble_server_init(QueueHandle_t cmd_queue);

// Start BLE advertising
void ble_server_advertise(void);

// Send notification to connected BLE client
int ble_server_notify(const uint8_t* data, uint16_t len);
int ble_server_notify_attr(uint16_t attr_handle, const uint8_t *data, uint16_t len);
int ble_server_send_superframe(const uint8_t *frame);
int ble_server_send_cmd_response(uint8_t status, const uint8_t *payload, uint16_t payload_len);

// BLE transmission mode functions
void ble_set_transmitter_mode(uint8_t mode);
uint16_t ble_get_rx_bytes_available(void);
uint8_t ble_read_rx_buffer(uint8_t* buf, uint16_t len);

#ifdef __cplusplus
}
#endif

#endif /* H_BLE_SERVER_ */ 
