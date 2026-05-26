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

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "command_registry.h"
#include "emw_target.h"
#include "emw_proto.h"
#include "driver/ledc.h"
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_chip_info.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_system.h"
#include "nvs.h"
#include "sdkconfig.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "sampler.h"
#include "spi.h"
#include "usb.h"
#include "ble_server.h"
#include "wifi_transport.h"
#include "transport_debug.h"
#include "transport_session.h"
#include "firmware_version.h"
#include "rfm69.h"
#include "cc1101.h"
#include "gpio_commands.h"

#define EMWAVER_FIRMWARE_WELCOME "Welcome to EMWaver firmware"
#define CMD_QUEUE_LEN 10
#define STARTUP_LED EMW_TARGET_STARTUP_LED
#define IR_TX_PIN_SHIELD EMW_TARGET_IR_TX_PIN_SHIELD
#define IR_TX_PIN_DEFAULT GPIO_NUM_4
#define IR_LED_GUARD_PIN GPIO_NUM_5
#define DEVICE_NAME_NAMESPACE "emwaver"
#define DEVICE_NAME_KEY "device_name"
#define DEVICE_NAME_MAX_LEN 16u
#define PWM_DEFAULT_FREQ_HZ 1000u
#define PWM_LED_TIMER LEDC_TIMER_1
#define PWM_LED_MODE LEDC_LOW_SPEED_MODE
#define PWM_LED_CHANNEL LEDC_CHANNEL_1
#define PWM_DUTY_MAX 4095u

static const char *TAG = "INIT";
static QueueHandle_t cmd_queue;
static TaskHandle_t command_task_handle;
static uint32_t pwm_freq_hz = PWM_DEFAULT_FREQ_HZ;
static int pwm_active_pin = -1;
static bool pwm_configured = false;
static uint8_t active_command_source = EMW_COMMAND_SOURCE_UNKNOWN;

static void command_task(void *pv_parameters);
static bool handle_binary_packet(const command_t *cmd);
static void send_binary_ok(const uint8_t *payload, size_t len);
static void send_binary_err(void);
static void send_binary_busy(void);
static void restart_task(void *arg);
static void handle_name_get(void);
static void handle_name_set(const command_t *cmd);
static void get_default_device_name(char *out, size_t out_len);
static void load_device_name(char *out, size_t out_len);
static bool validate_gpio_pin(uint8_t pin, gpio_num_t *out_gpio);
static void handle_gpio_opcode(const command_t *cmd);
static void handle_spi_opcode(const command_t *cmd);
static void handle_sample_opcode(const command_t *cmd);
static void handle_transmit_opcode(const command_t *cmd);
static void handle_pwm_opcode(const command_t *cmd);
static void handle_adc_opcode(const command_t *cmd);
static void handle_wifi_config_opcode(const command_t *cmd);
static void handle_transport_session_opcode(const command_t *cmd);
static bool pwm_apply_output(gpio_num_t gpio, uint16_t duty_u12, uint32_t hz);
static void register_core_commands(void);
static void version_command(void);
static void ble_status_command(void);
static void stop_command(void);
static void init_ir_tx_pins(void);

void emwaver_init(void)
{
    ESP_LOGI(TAG, "Starting firmware init for %s (%s)", EMW_TARGET_BOARD_TYPE, EMW_TARGET_CAPABILITIES);
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
    ESP_LOGI(TAG, "Command registry ready");
    spi_init();
    sampler_module_init();
    spi_boot_init_defaults();
    ESP_LOGI(TAG, "Local runtime modules ready");

    spi_register_commands();
    rfm69_register_commands();
    cc1101_register_commands();
    gpio_register_commands();
    sampler_register_commands();
    register_core_commands();
    transport_debug_register_commands();

    cmd_queue = xQueueCreate(CMD_QUEUE_LEN, sizeof(command_t));
    configASSERT(cmd_queue != NULL);

    usb_init(cmd_queue);
    ESP_LOGI(TAG, "USB transport init complete");
    if (EMW_TARGET_HAS_BLE) {
        ble_server_init(cmd_queue);
        ESP_LOGI(TAG, "BLE transport init complete");
    }
    wifi_transport_init(cmd_queue);
    ESP_LOGI(TAG, "Wi-Fi transport init complete");

    BaseType_t created = xTaskCreatePinnedToCore(command_task,
                                                "cmd_task",
                                                8192,
                                                NULL,
                                                5,
                                                &command_task_handle,
                                                EMW_TARGET_COMMAND_CORE);
    configASSERT(created == pdPASS);

    ESP_LOGI(TAG, "Firmware initialized. Free heap: %u bytes",
             (unsigned)heap_caps_get_free_size(MALLOC_CAP_8BIT));
}

