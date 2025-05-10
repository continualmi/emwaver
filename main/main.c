/*
 * SPDX-FileCopyrightText: 2010-2022 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: CC0-1.0
 */

#include <stdio.h>
#include <inttypes.h>
#include "sdkconfig.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_chip_info.h"
#include "esp_flash.h"
#include "esp_system.h"
#include "esp_log.h"
#include "driver/gpio.h"
#include "esp_timer.h"
#include "esp_rom_sys.h"
#include "driver/timer.h"
#include "soc/timer_group_struct.h"
#include "soc/timer_group_reg.h"
#include "driver/spi_master.h"
#include "nvs_flash.h"
#include "esp_heap_caps.h"

// Define firmware version
#define FIRMWARE_VERSION "1.0.0"

// Include CC1101 module
#include "cc1101.h"

// Include BLE server
#include "ble_server.h"

// Include MFRC522 module
#include "mfrc522.h"

// Include BadUSB module
#include "badusb.h"
// Place MFRC522 config here so it is visible everywhere
static mfrc522_config_t mfrc522_cfg = {
    .host = SPI2_HOST, // Same as CC1101
    .miso_io = 13,     // Same as CC1101
    .mosi_io = 11,     // Same as CC1101
    .sck_io  = 12,     // Same as CC1101
    .sda_io  = 9,      // CS for MFRC522 is GPIO9
    .rst_io  = 7,      // RST for MFRC522 is GPIO7
    .spi_device = NULL
};

// Define buffer size for BLE transmission
#define BLE_RX_BUFFER_SIZE 4096

static const char *TAG = "EMWaver";
static spi_device_handle_t spi_dev_handle; // SPI device handle

/* ---------- Simple-command infrastructure ---------- */
typedef struct {
    uint8_t  data[256];
    uint16_t length;
} command_t;

#define CMD_QUEUE_LEN 10
static QueueHandle_t cmd_queue = NULL;

// Sampling related definitions and variables
#define MAX_BLOCKS 64
#define BYTES_PER_BLOCK 16

// Sampler buffer definitions
static volatile uint8_t* bufferA = NULL;
static volatile uint8_t* bufferB = NULL;
static volatile uint8_t* currentBuffer = NULL;
static volatile uint8_t* transmitBuffer = NULL;
static volatile int bufferIndex = 0;
static volatile uint8_t bufferReady = 0;
static uint16_t samplerPin;  // Pin to sample

// Timer handles
static esp_timer_handle_t sampler_timer;
static uint8_t transmitter_active = 0;
static intr_handle_t transmission_timer_isr_handle = NULL; // Handle for timer ISR

// Add these semaphores
static SemaphoreHandle_t buffer_ready_sem = NULL;
static TaskHandle_t sampler_task_handle = NULL;
static TaskHandle_t transmission_monitor_task_handle = NULL;

// Define timeout constants for transmission monitoring
#define TRANSMISSION_TIMEOUT_MS 2000  // 2 seconds without data will stop transmission
#define MONITOR_CHECK_INTERVAL_MS 10 // Check every 100ms

// Add this line with other global variables, around line 70
static intr_handle_t sampling_timer_isr_handle = NULL;

// Function declarations
void sampler_task(void* pvParameters);
void transmission_monitor_task(void* pvParameters);

// Modified ISR for BLE transmission
static void IRAM_ATTR transmission_isr(void* arg) {
    static uint8_t bitIndex = 0;
    static uint8_t currentByte = 0;
    static uint8_t needNewByte = 1;

    // Clear the interrupt
    timer_group_clr_intr_status_in_isr(TIMER_GROUP_0, TIMER_1);

    // If this is the first bit of a byte, read the next byte from the buffer
    if (bitIndex == 0 && needNewByte) {
        // Check BLE buffer
        if (ble_get_rx_bytes_available() > 0) {
            ble_read_rx_buffer(&currentByte, 1);
            needNewByte = 0;
        } else {
            // No data available, set pin low and wait for next cycle
            gpio_set_level(samplerPin, 0);
            timer_group_enable_alarm_in_isr(TIMER_GROUP_0, TIMER_1);
            return;
        }
    }

    // Set the specified pin high or low based on the current bit
    if (currentByte & (1 << bitIndex)) {
        gpio_set_level(samplerPin, 1);
    } else {
        gpio_set_level(samplerPin, 0);
    }

    // Increment bit index and check if we have processed the whole byte
    bitIndex++;
    if (bitIndex > 7) {
        bitIndex = 0;    // Reset bit index back to the LSB for the next byte
        needNewByte = 1; // Flag that we need a new byte
    }

    // Reload timer
    timer_group_enable_alarm_in_isr(TIMER_GROUP_0, TIMER_1);
}

