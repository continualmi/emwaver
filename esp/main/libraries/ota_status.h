#ifndef H_OTA_STATUS_
#define H_OTA_STATUS_

#include <stdint.h>

void ota_status_init(void);
void ota_status_set_attr_handle(uint16_t attr_handle);
void ota_status_notify(uint8_t status_code, uint8_t err_code, uint32_t received, uint32_t total);

#endif /* H_OTA_STATUS_ */

