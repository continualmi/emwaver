/*
 * EMWaver Firmware - GPIO Commands
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

#include "gpio_commands.h"

#include "command_registry.h"
#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_log.h"

static const char *TAG = "GPIO";

static bool gpio_validate_pin(int pin, gpio_num_t *out_gpio)
{
    if (!out_gpio) {
        return false;
    }

    // ESP32-S3: GPIO 0..48 (some are strapping/reserved; validation is basic).
    if (pin < 0 || pin > 48) {
        return false;
    }

    *out_gpio = (gpio_num_t)pin;
    return true;
}

static void gpio_in_command(int pin)
{
    gpio_num_t gpio;
    if (!gpio_validate_pin(pin, &gpio)) {
        command_send_err("gpio in: pin");
        return;
    }

    gpio_reset_pin(gpio);
    gpio_set_direction(gpio, GPIO_MODE_INPUT);
    command_send_ok(NULL, 0);
}

static void gpio_out_command(int pin)
{
    gpio_num_t gpio;
    if (!gpio_validate_pin(pin, &gpio)) {
        command_send_err("gpio out: pin");
        return;
    }

    gpio_reset_pin(gpio);
    gpio_set_direction(gpio, GPIO_MODE_OUTPUT);
    command_send_ok(NULL, 0);
}

static void gpio_pull_command(int pin, int pull)
{
    gpio_num_t gpio;
    if (!gpio_validate_pin(pin, &gpio)) {
        command_send_err("gpio pull: pin");
        return;
    }

    gpio_pull_mode_t mode = GPIO_FLOATING;
    switch (pull) {
        case 0:
            mode = GPIO_FLOATING;
            break;
        case 1:
            mode = GPIO_PULLUP_ONLY;
            break;
        case 2:
            mode = GPIO_PULLDOWN_ONLY;
            break;
        default:
            command_send_err("gpio pull: mode");
            return;
    }

    esp_err_t ret = gpio_set_pull_mode(gpio, mode);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "gpio_set_pull_mode(%d) failed: %s", pin, esp_err_to_name(ret));
        command_send_err("gpio pull: fail");
        return;
    }

    command_send_ok(NULL, 0);
}

static void gpio_high_command(int pin)
{
    gpio_num_t gpio;
    if (!gpio_validate_pin(pin, &gpio)) {
        command_send_err("gpio high: pin");
        return;
    }

    gpio_set_direction(gpio, GPIO_MODE_OUTPUT);
    gpio_set_level(gpio, 1);
    uint8_t level = 1;
    command_send_ok(&level, 1);
}

static void gpio_low_command(int pin)
{
    gpio_num_t gpio;
    if (!gpio_validate_pin(pin, &gpio)) {
        command_send_err("gpio low: pin");
        return;
    }

    gpio_set_direction(gpio, GPIO_MODE_OUTPUT);
    gpio_set_level(gpio, 0);
    uint8_t level = 0;
    command_send_ok(&level, 1);
}

static void gpio_read_command(int pin)
{
    gpio_num_t gpio;
    if (!gpio_validate_pin(pin, &gpio)) {
        command_send_err("gpio read: pin");
        return;
    }

    int level = gpio_get_level(gpio);
    if (level < 0) {
        command_send_err("gpio read: fail");
        return;
    }

    uint8_t out = (uint8_t)(level != 0);
    command_send_ok(&out, 1);
}

void gpio_register_commands(void)
{
    bool ok = true;
    ok &= register_command(
        "gpio in",
        (void *)gpio_in_command,
        (const cmd_arg_spec_t[]){
            {"pin", CMD_ARG_INT, true},
            {NULL, CMD_ARG_DONE, false},
        });
    ok &= register_command(
        "gpio out",
        (void *)gpio_out_command,
        (const cmd_arg_spec_t[]){
            {"pin", CMD_ARG_INT, true},
            {NULL, CMD_ARG_DONE, false},
        });
    ok &= register_command(
        "gpio pull",
        (void *)gpio_pull_command,
        (const cmd_arg_spec_t[]){
            {"pin", CMD_ARG_INT, true},
            {"mode", CMD_ARG_INT, true}, // 0=none, 1=up, 2=down
            {NULL, CMD_ARG_DONE, false},
        });
    ok &= register_command(
        "gpio high",
        (void *)gpio_high_command,
        (const cmd_arg_spec_t[]){
            {"pin", CMD_ARG_INT, true},
            {NULL, CMD_ARG_DONE, false},
        });
    ok &= register_command(
        "gpio low",
        (void *)gpio_low_command,
        (const cmd_arg_spec_t[]){
            {"pin", CMD_ARG_INT, true},
            {NULL, CMD_ARG_DONE, false},
        });
    ok &= register_command(
        "gpio read",
        (void *)gpio_read_command,
        (const cmd_arg_spec_t[]){
            {"pin", CMD_ARG_INT, true},
            {NULL, CMD_ARG_DONE, false},
        });

    if (!ok) {
        ESP_LOGE(TAG, "failed to register GPIO commands");
    }
}
