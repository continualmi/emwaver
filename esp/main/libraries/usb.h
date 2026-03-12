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

void usb_init(QueueHandle_t cmd_queue);
bool usb_is_ready(void);
esp_err_t usb_send_cmd_response(uint8_t status, const uint8_t *payload, size_t payload_len);

#ifdef __cplusplus
}
#endif

#endif // USB_H
