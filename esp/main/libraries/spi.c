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

#include "spi.h"

#include <string.h>

#include "command_registry.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_log.h"

#define SPI_MAX_TRANSFER 64
#define SPI_MAX_DEVICES 4
#define SPI_HOST_COUNT 3
#define SPI_DEFAULT_CLOCK_HZ 1000000

typedef struct {
    bool initialized;
    int miso;
    int mosi;
    int sck;
} spi_bus_state_t;

typedef struct {
    bool in_use;
    char name[CLI_VALUE_MAX];
    spi_device_handle_t handle;
    spi_host_device_t host;
    int cs_io;
    bool cs_active_high;
} spi_device_entry_t;

static const char *TAG = "SPI";

static spi_bus_state_t spi_bus_states[SPI_HOST_COUNT];
static spi_device_entry_t spi_devices[SPI_MAX_DEVICES];

static spi_device_entry_t *spi_find_device(const char *name);
static spi_device_entry_t *spi_allocate_device_slot(void);
static void spi_release_device(spi_device_entry_t *device);
static int spi_host_to_index(spi_host_device_t host);
static spi_host_device_t spi_host_from_id(int host_id);

static void spi_open_command(const char *name,
                             int host_id,
                             int miso,
                             int mosi,
                             int sck,
                             int cs,
                             int mode,
                             int clock_hz,
                             int cs_active_high);
static void spi_close_command(const char *name);
static void spi_transfer_command(const char *name,
                                 const command_hex_arg_t *tx_arg,
                                 int rx_len);

void spi_init(void)
{
    memset(spi_bus_states, 0, sizeof(spi_bus_states));
    memset(spi_devices, 0, sizeof(spi_devices));
}

void spi_register_commands(void)
{
    bool ok = true;
    ok &= register_command(
        "spi open",
        (void *)spi_open_command,
        (const cmd_arg_spec_t[]){
            {"name", CMD_ARG_STRING, true},
            {"host", CMD_ARG_INT, false},
            {"miso", CMD_ARG_INT, true},
            {"mosi", CMD_ARG_INT, true},
            {"sck", CMD_ARG_INT, true},
            {"cs", CMD_ARG_INT, true},
            {"mode", CMD_ARG_INT, false},
            {"clock", CMD_ARG_INT, false},
            {"cs_active_high", CMD_ARG_INT, false},
            {NULL, CMD_ARG_DONE, false},
        });
    ok &= register_command(
        "spi close",
        (void *)spi_close_command,
        (const cmd_arg_spec_t[]){
            {"name", CMD_ARG_STRING, true},
            {NULL, CMD_ARG_DONE, false},
        });
    ok &= register_command(
        "spi xfer",
        (void *)spi_transfer_command,
        (const cmd_arg_spec_t[]){
            {"name", CMD_ARG_STRING, true},
            {"tx", CMD_ARG_HEX, false},
            {"rx", CMD_ARG_INT, false},
            {NULL, CMD_ARG_DONE, false},
        });
    if (!ok) {
        ESP_LOGE(TAG, "failed to register SPI commands");
    }
}

void spi_shutdown(void)
{
    for (size_t i = 0; i < SPI_MAX_DEVICES; ++i) {
        if (spi_devices[i].in_use) {
            spi_release_device(&spi_devices[i]);
        }
    }
}

static spi_device_entry_t *spi_find_device(const char *name)
{
    if (!name) {
        return NULL;
    }
    for (size_t i = 0; i < SPI_MAX_DEVICES; ++i) {
        if (spi_devices[i].in_use && strncmp(spi_devices[i].name, name, CLI_VALUE_MAX) == 0) {
            return &spi_devices[i];
        }
    }
    return NULL;
}

static spi_device_entry_t *spi_allocate_device_slot(void)
{
    for (size_t i = 0; i < SPI_MAX_DEVICES; ++i) {
        if (!spi_devices[i].in_use) {
            memset(&spi_devices[i], 0, sizeof(spi_devices[i]));
            return &spi_devices[i];
        }
    }
    return NULL;
}