static void init_ir_tx_pins(void)
{
    const gpio_num_t pins[] = {IR_TX_PIN_DEFAULT, IR_TX_PIN_SHIELD, IR_LED_GUARD_PIN};
    for (int i = 0; i < (int)(sizeof(pins) / sizeof(pins[0])); ++i) {
        if (pins[i] == GPIO_NUM_NC) {
            continue;
        }
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

            active_command_source = cmd.source;
            if (!transport_session_allows_command(&cmd)) {
                send_binary_busy();
                active_command_source = EMW_COMMAND_SOURCE_UNKNOWN;
                continue;
            }
            if (handle_binary_packet(&cmd)) {
                active_command_source = EMW_COMMAND_SOURCE_UNKNOWN;
                continue;
            }
            active_command_source = EMW_COMMAND_SOURCE_UNKNOWN;

            // Desktop/clients may send fixed 64-byte packets padded with 0x00.
            // Treat 0x00 as end-of-command, and trim trailing whitespace so the
            // command parser sees only the ASCII command text.
            command_t trimmed = cmd;
            uint16_t len = trimmed.length;
            for (uint16_t i = 0; i < len; ++i) {
                if (trimmed.data[i] == 0) {
                    len = i;
                    break;
                }
            }
            while (len > 0) {
                uint8_t ch = trimmed.data[len - 1];
                if (ch == '\r' || ch == '\n' || ch == '\t' || ch == ' ') {
                    --len;
                    continue;
                }
                break;
            }
            trimmed.length = len;
            if (trimmed.length == 0) {
                continue;
            }

            if (!command_registry_is_ascii(&trimmed)) {
                command_send_err("binary unsupported");
                continue;
            }
            command_registry_handle(&trimmed);
        }
    }
}

static bool handle_binary_packet(const command_t *cmd)
{
    if (!cmd || cmd->length != EMW_USB_CMD_LANE_SIZE) {
        return false;
    }

    const uint8_t opcode = cmd->data[0];
    switch (opcode) {
        case EMW_OP_VERSION: {
            const uint8_t out[] = {
                EMWAVER_FIRMWARE_VERSION_MAJOR,
                EMWAVER_FIRMWARE_VERSION_MINOR,
                EMWAVER_FIRMWARE_VERSION_PATCH,
            };
            send_binary_ok(out, sizeof(out));
            return true;
        }
        case EMW_OP_RESET:
        case EMW_OP_HELP:
            send_binary_ok(NULL, 0);
            if (opcode == EMW_OP_RESET) {
                (void)xTaskCreate(restart_task, "emw_restart", 2048, NULL, 5, NULL);
            }
            return true;
        case EMW_OP_HARDWARE_UID_GET: {
            uint8_t mac[6] = {0};
            if (esp_efuse_mac_get_default(mac) != ESP_OK) {
                send_binary_err();
                return true;
            }
            send_binary_ok(mac, sizeof(mac));
            return true;
        }
        case EMW_OP_BOARD_GET: {
            static const uint8_t board_type[] = EMW_TARGET_BOARD_TYPE;
            send_binary_ok(board_type, sizeof(board_type) - 1u);
            return true;
        }
        case EMW_OP_WIFI_CONFIG:
            handle_wifi_config_opcode(cmd);
            return true;
        case EMW_OP_TRANSPORT_SESSION:
            handle_transport_session_opcode(cmd);
            return true;
        case EMW_OP_NAME_GET:
            handle_name_get();
            return true;
        case EMW_OP_NAME_SET:
            handle_name_set(cmd);
            return true;
        case EMW_OP_GPIO:
            handle_gpio_opcode(cmd);
            return true;
        case EMW_OP_ADC_READ:
            handle_adc_opcode(cmd);
            return true;
        case EMW_OP_SPI_XFER:
            handle_spi_opcode(cmd);
            return true;
        case EMW_OP_SAMPLE:
            handle_sample_opcode(cmd);
            return true;
        case EMW_OP_PWM:
            handle_pwm_opcode(cmd);
            return true;
        case EMW_OP_TRANSMIT:
            handle_transmit_opcode(cmd);
            return true;
        case EMW_OP_ENTER_DFU:
        case EMW_OP_IDENTITY_GET:
            send_binary_err();
            return true;
        default:
            send_binary_err();
            return true;
    }
}

