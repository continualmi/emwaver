#include "cc1101.h"
#include "esp_log.h"
#include "driver/gpio.h"
#include <string.h>

static const char *TAG = "CC1101";
static spi_device_handle_t spi_dev_handle; // SPI device handle

// Initialize SPI for register operations
esp_err_t cc1101_init(void) {
    esp_err_t ret;
    
    // SPI bus configuration
    spi_bus_config_t buscfg = {
        .miso_io_num = PIN_NUM_MISO,
        .mosi_io_num = PIN_NUM_MOSI,
        .sclk_io_num = PIN_NUM_CLK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 32,
    };
    
    // SPI device configuration
    spi_device_interface_config_t devcfg = {
        .clock_speed_hz = 1000000,    // 1 MHz clock
        .mode = 0,                    // SPI mode 0
        .spics_io_num = -1,           // CS pin managed by GPIO
        .queue_size = 7,
    };
    
    // Initialize SPI bus
    ret = spi_bus_initialize(SPI2_HOST, &buscfg, SPI_DMA_CH_AUTO);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to initialize SPI bus: %d", ret);
        return ret;
    }
    
    // Add device to the SPI bus
    ret = spi_bus_add_device(SPI2_HOST, &devcfg, &spi_dev_handle);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to add SPI device: %d", ret);
        return ret;
    }
    
    // Configure CS pin as output and set it high initially
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << PIN_NUM_CS),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    gpio_config(&io_conf);
    gpio_set_level(PIN_NUM_CS, 1);
    
    return ESP_OK;
}

// Write a value to a register
void cc1101_write_reg(uint8_t addr, uint8_t value) {
    uint8_t tx_data[2] = {addr, value};
    
    // Pull CS low to start transaction
    gpio_set_level(PIN_NUM_CS, 0);
    
    // Send address and value
    spi_transaction_t t = {
        .length = 16,  // 2 bytes * 8 bits
        .tx_buffer = tx_data,
        .rx_buffer = NULL
    };
    spi_device_transmit(spi_dev_handle, &t);
    
    // Pull CS high to end transaction
    gpio_set_level(PIN_NUM_CS, 1);
}

// Read a value from a register
uint8_t cc1101_read_reg(uint8_t addr) {
    uint8_t rx_data[2];
    uint8_t tx_data[2] = {addr | 0x80, 0}; // Set read bit (MSB)
    
    // Pull CS low to start transaction
    gpio_set_level(PIN_NUM_CS, 0);
    
    // Send address and read data
    spi_transaction_t t = {
        .length = 16,  // 2 bytes * 8 bits
        .tx_buffer = tx_data,
        .rx_buffer = rx_data
    };
    spi_device_transmit(spi_dev_handle, &t);
    
    // Pull CS high to end transaction
    gpio_set_level(PIN_NUM_CS, 1);
    
    // Return the read value (second byte)
    return rx_data[1];
}

// Send a command strobe
uint8_t cc1101_strobe(uint8_t value) {
    uint8_t rx_data;
    
    // Pull CS low to start transaction
    gpio_set_level(PIN_NUM_CS, 0);
    
    // Send strobe command
    spi_transaction_t t = {
        .length = 8,  // 1 byte * 8 bits
        .tx_buffer = &value,
        .rx_buffer = &rx_data
    };
    spi_device_transmit(spi_dev_handle, &t);
    
    // Pull CS high to end transaction
    gpio_set_level(PIN_NUM_CS, 1);
    
    // Return the status byte
    return rx_data;
}

// Write multiple values to consecutive registers
uint8_t cc1101_write_burst_reg(uint8_t addr, uint8_t *buffer, uint8_t num) {
    uint8_t status;
    uint8_t *tx_data = malloc(num + 1);
    
    // Prepare data for burst write
    tx_data[0] = addr | WRITE_BURST;
    memcpy(&tx_data[1], buffer, num);
    
    // Pull CS low to start transaction
    gpio_set_level(PIN_NUM_CS, 0);
    
    // First transaction to get status
    spi_transaction_t t1 = {
        .length = 8,  // 1 byte * 8 bits
        .tx_buffer = tx_data,
        .rx_buffer = &status
    };
    spi_device_transmit(spi_dev_handle, &t1);
    
    // Second transaction to send data
    spi_transaction_t t2 = {
        .length = num * 8,  // num bytes * 8 bits
        .tx_buffer = &tx_data[1],
        .rx_buffer = NULL
    };
    spi_device_transmit(spi_dev_handle, &t2);
    
    // Pull CS high to end transaction
    gpio_set_level(PIN_NUM_CS, 1);
    
    // Free allocated memory
    free(tx_data);
    
    // Return the status byte
    return status;
}

// Read multiple values from consecutive registers
void cc1101_read_burst_reg(uint8_t addr, uint8_t *buffer, uint8_t num) {
    uint8_t cmd = addr | READ_BURST;
    
    // Pull CS low to start transaction
    gpio_set_level(PIN_NUM_CS, 0);
    
    // First transaction to send address
    spi_transaction_t t1 = {
        .length = 8,  // 1 byte * 8 bits
        .tx_buffer = &cmd,
        .rx_buffer = NULL
    };
    spi_device_transmit(spi_dev_handle, &t1);
    
    // Second transaction to read data
    spi_transaction_t t2 = {
        .length = num * 8,  // num bytes * 8 bits
        .tx_buffer = NULL,
        .rx_buffer = buffer
    };
    spi_device_transmit(spi_dev_handle, &t2);
    
    // Pull CS high to end transaction
    gpio_set_level(PIN_NUM_CS, 1);
} 