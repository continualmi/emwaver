#ifndef CC1101_H
#define CC1101_H

#include <stdint.h>
#include "esp_err.h"
#include "driver/spi_master.h"

// Register-related definitions
#define READ_BYTE       0x30
#define READ_BURST      0xC0  // Read burst
#define WRITE_BURST     0x40  // Write burst

// SPI pin definitions - update these with your ESP32's pin numbers
#define PIN_NUM_MISO 13
#define PIN_NUM_MOSI 11
#define PIN_NUM_CLK  12
#define PIN_NUM_CS   10

// CC1101 API
/**
 * @brief Initialize the SPI interface for CC1101
 * 
 * @return esp_err_t ESP_OK if successful
 */
esp_err_t cc1101_init(void);

/**
 * @brief Write a value to a CC1101 register
 * 
 * @param addr Register address
 * @param value Value to write
 */
void cc1101_write_reg(uint8_t addr, uint8_t value);

/**
 * @brief Read a value from a CC1101 register
 * 
 * @param addr Register address
 * @return uint8_t Value read from register
 */
uint8_t cc1101_read_reg(uint8_t addr);

/**
 * @brief Send a command strobe to CC1101
 * 
 * @param value Command value
 * @return uint8_t Status byte
 */
uint8_t cc1101_strobe(uint8_t value);

/**
 * @brief Write multiple values to consecutive CC1101 registers
 * 
 * @param addr Starting register address
 * @param buffer Data to write
 * @param num Number of bytes to write
 * @return uint8_t Status byte
 */
uint8_t cc1101_write_burst_reg(uint8_t addr, uint8_t *buffer, uint8_t num);

/**
 * @brief Read multiple values from consecutive CC1101 registers
 * 
 * @param addr Starting register address
 * @param buffer Buffer to store read values
 * @param num Number of bytes to read
 */
void cc1101_read_burst_reg(uint8_t addr, uint8_t *buffer, uint8_t num);

#endif /* CC1101_H */ 