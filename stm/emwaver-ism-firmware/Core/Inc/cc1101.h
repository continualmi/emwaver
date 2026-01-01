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

#ifndef CC1101_H
#define CC1101_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

void cc1101_init(void);
bool cc1101_is_initialized(void);

uint8_t cc1101_read_reg(uint8_t addr);
void cc1101_write_reg(uint8_t addr, uint8_t value);
uint8_t cc1101_strobe(uint8_t cmd);

void cc1101_read_burst(uint8_t addr, uint8_t *out, size_t len);
uint8_t cc1101_write_burst(uint8_t addr, const uint8_t *data, size_t len);

void cc1101_apply_defaults(void);

#endif /* CC1101_H */