// Start transmission function - BLE only
static void start_transmission(uint8_t pin) {
    // Configure the pin as output
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << pin),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_ENABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    gpio_config(&io_conf);
    samplerPin = pin;
    
    // Initialize BLE for transmission mode
    ble_set_transmitter_mode(1);
    
    // Set up hardware timer (Timer Group 0, Timer 1)
    timer_config_t config = {
        .divider = 80, // 80 MHz / 80 = 1 MHz (1 tick = 1 us)
        .counter_dir = TIMER_COUNT_UP,
        .counter_en = TIMER_PAUSE,
        .alarm_en = TIMER_ALARM_EN,
        .auto_reload = true,
    };
    timer_init(TIMER_GROUP_0, TIMER_1, &config);
    timer_set_counter_value(TIMER_GROUP_0, TIMER_1, 0x00000000ULL);
    // 10us per bit exactly matches the sampling ISR timing
    timer_set_alarm_value(TIMER_GROUP_0, TIMER_1, 10); 
    timer_enable_intr(TIMER_GROUP_0, TIMER_1);
    
    // Register timer ISR only if not already registered
    if (transmission_timer_isr_handle == NULL) {
        esp_err_t err = timer_isr_register(TIMER_GROUP_0, TIMER_1, transmission_isr, NULL, ESP_INTR_FLAG_IRAM, &transmission_timer_isr_handle);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Failed to register timer ISR: %d", err);
            return;
        }
    }
    
    // Mark the transmitter as active
    transmitter_active = 1;
    
    // Start the transmission monitor task to wait for buffer to fill 
    // and then start the transmission timer
    if (transmission_monitor_task_handle == NULL) {
        xTaskCreate(transmission_monitor_task, "tx_monitor", 4096, NULL, 5, &transmission_monitor_task_handle);
    }
    
    // Send a success response over BLE
    uint8_t resp = 1;
    ble_server_notify(&resp, 1);
    
    ESP_LOGI(TAG, "BLE transmission initialized on pin %d", pin);
    ESP_LOGI(TAG, "Waiting for buffer to fill before starting transmission...");
}

// Stop transmission function
static void stop_transmission() {
    // Stop the timer
    if (transmitter_active) {
        // First pause and disable the timer interrupt
        timer_pause(TIMER_GROUP_0, TIMER_1);
        timer_disable_intr(TIMER_GROUP_0, TIMER_1);
        
        // Unregister the timer ISR if it was registered
        if (transmission_timer_isr_handle != NULL) {
            esp_intr_free(transmission_timer_isr_handle);
            transmission_timer_isr_handle = NULL;
        }
        
        // Set pin to low state
        gpio_set_level(samplerPin, 0);
        
        // Clean up BLE buffer
        ble_set_transmitter_mode(0);
        
        // Mark transmission as inactive
        transmitter_active = 0;
    
        ESP_LOGI(TAG, "BLE transmission stopped");
    }
}

