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

#ifndef SAMPLER_H
#define SAMPLER_H

#include <stdbool.h>
#include <stdint.h>

void sampler_module_init(void);
void sampler_register_commands(void);
void sampler_stop_all(void);
bool sampler_is_sampling(void);
bool sampler_is_transmitting(void);
bool sampler_start_sampling(int pin, uint8_t tick_us);
bool sampler_stop_sampling(void);
bool sampler_start_transmission(int pin, uint8_t duty_percent, int freq_hz, uint8_t tick_us);
bool sampler_stop_transmission(void);

#endif /* SAMPLER_H */
