/*
 * EMWaver Firmware - Signal Sampler
 * Copyright (C) 2025 Luís Marnoto
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef SAMPLER_H
#define SAMPLER_H

#include <stdbool.h>

void sampler_module_init(void);
void sampler_register_commands(void);
void sampler_stop_all(void);
bool sampler_is_sampling(void);
bool sampler_is_transmitting(void);
bool sampler_start_sampling(int pin);
bool sampler_stop_sampling(void);
bool sampler_start_transmission(int pin);
bool sampler_stop_transmission(void);

#endif /* SAMPLER_H */