static void handle_wifi_config_opcode(const command_t *cmd)
{
    enum {
        WIFI_STAGE_SSID_MAX = 32,
        WIFI_STAGE_PASS_MAX = 64,
    };
    static char staged_ssid[WIFI_STAGE_SSID_MAX + 1];
    static char staged_password[WIFI_STAGE_PASS_MAX + 1];
    static bool staged_active;

    const uint8_t sub = cmd->data[1];
    switch (sub) {
        case EMW_WIFI_CFG_BEGIN:
            memset(staged_ssid, 0, sizeof(staged_ssid));
            memset(staged_password, 0, sizeof(staged_password));
            staged_active = true;
            send_binary_ok(NULL, 0);
            return;
        case EMW_WIFI_CFG_FIELD: {
            if (!staged_active) {
                send_binary_err();
                return;
            }
            char *target = NULL;
            size_t target_len = 0;
            switch (cmd->data[2]) {
                case EMW_WIFI_FIELD_SSID:
                    target = staged_ssid;
                    target_len = sizeof(staged_ssid);
                    break;
                case EMW_WIFI_FIELD_PASSWORD:
                    target = staged_password;
                    target_len = sizeof(staged_password);
                    break;
                default:
                    send_binary_err();
                    return;
            }

            uint8_t offset = cmd->data[3];
            uint8_t len = cmd->data[4];
            const uint8_t max_payload = (uint8_t)(EMW_USB_CMD_LANE_SIZE - 5u);
            if (len > max_payload || (size_t)offset + len >= target_len) {
                send_binary_err();
                return;
            }
            memcpy(&target[offset], &cmd->data[5], len);
            target[offset + len] = '\0';
            send_binary_ok(NULL, 0);
            return;
        }
        case EMW_WIFI_CFG_APPLY:
            if (!staged_active) {
                send_binary_err();
                return;
            }
            if (wifi_transport_provision(staged_ssid, staged_password) != ESP_OK) {
                send_binary_err();
                return;
            }
            memset(staged_ssid, 0, sizeof(staged_ssid));
            memset(staged_password, 0, sizeof(staged_password));
            staged_active = false;
            send_binary_ok(NULL, 0);
            return;
        case EMW_WIFI_CFG_CLEAR:
            if (wifi_transport_clear_config() != ESP_OK) {
                send_binary_err();
                return;
            }
            memset(staged_ssid, 0, sizeof(staged_ssid));
            memset(staged_password, 0, sizeof(staged_password));
            staged_active = false;
            send_binary_ok(NULL, 0);
            return;
        case EMW_WIFI_CFG_STATUS: {
            const uint16_t reason = wifi_transport_last_disconnect_reason();
            uint8_t station_ip[4] = {0};
            const bool has_station_ip = wifi_transport_station_ipv4(station_ip);
            const bool runtime_running = sampler_is_sampling() || sampler_is_transmitting();
            uint8_t out[] = {
                wifi_transport_is_provisioned() ? 1u : 0u,
                wifi_transport_is_session_connected() ? 1u : 0u,
                wifi_transport_is_station_online() ? 1u : 0u,
                wifi_transport_is_reconnecting() ? 1u : 0u,
                (uint8_t)(reason & 0xffu),
                (uint8_t)((reason >> 8u) & 0xffu),
                has_station_ip ? 1u : 0u,
                station_ip[0],
                station_ip[1],
                station_ip[2],
                station_ip[3],
                runtime_running ? 1u : 0u,
            };
            send_binary_ok(out, sizeof(out));
            return;
        }
        default:
            send_binary_err();
            return;
    }
}

