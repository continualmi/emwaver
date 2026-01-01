#ifndef H_OTA_WIFI_
#define H_OTA_WIFI_

#include <stdbool.h>

#include "esp_err.h"

esp_err_t ota_wifi_start_softap(void);
void ota_wifi_stop(void);
bool ota_wifi_is_running(void);

#endif /* H_OTA_WIFI_ */

