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

#ifndef SPI_H
#define SPI_H

#include "driver/spi_master.h"
#include "esp_err.h"

void spi_init(void);
void spi_register_commands(void);
void spi_shutdown(void);

// Internal helpers for other firmware modules (e.g. cc1101.c) to share the same
// SPI bus/device bookkeeping as the "spi open/xfer/close" CLI commands.
esp_err_t spi_open_device_internal(const char *name,
                                  int host_id,
                                  int miso,
                                  int mosi,
                                  int sck,
                                  int cs,
                                  int mode,
                                  int clock_hz,
                                  spi_device_handle_t *out_handle);

esp_err_t spi_close_device_internal(const char *name);

spi_device_handle_t spi_get_device_handle(const char *name);

#endif /* SPI_H */
