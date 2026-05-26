/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

#include "wifi_transport.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include "command_registry.h"
#include "emw_target.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/task.h"
#include "mdns.h"
#include "nvs.h"
#include "sampler.h"
#include "sdkconfig.h"
#include "transport_debug.h"
#include "transport_session.h"
#include "firmware_version.h"
#include "usb.h"

#ifndef EMWAVER_ENABLE_WIFI_TRANSPORT
#ifdef CONFIG_EMWAVER_ENABLE_WIFI_TRANSPORT
#define EMWAVER_ENABLE_WIFI_TRANSPORT CONFIG_EMWAVER_ENABLE_WIFI_TRANSPORT
#else
#define EMWAVER_ENABLE_WIFI_TRANSPORT 1
#endif
#endif

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
#define EMW_SYSEX_BYTES 48u
#define EMW_ENCODED_BYTES 42u
#define EMW_LANE_SIZE 18u

typedef struct {
    char ssid[WIFI_MAX_SSID + 1u];
    char password[WIFI_MAX_PASS + 1u];
    char hostname[WIFI_MAX_HOST + 1u];
} wifi_transport_config_t;

static const char *TAG = "WIFI_TRANSPORT";
static QueueHandle_t s_cmd_queue;
static httpd_handle_t s_httpd;
static int s_active_fd = -1;
static bool s_session_connected;
static wifi_transport_config_t s_config;
static bool s_has_config;
static bool s_netif_ready;
static bool s_station_started;
static bool s_station_online;
static uint8_t s_reconnect_attempt;
static bool s_reconnect_pending;
static bool s_suppress_next_disconnect_reconnect;
static bool s_runtime_suspended;
static uint16_t s_last_disconnect_reason;
static char s_station_ip[16];
static uint8_t s_station_ipv4[4];

static void wifi_register_commands(void);
static void wifi_provision_command(const char *ssid, const char *password);
static void wifi_clear_command(void);
static void wifi_status_command(void);
static bool load_config(wifi_transport_config_t *out);
static esp_err_t save_config(const wifi_transport_config_t *config);
static bool config_field_fits(const char *value, size_t max_len);
static void default_hostname(char *out, size_t out_len);
static bool is_valid_hostname(const char *hostname);
static void start_station(void);
static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data);
static void wifi_reconnect_task(void *arg);
static void start_server(void);
static void stop_server(void);
static void close_session(httpd_handle_t hd, int sockfd);
static void clear_active_session_state(void);
static void close_active_session(int sockfd);
static bool publish_mdns(void);
static void build_mdns_instance_name(char *out, size_t out_len);
static void build_local_id_suffix(char *out, size_t out_len);
static esp_err_t ws_handler(httpd_req_t *req);
static bool enqueue_sysex(const uint8_t *sysex);
static bool decode_payload_7bit_fixed(const uint8_t *in, uint8_t *out);
static void encode_payload_7bit_fixed(const uint8_t *in, uint8_t *out);
static esp_err_t send_superframe(const uint8_t *frame);

void wifi_transport_init(QueueHandle_t cmd_queue)
{
    s_cmd_queue = cmd_queue;
    wifi_register_commands();

#if EMWAVER_ENABLE_WIFI_TRANSPORT
    s_has_config = load_config(&s_config);
    if (!s_has_config) {
        ESP_LOGI(TAG, "Wi-Fi transport waiting for local provisioning");
        return;
    }
    start_station();
#else
    ESP_LOGI(TAG, "Wi-Fi transport disabled at compile time");
#endif
}

esp_err_t wifi_transport_send_cmd_response(uint8_t status, const uint8_t *payload, size_t payload_len)
{
    if (!s_httpd || s_active_fd < 0) {
        return ESP_ERR_INVALID_STATE;
    }

    if (payload_len > (EMW_LANE_SIZE - 1u)) {
        payload_len = EMW_LANE_SIZE - 1u;
    }

    uint8_t frame[EMW_USB_FRAME_SIZE] = {0};
    frame[0] = status;
    if (payload && payload_len > 0) {
        memcpy(&frame[1], payload, payload_len);
    }
    return send_superframe(frame);
}

