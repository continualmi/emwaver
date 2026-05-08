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
#include "esp_random.h"
#include "esp_wifi.h"
#include "freertos/task.h"
#include "mdns.h"
#include "mbedtls/md.h"
#include "nvs.h"
#include "sdkconfig.h"
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
#define WIFI_KEY_SECRET "secret"
#define WIFI_MAX_SSID 32u
#define WIFI_MAX_PASS 64u
#define WIFI_MAX_HOST 32u
#define WIFI_MAX_SECRET 64u
#define WIFI_CONTROL_PORT 3922
#define WIFI_WS_PATH "/v1/ws"
#define WIFI_FIRMWARE_VERSION "1.0.0"
#define WIFI_RECONNECT_BASE_MS 1000u
#define WIFI_RECONNECT_MAX_MS 30000u
#define WIFI_AUTH_TIMEOUT_MS 8000u
#define WIFI_ENVELOPE_HEADER_BYTES 10u
#define WIFI_ENVELOPE_VERSION 1u
#define WIFI_ENVELOPE_KIND_SYSEX 1u
#define EMW_SYSEX_BYTES 48u
#define EMW_ENCODED_BYTES 42u
#define EMW_LANE_SIZE 18u

typedef struct {
    char ssid[WIFI_MAX_SSID + 1u];
    char password[WIFI_MAX_PASS + 1u];
    char hostname[WIFI_MAX_HOST + 1u];
    char secret[WIFI_MAX_SECRET + 1u];
} wifi_transport_config_t;

static const char *TAG = "WIFI_TRANSPORT";
static QueueHandle_t s_cmd_queue;
static httpd_handle_t s_httpd;
static int s_active_fd = -1;
static bool s_authenticated;
static char s_auth_challenge[33];
static TickType_t s_auth_deadline_ticks;
static uint32_t s_auth_generation;
static bool s_use_envelope;
static wifi_transport_config_t s_config;
static bool s_has_config;
static bool s_netif_ready;
static bool s_station_started;
static bool s_station_online;
static uint8_t s_reconnect_attempt;
static bool s_reconnect_pending;
static bool s_suppress_next_disconnect_reconnect;
static uint16_t s_last_disconnect_reason;
static char s_station_ip[16];
static uint8_t s_station_ipv4[4];

static void wifi_register_commands(void);
static void wifi_provision_command(const char *ssid, const char *password, const char *secret, const char *hostname);
static void wifi_clear_command(void);
static void wifi_pairing_reset_command(const char *secret);
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
static bool auth_message_matches(const uint8_t *data, size_t len);
static bool unwrap_envelope(const uint8_t *data, size_t len, uint8_t *out, size_t out_len, uint16_t *sequence);
static size_t build_envelope(uint8_t *out, size_t out_len, uint8_t kind, uint16_t sequence, const uint8_t *payload, size_t payload_len);
static bool auth_challenge_expired(void);
static void auth_timeout_task(void *arg);
static void generate_auth_challenge(void);
static bool extract_json_string(const char *json, const char *key, char *out, size_t out_len);
static bool extract_json_int(const char *json, const char *key, int *out);
static bool hmac_sha256_hex(const char *secret, const char *message, char *out, size_t out_len);
static bool constant_time_equal(const char *a, const char *b, size_t len);
static bool enqueue_sysex(const uint8_t *sysex, uint16_t sequence, bool enveloped);
static bool decode_payload_7bit_fixed(const uint8_t *in, uint8_t *out);
static void encode_payload_7bit_fixed(const uint8_t *in, uint8_t *out);
static esp_err_t send_superframe(const uint8_t *frame, uint16_t sequence);

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

esp_err_t wifi_transport_send_cmd_response(uint8_t status, uint16_t sequence, const uint8_t *payload, size_t payload_len)
{
    if (!s_httpd || s_active_fd < 0 || !s_authenticated) {
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
    return send_superframe(frame, sequence);
}

esp_err_t wifi_transport_send_stream_lane(const uint8_t *stream_lane, bool nonblocking)
{
    (void)nonblocking;
    if (!stream_lane) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!s_httpd || s_active_fd < 0 || !s_authenticated) {
        return ESP_ERR_INVALID_STATE;
    }

    uint8_t frame[EMW_USB_FRAME_SIZE] = {0};
    memcpy(&frame[EMW_LANE_SIZE], stream_lane, EMW_LANE_SIZE);
    return send_superframe(frame, 0);
}

