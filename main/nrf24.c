#include "nrf24.h"
#include "esp_log.h"
#include "esp_check.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <string.h>
#include <stdio.h> // For snprintf
#include "driver/spi_common.h"
#include "driver/gpio.h"

static const char *TAG = "NRF24";

// Helper function for SPI transactions
static esp_err_t nrf24_spi_transfer(nrf24_config_t *config, uint8_t *tx_buffer, uint8_t *rx_buffer, size_t len) {
    if (!config || !config->spi_device) {
        ESP_LOGE(TAG, "SPI device not initialized");
        return ESP_ERR_INVALID_STATE;
    }

    spi_transaction_t t;
    memset(&t, 0, sizeof(t));
    t.length = len * 8; // length in bits
    t.tx_buffer = tx_buffer;
    t.rx_buffer = rx_buffer;

    // Acquire SPI bus - no need for explicit acquire/release if using polling transmit
    // esp_err_t ret = spi_device_acquire_bus(config->spi_device, portMAX_DELAY);
    // if (ret != ESP_OK) {
    //     ESP_LOGE(TAG, "Failed to acquire SPI bus: %s", esp_err_to_name(ret));
    //     return ret;
    // }

    gpio_set_level(config->csn_io, 0); // Assert CSN
    esp_err_t ret = spi_device_polling_transmit(config->spi_device, &t);
    gpio_set_level(config->csn_io, 1); // De-assert CSN

    // spi_device_release_bus(config->spi_device);

    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "SPI transaction failed: %s", esp_err_to_name(ret));
    }
    return ret;
}

// --- Initialization and Deinitialization ---

