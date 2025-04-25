#ifndef NRF24_H_
#define NRF24_H_

#include <stdint.h>
#include <stdbool.h>
#include "driver/spi_master.h"
#include "driver/gpio.h"
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// SPI Command defines
#define R_REGISTER          0x00
#define W_REGISTER          0x20
#define REGISTER_MASK       0x1F
#define ACTIVATE            0x50
#define R_RX_PL_WID         0x60
#define R_RX_PAYLOAD        0x61
#define W_TX_PAYLOAD        0xA0
#define W_TX_PAYLOAD_NOACK  0xB0
#define W_ACK_PAYLOAD       0xA8
#define FLUSH_TX            0xE1
#define FLUSH_RX            0xE2
#define REUSE_TX_PL         0xE3
#define NRF24_NOP           0xFF

// Register defines
#define REG_CONFIG          0x00
#define REG_EN_AA           0x01
#define REG_EN_RXADDR       0x02
#define REG_SETUP_AW        0x03
#define REG_SETUP_RETR      0x04
#define REG_RF_CH           0x05
#define REG_RF_SETUP        0x06
#define REG_STATUS          0x07
#define REG_OBSERVE_TX      0x08
#define REG_RPD             0x09 // Received Power Detector (Alias for NRF24L01)
#define REG_CD              0x09 // Carrier Detect (Alias for NRF24L01+)
#define REG_RX_ADDR_P0      0x0A
#define REG_RX_ADDR_P1      0x0B
#define REG_RX_ADDR_P2      0x0C
#define REG_RX_ADDR_P3      0x0D
#define REG_RX_ADDR_P4      0x0E
#define REG_RX_ADDR_P5      0x0F
#define REG_TX_ADDR         0x10
#define REG_RX_PW_P0        0x11
#define REG_RX_PW_P1        0x12
#define REG_RX_PW_P2        0x13
#define REG_RX_PW_P3        0x14
#define REG_RX_PW_P4        0x15
#define REG_RX_PW_P5        0x16
#define REG_FIFO_STATUS     0x17
#define REG_DYNPD           0x1C
#define REG_FEATURE         0x1D

// Status register bits
#define RX_DR               0x40 // Data Ready RX FIFO interrupt
#define TX_DS               0x20 // Data Sent TX FIFO interrupt
#define MAX_RT              0x10 // Maximum number of TX retransmits interrupt
#define RX_P_NO             0x0E // Data pipe number for the payload available
#define TX_FULL             0x01 // TX FIFO full flag

// Config register bits
#define MASK_RX_DR          0x40
#define MASK_TX_DS          0x20
#define MASK_MAX_RT         0x10
#define EN_CRC              0x08
#define CRCO                0x04 // CRC encoding scheme, 0=1 byte, 1=2 bytes
#define PWR_UP              0x02
#define PRIM_RX             0x01

// Feature register bits
#define EN_DPL              0x04 // Enable dynamic payload length
#define EN_ACK_PAY          0x02 // Enable payload with ACK
#define EN_DYN_ACK          0x01 // Enable W_TX_PAYLOAD_NOACK command

// RF Setup register bits
#define CONT_WAVE           0x80
#define RF_DR_LOW           0x20 // 250kbps data rate
#define PLL_LOCK            0x10
#define RF_DR_HIGH          0x08 // 2Mbps data rate
#define RF_PWR_LOW          0x02 // -6dBm
#define RF_PWR_HIGH         0x04 // 0dBm

// nRF24L01+ config structure
typedef struct {
    spi_host_device_t host;         // SPI host (SPI2_HOST, etc)
    gpio_num_t miso_io;             // MISO pin
    gpio_num_t mosi_io;             // MOSI pin
    gpio_num_t sck_io;              // SCK pin
    gpio_num_t csn_io;              // CSN (chip select, active low) - aka SS
    gpio_num_t ce_io;               // CE (chip enable)
    gpio_num_t irq_io;              // IRQ pin (optional, set to -1 if not used)
    spi_device_handle_t spi_device; // SPI device handle (initialized internally)
} nrf24_config_t;


// Constants
#define NRF24_SPI_TIMEOUT_MS 100
#define NRF24_MAX_PAYLOAD_SIZE 32

/* Low level API */

/**
 * @brief Initialize the nRF24L01+ driver.
 *        Configures GPIOs, initializes SPI bus/device.
 * @param config Pointer to the configuration structure.
 * @return esp_err_t ESP_OK on success, error code otherwise.
 */
esp_err_t nrf24_init(nrf24_config_t *config);

