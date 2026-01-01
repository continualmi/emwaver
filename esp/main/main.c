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

#include "main.h"
#include "command_registry.h"

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_err.h"
#include "esp_log.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "MAIN";

// Minimal, self-contained RFM69 "is it alive?" command.
// Command verb: "rfm69" (optionally accepts a positional arg which is ignored).
// It initializes SPI and reads the RFM69 REG_VERSION (0x10).
static void rfm69_quick_command(const char *ignored_action);

static void register_debug_commands(void)
{
    bool ok = register_command(
        "rfm69",
        (void *)rfm69_quick_command,
        (const cmd_arg_spec_t[]){
            {NULL, CMD_ARG_STRING, false}, // optional positional (ignored), keeps parser happy if user types "rfm69 something"
            {NULL, CMD_ARG_DONE, false},
        });
    if (!ok) {
        ESP_LOGE(TAG, "Failed to register debug command: rfm69");
    }
}

static void rfm69_quick_command(const char *ignored_action)
{
    (void)ignored_action;

    // Defaults match our RFM69 module defaults.
    const spi_host_device_t host = SPI2_HOST;
    const int miso = 13;
    const int mosi = 11;
    const int sck = 12;
    const int cs = 36;
    const int clock_hz = 8000000;

    static bool initialized = false;
    static spi_device_handle_t dev = NULL;

    if (!initialized) {
        spi_bus_config_t buscfg = {
            .miso_io_num = miso,
            .mosi_io_num = mosi,
            .sclk_io_num = sck,
            .quadwp_io_num = -1,
            .quadhd_io_num = -1,
            .max_transfer_sz = 64,
        };

        esp_err_t ret = spi_bus_initialize(host, &buscfg, SPI_DMA_CH_AUTO);
        if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
            ESP_LOGE(TAG, "rfm69: spi_bus_initialize failed: %s", esp_err_to_name(ret));
            command_send_err("rfm69: bus");
            return;
        }

        spi_device_interface_config_t devcfg = {
            .clock_speed_hz = clock_hz,
            .mode = 0,
            // Manual CS for determinism (matches rfm69.c now).
            .spics_io_num = -1,
            .queue_size = 1,
        };

        ret = spi_bus_add_device(host, &devcfg, &dev);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG, "rfm69: spi_bus_add_device failed: %s", esp_err_to_name(ret));
            command_send_err("rfm69: add");
            return;
        }

        gpio_reset_pin(cs);
        gpio_set_direction(cs, GPIO_MODE_OUTPUT);
        gpio_set_level(cs, 0); // deselected (active-low)

        initialized = true;
        ESP_LOGI(TAG, "rfm69: SPI ready (host=SPI2, miso=%d mosi=%d sck=%d cs=%d)", miso, mosi, sck, cs);
    }

    // Read REG_VERSION (0x10). For RFM69: send addr with R/W bit cleared, then dummy byte.
    uint8_t tx[2] = { 0x10 & 0x7F, 0x00 };
    uint8_t rx[2] = { 0 };

    // Select (active-low)
    gpio_set_level(cs, 1);
    spi_transaction_t t = {
        .flags = 0,
        .length = 16,
        .tx_buffer = tx,
        .rx_buffer = rx,
    };

    esp_err_t ret = spi_device_transmit(dev, &t);
    // Deselect
    gpio_set_level(cs, 0);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "rfm69: spi_device_transmit failed: %s", esp_err_to_name(ret));
        command_send_err("rfm69: xfer");
        return;
    }

    // rx[1] should contain the register value.
    command_send_ok(&rx[1], 1);
}

void app_main(void)
{
    emwaver_init();
    register_debug_commands();
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
