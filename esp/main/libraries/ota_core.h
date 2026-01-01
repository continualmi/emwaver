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

#ifndef H_OTA_CORE_
#define H_OTA_CORE_

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

void ota_core_init(void);

bool ota_core_is_active(void);
uint32_t ota_core_total_size(void);
uint32_t ota_core_received_size(void);

esp_err_t ota_core_start(uint32_t total_size, const uint8_t expected_sha256[32]);
esp_err_t ota_core_write(const uint8_t *data, size_t len);
esp_err_t ota_core_finish(void);
void ota_core_abort(void);

#endif /* H_OTA_CORE_ */

