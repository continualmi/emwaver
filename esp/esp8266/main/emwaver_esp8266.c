/*
 * EMWaver ESP8266 firmware
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

#include <ctype.h>
#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/param.h>
#include <sys/socket.h>
#include <unistd.h>

#include "driver/adc.h"
#include "driver/gpio.h"
#include "driver/ledc.h"
#include "driver/spi.h"
#include "driver/uart.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "lwip/inet.h"
#include "lwip/ip4_addr.h"
#include "lwip/netdb.h"
#include "mbedtls/base64.h"
#include "mbedtls/sha1.h"
#include "mdns.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "sdkconfig.h"

#ifndef ESP_ERR_NVS_NEW_VERSION_FOUND
#define ESP_ERR_NVS_NEW_VERSION_FOUND ESP_ERR_NVS_NO_FREE_PAGES
#endif

#ifndef CONFIG_EMWAVER_ESP8266_AP_PASSWORD
#define CONFIG_EMWAVER_ESP8266_AP_PASSWORD ""
#endif

#ifndef CONFIG_EMWAVER_ESP8266_DEFAULT_LED_GPIO
#define CONFIG_EMWAVER_ESP8266_DEFAULT_LED_GPIO 2
#endif

#ifndef CONFIG_EMWAVER_ESP8266_SPI_MISO_GPIO
#define CONFIG_EMWAVER_ESP8266_SPI_MISO_GPIO 12
#endif

#ifndef CONFIG_EMWAVER_ESP8266_SPI_MOSI_GPIO
#define CONFIG_EMWAVER_ESP8266_SPI_MOSI_GPIO 13
#endif

#ifndef CONFIG_EMWAVER_ESP8266_SPI_SCK_GPIO
#define CONFIG_EMWAVER_ESP8266_SPI_SCK_GPIO 14
#endif

#define EMWAVER_FIRMWARE_VERSION_MAJOR 1u
#define EMWAVER_FIRMWARE_VERSION_MINOR 0u
#define EMWAVER_FIRMWARE_VERSION_PATCH 2u
#define EMWAVER_FIRMWARE_VERSION_STRING "1.0.2"

#define EMW_TARGET_BOARD_TYPE "esp8266"
#define EMW_TARGET_CAPABILITIES "wifi,serial"
#define EMW_TARGET_DEVICE_NAME_PREFIX "ESP8266"

#define EMW_RESP_STATUS_OK 0x80u
#define EMW_RESP_STATUS_ERR 0x81u
#define EMW_RESP_STATUS_BUSY 0x82u
#define EMW_RESP_MAX_PAYLOAD 17u

#define EMW_OP_VERSION 0x01u
#define EMW_OP_RESET 0x02u
#define EMW_OP_HELP 0x03u
#define EMW_OP_NAME_GET 0x04u
#define EMW_OP_NAME_SET 0x05u
#define EMW_OP_ENTER_DFU 0x06u
#define EMW_OP_IDENTITY_GET 0x07u
#define EMW_OP_HARDWARE_UID_GET 0x08u
#define EMW_OP_BOARD_GET 0x09u
#define EMW_OP_WIFI_CONFIG 0x0Au
#define EMW_OP_TRANSPORT_SESSION 0x0Bu

#define EMW_WIFI_CFG_BEGIN 0x00u
#define EMW_WIFI_CFG_FIELD 0x01u
#define EMW_WIFI_CFG_APPLY 0x02u
#define EMW_WIFI_CFG_CLEAR 0x03u
#define EMW_WIFI_CFG_STATUS 0x04u
#define EMW_WIFI_FIELD_SSID 0x00u
#define EMW_WIFI_FIELD_PASSWORD 0x01u

#define EMW_OP_GPIO 0x10u
#define EMW_GPIO_IN 0x00u
#define EMW_GPIO_OUT 0x01u
#define EMW_GPIO_READ 0x02u
#define EMW_GPIO_HIGH 0x03u
#define EMW_GPIO_LOW 0x04u
#define EMW_GPIO_PULL 0x05u
#define EMW_GPIO_INFO 0x06u

#define EMW_OP_ADC_READ 0x20u
#define EMW_ADC_SRC_PIN 0x00u
#define EMW_ADC_SRC_TEMP 0x01u
#define EMW_ADC_SRC_VREFINT 0x02u
#define EMW_ADC_SRC_VBAT 0x03u

#define EMW_OP_SPI_XFER 0x50u

#define EMW_OP_SAMPLE 0x60u
#define EMW_SAMPLE_START 0x00u
#define EMW_SAMPLE_STOP 0x01u

#define EMW_OP_PWM 0x70u
#define EMW_PWM_FREQ 0x00u
#define EMW_PWM_WRITE 0x01u
#define EMW_PWM_STOP 0x02u

#define EMW_OP_TRANSMIT 0x80u
#define EMW_TRANSMIT_START 0x00u
#define EMW_TRANSMIT_STOP 0x01u

#define EMW_COMMAND_SOURCE_UNKNOWN 0u
#define EMW_COMMAND_SOURCE_SERIAL 1u
#define EMW_COMMAND_SOURCE_WIFI 3u
#define EMW_TRANSPORT_SOURCE_NONE EMW_COMMAND_SOURCE_UNKNOWN
#define EMW_TRANSPORT_SESSION_STATUS 0x00u
#define EMW_TRANSPORT_SESSION_CONNECT 0x01u
#define EMW_TRANSPORT_SESSION_DISCONNECT 0x02u
#define EMW_TRANSPORT_SESSION_HEARTBEAT 0x03u
#define EMW_TRANSPORT_SESSION_TIMEOUT_MS 5000u

#define EMW_LANE_SIZE 18u
#define EMW_USB_FRAME_SIZE 36u
#define EMW_SYSEX_BYTES 48u
#define EMW_ENCODED_BYTES 42u

#define CMD_QUEUE_LEN 10
#define WIFI_NAMESPACE "emw_wifi"
#define WIFI_KEY_SSID "ssid"
#define WIFI_KEY_PASS "pass"
#define WIFI_KEY_HOST "hostname"
#define WIFI_MAX_SSID 32u
#define WIFI_MAX_PASS 64u
#define WIFI_MAX_HOST 32u
#define WIFI_CONTROL_PORT 3922
#define WIFI_WS_PATH "/v1/ws"
#define WIFI_RECONNECT_BASE_MS 1000u
#define WIFI_RECONNECT_MAX_MS 30000u
#define DEVICE_NAME_NAMESPACE "emwaver"
#define DEVICE_NAME_KEY "device_name"
#define DEVICE_NAME_MAX_LEN 16u
#define PWM_DUTY_MAX 4095u
#define PWM_DEFAULT_FREQ_HZ 1000u

typedef struct {
    uint8_t data[256];
    uint16_t length;
    uint8_t source;
} command_t;

typedef struct {
    char ssid[WIFI_MAX_SSID + 1u];
    char password[WIFI_MAX_PASS + 1u];
    char hostname[WIFI_MAX_HOST + 1u];
} wifi_config_store_t;

typedef enum {
    WIFI_RUNTIME_NONE = 0,
    WIFI_RUNTIME_SOFTAP,
    WIFI_RUNTIME_STATION,
} wifi_runtime_mode_t;

static const char *TAG = "EMW8266";
static QueueHandle_t s_cmd_queue;
static int s_listen_sock = -1;
static int s_active_sock = -1;
static TaskHandle_t s_server_task;
static TaskHandle_t s_command_task;
static TaskHandle_t s_serial_task;
static wifi_config_store_t s_config;
static bool s_has_config;
static bool s_wifi_started;
static bool s_station_online;
static bool s_session_connected;
static bool s_reconnect_pending;
static bool s_mdns_started;
static uint8_t s_reconnect_attempt;
static uint16_t s_last_disconnect_reason;
static uint8_t s_station_ipv4[4];
static wifi_runtime_mode_t s_runtime_mode = WIFI_RUNTIME_NONE;
static volatile uint8_t s_active_transport = EMW_TRANSPORT_SOURCE_NONE;
static volatile TickType_t s_last_transport_activity_tick;
static char s_staged_ssid[WIFI_MAX_SSID + 1u];
static char s_staged_password[WIFI_MAX_PASS + 1u];
static bool s_staged_active;
static uint8_t s_active_command_source = EMW_COMMAND_SOURCE_UNKNOWN;
static uint32_t s_pwm_freq_hz = PWM_DEFAULT_FREQ_HZ;
static int s_pwm_active_pin = -1;
static bool s_pwm_configured;
static bool s_adc_initialized;
static bool s_spi_initialized;

static void command_task(void *arg);
static void serial_transport_task(void *arg);
static void init_serial_transport(void);
static void websocket_server_task(void *arg);
static void wifi_reconnect_task(void *arg);
static void restart_task(void *arg);
static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data);
static void init_gpio_startup(void);
static void ensure_network_stack(void);
static bool load_wifi_config(wifi_config_store_t *out);
static esp_err_t save_wifi_config(const wifi_config_store_t *config);
static esp_err_t clear_wifi_config(void);
static void default_hostname(char *out, size_t out_len);
static bool is_valid_hostname(const char *hostname);
static void start_station(void);
static void start_softap(void);
static void restart_wifi_for_config(void);
static bool publish_mdns(void);
static void stop_mdns(void);
static void close_active_socket(void);
static void stop_server_socket(void);
static bool websocket_handshake(int sock);
static bool websocket_read_frame(int sock, uint8_t *payload, size_t payload_cap, size_t *payload_len, uint8_t *opcode);
static bool websocket_send_binary(int sock, const uint8_t *payload, size_t len);
static bool enqueue_sysex(const uint8_t *sysex, uint8_t source);
static bool decode_payload_7bit_fixed(const uint8_t *in, uint8_t *out);
static void encode_payload_7bit_fixed(const uint8_t *in, uint8_t *out);
static bool send_superframe(const uint8_t *frame);
static bool send_serial_superframe(const uint8_t *frame);
static void send_binary_ok(const uint8_t *payload, size_t len);
static void send_binary_err(void);
static void send_binary_busy(void);
static bool handle_binary_packet(const command_t *cmd);
static void handle_wifi_config_opcode(const command_t *cmd);
static void handle_transport_session_opcode(const command_t *cmd);
static void handle_name_get(void);
static void handle_name_set(const command_t *cmd);
static void load_device_name(char *out, size_t out_len);
static void get_default_device_name(char *out, size_t out_len);
static void handle_gpio_opcode(const command_t *cmd);
static void handle_adc_opcode(const command_t *cmd);
static void handle_pwm_opcode(const command_t *cmd);
static void handle_spi_opcode(const command_t *cmd);
static void handle_sample_opcode(const command_t *cmd);
static void handle_transmit_opcode(const command_t *cmd);
static bool serial_allows_opcode(const command_t *cmd);
static bool validate_gpio_pin(uint8_t pin, gpio_num_t *out_gpio);
static bool adc_read_tout_average(uint8_t samples, uint16_t *out);
static bool pwm_apply_output(gpio_num_t gpio, uint16_t duty_u12, uint32_t hz);
static bool spi_transfer_once(gpio_num_t cs_gpio, const uint8_t *tx, uint8_t tx_len, uint8_t rx_len, uint8_t *rx);
static void transport_expire_stale_claim(void);
static bool transport_session_allows_command(const command_t *cmd);
static bool transport_session_connect(uint8_t source);
static bool transport_session_disconnect(uint8_t source);
static bool transport_session_heartbeat(uint8_t source);
static uint8_t transport_session_active_source(void);
static void copy_str(char *dst, const char *src, size_t dst_len);
static void build_local_id_suffix(char *out, size_t out_len);

void app_main(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    ESP_LOGI(TAG, "Starting EMWaver ESP8266 firmware %s", EMWAVER_FIRMWARE_VERSION_STRING);
    init_gpio_startup();
    ensure_network_stack();

    s_cmd_queue = xQueueCreate(CMD_QUEUE_LEN, sizeof(command_t));
    configASSERT(s_cmd_queue != NULL);
    init_serial_transport();

    s_has_config = load_wifi_config(&s_config);
    if (s_has_config) {
        start_station();
    } else {
        ESP_LOGI(TAG, "No station credentials; starting SoftAP provisioning");
        start_softap();
    }

    BaseType_t created = xTaskCreate(command_task, "emw_cmd", 4096, NULL, 5, &s_command_task);
    configASSERT(created == pdPASS);

    while (true) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

static void init_gpio_startup(void)
{
    gpio_num_t led = (gpio_num_t)CONFIG_EMWAVER_ESP8266_DEFAULT_LED_GPIO;
    if (GPIO_IS_VALID_GPIO(led)) {
        gpio_config_t io_conf = {
            .pin_bit_mask = 1u << led,
            .mode = GPIO_MODE_OUTPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE,
        };
        (void)gpio_config(&io_conf);
        for (int i = 0; i < 3; ++i) {
            (void)gpio_set_level(led, 0);
            vTaskDelay(pdMS_TO_TICKS(120));
            (void)gpio_set_level(led, 1);
            vTaskDelay(pdMS_TO_TICKS(120));
        }
    }
}

static void ensure_network_stack(void)
{
    tcpip_adapter_init();
    esp_err_t err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_ERROR_CHECK(err);
    }
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL));
}

static void command_task(void *arg)
{
    (void)arg;
    command_t cmd;
    for (;;) {
        if (xQueueReceive(s_cmd_queue, &cmd, portMAX_DELAY) != pdTRUE) {
            continue;
        }
        if (cmd.length == 0) {
            continue;
        }
        s_active_command_source = cmd.source;
        if (!transport_session_allows_command(&cmd)) {
            send_binary_busy();
            s_active_command_source = EMW_COMMAND_SOURCE_UNKNOWN;
            continue;
        }
        (void)handle_binary_packet(&cmd);
        s_active_command_source = EMW_COMMAND_SOURCE_UNKNOWN;
    }
}

static bool handle_binary_packet(const command_t *cmd)
{
    if (!cmd || cmd->length != EMW_LANE_SIZE) {
        send_binary_err();
        return false;
    }
    if (cmd->source == EMW_COMMAND_SOURCE_SERIAL && !serial_allows_opcode(cmd)) {
        send_binary_err();
        return true;
    }

    switch (cmd->data[0]) {
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
            if (cmd->data[0] == EMW_OP_RESET) {
                (void)xTaskCreate(restart_task, "emw_restart", 1536, NULL, 5, NULL);
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
            static const uint8_t board[] = EMW_TARGET_BOARD_TYPE;
            send_binary_ok(board, sizeof(board) - 1u);
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
        case EMW_OP_PWM:
            handle_pwm_opcode(cmd);
            return true;
        case EMW_OP_SAMPLE:
            handle_sample_opcode(cmd);
            return true;
        case EMW_OP_TRANSMIT:
            handle_transmit_opcode(cmd);
            return true;
        case EMW_OP_ENTER_DFU:
        case EMW_OP_IDENTITY_GET:
        default:
            send_binary_err();
            return true;
    }
}

static void handle_wifi_config_opcode(const command_t *cmd)
{
    const uint8_t sub = cmd->data[1];
    switch (sub) {
        case EMW_WIFI_CFG_BEGIN:
            memset(s_staged_ssid, 0, sizeof(s_staged_ssid));
            memset(s_staged_password, 0, sizeof(s_staged_password));
            s_staged_active = true;
            send_binary_ok(NULL, 0);
            return;
        case EMW_WIFI_CFG_FIELD: {
            if (!s_staged_active) {
                send_binary_err();
                return;
            }
            char *target = NULL;
            size_t target_len = 0;
            if (cmd->data[2] == EMW_WIFI_FIELD_SSID) {
                target = s_staged_ssid;
                target_len = sizeof(s_staged_ssid);
            } else if (cmd->data[2] == EMW_WIFI_FIELD_PASSWORD) {
                target = s_staged_password;
                target_len = sizeof(s_staged_password);
            } else {
                send_binary_err();
                return;
            }
            const uint8_t offset = cmd->data[3];
            const uint8_t len = cmd->data[4];
            const uint8_t max_payload = (uint8_t)(EMW_LANE_SIZE - 5u);
            if (len > max_payload || ((size_t)offset + len) >= target_len) {
                send_binary_err();
                return;
            }
            memcpy(&target[offset], &cmd->data[5], len);
            target[offset + len] = '\0';
            send_binary_ok(NULL, 0);
            return;
        }
        case EMW_WIFI_CFG_APPLY: {
            if (!s_staged_active || s_staged_ssid[0] == '\0') {
                send_binary_err();
                return;
            }
            wifi_config_store_t next = {0};
            copy_str(next.ssid, s_staged_ssid, sizeof(next.ssid));
            copy_str(next.password, s_staged_password, sizeof(next.password));
            default_hostname(next.hostname, sizeof(next.hostname));
            if (save_wifi_config(&next) != ESP_OK) {
                send_binary_err();
                return;
            }
            s_config = next;
            s_has_config = true;
            memset(s_staged_ssid, 0, sizeof(s_staged_ssid));
            memset(s_staged_password, 0, sizeof(s_staged_password));
            s_staged_active = false;
            send_binary_ok(NULL, 0);
            restart_wifi_for_config();
            return;
        }
        case EMW_WIFI_CFG_CLEAR:
            if (clear_wifi_config() != ESP_OK) {
                send_binary_err();
                return;
            }
            memset(&s_config, 0, sizeof(s_config));
            s_has_config = false;
            s_staged_active = false;
            send_binary_ok(NULL, 0);
            start_softap();
            return;
        case EMW_WIFI_CFG_STATUS: {
            uint8_t out[] = {
                s_has_config ? 1u : 0u,
                s_session_connected ? 1u : 0u,
                s_station_online ? 1u : 0u,
                s_reconnect_pending ? 1u : 0u,
                (uint8_t)(s_last_disconnect_reason & 0xffu),
                (uint8_t)((s_last_disconnect_reason >> 8u) & 0xffu),
                s_station_online ? 1u : 0u,
                s_station_ipv4[0],
                s_station_ipv4[1],
                s_station_ipv4[2],
                s_station_ipv4[3],
                0u,
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
            if (requested_source != cmd->source || !transport_session_connect(cmd->source)) {
                send_binary_busy();
                return;
            }
            send_binary_ok(NULL, 0);
            return;
        case EMW_TRANSPORT_SESSION_DISCONNECT:
            if (requested_source != cmd->source || !transport_session_disconnect(cmd->source)) {
                send_binary_busy();
                return;
            }
            send_binary_ok(NULL, 0);
            return;
        case EMW_TRANSPORT_SESSION_HEARTBEAT:
            if (requested_source != cmd->source || !transport_session_heartbeat(cmd->source)) {
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

static void handle_name_get(void)
{
    char name[DEVICE_NAME_MAX_LEN + 1u];
    load_device_name(name, sizeof(name));
    send_binary_ok((const uint8_t *)name, strlen(name));
}

static void handle_name_set(const command_t *cmd)
{
    uint8_t len = cmd->data[1];
    const uint8_t max_len = (uint8_t)(EMW_LANE_SIZE - 2u);
    if (len > max_len) {
        len = max_len;
    }
    if (len > DEVICE_NAME_MAX_LEN) {
        len = DEVICE_NAME_MAX_LEN;
    }

    char name[DEVICE_NAME_MAX_LEN + 1u] = {0};
    if (len > 0) {
        memcpy(name, &cmd->data[2], len);
    }

    nvs_handle nvs = 0;
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

static void handle_gpio_opcode(const command_t *cmd)
{
    gpio_num_t gpio = GPIO_NUM_MAX;
    if (!validate_gpio_pin(cmd->data[2], &gpio)) {
        send_binary_err();
        return;
    }

    esp_err_t err = ESP_OK;
    const uint8_t sub = cmd->data[1];
    switch (sub) {
        case EMW_GPIO_IN:
            err = gpio_set_direction(gpio, GPIO_MODE_INPUT);
            break;
        case EMW_GPIO_OUT:
            err = gpio_set_direction(gpio, GPIO_MODE_OUTPUT);
            break;
        case EMW_GPIO_PULL: {
            gpio_pull_mode_t mode = GPIO_FLOATING;
            if (cmd->data[3] == 1u) {
                mode = GPIO_PULLUP_ONLY;
            } else if (cmd->data[3] == 2u) {
                mode = GPIO_PULLDOWN_ONLY;
            } else if (cmd->data[3] != 0u) {
                send_binary_err();
                return;
            }
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
            const uint8_t level = sub == EMW_GPIO_HIGH ? 1u : 0u;
            err = gpio_set_direction(gpio, GPIO_MODE_OUTPUT);
            if (err == ESP_OK) {
                err = gpio_set_level(gpio, level);
            }
            if (err != ESP_OK) {
                send_binary_err();
                return;
            }
            send_binary_ok(&level, 1);
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

    uint8_t samples = cmd->data[3];
    if (samples < 1u) {
        samples = 1u;
    }
    if (samples > 64u) {
        samples = 64u;
    }

    uint16_t avg = 0;
    if (!adc_read_tout_average(samples, &avg)) {
        send_binary_err();
        return;
    }
    uint8_t out[2] = {
        (uint8_t)(avg & 0xffu),
        (uint8_t)((avg >> 8u) & 0xffu),
    };
    send_binary_ok(out, sizeof(out));
}

static void handle_pwm_opcode(const command_t *cmd)
{
    const uint8_t sub = cmd->data[1];
    if (sub == EMW_PWM_FREQ) {
        uint32_t hz = (uint32_t)cmd->data[2]
                    | ((uint32_t)cmd->data[3] << 8)
                    | ((uint32_t)cmd->data[4] << 16)
                    | ((uint32_t)cmd->data[5] << 24);
        if (hz == 0u) {
            send_binary_err();
            return;
        }
        s_pwm_freq_hz = hz;
        send_binary_ok(NULL, 0);
        return;
    }

    gpio_num_t gpio = GPIO_NUM_MAX;
    if (!validate_gpio_pin(cmd->data[2], &gpio)) {
        send_binary_err();
        return;
    }

    if (sub == EMW_PWM_STOP) {
        if (s_pwm_configured && s_pwm_active_pin == (int)gpio) {
            (void)ledc_stop(LEDC_HIGH_SPEED_MODE, LEDC_CHANNEL_0, 0);
            s_pwm_configured = false;
            s_pwm_active_pin = -1;
        }
        (void)gpio_set_direction(gpio, GPIO_MODE_OUTPUT);
        (void)gpio_set_level(gpio, 0);
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
            hz = s_pwm_freq_hz;
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

static void handle_spi_opcode(const command_t *cmd)
{
    gpio_num_t cs_gpio = GPIO_NUM_MAX;
    if (!validate_gpio_pin(cmd->data[1], &cs_gpio)) {
        send_binary_err();
        return;
    }

    uint8_t requested_rx = cmd->data[2];
    uint8_t tx_len = cmd->data[3];
    const uint8_t max_tx = (uint8_t)(EMW_LANE_SIZE - 4u);
    if (tx_len > max_tx) {
        tx_len = max_tx;
    }
    if (requested_rx == 0u) {
        requested_rx = tx_len;
    }
    if (requested_rx > EMW_RESP_MAX_PAYLOAD) {
        requested_rx = EMW_RESP_MAX_PAYLOAD;
    }
    if (tx_len == 0u && requested_rx == 0u) {
        send_binary_ok(NULL, 0);
        return;
    }

    uint8_t rx[EMW_RESP_MAX_PAYLOAD] = {0};
    if (!spi_transfer_once(cs_gpio, &cmd->data[4], tx_len, requested_rx, rx)) {
        send_binary_err();
        return;
    }
    send_binary_ok(rx, requested_rx);
}

static void handle_sample_opcode(const command_t *cmd)
{
    (void)cmd;
    send_binary_err();
}

static void handle_transmit_opcode(const command_t *cmd)
{
    (void)cmd;
    send_binary_err();
}

static bool serial_allows_opcode(const command_t *cmd)
{
    if (!cmd || cmd->length != EMW_LANE_SIZE) {
        return false;
    }
    return true;
}

static bool validate_gpio_pin(uint8_t pin, gpio_num_t *out_gpio)
{
    if (!out_gpio || pin >= GPIO_NUM_MAX) {
        return false;
    }
    if (pin >= 6u && pin <= 11u) {
        return false;
    }
    *out_gpio = (gpio_num_t)pin;
    return true;
}

static bool adc_read_tout_average(uint8_t samples, uint16_t *out)
{
    if (!out) {
        return false;
    }
    if (!s_adc_initialized) {
        adc_config_t config = {
            .mode = ADC_READ_TOUT_MODE,
            .clk_div = 8,
        };
        if (adc_init(&config) != ESP_OK) {
            return false;
        }
        s_adc_initialized = true;
    }

    uint32_t sum = 0;
    for (uint8_t i = 0; i < samples; ++i) {
        uint16_t raw = 0;
        if (adc_read(&raw) != ESP_OK) {
            return false;
        }
        sum += raw;
    }
    *out = (uint16_t)((sum + (samples / 2u)) / samples);
    return true;
}

static bool pwm_apply_output(gpio_num_t gpio, uint16_t duty_u12, uint32_t hz)
{
    if (hz == 0u) {
        return false;
    }
    if (duty_u12 == 0u || duty_u12 >= PWM_DUTY_MAX) {
        if (s_pwm_configured) {
            (void)ledc_stop(LEDC_HIGH_SPEED_MODE, LEDC_CHANNEL_0, duty_u12 >= PWM_DUTY_MAX ? 1 : 0);
            s_pwm_configured = false;
        }
        s_pwm_active_pin = -1;
        (void)gpio_set_direction(gpio, GPIO_MODE_OUTPUT);
        return gpio_set_level(gpio, duty_u12 >= PWM_DUTY_MAX ? 1 : 0) == ESP_OK;
    }

    ledc_timer_config_t timer = {
        .speed_mode = LEDC_HIGH_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_12_BIT,
        .timer_num = LEDC_TIMER_0,
        .freq_hz = hz,
    };
    if (ledc_timer_config(&timer) != ESP_OK) {
        return false;
    }

    ledc_channel_config_t channel = {
        .gpio_num = (int)gpio,
        .speed_mode = LEDC_HIGH_SPEED_MODE,
        .channel = LEDC_CHANNEL_0,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = LEDC_TIMER_0,
        .duty = duty_u12,
        .hpoint = 0,
    };
    if (ledc_channel_config(&channel) != ESP_OK) {
        return false;
    }
    if (ledc_set_duty(LEDC_HIGH_SPEED_MODE, LEDC_CHANNEL_0, duty_u12) != ESP_OK ||
        ledc_update_duty(LEDC_HIGH_SPEED_MODE, LEDC_CHANNEL_0) != ESP_OK) {
        return false;
    }

    s_pwm_configured = true;
    s_pwm_active_pin = (int)gpio;
    s_pwm_freq_hz = hz;
    return true;
}

static bool spi_transfer_once(gpio_num_t cs_gpio, const uint8_t *tx, uint8_t tx_len, uint8_t rx_len, uint8_t *rx)
{
    const uint8_t total_len = MAX(tx_len, rx_len);
    if (total_len == 0u || total_len > EMW_RESP_MAX_PAYLOAD) {
        return false;
    }

    if (!s_spi_initialized) {
        spi_config_t config = {
            .interface.val = SPI_DEFAULT_INTERFACE,
            .intr_enable.val = 0,
            .event_cb = NULL,
            .mode = SPI_MASTER_MODE,
            .clk_div = SPI_8MHz_DIV,
        };
        config.interface.cs_en = 0;
        if (spi_init(HSPI_HOST, &config) != ESP_OK) {
            return false;
        }
        s_spi_initialized = true;
    }

    uint32_t mosi_words[5] = {0};
    uint32_t miso_words[5] = {0};
    uint8_t *mosi_bytes = (uint8_t *)mosi_words;
    uint8_t *miso_bytes = (uint8_t *)miso_words;
    for (uint8_t i = 0; i < total_len; ++i) {
        mosi_bytes[i] = (tx && i < tx_len) ? tx[i] : 0u;
    }

    (void)gpio_set_direction(cs_gpio, GPIO_MODE_OUTPUT);
    (void)gpio_set_level(cs_gpio, 1);
    spi_trans_t trans = {
        .cmd = NULL,
        .addr = NULL,
        .mosi = mosi_words,
        .miso = miso_words,
        .bits = {
            .cmd = 0,
            .addr = 0,
            .mosi = (uint32_t)total_len * 8u,
            .miso = (uint32_t)total_len * 8u,
        },
    };

    (void)gpio_set_level(cs_gpio, 0);
    esp_err_t err = spi_trans(HSPI_HOST, &trans);
    (void)gpio_set_level(cs_gpio, 1);
    if (err != ESP_OK) {
        return false;
    }
    if (rx && rx_len > 0u) {
        memcpy(rx, miso_bytes, rx_len);
    }
    return true;
}

static void send_binary_ok(const uint8_t *payload, size_t len)
{
    uint8_t frame[EMW_USB_FRAME_SIZE] = {0};
    size_t payload_len = MIN(len, (size_t)(EMW_LANE_SIZE - 1u));
    frame[0] = EMW_RESP_STATUS_OK;
    if (payload && payload_len > 0u) {
        memcpy(&frame[1], payload, payload_len);
    }
    if (s_active_command_source == EMW_COMMAND_SOURCE_SERIAL) {
        (void)send_serial_superframe(frame);
    } else {
        (void)send_superframe(frame);
    }
}

static void send_binary_err(void)
{
    uint8_t frame[EMW_USB_FRAME_SIZE] = {0};
    frame[0] = EMW_RESP_STATUS_ERR;
    if (s_active_command_source == EMW_COMMAND_SOURCE_SERIAL) {
        (void)send_serial_superframe(frame);
    } else {
        (void)send_superframe(frame);
    }
}

static void send_binary_busy(void)
{
    uint8_t frame[EMW_USB_FRAME_SIZE] = {0};
    frame[0] = EMW_RESP_STATUS_BUSY;
    if (s_active_command_source == EMW_COMMAND_SOURCE_SERIAL) {
        (void)send_serial_superframe(frame);
    } else {
        (void)send_superframe(frame);
    }
}

static bool send_superframe(const uint8_t *frame)
{
    if (!frame || s_active_sock < 0) {
        return false;
    }
    uint8_t sysex[EMW_SYSEX_BYTES] = {0};
    sysex[0] = 0xF0;
    sysex[1] = 0x7D;
    sysex[2] = 'E';
    sysex[3] = 'M';
    sysex[4] = 'W';
    encode_payload_7bit_fixed(frame, &sysex[5]);
    sysex[EMW_SYSEX_BYTES - 1u] = 0xF7;
    return websocket_send_binary(s_active_sock, sysex, sizeof(sysex));
}

static bool send_serial_superframe(const uint8_t *frame)
{
    if (!frame) {
        return false;
    }
    uint8_t sysex[EMW_SYSEX_BYTES] = {0};
    sysex[0] = 0xF0;
    sysex[1] = 0x7D;
    sysex[2] = 'E';
    sysex[3] = 'M';
    sysex[4] = 'W';
    encode_payload_7bit_fixed(frame, &sysex[5]);
    sysex[EMW_SYSEX_BYTES - 1u] = 0xF7;
    return uart_write_bytes(UART_NUM_0, (const char *)sysex, sizeof(sysex)) == (int)sizeof(sysex);
}

static bool enqueue_sysex(const uint8_t *sysex, uint8_t source)
{
    if (!sysex || !s_cmd_queue) {
        return false;
    }
    if (sysex[0] != 0xF0 || sysex[1] != 0x7D ||
        sysex[2] != 'E' || sysex[3] != 'M' || sysex[4] != 'W' ||
        sysex[EMW_SYSEX_BYTES - 1u] != 0xF7) {
        return false;
    }

    uint8_t decoded[EMW_USB_FRAME_SIZE] = {0};
    if (!decode_payload_7bit_fixed(&sysex[5], decoded)) {
        return false;
    }

    bool cmd_any = false;
    for (size_t i = 0; i < EMW_LANE_SIZE; ++i) {
        if (decoded[i] != 0u) {
            cmd_any = true;
            break;
        }
    }
    if (!cmd_any) {
        return true;
    }

    command_t cmd = {0};
    cmd.length = EMW_LANE_SIZE;
    cmd.source = source;
    memcpy(cmd.data, decoded, EMW_LANE_SIZE);
    return xQueueSendToBack(s_cmd_queue, &cmd, 0) == pdTRUE;
}

static bool decode_payload_7bit_fixed(const uint8_t *in, uint8_t *out)
{
    size_t in_pos = 0;
    size_t out_pos = 0;
    while (in_pos < EMW_ENCODED_BYTES && out_pos < EMW_USB_FRAME_SIZE) {
        uint8_t prefix = in[in_pos++];
        for (uint8_t j = 0; j < 7u && out_pos < EMW_USB_FRAME_SIZE; ++j) {
            if (in_pos >= EMW_ENCODED_BYTES) {
                return false;
            }
            uint8_t v = (uint8_t)(in[in_pos++] & 0x7Fu);
            if ((prefix & (uint8_t)(1u << j)) != 0u) {
                v |= 0x80u;
            }
            out[out_pos++] = v;
        }
    }
    return out_pos == EMW_USB_FRAME_SIZE;
}

static void encode_payload_7bit_fixed(const uint8_t *in, uint8_t *out)
{
    size_t in_pos = 0;
    size_t out_pos = 0;
    while (in_pos < EMW_USB_FRAME_SIZE && out_pos < EMW_ENCODED_BYTES) {
        uint8_t prefix = 0;
        uint8_t chunk[7] = {0};
        uint8_t chunk_len = 0;
        for (uint8_t j = 0; j < 7u && in_pos < EMW_USB_FRAME_SIZE; ++j) {
            uint8_t value = in[in_pos++];
            if ((value & 0x80u) != 0u) {
                prefix |= (uint8_t)(1u << j);
            }
            chunk[j] = (uint8_t)(value & 0x7Fu);
            chunk_len++;
        }
        out[out_pos++] = prefix;
        for (uint8_t j = 0; j < chunk_len; ++j) {
            out[out_pos++] = chunk[j];
        }
    }
}

static void websocket_server_task(void *arg)
{
    (void)arg;
    while (true) {
        struct sockaddr_in dest_addr = {0};
        dest_addr.sin_addr.s_addr = htonl(INADDR_ANY);
        dest_addr.sin_family = AF_INET;
        dest_addr.sin_port = htons(WIFI_CONTROL_PORT);

        int listen_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
        if (listen_sock < 0) {
            ESP_LOGE(TAG, "socket failed errno=%d", errno);
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        int opt = 1;
        (void)setsockopt(listen_sock, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
        if (bind(listen_sock, (struct sockaddr *)&dest_addr, sizeof(dest_addr)) != 0) {
            ESP_LOGE(TAG, "bind failed errno=%d", errno);
            close(listen_sock);
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        if (listen(listen_sock, 1) != 0) {
            ESP_LOGE(TAG, "listen failed errno=%d", errno);
            close(listen_sock);
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        s_listen_sock = listen_sock;
        ESP_LOGI(TAG, "WebSocket listening on %d%s", WIFI_CONTROL_PORT, WIFI_WS_PATH);

        while (s_listen_sock >= 0) {
            struct sockaddr_in source_addr;
            uint addr_len = sizeof(source_addr);
            int sock = accept(listen_sock, (struct sockaddr *)&source_addr, &addr_len);
            if (sock < 0) {
                if (errno != EBADF) {
                    ESP_LOGW(TAG, "accept failed errno=%d", errno);
                }
                break;
            }
            if (s_active_sock >= 0) {
                static const char busy[] = "HTTP/1.1 503 Busy\r\nConnection: close\r\nContent-Length: 4\r\n\r\nbusy";
                (void)send(sock, busy, strlen(busy), 0);
                close(sock);
                continue;
            }
            if (!websocket_handshake(sock)) {
                close(sock);
                continue;
            }

            s_active_sock = sock;
            s_session_connected = true;
            ESP_LOGI(TAG, "WebSocket session opened");
            for (;;) {
                uint8_t payload[128] = {0};
                size_t payload_len = 0;
                uint8_t opcode = 0;
                if (!websocket_read_frame(sock, payload, sizeof(payload), &payload_len, &opcode)) {
                    break;
                }
                if (opcode == 0x8u) {
                    break;
                }
                if (opcode != 0x2u || payload_len != EMW_SYSEX_BYTES || !enqueue_sysex(payload, EMW_COMMAND_SOURCE_WIFI)) {
                    break;
                }
            }
            ESP_LOGI(TAG, "WebSocket session closed");
            close_active_socket();
        }
        if (listen_sock >= 0) {
            close(listen_sock);
        }
        if (s_listen_sock == listen_sock) {
            s_listen_sock = -1;
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

static void init_serial_transport(void)
{
    uart_config_t uart_config = {
        .baud_rate = 115200,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .rx_flow_ctrl_thresh = 0,
    };
    ESP_ERROR_CHECK(uart_param_config(UART_NUM_0, &uart_config));
    ESP_ERROR_CHECK(uart_driver_install(UART_NUM_0, 1024, 1024, 0, NULL, 0));
    BaseType_t created = xTaskCreate(serial_transport_task, "emw_serial", 3072, NULL, 5, &s_serial_task);
    configASSERT(created == pdPASS);
    ESP_LOGI(TAG, "USB-serial setup transport ready at 115200 baud");
}

static void serial_transport_task(void *arg)
{
    (void)arg;
    uint8_t frame[EMW_SYSEX_BYTES] = {0};
    size_t pos = 0;
    for (;;) {
        uint8_t byte = 0;
        int len = uart_read_bytes(UART_NUM_0, &byte, 1, pdMS_TO_TICKS(100));
        if (len <= 0) {
            continue;
        }
        if (pos == 0u) {
            if (byte != 0xF0u) {
                continue;
            }
            frame[pos++] = byte;
            continue;
        }
        frame[pos++] = byte;
        if (pos == EMW_SYSEX_BYTES) {
            (void)enqueue_sysex(frame, EMW_COMMAND_SOURCE_SERIAL);
            pos = 0;
            memset(frame, 0, sizeof(frame));
        } else if (byte == 0xF0u) {
            frame[0] = 0xF0u;
            pos = 1;
        }
    }
}

static bool websocket_handshake(int sock)
{
    char request[1024] = {0};
    int total = 0;
    while (total < (int)(sizeof(request) - 1u)) {
        int r = recv(sock, request + total, sizeof(request) - 1u - total, 0);
        if (r <= 0) {
            return false;
        }
        total += r;
        request[total] = '\0';
        if (strstr(request, "\r\n\r\n")) {
            break;
        }
    }
    if (!strstr(request, "GET " WIFI_WS_PATH " ") ||
        !strstr(request, "Upgrade: websocket")) {
        static const char not_found[] = "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
        (void)send(sock, not_found, strlen(not_found), 0);
        return false;
    }

    const char *key_header = strstr(request, "Sec-WebSocket-Key:");
    if (!key_header) {
        return false;
    }
    key_header += strlen("Sec-WebSocket-Key:");
    while (*key_header == ' ' || *key_header == '\t') {
        key_header++;
    }
    char key[96] = {0};
    size_t key_len = 0;
    while (key_header[key_len] && key_header[key_len] != '\r' && key_header[key_len] != '\n' &&
           key_len < sizeof(key) - 1u) {
        key[key_len] = key_header[key_len];
        key_len++;
    }
    key[key_len] = '\0';

    char accept_src[160] = {0};
    snprintf(accept_src, sizeof(accept_src), "%s258EAFA5-E914-47DA-95CA-C5AB0DC85B11", key);
    uint8_t sha[20] = {0};
    mbedtls_sha1((const unsigned char *)accept_src, strlen(accept_src), sha);

    unsigned char b64[64] = {0};
    size_t b64_len = 0;
    if (mbedtls_base64_encode(b64, sizeof(b64), &b64_len, sha, sizeof(sha)) != 0) {
        return false;
    }
    b64[b64_len] = '\0';

    char response[256] = {0};
    int written = snprintf(response, sizeof(response),
                           "HTTP/1.1 101 Switching Protocols\r\n"
                           "Upgrade: websocket\r\n"
                           "Connection: Upgrade\r\n"
                           "Sec-WebSocket-Accept: %s\r\n"
                           "\r\n",
                           b64);
    return written > 0 && written < (int)sizeof(response) &&
           send(sock, response, written, 0) == written;
}

static bool websocket_read_exact(int sock, uint8_t *buf, size_t len)
{
    size_t got = 0;
    while (got < len) {
        int r = recv(sock, buf + got, len - got, 0);
        if (r <= 0) {
            return false;
        }
        got += (size_t)r;
    }
    return true;
}

static bool websocket_read_frame(int sock, uint8_t *payload, size_t payload_cap, size_t *payload_len, uint8_t *opcode)
{
    uint8_t header[2] = {0};
    if (!websocket_read_exact(sock, header, sizeof(header))) {
        return false;
    }
    *opcode = (uint8_t)(header[0] & 0x0Fu);
    bool masked = (header[1] & 0x80u) != 0u;
    uint64_t len = (uint64_t)(header[1] & 0x7Fu);
    if (len == 126u) {
        uint8_t ext[2] = {0};
        if (!websocket_read_exact(sock, ext, sizeof(ext))) {
            return false;
        }
        len = ((uint64_t)ext[0] << 8u) | ext[1];
    } else if (len == 127u) {
        return false;
    }
    if (len > payload_cap) {
        return false;
    }

    uint8_t mask[4] = {0};
    if (masked && !websocket_read_exact(sock, mask, sizeof(mask))) {
        return false;
    }
    if (!websocket_read_exact(sock, payload, (size_t)len)) {
        return false;
    }
    if (masked) {
        for (uint64_t i = 0; i < len; ++i) {
            payload[i] ^= mask[i % 4u];
        }
    }
    *payload_len = (size_t)len;
    return true;
}

static bool websocket_send_binary(int sock, const uint8_t *payload, size_t len)
{
    if (sock < 0 || !payload || len > 125u) {
        return false;
    }
    uint8_t header[2] = {0x82u, (uint8_t)len};
    if (send(sock, header, sizeof(header), 0) != (int)sizeof(header)) {
        return false;
    }
    return send(sock, payload, len, 0) == (int)len;
}

static bool load_wifi_config(wifi_config_store_t *out)
{
    if (!out) {
        return false;
    }
    memset(out, 0, sizeof(*out));
    nvs_handle nvs = 0;
    if (nvs_open(WIFI_NAMESPACE, NVS_READONLY, &nvs) != ESP_OK) {
        return false;
    }
    size_t ssid_len = sizeof(out->ssid);
    size_t pass_len = sizeof(out->password);
    size_t host_len = sizeof(out->hostname);
    esp_err_t err = nvs_get_str(nvs, WIFI_KEY_SSID, out->ssid, &ssid_len);
    if (err == ESP_OK) {
        (void)nvs_get_str(nvs, WIFI_KEY_PASS, out->password, &pass_len);
        (void)nvs_get_str(nvs, WIFI_KEY_HOST, out->hostname, &host_len);
    }
    nvs_close(nvs);
    if (out->hostname[0] == '\0' || !is_valid_hostname(out->hostname)) {
        default_hostname(out->hostname, sizeof(out->hostname));
    }
    return err == ESP_OK && out->ssid[0] != '\0';
}

static esp_err_t save_wifi_config(const wifi_config_store_t *config)
{
    nvs_handle nvs = 0;
    esp_err_t err = nvs_open(WIFI_NAMESPACE, NVS_READWRITE, &nvs);
    if (err != ESP_OK) {
        return err;
    }
    err = nvs_set_str(nvs, WIFI_KEY_SSID, config->ssid);
    if (err == ESP_OK) {
        err = nvs_set_str(nvs, WIFI_KEY_PASS, config->password);
    }
    if (err == ESP_OK) {
        err = nvs_set_str(nvs, WIFI_KEY_HOST, config->hostname);
    }
    if (err == ESP_OK) {
        err = nvs_commit(nvs);
    }
    nvs_close(nvs);
    return err;
}

static esp_err_t clear_wifi_config(void)
{
    nvs_handle nvs = 0;
    esp_err_t err = nvs_open(WIFI_NAMESPACE, NVS_READWRITE, &nvs);
    if (err == ESP_OK) {
        (void)nvs_erase_all(nvs);
        err = nvs_commit(nvs);
        nvs_close(nvs);
    }
    s_station_online = false;
    s_reconnect_pending = false;
    s_reconnect_attempt = 0;
    s_last_disconnect_reason = 0;
    memset(s_station_ipv4, 0, sizeof(s_station_ipv4));
    return err;
}

static void default_hostname(char *out, size_t out_len)
{
    uint8_t mac[6] = {0};
    if (esp_efuse_mac_get_default(mac) == ESP_OK) {
        snprintf(out, out_len, "emwaver-%02x%02x", mac[4], mac[5]);
    } else {
        copy_str(out, "emwaver-8266", out_len);
    }
}

static bool is_valid_hostname(const char *hostname)
{
    if (!hostname || hostname[0] == '\0') {
        return false;
    }
    size_t len = strlen(hostname);
    if (len > WIFI_MAX_HOST || hostname[0] == '-' || hostname[len - 1u] == '-') {
        return false;
    }
    for (size_t i = 0; i < len; ++i) {
        char c = hostname[i];
        if (!(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') && c != '-') {
            return false;
        }
    }
    return true;
}

static void start_station(void)
{
    if (!s_has_config) {
        return;
    }

    close_active_socket();
    stop_server_socket();
    stop_mdns();
    s_station_online = false;
    memset(s_station_ipv4, 0, sizeof(s_station_ipv4));

    wifi_config_t wifi_config = {0};
    copy_str((char *)wifi_config.sta.ssid, s_config.ssid, sizeof(wifi_config.sta.ssid));
    copy_str((char *)wifi_config.sta.password, s_config.password, sizeof(wifi_config.sta.password));
    if (s_config.password[0] != '\0') {
        wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    }

    if (s_wifi_started) {
        (void)esp_wifi_disconnect();
        (void)esp_wifi_stop();
        s_wifi_started = false;
    }
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(ESP_IF_WIFI_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    s_wifi_started = true;
    s_runtime_mode = WIFI_RUNTIME_STATION;
    ESP_LOGI(TAG, "Station starting for SSID '%s'", s_config.ssid);
}

static void start_softap(void)
{
    close_active_socket();
    stop_server_socket();
    stop_mdns();
    s_station_online = false;
    memset(s_station_ipv4, 0, sizeof(s_station_ipv4));

    uint8_t mac[6] = {0};
    (void)esp_efuse_mac_get_default(mac);
    char ssid[32] = {0};
    snprintf(ssid, sizeof(ssid), "EMWaver-8266-%02X%02X", mac[4], mac[5]);

    wifi_config_t wifi_config = {0};
    copy_str((char *)wifi_config.ap.ssid, ssid, sizeof(wifi_config.ap.ssid));
    wifi_config.ap.ssid_len = strlen(ssid);
    wifi_config.ap.channel = 1;
    wifi_config.ap.max_connection = 1;
    if (CONFIG_EMWAVER_ESP8266_AP_PASSWORD[0] == '\0') {
        wifi_config.ap.authmode = WIFI_AUTH_OPEN;
    } else {
        copy_str((char *)wifi_config.ap.password, CONFIG_EMWAVER_ESP8266_AP_PASSWORD, sizeof(wifi_config.ap.password));
        wifi_config.ap.authmode = WIFI_AUTH_WPA2_PSK;
    }

    if (s_wifi_started) {
        (void)esp_wifi_disconnect();
        (void)esp_wifi_stop();
        s_wifi_started = false;
    }
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(ESP_IF_WIFI_AP, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    s_wifi_started = true;
    s_runtime_mode = WIFI_RUNTIME_SOFTAP;
    if (!s_server_task) {
        (void)xTaskCreate(websocket_server_task, "emw_ws", 4096, NULL, 5, &s_server_task);
    }
    ESP_LOGI(TAG, "SoftAP provisioning active: ssid='%s' ws://192.168.4.1:%u%s", ssid, WIFI_CONTROL_PORT, WIFI_WS_PATH);
}

static void restart_wifi_for_config(void)
{
    start_station();
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    (void)arg;
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        (void)esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_event_sta_disconnected_t *event = (wifi_event_sta_disconnected_t *)event_data;
        s_last_disconnect_reason = event ? (uint16_t)event->reason : 0u;
        s_station_online = false;
        close_active_socket();
        stop_server_socket();
        stop_mdns();
        memset(s_station_ipv4, 0, sizeof(s_station_ipv4));
        if (s_runtime_mode == WIFI_RUNTIME_STATION && s_has_config && !s_reconnect_pending) {
            s_reconnect_pending = true;
            if (xTaskCreate(wifi_reconnect_task, "emw_reconnect", 2048, NULL, 4, NULL) != pdPASS) {
                s_reconnect_pending = false;
                (void)esp_wifi_connect();
            }
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        if (event) {
            s_station_ipv4[0] = ip4_addr1(&event->ip_info.ip);
            s_station_ipv4[1] = ip4_addr2(&event->ip_info.ip);
            s_station_ipv4[2] = ip4_addr3(&event->ip_info.ip);
            s_station_ipv4[3] = ip4_addr4(&event->ip_info.ip);
            ESP_LOGI(TAG, "Station IP: " IPSTR, IP2STR(&event->ip_info.ip));
        }
        s_station_online = true;
        s_reconnect_pending = false;
        s_reconnect_attempt = 0;
        s_last_disconnect_reason = 0;
        if (!s_server_task) {
            (void)xTaskCreate(websocket_server_task, "emw_ws", 4096, NULL, 5, &s_server_task);
        }
        if (publish_mdns()) {
            ESP_LOGI(TAG, "mDNS published as %s.local", s_config.hostname);
        }
    }
}

static void wifi_reconnect_task(void *arg)
{
    (void)arg;
    uint32_t delay_ms = WIFI_RECONNECT_BASE_MS;
    for (uint8_t i = 0; i < s_reconnect_attempt && delay_ms < WIFI_RECONNECT_MAX_MS; ++i) {
        delay_ms *= 2u;
        if (delay_ms > WIFI_RECONNECT_MAX_MS) {
            delay_ms = WIFI_RECONNECT_MAX_MS;
        }
    }
    if (s_reconnect_attempt < 8u) {
        s_reconnect_attempt++;
    }
    ESP_LOGW(TAG, "Station disconnected; reconnecting in %u ms", (unsigned)delay_ms);
    vTaskDelay(pdMS_TO_TICKS(delay_ms));
    s_reconnect_pending = false;
    if (s_has_config && s_runtime_mode == WIFI_RUNTIME_STATION) {
        (void)esp_wifi_connect();
    }
    vTaskDelete(NULL);
}

static bool publish_mdns(void)
{
    if (!s_has_config || !s_station_online) {
        return false;
    }
    if (s_mdns_started) {
        mdns_free();
        s_mdns_started = false;
    }

    char local_id[8] = {0};
    build_local_id_suffix(local_id, sizeof(local_id));
    mdns_txt_item_t txt[] = {
        {"proto", "1"},
        {"board", EMW_TARGET_BOARD_TYPE},
        {"fw", EMWAVER_FIRMWARE_VERSION_STRING},
        {"cap", EMW_TARGET_CAPABILITIES},
        {"id", local_id},
        {"host", s_config.hostname},
    };

    if (mdns_init() != ESP_OK ||
        mdns_hostname_set(s_config.hostname) != ESP_OK ||
        mdns_instance_name_set(s_config.hostname) != ESP_OK ||
        mdns_service_add(s_config.hostname, "_emwaver", "_tcp", WIFI_CONTROL_PORT, txt, sizeof(txt) / sizeof(txt[0])) != ESP_OK) {
        mdns_free();
        s_mdns_started = false;
        return false;
    }
    s_mdns_started = true;
    return true;
}

static void stop_mdns(void)
{
    if (s_mdns_started) {
        mdns_free();
        s_mdns_started = false;
    }
}

static void close_active_socket(void)
{
    if (s_active_sock >= 0) {
        shutdown(s_active_sock, 0);
        close(s_active_sock);
    }
    s_active_sock = -1;
    s_session_connected = false;
}

static void stop_server_socket(void)
{
    if (s_listen_sock >= 0) {
        shutdown(s_listen_sock, 0);
        close(s_listen_sock);
    }
    s_listen_sock = -1;
}

static void restart_task(void *arg)
{
    (void)arg;
    vTaskDelay(pdMS_TO_TICKS(25));
    esp_restart();
}

static void get_default_device_name(char *out, size_t out_len)
{
    uint8_t mac[6] = {0};
    if (esp_efuse_mac_get_default(mac) == ESP_OK) {
        snprintf(out, out_len, "%s-%02X%02X", EMW_TARGET_DEVICE_NAME_PREFIX, mac[4], mac[5]);
    } else {
        copy_str(out, EMW_TARGET_DEVICE_NAME_PREFIX, out_len);
    }
}

static void load_device_name(char *out, size_t out_len)
{
    if (!out || out_len == 0u) {
        return;
    }
    nvs_handle nvs = 0;
    if (nvs_open(DEVICE_NAME_NAMESPACE, NVS_READONLY, &nvs) != ESP_OK) {
        get_default_device_name(out, out_len);
        return;
    }
    size_t len = out_len;
    esp_err_t err = nvs_get_str(nvs, DEVICE_NAME_KEY, out, &len);
    nvs_close(nvs);
    if (err != ESP_OK || out[0] == '\0') {
        get_default_device_name(out, out_len);
    }
}

static void transport_expire_stale_claim(void)
{
    if (s_active_transport == EMW_TRANSPORT_SOURCE_NONE) {
        return;
    }
    TickType_t now = xTaskGetTickCount();
    TickType_t timeout = pdMS_TO_TICKS(EMW_TRANSPORT_SESSION_TIMEOUT_MS);
    if ((now - s_last_transport_activity_tick) > timeout) {
        s_active_transport = EMW_TRANSPORT_SOURCE_NONE;
    }
}

static bool is_transport_session_status(const command_t *cmd)
{
    return cmd && cmd->length == EMW_LANE_SIZE &&
           cmd->data[0] == EMW_OP_TRANSPORT_SESSION &&
           cmd->data[1] == EMW_TRANSPORT_SESSION_STATUS;
}

static bool is_transport_session_connect(const command_t *cmd)
{
    return cmd && cmd->length == EMW_LANE_SIZE &&
           cmd->data[0] == EMW_OP_TRANSPORT_SESSION &&
           cmd->data[1] == EMW_TRANSPORT_SESSION_CONNECT;
}

static bool is_allowed_discovery_command(const command_t *cmd)
{
    if (!cmd || cmd->length != EMW_LANE_SIZE) {
        return false;
    }
    switch (cmd->data[0]) {
        case EMW_OP_VERSION:
        case EMW_OP_HARDWARE_UID_GET:
        case EMW_OP_BOARD_GET:
        case EMW_OP_NAME_GET:
            return true;
        case EMW_OP_WIFI_CONFIG:
            return cmd->data[1] == EMW_WIFI_CFG_STATUS;
        case EMW_OP_TRANSPORT_SESSION:
            return cmd->data[1] == EMW_TRANSPORT_SESSION_STATUS;
        default:
            return false;
    }
}

static bool transport_session_allows_command(const command_t *cmd)
{
    if (!cmd) {
        return false;
    }
    transport_expire_stale_claim();
    if (is_transport_session_connect(cmd)) {
        return s_active_transport == EMW_TRANSPORT_SOURCE_NONE || s_active_transport == cmd->source;
    }
    if (is_transport_session_status(cmd) || is_allowed_discovery_command(cmd)) {
        return true;
    }
    if (s_active_transport == EMW_TRANSPORT_SOURCE_NONE) {
        return false;
    }
    if (s_active_transport != cmd->source) {
        return false;
    }
    s_last_transport_activity_tick = xTaskGetTickCount();
    return true;
}

static bool transport_session_connect(uint8_t source)
{
    transport_expire_stale_claim();
    if (source == EMW_TRANSPORT_SOURCE_NONE) {
        return false;
    }
    if (s_active_transport != EMW_TRANSPORT_SOURCE_NONE && s_active_transport != source) {
        return false;
    }
    s_active_transport = source;
    s_last_transport_activity_tick = xTaskGetTickCount();
    return true;
}

static bool transport_session_disconnect(uint8_t source)
{
    transport_expire_stale_claim();
    if (s_active_transport == EMW_TRANSPORT_SOURCE_NONE) {
        return true;
    }
    if (s_active_transport != source) {
        return false;
    }
    s_active_transport = EMW_TRANSPORT_SOURCE_NONE;
    return true;
}

static bool transport_session_heartbeat(uint8_t source)
{
    transport_expire_stale_claim();
    if (s_active_transport != source || source == EMW_TRANSPORT_SOURCE_NONE) {
        return false;
    }
    s_last_transport_activity_tick = xTaskGetTickCount();
    return true;
}

static uint8_t transport_session_active_source(void)
{
    transport_expire_stale_claim();
    return s_active_transport;
}

static void copy_str(char *dst, const char *src, size_t dst_len)
{
    if (!dst || dst_len == 0u) {
        return;
    }
    if (!src) {
        dst[0] = '\0';
        return;
    }
    size_t n = strlen(src);
    if (n >= dst_len) {
        n = dst_len - 1u;
    }
    memcpy(dst, src, n);
    dst[n] = '\0';
}

static void build_local_id_suffix(char *out, size_t out_len)
{
    uint8_t mac[6] = {0};
    if (esp_efuse_mac_get_default(mac) == ESP_OK) {
        snprintf(out, out_len, "%02X%02X", mac[4], mac[5]);
    } else {
        copy_str(out, "8266", out_len);
    }
}