static void handle_transport_session_opcode(const command_t *cmd)
{
    const uint8_t sub = cmd->data[1];
    const uint8_t requested_source = cmd->data[2];
    switch (sub) {
        case EMW_TRANSPORT_SESSION_STATUS: {
            const uint8_t active = transport_session_active_source();
            send_binary_ok(&active, 1);
            return;
        }
        case EMW_TRANSPORT_SESSION_CONNECT:
            if (requested_source != cmd->source ||
                !transport_session_connect(cmd->source)) {
                send_binary_busy();
                return;
            }
            send_binary_ok(NULL, 0);
            return;
        case EMW_TRANSPORT_SESSION_DISCONNECT:
            if (requested_source != cmd->source ||
                !transport_session_disconnect(cmd->source)) {
                send_binary_busy();
                return;
            }
            send_binary_ok(NULL, 0);
            return;
        case EMW_TRANSPORT_SESSION_HEARTBEAT:
            if (requested_source != cmd->source ||
                !transport_session_heartbeat(cmd->source)) {
                send_binary_busy();
                return;
            }
            send_binary_ok(NULL, 0);
            return;
        default:
            send_binary_err();
            return;
    }
}

static void send_binary_ok(const uint8_t *payload, size_t len)
{
    uint8_t lane[EMW_USB_CMD_LANE_SIZE] = {0};
    size_t payload_len = len;
    if (payload_len > (EMW_USB_CMD_LANE_SIZE - 1u)) {
        payload_len = EMW_USB_CMD_LANE_SIZE - 1u;
    }
    lane[0] = EMW_RESP_STATUS_OK;
    if (payload && payload_len > 0) {
        memcpy(&lane[1], payload, payload_len);
    }
    transport_debug_log_lane(active_command_source, "tx", lane, sizeof(lane));

    if (active_command_source == EMW_COMMAND_SOURCE_BLE) {
        if (ble_server_send_cmd_response(EMW_RESP_STATUS_OK, payload, (uint16_t)len) != 0) {
            ESP_LOGW(TAG, "Failed to send BLE OK response");
        }
        return;
    }

    if (active_command_source == EMW_COMMAND_SOURCE_WIFI) {
        if (wifi_transport_send_cmd_response(EMW_RESP_STATUS_OK, payload, len) != ESP_OK) {
            ESP_LOGW(TAG, "Failed to send Wi-Fi OK response");
        }
        return;
    }

    if (usb_send_cmd_response(EMW_RESP_STATUS_OK, payload, len) != ESP_OK) {
        ESP_LOGW(TAG, "Failed to send USB OK response");
    }
}

static void send_binary_err(void)
{
    uint8_t lane[EMW_USB_CMD_LANE_SIZE] = {0};
    lane[0] = EMW_RESP_STATUS_ERR;
    transport_debug_log_lane(active_command_source, "tx", lane, sizeof(lane));

    if (active_command_source == EMW_COMMAND_SOURCE_BLE) {
        if (ble_server_send_cmd_response(EMW_RESP_STATUS_ERR, NULL, 0) != 0) {
            ESP_LOGW(TAG, "Failed to send BLE ERR response");
        }
        return;
    }

    if (active_command_source == EMW_COMMAND_SOURCE_WIFI) {
        if (wifi_transport_send_cmd_response(EMW_RESP_STATUS_ERR, NULL, 0) != ESP_OK) {
            ESP_LOGW(TAG, "Failed to send Wi-Fi ERR response");
        }
        return;
    }

    if (usb_send_cmd_response(EMW_RESP_STATUS_ERR, NULL, 0) != ESP_OK) {
        ESP_LOGW(TAG, "Failed to send USB ERR response");
    }
}

