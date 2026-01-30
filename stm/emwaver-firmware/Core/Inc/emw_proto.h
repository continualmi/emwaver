#pragma once

// EMWaver binary command protocol (cmd lane: 18 bytes)
//
// Request: [opcode, args...]
// Response: [status, payload...]
// - status: 0 = OK, nonzero = error code
// - payload: command-specific (length is implied by the opcode and/or request)
// - responses are returned in the cmd lane of the next outgoing frame

#include <stdint.h>

// Response status bytes are >= 0x80 so an "empty" cmd lane (all zeros) is unambiguous.
#define EMW_RESP_STATUS_OK  0x80u
#define EMW_RESP_STATUS_ERR 0x81u

#define EMW_RESP_MAX_PAYLOAD 17u

// System
#define EMW_OP_VERSION 0x01u
#define EMW_OP_RESET   0x02u
#define EMW_OP_HELP    0x03u

// Firmware update
// Enter ROM DFU update mode (STM32F042: implemented by erasing initial flash pages then reset).
#define EMW_OP_ENTER_DFU 0x06u

// Name
#define EMW_OP_NAME_GET 0x04u
#define EMW_OP_NAME_SET 0x05u

// GPIO
#define EMW_OP_GPIO 0x10u
#define EMW_GPIO_IN    0x00u
#define EMW_GPIO_OUT   0x01u
#define EMW_GPIO_READ  0x02u
#define EMW_GPIO_HIGH  0x03u
#define EMW_GPIO_LOW   0x04u
#define EMW_GPIO_PULL  0x05u
#define EMW_GPIO_INFO  0x06u

// ADC
#define EMW_OP_ADC_READ 0x20u
#define EMW_ADC_SRC_PIN     0x00u
#define EMW_ADC_SRC_TEMP    0x01u
#define EMW_ADC_SRC_VREFINT 0x02u
#define EMW_ADC_SRC_VBAT    0x03u

// UART
#define EMW_OP_UART 0x30u
#define EMW_UART_OPEN  0x00u
#define EMW_UART_CLOSE 0x01u
#define EMW_UART_WRITE 0x02u
#define EMW_UART_READ  0x03u

// I2C
#define EMW_OP_I2C 0x40u
#define EMW_I2C_OPEN  0x00u
#define EMW_I2C_CLOSE 0x01u
#define EMW_I2C_WRITE 0x02u
#define EMW_I2C_READ  0x03u
#define EMW_I2C_XFER  0x04u

// SPI
#define EMW_OP_SPI_XFER 0x50u

// Sampler
#define EMW_OP_SAMPLE 0x60u
#define EMW_SAMPLE_START 0x00u
#define EMW_SAMPLE_STOP  0x01u

// PWM
#define EMW_OP_PWM 0x70u
#define EMW_PWM_FREQ  0x00u
#define EMW_PWM_WRITE 0x01u
#define EMW_PWM_STOP  0x02u

// Transmit
#define EMW_OP_TRANSMIT 0x80u
#define EMW_TRANSMIT_START 0x00u
#define EMW_TRANSMIT_STOP  0x01u
