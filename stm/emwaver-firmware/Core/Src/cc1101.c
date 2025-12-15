#include "cc1101.h"

#include "command_registry.h"
#include "main.h"

#include <stdbool.h>
#include <stdint.h>
#include <string.h>

extern SPI_HandleTypeDef hspi1;

#define CC1101_FOSC_HZ 26000000u
#define CC1101_SPI_TIMEOUT_MS 20u

#ifndef CC1101_CS_GPIO_Port
#define CC1101_CS_GPIO_Port NSS_RFID_GPIO_Port
#endif
#ifndef CC1101_CS_Pin
#define CC1101_CS_Pin NSS_RFID_Pin
#endif

#ifndef CC1101_MISO_GPIO_Port
#define CC1101_MISO_GPIO_Port GPIOA
#endif
#ifndef CC1101_MISO_Pin
#define CC1101_MISO_Pin GPIO_PIN_6
#endif

#define CC1101_REG_IOCFG2   0x00
#define CC1101_REG_IOCFG1   0x01
#define CC1101_REG_IOCFG0   0x02
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
#define CC1101_REG_PKTCTRL1 0x07
#define CC1101_REG_PKTCTRL0 0x08
#define CC1101_REG_ADDR     0x09
#define CC1101_REG_PKTLEN   0x06
#define CC1101_REG_CHANNR   0x0A
#define CC1101_REG_PATABLE  0x3E

#define CC1101_SRES 0x30

#define CC1101_MOD_2FSK 0
#define CC1101_MOD_GFSK 1
#define CC1101_MOD_ASK  3
#define CC1101_MOD_4FSK 4
#define CC1101_MOD_MSK  7

static bool cc1101_initialized = false;

static size_t cc1101_u32_to_dec(char *out, size_t out_len, uint32_t value)
{
    if (!out || out_len == 0) {
        return 0;
    }

    char tmp[10];
    size_t n = 0;
    do {
        tmp[n++] = (char)('0' + (value % 10u));
        value /= 10u;
    } while (value != 0u && n < sizeof(tmp));

    size_t written = 0;
    while (n > 0 && written + 1 < out_len) {
        out[written++] = tmp[--n];
    }
    out[written] = '\0';
    return written;
}

static size_t cc1101_append_fixed_6(char *out, size_t out_len, size_t pos, uint32_t value)
{
    if (!out || out_len == 0 || pos >= out_len) {
        return pos;
    }

    if (pos + 6 >= out_len) {
        out[out_len - 1] = '\0';
        return out_len - 1;
    }

    for (int i = 5; i >= 0; --i) {
        out[pos + (size_t)i] = (char)('0' + (value % 10u));
        value /= 10u;
    }
    pos += 6;
    out[pos] = '\0';
    return pos;
}

static bool cc1101_parse_mhz_string_to_hz(const char *str, uint32_t *out_hz)
{
    if (!str || !out_hz) {
        return false;
    }

    uint64_t whole = 0;
    uint64_t frac = 0;
    uint32_t frac_digits = 0;
    bool seen_digit = false;
    bool seen_dot = false;

    for (const char *p = str; *p; ++p) {
        char c = *p;
        if (c >= '0' && c <= '9') {
            seen_digit = true;
            uint32_t d = (uint32_t)(c - '0');
            if (!seen_dot) {
                whole = whole * 10u + d;
            } else {
                if (frac_digits >= 6) {
                    return false;
                }
                frac = frac * 10u + d;
                frac_digits++;
            }
            continue;
        }

        if (c == '.' && !seen_dot) {
            seen_dot = true;
            continue;
        }

        return false;
    }

    if (!seen_digit) {
        return false;
    }

    while (frac_digits < 6) {
        frac *= 10u;
        frac_digits++;
    }

    uint64_t hz = whole * 1000000u + frac;
    if (hz == 0 || hz > 0xFFFFFFFFu) {
        return false;
    }

    *out_hz = (uint32_t)hz;
    return true;
}

static void cc1101_select(void)
{
    // CC1101 CS is active-low on all our supported boards.
    HAL_GPIO_WritePin(CC1101_CS_GPIO_Port, CC1101_CS_Pin, GPIO_PIN_RESET);
}

static void cc1101_deselect(void)
{
    HAL_GPIO_WritePin(CC1101_CS_GPIO_Port, CC1101_CS_Pin, GPIO_PIN_SET);
}