// Transmission monitor task - this will monitor data flow and auto-stop transmission after timeout
void transmission_monitor_task(void* pvParameters) {
    uint16_t last_bytes_available = 0;
    uint16_t current_bytes_available = 0;
    uint32_t elapsed_time_ms = 0;
    bool timer_started = false;
    
    while (transmitter_active) {
        // Get current buffer status
        current_bytes_available = ble_get_rx_bytes_available();
        
        // Check if the timer should start (buffer half full)
        if (!timer_started && current_bytes_available >= (BLE_RX_BUFFER_SIZE / 2)) {
            ESP_LOGI(TAG, "Buffer reached half capacity (%d bytes). Starting transmission.", current_bytes_available);
            // Start the hardware timer to begin transmission
            timer_start(TIMER_GROUP_0, TIMER_1);
            timer_started = true;
        }
        
        // Only check for timeout once the timer has started
        if (timer_started) {
            // Check if we've received any new data
            if (current_bytes_available != last_bytes_available) {
                // Data is flowing, reset the timer
                elapsed_time_ms = 0;
                last_bytes_available = current_bytes_available;
            } else {
                // No new data, increment the timer
                elapsed_time_ms += MONITOR_CHECK_INTERVAL_MS;
                
                // Check if we've exceeded the timeout
                if (elapsed_time_ms >= TRANSMISSION_TIMEOUT_MS) {
                    ESP_LOGI(TAG, "Transmission timeout - no new data for %d ms", TRANSMISSION_TIMEOUT_MS);
                    
                    // Stop transmission
                    stop_transmission();
                    
                    // Break out of the loop - task will self-delete below
                    break;
                }
            }
        } else {
            // Timer not started yet, but update last bytes for consistency
            last_bytes_available = current_bytes_available;
        }
        
        // Wait before checking again
        vTaskDelay(pdMS_TO_TICKS(MONITOR_CHECK_INTERVAL_MS));
    }
    
    // Clear handle before deleting task
    TaskHandle_t temp_handle = transmission_monitor_task_handle;
    transmission_monitor_task_handle = NULL;
    
    // Self-delete - ensure this is the last operation
    vTaskDelete(NULL);
}

// Hardware timer ISR for sampling
void IRAM_ATTR sampling_isr(void* arg) {
    // Clear the interrupt
    timer_group_clr_intr_status_in_isr(TIMER_GROUP_0, TIMER_0);

    // Sample the configurable pin
    static uint8_t bitIndex = 0;
    static uint8_t currentByte = 0;
    uint8_t pin_state = gpio_get_level(samplerPin);

    if (pin_state) {
        currentByte |= (1 << bitIndex);
    } else {
        currentByte &= ~(1 << bitIndex);
    }

    bitIndex++;
    if (bitIndex >= 8) {
        currentBuffer[bufferIndex] = currentByte;
        bufferIndex++;
        bitIndex = 0;
        currentByte = 0;

        if (bufferIndex >= 256) {  // 256 bytes is optimal for BLE packet size
            transmitBuffer = currentBuffer;
            currentBuffer = (currentBuffer == bufferA) ? bufferB : bufferA;
            bufferIndex = 0;
            // Signal the semaphore to notify data is ready
            BaseType_t xHigherPriorityTaskWoken = pdFALSE;
            xSemaphoreGiveFromISR(buffer_ready_sem, &xHigherPriorityTaskWoken);
            if(xHigherPriorityTaskWoken) {
                portYIELD_FROM_ISR();
            }
        }
    }

    // Reload timer
    timer_group_enable_alarm_in_isr(TIMER_GROUP_0, TIMER_0);
}

// Start sampling function using hardware timer
static void start_sampling(uint8_t pin) {
    // Configure the pin as input
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << pin),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_ENABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    gpio_config(&io_conf);
    samplerPin = pin;

    // Set up double buffer system with 256-byte buffers (optimized for BLE packet size)
    bufferA = (uint8_t*)malloc(256 * sizeof(uint8_t));
    bufferB = (uint8_t*)malloc(256 * sizeof(uint8_t));
    currentBuffer = bufferA;
    transmitBuffer = NULL;
    bufferIndex = 0;
    bufferReady = 0;

    // Set up hardware timer (Timer Group 0, Timer 0)
    timer_config_t config = {
        .divider = 80, // 80 MHz / 80 = 1 MHz (1 tick = 1 us)
        .counter_dir = TIMER_COUNT_UP,
        .counter_en = TIMER_PAUSE,
        .alarm_en = TIMER_ALARM_EN,
        .auto_reload = true,
    };
    timer_init(TIMER_GROUP_0, TIMER_0, &config);
    timer_set_counter_value(TIMER_GROUP_0, TIMER_0, 0x00000000ULL);
    timer_set_alarm_value(TIMER_GROUP_0, TIMER_0, 10); // 10 us sampling period
    
    // Enable the timer interrupt
    timer_enable_intr(TIMER_GROUP_0, TIMER_0);
    
    // Register timer ISR and store the handle
    esp_err_t err = timer_isr_register(TIMER_GROUP_0, TIMER_0, sampling_isr, NULL, ESP_INTR_FLAG_IRAM, &sampling_timer_isr_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to register timer ISR: %d", err);
        return;
    }
    
    timer_start(TIMER_GROUP_0, TIMER_0);
    
    ESP_LOGI(TAG, "BLE sampling started on pin %d", pin);
}

