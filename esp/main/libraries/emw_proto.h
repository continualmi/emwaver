#pragma once

#include <stdint.h>

#define EMW_RESP_STATUS_OK  0x80u
#define EMW_RESP_STATUS_ERR 0x81u

#define EMW_RESP_MAX_PAYLOAD 17u

#define EMW_OP_VERSION 0x01u
#define EMW_OP_RESET   0x02u
#define EMW_OP_HELP    0x03u
#define EMW_OP_NAME_GET 0x04u
#define EMW_OP_NAME_SET 0x05u
#define EMW_OP_ENTER_DFU 0x06u
#define EMW_OP_IDENTITY_GET 0x07u
#define EMW_OP_HARDWARE_UID_GET 0x08u
#define EMW_OP_BOARD_GET 0x09u

#define EMW_IDENTITY_DEVICE_ID 0x00u
#define EMW_IDENTITY_PROOF     0x01u

#define EMW_OP_GPIO 0x10u
#define EMW_GPIO_IN    0x00u
#define EMW_GPIO_OUT   0x01u
#define EMW_GPIO_READ  0x02u
#define EMW_GPIO_HIGH  0x03u
#define EMW_GPIO_LOW   0x04u
#define EMW_GPIO_PULL  0x05u
#define EMW_GPIO_INFO  0x06u

#define EMW_OP_ADC_READ 0x20u
#define EMW_ADC_SRC_PIN     0x00u
#define EMW_ADC_SRC_TEMP    0x01u
#define EMW_ADC_SRC_VREFINT 0x02u
#define EMW_ADC_SRC_VBAT    0x03u

#define EMW_OP_UART 0x30u
#define EMW_UART_OPEN  0x00u
#define EMW_UART_CLOSE 0x01u
#define EMW_UART_WRITE 0x02u
#define EMW_UART_READ  0x03u

#define EMW_OP_I2C 0x40u
#define EMW_I2C_OPEN  0x00u
#define EMW_I2C_CLOSE 0x01u
#define EMW_I2C_WRITE 0x02u
#define EMW_I2C_READ  0x03u
#define EMW_I2C_XFER  0x04u

#define EMW_OP_SPI_XFER 0x50u

#define EMW_OP_SAMPLE 0x60u
#define EMW_SAMPLE_START 0x00u
#define EMW_SAMPLE_STOP  0x01u

#define EMW_OP_PWM 0x70u
#define EMW_PWM_FREQ  0x00u
#define EMW_PWM_WRITE 0x01u
#define EMW_PWM_STOP  0x02u

#define EMW_OP_TRANSMIT 0x80u
#define EMW_TRANSMIT_START 0x00u
#define EMW_TRANSMIT_STOP  0x01u
