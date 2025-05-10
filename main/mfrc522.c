#include <string.h>
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_check.h"
#include "driver/spi_master.h"
#include "driver/gpio.h"
#include "mfrc522.h"

static const char *TAG = "MFRC522";

// Define SPI clock frequency (e.g., 5 MHz)
// Max for MFRC522 is 10 MHz
#define SPI_CLOCK_HZ 5000000

// Static pointer to hold the configuration
static mfrc522_config_t* _config = NULL;

// --- Low-level SPI communication --- 

void mfrc522_write_reg(u_char addr, u_char val)
{
    esp_err_t ret;
    u_char tx_data[2];

    if (!_config || !_config->spi_device) {
        ESP_LOGE(TAG, "SPI device not initialized");
        return;
    }

    // Address format: 0XXXXXX0 (write)
    tx_data[0] = (addr << 1) & 0x7E;
    tx_data[1] = val;

    spi_transaction_t t;
    memset(&t, 0, sizeof(t));
    t.length = 16; // 2 bytes
    t.tx_buffer = tx_data;
    t.user = (void*)0; // DC line not used

    // Assert CS
    gpio_set_level(_config->sda_io, 0);

    // Use polling transmit for simplicity in this driver
    ret = spi_device_polling_transmit(_config->spi_device, &t);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "SPI polling transmit failed: %s", esp_err_to_name(ret));
    }

    // De-assert CS
    gpio_set_level(_config->sda_io, 1);

    // Add a small delay required by MFRC522
    // ets_delay_us(50); // Consider if needed based on datasheet/testing
}

u_char mfrc522_read_reg(u_char addr)
{
    esp_err_t ret;
    u_char tx_byte;
    u_char rx_byte = 0;

    if (!_config || !_config->spi_device) {
        ESP_LOGE(TAG, "SPI device not initialized");
        return 0;
    }

    // Address format: 1XXXXXX0 (read)
    tx_byte = ((addr << 1) & 0x7E) | 0x80;

    spi_transaction_t t;
    memset(&t, 0, sizeof(t));
    t.length = 8;
    t.tx_buffer = &tx_byte;
    t.rxlength = 8;
    t.rx_buffer = &rx_byte; 
    t.user = (void*)0;

    // Assert CS
    gpio_set_level(_config->sda_io, 0);

    // Transmit address byte
    ret = spi_device_polling_transmit(_config->spi_device, &t);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "SPI read (addr tx) failed: %s", esp_err_to_name(ret));
        gpio_set_level(_config->sda_io, 1); // De-assert CS on error
        return 0;
    }

    // Receive data byte (send dummy 0x00)
    tx_byte = 0x00; // Dummy byte for read
    memset(&t, 0, sizeof(t)); // Reset transaction struct
    t.length = 8;
    t.tx_buffer = &tx_byte;
    t.rxlength = 8;
    t.rx_buffer = &rx_byte;
    t.user = (void*)0;
    
    ret = spi_device_polling_transmit(_config->spi_device, &t); 
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "SPI read (data rx) failed: %s", esp_err_to_name(ret));
        rx_byte = 0; // Indicate error
    }

    // De-assert CS
    gpio_set_level(_config->sda_io, 1);

    // Add a small delay required by MFRC522
    // ets_delay_us(50); // Consider if needed

    return rx_byte;
}

void mfrc522_set_bit_mask(u_char reg, u_char mask)
{
    u_char tmp = mfrc522_read_reg(reg);
    mfrc522_write_reg(reg, tmp | mask);
}

void mfrc522_clear_bit_mask(u_char reg, u_char mask)
{
    u_char tmp = mfrc522_read_reg(reg);
    mfrc522_write_reg(reg, tmp & (~mask));
}

// --- Antenna Control --- 

void mfrc522_antenna_on(void)
{
    u_char temp = mfrc522_read_reg(TxControlReg);
    if (!(temp & 0x03)) {
        mfrc522_set_bit_mask(TxControlReg, 0x03);
    }
}

void mfrc522_antenna_off(void)
{
    mfrc522_clear_bit_mask(TxControlReg, 0x03);
}

// --- Reset --- 

void mfrc522_reset()
{
    mfrc522_write_reg(CommandReg, PCD_RESETPHASE);
    // The datasheet specifies a delay of 50 ms after reset
    vTaskDelay(pdMS_TO_TICKS(50));
}