/**
 * @brief Deinitialize the nRF24L01+ driver.
 *        Releases SPI device and resets GPIOs.
 * @param config Pointer to the configuration structure.
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t nrf24_deinit(nrf24_config_t *config);

/**
 * @brief Write a single byte to an nRF24L01+ register.
 * @param config Pointer to the configuration structure.
 * @param reg The register address.
 * @param value The value to write.
 * @return uint8_t The status register value read during the transaction.
 */
uint8_t nrf24_write_reg(nrf24_config_t *config, uint8_t reg, uint8_t value);

/**
 * @brief Write multiple bytes to an nRF24L01+ register (e.g., addresses).
 * @param config Pointer to the configuration structure.
 * @param reg The register address.
 * @param buffer Pointer to the data buffer to write.
 * @param len The number of bytes to write.
 * @return uint8_t The status register value read during the transaction.
 */
uint8_t nrf24_write_buf(nrf24_config_t *config, uint8_t reg, const uint8_t *buffer, uint8_t len);

/**
 * @brief Read a single byte from an nRF24L01+ register.
 * @param config Pointer to the configuration structure.
 * @param reg The register address.
 * @param read_value Pointer to store the read value.
 * @return uint8_t The status register value read during the transaction.
 */
uint8_t nrf24_read_reg(nrf24_config_t *config, uint8_t reg, uint8_t *read_value);

/**
 * @brief Read multiple bytes from an nRF24L01+ register.
 * @param config Pointer to the configuration structure.
 * @param reg The register address.
 * @param buffer Pointer to the buffer to store the read data.
 * @param len The number of bytes to read.
 * @return uint8_t The status register value read during the transaction.
 */
uint8_t nrf24_read_buf(nrf24_config_t *config, uint8_t reg, uint8_t *buffer, uint8_t len);

/**
 * @brief Send a command strobe to the nRF24L01+.
 * @param config Pointer to the configuration structure.
 * @param cmd The command strobe (e.g., FLUSH_TX, FLUSH_RX).
 * @return uint8_t The status register value read during the transaction.
 */
uint8_t nrf24_cmd(nrf24_config_t *config, uint8_t cmd);


/* High level API */

/**
 * @brief Flush the transmit (TX) FIFO buffer.
 * @param config Pointer to the configuration structure.
 * @return uint8_t Status register value.
 */
uint8_t nrf24_flush_tx(nrf24_config_t *config);

/**
 * @brief Flush the receive (RX) FIFO buffer.
 * @param config Pointer to the configuration structure.
 * @return uint8_t Status register value.
 */
uint8_t nrf24_flush_rx(nrf24_config_t *config);

/**
 * @brief Get the configured static payload length for pipe 0.
 * @param config Pointer to the configuration structure.
 * @return uint8_t Payload length (0-32).
 */
uint8_t nrf24_get_payload_width_p0(nrf24_config_t *config);

/**
 * @brief Set the static payload length for pipe 0.
 * @param config Pointer to the configuration structure.
 * @param width Payload width (1-32).
 * @return uint8_t Status register value.
 */
uint8_t nrf24_set_payload_width_p0(nrf24_config_t *config, uint8_t width);

/**
 * @brief Get the configured MAC/address width.
 * @param config Pointer to the configuration structure.
 * @return uint8_t Address width in bytes (3, 4, or 5).
 */
uint8_t nrf24_get_address_width(nrf24_config_t *config);

/**
 * @brief Set the MAC/address width.
 * @param config Pointer to the configuration structure.
 * @param width Address width in bytes (3, 4, or 5).
 * @return uint8_t Status register value.
 */
uint8_t nrf24_set_address_width(nrf24_config_t *config, uint8_t width);

/**
 * @brief Get the status register value.
 * @param config Pointer to the configuration structure.
 * @return uint8_t Status register value.
 */
uint8_t nrf24_get_status(nrf24_config_t *config);

/**
 * @brief Get the configured RF data rate.
 * @param config Pointer to the configuration structure.
 * @return uint32_t Data rate in bps (250000, 1000000, or 2000000). Returns 0 on error.
 */
uint32_t nrf24_get_data_rate(nrf24_config_t *config);

/**
 * @brief Set the RF data rate.
 * @param config Pointer to the configuration structure.
 * @param rate Data rate in bps (250000, 1000000, or 2000000).
 * @return uint8_t Status register value.
 */
uint8_t nrf24_set_data_rate(nrf24_config_t *config, uint32_t rate);

/**
 * @brief Get the configured RF channel (0-125).
 * @param config Pointer to the configuration structure.
 * @return uint8_t RF channel (0-125).
 */
