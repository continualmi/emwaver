/*
 * SPDX-FileCopyrightText: 2017-2023 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef H_BLE_CTS_PRPH_
#define H_BLE_CTS_PRPH_

#include "nimble/ble.h"
#include "modlog/modlog.h"
#include "freertos/queue.h"

#ifdef __cplusplus
extern "C" {
#endif

struct ble_hs_cfg;
struct ble_gatt_register_ctxt;

void gatt_svr_register_cb(struct ble_gatt_register_ctxt *ctxt, void *arg);
int gatt_svr_init(void);
void gatt_svr_set_queue(QueueHandle_t queue);
int gatt_svr_notify(const char* data);
void gatt_svr_set_notify_conn_handle(uint16_t conn_handle);

#ifdef __cplusplus
}
#endif

#endif