static void spi_release_device(spi_device_entry_t *device)
{
    if (!device || !device->in_use) {
        return;
    }

    if (device->handle) {
        esp_err_t ret = spi_bus_remove_device(device->handle);
        if (ret != ESP_OK) {
            ESP_LOGW(TAG, "spi_bus_remove_device failed: %s", esp_err_to_name(ret));
        }
    }

    memset(device, 0, sizeof(*device));
}

static int spi_host_to_index(spi_host_device_t host)
{
    switch (host) {
        case SPI1_HOST:
            return 0;
        case SPI2_HOST:
            return 1;
        case SPI3_HOST:
            return 2;
#ifdef SPI4_HOST
        case SPI4_HOST:
            return 3;
#endif
        default:
            return -1;
    }
}

static spi_host_device_t spi_host_from_id(int host_id)
{
    switch (host_id) {
        case 1:
            return SPI1_HOST;
        case 2:
        default:
            return SPI2_HOST;
        case 3:
            return SPI3_HOST;
#ifdef SPI4_HOST
        case 4:
            return SPI4_HOST;
#endif
    }
}

static void spi_open_command(const char *name,
                             int host_id,
                             int miso,
                             int mosi,
                             int sck,
                             int cs,
                             int mode,
                             int clock_hz,
                             int cs_active_high)
{
    ESP_LOGI(TAG, "spi open: name=%s host=%d miso=%d mosi=%d sck=%d cs=%d mode=%d clock=%d cs_active_high=%d",
             name ? name : "NULL", host_id, miso, mosi, sck, cs, mode, clock_hz, cs_active_high);

    if (!name || name[0] == '\0') {
        ESP_LOGE(TAG, "spi open: name missing or empty");
        command_send_err("spi open: name");
        return;
    }

    if (spi_find_device(name)) {
        ESP_LOGE(TAG, "spi open: device '%s' already exists", name);
        command_send_err("spi open: exists");
        return;
    }

    spi_device_entry_t *slot = spi_allocate_device_slot();
    if (!slot) {
        command_send_err("spi open: slots");
        return;
    }

    if (host_id <= 0) {
        host_id = 2;
    }
    spi_host_device_t host = spi_host_from_id(host_id);
    int host_index = spi_host_to_index(host);
    if (host_index < 0 || host_index >= SPI_HOST_COUNT) {
        command_send_err("spi open: host");
        return;
    }

    if (mode < 0) {
        mode = 0;
    }
    mode &= 0x3;

    if (clock_hz <= 0) {
        clock_hz = SPI_DEFAULT_CLOCK_HZ;
    }

    spi_bus_state_t *bus = &spi_bus_states[host_index];
    if (!bus->initialized) {
        spi_bus_config_t buscfg = {
            .miso_io_num = miso,
            .mosi_io_num = mosi,
            .sclk_io_num = sck,
            .quadwp_io_num = -1,
            .quadhd_io_num = -1,
            .max_transfer_sz = 1024,
        };

        esp_err_t ret = spi_bus_initialize(host, &buscfg, SPI_DMA_CH_AUTO);
        if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
            ESP_LOGE(TAG, "spi_bus_initialize failed: %s", esp_err_to_name(ret));
            command_send_err("spi open: bus");
            return;
        }

        bus->initialized = true;
        bus->miso = miso;
        bus->mosi = mosi;
        bus->sck = sck;
    } else {
        if (bus->miso != miso || bus->mosi != mosi || bus->sck != sck) {
            ESP_LOGW(TAG, "spi open: pin mismatch (existing bus pins %d/%d/%d)", bus->miso, bus->mosi, bus->sck);
        }
    }

    spi_device_interface_config_t devcfg = {
        .clock_speed_hz = clock_hz,
        .mode = (uint8_t)mode,
        .spics_io_num = cs_active_high ? -1 : cs,
        .queue_size = 7,
    };

    esp_err_t ret = spi_bus_add_device(host, &devcfg, &slot->handle);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "spi_bus_add_device failed: %s", esp_err_to_name(ret));
        memset(slot, 0, sizeof(*slot));
        command_send_err("spi open: add");
        return;
    }

    if (cs_active_high) {
        ESP_LOGI(TAG, "Configuring CS pin %d for active-high (manual control)", cs);
        gpio_reset_pin(cs);
        gpio_set_direction(cs, GPIO_MODE_OUTPUT);
        gpio_set_level(cs, 0);
        ESP_LOGI(TAG, "CS pin %d set LOW (deselected)", cs);
    }

    slot->in_use = true;
    slot->host = host;
    slot->cs_io = cs;
    slot->cs_active_high = (cs_active_high != 0);
    strncpy(slot->name, name, sizeof(slot->name) - 1);
    slot->name[sizeof(slot->name) - 1] = '\0';

    ESP_LOGI(TAG, "SPI device '%s' opened successfully (host=%d, mode=%d, clock=%d, cs=%d, cs_active_high=%d)", 
             name, host_id, mode, clock_hz, cs, cs_active_high);
    command_send_ok(NULL, 0);
}

