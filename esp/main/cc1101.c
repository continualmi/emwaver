#include "cc1101.h"

#include "command_registry.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "CC1101";

#define CC1101_HOST  SPI2_HOST
#define CC1101_CLOCK 8000000

// Configurable pins (defaults match wavelet_gpio.js + older ISM wiring)
static int cc1101_miso = 13;
static int cc1101_mosi = 11;
static int cc1101_sck = 12;
static int cc1101_cs = 10;
static bool cc1101_cs_active_high = false;

static spi_device_handle_t cc1101_handle = NULL;
static bool cc1101_initialized = false;

// CC1101 command strobes
#define CC1101_SRES 0x30

static void cc1101_cmd_init(int miso, int mosi, int sck, int cs, int cs_active_high);
static void cc1101_cmd_write_reg(int reg, int val);
static void cc1101_cmd_read_reg(int reg);
static void cc1101_cmd_strobe(int cmd);

static esp_err_t cc1101_init_device(void);
static void cc1101_select(void);
static void cc1101_deselect(void);
static uint8_t cc1101_read_reg(uint8_t addr);
static void cc1101_write_reg(uint8_t addr, uint8_t value);
static void cc1101_strobe(uint8_t cmd);

void cc1101_register_commands(void)
{
    bool ok = true;
    ok &= register_command("cc1101 init", (void *)cc1101_cmd_init,
                           (const cmd_arg_spec_t[]){
                               {"miso", CMD_ARG_INT, false},
                               {"mosi", CMD_ARG_INT, false},
                               {"sck", CMD_ARG_INT, false},
                               {"cs", CMD_ARG_INT, false},
                               {"cs_active_high", CMD_ARG_INT, false},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("cc1101 write", (void *)cc1101_cmd_write_reg,
                           (const cmd_arg_spec_t[]){
                               {"reg", CMD_ARG_INT, true},
                               {"val", CMD_ARG_INT, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("cc1101 read", (void *)cc1101_cmd_read_reg,
                           (const cmd_arg_spec_t[]){
                               {"reg", CMD_ARG_INT, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("cc1101 strobe", (void *)cc1101_cmd_strobe,
                           (const cmd_arg_spec_t[]){
                               {"cmd", CMD_ARG_INT, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    if (!ok) {
        ESP_LOGE(TAG, "Failed to register CC1101 commands");
    }
}

static void cc1101_select(void)
{
    gpio_set_level(cc1101_cs, cc1101_cs_active_high ? 1 : 0);
}

static void cc1101_deselect(void)
{
    gpio_set_level(cc1101_cs, cc1101_cs_active_high ? 0 : 1);
}

static esp_err_t cc1101_init_device(void)
{
    if (cc1101_initialized) {
        return ESP_OK;
    }

    spi_bus_config_t buscfg = {
        .miso_io_num = cc1101_miso,
        .mosi_io_num = cc1101_mosi,
        .sclk_io_num = cc1101_sck,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 1024,
    };

    esp_err_t ret = spi_bus_initialize(CC1101_HOST, &buscfg, SPI_DMA_CH_AUTO);
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "Failed to initialize SPI bus: %s", esp_err_to_name(ret));
        return ret;
    }

    spi_device_interface_config_t devcfg = {
        .clock_speed_hz = CC1101_CLOCK,
        .mode = 0,
        // Manage CS manually so we can support active-high devices.
        .spics_io_num = -1,
        .queue_size = 7,
    };

    ret = spi_bus_add_device(CC1101_HOST, &devcfg, &cc1101_handle);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to add CC1101 device: %s", esp_err_to_name(ret));
        return ret;
    }

    gpio_reset_pin(cc1101_cs);
    gpio_set_direction(cc1101_cs, GPIO_MODE_OUTPUT);
    cc1101_deselect();

    // Basic reset strobe. The TI recommended sequence also includes waiting for SO,
    // but we keep this minimal and deterministic (same philosophy as rfm69.c).
    cc1101_strobe(CC1101_SRES);
    vTaskDelay(pdMS_TO_TICKS(2));

    cc1101_initialized = true;
    ESP_LOGI(TAG, "CC1101 initialized on host %d (CS=%d, ActiveHigh=%d)",
             CC1101_HOST, cc1101_cs, cc1101_cs_active_high);
    return ESP_OK;
}

static void cc1101_strobe(uint8_t cmd)
{
    if (!cc1101_handle) {
        return;
    }

    cc1101_select();
    uint8_t tx[1] = { cmd };
    spi_transaction_t t = {
        .flags = 0,
        .length = 8,
        .tx_buffer = tx,
        .rx_buffer = NULL,
    };
    spi_device_transmit(cc1101_handle, &t);
    cc1101_deselect();
}

static uint8_t cc1101_read_reg(uint8_t addr)
{
    if (!cc1101_handle) {
        return 0;
    }

    // CC1101 single register read: set R/W bit (0x80), send dummy.
    cc1101_select();
    uint8_t tx[2] = { (uint8_t)(addr | 0x80), 0x00 };
    uint8_t rx[2] = { 0 };
    spi_transaction_t t = {
        .flags = 0,
        .length = 16,
        .tx_buffer = tx,
        .rx_buffer = rx,
    };
    spi_device_transmit(cc1101_handle, &t);
    cc1101_deselect();

    return rx[1];
}

static void cc1101_write_reg(uint8_t addr, uint8_t value)
{
    if (!cc1101_handle) {
        return;
    }

    // CC1101 single register write: address byte with R/W=0, then value.
    cc1101_select();
    uint8_t tx[2] = { addr, value };
    spi_transaction_t t = {
        .flags = 0,
        .length = 16,
        .tx_buffer = tx,
        .rx_buffer = NULL,
    };
    spi_device_transmit(cc1101_handle, &t);
    cc1101_deselect();
}

static void cc1101_cmd_init(int miso, int mosi, int sck, int cs, int cs_active_high)
{
    ESP_LOGI(TAG, "cc1101_cmd_init: miso=%d mosi=%d sck=%d cs=%d active_high=%d",
             miso, mosi, sck, cs, cs_active_high);

    if (miso > 0) {
        cc1101_miso = miso;
    }
    if (mosi > 0) {
        cc1101_mosi = mosi;
    }
    if (sck > 0) {
        cc1101_sck = sck;
    }
    if (cs > 0) {
        cc1101_cs = cs;
    }
    if (cs_active_high >= 0) {
        cc1101_cs_active_high = (cs_active_high != 0);
    }

    esp_err_t ret = cc1101_init_device();
    if (ret == ESP_OK) {
        command_send_ok(NULL, 0);
    } else {
        command_send_err("cc1101 init failed");
    }
}

static void cc1101_cmd_write_reg(int reg, int val)
{
    if (!cc1101_initialized) {
        command_send_err("cc1101 not initialized");
        return;
    }
    if (reg < 0 || reg > 0x3F) {
        command_send_err("cc1101 reg range");
        return;
    }

    cc1101_write_reg((uint8_t)reg, (uint8_t)val);
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_read_reg(int reg)
{
    if (!cc1101_initialized) {
        command_send_err("cc1101 not initialized");
        return;
    }
    if (reg < 0 || reg > 0x3F) {
        command_send_err("cc1101 reg range");
        return;
    }

    uint8_t value = cc1101_read_reg((uint8_t)reg);
    command_send_ok(&value, 1);
}

static void cc1101_cmd_strobe(int cmd)
{
    if (!cc1101_initialized) {
        command_send_err("cc1101 not initialized");
        return;
    }
    if (cmd < 0 || cmd > 0x3D) {
        command_send_err("cc1101 strobe range");
        return;
    }
    cc1101_strobe((uint8_t)cmd);
    command_send_ok(NULL, 0);
}