// --- Initialization and Deinitialization --- 

esp_err_t mfrc522_init(mfrc522_config_t* config)
{
    ESP_LOGI(TAG, "Initializing MFRC522...");
    esp_err_t ret;

    if (!config) {
        return ESP_ERR_INVALID_ARG;
    }
    _config = config;

    // --- Configure GPIO pins ---
    // RST Pin (optional)
    if (_config->rst_io >= 0) {
        gpio_reset_pin(_config->rst_io);
        gpio_set_direction(_config->rst_io, GPIO_MODE_OUTPUT);
        gpio_set_level(_config->rst_io, 1); // Keep RST high initially
        ESP_LOGI(TAG, "RST pin configured: %d", _config->rst_io);
    }

    // SDA/CS Pin (required)
    gpio_reset_pin(_config->sda_io);
    gpio_set_direction(_config->sda_io, GPIO_MODE_OUTPUT);
    gpio_set_level(_config->sda_io, 1); // Keep CS high initially (inactive)
    ESP_LOGI(TAG, "SDA(CS) pin configured: %d", _config->sda_io);

    // --- Initialize SPI Bus ---
    spi_bus_config_t buscfg = {
        .miso_io_num = _config->miso_io,
        .mosi_io_num = _config->mosi_io,
        .sclk_io_num = _config->sck_io,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 32 // Max needed is 18 bytes for write + 2 for CRC
    };

    // Initialize the SPI bus
    // Use SPI2_HOST or SPI3_HOST depending on ESP32 variant/pins
    ret = spi_bus_initialize(_config->host, &buscfg, SPI_DMA_CH_AUTO);
    if (ret != ESP_OK) {
        // Check if the bus is already initialized (happens if multiple devices share the bus)
        if (ret == ESP_ERR_INVALID_STATE) {
             ESP_LOGW(TAG, "SPI bus (host %d) already initialized.", _config->host);
        } else {
            ESP_LOGE(TAG, "SPI bus initialization failed: %s", esp_err_to_name(ret));
            return ret;
        }
    }
     ESP_LOGI(TAG, "SPI bus initialized (host %d).", _config->host);


    // --- Add MFRC522 SPI Device ---
    spi_device_interface_config_t devcfg = {
        .clock_speed_hz = SPI_CLOCK_HZ,
        .mode = 0, // SPI mode 0
        .spics_io_num = -1, // We manage CS manually
        .queue_size = 7,    // We need to be able to queue 7 transactions at a time
        //.pre_cb = spi_pre_transfer_callback, // Can add pre/post callbacks if needed
    };

    ret = spi_bus_add_device(_config->host, &devcfg, &_config->spi_device);
    ESP_GOTO_ON_ERROR(ret, err_spi_bus, TAG, "Failed to add SPI device: %s", esp_err_to_name(ret));
    ESP_LOGI(TAG, "SPI device added.");

    // --- Perform Hardware Reset (if RST pin is connected) ---
    if (_config->rst_io >= 0) {
        gpio_set_level(_config->rst_io, 0);
        vTaskDelay(pdMS_TO_TICKS(5)); // Min reset pulse width
        gpio_set_level(_config->rst_io, 1);
        vTaskDelay(pdMS_TO_TICKS(50)); // Wait for oscillator startup
         ESP_LOGI(TAG, "Hardware reset performed.");
    } else {
        // Perform software reset if hardware reset pin is not used
        mfrc522_reset();
         ESP_LOGI(TAG, "Software reset performed.");
    }

    // --- Configure MFRC522 Registers ---
    mfrc522_write_reg(TModeReg, 0x80);      // TAuto=1; timer starts automatically at the end of the transmission
    mfrc522_write_reg(TPrescalerReg, 0xA9); // TPreScaler = TModeReg[3..0]:TPrescalerReg, ie 0x0A9 = 169 => f_timer=40kHz, timeour is 64 * TPrescalerReg
    mfrc522_write_reg(TReloadRegL, 30);     // Reload timer value low: 30
    mfrc522_write_reg(TReloadRegH, 0);      // Reload timer value high: 0 => timeout is 25ms
    mfrc522_write_reg(TxAutoReg, 0x40);     // 100% ASK modulation

    // Add enhanced range settings
    // First put the chip in Idle mode
    mfrc522_write_reg(CommandReg, PCD_IDLE);

    // 1. Max out the receiver gain (48dB)
    mfrc522_write_reg(RFCfgReg, 0x70);  // RxGain = 0b111 (max)

    // 2. Increase transmitter power
    mfrc522_write_reg(CWGsPReg, 0x3F);   // p-driver conductance during carrier wave - max value
    mfrc522_write_reg(ModGsPReg, 0x3F);  // p-driver conductance during modulation - max value
    mfrc522_write_reg(GsNReg, 0xF0);     // n-driver settings (CW=0xF, Mod=0x0)

    // 3. Increase the timeout slightly for more reliable reads at distance
    mfrc522_write_reg(TReloadRegL, 0x50); // Increase timeout value
    mfrc522_write_reg(TReloadRegH, 0x00);

    // Continue with standard settings
    mfrc522_write_reg(ModeReg, 0x3D);       // CRC initial value 0x6363

    // Turn antenna on
    mfrc522_antenna_on();
    ESP_LOGI(TAG, "Antenna ON.");

    // Re-apply TxControlReg setting to ensure field is on after our changes
    mfrc522_write_reg(TxControlReg, 0x83); // Enable both TX drivers

    // Check version (optional but recommended)
    u_char version = mfrc522_read_reg(VersionReg);
    ESP_LOGI(TAG, "MFRC522 Version: 0x%02X", version);
     if ((version != 0x91) && (version != 0x92) && (version != 0x88)) {
         ESP_LOGW(TAG, "Warning: MFRC522 version mismatch! (Expected 0x91, 0x92 or 0x88)");
         // Continue anyway, might work
     }

    ESP_LOGI(TAG, "MFRC522 Initialized Successfully.");
    return ESP_OK;

err_spi_bus:
    spi_bus_free(_config->host);
    _config = NULL;
    return ret;
}

