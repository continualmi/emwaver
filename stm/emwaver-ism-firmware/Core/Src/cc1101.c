#include "cc1101.h"

#include "main.h"

#include <stdbool.h>
#include <stdint.h>

extern SPI_HandleTypeDef hspi1;

#define CC1101_SPI_TIMEOUT_MS 20u
#define CC1101_BURST_MAX 64u

#ifndef CC1101_CS_GPIO_Port
#define CC1101_CS_GPIO_Port NSS_RFID_GPIO_Port
#endif
#ifndef CC1101_CS_Pin
#define CC1101_CS_Pin NSS_RFID_Pin
#endif

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

static bool cc1101_initialized = false;

static void cc1101_select(void)
{
    HAL_GPIO_WritePin(CC1101_CS_GPIO_Port, CC1101_CS_Pin, GPIO_PIN_RESET);
}

static void cc1101_deselect(void)
{
    HAL_GPIO_WritePin(CC1101_CS_GPIO_Port, CC1101_CS_Pin, GPIO_PIN_SET);
}

uint8_t cc1101_read_reg(uint8_t addr)
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

void cc1101_write_reg(uint8_t addr, uint8_t value)
{
    uint8_t tx[2] = {addr, value};
    cc1101_select();
    (void)HAL_SPI_Transmit(&hspi1, tx, 2, CC1101_SPI_TIMEOUT_MS);
    cc1101_deselect();
}

uint8_t cc1101_strobe(uint8_t cmd)
{
    uint8_t tx[1] = {cmd};
    uint8_t rx[1] = {0};
    cc1101_select();
    (void)HAL_SPI_TransmitReceive(&hspi1, tx, rx, 1, CC1101_SPI_TIMEOUT_MS);
    cc1101_deselect();
    return rx[0];
}

void cc1101_read_burst(uint8_t addr, uint8_t *out, size_t len)
{
    if (!out || len == 0) {
        return;
    }
    if (len > CC1101_BURST_MAX) {
        len = CC1101_BURST_MAX;
    }

    uint8_t cmd = (uint8_t)(addr | 0xC0);
    cc1101_select();
    HAL_StatusTypeDef st = HAL_SPI_Transmit(&hspi1, &cmd, 1, CC1101_SPI_TIMEOUT_MS);
    if (st == HAL_OK) {
        (void)HAL_SPI_Receive(&hspi1, out, (uint16_t)len, CC1101_SPI_TIMEOUT_MS);
    }
    cc1101_deselect();
}

uint8_t cc1101_write_burst(uint8_t addr, const uint8_t *data, size_t len)
{
    if (!data || len == 0) {
        return 0;
    }
    if (len > CC1101_BURST_MAX) {
        len = CC1101_BURST_MAX;
    }

    uint8_t cmd = (uint8_t)(addr | 0x40);
    uint8_t status = 0;
    cc1101_select();
    HAL_StatusTypeDef st = HAL_SPI_TransmitReceive(&hspi1, &cmd, &status, 1, CC1101_SPI_TIMEOUT_MS);
    if (st == HAL_OK) {
        (void)HAL_SPI_Transmit(&hspi1, (uint8_t *)data, (uint16_t)len, CC1101_SPI_TIMEOUT_MS);
    }
    cc1101_deselect();
    return status;
}

void cc1101_apply_defaults(void)
{
    cc1101_write_reg(CC1101_REG_FSCTRL1, 0x06);
    cc1101_write_reg(CC1101_REG_FSCTRL0, 0x00);
    cc1101_write_reg(CC1101_REG_FREQ2, 0x10);
    cc1101_write_reg(CC1101_REG_FREQ1, 0xA7);
    cc1101_write_reg(CC1101_REG_FREQ0, 0x62);
    cc1101_write_reg(CC1101_REG_MDMCFG4, 0xF5);
    cc1101_write_reg(CC1101_REG_MDMCFG3, 0x83);
    cc1101_write_reg(CC1101_REG_MDMCFG2, 0x13);
    cc1101_write_reg(CC1101_REG_MDMCFG1, 0x02);
    cc1101_write_reg(CC1101_REG_MDMCFG0, 0xF8);
    cc1101_write_reg(CC1101_REG_DEVIATN, 0x47);
    cc1101_write_reg(CC1101_REG_MCSM0, 0x18);
    cc1101_write_reg(CC1101_REG_FOCCFG, 0x16);
    cc1101_write_reg(CC1101_REG_BSCFG, 0x1C);
    cc1101_write_reg(CC1101_REG_AGCCTRL2, 0xC7);
    cc1101_write_reg(CC1101_REG_AGCCTRL1, 0x00);
    cc1101_write_reg(CC1101_REG_AGCCTRL0, 0xB2);
    cc1101_write_reg(CC1101_REG_FREND1, 0x56);
    cc1101_write_reg(CC1101_REG_FREND0, 0x10);
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
    cc1101_write_reg(CC1101_REG_PKTLEN, 0xFF);
}

void cc1101_init(void)
{
    cc1101_deselect();
    HAL_Delay(1);
    cc1101_apply_defaults();
    cc1101_initialized = true;
}

bool cc1101_is_initialized(void)
{
    return cc1101_initialized;
}

