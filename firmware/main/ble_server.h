/*
 * BLE Server functionality for EMWaver
 */

#ifndef H_BLE_SERVER_
#define H_BLE_SERVER_

#include "nimble/ble.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

#ifdef __cplusplus
extern "C" {
#endif

// Initialize BLE server
void ble_server_init(QueueHandle_t cmd_queue);

// Start BLE advertising
void ble_server_advertise(void);

// Send notification to connected BLE client
int ble_server_notify(const uint8_t* data, uint16_t len);

// BLE transmission mode functions
void ble_set_transmitter_mode(uint8_t mode);
uint16_t ble_get_rx_bytes_available(void);
uint8_t ble_read_rx_buffer(uint8_t* buf, uint16_t len);

#ifdef __cplusplus
}
#endif

#endif /* H_BLE_SERVER_ */ 