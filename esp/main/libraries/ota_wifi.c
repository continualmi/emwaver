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

#include "ota_wifi.h"

#include <limits.h>
#include <stdio.h>
#include <string.h>

#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_wifi.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "ota_core.h"
#include "ota_status.h"

static const char *TAG = "OTA_WIFI";

static const char *OTA_AP_SSID = "EMWaver-OTA";
static const char *OTA_AP_PASS = ""; /* open AP for now */

static bool g_netif_inited;
static esp_netif_t *g_ap_netif;
static httpd_handle_t g_httpd;
static bool g_running;

enum {
    OTA_STATUS_WIFI_READY = 0x20,
};

static void ota_wifi_restart_task(void *arg)
{
    (void)arg;
    vTaskDelay(pdMS_TO_TICKS(2000));
    esp_restart();
}

static bool hex_nibble(char c, uint8_t *out)
{
    if (c >= '0' && c <= '9') {
        *out = (uint8_t)(c - '0');
        return true;
    }
    if (c >= 'a' && c <= 'f') {
        *out = (uint8_t)(10 + (c - 'a'));
        return true;
    }
    if (c >= 'A' && c <= 'F') {
        *out = (uint8_t)(10 + (c - 'A'));
        return true;
    }
    return false;
}

static bool parse_sha256_hex(const char *hex, size_t hex_len, uint8_t out[32])
{
    if (hex_len != 64) {
        return false;
    }

    for (size_t i = 0; i < 32; ++i) {
        uint8_t hi, lo;
        if (!hex_nibble(hex[i * 2], &hi) || !hex_nibble(hex[i * 2 + 1], &lo)) {
            return false;
        }
        out[i] = (uint8_t)((hi << 4) | lo);
    }

    return true;
}

static esp_err_t send_simple_response(httpd_req_t *req, int status, const char *body)
{
    char status_line[32];
    snprintf(status_line, sizeof(status_line), "%d", status);
    httpd_resp_set_status(req, status_line);
    httpd_resp_set_type(req, "text/plain");
    return httpd_resp_send(req, body, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t ota_post_handler(httpd_req_t *req)
{
    if (req->content_len <= 0) {
        return send_simple_response(req, 400, "missing content\n");
    }

    if (req->content_len > UINT32_MAX) {
        return send_simple_response(req, 413, "firmware too large\n");
    }

    if (ota_core_is_active()) {
        return send_simple_response(req, 409, "ota already in progress\n");
    }

    char sha_hex[80];
    int hdr_len = httpd_req_get_hdr_value_str(req, "X-Emwaver-Sha256", sha_hex, sizeof(sha_hex));
    if (hdr_len <= 0) {
        return send_simple_response(req, 400, "missing X-Emwaver-Sha256 header\n");
    }

    uint8_t expected_sha[32];
    if (!parse_sha256_hex(sha_hex, (size_t)hdr_len, expected_sha)) {
        return send_simple_response(req, 400, "invalid X-Emwaver-Sha256 header\n");
    }

    uint32_t total = (uint32_t)req->content_len;
    esp_err_t err = ota_core_start(total, expected_sha);
    if (err != ESP_OK) {
        ota_status_notify(0x14, 0x20, 0, total);
        return send_simple_response(req, 500, "ota start failed\n");
    }

    ota_status_notify(0x10, 0x00, 0, total);

    uint8_t buf[2048];
    uint32_t last_notified = 0;
    uint32_t remaining = total;

    while (remaining > 0) {
        int to_read = (int)((remaining > sizeof(buf)) ? sizeof(buf) : remaining);
        int read = httpd_req_recv(req, (char *)buf, to_read);
        if (read <= 0) {
            ota_status_notify(0x14, 0x21, ota_core_received_size(), total);
            ota_core_abort();
            return send_simple_response(req, 500, "read failed\n");
        }

        err = ota_core_write(buf, (size_t)read);
        if (err != ESP_OK) {
            ota_status_notify(0x14, 0x22, ota_core_received_size(), total);
            ota_core_abort();
            return send_simple_response(req, 500, "write failed\n");
        }

        remaining -= (uint32_t)read;

        uint32_t received = ota_core_received_size();
        if (received - last_notified >= 4096 || received == total) {
            last_notified = received;
            ota_status_notify(0x11, 0x00, received, total);
        }
    }

    ota_status_notify(0x12, 0x00, total, total);
    err = ota_core_finish();
    if (err != ESP_OK) {
        ota_status_notify(0x14, 0x23, total, total);
        return send_simple_response(req, 500, "finish failed\n");
    }

    ota_status_notify(0x13, 0x00, total, total);
    (void)send_simple_response(req, 200, "ok\n");

    (void)xTaskCreate(ota_wifi_restart_task, "ota_wifi_restart", 2048, NULL, 5, NULL);
    return ESP_OK;
}

static esp_err_t ota_http_server_start(void)
{
    if (g_httpd != NULL) {
        return ESP_OK;
    }

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.stack_size = 4096;

    esp_err_t err = httpd_start(&g_httpd, &config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "httpd_start failed: %s", esp_err_to_name(err));
        g_httpd = NULL;
        return err;
    }

    httpd_uri_t ota_uri = {
        .uri = "/ota",
        .method = HTTP_POST,
        .handler = ota_post_handler,
        .user_ctx = NULL,
    };
    httpd_register_uri_handler(g_httpd, &ota_uri);

    return ESP_OK;
}

esp_err_t ota_wifi_start_softap(void)
{
    if (g_running) {
        return ESP_OK;
    }

    if (!g_netif_inited) {
        ESP_ERROR_CHECK(esp_netif_init());
        ESP_ERROR_CHECK(esp_event_loop_create_default());
        g_netif_inited = true;
    }

    if (g_ap_netif == NULL) {
        g_ap_netif = esp_netif_create_default_wifi_ap();
    }

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));

    wifi_config_t wifi_config = {0};
    strncpy((char *)wifi_config.ap.ssid, OTA_AP_SSID, sizeof(wifi_config.ap.ssid));
    wifi_config.ap.ssid_len = (uint8_t)strlen(OTA_AP_SSID);
    wifi_config.ap.channel = 1;
    wifi_config.ap.max_connection = 1;

    if (OTA_AP_PASS[0] == '\0') {
        wifi_config.ap.authmode = WIFI_AUTH_OPEN;
    } else {
        strncpy((char *)wifi_config.ap.password, OTA_AP_PASS, sizeof(wifi_config.ap.password));
        wifi_config.ap.authmode = WIFI_AUTH_WPA2_PSK;
    }

    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    esp_err_t err = ota_http_server_start();
    if (err != ESP_OK) {
        ota_wifi_stop();
        return err;
    }

    g_running = true;

    ESP_LOGI(TAG, "SoftAP started: ssid=%s ip=192.168.4.1 url=http://192.168.4.1/ota", OTA_AP_SSID);
    ota_status_notify(OTA_STATUS_WIFI_READY, 0x00, 0, 0);
    return ESP_OK;
}

void ota_wifi_stop(void)
{
    if (g_httpd != NULL) {
        httpd_stop(g_httpd);
        g_httpd = NULL;
    }

    if (g_running) {
        esp_wifi_stop();
        esp_wifi_deinit();
    }

    if (g_ap_netif != NULL) {
        esp_netif_destroy(g_ap_netif);
        g_ap_netif = NULL;
    }

    g_running = false;
}

bool ota_wifi_is_running(void)
{
    return g_running;
}