static void send_binary_busy(void)
{
    uint8_t lane[EMW_USB_CMD_LANE_SIZE] = {0};
    lane[0] = EMW_RESP_STATUS_BUSY;
    transport_debug_log_lane(active_command_source, "tx", lane, sizeof(lane));

    if (active_command_source == EMW_COMMAND_SOURCE_BLE) {
        if (ble_server_send_cmd_response(EMW_RESP_STATUS_BUSY, NULL, 0) != 0) {
            ESP_LOGW(TAG, "Failed to send BLE BUSY response");
        }
        return;
    }

    if (active_command_source == EMW_COMMAND_SOURCE_WIFI) {
        if (wifi_transport_send_cmd_response(EMW_RESP_STATUS_BUSY, NULL, 0) != ESP_OK) {
            ESP_LOGW(TAG, "Failed to send Wi-Fi BUSY response");
        }
        return;
    }

    if (usb_send_cmd_response(EMW_RESP_STATUS_BUSY, NULL, 0) != ESP_OK) {
        ESP_LOGW(TAG, "Failed to send USB BUSY response");
    }
}

static void restart_task(void *arg)
{
    (void)arg;
    vTaskDelay(pdMS_TO_TICKS(25));
    esp_restart();
}

static void handle_name_get(void)
{
    char name[DEVICE_NAME_MAX_LEN + 1];
    load_device_name(name, sizeof(name));
    send_binary_ok((const uint8_t *)name, strlen(name));
}

static void handle_name_set(const command_t *cmd)
{
    uint8_t len = cmd->data[1];
    uint8_t max_len = (uint8_t)(EMW_USB_CMD_LANE_SIZE - 2u);
    if (len > max_len) {
        len = max_len;
    }
    if (len > DEVICE_NAME_MAX_LEN) {
        len = DEVICE_NAME_MAX_LEN;
    }

    char name[DEVICE_NAME_MAX_LEN + 1];
    memset(name, 0, sizeof(name));
    if (len > 0) {
        memcpy(name, &cmd->data[2], len);
    }

    nvs_handle_t nvs = 0;
    esp_err_t err = nvs_open(DEVICE_NAME_NAMESPACE, NVS_READWRITE, &nvs);
    if (err != ESP_OK) {
        send_binary_err();
        return;
    }

    err = nvs_set_str(nvs, DEVICE_NAME_KEY, name);
    if (err == ESP_OK) {
        err = nvs_commit(nvs);
    }
    nvs_close(nvs);

    if (err != ESP_OK) {
        send_binary_err();
        return;
    }

    send_binary_ok(NULL, 0);
}

static void get_default_device_name(char *out, size_t out_len)
{
    if (!out || out_len == 0) {
        return;
    }

    uint8_t mac[6] = {0};
    if (esp_efuse_mac_get_default(mac) != ESP_OK) {
        strlcpy(out, EMW_TARGET_DEVICE_NAME_PREFIX, out_len);
        return;
    }

    snprintf(out, out_len, "%s-%02X%02X", EMW_TARGET_DEVICE_NAME_PREFIX, mac[4], mac[5]);
}

static void load_device_name(char *out, size_t out_len)
{
    if (!out || out_len == 0) {
        return;
    }

    nvs_handle_t nvs = 0;
    esp_err_t err = nvs_open(DEVICE_NAME_NAMESPACE, NVS_READONLY, &nvs);
    if (err != ESP_OK) {
        get_default_device_name(out, out_len);
        return;
    }

    size_t len = out_len;
    err = nvs_get_str(nvs, DEVICE_NAME_KEY, out, &len);
    nvs_close(nvs);

    if (err != ESP_OK || out[0] == '\0') {
        get_default_device_name(out, out_len);
    }
}

static bool validate_gpio_pin(uint8_t pin, gpio_num_t *out_gpio)
{
    if (!out_gpio || pin > 48u) {
        return false;
    }

    *out_gpio = (gpio_num_t)pin;
    return true;
}