uint8_t nrf24_get_channel(nrf24_config_t *config);

/**
 * @brief Set the RF channel.
 * @param config Pointer to the configuration structure.
 * @param channel RF channel (0-125).
 * @return uint8_t Status register value.
 */
uint8_t nrf24_set_channel(nrf24_config_t *config, uint8_t channel);

/**
 * @brief Get the receive address for pipe 0.
 * @param config Pointer to the configuration structure.
 * @param address Buffer to store the address (must be large enough for the configured address width).
 * @return uint8_t Status register value.
 */
uint8_t nrf24_get_rx_address_p0(nrf24_config_t *config, uint8_t *address);

/**
 * @brief Set the receive address for pipe 0.
 * @param config Pointer to the configuration structure.
 * @param address Pointer to the address data.
 * @param width The width of the address (should match configured address width).
 * @return uint8_t Status register value.
 */
uint8_t nrf24_set_rx_address_p0(nrf24_config_t *config, const uint8_t *address, uint8_t width);

/**
 * @brief Get the transmit address.
 * @param config Pointer to the configuration structure.
 * @param address Buffer to store the address (must be large enough for the configured address width).
 * @return uint8_t Status register value.
 */
uint8_t nrf24_get_tx_address(nrf24_config_t *config, uint8_t *address);

/**
 * @brief Set the transmit address.
 * @param config Pointer to the configuration structure.
 * @param address Pointer to the address data.
 * @param width The width of the address (should match configured address width).
 * @return uint8_t Status register value.
 */
uint8_t nrf24_set_tx_address(nrf24_config_t *config, const uint8_t *address, uint8_t width);

/**
 * @brief Read a received packet from the RX FIFO.
 * @param config Pointer to the configuration structure.
 * @param payload Buffer to store the received payload.
 * @param payload_size Pointer to store the size of the received payload. Max size NRF24_MAX_PAYLOAD_SIZE.
 * @param use_static_width If true, uses the static payload width configured for pipe 0. If false, reads the dynamic payload width.
 * @return uint8_t Status register value. Check RX_DR bit to confirm successful reception.
 */
uint8_t nrf24_read_rx_payload(nrf24_config_t *config, uint8_t *payload, uint8_t *payload_size, bool use_static_width);

/**
 * @brief Write a packet to the TX FIFO for transmission.
 * @param config Pointer to the configuration structure.
 * @param payload Buffer containing the payload to send.
 * @param size Size of the payload (1-32).
 * @param use_ack If true, use W_TX_PAYLOAD command (requires ACK). If false, use W_TX_PAYLOAD_NOACK.
 * @return uint8_t Status register value.
 */
uint8_t nrf24_write_tx_payload(nrf24_config_t *config, const uint8_t *payload, uint8_t size, bool use_ack);

/**
 * @brief Power up the nRF24L01+. Call this before TX or RX operations.
 * @param config Pointer to the configuration structure.
 * @return uint8_t Status register value.
 */
uint8_t nrf24_power_up(nrf24_config_t *config);

/**
 * @brief Power down the nRF24L01+ to enter low-power idle mode.
 * @param config Pointer to the configuration structure.
 * @return uint8_t Status register value.
 */
uint8_t nrf24_power_down(nrf24_config_t *config); // Renamed from set_idle for clarity

/**
 * @brief Set the nRF24L01+ to primary receiver (RX) mode.
 * @param config Pointer to the configuration structure.
 * @return uint8_t Status register value.
 */
uint8_t nrf24_set_rx_mode(nrf24_config_t *config);

/**
 * @brief Set the nRF24L01+ to primary transmitter (TX) mode.
 * @param config Pointer to the configuration structure.
 * @return uint8_t Status register value.
 */
uint8_t nrf24_set_tx_mode(nrf24_config_t *config);


/**
 * @brief Configure the radio with common settings.
 * @param config Pointer to the configuration structure.
 * @param rate Data rate in bps (250000, 1000000, or 2000000).
 * @param rx_addr Receive address for pipe 0.
 * @param tx_addr Transmit address.
 * @param addr_width Address width (3, 4, or 5).
 * @param channel RF channel (0-125).
 * @param enable_ack Enable auto-acknowledgment (Enhanced ShockBurst).
 * @param enable_dyn_payload Enable dynamic payload length.
 */
void nrf24_configure(
    nrf24_config_t *config,
    uint32_t rate,
    const uint8_t *rx_addr,
    const uint8_t *tx_addr,
    uint8_t addr_width,
    uint8_t channel,
    bool enable_ack,
    bool enable_dyn_payload);