esp_err_t wifi_transport_send_stream_lane(const uint8_t *stream_lane, bool nonblocking)
{
    (void)nonblocking;
    if (!stream_lane) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!s_httpd || s_active_fd < 0) {
        return ESP_ERR_INVALID_STATE;
    }

    uint8_t frame[EMW_USB_FRAME_SIZE] = {0};
    memcpy(&frame[EMW_LANE_SIZE], stream_lane, EMW_LANE_SIZE);
    return send_superframe(frame);
}

esp_err_t wifi_transport_send_buffer_status(uint16_t status, bool nonblocking)
{
    (void)nonblocking;
    if (!s_httpd || s_active_fd < 0) {
        return ESP_ERR_INVALID_STATE;
    }

    uint8_t frame[EMW_USB_FRAME_SIZE] = {0};
    frame[EMW_LANE_SIZE + 0u] = 'B';
    frame[EMW_LANE_SIZE + 1u] = 'S';
    frame[EMW_LANE_SIZE + 2u] = (uint8_t)(status >> 8u);
    frame[EMW_LANE_SIZE + 3u] = (uint8_t)(status & 0xffu);
    return send_superframe(frame);
}

esp_err_t wifi_transport_provision(const char *ssid, const char *password)
{
    if (!config_field_fits(ssid, WIFI_MAX_SSID) ||
        !config_field_fits(password, WIFI_MAX_PASS)) {
        return ESP_ERR_INVALID_ARG;
    }

    wifi_transport_config_t config = {0};
    strlcpy(config.ssid, ssid ? ssid : "", sizeof(config.ssid));
    strlcpy(config.password, password ? password : "", sizeof(config.password));
    default_hostname(config.hostname, sizeof(config.hostname));

    if (config.ssid[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = save_config(&config);
    if (err != ESP_OK) {
        return err;
    }

    s_config = config;
    s_has_config = true;
#if EMWAVER_ENABLE_WIFI_TRANSPORT
    start_station();
#endif
    return ESP_OK;
}

esp_err_t wifi_transport_clear_config(void)
{
    nvs_handle_t nvs = 0;
    esp_err_t err = nvs_open(WIFI_NAMESPACE, NVS_READWRITE, &nvs);
    if (err == ESP_OK) {
        (void)nvs_erase_all(nvs);
        err = nvs_commit(nvs);
        nvs_close(nvs);
    }
    if (err == ESP_OK) {
        memset(&s_config, 0, sizeof(s_config));
        s_has_config = false;
        clear_active_session_state();
        s_station_online = false;
        s_reconnect_attempt = 0;
        s_reconnect_pending = false;
        s_suppress_next_disconnect_reconnect = false;
        s_last_disconnect_reason = 0;
        s_station_ip[0] = '\0';
        memset(s_station_ipv4, 0, sizeof(s_station_ipv4));
#if EMWAVER_ENABLE_WIFI_TRANSPORT
        stop_server();
        (void)esp_wifi_disconnect();
        (void)esp_wifi_stop();
        s_station_started = false;
#endif
    }
    return err;
}

void wifi_transport_suspend_runtime(void)
{
#if EMWAVER_ENABLE_WIFI_TRANSPORT
    s_runtime_suspended = true;
    clear_active_session_state();
    s_station_online = false;
    s_station_started = false;
    s_reconnect_attempt = 0;
    s_reconnect_pending = false;
    s_suppress_next_disconnect_reconnect = true;
    s_last_disconnect_reason = 0;
    s_station_ip[0] = '\0';
    memset(s_station_ipv4, 0, sizeof(s_station_ipv4));
    stop_server();
    if (s_netif_ready) {
        (void)esp_wifi_disconnect();
        (void)esp_wifi_stop();
    }
#endif
}

void wifi_transport_resume_runtime(void)
{
#if EMWAVER_ENABLE_WIFI_TRANSPORT
    if (!s_runtime_suspended) {
        return;
    }
    s_runtime_suspended = false;
    s_suppress_next_disconnect_reconnect = false;
    if (s_has_config) {
        start_station();
    }
#endif
}

bool wifi_transport_is_provisioned(void)
{
    return s_has_config;
}

bool wifi_transport_is_session_connected(void)
{
    return s_session_connected;
}

bool wifi_transport_is_station_online(void)
{
    return s_station_online;
}

bool wifi_transport_is_reconnecting(void)
{
    return s_reconnect_pending;
}

uint16_t wifi_transport_last_disconnect_reason(void)
{
    return s_last_disconnect_reason;
}

bool wifi_transport_station_ipv4(uint8_t out[4])
{
    if (!out || !s_station_online || s_station_ip[0] == '\0') {
        return false;
    }
    memcpy(out, s_station_ipv4, sizeof(s_station_ipv4));
    return true;
}

static void wifi_register_commands(void)
{
    (void)register_command(
        "wifi provision",
        (void *)wifi_provision_command,
        (const cmd_arg_spec_t[]){
            {"ssid", CMD_ARG_STRING, true},
            {"password", CMD_ARG_STRING, true},
            {NULL, CMD_ARG_DONE, false},
        });
    (void)register_command("wifi clear", (void *)wifi_clear_command, (const cmd_arg_spec_t[]){{NULL, CMD_ARG_DONE, false}});
    (void)register_command("wifi status", (void *)wifi_status_command, (const cmd_arg_spec_t[]){{NULL, CMD_ARG_DONE, false}});
}

static void wifi_provision_command(const char *ssid, const char *password)
{
    if (wifi_transport_provision(ssid, password) != ESP_OK) {
        command_send_err("wifi nvs");
        return;
    }
    command_send_ok((const uint8_t *)"wifi provisioned", strlen("wifi provisioned"));
}

static void wifi_clear_command(void)
{
    if (wifi_transport_clear_config() != ESP_OK) {
        command_send_err("wifi clear");
        return;
    }
    command_send_ok((const uint8_t *)"wifi cleared", strlen("wifi cleared"));
}

static void wifi_status_command(void)
{
    char status[160];
    const uint16_t reason = s_last_disconnect_reason;
    const char *ip = s_station_ip[0] != '\0' ? s_station_ip : "none";
    const bool runtime_running = sampler_is_sampling() || sampler_is_transmitting();
    snprintf(
        status,
        sizeof(status),
        "wifi:%s:%s:%s:%s:runtime=%s:host=%s:ip=%s:reason=%u",
        s_has_config ? "provisioned" : "unprovisioned",
        s_station_online ? "online" : "offline",
        s_session_connected ? "connected" : "idle",
        s_reconnect_pending ? "reconnecting" : "stable",
        runtime_running ? "running" : "idle",
        s_config.hostname[0] != '\0' ? s_config.hostname : "none",
        ip,
        (unsigned)reason
    );
    command_send_ok((const uint8_t *)status, strlen(status));
}

static bool load_config(wifi_transport_config_t *out)
{
    if (!out) {
        return false;
    }
    memset(out, 0, sizeof(*out));
    nvs_handle_t nvs = 0;
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

static esp_err_t save_config(const wifi_transport_config_t *config)
{
    nvs_handle_t nvs = 0;
    esp_err_t err = nvs_open(WIFI_NAMESPACE, NVS_READWRITE, &nvs);
    if (err != ESP_OK) {
        return err;
    }
    err = nvs_set_str(nvs, WIFI_KEY_SSID, config->ssid);
    if (err == ESP_OK) err = nvs_set_str(nvs, WIFI_KEY_PASS, config->password);
    if (err == ESP_OK) err = nvs_set_str(nvs, WIFI_KEY_HOST, config->hostname);
    if (err == ESP_OK) err = nvs_commit(nvs);
    nvs_close(nvs);
    return err;
}

static bool config_field_fits(const char *value, size_t max_len)
{
    return !value || strlen(value) <= max_len;
}

static void default_hostname(char *out, size_t out_len)
{
    uint8_t mac[6] = {0};
    if (esp_efuse_mac_get_default(mac) == ESP_OK) {
        snprintf(out, out_len, "emwaver-%02x%02x", mac[4], mac[5]);
    } else {
        strlcpy(out, "emwaver-esp32", out_len);
    }
}

static bool is_valid_hostname(const char *hostname)
{
    if (!hostname || hostname[0] == '\0') {
        return false;
    }

    const size_t len = strlen(hostname);
    if (len > WIFI_MAX_HOST || hostname[0] == '-' || hostname[len - 1u] == '-') {
        return false;
    }

    for (size_t i = 0; i < len; ++i) {
        const char c = hostname[i];
        const bool is_digit = c >= '0' && c <= '9';
        const bool is_lower = c >= 'a' && c <= 'z';
        if (!is_digit && !is_lower && c != '-') {
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
    if (!s_netif_ready) {
        ESP_ERROR_CHECK(esp_netif_init());
        esp_err_t err = esp_event_loop_create_default();
        if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
            ESP_ERROR_CHECK(err);
        }
        (void)esp_netif_create_default_wifi_sta();
        wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
        ESP_ERROR_CHECK(esp_wifi_init(&init));
        ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL, NULL));
        ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL, NULL));
        s_netif_ready = true;
    }

    wifi_config_t wifi_config = {0};
    strlcpy((char *)wifi_config.sta.ssid, s_config.ssid, sizeof(wifi_config.sta.ssid));
    strlcpy((char *)wifi_config.sta.password, s_config.password, sizeof(wifi_config.sta.password));
    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    if (s_config.password[0] == '\0') {
        wifi_config.sta.threshold.authmode = WIFI_AUTH_OPEN;
    }

    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    if (s_station_started) {
        clear_active_session_state();
        s_station_online = false;
        s_reconnect_attempt = 0;
        s_reconnect_pending = false;
        s_suppress_next_disconnect_reconnect = true;
        s_last_disconnect_reason = 0;
        s_station_ip[0] = '\0';
        memset(s_station_ipv4, 0, sizeof(s_station_ipv4));
        stop_server();
        (void)esp_wifi_disconnect();
    }
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    if (!s_station_started) {
        ESP_ERROR_CHECK(esp_wifi_start());
        s_station_started = true;
        ESP_LOGI(TAG, "Wi-Fi station starting for SSID '%s'", s_config.ssid);
    } else {
        esp_err_t err = esp_wifi_connect();
        if (err != ESP_OK && err != ESP_ERR_WIFI_STATE) {
            ESP_ERROR_CHECK(err);
        }
        ESP_LOGI(TAG, "Wi-Fi station reconnecting for SSID '%s'", s_config.ssid);
    }
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    (void)arg;
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        s_station_started = true;
        (void)esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        const wifi_event_sta_disconnected_t *disconnected = (const wifi_event_sta_disconnected_t *)event_data;
        s_last_disconnect_reason = disconnected ? (uint16_t)disconnected->reason : 0u;
        clear_active_session_state();
        s_station_online = false;
        s_station_ip[0] = '\0';
        memset(s_station_ipv4, 0, sizeof(s_station_ipv4));
        stop_server();
        if (s_suppress_next_disconnect_reconnect) {
            s_last_disconnect_reason = 0;
            s_suppress_next_disconnect_reconnect = false;
            return;
        }
        if (s_has_config && !s_reconnect_pending) {
            s_reconnect_pending = true;
            if (xTaskCreate(wifi_reconnect_task, "wifi_reconnect", 2048, NULL, 4, NULL) != pdPASS) {
                ESP_LOGW(TAG, "failed to start Wi-Fi reconnect task; reconnecting immediately");
                s_reconnect_pending = false;
                (void)esp_wifi_connect();
            }
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *got_ip = (const ip_event_got_ip_t *)event_data;
        if (got_ip) {
            snprintf(s_station_ip, sizeof(s_station_ip), IPSTR, IP2STR(&got_ip->ip_info.ip));
            s_station_ipv4[0] = esp_ip4_addr1_16(&got_ip->ip_info.ip);
            s_station_ipv4[1] = esp_ip4_addr2_16(&got_ip->ip_info.ip);
            s_station_ipv4[2] = esp_ip4_addr3_16(&got_ip->ip_info.ip);
            s_station_ipv4[3] = esp_ip4_addr4_16(&got_ip->ip_info.ip);
        } else {
            s_station_ip[0] = '\0';
            memset(s_station_ipv4, 0, sizeof(s_station_ipv4));
        }
        s_station_online = true;
        s_reconnect_attempt = 0;
        s_reconnect_pending = false;
        s_last_disconnect_reason = 0;
        start_server();
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
    ESP_LOGW(TAG, "Wi-Fi disconnected; reconnecting in %u ms", (unsigned)delay_ms);
    vTaskDelay(pdMS_TO_TICKS(delay_ms));
    s_reconnect_pending = false;
    if (s_has_config) {
        (void)esp_wifi_connect();
    }
    vTaskDelete(NULL);
}

static void start_server(void)
{
    if (s_httpd) {
        return;
    }

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = WIFI_CONTROL_PORT;
    config.ctrl_port = WIFI_CONTROL_PORT + 1;
    config.lru_purge_enable = true;
    config.close_fn = close_session;

    if (httpd_start(&s_httpd, &config) != ESP_OK) {
        ESP_LOGE(TAG, "failed to start Wi-Fi WebSocket server");
        s_httpd = NULL;
        return;
    }

    httpd_uri_t ws = {
        .uri = WIFI_WS_PATH,
        .method = HTTP_GET,
        .handler = ws_handler,
        .user_ctx = NULL,
        .is_websocket = true,
    };
    if (httpd_register_uri_handler(s_httpd, &ws) != ESP_OK) {
        ESP_LOGE(TAG, "failed to register Wi-Fi WebSocket handler");
        (void)httpd_stop(s_httpd);
        s_httpd = NULL;
        return;
    }

    if (publish_mdns()) {
        ESP_LOGI(TAG, "Wi-Fi WebSocket listening on port %d%s as %s.local", WIFI_CONTROL_PORT, WIFI_WS_PATH, s_config.hostname);
    } else {
        ESP_LOGW(TAG, "Wi-Fi WebSocket listening on port %d%s; mDNS advertisement unavailable", WIFI_CONTROL_PORT, WIFI_WS_PATH);
    }
}

static void stop_server(void)
{
    if (s_httpd) {
        (void)httpd_stop(s_httpd);
        s_httpd = NULL;
    }
    mdns_free();
}

static void close_session(httpd_handle_t hd, int sockfd)
{
    (void)hd;
    if (sockfd == s_active_fd) {
        clear_active_session_state();
    }
    close(sockfd);
}

static void clear_active_session_state(void)
{
    s_active_fd = -1;
    s_session_connected = false;
}

static void close_active_session(int sockfd)
{
    if (sockfd == s_active_fd) {
        clear_active_session_state();
    }
    if (s_httpd) {
        (void)httpd_sess_trigger_close(s_httpd, sockfd);
    }
}

static bool publish_mdns(void)
{
    char instance_name[48];
    char local_id[8];
    build_mdns_instance_name(instance_name, sizeof(instance_name));
    build_local_id_suffix(local_id, sizeof(local_id));

    esp_err_t err = mdns_init();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGW(TAG, "failed to initialize mDNS: %s", esp_err_to_name(err));
        return false;
    }

    err = mdns_hostname_set(s_config.hostname);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "failed to set mDNS hostname '%s': %s", s_config.hostname, esp_err_to_name(err));
        mdns_free();
        return false;
    }

    err = mdns_instance_name_set(instance_name);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "failed to set mDNS instance name: %s", esp_err_to_name(err));
        mdns_free();
        return false;
    }

    err = mdns_service_add(instance_name, "_emwaver", "_tcp", WIFI_CONTROL_PORT, NULL, 0);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "failed to publish mDNS service: %s", esp_err_to_name(err));
        mdns_free();
        return false;
    }

    bool txt_ok = true;
    txt_ok = txt_ok && mdns_service_txt_item_set("_emwaver", "_tcp", "proto", "1") == ESP_OK;
    txt_ok = txt_ok && mdns_service_txt_item_set("_emwaver", "_tcp", "board", EMW_TARGET_BOARD_TYPE) == ESP_OK;
    txt_ok = txt_ok && mdns_service_txt_item_set("_emwaver", "_tcp", "fw", EMWAVER_FIRMWARE_VERSION_STRING) == ESP_OK;
    txt_ok = txt_ok && mdns_service_txt_item_set("_emwaver", "_tcp", "cap", EMW_TARGET_CAPABILITIES) == ESP_OK;
    txt_ok = txt_ok && mdns_service_txt_item_set("_emwaver", "_tcp", "id", local_id) == ESP_OK;
    txt_ok = txt_ok && mdns_service_txt_item_set("_emwaver", "_tcp", "host", s_config.hostname) == ESP_OK;
    if (!txt_ok) {
        ESP_LOGW(TAG, "published mDNS service without complete TXT metadata");
    }
    return true;
}

