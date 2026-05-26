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
#include "emw_target.h"
#include "esp_err.h"
#include "esp_log.h"

#define SPI_MAX_TRANSFER 64
#define SPI_MAX_PROFILES 8
#ifdef SPI4_HOST
#define SPI_HOST_COUNT 4
#else
#define SPI_HOST_COUNT 3
#endif
#define SPI_DEFAULT_CLOCK_HZ 1000000

// Target default SPI pins (flagship/shield/diy default bus).
// This is the one-and-only bus we support for the "no init/open/close" workflow.
#define SPI_DEFAULT_HOST_ID 2
#define SPI_DEFAULT_MISO EMW_TARGET_SPI_DEFAULT_MISO
#define SPI_DEFAULT_MOSI EMW_TARGET_SPI_DEFAULT_MOSI
#define SPI_DEFAULT_SCK  EMW_TARGET_SPI_DEFAULT_SCK
#define SPI_DEFAULT_CS   EMW_TARGET_SPI_DEFAULT_CS

typedef struct {
    bool initialized;
    int miso;
    int mosi;
    int sck;
} spi_bus_state_t;

static const char *TAG = "SPI";

static spi_bus_state_t spi_bus_states[SPI_HOST_COUNT];

typedef struct {
    bool in_use;
    char name[CLI_VALUE_MAX];
    int cs_io;
} spi_profile_t;

static spi_profile_t spi_profiles[SPI_MAX_PROFILES];

static int spi_host_to_index(spi_host_device_t host);
static spi_host_device_t spi_host_from_id(int host_id);
static spi_profile_t *spi_find_profile(const char *name);
static spi_profile_t *spi_alloc_profile(void);

static void spi_open_command(const char *name, int cs);
static void spi_close_command(const char *name);

static void spi_transfer_command(const char *name,
                                 const command_hex_arg_t *tx_arg,
                                 int rx_len,
                                 int cs,
                                 int mode,
                                 int clock_hz,
                                 bool lsb_first);

void spi_init(void)
{
    memset(spi_bus_states, 0, sizeof(spi_bus_states));
    memset(spi_profiles, 0, sizeof(spi_profiles));
}

void spi_boot_init_defaults(void)
{
    const int host_id = SPI_DEFAULT_HOST_ID;
    spi_host_device_t host = spi_host_from_id(host_id);
    int host_index = spi_host_to_index(host);
    if (host_index < 0 || host_index >= SPI_HOST_COUNT) {
        ESP_LOGE(TAG, "spi boot init: invalid host %d", host_id);
        return;
    }

    spi_bus_state_t *bus = &spi_bus_states[host_index];
    if (bus->initialized) {
        return;
    }

    spi_bus_config_t buscfg = {
        .miso_io_num = SPI_DEFAULT_MISO,
        .mosi_io_num = SPI_DEFAULT_MOSI,
        .sclk_io_num = SPI_DEFAULT_SCK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 1024,
    };

    esp_err_t ret = spi_bus_initialize(host, &buscfg, SPI_DMA_CH_AUTO);
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "spi boot init: spi_bus_initialize failed: %s", esp_err_to_name(ret));
        return;
    }

    bus->initialized = true;
    bus->miso = SPI_DEFAULT_MISO;
    bus->mosi = SPI_DEFAULT_MOSI;
    bus->sck = SPI_DEFAULT_SCK;

    ESP_LOGI(TAG, "SPI default bus ready (host=%d miso=%d mosi=%d sck=%d)",
             host_id, SPI_DEFAULT_MISO, SPI_DEFAULT_MOSI, SPI_DEFAULT_SCK);
}

void spi_register_commands(void)
{
    bool ok = true;
    ok &= register_command(
        "spi open",
        (void *)spi_open_command,
        (const cmd_arg_spec_t[]){
            {"name", CMD_ARG_STRING, true},
            {"cs", CMD_ARG_INT, true},
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
            // Legacy arg (kept optional for older clients). Prefer cs/mode/clock/lsb.
            {"name", CMD_ARG_STRING, false},
            {"tx", CMD_ARG_HEX, false},
            {"rx", CMD_ARG_INT, false},
            {"cs", CMD_ARG_INT, false},
            {"mode", CMD_ARG_INT, false},
            {"clock", CMD_ARG_INT, false},
            {"lsb", CMD_ARG_BOOL, false},
            {NULL, CMD_ARG_DONE, false},
        });
    if (!ok) {
        ESP_LOGE(TAG, "failed to register SPI commands");
    }
}

static spi_profile_t *spi_find_profile(const char *name)
{
    if (!name || name[0] == '\0') {
        return NULL;
    }
    for (size_t i = 0; i < SPI_MAX_PROFILES; ++i) {
        if (spi_profiles[i].in_use && strncmp(spi_profiles[i].name, name, sizeof(spi_profiles[i].name)) == 0) {
            return &spi_profiles[i];
        }
    }
    return NULL;
}

