#ifndef H_OTA_BLE_GATT_
#define H_OTA_BLE_GATT_

#include "host/ble_gatt.h"

const struct ble_gatt_svc_def *ota_ble_gatt_services(void);
void ota_ble_gatt_init(void);
void ota_ble_gatt_on_disconnect(void);

#endif /* H_OTA_BLE_GATT_ */