static void build_mdns_instance_name(char *out, size_t out_len)
{
    strlcpy(out, s_config.hostname[0] != '\0' ? s_config.hostname : "emwaver-esp32", out_len);
}

static void build_local_id_suffix(char *out, size_t out_len)
{
    uint8_t mac[6] = {0};
    if (esp_efuse_mac_get_default(mac) == ESP_OK) {
        snprintf(out, out_len, "%02X%02X", mac[4], mac[5]);
    } else {
        strlcpy(out, "ESP32", out_len);
    }
}

static esp_err_t ws_handler(httpd_req_t *req)
{
    const int current_fd = httpd_req_to_sockfd(req);
    if (req->method == HTTP_GET) {
        ESP_LOGI(TAG, "Wi-Fi WebSocket session opened fd=%d", current_fd);
        if (s_active_fd >= 0 && s_active_fd != current_fd) {
            ESP_LOGW(TAG, "Wi-Fi WebSocket busy; rejecting fd=%d active=%d", current_fd, s_active_fd);
            httpd_ws_frame_t reply = {
                .final = true,
                .fragmented = false,
                .type = HTTPD_WS_TYPE_TEXT,
                .payload = (uint8_t *)"busy",
                .len = strlen("busy"),
            };
            (void)httpd_ws_send_frame(req, &reply);
            return ESP_FAIL;
        }
        s_active_fd = current_fd;
        s_session_connected = true;
        return ESP_OK;
    }

    httpd_ws_frame_t frame = {0};
    frame.type = HTTPD_WS_TYPE_BINARY;
    esp_err_t err = httpd_ws_recv_frame(req, &frame, 0);
    if (err != ESP_OK || frame.len == 0 || frame.len > 256) {
        ESP_LOGW(TAG, "Wi-Fi WebSocket frame header failed fd=%d err=%s len=%u", current_fd, esp_err_to_name(err), (unsigned)frame.len);
        close_active_session(current_fd);
        return err == ESP_OK ? ESP_FAIL : err;
    }

    uint8_t data[256] = {0};
    frame.payload = data;
    err = httpd_ws_recv_frame(req, &frame, sizeof(data));
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Wi-Fi WebSocket frame read failed fd=%d err=%s", current_fd, esp_err_to_name(err));
        close_active_session(current_fd);
        return err;
    }

    if (s_active_fd >= 0 && s_active_fd != current_fd) {
        httpd_ws_frame_t reply = {
            .final = true,
            .fragmented = false,
            .type = HTTPD_WS_TYPE_TEXT,
            .payload = (uint8_t *)"busy",
            .len = strlen("busy"),
        };
        (void)httpd_ws_send_frame(req, &reply);
        return ESP_FAIL;
    }

    if (frame.type != HTTPD_WS_TYPE_BINARY || frame.len != EMW_SYSEX_BYTES ||
        !enqueue_sysex(data)) {
        close_active_session(current_fd);
        return ESP_FAIL;
    }
    return ESP_OK;
}