static uint8_t cc1101_read_reg(uint8_t addr)
{
    uint8_t cmd = (uint8_t)(addr | 0x80);
    if (addr >= 0x30 && addr <= 0x3D) {
        cmd = (uint8_t)(addr | 0xC0);
    }

    uint8_t tx[2] = {cmd, 0x00};
    uint8_t rx[2] = {0};
    cc1101_select();
    HAL_StatusTypeDef st = HAL_SPI_TransmitReceive(&hspi1, tx, rx, 2, CC1101_SPI_TIMEOUT_MS);
    cc1101_deselect();
    if (st != HAL_OK) {
        return 0;
    }
    return rx[1];
}

static void cc1101_write_reg(uint8_t addr, uint8_t value)
{
    uint8_t tx[2] = {addr, value};
    cc1101_select();
    (void)HAL_SPI_Transmit(&hspi1, tx, 2, CC1101_SPI_TIMEOUT_MS);
    cc1101_deselect();
}

static void cc1101_strobe(uint8_t cmd)
{
    uint8_t tx[1] = {cmd};
    cc1101_select();
    (void)HAL_SPI_Transmit(&hspi1, tx, 1, CC1101_SPI_TIMEOUT_MS);
    cc1101_deselect();
}

static void cc1101_read_burst(uint8_t addr, uint8_t *out, size_t len)
{
    if (!out || len == 0) {
        return;
    }
    if (len > CLI_VALUE_MAX) {
        len = CLI_VALUE_MAX;
    }

    uint8_t cmd = (uint8_t)(addr | 0xC0);
    cc1101_select();
    HAL_StatusTypeDef st = HAL_SPI_Transmit(&hspi1, &cmd, 1, CC1101_SPI_TIMEOUT_MS);
    if (st == HAL_OK) {
        (void)HAL_SPI_Receive(&hspi1, out, (uint16_t)len, CC1101_SPI_TIMEOUT_MS);
    }
    cc1101_deselect();
}

static void cc1101_write_burst(uint8_t addr, const uint8_t *data, size_t len)
{
    if (!data || len == 0) {
        return;
    }
    if (len > CLI_VALUE_MAX) {
        len = CLI_VALUE_MAX;
    }

    uint8_t cmd = (uint8_t)(addr | 0x40);
    cc1101_select();
    HAL_StatusTypeDef st = HAL_SPI_Transmit(&hspi1, &cmd, 1, CC1101_SPI_TIMEOUT_MS);
    if (st == HAL_OK) {
        (void)HAL_SPI_Transmit(&hspi1, (uint8_t *)data, (uint16_t)len, CC1101_SPI_TIMEOUT_MS);
    }
    cc1101_deselect();
}

static void cc1101_apply_defaults(void)
{
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
    cc1101_write_reg(CC1101_REG_PKTLEN, 0x00);
}

static uint32_t cc1101_get_frequency_hz(void)
{
    const uint32_t freq_word = ((uint32_t)cc1101_read_reg(CC1101_REG_FREQ2) << 16) |
                               ((uint32_t)cc1101_read_reg(CC1101_REG_FREQ1) << 8) |
                               (uint32_t)cc1101_read_reg(CC1101_REG_FREQ0);
    const uint64_t num = (uint64_t)freq_word * (uint64_t)CC1101_FOSC_HZ;
    return (uint32_t)((num + (1u << 15)) >> 16);
}

