#ifndef MFRC522_H_
#define MFRC522_H_

#include <stdint.h>
#include <stdbool.h>
#include "driver/spi_master.h"
#include "driver/gpio.h"

// Define standard types if not already defined elsewhere
typedef uint8_t u_char;
typedef uint32_t uint;

// Maximum length of the array
#define MAX_LEN 16

// MF522 Command word
#define PCD_IDLE              0x00               // NO action; Cancel the current command
#define PCD_AUTHENT           0x0E               // Authentication Key
#define PCD_RECEIVE           0x08               // Receive Data
#define PCD_TRANSMIT          0x04               // Transmit data
#define PCD_TRANSCEIVE        0x0C               // Transmit and receive data,
#define PCD_RESETPHASE        0x0F               // Reset
#define PCD_CALCCRC           0x03               // CRC Calculate

// Mifare_One card command word
#define PICC_REQIDL           0x26               // find the antenna area does not enter hibernation
#define PICC_REQALL           0x52               // find all the cards antenna area
#define PICC_ANTICOLL         0x93               // anti-collision level 1
#define PICC_ANTICOLL_2       0x95               // anti-collision level 2
#define PICC_ANTICOLL_3       0x97               // anti-collision level 3
#define PICC_SElECTTAG        0x93               // election card
#define PICC_AUTHENT1A        0x60               // authentication key A
#define PICC_AUTHENT1B        0x61               // authentication key B
#define PICC_READ             0x30               // Read Block
#define PICC_WRITE            0xA0               // write block
#define PICC_DECREMENT        0xC0               // debit
#define PICC_INCREMENT        0xC1               // recharge
#define PICC_RESTORE          0xC2               // transfer block data to the buffer
#define PICC_TRANSFER         0xB0               // save the data in the buffer
#define PICC_HALT             0x50               // Sleep

// And MF522 The error code is returned when communication
#define MI_OK                 0
#define MI_NOTAGERR           1
#define MI_ERR                2

//------------------ MFRC522 Register---------------
// Page 0: Command and Status
#define     Reserved00            0x00
#define     CommandReg            0x01
#define     CommIEnReg            0x02
#define     DivlEnReg             0x03
#define     CommIrqReg            0x04
#define     DivIrqReg             0x05
#define     ErrorReg              0x06
#define     Status1Reg            0x07
#define     Status2Reg            0x08
#define     FIFODataReg           0x09
#define     FIFOLevelReg          0x0A
#define     WaterLevelReg         0x0B
#define     ControlReg            0x0C
#define     BitFramingReg         0x0D
#define     CollReg               0x0E
#define     Reserved01            0x0F
// Page 1: Command
#define     Reserved10            0x10
#define     ModeReg               0x11
#define     TxModeReg             0x12
#define     RxModeReg             0x13
#define     TxControlReg          0x14
#define     TxAutoReg             0x15
#define     TxSelReg              0x16
#define     RxSelReg              0x17
#define     RxThresholdReg        0x18
#define     DemodReg              0x19
#define     Reserved11            0x1A
#define     Reserved12            0x1B
#define     MifareReg             0x1C
#define     Reserved13            0x1D
#define     Reserved14            0x1E
#define     SerialSpeedReg        0x1F
// Page 2: CFG
#define     Reserved20            0x20
#define     CRCResultRegM         0x21
#define     CRCResultRegL         0x22
#define     Reserved21            0x23
#define     ModWidthReg           0x24
#define     Reserved22            0x25
#define     RFCfgReg              0x26
#define     GsNReg                0x27
#define     CWGsPReg              0x28
#define     ModGsPReg             0x29
#define     TModeReg              0x2A
#define     TPrescalerReg         0x2B
#define     TReloadRegH           0x2C
#define     TReloadRegL           0x2D
#define     TCounterValueRegH     0x2E
#define     TCounterValueRegL     0x2F
// Page 3: TestRegister
#define     Reserved30            0x30
#define     TestSel1Reg           0x31
#define     TestSel2Reg           0x32
#define     TestPinEnReg          0x33
#define     TestPinValueReg       0x34
#define     TestBusReg            0x35
#define     AutoTestReg           0x36
#define     VersionReg            0x37
#define     AnalogTestReg         0x38
#define     TestDAC1Reg           0x39
#define     TestDAC2Reg           0x3A
#define     TestADCReg            0x3B
#define     Reserved31            0x3C
#define     Reserved32            0x3D
#define     Reserved33            0x3E
#define     Reserved34            0x3F

//-----------------------------------------------

/**
 * @brief Structure for MFRC522 device configuration.
 */
typedef struct {
    spi_host_device_t host;         /*!< SPI host */
    gpio_num_t miso_io;             /*!< GPIO number for MISO */
    gpio_num_t mosi_io;             /*!< GPIO number for MOSI */
    gpio_num_t sck_io;              /*!< GPIO number for SCLK */
    gpio_num_t sda_io;              /*!< GPIO number for SDA/CS */
    gpio_num_t rst_io;              /*!< GPIO number for RST (use -1 if not connected) */
    spi_device_handle_t spi_device; /*!< Handle for the SPI device */
} mfrc522_config_t;

// Function definitions

/**
 * @brief Initialize the MFRC522 module.
 *
 * @param config Pointer to the configuration structure.
 * @return esp_err_t ESP_OK on success, or an error code otherwise.
 */
esp_err_t mfrc522_init(mfrc522_config_t *config);

/**
 * @brief Deinitialize the MFRC522 module and release resources.
 *
 * @param config Pointer to the configuration structure.
 * @return esp_err_t ESP_OK on success, or an error code otherwise.
 */