// Stop sampling function
static void stop_sampling() {
    // Stop the timer first!
    timer_pause(TIMER_GROUP_0, TIMER_0);
    timer_disable_intr(TIMER_GROUP_0, TIMER_0);
    
    // Unregister the timer ISR if it was registered
    if (sampling_timer_isr_handle != NULL) {
        esp_intr_free(sampling_timer_isr_handle);
        sampling_timer_isr_handle = NULL;
    }
    
    // Then clean up buffers
    free((void*)bufferA);
    free((void*)bufferB);
    bufferA = NULL;
    bufferB = NULL;
    currentBuffer = NULL;
    transmitBuffer = NULL;
    
    ESP_LOGI(TAG, "BLE sampling stopped");
}

/* ---------- Command-processing task ---------- */
static void command_task(void *pvParameters)
{
    command_t cmd;
    for (;;) {
        if (xQueueReceive(cmd_queue, &cmd, portMAX_DELAY) == pdTRUE) {
            /* --- GPIO command --- */
            if (cmd.length >= 8 && strncmp((char *)cmd.data, "gpio", 4) == 0) {
                uint8_t pin    = cmd.data[5];
                uint8_t action = cmd.data[6];   // 'R' or 'W'
                uint8_t value  = cmd.data[7];

                ESP_LOGI(TAG, "GPIO cmd: pin=%d action=%c value=%d",
                         pin, action, value);

                if (action == 'R') {
                    gpio_set_direction(pin, GPIO_MODE_INPUT);
                    uint8_t resp = gpio_get_level(pin);
                    // Send notification over BLE
                    ble_server_notify(&resp, 1);
                } else if (action == 'W') {
                    gpio_set_direction(pin, GPIO_MODE_OUTPUT);
                    gpio_set_level(pin, value ? 1 : 0);
                    // Send notification over BLE
                    ble_server_notify(&value, 1);
                }
            }
            /* --- CC1101 register commands --- */
            else if (cmd.length >= 7 && strncmp((char *)cmd.data, "cc1101", 6) == 0) {
                // Skip the "cc1101 " prefix (7 chars total with space)
                char *subcommand = (char *)&cmd.data[7];
                
                if (strncmp(subcommand, "writereg", 8) == 0) {
                    // Format: cc1101 writereg [addr] [value]
                    uint8_t addr = subcommand[9];
                    uint8_t value = subcommand[10];
                    cc1101_write_reg(addr, value);
                    uint8_t reading = cc1101_read_reg(addr);
                    // Send notification over BLE
                    ble_server_notify(&reading, 1);
                } 
                else if (strncmp(subcommand, "readreg", 7) == 0) {
                    // Format: cc1101 readreg [addr]
                    uint8_t addr = subcommand[8];
                    uint8_t reading = cc1101_read_reg(addr);
                    // Send notification over BLE
                    ble_server_notify(&reading, 1);
                } 
                else if (strncmp(subcommand, "strobe", 6) == 0) {
                    // Format: cc1101 strobe [cmd]
                    uint8_t cmd_value = subcommand[7];
                    uint8_t status = cc1101_strobe(cmd_value);
                    // Send notification over BLE
                    ble_server_notify(&status, 1);
                } 
                else if (strncmp(subcommand, "burstwrite", 10) == 0) {
                    // Format: cc1101 burstwrite [addr] [len] [data...]
                    uint8_t addr = subcommand[11];
                    uint8_t len = subcommand[12];
                    uint8_t status = cc1101_write_burst_reg(addr, (uint8_t*)&subcommand[13], len);
                    // Send notification over BLE
                    ble_server_notify(&status, 1);
                } 
                else if (strncmp(subcommand, "burstread", 9) == 0) {
                    // Format: cc1101 burstread [addr] [len]
                    uint8_t addr = subcommand[10];
                    uint8_t len = subcommand[11];
                    uint8_t buffer[32]; // Max 32 bytes, adjust if needed
                    cc1101_read_burst_reg(addr, buffer, len);
                    // Send notification over BLE
                    ble_server_notify(buffer, len);
                }
            }
            /* --- Sampling commands --- */
            else if (cmd.length >= 8 && strncmp((char *)cmd.data, "sample", 6) == 0) {
                uint8_t pin = cmd.data[7]; // Pin number after "sample " (7th byte)
                ESP_LOGI(TAG, "Sample command: pin=%d", pin);
                
                // Initialize sampling with the pin
                buffer_ready_sem = xSemaphoreCreateBinary();
                xTaskCreate(sampler_task, "sampler", 4096, NULL, 5, &sampler_task_handle);
                
                // Start sampling
                start_sampling(pin);
                
                // Respond over BLE
                uint8_t resp = 1;
                ble_server_notify(&resp, 1);
            }
            /* --- Transmission commands --- */
            else if (cmd.length >= 9 && strncmp((char *)cmd.data, "transmit", 8) == 0) {
                uint8_t pin = cmd.data[9]; // Pin number after "transmit " (9th byte)
                ESP_LOGI(TAG, "Transmission command: pin=%d", pin);
                
                // Start transmission on the specified pin
                start_transmission(pin);
                
                // Send a success response over BLE
                uint8_t resp = 1;
                ble_server_notify(&resp, 1);
            }
            /* --- Stop commands --- */
            else if (cmd.length >= 4 && strncmp((char *)cmd.data, "stop", 4) == 0) {
                // Stop command for sampling or transmission
                if (sampler_task_handle != NULL) {
                    // Signal the sampling task to stop
                    xTaskNotify(sampler_task_handle, 1, eSetValueWithOverwrite);
                }
                
                // Also check for transmission to stop
                if (transmitter_active) {
                    stop_transmission();
                }
                
                // Send a success response over BLE
                uint8_t resp = 1;
                ble_server_notify(&resp, 1);
            }
            /* --- Version command --- */
            else if (cmd.length >= 7 && strncmp((char *)cmd.data, "version", 7) == 0) {
                ESP_LOGI(TAG, "Version command received");
                
                // Create a welcome message with the version at the beginning
                char welcome_message[64];
                snprintf(welcome_message, sizeof(welcome_message), 
                         "%s - Welcome to EMWaver!", FIRMWARE_VERSION);
                
                // Send the welcome message over BLE
                ble_server_notify((uint8_t*)welcome_message, strlen(welcome_message));
            }
            /* --- BLE specific commands --- */
            else if (cmd.length >= 4 && strncmp((char *)cmd.data, "ble?", 4) == 0) {
                ESP_LOGI(TAG, "BLE test command received");
                
                // Send a success response
                uint8_t resp[5] = {'B', 'L', 'E', 'O', 'K'};
                ble_server_notify(resp, 5);
            }
            /* --- RFID commands --- */
            else if (cmd.length >= 7 && strncmp((char *)cmd.data, "mfrc522", 7) == 0) {
                // Skip the "mfrc522 " prefix (8 chars total with space)
                char *subcommand = (char *)&cmd.data[8];
                
                if (strncmp(subcommand, "read", 4) == 0) {
                    // Format: 'mfrc522 read' [blockAddr] [authMode] [6 bytes key]
                    uint8_t blockAddr = subcommand[5];
                    uint8_t authMode = subcommand[6];
                    uint8_t keyA[6];
                    memcpy(keyA, &subcommand[7], 6);
                    uint8_t status;
                    uint8_t bufferATQA[2];
                    uint8_t CardUID[5];
                    uint8_t responsePacket[40];
                    uint8_t responseIndex = 0;
                    
                    // First check if the MFRC522 module is connected
                    if (!mfrc522_is_connected()) {
                        const char* msg = "RFID module not connected";
                        ble_server_notify((const uint8_t*)msg, strlen(msg));
                        continue;
                    }
                    
                    // Replace the full init with soft reset
                    mfrc522_soft_reset();
                    ESP_LOGI(TAG, "MFRC522 reset completed");
                    
                    status = mfrc522_request(PICC_REQIDL, bufferATQA);
                    if (status != MI_OK) {
                        const char* msg = "No card detected";
                        ble_server_notify((const uint8_t*)msg, strlen(msg));
                        continue;
                    }
                    responsePacket[responseIndex++] = bufferATQA[0];
                    responsePacket[responseIndex++] = bufferATQA[1];
                    status = mfrc522_anticoll(CardUID);
                    if (status != MI_OK) {
                        responsePacket[responseIndex++] = 0xFF;
                        const char* msg = "Anticollision failed";
                        memcpy(&responsePacket[responseIndex], msg, strlen(msg));
                        ble_server_notify(responsePacket, responseIndex + strlen(msg));
                        continue;
                    }
                    for (int i = 0; i < 4; i++) {
                        responsePacket[responseIndex++] = CardUID[i];
                    }
                    status = mfrc522_select_tag(CardUID);
                    if (status == 0) {
                        responsePacket[responseIndex++] = 0xFF;
                        const char* msg = "Card selection failed";
                        memcpy(&responsePacket[responseIndex], msg, strlen(msg));
                        ble_server_notify(responsePacket, responseIndex + strlen(msg));
                        continue;
                    }
                    status = mfrc522_auth(authMode, blockAddr, keyA, CardUID);
                    if (status != MI_OK) {
                        responsePacket[responseIndex++] = 0xFF;
                        const char* msg = "Authentication failed";
                        memcpy(&responsePacket[responseIndex], msg, strlen(msg));
                        ble_server_notify(responsePacket, responseIndex + strlen(msg));
                        continue;
                    }
                    uint8_t buffer[16];
                    status = mfrc522_read(blockAddr, buffer);
                    if (status == MI_OK) {
                        responsePacket[responseIndex++] = 0x00;
                        for (int i = 0; i < 16; i++) {
                            responsePacket[responseIndex++] = buffer[i];
                        }
                    } else {
                        responsePacket[responseIndex++] = 0xFF;
                        const char* msg = "Read failed";
                        memcpy(&responsePacket[responseIndex], msg, strlen(msg));
                        responseIndex += strlen(msg);
                    }
                    ble_server_notify(responsePacket, responseIndex);
                    mfrc522_stop_crypto1();
                }
                else if (strncmp(subcommand, "write", 5) == 0) {
                    // Format: 'mfrc522 write' [blockAddr] [authMode] [6 bytes key] [16 bytes data]
                    uint8_t blockAddr = subcommand[6];
                    uint8_t authMode = subcommand[7];
                    uint8_t key[6];
                    memcpy(key, &subcommand[8], 6);
                    uint8_t writeData[16];
                    memcpy(writeData, &subcommand[14], 16);
                    uint8_t status;
                    uint8_t bufferATQA[2];
                    uint8_t CardUID[5];
                    uint8_t responsePacket[40];
                    uint8_t responseIndex = 0;
                    
                    // First check if the MFRC522 module is connected
                    if (!mfrc522_is_connected()) {
                        const char* msg = "RFID module not connected";
                        ble_server_notify((const uint8_t*)msg, strlen(msg));
                        continue;
                    }
                    
                    // Replace the full init with soft reset for write too
                    mfrc522_soft_reset();
                    ESP_LOGI(TAG, "MFRC522 reset completed");
                    
                    status = mfrc522_request(PICC_REQIDL, bufferATQA);
                    if (status != MI_OK) {
                        const char* msg = "No card detected";
                        ble_server_notify((const uint8_t*)msg, strlen(msg));
                        continue;
                    }
                    responsePacket[responseIndex++] = bufferATQA[0];
                    responsePacket[responseIndex++] = bufferATQA[1];
                    status = mfrc522_anticoll(CardUID);
                    if (status != MI_OK) {
                        responsePacket[responseIndex++] = 0xFF;
                        const char* msg = "Anticollision failed";
                        memcpy(&responsePacket[responseIndex], msg, strlen(msg));
                        ble_server_notify(responsePacket, responseIndex + strlen(msg));
                        continue;
                    }
                    for (int i = 0; i < 4; i++) {
                        responsePacket[responseIndex++] = CardUID[i];
                    }
                    status = mfrc522_select_tag(CardUID);
                    if (status == 0) {
                        responsePacket[responseIndex++] = 0xFF;
                        const char* msg = "Select tag failed";
                        memcpy(&responsePacket[responseIndex], msg, strlen(msg));
                        ble_server_notify(responsePacket, responseIndex + strlen(msg));
                        continue;
                    }
                    status = mfrc522_auth(authMode, blockAddr, key, CardUID);
                    if (status != MI_OK) {
                        responsePacket[responseIndex++] = 0xFF;
                        const char* msg = "Authentication failed";
                        memcpy(&responsePacket[responseIndex], msg, strlen(msg));
                        ble_server_notify(responsePacket, responseIndex + strlen(msg));
                        continue;
                    }
                    status = mfrc522_write(blockAddr, writeData);
                    if (status != MI_OK) {
                        responsePacket[responseIndex++] = 0xFF;
                        const char* msg = "Write failed";
                        memcpy(&responsePacket[responseIndex], msg, strlen(msg));
                        ble_server_notify(responsePacket, responseIndex + strlen(msg));
                        continue;
                    }
                    mfrc522_stop_crypto1();
                    const char* msg = "Success";
                    ble_server_notify((const uint8_t*)msg, strlen(msg));
                }
            }
            /* --- BadUSB commands --- */
            else if (cmd.length >= 4 && strncmp((char *)cmd.data, "usb", 3) == 0) {
                // Print the command and its bytes for debugging
                ESP_LOGI(TAG, "USB command received, length: %d", cmd.length);
                ESP_LOGI(TAG, "Command data: '%.*s'", cmd.length, cmd.data);
                
                // Everything after "usb " is the payload
                char* payload = (char*)&cmd.data[3];
                size_t payload_len = cmd.length - 3;
                
                // Skip the space after "usb" if present
                if (payload_len > 0 && payload[0] == ' ') {
                    payload++;
                    payload_len--;
                }
                
                // Temporarily null-terminate the payload for safety
                char saved = payload[payload_len];
                payload[payload_len] = '\0';

                // Print payload details
                ESP_LOGI(TAG, "Extracted payload: '%s', length: %d", payload, payload_len);

                // Check if the payload starts with known DuckyScript commands
                if (strncmp(payload, "ATTACKMODE", 10) == 0) {
                    // ATTACKMODE command - just acknowledge it since we're already in HID mode
                    ESP_LOGI(TAG, "BadUSB: ATTACKMODE command received");
                    badusb_install(); // Ensure BadUSB is installed
                    uint8_t resp = 1;
                    ble_server_notify(&resp, 1);
                }
                else if (strncmp(payload, "STRING_DELAY ", 13) == 0) {
                    // STRING_DELAY command - set the character delay in milliseconds
                    char* delay_str = payload + 13; // Skip "STRING_DELAY " prefix
                    int delay_ms = atoi(delay_str);
                    
                    if (delay_ms > 0 && delay_ms < 1000) {
                        // Set only the character delay
                        badusb_set_char_delay(delay_ms);

                        ESP_LOGI(TAG, "BadUSB: Setting character delay to %d ms", delay_ms);
                    } else {
                        ESP_LOGW(TAG, "BadUSB: Invalid delay value: %d (must be 1-999 ms)", delay_ms);
                    }
                    
                    // Always acknowledge
                    uint8_t resp = 1;
                    ble_server_notify(&resp, 1);
                }
                else if (strncmp(payload, "STRING ", 7) == 0) {
                    // STRING command - extract and send the actual string
                    char* string_content = payload + 7; // Skip "STRING " prefix
                    ESP_LOGI(TAG, "BadUSB: STRING command with content: %s", string_content);
                    
                    // Initialize BadUSB (if not already)
                    badusb_install();
                    
                    // Send the string content as keyboard input
                    badusb_send_string(string_content);
                    
                    // Acknowledge
                    uint8_t resp = 1;
                    ble_server_notify(&resp, 1);
                }
                else if (strncmp(payload, "DELAY", 5) == 0) {
                    // DELAY command - extract and implement the delay
                    ESP_LOGI(TAG, "BadUSB: DELAY command received");
                    // Just acknowledge, the actual delay is handled on the app side
                    uint8_t resp = 1;
                    ble_server_notify(&resp, 1);
                }
                else if (strncmp(payload, "ENTER", 5) == 0) {
                    // ENTER command - send an Enter key
                    ESP_LOGI(TAG, "BadUSB: ENTER command received");
                    
                    // Initialize BadUSB (if not already)
                    badusb_install();
                    
                    // Send Enter key
                    badusb_send_string("\n");
                    
                    // Acknowledge
                    uint8_t resp = 1;
                    ble_server_notify(&resp, 1);
                }
                else {
                    // Default case for raw text or unrecognized commands
                    ESP_LOGI(TAG, "BadUSB: Sending raw text: %s", payload);
                    
                    // Initialize BadUSB (if not already)
                    badusb_install();
                    
                    // Immediately send the payload as keyboard input
                    badusb_send_string(payload);
                    
                    // Optionally, send immediate feedback over BLE
                    uint8_t resp = 1;
                    ble_server_notify(&resp, 1);
                }
                
                // Restore the original character that was overwritten by null terminator
                payload[payload_len] = saved;
            }
        }
    }
}

