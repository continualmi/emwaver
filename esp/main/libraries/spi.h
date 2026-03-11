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
void spi_boot_init_defaults(void);

// Create a temporary SPI device handle for the duration of a single transfer.
// This supports a "stateless" UX (no spi open/close) while still using ESP-IDF.
esp_err_t spi_transfer_once(int cs_io,
                            int mode,
                            int clock_hz,
                            bool lsb_first,
                            const uint8_t *tx,
                            size_t tx_len,
                            uint8_t *rx,
                            size_t rx_len);

#endif /* SPI_H */