esp_err_t mfrc522_deinit(mfrc522_config_t *config);

/**
 * @brief Perform a soft reset of the MFRC522 chip.
 */
void mfrc522_reset();

/**
 * @brief Turns the antenna on.
 */
void mfrc522_antenna_on();

/**
 * @brief Turns the antenna off.
 */
void mfrc522_antenna_off();

/**
 * @brief Searches for PICCs (Proximity Integrated Circuit Cards).
 *
 * @param reqMode Request mode (PICC_REQIDL or PICC_REQALL).
 * @param TagType Pointer to a buffer where the card type will be stored (2 bytes).
 * @return Status code (MI_OK, MI_NOTAGERR, MI_ERR).
 */
u_char mfrc522_request(u_char reqMode, u_char *TagType);

/**
 * @brief Handles collisions in PICC detection. Reads the UID of a single PICC.
 *
 * @param serNum Pointer to a buffer where the serial number (UID) will be stored (5 bytes: 4 bytes UID + 1 byte checksum).
 * @return Status code (MI_OK, MI_ERR).
 */
u_char mfrc522_anticoll(u_char *serNum);

/**
 * @brief Selects a PICC based on its serial number.
 *
 * @param serNum Pointer to the 5-byte serial number (UID + checksum).
 * @return Card capacity (size code) or 0 if selection failed.
 */
u_char mfrc522_select_tag(u_char *serNum);

/**
 * @brief Authenticates a sector of a MIFARE Classic card.
 *
 * @param authMode Authentication mode (PICC_AUTHENT1A or PICC_AUTHENT1B).
 * @param blockAddr Address of the block within the sector to authenticate.
 * @param sectorKey Pointer to the 6-byte sector key.
 * @param serNum Pointer to the 4-byte card serial number (UID).
 * @return Status code (MI_OK, MI_ERR).
 */
u_char mfrc522_auth(u_char authMode, u_char blockAddr, u_char *sectorKey, u_char *serNum);

/**
 * @brief Reads a 16-byte block from a MIFARE Classic card.
 * Requires prior authentication for the sector containing the block.
 *
 * @param blockAddr Address of the block to read.
 * @param recvData Pointer to a buffer where the 16 bytes of data will be stored.
 * @return Status code (MI_OK, MI_ERR).
 */
u_char mfrc522_read(u_char blockAddr, u_char *recvData);

/**
 * @brief Writes a 16-byte block to a MIFARE Classic card.
 * Requires prior authentication for the sector containing the block.
 *
 * @param blockAddr Address of the block to write.
 * @param writeData Pointer to the 16 bytes of data to write.
 * @return Status code (MI_OK, MI_ERR).
 */
u_char mfrc522_write(u_char blockAddr, u_char *writeData);

/**
 * @brief Commands the selected PICC to halt (enter sleep mode).
 */
void mfrc522_halt();

/**
 * @brief Calculates the CRC_A for a buffer of data using the MFRC522.
 *
 * @param pIndata Pointer to the input data buffer.
 * @param len Length of the input data.
 * @param pOutData Pointer to a 2-byte buffer where the calculated CRC will be stored.
 */
void mfrc522_calculate_crc(u_char *pIndata, u_char len, u_char *pOutData);

/**
 * @brief Stops the MFRC522's internal Crypto1 unit (used for MIFARE Classic).
 */
void mfrc522_stop_crypto1();

/**
 * @brief Soft reset and reconfigure the MFRC522 without reinitializing SPI bus
 * 
 * This function performs a reset and reconfiguration of the MFRC522 chip
 * without attempting to initialize the SPI bus or add a new SPI device.
 * Use this when you need to refresh the MFRC522 state between operations.
 *
 * @return esp_err_t ESP_OK on success
 */
esp_err_t mfrc522_soft_reset(void);

/**
 * @brief Check if MFRC522 module is physically connected
 * 
 * @return true if connected, false otherwise
 */
bool mfrc522_is_connected(void);

/**
 * @brief Reads a single byte from an MFRC522 register.
 * (Internal helper function, exposed for potential advanced use)
 *
 * @param addr Register address.
 * @return Value read from the register.
 */
u_char mfrc522_read_reg(u_char addr);

/**
 * @brief Writes a single byte to an MFRC522 register.
 * (Internal helper function, exposed for potential advanced use)
 *
 * @param addr Register address.
 * @param val Value to write.
 */
void mfrc522_write_reg(u_char addr, u_char val);

/**
 * @brief Sets specific bits in an MFRC522 register.
 * (Internal helper function, exposed for potential advanced use)
 *
 * @param reg Register address.
 * @param mask Bitmask of bits to set.
 */
void mfrc522_set_bit_mask(u_char reg, u_char mask);

/**
 * @brief Clears specific bits in an MFRC522 register.
 * (Internal helper function, exposed for potential advanced use)
 *
 * @param reg Register address.
 * @param mask Bitmask of bits to clear.
 */
void mfrc522_clear_bit_mask(u_char reg, u_char mask);

/**
 * @brief Sends data to a PICC and receives the response.
 * (Internal helper function, exposed for potential advanced use)
 *
 * @param command MFRC522 command code (e.g., PCD_TRANSCEIVE).
 * @param sendData Pointer to the data buffer to send.
 * @param sendLen Length of the data to send.
 * @param backData Pointer to the buffer to store received data.
 * @param backLen Pointer to store the number of *bits* received.
 * @return Status code (MI_OK, MI_NOTAGERR, MI_ERR).
 */
u_char mfrc522_to_card(u_char command, u_char *sendData, u_char sendLen, u_char *backData, uint *backLen);


#endif /* MFRC522_H_ */ 