/**
 * @brief Configure the radio for promiscuous mode reception.
 *        Note: This relies on specific behavior and might not catch all packets perfectly.
 * @param config Pointer to the configuration structure.
 * @param channel RF channel (0-125).
 * @param rate Data rate in bps (250000, 1000000, or 2000000).
 */
void nrf24_init_promisc_mode(nrf24_config_t *config, uint8_t channel, uint32_t rate);

/**
 * @brief Attempt to sniff an address in promiscuous mode.
 *        Requires `nrf24_init_promisc_mode` to be called first.
 * @param config Pointer to the configuration structure.
 * @param addr_width Expected address width (3, 4, or 5).
 * @param address Buffer to store the sniffed address.
 * @return true if a potential address was received, false otherwise.
 */
bool nrf24_sniff_address(nrf24_config_t *config, uint8_t addr_width, uint8_t *address);

/**
 * @brief Scan channels to find one where a device with a specific TX address acknowledges a ping.
 * @param config Pointer to the configuration structure (will be modified during scan).
 * @param rx_addr Address to use for receiving the ACK (must match target's TX address).
 * @param tx_addr Address to transmit the ping to (must match target's RX address P0).
 * @param addr_width Address width (3, 4, or 5).
 * @param rate Data rate in bps (250000, 1000000, or 2000000).
 * @param min_channel Start channel for scanning.
 * @param max_channel End channel for scanning.
 * @param auto_reconfigure If true, reconfigure the radio to the found channel upon success.
 * @return The channel number (min_channel to max_channel) if found, or max_channel + 1 if not found.
 */
uint8_t nrf24_find_channel(
    nrf24_config_t *config,
    const uint8_t *rx_addr,
    const uint8_t *tx_addr,
    uint8_t addr_width,
    uint32_t rate,
    uint8_t min_channel,
    uint8_t max_channel,
    bool auto_reconfigure);


/* Utility Functions */

/**
 * @brief Convert a byte array to a hexadecimal string representation.
 * @param in Pointer to the input byte array.
 * @param size Number of bytes in the input array.
 * @param out Pointer to the output character buffer (must be at least size * 2 + 1 bytes).
 */
void hexlify(const uint8_t* in, uint8_t size, char* out);

/**
 * @brief Convert a byte array to a 64-bit integer.
 * @param bytes Pointer to the byte array.
 * @param size Number of bytes to convert (max 8).
 * @param big_endian True if bytes are in big-endian order, false for little-endian.
 * @return The resulting 64-bit integer.
 */
uint64_t bytes_to_int64(const uint8_t* bytes, uint8_t size, bool big_endian);

/**
 * @brief Convert a 64-bit integer to a byte array.
 * @param val The 64-bit integer value.
 * @param out Pointer to the output byte array (must be at least 8 bytes).
 * @param size Number of bytes to output (max 8).
 * @param big_endian True to output in big-endian order, false for little-endian.
 */
void int64_to_bytes(uint64_t val, uint8_t* out, uint8_t size, bool big_endian);

/**
 * @brief Convert a byte array to a 32-bit integer.
 * @param bytes Pointer to the byte array.
 * @param size Number of bytes to convert (max 4).
 * @param big_endian True if bytes are in big-endian order, false for little-endian.
 * @return The resulting 32-bit integer.
 */
uint32_t bytes_to_int32(const uint8_t* bytes, uint8_t size, bool big_endian);

/**
 * @brief Convert a 32-bit integer to a byte array.
 * @param val The 32-bit integer value.
 * @param out Pointer to the output byte array (must be at least 4 bytes).
 * @param size Number of bytes to output (max 4).
 * @param big_endian True to output in big-endian order, false for little-endian.
 */
void int32_to_bytes(uint32_t val, uint8_t* out, uint8_t size, bool big_endian);

/**
 * @brief Convert a byte array to a 16-bit integer.
 * @param bytes Pointer to the byte array.
 * @param size Number of bytes to convert (max 2).
 * @param big_endian True if bytes are in big-endian order, false for little-endian.
 * @return The resulting 16-bit integer.
 */
uint16_t bytes_to_int16(const uint8_t* bytes, uint8_t size, bool big_endian);

/**
 * @brief Convert a 16-bit integer to a byte array.
 * @param val The 16-bit integer value.
 * @param out Pointer to the output byte array (must be at least 2 bytes).
 * @param size Number of bytes to output (max 2).
 * @param big_endian True to output in big-endian order, false for little-endian.
 */
void int16_to_bytes(uint16_t val, uint8_t* out, uint8_t size, bool big_endian);

#ifdef __cplusplus
}
#endif

#endif // NRF24_H_ 