// Create a sampler task
void sampler_task(void* pvParameters) {
    bool stop_requested = false;
    
    while(!stop_requested) {
        // Check for stop notification FIRST
        uint32_t notification = 0;
        if (xTaskNotifyWait(0, ULONG_MAX, &notification, 0) == pdTRUE) {
            if (notification == 1) {
                stop_requested = true;
                break; // Exit the loop immediately
            }
        }
        
        // Check if buffer is ready with a SHORT timeout
        if (xSemaphoreTake(buffer_ready_sem, 0) == pdTRUE) {
            // Transmit buffer over BLE with the notification characteristic
            ble_server_notify((uint8_t*)transmitBuffer, 256);
            vTaskDelay(pdMS_TO_TICKS(15)); // Add delay between packets for BLE throughput
        } else {
            // No buffer ready, just yield briefly
            vTaskDelay(pdMS_TO_TICKS(1));
        }
    }
    
    // Clean up when stop is requested
    ESP_LOGI(TAG, "Stopping sampling");
    stop_sampling();
    vSemaphoreDelete(buffer_ready_sem);
    buffer_ready_sem = NULL;
    sampler_task_handle = NULL;
    vTaskDelete(NULL);
}

void app_main(void)
{
    // Initialize NVS first
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Blink GPIO1 at startup (3 times)
    gpio_config_t io_conf1 = {
        .pin_bit_mask = (1ULL << 1),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    gpio_config(&io_conf1);
    for (int i = 0; i < 3; ++i) {
        gpio_set_level(1, 1);
        vTaskDelay(pdMS_TO_TICKS(200));
        gpio_set_level(1, 0);
        vTaskDelay(pdMS_TO_TICKS(200));
    }

    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << 4),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    gpio_config(&io_conf);
    gpio_set_level(4, 0); // Set GPIO4 low
    
    ESP_LOGI(TAG, "EMWaver initialized");

    // Initialize SPI for register operations
    ESP_ERROR_CHECK(cc1101_init());
    ESP_LOGI(TAG, "SPI interface initialized");

    // Initialize MFRC522 only once at startup
    ESP_ERROR_CHECK(mfrc522_init(&mfrc522_cfg));
    ESP_LOGI(TAG, "MFRC522 initialized");

    /* ---------- RTOS resources ---------- */
    cmd_queue = xQueueCreate(CMD_QUEUE_LEN, sizeof(command_t));
    configASSERT(cmd_queue != NULL);

    // Initialize BLE server with the command queue
    ble_server_init(cmd_queue);
    ESP_LOGI(TAG, "BLE server initialized");

    xTaskCreate(command_task, "cmd_task", 4096, NULL, 5, NULL);

    ESP_LOGI("MEM", "Free heap: %d bytes", heap_caps_get_free_size(MALLOC_CAP_8BIT));

    /* app_main task finished – hand over to the scheduler */
    vTaskDelete(NULL);
}
