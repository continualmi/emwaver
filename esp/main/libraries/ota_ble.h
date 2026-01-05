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

#ifndef H_OTA_BLE_
#define H_OTA_BLE_

#include <stdint.h>

void ota_ble_init(void);
void ota_ble_on_disconnect(void);

int ota_ble_handle_control_write(const uint8_t *data, uint16_t len);
int ota_ble_handle_data_write(const uint8_t *data, uint16_t len);

#endif /* H_OTA_BLE_ */