static bool enqueue_sysex(const uint8_t *sysex)
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
        if (decoded[i] != 0) {
            cmd_any = true;
            break;
        }
    }

    const uint8_t *stream_lane = &decoded[EMW_LANE_SIZE];
    bool stream_any = false;
    for (size_t i = 0; i < EMW_LANE_SIZE; ++i) {
        if (stream_lane[i] != 0) {
            stream_any = true;
            break;
        }
    }
    if ((stream_any || !cmd_any) &&
        transport_session_allows_stream(EMW_COMMAND_SOURCE_WIFI)) {
        uint16_t bytes_available = 0;
        if (usb_ingest_stream_lane(stream_lane, &bytes_available)) {
            (void)wifi_transport_send_buffer_status(bytes_available, true);
        }
    }

    if (!cmd_any) {
        return true;
    }

    transport_debug_log_lane(EMW_COMMAND_SOURCE_WIFI, "rx", decoded, EMW_LANE_SIZE);

    command_t cmd = {0};
    cmd.length = EMW_LANE_SIZE;
    cmd.source = EMW_COMMAND_SOURCE_WIFI;
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

static esp_err_t send_superframe(const uint8_t *frame)
{
    uint8_t sysex[EMW_SYSEX_BYTES] = {0};
    sysex[0] = 0xF0;
    sysex[1] = 0x7D;
    sysex[2] = 'E';
    sysex[3] = 'M';
    sysex[4] = 'W';
    encode_payload_7bit_fixed(frame, &sysex[5]);
    sysex[EMW_SYSEX_BYTES - 1u] = 0xF7;

    httpd_ws_frame_t ws = {
        .final = true,
        .fragmented = false,
        .type = HTTPD_WS_TYPE_BINARY,
        .payload = sysex,
        .len = sizeof(sysex),
    };
    return httpd_ws_send_data(s_httpd, s_active_fd, &ws);
}
