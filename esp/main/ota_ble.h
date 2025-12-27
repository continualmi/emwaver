#ifndef H_OTA_BLE_
#define H_OTA_BLE_

#include <stdint.h>

void ota_ble_init(void);
void ota_ble_set_status_attr_handle(uint16_t attr_handle);
void ota_ble_on_disconnect(void);

int ota_ble_handle_control_write(const uint8_t *data, uint16_t len);
int ota_ble_handle_data_write(const uint8_t *data, uint16_t len);

#endif /* H_OTA_BLE_ */