esp_err_t mfrc522_deinit(mfrc522_config_t* config)
{
    if (!config || !_config || config != _config) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!_config->spi_device) {
        return ESP_ERR_INVALID_STATE; // Not initialized
    }

    ESP_LOGI(TAG, "Deinitializing MFRC522...");

    mfrc522_antenna_off();

    // Remove SPI device
    esp_err_t ret = spi_bus_remove_device(_config->spi_device);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to remove SPI device: %s", esp_err_to_name(ret));
        // Continue deinitialization attempt
    }

    // Free SPI bus
    // Note: Only free the bus if no other devices are using it.
    // For simplicity here, we assume this is the only device.
    // In a real application, manage bus lifetime carefully.
    ret = spi_bus_free(_config->host);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to free SPI bus: %s", esp_err_to_name(ret));
    }

    // Reset GPIO pins (optional, good practice)
    if (_config->rst_io >= 0) {
        gpio_reset_pin(_config->rst_io);
    }
    gpio_reset_pin(_config->sda_io);

    _config->spi_device = NULL;
    _config = NULL;
    ESP_LOGI(TAG, "MFRC522 Deinitialized.");
    return ESP_OK;
}

// --- Communication with PICC --- 

u_char mfrc522_to_card(u_char command, u_char *sendData, u_char sendLen, u_char *backData, uint *backLen)
{
    u_char status = MI_ERR;
    u_char irqEn = 0x00;
    u_char waitIRq = 0x00;
    u_char lastBits;
    u_char n;
    int i;

    switch (command)
    {
        case PCD_AUTHENT:       // Authentication
            irqEn = 0x12;       // Allow ErrorReg[3..0] and IdleIRq
            waitIRq = 0x10;     // Wait for IdleIRq
            break;
        case PCD_TRANSCEIVE:    // Transmit and receive data
            irqEn = 0x77;       // Allow CRCIRq, TxIRq, RxIRq, IdleIRq, HiAlertIRq, LoAlertIRq, ErrIRq, TimerIRq
            waitIRq = 0x30;     // Wait for RxIRq and IdleIRq
            break;
        default:
            break;
    }

    mfrc522_write_reg(CommIEnReg, irqEn | 0x80);    // Enable interrupts, set reserved bit 7
    mfrc522_clear_bit_mask(CommIrqReg, 0x80);       // Clear all interrupt request bits
    mfrc522_set_bit_mask(FIFOLevelReg, 0x80);       // Flush FIFO buffer
    mfrc522_write_reg(CommandReg, PCD_IDLE);        // Cancel current command

    // Write data to FIFO
    for (i = 0; i < sendLen; i++) {
        mfrc522_write_reg(FIFODataReg, sendData[i]);
    }

    // Execute the command
    mfrc522_write_reg(CommandReg, command);
    if (command == PCD_TRANSCEIVE) {
        mfrc522_set_bit_mask(BitFramingReg, 0x80);   // Start transmission
    }

    // Wait for the command to complete
    // Max wait time is 25ms (defined in init)
    i = 200; // Timeout loop count (adjust based on task delay/clock)
    do {
        n = mfrc522_read_reg(CommIrqReg);
        i--;
        // Add a small delay to prevent busy-waiting hammering the SPI bus
        vTaskDelay(pdMS_TO_TICKS(1)); 
    }
    while ((i != 0) && !(n & 0x01) && !(n & waitIRq)); // Exit on TimerIRQ, waitIRq, or timeout

    mfrc522_clear_bit_mask(BitFramingReg, 0x80);      // Stop transmission

    if (i != 0) { // If not timed out
        if (!(mfrc522_read_reg(ErrorReg) & 0x1B)) { // Check for errors (BufferOvfl, CollErr, ParityErr, ProtocolErr)
            status = MI_OK;
            if (n & 0x01) { // Timer interrupt triggered
                 // ESP_LOGW(TAG, "Timer interrupt triggered during ToCard"); // Optional logging
                 status = MI_ERR; // Or potentially MI_NOTAGERR depending on context? Original logic unclear.
            }
            if (n & irqEn & 0x01) { // Check TimerIRQ against enabled interrupts - original logic was `n & irqEn & 0x01` which seems specific
                 status = MI_NOTAGERR; // Tag timed out (likely)
            }

            if (command == PCD_TRANSCEIVE) {
                n = mfrc522_read_reg(FIFOLevelReg); // Number of bytes in FIFO
                lastBits = mfrc522_read_reg(ControlReg) & 0x07; // Number of valid bits in last byte
                if (lastBits != 0) {
                    *backLen = (n - 1) * 8 + lastBits; // Calculate total bits received
                } else {
                    *backLen = n * 8;
                }

                if (n == 0) n = 1;
                if (n > MAX_LEN) n = MAX_LEN;

                // Read data from FIFO
                for (i = 0; i < n; i++) {
                    backData[i] = mfrc522_read_reg(FIFODataReg);
                }
            }
        } else {
            ESP_LOGD(TAG, "MFRC522 error: 0x%02X", mfrc522_read_reg(ErrorReg));
            status = MI_ERR;
        }
    } else {
        ESP_LOGD(TAG, "MFRC522 command timed out (CommIrq: 0x%02X)", mfrc522_read_reg(CommIrqReg));
        status = MI_ERR; // Indicate timeout
    }

    // According to datasheet, clearing CollReg prevents subsequent collisions if enabled.
    // mfrc522_set_bit_mask(CollReg, 0x80); // If needed, but seems optional in examples

    return status;
}