static void handle_gpio_opcode(const command_t *cmd)
{
    gpio_num_t gpio = GPIO_NUM_NC;
    if (!validate_gpio_pin(cmd->data[2], &gpio)) {
        send_binary_err();
        return;
    }

    esp_err_t err = ESP_OK;
    uint8_t sub = cmd->data[1];
    switch (sub) {
        case EMW_GPIO_IN:
            gpio_reset_pin(gpio);
            err = gpio_set_direction(gpio, GPIO_MODE_INPUT);
            break;
        case EMW_GPIO_OUT:
            gpio_reset_pin(gpio);
            err = gpio_set_direction(gpio, GPIO_MODE_OUTPUT);
            break;
        case EMW_GPIO_PULL: {
            uint8_t pull = cmd->data[3];
            gpio_pull_mode_t mode = GPIO_FLOATING;
            if (pull == 1u) {
                mode = GPIO_PULLUP_ONLY;
            } else if (pull == 2u) {
                mode = GPIO_PULLDOWN_ONLY;
            } else if (pull != 0u) {
                send_binary_err();
                return;
            }
            gpio_reset_pin(gpio);
            err = gpio_set_direction(gpio, GPIO_MODE_INPUT);
            if (err == ESP_OK) {
                err = gpio_set_pull_mode(gpio, mode);
            }
            break;
        }
        case EMW_GPIO_READ: {
            err = gpio_set_direction(gpio, GPIO_MODE_INPUT);
            if (err != ESP_OK) {
                send_binary_err();
                return;
            }
            uint8_t out = (uint8_t)(gpio_get_level(gpio) != 0);
            send_binary_ok(&out, 1);
            return;
        }
        case EMW_GPIO_HIGH:
        case EMW_GPIO_LOW: {
            uint32_t level = (sub == EMW_GPIO_HIGH) ? 1u : 0u;
            err = gpio_set_direction(gpio, GPIO_MODE_OUTPUT);
            if (err == ESP_OK) {
                err = gpio_set_level(gpio, (uint32_t)level);
            }
            if (err != ESP_OK) {
                send_binary_err();
                return;
            }
            uint8_t out = (uint8_t)level;
            send_binary_ok(&out, 1);
            return;
        }
        case EMW_GPIO_INFO: {
            uint8_t level = (uint8_t)(gpio_get_level(gpio) != 0);
            uint8_t response[6] = {0, 0, 0, 0, level, level};
            send_binary_ok(response, sizeof(response));
            return;
        }
        default:
            send_binary_err();
            return;
    }

    if (err != ESP_OK) {
        send_binary_err();
        return;
    }

    send_binary_ok(NULL, 0);
}

static void handle_adc_opcode(const command_t *cmd)
{
    if (cmd->data[1] != EMW_ADC_SRC_PIN) {
        send_binary_err();
        return;
    }

    gpio_num_t gpio = GPIO_NUM_NC;
    if (!validate_gpio_pin(cmd->data[2], &gpio)) {
        send_binary_err();
        return;
    }

    uint8_t samples = cmd->data[3];
    if (samples < 1u) {
        samples = 1u;
    }
    if (samples > 64u) {
        samples = 64u;
    }

    adc_unit_t unit_id = ADC_UNIT_1;
    adc_channel_t channel = ADC_CHANNEL_0;
    esp_err_t err = adc_oneshot_io_to_channel((int)gpio, &unit_id, &channel);
    if (err != ESP_OK) {
        send_binary_err();
        return;
    }

    adc_oneshot_unit_handle_t adc = NULL;
    adc_oneshot_unit_init_cfg_t init_cfg = {
        .unit_id = unit_id,
        .ulp_mode = ADC_ULP_MODE_DISABLE,
    };
    err = adc_oneshot_new_unit(&init_cfg, &adc);
    if (err != ESP_OK) {
        send_binary_err();
        return;
    }

    adc_oneshot_chan_cfg_t chan_cfg = {
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_12,
    };
    err = adc_oneshot_config_channel(adc, channel, &chan_cfg);
    if (err != ESP_OK) {
        adc_oneshot_del_unit(adc);
        send_binary_err();
        return;
    }

    uint32_t sum = 0;
    for (uint8_t i = 0; i < samples; ++i) {
        int raw = 0;
        err = adc_oneshot_read(adc, channel, &raw);
        if (err != ESP_OK) {
            adc_oneshot_del_unit(adc);
            send_binary_err();
            return;
        }
        if (raw < 0) {
            raw = 0;
        }
        sum += (uint32_t)raw;
    }

    adc_oneshot_del_unit(adc);

    uint16_t avg = (uint16_t)((sum + (uint32_t)(samples / 2u)) / (uint32_t)samples);
    uint8_t out[2] = {
        (uint8_t)(avg & 0xFFu),
        (uint8_t)((avg >> 8) & 0xFFu),
    };
    send_binary_ok(out, sizeof(out));
}

