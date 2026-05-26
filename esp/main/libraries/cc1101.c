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

#include "cc1101.h"

#include "command_registry.h"
#include "emw_target.h"
#include "spi.h"
#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *TAG = "CC1101";

#define CC1101_CLOCK 8000000

// Configurable pins (defaults match wavelet_gpio.js + older ISM wiring)
static int cc1101_miso = EMW_TARGET_SPI_DEFAULT_MISO;
static int cc1101_mosi = EMW_TARGET_SPI_DEFAULT_MOSI;
static int cc1101_sck = EMW_TARGET_SPI_DEFAULT_SCK;
static int cc1101_cs = EMW_TARGET_SPI_DEFAULT_CS;

static bool cc1101_did_reset = false;

// CC1101 command strobes
#define CC1101_SRES 0x30
#define CC1101_SCAL 0x33
#define CC1101_SRX  0x34
#define CC1101_STX  0x35

// Registers used by helper routines
#define CC1101_REG_IOCFG2   0x00
#define CC1101_REG_IOCFG1   0x01
#define CC1101_REG_IOCFG0   0x02
#define CC1101_REG_FIFOTHR  0x03
#define CC1101_REG_SYNC1    0x04
#define CC1101_REG_SYNC0    0x05
#define CC1101_REG_PKTLEN   0x06
#define CC1101_REG_PKTCTRL1 0x07
#define CC1101_REG_PKTCTRL0 0x08
#define CC1101_REG_ADDR     0x09
#define CC1101_REG_CHANNR   0x0A
#define CC1101_REG_FSCTRL1  0x0B
#define CC1101_REG_FSCTRL0  0x0C
#define CC1101_REG_FREQ2    0x0D
#define CC1101_REG_FREQ1    0x0E
#define CC1101_REG_FREQ0    0x0F
#define CC1101_REG_MDMCFG4  0x10
#define CC1101_REG_MDMCFG3  0x11
#define CC1101_REG_MDMCFG2  0x12
#define CC1101_REG_MDMCFG1  0x13
#define CC1101_REG_MDMCFG0  0x14
#define CC1101_REG_DEVIATN  0x15
#define CC1101_REG_MCSM1    0x17
#define CC1101_REG_MCSM0    0x18
#define CC1101_REG_FOCCFG   0x19
#define CC1101_REG_BSCFG    0x1A
#define CC1101_REG_AGCCTRL2 0x1B
#define CC1101_REG_AGCCTRL1 0x1C
#define CC1101_REG_AGCCTRL0 0x1D
#define CC1101_REG_FREND1   0x21
#define CC1101_REG_FREND0   0x22
#define CC1101_REG_FSCAL3   0x23
#define CC1101_REG_FSCAL2   0x24
#define CC1101_REG_FSCAL1   0x25
#define CC1101_REG_FSCAL0   0x26
#define CC1101_REG_FSTEST   0x29
#define CC1101_REG_TEST2    0x2C
#define CC1101_REG_TEST1    0x2D
#define CC1101_REG_TEST0    0x2E
#define CC1101_REG_PATABLE  0x3E

// Modulation formats (MDMCFG2 bits 6:4)
#define CC1101_MOD_2FSK 0
#define CC1101_MOD_GFSK 1
#define CC1101_MOD_ASK  3
#define CC1101_MOD_4FSK 4
#define CC1101_MOD_MSK  7

static void cc1101_cmd_init(int ignored0, int ignored1, int ignored2, int ignored3);
static void cc1101_cmd_write_reg(int reg, int val);
static void cc1101_cmd_read_reg(int reg);
static void cc1101_cmd_strobe(int cmd);
static void cc1101_cmd_read_burst(int reg, int len);
static void cc1101_cmd_write_burst(int reg, const command_hex_arg_t *data);
static void cc1101_cmd_apply_defaults(void);
static void cc1101_cmd_set_freq(const char *freq_str);
static void cc1101_cmd_get_freq(void);
static void cc1101_cmd_set_datarate(int bps);
static void cc1101_cmd_get_datarate(void);
static void cc1101_cmd_set_mod(const char *mod_str);
static void cc1101_cmd_get_mod(void);
static void cc1101_cmd_set_mod_power(int modulation, int dbm);
static void cc1101_cmd_set_gdo(const command_hex_arg_t *data);

static bool cc1101_ensure_ready(void);
static uint8_t cc1101_read_reg(uint8_t addr);
static void cc1101_write_reg(uint8_t addr, uint8_t value);
static void cc1101_strobe(uint8_t cmd);
static void cc1101_read_burst(uint8_t addr, uint8_t *out, size_t len);
static void cc1101_write_burst(uint8_t addr, const uint8_t *data, size_t len);

