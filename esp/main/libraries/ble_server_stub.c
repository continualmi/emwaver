#include "ble_server.h"

void ble_server_init(QueueHandle_t cmd_queue)
{
    (void)cmd_queue;
}

void ble_server_advertise(void)
{
}

int ble_server_notify(const uint8_t *data, uint16_t len)
{
    (void)data;
    (void)len;
    return -1;
}

int ble_server_notify_attr(uint16_t attr_handle, const uint8_t *data, uint16_t len)
{
    (void)attr_handle;
    (void)data;
    (void)len;
    return -1;
}

int ble_server_send_superframe(const uint8_t *frame)
{
    (void)frame;
    return -1;
}

int ble_server_send_cmd_response(uint8_t status, const uint8_t *payload, uint16_t payload_len)
{
    (void)status;
    (void)payload;
    (void)payload_len;
    return -1;
}

void ble_set_transmitter_mode(uint8_t mode)
{
    (void)mode;
}

uint16_t ble_get_rx_bytes_available(void)
{
    return 0;
}

uint8_t ble_read_rx_buffer(uint8_t *out, uint16_t max_len)
{
    (void)out;
    (void)max_len;
    return 0;
}
