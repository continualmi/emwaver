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

#include "rfm69.h"

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>

#include "command_registry.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_log.h"

static const char *TAG = "RFM69";

// Default Pins & Config
#define RFM69_HOST    SPI2_HOST
#define RFM69_CLOCK   8000000
#define RFM69_FXOSC_HZ 32000000.0

// Configurable pins (defaults)
static int rfm69_miso = 13;
static int rfm69_mosi = 11;
static int rfm69_sck  = 12;
static int rfm69_cs   = 36;

static spi_device_handle_t rfm69_handle = NULL;
static bool rfm69_initialized = false;

// Frequency step (FXOSC / 2^19)
#define FSTEP 61.03515625

// Forward declarations
static void rfm69_cmd_init(int miso, int mosi, int sck, int cs);
static void rfm69_cmd_apply_defaults(void);
static void rfm69_cmd_write_reg(int reg, int val);
static void rfm69_cmd_read_reg(int reg);
static void rfm69_cmd_set_mode(const char *mode_str);
static void rfm69_cmd_set_freq(const char *freq_str);
static void rfm69_cmd_get_freq(void);
static void rfm69_cmd_set_bitrate(int bps);
static void rfm69_cmd_get_bitrate(void);
static void rfm69_cmd_set_dev(int hz);
static void rfm69_cmd_get_dev(void);
static void rfm69_cmd_set_power(int dbm, int pa_mode, bool ocp);
static void rfm69_cmd_get_power(void);
static void rfm69_cmd_set_bw(int bw);
static void rfm69_cmd_get_bw(void);
static void rfm69_cmd_set_bw_khz(const char *khz_str);
static void rfm69_cmd_get_bw_khz(void);
static void rfm69_cmd_set_mod(const char *mod_str);
static void rfm69_cmd_get_mod(void);
static void rfm69_cmd_thresh_fixed(bool fixed);
static void rfm69_cmd_set_lna_gain(int gain);
static void rfm69_cmd_set_rssi_threshold(int thresh);
static void rfm69_cmd_set_fixed_threshold(int thresh);
static void rfm69_cmd_set_sensitivity_boost(bool enabled);
static void rfm69_cmd_read_rssi(bool force_trigger);
static esp_err_t rfm69_init_device(void);

// Helper functions
static void rfm69_write_reg(uint8_t addr, uint8_t value);
static uint8_t rfm69_read_reg(uint8_t addr);
static void rfm69_set_mode(uint8_t mode);
static void rfm69_set_frequency_hz(uint32_t freq_hz);
static double rfm69_get_frequency_mhz(void);
static void rfm69_set_bitrate(int bps);
static int rfm69_get_bitrate(void);
static void rfm69_set_deviation_hz(int deviation_hz);
static int rfm69_get_deviation_hz(void);
static void rfm69_set_bandwidth_raw(uint8_t bw);
static uint8_t rfm69_get_bandwidth_raw(void);
static double rfm69_get_bandwidth_khz(void);
static void rfm69_set_bandwidth_khz(double bw_khz);
static void rfm69_set_modulation(uint8_t mod);
static void rfm69_set_threshold_type_fixed(bool fixed);
static void rfm69_set_lna_gain(uint8_t gain);
static void rfm69_set_rssi_threshold(uint8_t thresh);
static void rfm69_set_fixed_threshold(uint8_t thresh);
static void rfm69_set_sensitivity_boost(bool enabled);
static void rfm69_set_transmit_power(int dbm, int pa_mode, bool ocp);
static int rfm69_get_power_dbm(void);
static int rfm69_read_rssi_dbm(bool force_trigger);