u_char mfrc522_request(u_char reqMode, u_char *TagType)
{
    u_char status;
    uint backBits; // The received data bits

    mfrc522_write_reg(BitFramingReg, 0x07); // TxLastBists = BitFramingReg[2..0] ??? Check datasheet - 0x07 means 7 bits in last byte are valid? Usually 0x00 for REQA/WUPA

    TagType[0] = reqMode;
    status = mfrc522_to_card(PCD_TRANSCEIVE, TagType, 1, TagType, &backBits);

    // Response for REQA/WUPA is 16 bits (ATQA)
    if ((status != MI_OK) || (backBits != 0x10)) {
        status = MI_ERR;
    }

    return status;
}

u_char mfrc522_anticoll(u_char *serNum)
{
    u_char status;
    u_char i;
    u_char serNumCheck = 0;
    uint unLen;

    mfrc522_write_reg(BitFramingReg, 0x00);     // TxLastBists = 0

    serNum[0] = PICC_ANTICOLL; // Command for anticollision CL1
    serNum[1] = 0x20;          // Parameter: select all cards of cascade level 1
    status = mfrc522_to_card(PCD_TRANSCEIVE, serNum, 2, serNum, &unLen);

    if (status == MI_OK) {
        // Response is 5 bytes: 4 bytes UID + 1 byte BCC (Block Check Character/XOR checksum)
        if (unLen == 40) { // 5 bytes * 8 bits/byte
            // Check BCC
            for (i = 0; i < 4; i++) {
                serNumCheck ^= serNum[i];
            }
            if (serNumCheck != serNum[4]) { // Index 4 holds the BCC
                ESP_LOGW(TAG, "Anticoll BCC check failed: calculated 0x%02X, received 0x%02X", serNumCheck, serNum[4]);
                status = MI_ERR;
            }
        } else {
             ESP_LOGW(TAG, "Anticoll received unexpected length: %lu bits", (unsigned long)unLen);
            status = MI_ERR;
        }
    }

    return status;
}