static void handle_spi_opcode(const command_t *cmd)
{
    gpio_num_t cs_gpio = GPIO_NUM_NC;
    if (!validate_gpio_pin(cmd->data[1], &cs_gpio)) {
        send_binary_err();
        return;
    }

    uint8_t requested_rx = cmd->data[2];
    uint8_t tx_len = cmd->data[3];
    uint8_t max_tx = (uint8_t)(EMW_USB_CMD_LANE_SIZE - 4u);
    if (tx_len > max_tx) {
        tx_len = max_tx;
    }

    if (requested_rx == 0u) {
        requested_rx = tx_len;
    }
    if (requested_rx > EMW_RESP_MAX_PAYLOAD) {
        requested_rx = (uint8_t)EMW_RESP_MAX_PAYLOAD;
    }

    uint8_t total_len = tx_len > requested_rx ? tx_len : requested_rx;
    if (total_len == 0u || requested_rx == 0u) {
        send_binary_ok(NULL, 0);
        return;
    }

    uint8_t tx_buf[EMW_RESP_MAX_PAYLOAD] = {0};
    uint8_t rx_buf[EMW_RESP_MAX_PAYLOAD] = {0};
    if (tx_len > 0u) {
        memcpy(tx_buf, &cmd->data[4], tx_len);
    }

    esp_err_t err = spi_transfer_once((int)cs_gpio,
                                      0,
                                      0,
                                      false,
                                      tx_buf,
                                      total_len,
                                      rx_buf,
                                      requested_rx);
    if (err != ESP_OK) {
        send_binary_err();
        return;
    }

    send_binary_ok(rx_buf, requested_rx);
}

static void handle_sample_opcode(const command_t *cmd)
{
    uint8_t sub = cmd->data[1];
    if (sub == EMW_SAMPLE_START) {
        gpio_num_t gpio = GPIO_NUM_NC;
        uint8_t tick_us = cmd->data[3];
        if (!validate_gpio_pin(cmd->data[2], &gpio) || !sampler_start_sampling((int)gpio, tick_us)) {
            send_binary_err();
            return;
        }
        sampler_set_stream_source(active_command_source);
        send_binary_ok(NULL, 0);
        return;
    }

    if (sub == EMW_SAMPLE_STOP) {
        if (!sampler_stop_sampling()) {
            send_binary_err();
            return;
        }
        sampler_set_stream_source(EMW_COMMAND_SOURCE_UNKNOWN);
        send_binary_ok(NULL, 0);
        return;
    }

    send_binary_err();
}

static void handle_transmit_opcode(const command_t *cmd)
{
    uint8_t sub = cmd->data[1];
    if (sub == EMW_TRANSMIT_STOP) {
        if (!sampler_stop_transmission()) {
            send_binary_err();
            return;
        }
        send_binary_ok(NULL, 0);
        return;
    }

    if (sub == EMW_TRANSMIT_START) {
        gpio_num_t gpio = GPIO_NUM_NC;
        uint8_t duty_percent = cmd->data[3];
        uint32_t freq_hz = ((uint32_t)cmd->data[4]) |
                           ((uint32_t)cmd->data[5] << 8) |
                           ((uint32_t)cmd->data[6] << 16) |
                           ((uint32_t)cmd->data[7] << 24);
        uint8_t tick_us = cmd->data[8];
        if (!validate_gpio_pin(cmd->data[2], &gpio) ||
            !sampler_start_transmission((int)gpio, duty_percent, (int)freq_hz, tick_us)) {
            send_binary_err();
            return;
        }
        send_binary_ok(NULL, 0);
        return;
    }

    send_binary_err();
}