esp_err_t wifi_transport_send_buffer_status(uint16_t status, bool nonblocking)
{
    (void)nonblocking;
    if (!s_httpd || s_active_fd < 0 || !s_authenticated) {
        return ESP_ERR_INVALID_STATE;
    }

    uint8_t frame[EMW_USB_FRAME_SIZE] = {0};
    frame[EMW_LANE_SIZE + 0u] = 'B';
    frame[EMW_LANE_SIZE + 1u] = 'S';
    frame[EMW_LANE_SIZE + 2u] = (uint8_t)(status >> 8u);
    frame[EMW_LANE_SIZE + 3u] = (uint8_t)(status & 0xffu);
    return send_superframe(frame, 0);
}

esp_err_t wifi_transport_provision(const char *ssid, const char *password, const char *secret, const char *hostname)
{
    if (!config_field_fits(ssid, WIFI_MAX_SSID) ||
        !config_field_fits(password, WIFI_MAX_PASS) ||
        !config_field_fits(secret, WIFI_MAX_SECRET) ||
        (hostname && hostname[0] != '\0' && !config_field_fits(hostname, WIFI_MAX_HOST))) {
        return ESP_ERR_INVALID_ARG;
    }

    wifi_transport_config_t config = {0};
    strlcpy(config.ssid, ssid ? ssid : "", sizeof(config.ssid));
    strlcpy(config.password, password ? password : "", sizeof(config.password));
    strlcpy(config.secret, secret ? secret : "", sizeof(config.secret));
    if (hostname && hostname[0] != '\0') {
        if (!is_valid_hostname(hostname)) {
            return ESP_ERR_INVALID_ARG;
        }
        strlcpy(config.hostname, hostname, sizeof(config.hostname));
    } else {
        default_hostname(config.hostname, sizeof(config.hostname));
    }

    if (config.ssid[0] == '\0' || config.secret[0] == '\0') {
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

esp_err_t wifi_transport_reset_pairing(const char *secret)
{
    if (!s_has_config || !secret || secret[0] == '\0' || !config_field_fits(secret, WIFI_MAX_SECRET)) {
        return ESP_ERR_INVALID_ARG;
    }

    wifi_transport_config_t next = s_config;
    strlcpy(next.secret, secret, sizeof(next.secret));
    esp_err_t err = save_config(&next);
    if (err != ESP_OK) {
        return err;
    }
    s_config = next;

    const int fd = s_active_fd;
    clear_active_session_state();
    if (s_httpd && fd >= 0) {
        (void)httpd_sess_trigger_close(s_httpd, fd);
    }
    return ESP_OK;
}

void wifi_transport_suspend_runtime(void)
{
#if EMWAVER_ENABLE_WIFI_TRANSPORT
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

bool wifi_transport_is_provisioned(void)
{
    return s_has_config;
}

bool wifi_transport_is_authenticated(void)
{
    return s_authenticated;
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
            {"secret", CMD_ARG_STRING, true},
            {"hostname", CMD_ARG_STRING, false},
            {NULL, CMD_ARG_DONE, false},
        });
    (void)register_command("wifi clear", (void *)wifi_clear_command, (const cmd_arg_spec_t[]){{NULL, CMD_ARG_DONE, false}});
    (void)register_command(
        "wifi pair",
        (void *)wifi_pairing_reset_command,
        (const cmd_arg_spec_t[]){
            {"secret", CMD_ARG_STRING, true},
            {NULL, CMD_ARG_DONE, false},
        });
    (void)register_command("wifi status", (void *)wifi_status_command, (const cmd_arg_spec_t[]){{NULL, CMD_ARG_DONE, false}});
}

static void wifi_provision_command(const char *ssid, const char *password, const char *secret, const char *hostname)
{
    if (wifi_transport_provision(ssid, password, secret, hostname) != ESP_OK) {
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

static void wifi_pairing_reset_command(const char *secret)
{
    if (wifi_transport_reset_pairing(secret) != ESP_OK) {
        command_send_err("wifi pair");
        return;
    }
    command_send_ok((const uint8_t *)"wifi pairing reset", strlen("wifi pairing reset"));
}

static void wifi_status_command(void)
{
    char status[160];
    const uint16_t reason = s_last_disconnect_reason;
    const char *ip = s_station_ip[0] != '\0' ? s_station_ip : "none";
    snprintf(
        status,
        sizeof(status),
        "wifi:%s:%s:%s:%s:host=%s:ip=%s:reason=%u",
        s_has_config ? "provisioned" : "unprovisioned",
        s_station_online ? "online" : "offline",
        s_authenticated ? "authenticated" : "idle",
        s_reconnect_pending ? "reconnecting" : "stable",
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
    size_t secret_len = sizeof(out->secret);
    esp_err_t err = nvs_get_str(nvs, WIFI_KEY_SSID, out->ssid, &ssid_len);
    if (err == ESP_OK) {
        (void)nvs_get_str(nvs, WIFI_KEY_PASS, out->password, &pass_len);
        (void)nvs_get_str(nvs, WIFI_KEY_HOST, out->hostname, &host_len);
        err = nvs_get_str(nvs, WIFI_KEY_SECRET, out->secret, &secret_len);
    }
    nvs_close(nvs);
    if (out->hostname[0] == '\0' || !is_valid_hostname(out->hostname)) {
        default_hostname(out->hostname, sizeof(out->hostname));
    }
    return err == ESP_OK && out->ssid[0] != '\0' && out->secret[0] != '\0';
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
    if (err == ESP_OK) err = nvs_set_str(nvs, WIFI_KEY_SECRET, config->secret);
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
        const bool is_upper = c >= 'A' && c <= 'Z';
        if (!is_digit && !is_lower && !is_upper && c != '-') {
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
    s_authenticated = false;
    s_use_envelope = false;
    s_auth_challenge[0] = '\0';
    s_auth_generation++;
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
    txt_ok = txt_ok && mdns_service_txt_item_set("_emwaver", "_tcp", "fw", WIFI_FIRMWARE_VERSION) == ESP_OK;
    txt_ok = txt_ok && mdns_service_txt_item_set("_emwaver", "_tcp", "cap", EMW_TARGET_CAPABILITIES) == ESP_OK;
    txt_ok = txt_ok && mdns_service_txt_item_set("_emwaver", "_tcp", "id", local_id) == ESP_OK;
    if (!txt_ok) {
        ESP_LOGW(TAG, "published mDNS service without complete TXT metadata");
    }
    return true;
}

static void build_mdns_instance_name(char *out, size_t out_len)
{
    char suffix[8];
    build_local_id_suffix(suffix, sizeof(suffix));
    snprintf(out, out_len, "EMWaver %s %s", EMW_TARGET_DEVICE_NAME_PREFIX, suffix);
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
        s_active_fd = current_fd;
        s_authenticated = false;
        s_use_envelope = false;
        generate_auth_challenge();
        if (xTaskCreate(auth_timeout_task, "wifi_auth_timeout", 2048, (void *)(uintptr_t)s_auth_generation, 4, NULL) != pdPASS) {
            ESP_LOGW(TAG, "failed to start Wi-Fi auth timeout task");
            close_active_session(current_fd);
            return ESP_ERR_NO_MEM;
        }
        char challenge_json[72];
        snprintf(challenge_json, sizeof(challenge_json), "{\"type\":\"challenge\",\"challenge\":\"%s\"}", s_auth_challenge);
        httpd_ws_frame_t challenge = {
            .final = true,
            .fragmented = false,
            .type = HTTPD_WS_TYPE_TEXT,
            .payload = (uint8_t *)challenge_json,
            .len = strlen(challenge_json),
        };
        esp_err_t err = httpd_ws_send_frame(req, &challenge);
        if (err != ESP_OK) {
            close_active_session(current_fd);
            return err;
        }
        return ESP_OK;
    }

    httpd_ws_frame_t frame = {0};
    frame.type = HTTPD_WS_TYPE_BINARY;
    esp_err_t err = httpd_ws_recv_frame(req, &frame, 0);
    if (err != ESP_OK || frame.len == 0 || frame.len > 256) {
        return err;
    }

    uint8_t data[256] = {0};
    frame.payload = data;
    err = httpd_ws_recv_frame(req, &frame, sizeof(data));
    if (err != ESP_OK) {
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

    if (!s_authenticated) {
        if (!auth_challenge_expired() && auth_message_matches(data, frame.len)) {
            s_active_fd = current_fd;
            s_authenticated = true;
            s_auth_challenge[0] = '\0';
            httpd_ws_frame_t reply = {
                .final = true,
                .fragmented = false,
                .type = HTTPD_WS_TYPE_TEXT,
                .payload = (uint8_t *)"auth ok",
                .len = strlen("auth ok"),
            };
            return httpd_ws_send_frame(req, &reply);
        }
        httpd_ws_frame_t reply = {
            .final = true,
            .fragmented = false,
            .type = HTTPD_WS_TYPE_TEXT,
            .payload = (uint8_t *)"auth fail",
            .len = strlen("auth fail"),
        };
        (void)httpd_ws_send_frame(req, &reply);
        close_active_session(current_fd);
        return ESP_FAIL;
    }

    uint8_t sysex[EMW_SYSEX_BYTES] = {0};
    uint16_t sequence = 0;
    bool enveloped = false;
    bool has_sysex = !s_use_envelope && frame.type == HTTPD_WS_TYPE_BINARY && frame.len == EMW_SYSEX_BYTES;
    if (has_sysex) {
        memcpy(sysex, data, sizeof(sysex));
    } else if (frame.type == HTTPD_WS_TYPE_BINARY) {
        has_sysex = unwrap_envelope(data, frame.len, sysex, sizeof(sysex), &sequence);
        enveloped = has_sysex;
    }
    if (!has_sysex || !enqueue_sysex(sysex, sequence, enveloped)) {
        return ESP_FAIL;
    }
    return ESP_OK;
}

static bool auth_message_matches(const uint8_t *data, size_t len)
{
    if (!data || len == 0 || s_config.secret[0] == '\0') {
        return false;
    }

    char json[257] = {0};
    size_t copy_len = len;
    if (copy_len >= sizeof(json)) {
        copy_len = sizeof(json) - 1u;
    }
    memcpy(json, data, copy_len);

    char type[16] = {0};
    char challenge[65] = {0};
    char response[65] = {0};
    char expected[65] = {0};
    int protocol_version = 0;
    if (!extract_json_string(json, "type", type, sizeof(type)) ||
        strcmp(type, "auth") != 0 ||
        !extract_json_int(json, "protocolVersion", &protocol_version) ||
        protocol_version != 1 ||
        !extract_json_string(json, "challenge", challenge, sizeof(challenge)) ||
        strcmp(challenge, s_auth_challenge) != 0 ||
        !extract_json_string(json, "response", response, sizeof(response)) ||
        !hmac_sha256_hex(s_config.secret, challenge, expected, sizeof(expected))) {
        return false;
    }

    const bool ok = strlen(response) == strlen(expected) && constant_time_equal(response, expected, strlen(expected));
    if (ok) {
        int envelope_version = 0;
        s_use_envelope = extract_json_int(json, "envelopeVersion", &envelope_version) &&
                         envelope_version == WIFI_ENVELOPE_VERSION;
    }
    return ok;
}

static bool unwrap_envelope(const uint8_t *data, size_t len, uint8_t *out, size_t out_len, uint16_t *sequence)
{
    if (!data || !out || out_len < EMW_SYSEX_BYTES || len < WIFI_ENVELOPE_HEADER_BYTES) {
        return false;
    }
    if (data[0] != 'E' || data[1] != 'M' || data[2] != 'W' ||
        data[3] != WIFI_ENVELOPE_VERSION ||
        data[4] != WIFI_ENVELOPE_KIND_SYSEX) {
        return false;
    }
    const uint16_t payload_len = (uint16_t)data[8] | ((uint16_t)data[9] << 8u);
    if (payload_len != EMW_SYSEX_BYTES || len != (size_t)WIFI_ENVELOPE_HEADER_BYTES + payload_len) {
        return false;
    }
    if (sequence) {
        *sequence = (uint16_t)data[5] | ((uint16_t)data[6] << 8u);
    }
    memcpy(out, &data[WIFI_ENVELOPE_HEADER_BYTES], EMW_SYSEX_BYTES);
    return true;
}

static size_t build_envelope(uint8_t *out, size_t out_len, uint8_t kind, uint16_t sequence, const uint8_t *payload, size_t payload_len)
{
    if (!out || !payload || out_len < WIFI_ENVELOPE_HEADER_BYTES + payload_len || payload_len > UINT16_MAX) {
        return 0;
    }
    out[0] = 'E';
    out[1] = 'M';
    out[2] = 'W';
    out[3] = WIFI_ENVELOPE_VERSION;
    out[4] = kind;
    out[5] = (uint8_t)(sequence & 0xffu);
    out[6] = (uint8_t)((sequence >> 8u) & 0xffu);
    out[7] = 0;
    out[8] = (uint8_t)(payload_len & 0xffu);
    out[9] = (uint8_t)((payload_len >> 8u) & 0xffu);
    memcpy(&out[WIFI_ENVELOPE_HEADER_BYTES], payload, payload_len);
    return WIFI_ENVELOPE_HEADER_BYTES + payload_len;
}

static void generate_auth_challenge(void)
{
    for (size_t i = 0; i < 16u; ++i) {
        uint8_t byte = (uint8_t)(esp_random() & 0xFFu);
        snprintf(&s_auth_challenge[i * 2u], sizeof(s_auth_challenge) - (i * 2u), "%02x", byte);
    }
    s_auth_challenge[32] = '\0';
    s_auth_deadline_ticks = xTaskGetTickCount() + pdMS_TO_TICKS(WIFI_AUTH_TIMEOUT_MS);
    s_auth_generation++;
}

static bool auth_challenge_expired(void)
{
    if (s_auth_challenge[0] == '\0') {
        return true;
    }
    return (int32_t)(xTaskGetTickCount() - s_auth_deadline_ticks) >= 0;
}

static void auth_timeout_task(void *arg)
{
    const uint32_t generation = (uint32_t)(uintptr_t)arg;
    vTaskDelay(pdMS_TO_TICKS(WIFI_AUTH_TIMEOUT_MS));
    if (generation == s_auth_generation && !s_authenticated && s_active_fd >= 0 && s_httpd) {
        const int fd = s_active_fd;
        httpd_ws_frame_t reply = {
            .final = true,
            .fragmented = false,
            .type = HTTPD_WS_TYPE_TEXT,
            .payload = (uint8_t *)"auth timeout",
            .len = strlen("auth timeout"),
        };
        (void)httpd_ws_send_data(s_httpd, fd, &reply);
        clear_active_session_state();
        (void)httpd_sess_trigger_close(s_httpd, fd);
    }
    vTaskDelete(NULL);
}

static bool extract_json_string(const char *json, const char *key, char *out, size_t out_len)
{
    if (!json || !key || !out || out_len == 0) {
        return false;
    }

    char pattern[40];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    const char *pos = strstr(json, pattern);
    if (!pos) {
        return false;
    }
    pos = strchr(pos + strlen(pattern), ':');
    if (!pos) {
        return false;
    }
    pos++;
    while (*pos == ' ' || *pos == '\t') {
        pos++;
    }
    if (*pos != '"') {
        return false;
    }
    pos++;

    size_t written = 0;
    while (*pos && *pos != '"' && written + 1u < out_len) {
        out[written++] = *pos++;
    }
    out[written] = '\0';
    return *pos == '"' && written > 0;
}

static bool extract_json_int(const char *json, const char *key, int *out)
{
    if (!json || !key || !out) {
        return false;
    }

    char pattern[40];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    const char *pos = strstr(json, pattern);
    if (!pos) {
        return false;
    }
    pos = strchr(pos + strlen(pattern), ':');
    if (!pos) {
        return false;
    }
    pos++;
    while (*pos == ' ' || *pos == '\t') {
        pos++;
    }
    if (*pos < '0' || *pos > '9') {
        return false;
    }

    int value = 0;
    while (*pos >= '0' && *pos <= '9') {
        value = (value * 10) + (*pos - '0');
        pos++;
    }
    *out = value;
    return true;
}

static bool hmac_sha256_hex(const char *secret, const char *message, char *out, size_t out_len)
{
    if (!secret || !message || !out || out_len < 65u) {
        return false;
    }

    uint8_t digest[32] = {0};
    const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    if (!info) {
        return false;
    }
    if (mbedtls_md_hmac(info,
                        (const unsigned char *)secret,
                        strlen(secret),
                        (const unsigned char *)message,
                        strlen(message),
                        digest) != 0) {
        return false;
    }

    for (size_t i = 0; i < sizeof(digest); ++i) {
        snprintf(&out[i * 2u], out_len - (i * 2u), "%02x", digest[i]);
    }
    out[64] = '\0';
    return true;
}

static bool constant_time_equal(const char *a, const char *b, size_t len)
{
    if (!a || !b) {
        return false;
    }
    uint8_t diff = 0;
    for (size_t i = 0; i < len; ++i) {
        diff |= (uint8_t)(a[i] ^ b[i]);
    }
    return diff == 0;
}

static bool enqueue_sysex(const uint8_t *sysex, uint16_t sequence, bool enveloped)
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

    if (enveloped && sequence == 0u && cmd_any) {
        return false;
    }

    const uint8_t *stream_lane = &decoded[EMW_LANE_SIZE];
    bool stream_any = false;
    for (size_t i = 0; i < EMW_LANE_SIZE; ++i) {
        if (stream_lane[i] != 0) {
            stream_any = true;
            break;
        }
    }
    if (stream_any || !cmd_any) {
        uint16_t bytes_available = 0;
        if (usb_ingest_stream_lane(stream_lane, &bytes_available)) {
            (void)wifi_transport_send_buffer_status(bytes_available, true);
        }
    }

    if (!cmd_any) {
        return true;
    }

    command_t cmd = {0};
    cmd.length = EMW_LANE_SIZE;
    cmd.source = EMW_COMMAND_SOURCE_WIFI;
    cmd.wifi_sequence = sequence;
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

static esp_err_t send_superframe(const uint8_t *frame, uint16_t sequence)
{
    uint8_t sysex[EMW_SYSEX_BYTES] = {0};
    sysex[0] = 0xF0;
    sysex[1] = 0x7D;
    sysex[2] = 'E';
    sysex[3] = 'M';
    sysex[4] = 'W';
    encode_payload_7bit_fixed(frame, &sysex[5]);
    sysex[EMW_SYSEX_BYTES - 1u] = 0xF7;

    uint8_t envelope[WIFI_ENVELOPE_HEADER_BYTES + EMW_SYSEX_BYTES] = {0};
    uint8_t *payload = sysex;
    size_t payload_len = sizeof(sysex);
    if (s_use_envelope) {
        payload_len = build_envelope(envelope,
                                     sizeof(envelope),
                                     WIFI_ENVELOPE_KIND_SYSEX,
                                     sequence,
                                     sysex,
                                     sizeof(sysex));
        if (payload_len == 0) {
            return ESP_FAIL;
        }
        payload = envelope;
    }

    httpd_ws_frame_t ws = {
        .final = true,
        .fragmented = false,
        .type = HTTPD_WS_TYPE_BINARY,
        .payload = payload,
        .len = payload_len,
    };
    return httpd_ws_send_data(s_httpd, s_active_fd, &ws);
}