u_char mfrc522_select_tag(u_char *serNum)
{
    u_char i;
    u_char status;
    u_char size = 0;
    uint recvBits;
    u_char buffer[9];

    buffer[0] = PICC_SElECTTAG; // Command for Select CL1 (or PICC_ANTICOLL_2/3 for others)
    buffer[1] = 0x70;           // Parameter: NVB (Number of Valid Bits) = 7 bytes * 8 bits = 56 = 0x70
    // Bytes 2-6: UID + BCC (5 bytes total)
    for (i = 0; i < 5; i++) {
        buffer[i + 2] = serNum[i];
    }
    mfrc522_calculate_crc(buffer, 7, &buffer[7]); // Calculate CRC_A for the 7 bytes (CMD+NVB+UID+BCC)

    status = mfrc522_to_card(PCD_TRANSCEIVE, buffer, 9, buffer, &recvBits);

    // Response is SAK (Select Acknowledge) - 1 byte (8 bits) + CRC_A (2 bytes) = 24 bits total
    if ((status == MI_OK) && (recvBits == 0x18)) {
        size = buffer[0]; // The first byte is the SAK
        // Optional: Verify CRC of SAK response here if needed
        ESP_LOGD(TAG, "SAK received: 0x%02X", size);
    } else {
         if (status == MI_OK) {
            ESP_LOGW(TAG, "SelectTag received unexpected length: %lu bits (expected 24)", (unsigned long)recvBits);
         } else {
             ESP_LOGW(TAG, "SelectTag failed with status: %d", status);
         }
         size = 0;
    }

    return size;
}

u_char mfrc522_auth(u_char authMode, u_char blockAddr, u_char *sectorKey, u_char *serNum)
{
    u_char status;
    uint recvBits; // Not actually used in this command according to datasheet/examples
    u_char i;
    u_char buff[12];

    // Format command buffer:
    buff[0] = authMode;         // AUTHENT1A or AUTHENT1B
    buff[1] = blockAddr;        // Block address to authenticate
    for (i = 0; i < 6; i++) {   // 6 bytes Key A/B
        buff[i + 2] = sectorKey[i];
    }
    for (i = 0; i < 4; i++) {   // 4 bytes UID
        buff[i + 8] = serNum[i];
    }

    status = mfrc522_to_card(PCD_AUTHENT, buff, 12, buff, &recvBits); // Send command

    // Check Status2Reg[3] (MFCrypto1On bit) to confirm authentication success
    if ((status != MI_OK) || !(mfrc522_read_reg(Status2Reg) & 0x08)) {
        ESP_LOGW(TAG, "Authentication failed. Status: %d, Status2Reg: 0x%02X", status, mfrc522_read_reg(Status2Reg));
        status = MI_ERR;
    }

    return status;
}

u_char mfrc522_read(u_char blockAddr, u_char *recvData)
{
    u_char status;
    uint unLen;
    u_char buff[4];

    buff[0] = PICC_READ;
    buff[1] = blockAddr;
    mfrc522_calculate_crc(buff, 2, &buff[2]); // Calculate CRC for command+address

    // Send READ command
    status = mfrc522_to_card(PCD_TRANSCEIVE, buff, 4, recvData, &unLen);

    // Response is 16 data bytes + 2 CRC bytes = 18 bytes = 144 bits
    if ((status != MI_OK) || (unLen != 144)) {
         if (status == MI_OK) {
             ESP_LOGW(TAG, "Read received unexpected length: %lu bits (expected 144)", (unsigned long)unLen);
         } else {
            ESP_LOGW(TAG, "Read command failed with status: %d", status);
         }
        status = MI_ERR;
    }
    // CRC check of received data can be added here if needed

    return status;
}

