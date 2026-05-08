/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef WIFI_TRANSPORT_H
#define WIFI_TRANSPORT_H

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

#ifdef __cplusplus
extern "C" {
#endif

void wifi_transport_init(QueueHandle_t cmd_queue);
esp_err_t wifi_transport_send_cmd_response(uint8_t status, uint16_t sequence, const uint8_t *payload, size_t payload_len);
esp_err_t wifi_transport_send_stream_lane(const uint8_t *stream_lane, bool nonblocking);
esp_err_t wifi_transport_send_buffer_status(uint16_t status, bool nonblocking);
esp_err_t wifi_transport_provision(const char *ssid, const char *password, const char *secret, const char *hostname);
esp_err_t wifi_transport_clear_config(void);
esp_err_t wifi_transport_reset_pairing(const char *secret);
bool wifi_transport_is_provisioned(void);
bool wifi_transport_is_authenticated(void);
bool wifi_transport_is_station_online(void);
bool wifi_transport_is_reconnecting(void);
uint16_t wifi_transport_last_disconnect_reason(void);

#ifdef __cplusplus
}
#endif

#endif /* WIFI_TRANSPORT_H */