esp_err_t nrf24_init(nrf24_config_t *config) {
    ESP_LOGI(TAG, "Initializing nRF24L01+...");
    ESP_RETURN_ON_FALSE(config, ESP_ERR_INVALID_ARG, TAG, "Config cannot be NULL");
    ESP_RETURN_ON_FALSE(config->host == SPI2_HOST || config->host == SPI3_HOST, ESP_ERR_INVALID_ARG, TAG, "Invalid SPI host");

    // Configure CE pin
    gpio_config_t ce_gpio_conf = {
        .pin_bit_mask = (1ULL << config->ce_io),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    ESP_RETURN_ON_ERROR(gpio_config(&ce_gpio_conf), TAG, "Failed to configure CE pin");
    gpio_set_level(config->ce_io, 0); // Keep CE low initially

    // Configure CSN pin (handled by SPI driver if used as cs_io_num, but we manage manually)
    gpio_config_t csn_gpio_conf = {
        .pin_bit_mask = (1ULL << config->csn_io),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    ESP_RETURN_ON_ERROR(gpio_config(&csn_gpio_conf), TAG, "Failed to configure CSN pin");
    gpio_set_level(config->csn_io, 1); // Keep CSN high initially

    // Configure IRQ pin if used
    if (GPIO_IS_VALID_GPIO(config->irq_io)) {
        gpio_config_t irq_gpio_conf = {
            .pin_bit_mask = (1ULL << config->irq_io),
            .mode = GPIO_MODE_INPUT,
            .pull_up_en = GPIO_PULLUP_ENABLE, // Often requires pull-up
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE // Interrupt setup done separately if needed
        };
        ESP_RETURN_ON_ERROR(gpio_config(&irq_gpio_conf), TAG, "Failed to configure IRQ pin");
        ESP_LOGI(TAG, "IRQ pin %d configured", config->irq_io);
    } else {
        ESP_LOGI(TAG, "IRQ pin not configured");
    }

    // Initialize SPI device
    // Assumes the SPI bus (config->host) has already been initialized!
    // This is consistent with how CC1101 and MFRC522 are handled in main.c
    spi_device_interface_config_t devcfg = {
        .clock_speed_hz = SPI_MASTER_FREQ_8M, // 8 MHz clock speed, adjust as needed (max 10MHz for nRF24)
        .mode = 0,                             // SPI mode 0 (CPOL=0, CPHA=0)
        .spics_io_num = -1,                    // We control CSN manually
        .queue_size = 1,                       // Only one transaction in flight
        .flags = 0,
        .pre_cb = NULL,
        .post_cb = NULL
    };

    esp_err_t ret = spi_bus_add_device(config->host, &devcfg, &config->spi_device);
    ESP_RETURN_ON_ERROR(ret, TAG, "Failed to add SPI device");

    ESP_LOGI(TAG, "nRF24L01+ initialized on SPI%d, CSN=%d, CE=%d", config->host + 1, config->csn_io, config->ce_io);

    // Basic check - read status register
    vTaskDelay(pdMS_TO_TICKS(5)); // Allow radio startup time
    uint8_t status = nrf24_get_status(config);
    ESP_LOGI(TAG, "Initial status register: 0x%02X", status);

    // Recommended power on reset sequence steps
    nrf24_power_down(config);
    vTaskDelay(pdMS_TO_TICKS(100)); // Wait for power down
    nrf24_write_reg(config, REG_CONFIG, 0x08); // Default: CRC enabled (1 byte), power down, PTX
    nrf24_write_reg(config, REG_STATUS, RX_DR | TX_DS | MAX_RT); // Clear all IRQ flags
    nrf24_flush_rx(config);
    nrf24_flush_tx(config);

    ESP_LOGI(TAG, "nRF24L01+ basic configuration complete.");
    return ESP_OK;
}

esp_err_t nrf24_deinit(nrf24_config_t *config) {
    ESP_LOGI(TAG, "Deinitializing nRF24L01+...");
    if (!config || !config->spi_device) {
        return ESP_OK; // Already deinitialized or never initialized
    }

    // Remove SPI device
    esp_err_t ret = spi_bus_remove_device(config->spi_device);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to remove SPI device: %s", esp_err_to_name(ret));
        // Continue cleanup regardless
    }
    config->spi_device = NULL;

    // Reset GPIO pins
    gpio_reset_pin(config->ce_io);
    gpio_reset_pin(config->csn_io);
    if (GPIO_IS_VALID_GPIO(config->irq_io)) {
        gpio_reset_pin(config->irq_io);
    }

    ESP_LOGI(TAG, "nRF24L01+ deinitialized.");
    return ESP_OK;
}

// --- Low Level SPI API ---

uint8_t nrf24_write_reg(nrf24_config_t *config, uint8_t reg, uint8_t value) {
    uint8_t tx_buf[2] = {W_REGISTER | (REGISTER_MASK & reg), value};
    uint8_t rx_buf[2] = {0};
    esp_err_t ret = nrf24_spi_transfer(config, tx_buf, rx_buf, 2);
    if (ret != ESP_OK) return 0xFF; // Indicate error
    return rx_buf[0]; // Return status register
}

uint8_t nrf24_write_buf(nrf24_config_t *config, uint8_t reg, const uint8_t *buffer, uint8_t len) {
    if (len > 32) len = 32; // Max buffer size for most ops
    uint8_t tx_buf[33];
    uint8_t rx_buf[33];
    tx_buf[0] = W_REGISTER | (REGISTER_MASK & reg);
    memcpy(&tx_buf[1], buffer, len);
    memset(rx_buf, 0, len + 1);

    esp_err_t ret = nrf24_spi_transfer(config, tx_buf, rx_buf, len + 1);
    if (ret != ESP_OK) return 0xFF; // Indicate error
    return rx_buf[0]; // Return status register
}

uint8_t nrf24_read_reg(nrf24_config_t *config, uint8_t reg, uint8_t *read_value) {
    uint8_t tx_buf[2] = {R_REGISTER | (REGISTER_MASK & reg), NRF24_NOP};
    uint8_t rx_buf[2] = {0};
    esp_err_t ret = nrf24_spi_transfer(config, tx_buf, rx_buf, 2);
    if (ret != ESP_OK) {
        *read_value = 0xFF; // Indicate error
        return 0xFF;
    }
    *read_value = rx_buf[1];
    return rx_buf[0]; // Return status register
}

uint8_t nrf24_read_buf(nrf24_config_t *config, uint8_t reg, uint8_t *buffer, uint8_t len) {
    if (len > 32) len = 32; // Max buffer size
    uint8_t tx_buf[33];
    uint8_t rx_buf[33];
    tx_buf[0] = R_REGISTER | (REGISTER_MASK & reg);
    memset(&tx_buf[1], NRF24_NOP, len);
    memset(rx_buf, 0, len + 1);

    esp_err_t ret = nrf24_spi_transfer(config, tx_buf, rx_buf, len + 1);
    if (ret != ESP_OK) {
        memset(buffer, 0xFF, len); // Indicate error
        return 0xFF;
    }
    memcpy(buffer, &rx_buf[1], len);
    return rx_buf[0]; // Return status register
}

uint8_t nrf24_cmd(nrf24_config_t *config, uint8_t cmd) {
    uint8_t tx_buf[1] = {cmd};
    uint8_t rx_buf[1] = {0};
    esp_err_t ret = nrf24_spi_transfer(config, tx_buf, rx_buf, 1);
    if (ret != ESP_OK) return 0xFF; // Indicate error
    return rx_buf[0]; // Return status register
}

// --- High Level API ---

uint8_t nrf24_flush_tx(nrf24_config_t *config) {
    return nrf24_cmd(config, FLUSH_TX);
}

uint8_t nrf24_flush_rx(nrf24_config_t *config) {
    return nrf24_cmd(config, FLUSH_RX);
}

uint8_t nrf24_get_payload_width_p0(nrf24_config_t *config) {
    uint8_t width = 0;
    nrf24_read_reg(config, REG_RX_PW_P0, &width);
    return width & 0x3F; // Width is 6 bits max (0-32)
}

uint8_t nrf24_set_payload_width_p0(nrf24_config_t *config, uint8_t width) {
    if (width > NRF24_MAX_PAYLOAD_SIZE) width = NRF24_MAX_PAYLOAD_SIZE;
    return nrf24_write_reg(config, REG_RX_PW_P0, width);
}

uint8_t nrf24_get_address_width(nrf24_config_t *config) {
    uint8_t setup_aw = 0;
    nrf24_read_reg(config, REG_SETUP_AW, &setup_aw);
    setup_aw &= 0x03;
    if (setup_aw == 0) return 0; // Illegal
    return setup_aw + 2; // 01=3 bytes, 10=4 bytes, 11=5 bytes
}

uint8_t nrf24_set_address_width(nrf24_config_t *config, uint8_t width) {
    if (width < 3 || width > 5) return nrf24_get_status(config); // Invalid width, return current status
    return nrf24_write_reg(config, REG_SETUP_AW, width - 2);
}

uint8_t nrf24_get_status(nrf24_config_t *config) {
    return nrf24_cmd(config, NRF24_NOP); // Sending NOP returns status
}

uint32_t nrf24_get_data_rate(nrf24_config_t *config) {
    uint8_t rf_setup = 0;
    nrf24_read_reg(config, REG_RF_SETUP, &rf_setup);
    if (rf_setup & RF_DR_LOW) return 250000;
    if (rf_setup & RF_DR_HIGH) return 2000000;
    return 1000000;
}

uint8_t nrf24_set_data_rate(nrf24_config_t *config, uint32_t rate) {
    uint8_t rf_setup = 0;
    uint8_t status = nrf24_read_reg(config, REG_RF_SETUP, &rf_setup);
    rf_setup &= ~(RF_DR_LOW | RF_DR_HIGH);
    if (rate == 250000) {
        rf_setup |= RF_DR_LOW;
    } else if (rate == 2000000) {
        rf_setup |= RF_DR_HIGH;
    } else if (rate == 1000000) {
        // No bits set for 1Mbps
    } else {
        ESP_LOGW(TAG, "Invalid data rate %" PRIu32 ". Setting to 1Mbps.", rate);
        // Default to 1Mbps
    }
    return nrf24_write_reg(config, REG_RF_SETUP, rf_setup);
}

uint8_t nrf24_get_channel(nrf24_config_t *config) {
    uint8_t channel = 0;
    nrf24_read_reg(config, REG_RF_CH, &channel);
    return channel & 0x7F; // Channel is 7 bits
}

uint8_t nrf24_set_channel(nrf24_config_t *config, uint8_t channel) {
    if (channel > 125) channel = 125; // Max channel
    return nrf24_write_reg(config, REG_RF_CH, channel);
}

uint8_t nrf24_get_rx_address_p0(nrf24_config_t *config, uint8_t *address) {
    uint8_t width = nrf24_get_address_width(config);
    if (width == 0) return 0xFF; // Error reading width
    return nrf24_read_buf(config, REG_RX_ADDR_P0, address, width);
}

uint8_t nrf24_set_rx_address_p0(nrf24_config_t *config, const uint8_t *address, uint8_t width) {
    nrf24_set_address_width(config, width);
    return nrf24_write_buf(config, REG_RX_ADDR_P0, address, width);
}

uint8_t nrf24_get_tx_address(nrf24_config_t *config, uint8_t *address) {
    uint8_t width = nrf24_get_address_width(config);
    if (width == 0) return 0xFF; // Error reading width
    return nrf24_read_buf(config, REG_TX_ADDR, address, width);
}

uint8_t nrf24_set_tx_address(nrf24_config_t *config, const uint8_t *address, uint8_t width) {
    nrf24_set_address_width(config, width);
    return nrf24_write_buf(config, REG_TX_ADDR, address, width);
}

uint8_t nrf24_read_rx_payload(nrf24_config_t *config, uint8_t *payload, uint8_t *payload_size, bool use_static_width) {
    uint8_t status;
    uint8_t width;

    if (use_static_width) {
        width = nrf24_get_payload_width_p0(config);
    } else {
        // Read dynamic payload width
        uint8_t tx_buf[] = {R_RX_PL_WID, NRF24_NOP};
        uint8_t rx_buf[2];
        esp_err_t ret = nrf24_spi_transfer(config, tx_buf, rx_buf, 2);
        if (ret != ESP_OK) {
            *payload_size = 0;
            return 0xFF;
        }
        status = rx_buf[0];
        width = rx_buf[1];
        if (width > NRF24_MAX_PAYLOAD_SIZE) { // Error case, FIFO empty or invalid width
            *payload_size = 0;
            nrf24_flush_rx(config); // Flush if width is invalid
            return status;
        }
    }

    if (width == 0) { // No payload actually available, even if RX_DR is set
         *payload_size = 0;
         return nrf24_get_status(config);
    }

    *payload_size = width;
    status = nrf24_read_buf(config, R_RX_PAYLOAD, payload, width);
    // Note: RX_DR bit in status is cleared automatically after reading payload
    // No need to explicitly clear unless reading status *before* reading payload
    return status;
}

uint8_t nrf24_write_tx_payload(nrf24_config_t *config, const uint8_t *payload, uint8_t size, bool use_ack) {
    if (size == 0 || size > NRF24_MAX_PAYLOAD_SIZE) {
        ESP_LOGE(TAG, "Invalid payload size: %d", size);
        return nrf24_get_status(config); // Return current status on error
    }

    uint8_t cmd = use_ack ? W_TX_PAYLOAD : W_TX_PAYLOAD_NOACK;
    uint8_t status = nrf24_write_buf(config, cmd, payload, size);

    // Pulse CE to start transmission
    gpio_set_level(config->ce_io, 1);
    esp_rom_delay_us(15); // Minimum CE high time is 10us
    gpio_set_level(config->ce_io, 0);

    return status;
}

uint8_t nrf24_power_up(nrf24_config_t *config) {
    uint8_t cfg = 0;
    uint8_t status = nrf24_read_reg(config, REG_CONFIG, &cfg);
    if (!(cfg & PWR_UP)) {
        cfg |= PWR_UP;
        status = nrf24_write_reg(config, REG_CONFIG, cfg);
        vTaskDelay(pdMS_TO_TICKS(5)); // Wait 5ms for oscillator startup
    }
    return status;
}

uint8_t nrf24_power_down(nrf24_config_t *config) {
    gpio_set_level(config->ce_io, 0); // Go to standby-I first
    uint8_t cfg = 0;
    uint8_t status = nrf24_read_reg(config, REG_CONFIG, &cfg);
    cfg &= ~PWR_UP;
    status = nrf24_write_reg(config, REG_CONFIG, cfg);
    return status;
}

uint8_t nrf24_set_rx_mode(nrf24_config_t *config) {
    uint8_t cfg = 0;
    nrf24_read_reg(config, REG_CONFIG, &cfg);
    cfg |= PRIM_RX; // Set RX mode
    nrf24_write_reg(config, REG_CONFIG, cfg);
    nrf24_power_up(config); // Ensure powered up

    // Clear interrupt flags before enabling receiver
    nrf24_write_reg(config, REG_STATUS, RX_DR | TX_DS | MAX_RT);

    gpio_set_level(config->ce_io, 1); // Enable receiver
    vTaskDelay(pdMS_TO_TICKS(1)); // Allow time to settle (datasheet recommends >130us settling time)

    return nrf24_get_status(config);
}

uint8_t nrf24_set_tx_mode(nrf24_config_t *config) {
    gpio_set_level(config->ce_io, 0); // Go to standby-I before changing mode
    vTaskDelay(pdMS_TO_TICKS(1)); // Allow time to settle

    uint8_t cfg = 0;
    nrf24_read_reg(config, REG_CONFIG, &cfg);
    cfg &= ~PRIM_RX; // Set TX mode
    nrf24_write_reg(config, REG_CONFIG, cfg);
    nrf24_power_up(config); // Ensure powered up

    return nrf24_get_status(config);
    // Note: CE is pulsed high only when actually transmitting payload (in nrf24_write_tx_payload)
}

void nrf24_configure(
    nrf24_config_t *config,
    uint32_t rate,
    const uint8_t *rx_addr,
    const uint8_t *tx_addr,
    uint8_t addr_width,
    uint8_t channel,
    bool enable_ack,
    bool enable_dyn_payload)
{
    ESP_LOGI(TAG, "Configuring radio: Rate=%" PRIu32 ", Chan=%d, AW=%d, ACK=%d, DPL=%d",
             rate, channel, addr_width, enable_ack, enable_dyn_payload);

    nrf24_power_down(config);
    vTaskDelay(pdMS_TO_TICKS(5));

    // Set address width
    nrf24_set_address_width(config, addr_width);

    // Set addresses
    if (rx_addr) nrf24_set_rx_address_p0(config, rx_addr, addr_width);
    if (tx_addr) nrf24_set_tx_address(config, tx_addr, addr_width);

    // Set channel
    nrf24_set_channel(config, channel);

    // Set data rate and power (using default power 0dBm)
    nrf24_set_data_rate(config, rate);

    // Configure Auto Ack (EN_AA) and CRC (CONFIG)
    uint8_t config_reg = 0x08; // Default: PWR_DOWN, PTX, 1-byte CRC disabled
    uint8_t en_aa_reg = enable_ack ? 0x3F : 0x00; // Enable/disable AA on all pipes
    if (enable_ack) {
        config_reg |= EN_CRC; // Enable CRC if ACK is enabled
        // Set auto retransmit delay and count (e.g., 500us delay, 15 retries)
        nrf24_write_reg(config, REG_SETUP_RETR, 0x1F); // 500us = (1+1)*250us, 15 retries
    } else {
        // Disable auto retransmit if AA is disabled
        nrf24_write_reg(config, REG_SETUP_RETR, 0x00);
    }
    nrf24_write_reg(config, REG_EN_AA, en_aa_reg);

    // Configure Dynamic Payload Length (DYNPD, FEATURE)
    uint8_t feature_reg = 0;
    uint8_t dynpd_reg = 0;
    if (enable_dyn_payload) {
        feature_reg |= EN_DPL;
        dynpd_reg = 0x3F; // Enable DPL on all pipes
        if (enable_ack) {
            feature_reg |= EN_ACK_PAY; // Enable ACK payloads if DPL and ACK are enabled
        }
    }
     // Allow W_TX_PAYLOAD_NOACK command if DPL is enabled OR if AA is disabled
    if (enable_dyn_payload || !enable_ack) {
         feature_reg |= EN_DYN_ACK;
    }

    // Activate features (must be done in specific sequence)
    if (feature_reg != 0) {
         nrf24_cmd(config, ACTIVATE);
         nrf24_write_reg(config, 0x73, 0x53); // Magic value needed after ACTIVATE
    }
    nrf24_write_reg(config, REG_FEATURE, feature_reg);
    nrf24_write_reg(config, REG_DYNPD, dynpd_reg);

    // Write final config register (still powered down)
    nrf24_write_reg(config, REG_CONFIG, config_reg);

    // Clear status flags
    nrf24_write_reg(config, REG_STATUS, RX_DR | TX_DS | MAX_RT);

    // Flush FIFOs
    nrf24_flush_rx(config);
    nrf24_flush_tx(config);

    ESP_LOGI(TAG, "Configuration complete. Final state: Powered Down.");
}


void nrf24_init_promisc_mode(nrf24_config_t *config, uint8_t channel, uint32_t rate) {
    ESP_LOGW(TAG, "Initializing promiscuous mode (experimental)");
    // Based on http://travisgoodspeed.blogspot.com/2011/02/promiscuity-is-nrf24l01s-duty.html
    // This mode disables CRC and uses a short address width to catch more packets.

    nrf24_power_down(config);
    vTaskDelay(pdMS_TO_TICKS(5));

    // Disable Auto-Ack
    nrf24_write_reg(config, REG_EN_AA, 0x00);
    // Disable Auto-Retransmit
    nrf24_write_reg(config, REG_SETUP_RETR, 0x00);
    // Disable Dynamic Payload Length features initially
    nrf24_write_reg(config, REG_FEATURE, 0x00);
    nrf24_write_reg(config, REG_DYNPD, 0x00);

    // Set shortest address width (3 bytes) - crucial for promiscuous mode
    nrf24_set_address_width(config, 3);

    // Use a common preamble-like address if possible, but any 3-byte address works here.
    // The original example used 2-byte, but 3 is the minimum for nRF24L01+.
    // Using a dummy address.
    const uint8_t promisc_addr[3] = {0xE7, 0xE7, 0xE7}; // Example address
    nrf24_set_rx_address_p0(config, promisc_addr, 3);

    // Set channel and rate
    nrf24_set_channel(config, channel);
    nrf24_set_data_rate(config, rate);

    // Set static payload length to max
    nrf24_set_payload_width_p0(config, NRF24_MAX_PAYLOAD_SIZE);

    // Clear status flags
    nrf24_write_reg(config, REG_STATUS, RX_DR | TX_DS | MAX_RT);

    // Flush FIFOs
    nrf24_flush_rx(config);
    nrf24_flush_tx(config);

    // Power up in RX mode with CRC disabled
    nrf24_write_reg(config, REG_CONFIG, PWR_UP | PRIM_RX); // No EN_CRC bit set

    // Enable receiver
    gpio_set_level(config->ce_io, 1);
    vTaskDelay(pdMS_TO_TICKS(1)); // Allow settle time

    ESP_LOGI(TAG, "Promiscuous mode configured: Chan=%d, Rate=%" PRIu32 ", AddrWidth=3, CRC=Off", channel, rate);
}

// Helper to check if an address consists of repeating bytes (often invalid)
static bool is_repeating_address(const uint8_t* addr, uint8_t width) {
    if (width <= 1) return false; // Cannot repeat
    for (int i = 1; i < width; ++i) {
        if (addr[i] != addr[0]) return false;
    }
    // Check specific problematic patterns like 0x55, 0xAA
    if (addr[0] == 0x55 || addr[0] == 0xAA || addr[0] == 0x00 || addr[0] == 0xFF) {
        return true;
    }
    return false;
}

bool nrf24_sniff_address(nrf24_config_t *config, uint8_t addr_width, uint8_t *address) {
    uint8_t packet[NRF24_MAX_PAYLOAD_SIZE];
    uint8_t packetsize = 0;
    bool found = false;

    uint8_t status = nrf24_get_status(config);

    if (status & RX_DR) {
        // Read packet using static width (set to max in promisc mode)
        status = nrf24_read_rx_payload(config, packet, &packetsize, true);

        // Clear the RX_DR flag manually if needed (should be cleared by read_rx_payload)
         nrf24_write_reg(config, REG_STATUS, RX_DR);

        if (packetsize >= addr_width) {
            // Extract potential address from the start of the packet payload
            // Note: Address appears in payload in promiscuous mode
            memcpy(address, packet, addr_width);

            // Basic validation: avoid all 0x00, 0xFF, 0x55, 0xAA etc.
            if (!is_repeating_address(address, addr_width)) {
                 char addr_str[addr_width * 3]; // Hex string buffer
                 hexlify(address, addr_width, addr_str);
                 ESP_LOGI(TAG, "Sniffed potential address: %s (PayloadSize: %d)", addr_str, packetsize);
                found = true;
            } else {
                 //ESP_LOGD(TAG, "Rejected repeating address");
            }
        } else {
            //ESP_LOGD(TAG, "Packet too short for address width: %d < %d", packetsize, addr_width);
        }
    } // else: No packet received

    return found;
}

uint8_t nrf24_find_channel(
    nrf24_config_t *config,
    const uint8_t *rx_addr,
    const uint8_t *tx_addr,
    uint8_t addr_width,
    uint32_t rate,
    uint8_t min_channel,
    uint8_t max_channel,
    bool auto_reconfigure)
{
    ESP_LOGI(TAG, "Scanning channels %d to %d for ACK...", min_channel, max_channel);
    uint8_t original_channel = nrf24_get_channel(config);
    uint8_t found_channel = max_channel + 1; // Default to fail

    // Configure radio for TX with ACK required
    nrf24_configure(config, rate, rx_addr, tx_addr, addr_width, min_channel, true, false);

    const uint8_t ping_packet[] = {0x0F, 0x0F, 0x0F, 0x0F}; // Simple payload
    const uint8_t PING_RETRIES = 3; // Try each channel a few times

    for (uint8_t ch = min_channel; ch <= max_channel; ++ch) {
        nrf24_set_channel(config, ch);
        nrf24_set_tx_mode(config); // Ensure in TX mode
        nrf24_flush_tx(config); // Flush before trying
        nrf24_write_reg(config, REG_STATUS, RX_DR | TX_DS | MAX_RT); // Clear flags

        bool ack_received = false;
        for(int i=0; i < PING_RETRIES; ++i) {
            nrf24_write_tx_payload(config, ping_packet, sizeof(ping_packet), true);

            // Wait for TX_DS (ACK received) or MAX_RT (failed)
            uint32_t start_time = xTaskGetTickCount();
            uint8_t status;
            while (1) {
                status = nrf24_get_status(config);
                if (status & TX_DS) { // Got ACK!
                    ack_received = true;
                    break;
                }
                if (status & MAX_RT) { // Failed to get ACK
                    break;
                }
                if (xTaskGetTickCount() - start_time > pdMS_TO_TICKS(10)) { // Timeout (e.g., 10ms)
                     break;
                }
                vTaskDelay(pdMS_TO_TICKS(1)); // Small delay
            }

            // Clear flags for next attempt/channel
             nrf24_write_reg(config, REG_STATUS, TX_DS | MAX_RT);

             if (ack_received) break; // Stop retrying on this channel if ACK received
        }

        if (ack_received) {
            ESP_LOGI(TAG, "ACK received on channel %d!", ch);
            found_channel = ch;
            break;
        } else {
            //ESP_LOGD(TAG, "No ACK on channel %d", ch);
        }
         vTaskDelay(pdMS_TO_TICKS(2)); // Small delay between channels
    }

    if (found_channel <= max_channel) {
        if (auto_reconfigure) {
            ESP_LOGI(TAG, "Reconfiguring radio to channel %d", found_channel);
            // We are already configured, just need to ensure mode is correct (e.g., RX)
            nrf24_set_rx_mode(config); // Example: default to RX after finding
        } else {
            ESP_LOGI(TAG, "Restoring original channel %d", original_channel);
            nrf24_set_channel(config, original_channel);
            nrf24_power_down(config); // Go back to low power state
        }
    } else {
        ESP_LOGW(TAG, "No device acknowledged on channels %d-%d", min_channel, max_channel);
        nrf24_set_channel(config, original_channel);
        nrf24_power_down(config); // Go back to low power state
    }

    return found_channel;
}


// --- Utility Functions ---

void hexlify(const uint8_t* in, uint8_t size, char* out) {
    if (!in || !out) return;
    char* ptr = out;
    for (int i = 0; i < size; i++) {
        ptr += sprintf(ptr, "%02X", in[i]);
    }
    *ptr = '\0'; // Null terminate
}

uint64_t bytes_to_int64(const uint8_t* bytes, uint8_t size, bool big_endian) {
    uint64_t ret = 0;
    if (!bytes || size == 0 || size > 8) return 0;
    for (int i = 0; i < size; i++) {
        if (big_endian) {
            ret |= (uint64_t)bytes[i] << ((size - 1 - i) * 8);
        } else {
            ret |= (uint64_t)bytes[i] << (i * 8);
        }
    }
    return ret;
}

void int64_to_bytes(uint64_t val, uint8_t* out, uint8_t size, bool big_endian) {
    if (!out || size == 0 || size > 8) return;
    for (int i = 0; i < size; i++) {
        if (big_endian) {
            out[i] = (val >> ((size - 1 - i) * 8)) & 0xFF;
        } else {
            out[i] = (val >> (i * 8)) & 0xFF;
        }
    }
}

uint32_t bytes_to_int32(const uint8_t* bytes, uint8_t size, bool big_endian) {
    uint32_t ret = 0;
    if (!bytes || size == 0 || size > 4) return 0;
     for (int i = 0; i < size; i++) {
        if (big_endian) {
            ret |= (uint32_t)bytes[i] << ((size - 1 - i) * 8);
        } else {
            ret |= (uint32_t)bytes[i] << (i * 8);
        }
    }
    return ret;
}

void int32_to_bytes(uint32_t val, uint8_t* out, uint8_t size, bool big_endian) {
     if (!out || size == 0 || size > 4) return;
    for (int i = 0; i < size; i++) {
        if (big_endian) {
            out[i] = (val >> ((size - 1 - i) * 8)) & 0xFF;
        } else {
            out[i] = (val >> (i * 8)) & 0xFF;
        }
    }
}

uint16_t bytes_to_int16(const uint8_t* bytes, uint8_t size, bool big_endian) {
     uint16_t ret = 0;
    if (!bytes || size == 0 || size > 2) return 0;
     for (int i = 0; i < size; i++) {
        if (big_endian) {
            ret |= (uint16_t)bytes[i] << ((size - 1 - i) * 8);
        } else {
            ret |= (uint16_t)bytes[i] << (i * 8);
        }
    }
    return ret;
}

void int16_to_bytes(uint16_t val, uint8_t* out, uint8_t size, bool big_endian) {
    if (!out || size == 0 || size > 2) return;
    for (int i = 0; i < size; i++) {
        if (big_endian) {
            out[i] = (val >> ((size - 1 - i) * 8)) & 0xFF;
        } else {
            out[i] = (val >> (i * 8)) & 0xFF;
        }
    }
} 