static void spi_close_command(const char *name)
{
    ESP_LOGI(TAG, "spi close: name=%s", name ? name : "NULL");

    spi_device_entry_t *device = spi_find_device(name);
    if (!device) {
        ESP_LOGE(TAG, "spi close: device '%s' not found", name ? name : "NULL");
        command_send_err("spi close: not open");
        return;
    }

    spi_release_device(device);
    ESP_LOGI(TAG, "spi close: device '%s' closed successfully", name);
    command_send_ok(NULL, 0);
}

static void spi_transfer_command(const char *name,
                                 const command_hex_arg_t *tx_arg,
                                 int rx_len)
{
    ESP_LOGI(TAG, "spi xfer: name=%s tx_len=%d rx_len=%d", 
             name ? name : "NULL", 
             (tx_arg && tx_arg->data) ? tx_arg->length : 0, 
             rx_len);

    spi_device_entry_t *device = spi_find_device(name);
    if (!device) {
        ESP_LOGE(TAG, "spi xfer: device '%s' not open", name ? name : "NULL");
        command_send_err("spi xfer: not open");
        return;
    }

    uint8_t tx_buffer[SPI_MAX_TRANSFER] = {0};
    uint8_t rx_buffer[SPI_MAX_TRANSFER] = {0};
    size_t tx_len = 0;

    if (tx_arg && tx_arg->data && tx_arg->length > 0) {
        if (tx_arg->length > SPI_MAX_TRANSFER) {
            command_send_err("spi xfer: tx size");
            return;
        }
        memcpy(tx_buffer, tx_arg->data, tx_arg->length);
        tx_len = tx_arg->length;
    }

    if (rx_len < 0) {
        command_send_err("spi xfer: rx len");
        return;
    }

    size_t rx_count = (size_t)rx_len;
    if (rx_count == 0) {
        rx_count = tx_len;
    }

    size_t total_len = tx_len > rx_count ? tx_len : rx_count;
    if (total_len == 0) {
        command_send_err("spi xfer: empty");
        return;
    }

    if (total_len > SPI_MAX_TRANSFER) {
        command_send_err("spi xfer: size");
        return;
    }

    if (device->cs_active_high) {
        ESP_LOGI(TAG, "CS pin %d -> HIGH (select)", device->cs_io);
        gpio_set_level(device->cs_io, 1);
    }

    spi_transaction_t t = {
        .flags = 0,
        .length = total_len * 8,
        .tx_buffer = total_len ? tx_buffer : NULL,
        .rxlength = rx_count ? (total_len * 8) : 0,
        .rx_buffer = rx_count ? rx_buffer : NULL,
    };

    ESP_LOGI(TAG, "Starting SPI transfer: %d bytes", total_len);
    esp_err_t ret = spi_device_transmit(device->handle, &t);
    ESP_LOGI(TAG, "SPI transfer complete: ret=%d", ret);
    
    if (device->cs_active_high) {
        ESP_LOGI(TAG, "CS pin %d -> LOW (deselect)", device->cs_io);
        gpio_set_level(device->cs_io, 0);
    }

    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "spi_device_transmit failed: %s", esp_err_to_name(ret));
        command_send_err("spi xfer: fail");
        return;
    }

    if (rx_count > 0) {
        command_send_ok(rx_buffer, rx_count);
    } else {
        command_send_ok(NULL, 0);
    }
}