static void handle_pwm_opcode(const command_t *cmd)
{
    uint8_t sub = cmd->data[1];
    if (sub == EMW_PWM_FREQ) {
        uint32_t hz = (uint32_t)cmd->data[2]
                    | ((uint32_t)cmd->data[3] << 8)
                    | ((uint32_t)cmd->data[4] << 16)
                    | ((uint32_t)cmd->data[5] << 24);
        if (hz == 0u) {
            send_binary_err();
            return;
        }
        pwm_freq_hz = hz;
        send_binary_ok(NULL, 0);
        return;
    }

    gpio_num_t gpio = GPIO_NUM_NC;
    if (!validate_gpio_pin(cmd->data[2], &gpio)) {
        send_binary_err();
        return;
    }

    if (sub == EMW_PWM_STOP) {
        if (pwm_active_pin == (int)gpio && pwm_configured) {
            ledc_stop(PWM_LED_MODE, PWM_LED_CHANNEL, 0);
            pwm_configured = false;
            pwm_active_pin = -1;
        }
        gpio_reset_pin(gpio);
        if (gpio_set_direction(gpio, GPIO_MODE_OUTPUT) != ESP_OK || gpio_set_level(gpio, 0) != ESP_OK) {
            send_binary_err();
            return;
        }
        send_binary_ok(NULL, 0);
        return;
    }

    if (sub == EMW_PWM_WRITE) {
        uint16_t value = (uint16_t)cmd->data[3] | ((uint16_t)cmd->data[4] << 8);
        uint32_t hz = (uint32_t)cmd->data[5]
                    | ((uint32_t)cmd->data[6] << 8)
                    | ((uint32_t)cmd->data[7] << 16)
                    | ((uint32_t)cmd->data[8] << 24);
        if (value > PWM_DUTY_MAX) {
            value = PWM_DUTY_MAX;
        }
        if (hz == 0u) {
            hz = pwm_freq_hz;
        }
        if (!pwm_apply_output(gpio, value, hz)) {
            send_binary_err();
            return;
        }
        send_binary_ok(NULL, 0);
        return;
    }

    send_binary_err();
}

static bool pwm_apply_output(gpio_num_t gpio, uint16_t duty_u12, uint32_t hz)
{
    if (hz == 0u) {
        return false;
    }

    if (duty_u12 == 0u || duty_u12 >= PWM_DUTY_MAX) {
        if (pwm_configured) {
            ledc_stop(PWM_LED_MODE, PWM_LED_CHANNEL, 0);
            pwm_configured = false;
        }
        pwm_active_pin = -1;
        if (gpio_reset_pin(gpio) != ESP_OK) {
            return false;
        }
        if (gpio_set_direction(gpio, GPIO_MODE_OUTPUT) != ESP_OK) {
            return false;
        }
        return gpio_set_level(gpio, duty_u12 >= PWM_DUTY_MAX ? 1 : 0) == ESP_OK;
    }

    ledc_timer_config_t timer_cfg = {
        .speed_mode = PWM_LED_MODE,
        .timer_num = PWM_LED_TIMER,
        .duty_resolution = LEDC_TIMER_12_BIT,
        .freq_hz = hz,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    if (ledc_timer_config(&timer_cfg) != ESP_OK) {
        return false;
    }

    ledc_channel_config_t channel_cfg = {
        .gpio_num = (int)gpio,
        .speed_mode = PWM_LED_MODE,
        .channel = PWM_LED_CHANNEL,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = PWM_LED_TIMER,
        .duty = duty_u12,
        .hpoint = 0,
    };
    if (ledc_channel_config(&channel_cfg) != ESP_OK) {
        return false;
    }

    if (ledc_set_duty(PWM_LED_MODE, PWM_LED_CHANNEL, duty_u12) != ESP_OK) {
        return false;
    }
    if (ledc_update_duty(PWM_LED_MODE, PWM_LED_CHANNEL) != ESP_OK) {
        return false;
    }

    pwm_freq_hz = hz;
    pwm_active_pin = (int)gpio;
    pwm_configured = true;
    return true;
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
    static const char msg[] = EMWAVER_FIRMWARE_WELCOME " " EMWAVER_FIRMWARE_VERSION_STRING;
    command_send_ok((const uint8_t *)msg, sizeof(msg) - 1u);
}

static void ble_status_command(void)
{
    static const char status[] = "off";
    command_send_ok((const uint8_t *)status, strlen(status));
}

static void stop_command(void)
{
    sampler_stop_all();
    command_send_ok(NULL, 0);
}