static void cc1101_calibrate_for_freq_hz(uint32_t freq_hz)
{
    if ((freq_hz >= 300000000u && freq_hz <= 348000000u) ||
        (freq_hz >= 378000000u && freq_hz <= 464000000u) ||
        (freq_hz >= 779000000u && freq_hz <= 899990000u)) {
        uint32_t boundary_hz = 0;
        if (freq_hz >= 300000000u && freq_hz <= 348000000u) {
            boundary_hz = 322880000u;
        } else if (freq_hz >= 378000000u && freq_hz <= 464000000u) {
            boundary_hz = 430500000u;
        } else {
            boundary_hz = 861000000u;
        }

        if (freq_hz < boundary_hz) {
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

    if (freq_hz >= 900000000u && freq_hz <= 928000000u) {
        cc1101_write_reg(CC1101_REG_TEST0, 0x09);
        uint8_t fscal2 = cc1101_read_reg(CC1101_REG_FSCAL2);
        if (fscal2 < 32) {
            cc1101_write_reg(CC1101_REG_FSCAL2, (uint8_t)(fscal2 + 32));
        }
    }
}

static bool cc1101_set_frequency_hz(uint32_t freq_hz)
{
    if (freq_hz == 0) {
        return false;
    }

    const uint64_t num = (uint64_t)freq_hz * (uint64_t)(1u << 16);
    const uint32_t freq_word = (uint32_t)((num + (CC1101_FOSC_HZ / 2u)) / (uint64_t)CC1101_FOSC_HZ);

    cc1101_write_reg(CC1101_REG_FREQ2, (uint8_t)((freq_word >> 16) & 0xFF));
    cc1101_write_reg(CC1101_REG_FREQ1, (uint8_t)((freq_word >> 8) & 0xFF));
    cc1101_write_reg(CC1101_REG_FREQ0, (uint8_t)(freq_word & 0xFF));

    cc1101_calibrate_for_freq_hz(freq_hz);
    return true;
}

static uint32_t cc1101_compute_bitrate_bps(uint8_t drate_e, uint8_t drate_m)
{
    const uint32_t denom_shift = 28u - (uint32_t)(drate_e & 0x0Fu);
    const uint64_t denom = 1ULL << denom_shift;
    const uint64_t num = (uint64_t)(256u + (uint32_t)drate_m) * (uint64_t)CC1101_FOSC_HZ;
    return (uint32_t)((num + (denom / 2u)) / denom);
}

static bool cc1101_set_datarate(int bps)
{
    if (bps <= 0) {
        return false;
    }

    const uint32_t target = (uint32_t)bps;

    int best_m = 0;
    int best_e = 0;
    uint32_t best_error = 0xFFFFFFFFu;

    for (int e = 0; e <= 15; e++) {
        for (int m = 0; m <= 255; m++) {
            uint32_t bitrate = cc1101_compute_bitrate_bps((uint8_t)e, (uint8_t)m);
            uint32_t error = (bitrate >= target) ? (bitrate - target) : (target - bitrate);
            if (error < best_error) {
                best_error = (uint32_t)error;
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

    uint32_t freq_hz = cc1101_get_frequency_hz();
    const uint8_t *power_table = NULL;
    if (freq_hz >= 300000000u && freq_hz <= 348000000u) {
        power_table = power_315;
    } else if (freq_hz >= 378000000u && freq_hz <= 464000000u) {
        power_table = power_433;
    } else if (freq_hz >= 779000000u && freq_hz <= 899990000u) {
        power_table = power_868;
    } else if (freq_hz >= 900000000u && freq_hz <= 928000000u) {
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

static void cc1101_cmd_init(int miso, int mosi, int sck, int cs)
{
    (void)miso;
    (void)mosi;
    (void)sck;
    (void)cs;
    // Always active-low on STM32 builds.
    cc1101_deselect();
    HAL_Delay(1);
    cc1101_apply_defaults();

    cc1101_initialized = true;
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_probe(void)
{
    uint8_t out[4] = {0};
    out[0] = (uint8_t)HAL_GPIO_ReadPin(CC1101_MISO_GPIO_Port, CC1101_MISO_Pin);
    cc1101_select();
    HAL_Delay(1);
    out[1] = (uint8_t)HAL_GPIO_ReadPin(CC1101_MISO_GPIO_Port, CC1101_MISO_Pin);
    cc1101_deselect();
    out[2] = cc1101_read_reg(0x30); // PARTNUM
    out[3] = cc1101_read_reg(0x31); // VERSION
    command_send_ok(out, sizeof(out));
}

static void cc1101_cmd_status(void)
{
    uint8_t out = cc1101_initialized ? 1 : 0;
    command_send_ok(&out, 1);
}

static void cc1101_cmd_write_reg(int reg, int val)
{
    if (!cc1101_initialized) {
        command_send_err(NULL);
        return;
    }
    if (reg < 0 || reg > 0x3F) {
        command_send_err(NULL);
        return;
    }

    cc1101_write_reg((uint8_t)reg, (uint8_t)val);
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_read_reg(int reg)
{
    if (reg < 0 || reg > 0x3F) {
        command_send_err(NULL);
        return;
    }

    uint8_t value = cc1101_read_reg((uint8_t)reg);
    command_send_ok(&value, 1);
}

static void cc1101_cmd_strobe(int cmd)
{
    if (!cc1101_initialized) {
        command_send_err(NULL);
        return;
    }
    if (cmd < 0 || cmd > 0x3D) {
        command_send_err(NULL);
        return;
    }
    cc1101_strobe((uint8_t)cmd);
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_read_burst(int reg, int len)
{
    if (reg < 0 || reg > 0x3F) {
        command_send_err(NULL);
        return;
    }
    if (len <= 0 || len > CLI_VALUE_MAX) {
        command_send_err(NULL);
        return;
    }

    uint8_t out[CLI_VALUE_MAX] = {0};
    cc1101_read_burst((uint8_t)reg, out, (size_t)len);
    command_send_ok(out, (size_t)len);
}

static void cc1101_cmd_write_burst(int reg, const command_hex_arg_t *data)
{
    if (!cc1101_initialized) {
        command_send_err(NULL);
        return;
    }
    if (reg < 0 || reg > 0x3F) {
        command_send_err(NULL);
        return;
    }
    if (!data || data->length == 0) {
        command_send_err(NULL);
        return;
    }
    if (data->length > CLI_VALUE_MAX) {
        command_send_err(NULL);
        return;
    }

    cc1101_write_burst((uint8_t)reg, data->data, data->length);
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_apply_defaults(void)
{
    if (!cc1101_initialized) {
        command_send_err(NULL);
        return;
    }
    cc1101_apply_defaults();
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_set_freq(const char *freq_str)
{
    if (!cc1101_initialized) {
        command_send_err(NULL);
        return;
    }
    if (!freq_str || freq_str[0] == '\0') {
        command_send_err(NULL);
        return;
    }

    uint32_t freq_hz = 0;
    if (!cc1101_parse_mhz_string_to_hz(freq_str, &freq_hz)) {
        command_send_err(NULL);
        return;
    }
    if (!cc1101_set_frequency_hz(freq_hz)) {
        command_send_err(NULL);
        return;
    }
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_get_freq(void)
{
    if (!cc1101_initialized) {
        command_send_err(NULL);
        return;
    }
    uint32_t freq_hz = cc1101_get_frequency_hz();
    uint32_t mhz_int = freq_hz / 1000000u;
    uint32_t mhz_frac = freq_hz % 1000000u;
    char buf[32];
    size_t pos = 0;
    pos += cc1101_u32_to_dec(&buf[pos], sizeof(buf) - pos, mhz_int);
    if (pos + 1 < sizeof(buf)) {
        buf[pos++] = '.';
        buf[pos] = '\0';
    }
    pos = cc1101_append_fixed_6(buf, sizeof(buf), pos, mhz_frac);
    command_send_ok((const uint8_t *)buf, pos);
}

static void cc1101_cmd_set_datarate(int bps)
{
    if (!cc1101_initialized) {
        command_send_err(NULL);
        return;
    }
    if (!cc1101_set_datarate(bps)) {
        command_send_err(NULL);
        return;
    }
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_get_datarate(void)
{
    if (!cc1101_initialized) {
        command_send_err(NULL);
        return;
    }

    uint8_t mdmcfg4 = cc1101_read_reg(CC1101_REG_MDMCFG4);
    uint8_t mdmcfg3 = cc1101_read_reg(CC1101_REG_MDMCFG3);
    int drate_e = mdmcfg4 & 0x0F;
    int drate_m = mdmcfg3 & 0xFF;
    uint32_t bitrate = cc1101_compute_bitrate_bps((uint8_t)drate_e, (uint8_t)drate_m);

    char buf[32];
    size_t len = cc1101_u32_to_dec(buf, sizeof(buf), bitrate);
    command_send_ok((const uint8_t *)buf, len);
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
    if (!cc1101_initialized) {
        command_send_err(NULL);
        return;
    }
    int mod = cc1101_parse_modulation(mod_str);
    if (mod < 0) {
        command_send_err(NULL);
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
    if (!cc1101_initialized) {
        command_send_err(NULL);
        return;
    }
    uint8_t mdmcfg2 = cc1101_read_reg(CC1101_REG_MDMCFG2);
    uint8_t mod = (uint8_t)((mdmcfg2 >> 4) & 0x07);
    command_send_ok(&mod, 1);
}

static void cc1101_cmd_set_mod_power(int modulation, int dbm)
{
    if (!cc1101_initialized) {
        command_send_err(NULL);
        return;
    }
    if (modulation < 0 || modulation > 7) {
        command_send_err(NULL);
        return;
    }
    if (!cc1101_set_modulation_and_power(modulation, dbm)) {
        command_send_err(NULL);
        return;
    }
    command_send_ok(NULL, 0);
}

static void cc1101_cmd_set_gdo(const command_hex_arg_t *data)
{
    if (!cc1101_initialized) {
        command_send_err(NULL);
        return;
    }
    if (!data || data->length < 3) {
        command_send_err(NULL);
        return;
    }
    cc1101_set_gdo(data->data[0], data->data[1], data->data[2]);
    command_send_ok(NULL, 0);
}

void cc1101_register_commands(void)
{
    static const cmd_arg_spec_t init_args[] = {
        {.name = "miso", .type = CMD_ARG_INT, .required = false},
        {.name = "mosi", .type = CMD_ARG_INT, .required = false},
        {.name = "sck", .type = CMD_ARG_INT, .required = false},
        {.name = "cs", .type = CMD_ARG_INT, .required = false},
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const cmd_arg_spec_t write_args[] = {
        {.name = "reg", .type = CMD_ARG_INT, .required = true},
        {.name = "val", .type = CMD_ARG_INT, .required = true},
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const cmd_arg_spec_t read_args[] = {
        {.name = "reg", .type = CMD_ARG_INT, .required = true},
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const cmd_arg_spec_t strobe_args[] = {
        {.name = "cmd", .type = CMD_ARG_INT, .required = true},
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const cmd_arg_spec_t read_burst_args[] = {
        {.name = "reg", .type = CMD_ARG_INT, .required = true},
        {.name = "len", .type = CMD_ARG_INT, .required = true},
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const cmd_arg_spec_t write_burst_args[] = {
        {.name = "reg", .type = CMD_ARG_INT, .required = true},
        {.name = "data", .type = CMD_ARG_HEX, .required = true},
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const cmd_arg_spec_t set_freq_args[] = {
        {.name = "mhz", .type = CMD_ARG_STRING, .required = true},
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const cmd_arg_spec_t set_datarate_args[] = {
        {.name = "bps", .type = CMD_ARG_INT, .required = true},
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const cmd_arg_spec_t set_mod_args[] = {
        {.name = "mod", .type = CMD_ARG_STRING, .required = true},
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const cmd_arg_spec_t set_mod_power_args[] = {
        {.name = "mod", .type = CMD_ARG_INT, .required = true},
        {.name = "dbm", .type = CMD_ARG_INT, .required = true},
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const cmd_arg_spec_t set_gdo_args[] = {
        {.name = "data", .type = CMD_ARG_HEX, .required = true},
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const command_entry_t cc1101_command_table[] = {
        {.verb = "cc1101 init", .args = init_args, .handler = (void *)cc1101_cmd_init},
        {.verb = "cc1101 probe", .args = NULL, .handler = (void *)cc1101_cmd_probe},
        {.verb = "cc1101 status", .args = NULL, .handler = (void *)cc1101_cmd_status},
        {.verb = "cc1101 write", .args = write_args, .handler = (void *)cc1101_cmd_write_reg},
        {.verb = "cc1101 read", .args = read_args, .handler = (void *)cc1101_cmd_read_reg},
        {.verb = "cc1101 strobe", .args = strobe_args, .handler = (void *)cc1101_cmd_strobe},
        {.verb = "cc1101 read_burst", .args = read_burst_args, .handler = (void *)cc1101_cmd_read_burst},
        {.verb = "cc1101 write_burst", .args = write_burst_args, .handler = (void *)cc1101_cmd_write_burst},
        {.verb = "cc1101 apply_defaults", .args = NULL, .handler = (void *)cc1101_cmd_apply_defaults},
        {.verb = "cc1101 set_freq", .args = set_freq_args, .handler = (void *)cc1101_cmd_set_freq},
        {.verb = "cc1101 get_freq", .args = NULL, .handler = (void *)cc1101_cmd_get_freq},
        {.verb = "cc1101 set_datarate", .args = set_datarate_args, .handler = (void *)cc1101_cmd_set_datarate},
        {.verb = "cc1101 get_datarate", .args = NULL, .handler = (void *)cc1101_cmd_get_datarate},
        {.verb = "cc1101 set_mod", .args = set_mod_args, .handler = (void *)cc1101_cmd_set_mod},
        {.verb = "cc1101 get_mod", .args = NULL, .handler = (void *)cc1101_cmd_get_mod},
        {.verb = "cc1101 set_mod_power", .args = set_mod_power_args, .handler = (void *)cc1101_cmd_set_mod_power},
        {.verb = "cc1101 set_gdo", .args = set_gdo_args, .handler = (void *)cc1101_cmd_set_gdo},
    };

    (void)command_registry_add_table(cc1101_command_table,
                                    sizeof(cc1101_command_table) / sizeof(cc1101_command_table[0]));
}