static spi_profile_t *spi_alloc_profile(void)
{
    for (size_t i = 0; i < SPI_MAX_PROFILES; ++i) {
        if (!spi_profiles[i].in_use) {
            memset(&spi_profiles[i], 0, sizeof(spi_profiles[i]));
            return &spi_profiles[i];
        }
    }
    return NULL;
}

static void spi_open_command(const char *name, int cs)
{
    if (!name || name[0] == '\0') {
        command_send_err("spi open: name");
        return;
    }
    if (cs <= 0) {
        command_send_err("spi open: cs");
        return;
    }

    spi_profile_t *profile = spi_find_profile(name);
    if (!profile) {
        profile = spi_alloc_profile();
        if (!profile) {
            command_send_err("spi open: slots");
            return;
        }
        strncpy(profile->name, name, sizeof(profile->name) - 1);
        profile->name[sizeof(profile->name) - 1] = '\0';
    }

    profile->in_use = true;
    profile->cs_io = cs;
    command_send_ok(NULL, 0);
}

static void spi_close_command(const char *name)
{
    spi_profile_t *profile = spi_find_profile(name);
    if (!profile) {
        command_send_err("spi close: not open");
        return;
    }
    memset(profile, 0, sizeof(*profile));
    command_send_ok(NULL, 0);
}

void spi_shutdown(void)
{
    // Stateless SPI surface: transfers allocate/remove a temporary device handle.
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

esp_err_t spi_transfer_once(int cs_io,
                            int mode,
                            int clock_hz,
                            bool lsb_first,
                            const uint8_t *tx,
                            size_t tx_len,
                            uint8_t *rx,
                            size_t rx_len)
{
    spi_boot_init_defaults();

    if (cs_io <= 0) {
        cs_io = SPI_DEFAULT_CS;
    }

    if (mode < 0) {
        mode = 0;
    }
    mode &= 0x3;

    if (clock_hz <= 0) {
        clock_hz = SPI_DEFAULT_CLOCK_HZ;
    }

    const spi_host_device_t host = spi_host_from_id(SPI_DEFAULT_HOST_ID);

    spi_device_handle_t handle = NULL;
    spi_device_interface_config_t devcfg = {
        .clock_speed_hz = clock_hz,
        .mode = (uint8_t)mode,
        .spics_io_num = cs_io,
        .queue_size = 1,
        .flags = 0,
    };
    if (lsb_first) {
        devcfg.flags |= SPI_DEVICE_TXBIT_LSBFIRST | SPI_DEVICE_RXBIT_LSBFIRST;
    }

    esp_err_t ret = spi_bus_add_device(host, &devcfg, &handle);
    if (ret != ESP_OK) {
        return ret;
    }

    size_t total_len = tx_len > rx_len ? tx_len : rx_len;
    if (total_len == 0) {
        spi_bus_remove_device(handle);
        return ESP_ERR_INVALID_ARG;
    }

    spi_transaction_t t = {
        .flags = 0,
        .length = (uint32_t)(total_len * 8),
        .tx_buffer = total_len ? tx : NULL,
        .rxlength = rx_len ? (uint32_t)(total_len * 8) : 0,
        .rx_buffer = rx_len ? rx : NULL,
    };

    ret = spi_device_transmit(handle, &t);
    esp_err_t remove_ret = spi_bus_remove_device(handle);
    if (ret != ESP_OK) {
        return ret;
    }
    if (remove_ret != ESP_OK) {
        return remove_ret;
    }
    return ESP_OK;
}

static void spi_transfer_command(const char *name,
                                 const command_hex_arg_t *tx_arg,
                                 int rx_len,
                                 int cs,
                                 int mode,
                                 int clock_hz,
                                 bool lsb_first)
{
    ESP_LOGI(TAG, "spi xfer: name=%s tx_len=%d rx_len=%d cs=%d mode=%d clock=%d lsb=%d",
             name ? name : "NULL",
             (tx_arg && tx_arg->data) ? tx_arg->length : 0,
             rx_len,
             cs,
             mode,
             clock_hz,
             (int)lsb_first);

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

    if (cs <= 0) {
        spi_profile_t *profile = spi_find_profile(name);
        if (profile) {
            cs = profile->cs_io;
        } else {
            cs = SPI_DEFAULT_CS;
        }
    }
    if (mode < 0) {
        mode = 0;
    }
    mode &= 0x3;
    if (clock_hz <= 0) {
        clock_hz = SPI_DEFAULT_CLOCK_HZ;
    }

    ESP_LOGI(TAG, "Starting SPI transfer: %d bytes", total_len);
    esp_err_t ret = spi_transfer_once(cs,
                                     mode,
                                     clock_hz,
                                     lsb_first,
                                     tx_buffer,
                                     total_len,
                                     rx_buffer,
                                     rx_count);
    ESP_LOGI(TAG, "SPI transfer complete: ret=%d", ret);

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
