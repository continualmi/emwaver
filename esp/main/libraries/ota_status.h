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

#ifndef H_OTA_STATUS_
#define H_OTA_STATUS_

#include <stdint.h>

void ota_status_init(void);
void ota_status_set_attr_handle(uint16_t attr_handle);
void ota_status_notify(uint8_t status_code, uint8_t err_code, uint32_t received, uint32_t total);

#endif /* H_OTA_STATUS_ */