void rfm69_register_commands(void)
{
    bool ok = true;
    ok &= register_command("rfm69 init", (void *)rfm69_cmd_init,
                           (const cmd_arg_spec_t[]){
                               {"miso", CMD_ARG_INT, false},
                               {"mosi", CMD_ARG_INT, false},
                               {"sck", CMD_ARG_INT, false},
                               {"cs", CMD_ARG_INT, false},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 apply_defaults", (void *)rfm69_cmd_apply_defaults,
                           (const cmd_arg_spec_t[]){
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 write", (void *)rfm69_cmd_write_reg,
                           (const cmd_arg_spec_t[]){
                               {"reg", CMD_ARG_INT, true},
                               {"val", CMD_ARG_INT, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 read", (void *)rfm69_cmd_read_reg,
                           (const cmd_arg_spec_t[]){
                               {"reg", CMD_ARG_INT, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 set_mode", (void *)rfm69_cmd_set_mode,
                           (const cmd_arg_spec_t[]){
                               {"mode", CMD_ARG_STRING, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 set_freq", (void *)rfm69_cmd_set_freq,
                           (const cmd_arg_spec_t[]){
                               {"mhz", CMD_ARG_STRING, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 get_freq", (void *)rfm69_cmd_get_freq,
                           (const cmd_arg_spec_t[]){
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 set_bitrate", (void *)rfm69_cmd_set_bitrate,
                           (const cmd_arg_spec_t[]){
                               {"bps", CMD_ARG_INT, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 get_bitrate", (void *)rfm69_cmd_get_bitrate,
                           (const cmd_arg_spec_t[]){
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 set_dev", (void *)rfm69_cmd_set_dev,
                           (const cmd_arg_spec_t[]){
                               {"hz", CMD_ARG_INT, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 get_dev", (void *)rfm69_cmd_get_dev,
                           (const cmd_arg_spec_t[]){
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 set_power", (void *)rfm69_cmd_set_power,
                           (const cmd_arg_spec_t[]){
                               {"dbm", CMD_ARG_INT, true},
                               {"pa_mode", CMD_ARG_INT, false},
                               {"ocp", CMD_ARG_BOOL, false},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 get_power", (void *)rfm69_cmd_get_power,
                           (const cmd_arg_spec_t[]){
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 set_bw", (void *)rfm69_cmd_set_bw,
                           (const cmd_arg_spec_t[]){
                               {"val", CMD_ARG_INT, true}, // Direct register value
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 get_bw", (void *)rfm69_cmd_get_bw,
                           (const cmd_arg_spec_t[]){
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 set_bw_khz", (void *)rfm69_cmd_set_bw_khz,
                           (const cmd_arg_spec_t[]){
                               {"khz", CMD_ARG_STRING, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 get_bw_khz", (void *)rfm69_cmd_get_bw_khz,
                           (const cmd_arg_spec_t[]){
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 set_mod", (void *)rfm69_cmd_set_mod,
                           (const cmd_arg_spec_t[]){
                               {"mod", CMD_ARG_STRING, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 get_mod", (void *)rfm69_cmd_get_mod,
                           (const cmd_arg_spec_t[]){
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 thresh_fixed", (void *)rfm69_cmd_thresh_fixed,
                           (const cmd_arg_spec_t[]){
                               {"fixed", CMD_ARG_BOOL, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 set_lna_gain", (void *)rfm69_cmd_set_lna_gain,
                           (const cmd_arg_spec_t[]){
                               {"gain", CMD_ARG_INT, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 set_rssi_thresh", (void *)rfm69_cmd_set_rssi_threshold,
                           (const cmd_arg_spec_t[]){
                               {"thresh", CMD_ARG_INT, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 set_fixed_thresh", (void *)rfm69_cmd_set_fixed_threshold,
                           (const cmd_arg_spec_t[]){
                               {"thresh", CMD_ARG_INT, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 set_sens_boost", (void *)rfm69_cmd_set_sensitivity_boost,
                           (const cmd_arg_spec_t[]){
                               {"enabled", CMD_ARG_BOOL, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("rfm69 read_rssi", (void *)rfm69_cmd_read_rssi,
                           (const cmd_arg_spec_t[]){
                               {"force", CMD_ARG_BOOL, false},
                               {NULL, CMD_ARG_DONE, false}
                           });

    if (!ok) {
        ESP_LOGE(TAG, "Failed to register RFM69 commands");
    }
}

static void rfm69_write_reg(uint8_t addr, uint8_t value)
{
    if (!rfm69_handle) return;

    uint8_t tx[2] = { addr | 0x80, value };
    spi_transaction_t t = {
        .flags = 0,
        .length = 16,
        .tx_buffer = tx,
        .rx_buffer = NULL
    };
    spi_device_transmit(rfm69_handle, &t);
}

static uint8_t rfm69_read_reg(uint8_t addr)
{
    if (!rfm69_handle) return 0;

    uint8_t tx[2] = { addr & 0x7F, 0x00 };
    uint8_t rx[2] = { 0 };
    spi_transaction_t t = {
        .flags = 0,
        .length = 16,
        .tx_buffer = tx,
        .rx_buffer = rx
    };
    spi_device_transmit(rfm69_handle, &t);

    return rx[1];
}

static esp_err_t rfm69_init_device(void)
{
    if (rfm69_initialized) return ESP_OK;

    spi_bus_config_t buscfg = {
        .miso_io_num = rfm69_miso,
        .mosi_io_num = rfm69_mosi,
        .sclk_io_num = rfm69_sck,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 1024,
    };

    // Initialize the SPI bus
    // Note: We ignore the error if it's already initialized (e.g. by spi.c or another driver)
    esp_err_t ret = spi_bus_initialize(RFM69_HOST, &buscfg, SPI_DMA_CH_AUTO);
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "Failed to initialize SPI bus: %s", esp_err_to_name(ret));
        return ret;
    }

    spi_device_interface_config_t devcfg = {
        .clock_speed_hz = RFM69_CLOCK,
        .mode = 0,
        .spics_io_num = rfm69_cs,
        .queue_size = 7,
    };

    ret = spi_bus_add_device(RFM69_HOST, &devcfg, &rfm69_handle);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to add RFM69 device: %s", esp_err_to_name(ret));
        return ret;
    }

    rfm69_initialized = true;
    ESP_LOGI(TAG, "RFM69 initialized on host %d (CS=%d)",
             RFM69_HOST, rfm69_cs);
    return ESP_OK;
}

static void rfm69_cmd_init(int miso, int mosi, int sck, int cs)
{
    ESP_LOGI(TAG, "rfm69_cmd_init: miso=%d mosi=%d sck=%d cs=%d", miso, mosi, sck, cs);

    if (miso > 0) rfm69_miso = miso;
    if (mosi > 0) rfm69_mosi = mosi;
    if (sck > 0)  rfm69_sck = sck;
    if (cs > 0)   rfm69_cs = cs;

    if (rfm69_handle) {
        // Allow re-init with new pin configuration without requiring a reboot.
        esp_err_t removed = spi_bus_remove_device(rfm69_handle);
        if (removed != ESP_OK) {
            ESP_LOGW(TAG, "Failed to remove previous SPI device: %s", esp_err_to_name(removed));
        }
        rfm69_handle = NULL;
        rfm69_initialized = false;
    }

    esp_err_t ret = rfm69_init_device();
    if (ret == ESP_OK) {
        command_send_ok(NULL, 0);
    } else {
        char err_msg[64];
        snprintf(err_msg, sizeof(err_msg), "rfm69 init failed: %s", esp_err_to_name(ret));
        command_send_err(err_msg);
    }
}

static void rfm69_cmd_apply_defaults(void)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }

    // Baseline continuous-mode defaults (ported from RFM69LPL::updateSettings).
    // These defaults are intentionally conservative; wavelets can override as needed.
    rfm69_set_mode(RF_OPMODE_STANDBY);
    rfm69_set_threshold_type_fixed(false);
    rfm69_set_transmit_power(10, PA_MODE_PA1_PA2, true);
    rfm69_set_bandwidth_raw(0x09); // ~100 kHz (mant=20, exp=1)
    rfm69_set_fixed_threshold(115);
    rfm69_set_frequency_hz(433920000);
    rfm69_set_rssi_threshold(255);
    rfm69_set_lna_gain(RF_LNA_GAINSELECT_AUTO);
    rfm69_set_modulation(MOD_OOK);
    rfm69_set_deviation_hz(5002);
    rfm69_set_bitrate(100000);

    command_send_ok(NULL, 0);
}

static void rfm69_cmd_write_reg(int reg, int val)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    rfm69_write_reg((uint8_t)reg, (uint8_t)val);
    command_send_ok(NULL, 0);
}

static void rfm69_cmd_read_reg(int reg)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    uint8_t val = rfm69_read_reg((uint8_t)reg);
    // Raw byte response (no ASCII hex encoding)
    command_send_ok(&val, 1);
}

static void rfm69_cmd_set_mode(const char *mode_str)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }

    if (strcmp(mode_str, "tx") == 0) {
        rfm69_set_mode(RF_OPMODE_TRANSMITTER);
    } else if (strcmp(mode_str, "rx") == 0) {
        rfm69_set_mode(RF_OPMODE_RECEIVER);
    } else if (strcmp(mode_str, "synth") == 0) {
        rfm69_set_mode(RF_OPMODE_SYNTHESIZER);
    } else if (strcmp(mode_str, "standby") == 0) {
        rfm69_set_mode(RF_OPMODE_STANDBY);
    } else if (strcmp(mode_str, "sleep") == 0) {
        rfm69_set_mode(RF_OPMODE_SLEEP);
    } else {
        command_send_err("invalid mode");
        return;
    }

    command_send_ok(NULL, 0);
}

static void rfm69_cmd_set_freq(const char *freq_str)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }

    char *end = NULL;
    double freq_mhz = strtod(freq_str, &end);
    if (!end || end == freq_str || *end != '\0' || !isfinite(freq_mhz) || freq_mhz <= 0.0) {
        command_send_err("invalid freq");
        return;
    }

    uint32_t freq_hz = (uint32_t)llround(freq_mhz * 1000000.0);
    rfm69_set_frequency_hz(freq_hz);
    command_send_ok(NULL, 0);
}

static void rfm69_cmd_get_freq(void)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }

    double freq_mhz = rfm69_get_frequency_mhz();
    char buf[32];
    snprintf(buf, sizeof(buf), "%.6f", freq_mhz);
    command_send_ok((uint8_t*)buf, strlen(buf));
}

static void rfm69_cmd_set_bitrate(int bps)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    if (bps <= 0) {
        command_send_err("invalid bitrate");
        return;
    }
    rfm69_set_bitrate(bps);
    command_send_ok(NULL, 0);
}

static void rfm69_cmd_get_bitrate(void)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    int bitrate = rfm69_get_bitrate();
    char buf[32];
    snprintf(buf, sizeof(buf), "%d", bitrate);
    command_send_ok((uint8_t*)buf, strlen(buf));
}

static void rfm69_cmd_set_dev(int hz)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    rfm69_set_deviation_hz(hz);
    command_send_ok(NULL, 0);
}

static void rfm69_cmd_get_dev(void)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    int deviation = rfm69_get_deviation_hz();
    char buf[32];
    snprintf(buf, sizeof(buf), "%d", deviation);
    command_send_ok((uint8_t*)buf, strlen(buf));
}

static void rfm69_cmd_set_power(int dbm, int pa_mode, bool ocp)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }

    // Backwards compatible behavior: if pa_mode isn't specified, choose both PA mode + OCP automatically.
    if (pa_mode == 0) {
        if (dbm <= 13) pa_mode = PA_MODE_PA1;
        else if (dbm <= 17) pa_mode = PA_MODE_PA1_PA2;
        else pa_mode = PA_MODE_PA1_PA2_20DBM;

        bool ocp_auto = (pa_mode != PA_MODE_PA1_PA2_20DBM);
        rfm69_set_transmit_power(dbm, pa_mode, ocp_auto);
    } else {
        rfm69_set_transmit_power(dbm, pa_mode, ocp);
    }

    command_send_ok(NULL, 0);
}

static void rfm69_cmd_get_power(void)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    int dbm = rfm69_get_power_dbm();
    char buf[32];
    snprintf(buf, sizeof(buf), "%d", dbm);
    command_send_ok((uint8_t*)buf, strlen(buf));
}

static void rfm69_cmd_set_bw(int bw)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    rfm69_set_bandwidth_raw((uint8_t)bw);
    command_send_ok(NULL, 0);
}

static void rfm69_cmd_get_bw(void)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    uint8_t bw = rfm69_get_bandwidth_raw() & 0x1F;
    char buf[32];
    snprintf(buf, sizeof(buf), "%d", bw);
    command_send_ok((uint8_t*)buf, strlen(buf));
}

static void rfm69_cmd_set_bw_khz(const char *khz_str)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }

    char *end = NULL;
    double bw_khz = strtod(khz_str, &end);
    if (!end || end == khz_str || *end != '\0' || !isfinite(bw_khz) || bw_khz <= 0.0) {
        command_send_err("invalid bw");
        return;
    }

    rfm69_set_bandwidth_khz(bw_khz);
    command_send_ok(NULL, 0);
}

static void rfm69_cmd_get_bw_khz(void)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }

    double bw_khz = rfm69_get_bandwidth_khz();
    char buf[32];
    snprintf(buf, sizeof(buf), "%.1f", bw_khz);
    command_send_ok((uint8_t*)buf, strlen(buf));
}

static void rfm69_cmd_set_mod(const char *mod_str)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    if (strcmp(mod_str, "ook") == 0) {
        rfm69_set_modulation(MOD_OOK);
    } else {
        rfm69_set_modulation(MOD_FSK);
    }
    command_send_ok(NULL, 0);
}

static void rfm69_cmd_get_mod(void)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    uint8_t val = rfm69_read_reg(REG_DATAMODUL);
    const char *mod = (val & RF_DATAMODUL_MODULATIONTYPE_OOK) ? "ook" : "fsk";
    command_send_ok((uint8_t*)mod, strlen(mod));
}

static void rfm69_cmd_thresh_fixed(bool fixed)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    rfm69_set_threshold_type_fixed(fixed);
    command_send_ok(NULL, 0);
}

static void rfm69_cmd_set_lna_gain(int gain)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    if (gain < 0 || gain > 0x30) {
        command_send_err("invalid gain");
        return;
    }
    rfm69_set_lna_gain((uint8_t)gain);
    command_send_ok(NULL, 0);
}

static void rfm69_cmd_set_rssi_threshold(int thresh)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    if (thresh < 0 || thresh > 255) {
        command_send_err("invalid thresh");
        return;
    }
    rfm69_set_rssi_threshold((uint8_t)thresh);
    command_send_ok(NULL, 0);
}

static void rfm69_cmd_set_fixed_threshold(int thresh)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    if (thresh < 0 || thresh > 255) {
        command_send_err("invalid thresh");
        return;
    }
    rfm69_set_fixed_threshold((uint8_t)thresh);
    command_send_ok(NULL, 0);
}

static void rfm69_cmd_set_sensitivity_boost(bool enabled)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    rfm69_set_sensitivity_boost(enabled);
    command_send_ok(NULL, 0);
}

static void rfm69_cmd_read_rssi(bool force_trigger)
{
    if (!rfm69_initialized) {
        command_send_err("rfm69 not initialized");
        return;
    }
    int rssi_dbm = rfm69_read_rssi_dbm(force_trigger);
    char buf[16];
    snprintf(buf, sizeof(buf), "%d", rssi_dbm);
    command_send_ok((uint8_t*)buf, strlen(buf));
}

static void rfm69_set_mode(uint8_t mode)
{
    uint8_t current_opmode = rfm69_read_reg(REG_OPMODE);
    uint8_t new_opmode = current_opmode & 0xE3; // Clear mode bits

    new_opmode |= (mode & 0x1C);
    rfm69_write_reg(REG_OPMODE, new_opmode);

    // RX-mode specific safety tweaks (ported from RFM69LPL::setMode).
    if ((mode & 0x1C) == RF_OPMODE_RECEIVER) {
        rfm69_write_reg(REG_TESTPA1, 0x55);
        rfm69_write_reg(REG_TESTPA2, 0x70);
        rfm69_write_reg(REG_OCP, RF_OCP_ON);
    }

    // If coming from sleep, wait for ModeReady so the FIFO is available.
    if ((current_opmode & 0x1C) == RF_OPMODE_SLEEP) {
        while ((rfm69_read_reg(REG_IRQFLAGS1) & RF_IRQFLAGS1_MODEREADY) == 0x00) {
            // Busy-wait; this is only hit on explicit sleep->* transitions.
        }
    }
}

static void rfm69_set_frequency_hz(uint32_t freq_hz)
{
    uint32_t frf = (uint32_t)llround((double)freq_hz / FSTEP);
    rfm69_write_reg(REG_FRFMSB, (uint8_t)(frf >> 16));
    rfm69_write_reg(REG_FRFMID, (uint8_t)(frf >> 8));
    rfm69_write_reg(REG_FRFLSB, (uint8_t)(frf));
}

static double rfm69_get_frequency_mhz(void)
{
    uint32_t msb = rfm69_read_reg(REG_FRFMSB);
    uint32_t mid = rfm69_read_reg(REG_FRFMID);
    uint32_t lsb = rfm69_read_reg(REG_FRFLSB);
    uint32_t frf = (msb << 16) | (mid << 8) | lsb;
    return (FSTEP * (double)frf) / 1000000.0;
}

static void rfm69_set_bitrate(int bps)
{
    if (bps <= 0) {
        return;
    }
    uint32_t bitrate = (uint32_t)(RFM69_FXOSC_HZ / (double)bps);
    if (bitrate == 0) {
        bitrate = 1;
    }
    rfm69_write_reg(REG_BITRATEMSB, (uint8_t)(bitrate >> 8));
    rfm69_write_reg(REG_BITRATELSB, (uint8_t)(bitrate));
}

static int rfm69_get_bitrate(void)
{
    uint32_t msb = rfm69_read_reg(REG_BITRATEMSB);
    uint32_t lsb = rfm69_read_reg(REG_BITRATELSB);
    uint32_t bitrate_reg = (msb << 8) | lsb;
    if (bitrate_reg == 0) {
        return 0;
    }
    return (int)(RFM69_FXOSC_HZ / (double)bitrate_reg);
}

static void rfm69_set_deviation_hz(int deviation_hz)
{
    if (deviation_hz < 0) {
        deviation_hz = 0;
    }
    uint32_t deviation = (uint32_t)(deviation_hz / 61);
    rfm69_write_reg(REG_FDEVMSB, (uint8_t)(deviation >> 8));
    rfm69_write_reg(REG_FDEVLSB, (uint8_t)(deviation));
}

static int rfm69_get_deviation_hz(void)
{
    uint32_t msb = rfm69_read_reg(REG_FDEVMSB);
    uint32_t lsb = rfm69_read_reg(REG_FDEVLSB);
    return (int)(((msb << 8) | lsb) * 61);
}

static void rfm69_set_bandwidth_raw(uint8_t bw)
{
    uint8_t current = rfm69_read_reg(REG_RXBW);
    rfm69_write_reg(REG_RXBW, (current & 0xE0) | (bw & 0x1F));
}

static uint8_t rfm69_get_bandwidth_raw(void)
{
    return rfm69_read_reg(REG_RXBW);
}

static double rfm69_get_bandwidth_khz(void)
{
    uint8_t reg = rfm69_read_reg(REG_RXBW);
    uint8_t mant_bits = (reg & 0x18) >> 3;  // 2 bits
    uint8_t exp = (reg & 0x07);             // 3 bits

    double mant;
    switch (mant_bits) {
        case 0: mant = 16.0; break;
        case 1: mant = 20.0; break;
        case 2: mant = 24.0; break;
        default: mant = 24.0; break;
    }

    double bw_hz = RFM69_FXOSC_HZ / (mant * pow(2.0, (double)exp + 2.0));
    return bw_hz / 1000.0;
}

static void rfm69_set_bandwidth_khz(double bw_khz)
{
    double target_hz = bw_khz * 1000.0;
    double best_diff = HUGE_VAL;
    uint8_t best_mant = 0;
    uint8_t best_exp = 0;

    for (uint8_t mant_bits = 0; mant_bits < 3; ++mant_bits) {
        double mant = (mant_bits == 0) ? 16.0 : (mant_bits == 1) ? 20.0 : 24.0;
        for (uint8_t exp = 0; exp < 8; ++exp) {
            double bw_hz = RFM69_FXOSC_HZ / (mant * pow(2.0, (double)exp + 2.0));
            double diff = fabs(bw_hz - target_hz);
            if (diff < best_diff) {
                best_diff = diff;
                best_mant = mant_bits;
                best_exp = exp;
            }
        }
    }

    uint8_t current = rfm69_read_reg(REG_RXBW);
    uint8_t bw = ((best_mant << 3) & 0x18) | (best_exp & 0x07);
    rfm69_write_reg(REG_RXBW, (current & 0xE0) | bw);
}

static void rfm69_set_modulation(uint8_t mod)
{
    if (mod == MOD_OOK) {
        rfm69_write_reg(REG_DATAMODUL,
                        RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC |
                        RF_DATAMODUL_MODULATIONTYPE_OOK |
                        RF_DATAMODUL_MODULATIONSHAPING_00);
    } else {
        rfm69_write_reg(REG_DATAMODUL,
                        RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC |
                        RF_DATAMODUL_MODULATIONTYPE_FSK |
                        RF_DATAMODUL_MODULATIONSHAPING_00);
    }
}

static void rfm69_set_threshold_type_fixed(bool fixed)
{
    if (fixed) {
        rfm69_write_reg(REG_OOKPEAK,
                        RF_OOKPEAK_THRESHTYPE_FIXED |
                        RF_OOKPEAK_PEAKTHRESHSTEP_000 |
                        RF_OOKPEAK_PEAKTHRESHDEC_000);
    } else {
        rfm69_write_reg(REG_OOKPEAK,
                        RF_OOKPEAK_THRESHTYPE_PEAK |
                        RF_OOKPEAK_PEAKTHRESHSTEP_000 |
                        RF_OOKPEAK_PEAKTHRESHDEC_000);
    }
}

static void rfm69_set_lna_gain(uint8_t gain)
{
    rfm69_write_reg(REG_LNA, RF_LNA_ZIN_50 | gain);
}

static void rfm69_set_rssi_threshold(uint8_t thresh)
{
    rfm69_write_reg(REG_RSSITHRESH, thresh);
}

static void rfm69_set_fixed_threshold(uint8_t thresh)
{
    rfm69_write_reg(REG_OOKFIX, thresh);
}

static void rfm69_set_sensitivity_boost(bool enabled)
{
    rfm69_write_reg(REG_TESTLNA, enabled ? 0x2D : 0x1B);
}

static void rfm69_set_transmit_power(int dbm, int pa_mode, bool ocp)
{
    if (dbm < -18) dbm = -18;
    if (dbm > 20) dbm = 20;

    uint8_t pa_level = 0;
    switch (pa_mode) {
        case PA_MODE_PA0:
            pa_level = RF_PALEVEL_PA0_ON | RF_PALEVEL_PA1_OFF | RF_PALEVEL_PA2_OFF;
            pa_level |= (uint8_t)((dbm > 13) ? 31 : (dbm + 18));
            rfm69_write_reg(REG_TESTPA1, 0x55);
            rfm69_write_reg(REG_TESTPA2, 0x70);
            break;
        case PA_MODE_PA1:
            pa_level = RF_PALEVEL_PA0_OFF | RF_PALEVEL_PA1_ON | RF_PALEVEL_PA2_OFF;
            pa_level |= (uint8_t)((dbm > 13) ? 31 : (dbm + 18));
            rfm69_write_reg(REG_TESTPA1, 0x55);
            rfm69_write_reg(REG_TESTPA2, 0x70);
            break;
        case PA_MODE_PA1_PA2:
            pa_level = RF_PALEVEL_PA0_OFF | RF_PALEVEL_PA1_ON | RF_PALEVEL_PA2_ON;
            pa_level |= (uint8_t)((dbm > 17) ? 31 : (dbm + 14));
            rfm69_write_reg(REG_TESTPA1, 0x55);
            rfm69_write_reg(REG_TESTPA2, 0x70);
            break;
        case PA_MODE_PA1_PA2_20DBM:
        default:
            rfm69_write_reg(REG_TESTPA1, 0x5D);
            rfm69_write_reg(REG_TESTPA2, 0x7C);
            pa_level = RF_PALEVEL_PA0_OFF | RF_PALEVEL_PA1_ON | RF_PALEVEL_PA2_ON;
            pa_level |= (uint8_t)((dbm > 20) ? 31 : (dbm + 11));
            break;
    }

    rfm69_write_reg(REG_PALEVEL, pa_level);
    rfm69_write_reg(REG_OCP, ocp ? RF_OCP_ON : RF_OCP_OFF);
}

static int rfm69_get_power_dbm(void)
{
    uint8_t pa_level = rfm69_read_reg(REG_PALEVEL);
    int output_power = pa_level & 0x1F;

    bool pa0 = (pa_level & RF_PALEVEL_PA0_ON) != 0;
    bool pa1 = (pa_level & RF_PALEVEL_PA1_ON) != 0;
    bool pa2 = (pa_level & RF_PALEVEL_PA2_ON) != 0;

    uint8_t test_pa1 = rfm69_read_reg(REG_TESTPA1);
    uint8_t test_pa2 = rfm69_read_reg(REG_TESTPA2);
    bool is_20dbm = (test_pa1 == 0x5D) && (test_pa2 == 0x7C);

    if (pa0 && !pa1 && !pa2) {
        return output_power - 18;
    }
    if (!pa0 && pa1 && !pa2) {
        return output_power - 18;
    }
    if (!pa0 && pa1 && pa2) {
        return is_20dbm ? (output_power - 11) : (output_power - 14);
    }
    return 0;
}

static int rfm69_read_rssi_dbm(bool force_trigger)
{
    if (force_trigger) {
        rfm69_write_reg(REG_RSSICONFIG, RF_RSSI_START);
        while ((rfm69_read_reg(REG_RSSICONFIG) & RF_RSSI_DONE) == 0x00) {
            // Busy-wait; measurements are fast.
        }
    }
    return -((int)(rfm69_read_reg(REG_RSSIVALUE) >> 1));
}
