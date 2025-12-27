/*
 * EMWaver Firmware - Initialization
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

#include "init.h"

#include <string.h>

#include "ble_server.h"
#include "command_registry.h"
#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "sdkconfig.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "sampler.h"
#include "spi.h"
#include "usb.h"
#include "rfm69.h"
#include "cc1101.h"
#include "gpio_commands.h"
#include <string.h>

#define FIRMWARE_VERSION "1.0.0"
#define EMWAVER_FIRMWARE_WELCOME "Welcome to EMWaver firmware"
#define CMD_QUEUE_LEN 10
#define STARTUP_LED GPIO_NUM_1
#define IR_TX_PIN_SHIELD GPIO_NUM_37
#define IR_TX_PIN_DEFAULT GPIO_NUM_4

static const char *TAG = "INIT";
static QueueHandle_t cmd_queue;
static TaskHandle_t command_task_handle;

static void command_task(void *pv_parameters);
static void register_core_commands(void);
static void version_command(void);
static void ble_status_command(void);
static void stop_command(void);
static void init_ir_tx_pins(void);

void emwaver_init(void)
{
    init_ir_tx_pins();

    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    gpio_config_t io_conf = {
        .pin_bit_mask = 1ULL << STARTUP_LED,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
    for (int i = 0; i < 3; ++i) {
        gpio_set_level(STARTUP_LED, 1);
        vTaskDelay(pdMS_TO_TICKS(200));
        gpio_set_level(STARTUP_LED, 0);
        vTaskDelay(pdMS_TO_TICKS(200));
    }

    command_registry_init();
    spi_init();
    sampler_module_init();

    spi_register_commands();
    rfm69_register_commands();
    cc1101_register_commands();
    gpio_register_commands();
    sampler_register_commands();
    usb_register_commands();
    register_core_commands();

    cmd_queue = xQueueCreate(CMD_QUEUE_LEN, sizeof(command_t));
    configASSERT(cmd_queue != NULL);

    ble_server_init(cmd_queue);

    BaseType_t created = xTaskCreatePinnedToCore(command_task,
                                                "cmd_task",
                                                8192,
                                                NULL,
                                                5,
                                                &command_task_handle,
                                                APP_CPU_NUM);
    configASSERT(created == pdPASS);

    ESP_LOGI(TAG, "Firmware initialized. Free heap: %u bytes",
             (unsigned)heap_caps_get_free_size(MALLOC_CAP_8BIT));
}

static void init_ir_tx_pins(void)
{
    const gpio_num_t pins[] = {IR_TX_PIN_DEFAULT, IR_TX_PIN_SHIELD};
    for (int i = 0; i < (int)(sizeof(pins) / sizeof(pins[0])); ++i) {
        gpio_reset_pin(pins[i]);
        gpio_set_direction(pins[i], GPIO_MODE_OUTPUT);
        gpio_set_level(pins[i], 0);
    }
}

static void command_task(void *pv_parameters)
{
    (void)pv_parameters;
    command_t cmd;

    for (;;) {
        if (xQueueReceive(cmd_queue, &cmd, portMAX_DELAY) == pdTRUE) {
            if (cmd.length == 0) {
                continue;
            }
            if (!command_registry_is_ascii(&cmd)) {
                command_send_err("binary unsupported");
                continue;
            }
            command_registry_handle(&cmd);
        }
    }
}

static void register_core_commands(void)
{
    bool ok = true;
    ok &= register_command(
        "version",
        (void *)version_command,
        (const cmd_arg_spec_t[]){
            {NULL, CMD_ARG_DONE, false},
        });
    ok &= register_command(
        "ble?",
        (void *)ble_status_command,
        (const cmd_arg_spec_t[]){
            {NULL, CMD_ARG_DONE, false},
        });
    ok &= register_command(
        "stop",
        (void *)stop_command,
        (const cmd_arg_spec_t[]){
            {NULL, CMD_ARG_DONE, false},
        });

    if (!ok) {
        ESP_LOGE(TAG, "Failed to register core commands");
    }
}

static void version_command(void)
{
    static const char msg[] = EMWAVER_FIRMWARE_WELCOME " " FIRMWARE_VERSION;
    ble_server_notify((const uint8_t *)msg, (uint16_t)(sizeof(msg) - 1u));
}

static void ble_status_command(void)
{
    static const char status[] = "on";
    command_send_ok((const uint8_t *)status, strlen(status));
}

static void stop_command(void)
{
    sampler_stop_all();
    command_send_ok(NULL, 0);
}