u_char mfrc522_write(u_char blockAddr, u_char *writeData)
{
    u_char status;
    uint recvBits;
    u_char buff[18]; // Buffer for command+CRC, then data+CRC

    // --- Step 1: Send WRITE command --- 
    buff[0] = PICC_WRITE;
    buff[1] = blockAddr;
    mfrc522_calculate_crc(buff, 2, &buff[2]);
    status = mfrc522_to_card(PCD_TRANSCEIVE, buff, 4, buff, &recvBits);

    // The card should respond with an ACK (4 bits) or NACK
    // Original code checked `(recvBits != 4) || ((buff[0] & 0x0F) != 0x0A))`
    // 0x0A is ACK (Acknowledge). Check datasheet for exact ACK/NACK values.
    // A simple check for MI_OK and 4 bits might suffice if ACK/NACK distinction isn't critical
    if ((status != MI_OK) || (recvBits != 4) || ((buff[0] & 0x0F) != 0x0A) ) { 
        ESP_LOGW(TAG, "Write step 1 (send command) failed. Status: %d, RecvBits: %lu, Resp: 0x%02X", status, (unsigned long)recvBits, buff[0]);
        status = MI_ERR;
    }

    // --- Step 2: Send data block if WRITE command was acknowledged --- 
    if (status == MI_OK) {
        // Prepare data buffer: 16 bytes data + 2 bytes CRC
        memcpy(buff, writeData, 16);
        mfrc522_calculate_crc(buff, 16, &buff[16]);
        status = mfrc522_to_card(PCD_TRANSCEIVE, buff, 18, buff, &recvBits);

        // Card should respond with ACK again
         if ((status != MI_OK) || (recvBits != 4) || ((buff[0] & 0x0F) != 0x0A) ) { 
            ESP_LOGW(TAG, "Write step 2 (send data) failed. Status: %d, RecvBits: %lu, Resp: 0x%02X", status, (unsigned long)recvBits, buff[0]);
            status = MI_ERR;
        }
         if (status == MI_OK) {
            ESP_LOGD(TAG, "Write block %d successful.", blockAddr);
         }
    }

    return status;
}

void mfrc522_halt()
{
    uint unLen;
    u_char buff[4];

    buff[0] = PICC_HALT;
    buff[1] = 0; // Parameter is 0
    mfrc522_calculate_crc(buff, 2, &buff[2]);

    // No response expected for HALT command
    mfrc522_to_card(PCD_TRANSCEIVE, buff, 4, buff, &unLen);
    // Ignore status, halt command might not get a reply
}

void mfrc522_calculate_crc(u_char *pIndata, u_char len, u_char *pOutData)
{
    u_char i, n;

    mfrc522_clear_bit_mask(DivIrqReg, 0x04);         // Clear CRCIRq interrupt request bit
    mfrc522_set_bit_mask(FIFOLevelReg, 0x80);       // Flush FIFO buffer
    // mfrc522_write_reg(CommandReg, PCD_IDLE);      // Stop any active command.

    // Write data to the FIFO
    for (i = 0; i < len; i++) {
        mfrc522_write_reg(FIFODataReg, pIndata[i]);
    }
    mfrc522_write_reg(CommandReg, PCD_CALCCRC);     // Start CRC calculation

    // Wait for CRC calculation to complete
    i = 0xFF; // Timeout loop count (adjust if needed)
    do {
        n = mfrc522_read_reg(DivIrqReg);
        i--;
    } while ((i != 0) && !(n & 0x04)); // Wait for CRCIRq = 1

    if (i == 0) {
        ESP_LOGE(TAG, "CRC calculation timed out!");
        // Handle error, maybe return default values or set an error flag
        pOutData[0] = 0; 
        pOutData[1] = 0;
        return;
    }
    mfrc522_write_reg(CommandReg, PCD_IDLE); // Stop calculating CRC? Maybe optional.

    // Read CRC calculation result
    pOutData[0] = mfrc522_read_reg(CRCResultRegL); // LSB
    pOutData[1] = mfrc522_read_reg(CRCResultRegM); // MSB
}

void mfrc522_stop_crypto1()
{
    // Clear MFCrypto1On bit in Status2Reg
    mfrc522_clear_bit_mask(Status2Reg, 0x08);
} 