static void cc1101_apply_defaults(void);
static double cc1101_get_frequency_mhz(void);
static bool cc1101_set_frequency_mhz(double freq_mhz);
static bool cc1101_set_datarate(int bps);
static bool cc1101_set_modulation_and_power(int modulation, int dbm);
static void cc1101_calibrate_for_freq(double freq_mhz);
static bool cc1101_set_gdo(uint8_t gdo2, uint8_t gdo1, uint8_t gdo0);

void cc1101_register_commands(void)
{
    bool ok = true;
    ok &= register_command("cc1101 init", (void *)cc1101_cmd_init,
                           (const cmd_arg_spec_t[]){
                               {"miso", CMD_ARG_INT, false},
                               {"mosi", CMD_ARG_INT, false},
                               {"sck", CMD_ARG_INT, false},
                               {"cs", CMD_ARG_INT, false},
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
    ok &= register_command("cc1101 read_burst", (void *)cc1101_cmd_read_burst,
                           (const cmd_arg_spec_t[]){
                               {"reg", CMD_ARG_INT, true},
                               {"len", CMD_ARG_INT, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("cc1101 write_burst", (void *)cc1101_cmd_write_burst,
                           (const cmd_arg_spec_t[]){
                               {"reg", CMD_ARG_INT, true},
                               {"data", CMD_ARG_HEX, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("cc1101 apply_defaults", (void *)cc1101_cmd_apply_defaults,
                           (const cmd_arg_spec_t[]){
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("cc1101 set_freq", (void *)cc1101_cmd_set_freq,
                           (const cmd_arg_spec_t[]){
                               {"mhz", CMD_ARG_STRING, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("cc1101 get_freq", (void *)cc1101_cmd_get_freq,
                           (const cmd_arg_spec_t[]){
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("cc1101 set_datarate", (void *)cc1101_cmd_set_datarate,
                           (const cmd_arg_spec_t[]){
                               {"bps", CMD_ARG_INT, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("cc1101 get_datarate", (void *)cc1101_cmd_get_datarate,
                           (const cmd_arg_spec_t[]){
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("cc1101 set_mod", (void *)cc1101_cmd_set_mod,
                           (const cmd_arg_spec_t[]){
                               {"mod", CMD_ARG_STRING, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("cc1101 get_mod", (void *)cc1101_cmd_get_mod,
                           (const cmd_arg_spec_t[]){
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("cc1101 set_mod_power", (void *)cc1101_cmd_set_mod_power,
                           (const cmd_arg_spec_t[]){
                               {"mod", CMD_ARG_INT, true},
                               {"dbm", CMD_ARG_INT, true},
                               {NULL, CMD_ARG_DONE, false}
                           });
    ok &= register_command("cc1101 set_gdo", (void *)cc1101_cmd_set_gdo,
                           (const cmd_arg_spec_t[]){
                               {"data", CMD_ARG_HEX, true}, // 3 bytes: gdo2,gdo1,gdo0
                               {NULL, CMD_ARG_DONE, false}
                           });
    if (!ok) {
        ESP_LOGE(TAG, "Failed to register CC1101 commands");
    }
}

static bool cc1101_ensure_ready(void)
{
    // Stateless command surface: SPI bus is initialized at boot; each CC1101
    // operation performs its own transfer without a persistent device handle.
    //
    // Do a one-time reset strobe on first use to make probing deterministic.
    if (!cc1101_did_reset) {
        cc1101_strobe(CC1101_SRES);
        vTaskDelay(pdMS_TO_TICKS(2));
        cc1101_did_reset = true;
    }
    return true;
}

static void cc1101_apply_defaults(void)
{
    // Matches CC1101.java init() defaults from the older Android app.
    cc1101_write_reg(CC1101_REG_FSCTRL1, 0x06);

    cc1101_write_reg(CC1101_REG_MDMCFG1, 0x02);
    cc1101_write_reg(CC1101_REG_MDMCFG0, 0xF8);
    cc1101_write_reg(CC1101_REG_CHANNR, 0x00);
    cc1101_write_reg(CC1101_REG_DEVIATN, 0x47);
    cc1101_write_reg(CC1101_REG_FREND1, 0x56);
    cc1101_write_reg(CC1101_REG_MCSM0, 0x18);
    cc1101_write_reg(CC1101_REG_FOCCFG, 0x16);
    cc1101_write_reg(CC1101_REG_BSCFG, 0x1C);
    cc1101_write_reg(CC1101_REG_AGCCTRL2, 0xC7);
    cc1101_write_reg(CC1101_REG_AGCCTRL1, 0x00);
    cc1101_write_reg(CC1101_REG_AGCCTRL0, 0xB2);
    cc1101_write_reg(CC1101_REG_FSCAL3, 0xE9);
    cc1101_write_reg(CC1101_REG_FSCAL2, 0x2A);
    cc1101_write_reg(CC1101_REG_FSCAL1, 0x00);
    cc1101_write_reg(CC1101_REG_FSCAL0, 0x1F);
    cc1101_write_reg(CC1101_REG_FSTEST, 0x59);
    cc1101_write_reg(CC1101_REG_TEST2, 0x81);
    cc1101_write_reg(CC1101_REG_TEST1, 0x35);
    cc1101_write_reg(CC1101_REG_TEST0, 0x09);
    cc1101_write_reg(CC1101_REG_PKTCTRL0, 0x00);
    cc1101_write_reg(CC1101_REG_PKTCTRL1, 0x04);
    cc1101_write_reg(CC1101_REG_ADDR, 0x00);
    // Avoid an unusable fixed-length default (0x00 bytes). PacketMode will overwrite this per TX.
    cc1101_write_reg(CC1101_REG_PKTLEN, 0xFF);
}

static double cc1101_get_frequency_mhz(void)
{
    const uint32_t freq_word = ((uint32_t)cc1101_read_reg(CC1101_REG_FREQ2) << 16) |
                               ((uint32_t)cc1101_read_reg(CC1101_REG_FREQ1) << 8) |
                               (uint32_t)cc1101_read_reg(CC1101_REG_FREQ0);
    const double f_osc = 26e6;
    const double freq_hz = ((double)freq_word * (f_osc / (double)(1u << 16)));
    return freq_hz / 1e6;
}

static void cc1101_calibrate_for_freq(double freq_mhz)
{
    // Mirrors CC1101.java calibrate() behavior.
    if ((freq_mhz >= 300.0 && freq_mhz <= 348.0) ||
        (freq_mhz >= 378.0 && freq_mhz <= 464.0) ||
        (freq_mhz >= 779.0 && freq_mhz <= 899.99)) {
        double boundary = 0.0;
        if (freq_mhz >= 300.0 && freq_mhz <= 348.0) {
            boundary = 322.88;
        } else if (freq_mhz >= 378.0 && freq_mhz <= 464.0) {
            boundary = 430.5;
        } else {
            boundary = 861.0;
        }

        if (freq_mhz < boundary) {
            cc1101_write_reg(CC1101_REG_TEST0, 0x0B);
        } else {
            cc1101_write_reg(CC1101_REG_TEST0, 0x09);
            uint8_t fscal2 = cc1101_read_reg(CC1101_REG_FSCAL2);
            if (fscal2 < 32) {
                cc1101_write_reg(CC1101_REG_FSCAL2, (uint8_t)(fscal2 + 32));
            }
        }
        return;
    }

    if (freq_mhz >= 900.0 && freq_mhz <= 928.0) {
        cc1101_write_reg(CC1101_REG_TEST0, 0x09);
        uint8_t fscal2 = cc1101_read_reg(CC1101_REG_FSCAL2);
        if (fscal2 < 32) {
            cc1101_write_reg(CC1101_REG_FSCAL2, (uint8_t)(fscal2 + 32));
        }
    }
}

static bool cc1101_set_frequency_mhz(double freq_mhz)
{
    if (freq_mhz <= 0.0) {
        return false;
    }

    const double f_osc = 26e6;
    const double freq_hz = freq_mhz * 1e6;
    const uint32_t freq_word = (uint32_t)llround(freq_hz * (double)(1u << 16) / f_osc);

    cc1101_write_reg(CC1101_REG_FREQ2, (uint8_t)((freq_word >> 16) & 0xFF));
    cc1101_write_reg(CC1101_REG_FREQ1, (uint8_t)((freq_word >> 8) & 0xFF));
    cc1101_write_reg(CC1101_REG_FREQ0, (uint8_t)(freq_word & 0xFF));

    cc1101_calibrate_for_freq(freq_mhz);
    return true;
}

static bool cc1101_set_datarate(int bps)
{
    if (bps <= 0) {
        return false;
    }

    // CC1101 bitrate formula:
    // bitrate = ((256 + DRATE_M) * 2^DRATE_E * f_osc) / 2^28
    const double f_osc = 26e6;
    const double target = (double)bps;

    int best_m = 0;
    int best_e = 0;
    double best_error = 1e30;

    for (int e = 0; e <= 15; e++) {
        for (int m = 0; m <= 255; m++) {
            double bitrate = ((256.0 + (double)m) * pow(2.0, (double)e) * f_osc) / pow(2.0, 28.0);
            double error = fabs(bitrate - target);
            if (error < best_error) {
                best_error = error;
                best_m = m;
                best_e = e;
            }
        }
    }

    uint8_t mdmcfg4 = cc1101_read_reg(CC1101_REG_MDMCFG4);
    uint8_t preserved_bw = mdmcfg4 & 0xF0;
    cc1101_write_reg(CC1101_REG_MDMCFG4, (uint8_t)(preserved_bw | (best_e & 0x0F)));
    cc1101_write_reg(CC1101_REG_MDMCFG3, (uint8_t)(best_m & 0xFF));
    return true;
}

static bool cc1101_set_gdo(uint8_t gdo2, uint8_t gdo1, uint8_t gdo0)
{
    cc1101_write_reg(CC1101_REG_IOCFG2, gdo2);
    cc1101_write_reg(CC1101_REG_IOCFG1, gdo1);
    cc1101_write_reg(CC1101_REG_IOCFG0, gdo0);
    return true;
}

static bool cc1101_set_modulation_and_power(int modulation, int dbm)
{
    static const int power_levels[8] = {-30, -20, -15, -10, 0, 5, 7, 10};
    static const uint8_t power_315[8] = {0x12, 0x0D, 0x1C, 0x34, 0x51, 0x85, 0xCB, 0xC2};
    static const uint8_t power_433[8] = {0x12, 0x0E, 0x1D, 0x34, 0x60, 0x84, 0xC8, 0xC0};
    static const uint8_t power_868[8] = {0x03, 0x0F, 0x1E, 0x27, 0x50, 0x81, 0xCB, 0xC2};
    static const uint8_t power_915[8] = {0x03, 0x0E, 0x1E, 0x27, 0x8E, 0xCD, 0xC7, 0xC0};

    int power_index = -1;
    for (int i = 0; i < 8; i++) {
        if (power_levels[i] == dbm) {
            power_index = i;
            break;
        }
    }
    if (power_index < 0) {
        return false;
    }

    double freq_mhz = cc1101_get_frequency_mhz();
    const uint8_t *power_table = NULL;
    if (freq_mhz >= 300.0 && freq_mhz <= 348.0) {
        power_table = power_315;
    } else if (freq_mhz >= 378.0 && freq_mhz <= 464.0) {
        power_table = power_433;
    } else if (freq_mhz >= 779.0 && freq_mhz <= 899.99) {
        power_table = power_868;
    } else if (freq_mhz >= 900.0 && freq_mhz <= 928.0) {
        power_table = power_915;
    } else {
        return false;
    }

    uint8_t power_setting = power_table[power_index];

    uint8_t current_mdmcfg2 = cc1101_read_reg(CC1101_REG_MDMCFG2);
    uint8_t mdmcfg2_value = (uint8_t)((current_mdmcfg2 & 0x0F) | ((modulation & 0x07) << 4));
    uint8_t frend0_value = (modulation == CC1101_MOD_ASK) ? 0x11 : 0x10;

    cc1101_write_reg(CC1101_REG_MDMCFG2, mdmcfg2_value);
    cc1101_write_reg(CC1101_REG_FREND0, frend0_value);

    uint8_t pa_table[8] = {0};
    if (modulation == CC1101_MOD_ASK) {
        pa_table[0] = 0x00;
        pa_table[1] = power_setting;
    } else {
        pa_table[0] = power_setting;
        pa_table[1] = 0x00;
    }
    cc1101_write_burst(CC1101_REG_PATABLE, pa_table, sizeof(pa_table));
    return true;
}

static void cc1101_strobe(uint8_t cmd)
{
    uint8_t tx[1] = { cmd };
    (void)spi_transfer_once(cc1101_cs, 0, CC1101_CLOCK, false, tx, sizeof(tx), NULL, 0);
}

static uint8_t cc1101_read_reg(uint8_t addr)
{
    // CC1101 register read:
    // - Config registers (0x00-0x2E): READ_SINGLE (0x80)
    // - Status registers (0x30-0x3D): must use READ_BURST (0xC0) even for single-byte access.
    uint8_t cmd = (uint8_t)(addr | 0x80);
    if (addr >= 0x30 && addr <= 0x3D) {
        cmd = (uint8_t)(addr | 0xC0);
    }

    uint8_t tx[2] = { cmd, 0x00 };
    uint8_t rx[2] = { 0 };
    esp_err_t ret = spi_transfer_once(cc1101_cs, 0, CC1101_CLOCK, false, tx, sizeof(tx), rx, sizeof(rx));
    if (ret != ESP_OK) {
        return 0;
    }

    return rx[1];
}

static void cc1101_write_reg(uint8_t addr, uint8_t value)
{
    // CC1101 single register write: address byte with R/W=0, then value.
    uint8_t tx[2] = { addr, value };
    (void)spi_transfer_once(cc1101_cs, 0, CC1101_CLOCK, false, tx, sizeof(tx), NULL, 0);
}

static void cc1101_read_burst(uint8_t addr, uint8_t *out, size_t len)
{
    if (!out || len == 0) {
        return;
    }

    // Burst read uses 0xC0 on the address byte.
    uint8_t tx[1 + CLI_VALUE_MAX] = {0};
    uint8_t rx[1 + CLI_VALUE_MAX] = {0};
    if (len > CLI_VALUE_MAX) {
        len = CLI_VALUE_MAX;
    }
    tx[0] = (uint8_t)(addr | 0xC0);

    (void)spi_transfer_once(cc1101_cs, 0, CC1101_CLOCK, false, tx, 1 + len, rx, 1 + len);

    memcpy(out, &rx[1], len);
}

static void cc1101_write_burst(uint8_t addr, const uint8_t *data, size_t len)
{
    if (!data || len == 0) {
        return;
    }

    // Burst write uses 0x40 on the address byte.
    uint8_t tx[1 + CLI_VALUE_MAX] = {0};
    if (len > CLI_VALUE_MAX) {
        len = CLI_VALUE_MAX;
    }
    tx[0] = (uint8_t)(addr | 0x40);
    memcpy(&tx[1], data, len);

    (void)spi_transfer_once(cc1101_cs, 0, CC1101_CLOCK, false, tx, 1 + len, NULL, 0);
}

static void cc1101_cmd_init(int ignored0, int ignored1, int ignored2, int ignored3)
{
    (void)ignored0;
    (void)ignored1;
    (void)ignored2;
    (void)ignored3;

    // Backward-compatibility: the CC1101 helper no longer requires explicit init.
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_write_reg(int reg, int val)
{
    if (!cc1101_ensure_ready()) {
        command_send_err("cc1101 not ready");
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
    if (!cc1101_ensure_ready()) {
        command_send_err("cc1101 not ready");
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
    if (!cc1101_ensure_ready()) {
        command_send_err("cc1101 not ready");
        return;
    }
    if (cmd < 0 || cmd > 0x3D) {
        command_send_err("cc1101 strobe range");
        return;
    }
    cc1101_strobe((uint8_t)cmd);
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_read_burst(int reg, int len)
{
    if (!cc1101_ensure_ready()) {
        command_send_err("cc1101 not ready");
        return;
    }
    if (reg < 0 || reg > 0x3F) {
        command_send_err("cc1101 reg range");
        return;
    }
    if (len <= 0 || len > CLI_VALUE_MAX) {
        command_send_err("cc1101 len range");
        return;
    }

    uint8_t out[CLI_VALUE_MAX] = {0};
    cc1101_read_burst((uint8_t)reg, out, (size_t)len);
    command_send_ok(out, (size_t)len);
}

static void cc1101_cmd_write_burst(int reg, const command_hex_arg_t *data)
{
    if (!cc1101_ensure_ready()) {
        command_send_err("cc1101 not ready");
        return;
    }
    if (reg < 0 || reg > 0x3F) {
        command_send_err("cc1101 reg range");
        return;
    }
    if (!data || data->length == 0) {
        command_send_err("cc1101 data empty");
        return;
    }
    if (data->length > CLI_VALUE_MAX) {
        command_send_err("cc1101 data too long");
        return;
    }

    cc1101_write_burst((uint8_t)reg, data->data, data->length);
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_apply_defaults(void)
{
    if (!cc1101_ensure_ready()) {
        command_send_err("cc1101 not ready");
        return;
    }
    cc1101_apply_defaults();
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_set_freq(const char *freq_str)
{
    if (!cc1101_ensure_ready()) {
        command_send_err("cc1101 not ready");
        return;
    }
    if (!freq_str || freq_str[0] == '\0') {
        command_send_err("freq missing");
        return;
    }

    char *end = NULL;
    double mhz = strtod(freq_str, &end);
    if (end == freq_str || (end && *end != '\0') || !isfinite(mhz)) {
        command_send_err("invalid freq");
        return;
    }
    if (!cc1101_set_frequency_mhz(mhz)) {
        command_send_err("freq range");
        return;
    }
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_get_freq(void)
{
    if (!cc1101_ensure_ready()) {
        command_send_err("cc1101 not ready");
        return;
    }
    double mhz = cc1101_get_frequency_mhz();
    char buf[32];
    snprintf(buf, sizeof(buf), "%.6f", mhz);
    command_send_ok((const uint8_t *)buf, strlen(buf));
}

static void cc1101_cmd_set_datarate(int bps)
{
    if (!cc1101_ensure_ready()) {
        command_send_err("cc1101 not ready");
        return;
    }
    if (!cc1101_set_datarate(bps)) {
        command_send_err("invalid datarate");
        return;
    }
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_get_datarate(void)
{
    if (!cc1101_ensure_ready()) {
        command_send_err("cc1101 not ready");
        return;
    }

    const double f_osc = 26e6;
    uint8_t mdmcfg4 = cc1101_read_reg(CC1101_REG_MDMCFG4);
    uint8_t mdmcfg3 = cc1101_read_reg(CC1101_REG_MDMCFG3);
    int drate_e = mdmcfg4 & 0x0F;
    int drate_m = mdmcfg3 & 0xFF;
    double bitrate = ((256.0 + (double)drate_m) * pow(2.0, (double)drate_e) * f_osc) / pow(2.0, 28.0);

    char buf[32];
    snprintf(buf, sizeof(buf), "%d", (int)llround(bitrate));
    command_send_ok((const uint8_t *)buf, strlen(buf));
}

static int cc1101_parse_modulation(const char *mod_str)
{
    if (!mod_str) {
        return -1;
    }
    if (strcmp(mod_str, "2fsk") == 0) return CC1101_MOD_2FSK;
    if (strcmp(mod_str, "gfsk") == 0) return CC1101_MOD_GFSK;
    if (strcmp(mod_str, "ask") == 0) return CC1101_MOD_ASK;
    if (strcmp(mod_str, "ook") == 0) return CC1101_MOD_ASK;
    if (strcmp(mod_str, "4fsk") == 0) return CC1101_MOD_4FSK;
    if (strcmp(mod_str, "msk") == 0) return CC1101_MOD_MSK;
    return -1;
}

static void cc1101_cmd_set_mod(const char *mod_str)
{
    if (!cc1101_ensure_ready()) {
        command_send_err("cc1101 not ready");
        return;
    }
    int mod = cc1101_parse_modulation(mod_str);
    if (mod < 0) {
        command_send_err("invalid mod");
        return;
    }

    uint8_t current = cc1101_read_reg(CC1101_REG_MDMCFG2);
    uint8_t updated = (uint8_t)((current & 0x0F) | ((mod & 0x07) << 4));
    cc1101_write_reg(CC1101_REG_MDMCFG2, updated);
    cc1101_write_reg(CC1101_REG_FREND0, (mod == CC1101_MOD_ASK) ? 0x11 : 0x10);
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_get_mod(void)
{
    if (!cc1101_ensure_ready()) {
        command_send_err("cc1101 not ready");
        return;
    }
    uint8_t mdmcfg2 = cc1101_read_reg(CC1101_REG_MDMCFG2);
    uint8_t mod = (uint8_t)((mdmcfg2 >> 4) & 0x07);
    command_send_ok(&mod, 1);
}

static void cc1101_cmd_set_mod_power(int modulation, int dbm)
{
    if (!cc1101_ensure_ready()) {
        command_send_err("cc1101 not ready");
        return;
    }
    if (modulation < 0 || modulation > 7) {
        command_send_err("mod range");
        return;
    }
    if (!cc1101_set_modulation_and_power(modulation, dbm)) {
        command_send_err("invalid power");
        return;
    }
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_set_gdo(const command_hex_arg_t *data)
{
    if (!cc1101_ensure_ready()) {
        command_send_err("cc1101 not ready");
        return;
    }
    if (!data || data->length < 3) {
        command_send_err("gdo needs 3 bytes");
        return;
    }
    cc1101_set_gdo(data->data[0], data->data[1], data->data[2]);
    command_send_ok(NULL, 0);
}
