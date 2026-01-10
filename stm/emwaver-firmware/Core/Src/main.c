/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : Main program body
  ******************************************************************************
  * @attention
  *
  * Copyright (c) 2024 STMicroelectronics.
  * All rights reserved.
  *
  * This software is licensed under terms that can be found in the LICENSE file
  * in the root directory of this software component.
  * If no LICENSE file comes with this software, it is provided AS-IS.
  *
  ******************************************************************************
  *
  * EMWaver modifications
  * Copyright (c) 2026 Luís Marnoto
*/
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"
#include "usb_device.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include "emwaver_usb_io.h"
/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */
#define CDC_TIMEOUT 100
#define EMWAVER_FIRMWARE_WELCOME "Welcome to EMWaver firmware"
#define EMWAVER_FIRMWARE_VERSION "1.0.0"
/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/
SPI_HandleTypeDef hspi1;

TIM_HandleTypeDef htim1;
TIM_HandleTypeDef htim2;
TIM_HandleTypeDef htim3;

/* USER CODE BEGIN PV */
static GPIO_TypeDef *samplerPort = GPIOA;
static uint16_t samplerPin = GPIO_PIN_0;
volatile uint32_t selectedChannel = TIM_CHANNEL_3; // Default to channel 3 for backward compatibility

uint8_t * bulk_packet = NULL;
size_t bulk_packet_len = 0;

volatile uint8_t* bufferA = NULL;
volatile uint8_t* bufferB = NULL;
volatile uint8_t* currentBuffer = NULL;
volatile uint8_t* transmitBuffer = NULL;
volatile int bufferIndex = 0;
volatile uint8_t bufferReady = 0;

volatile EMW_Buffer_Type emw_buf_type = EMW_BUFFER_PACKET;
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_TIM2_Init(void);
static void MX_TIM1_Init(void);
static void MX_TIM3_Init(void);
static void MX_SPI1_Init(void);
/* USER CODE BEGIN PFP */
/* USER CODE END PFP */

/* Private user code ---------------------------------------------------------*/
/* USER CODE BEGIN 0 */

#define USER_DATA_FLASH_ADDR 0x08007C00
#define DEVICE_NAME_MAX_LEN 32

void get_device_name(char* buf, size_t max_len) {
    uint8_t* flash_ptr = (uint8_t*)USER_DATA_FLASH_ADDR;
    if (flash_ptr[0] == 0xFF) {
        buf[0] = '\0';
        return;
    }
    size_t i;
    for (i = 0; i < max_len - 1; i++) {
        if (flash_ptr[i] == 0xFF || flash_ptr[i] == '\0') break;
        buf[i] = (char)flash_ptr[i];
    }
    buf[i] = '\0';
}

#define ISM_BURST_MAX 64u
#define EMW_LANE_SIZE 64u
#define EMW_SUPERFRAME_SIZE 128u
#define EMW_CMD_MARKER 0xA5u

typedef enum {
    ISM_MODE_IDLE = 0,
    ISM_MODE_RAW_SAMPLING = 1,
} ism_mode_t;

static volatile ism_mode_t ism_mode = ISM_MODE_IDLE;
volatile uint8_t pending_cmd_lane[EMW_LANE_SIZE];
volatile uint8_t pending_cmd_ready = 0;


static void free_bulk_packet(void)
{
    if (bulk_packet != NULL) {
        free(bulk_packet);
        bulk_packet = NULL;
        bulk_packet_len = 0;
    }
}

static void command_send_ok(const uint8_t *data, size_t len)
{
    // Always send fixed-size 128B superframes:
    // - lane0[0..63]: command/response
    // - lane1[64..127]: stream/BS (zero-filled for normal commands)
    if (!data || len == 0) {
        uint8_t superframe[EMW_SUPERFRAME_SIZE] = {0};
        superframe[0] = 0x00;
        superframe[EMW_LANE_SIZE - 1u] = EMW_CMD_MARKER;
        if (ism_mode == ISM_MODE_RAW_SAMPLING || EMW_USB_GetBufferType_FS() == EMW_BUFFER_CIRCULAR) {
            memcpy((void *)pending_cmd_lane, superframe, EMW_LANE_SIZE);
            pending_cmd_ready = 1;
            return;
        }
        (void)EMW_USB_SendResponsePkt_FS(superframe, (uint16_t)sizeof(superframe), CDC_TIMEOUT);
        return;
    }

    if (ism_mode == ISM_MODE_RAW_SAMPLING || EMW_USB_GetBufferType_FS() == EMW_BUFFER_CIRCULAR) {
        // Sampling / retransmit mode: keep command semantics simple (single response lane).
        // Anything beyond the first 64 bytes is dropped.
        uint8_t lane[EMW_LANE_SIZE] = {0};
        size_t chunk = len > (EMW_LANE_SIZE - 1u) ? (EMW_LANE_SIZE - 1u) : len;
        memcpy(lane, data, chunk);
        lane[EMW_LANE_SIZE - 1u] = EMW_CMD_MARKER;
        memcpy((void *)pending_cmd_lane, lane, EMW_LANE_SIZE);
        pending_cmd_ready = 1;
        return;
    }

    size_t offset = 0;
    while (offset < len) {
        uint8_t superframe[EMW_SUPERFRAME_SIZE] = {0};
        size_t chunk = len - offset;
        if (chunk > (EMW_LANE_SIZE - 1u)) {
            chunk = EMW_LANE_SIZE - 1u;
        }
        memcpy(&superframe[0], data + offset, chunk);
        superframe[EMW_LANE_SIZE - 1u] = EMW_CMD_MARKER;
        (void)EMW_USB_SendResponsePkt_FS(superframe, (uint16_t)sizeof(superframe), CDC_TIMEOUT);
        offset += chunk;
    }
}

static void command_send_err(const char *msg)
{
    (void)msg;
    // Match the registry firmware behavior: errors are best-effort no-ops.
    uint8_t lane[EMW_LANE_SIZE] = {0};
    lane[EMW_LANE_SIZE - 1u] = EMW_CMD_MARKER;
    if (ism_mode == ISM_MODE_RAW_SAMPLING || EMW_USB_GetBufferType_FS() == EMW_BUFFER_CIRCULAR) {
        memcpy((void *)pending_cmd_lane, lane, EMW_LANE_SIZE);
        pending_cmd_ready = 1;
        return;
    }
    uint8_t superframe[EMW_SUPERFRAME_SIZE] = {0};
    memcpy(&superframe[0], lane, EMW_LANE_SIZE);
    (void)EMW_USB_SendResponsePkt_FS((uint8_t *)superframe, (uint16_t)sizeof(superframe), CDC_TIMEOUT);
}

static void ISR_Sampler_raw(void)
{
    static uint8_t bitIndex = 0;
    static uint8_t currentByte = 0;

    uint8_t pin_state = HAL_GPIO_ReadPin(samplerPort, samplerPin);

    if (pin_state) {
        currentByte |= (uint8_t)(1u << bitIndex);
    } else {
        currentByte &= (uint8_t)~(1u << bitIndex);
    }

    bitIndex++;
    if (bitIndex >= 8) {
        currentBuffer[bufferIndex] = currentByte;
        bufferIndex++;
        bitIndex = 0;
        currentByte = 0;

        if (bufferIndex >= 64) {
            transmitBuffer = currentBuffer;
            currentBuffer = (currentBuffer == bufferA) ? bufferB : bufferA;
            bufferIndex = 0;
            bufferReady = 1;
        }
    }
}

static void startPWM_TIM2(uint32_t channel)
{
    TIM2->CR1 |= TIM_CR1_CEN;
    switch (channel) {
        case TIM_CHANNEL_1:
            TIM2->CCER |= TIM_CCER_CC1E;
            break;
        case TIM_CHANNEL_2:
            TIM2->CCER |= TIM_CCER_CC2E;
            break;
        case TIM_CHANNEL_3:
            TIM2->CCER |= TIM_CCER_CC3E;
            break;
        case TIM_CHANNEL_4:
            TIM2->CCER |= TIM_CCER_CC4E;
            break;
        default:
            break;
    }
}

static void stopPWM_TIM2(uint32_t channel)
{
    switch (channel) {
        case TIM_CHANNEL_1:
            TIM2->CCER &= (uint16_t)~TIM_CCER_CC1E;
            break;
        case TIM_CHANNEL_2:
            TIM2->CCER &= (uint16_t)~TIM_CCER_CC2E;
            break;
        case TIM_CHANNEL_3:
            TIM2->CCER &= (uint16_t)~TIM_CCER_CC3E;
            break;
        case TIM_CHANNEL_4:
            TIM2->CCER &= (uint16_t)~TIM_CCER_CC4E;
            break;
        default:
            break;
    }
}

static void ISR_Sampler_writing(void)
{
    static uint8_t bitIndex = 0;
    static uint8_t currentByte = 0;

    if (EMW_USB_GetRxBufferBytesAvailable_FS() > 0) {
        if (bitIndex == 0) {
            (void)EMW_USB_ReadRxBuffer_FS(&currentByte, 1);
        }

        if (currentByte & (uint8_t)(1u << bitIndex)) {
            startPWM_TIM2(selectedChannel);
        } else {
            stopPWM_TIM2(selectedChannel);
        }

        bitIndex++;
        if (bitIndex > 7) {
            bitIndex = 0;
        }
    } else {
        stopPWM_TIM2(selectedChannel);
    }
}

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim)
{
    if (htim == &htim3) {
        switch (EMW_USB_GetBufferType_FS()) {
            case EMW_BUFFER_CIRCULAR:
                ISR_Sampler_writing();
                break;
            case EMW_BUFFER_DOUBLE:
                ISR_Sampler_raw();
                break;
            case EMW_BUFFER_PACKET:
            default:
                break;
        }
    }
}

static void enable_gpio_clock(GPIO_TypeDef *port)
{
    if (port == GPIOA) {
        __HAL_RCC_GPIOA_CLK_ENABLE();
    } else if (port == GPIOB) {
        __HAL_RCC_GPIOB_CLK_ENABLE();
    }
}

static void configurePin(GPIO_TypeDef *port, uint16_t pin, uint32_t mode, uint32_t pull)
{
    GPIO_InitTypeDef GPIO_InitStruct = {0};

    enable_gpio_clock(port);
    GPIO_InitStruct.Pin = pin;
    GPIO_InitStruct.Mode = mode;
    GPIO_InitStruct.Pull = pull;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    if (mode == GPIO_MODE_AF_PP) {
        GPIO_InitStruct.Alternate = GPIO_AF2_TIM2;
    }
    HAL_GPIO_Init(port, &GPIO_InitStruct);
}

static void setDutyCycle_TIM2(uint32_t channel, uint8_t percentage)
{
    if (percentage < 1) percentage = 1;
    if (percentage > 100) percentage = 100;

    uint32_t period = TIM2->ARR;
    uint32_t new_ccr = (period * (uint32_t)percentage) / 100u;

    switch (channel) {
        case TIM_CHANNEL_1:
            TIM2->CCR1 = new_ccr;
            break;
        case TIM_CHANNEL_2:
            TIM2->CCR2 = new_ccr;
            break;
        case TIM_CHANNEL_3:
            TIM2->CCR3 = new_ccr;
            break;
        case TIM_CHANNEL_4:
            TIM2->CCR4 = new_ccr;
            break;
        default:
            break;
    }
}

// -----------------------------------------------------------------------------
// PWM (analogWrite) support
// -----------------------------------------------------------------------------

static bool tim2_channel_from_pin(GPIO_TypeDef *port, uint8_t pin_index, uint32_t *out_channel)
{
    if (!out_channel) {
        return false;
    }
    if (port != GPIOA) {
        return false;
    }

    switch (pin_index) {
        case 0: *out_channel = TIM_CHANNEL_1; return true;
        case 1: *out_channel = TIM_CHANNEL_2; return true;
        case 2: *out_channel = TIM_CHANNEL_3; return true;
        case 3: *out_channel = TIM_CHANNEL_4; return true;
        default: return false;
    }
}

static uint16_t tim2_ccer_mask_from_channel(uint32_t channel)
{
    switch (channel) {
        case TIM_CHANNEL_1: return TIM_CCER_CC1E;
        case TIM_CHANNEL_2: return TIM_CCER_CC2E;
        case TIM_CHANNEL_3: return TIM_CCER_CC3E;
        case TIM_CHANNEL_4: return TIM_CCER_CC4E;
        default: return 0;
    }
}

static void tim2_stop_pwm_channel(uint32_t channel)
{
    uint16_t mask = tim2_ccer_mask_from_channel(channel);
    if (mask) {
        TIM2->CCER &= (uint16_t)~mask;
    }
    stopPWM_TIM2(channel);
    (void)HAL_TIM_PWM_Stop(&htim2, channel);
}

static void tim2_set_ccr_from_u12(uint32_t channel, uint16_t value_u12)
{
    uint32_t arr = TIM2->ARR;
    uint32_t period = arr + 1u;

    uint32_t ccr = (period * (uint32_t)value_u12 + 2047u) / 4095u;
    if (ccr > arr) {
        ccr = arr;
    }

    switch (channel) {
        case TIM_CHANNEL_1: TIM2->CCR1 = ccr; break;
        case TIM_CHANNEL_2: TIM2->CCR2 = ccr; break;
        case TIM_CHANNEL_3: TIM2->CCR3 = ccr; break;
        case TIM_CHANNEL_4: TIM2->CCR4 = ccr; break;
        default: break;
    }
}

static bool tim2_set_pwm_hz(uint32_t hz)
{
    if (hz < 1u) {
        return false;
    }

    // TIM2 is on APB1. With the current clocking, APB1 == HCLK.
    uint32_t timclk = HAL_RCC_GetHCLKFreq();
    if (timclk == 0u) {
        timclk = 48000000u;
    }

    // Keep it simple: prescaler=0, adjust ARR (TIM2 is 32-bit on STM32F0).
    uint32_t ticks = timclk / hz;
    if (ticks < 2u) {
        ticks = 2u;
    }
    TIM2->PSC = 0u;
    TIM2->ARR = ticks - 1u;
    TIM2->EGR = TIM_EGR_UG;
    return true;
}

static void stop_sampling(void)
{
    HAL_TIM_Base_Stop_IT(&htim3);
    EMW_USB_SetBufferType_FS(EMW_BUFFER_PACKET);

    free((void *)bufferA);
    free((void *)bufferB);
    bufferA = NULL;
    bufferB = NULL;
    currentBuffer = NULL;
    transmitBuffer = NULL;
    bufferIndex = 0;
    bufferReady = 0;
    ism_mode = ISM_MODE_IDLE;
}

static void send_sampling_superframe(const uint8_t *stream_lane)
{
    uint8_t superframe[EMW_SUPERFRAME_SIZE] = {0};
    if (pending_cmd_ready) {
        memcpy(&superframe[0], (const void *)pending_cmd_lane, EMW_LANE_SIZE);
    }

    if (stream_lane != NULL) {
        memcpy(&superframe[EMW_LANE_SIZE], stream_lane, EMW_LANE_SIZE);
    }

    (void)EMW_USB_SendResponsePkt_FS(superframe, (uint16_t)sizeof(superframe), CDC_TIMEOUT);
    pending_cmd_ready = 0;
}

static bool decode_encoded_pin(int encoded, GPIO_TypeDef **out_port, uint16_t *out_pin)
{
    if (!out_port || !out_pin) {
        return false;
    }
    if (encoded >= 0 && encoded <= 15) {
        *out_port = GPIOA;
        *out_pin = (uint16_t)(1u << encoded);
        return true;
    }
    if (encoded >= 16 && encoded <= 31) {
        *out_port = GPIOB;
        *out_pin = (uint16_t)(1u << (encoded - 16));
        return true;
    }
    return false;
}

static bool pin_mask_to_index(uint16_t pin_mask, uint8_t *out_index)
{
    if (!out_index) {
        return false;
    }
    if (pin_mask == 0) {
        return false;
    }
    for (uint8_t i = 0; i < 16; i++) {
        if (pin_mask == (uint16_t)(1u << i)) {
            *out_index = i;
            return true;
        }
    }
    return false;
}

static void gpio_write_latch(GPIO_TypeDef *port, uint16_t pin_mask, bool value)
{
    if (!port) {
        return;
    }
    if (value) {
        port->BSRR = pin_mask;
    } else {
        port->BSRR = (uint32_t)pin_mask << 16;
    }
}

static void disable_tim2_output_if_needed(GPIO_TypeDef *port, uint8_t pin_index)
{
    if (port != GPIOA) {
        return;
    }

    uint32_t channel = 0;
    uint16_t ccer_mask = 0;
    switch (pin_index) {
        case 0:
            channel = TIM_CHANNEL_1;
            ccer_mask = TIM_CCER_CC1E;
            break;
        case 1:
            channel = TIM_CHANNEL_2;
            ccer_mask = TIM_CCER_CC2E;
            break;
        case 2:
            channel = TIM_CHANNEL_3;
            ccer_mask = TIM_CCER_CC3E;
            break;
        case 3:
            channel = TIM_CHANNEL_4;
            ccer_mask = TIM_CCER_CC4E;
            break;
        default:
            return;
    }

    TIM2->CCER &= (uint16_t)~ccer_mask;
    (void)HAL_TIM_PWM_Stop(&htim2, channel);
}

static void gpio_set_mode(GPIO_TypeDef *port, uint16_t pin_mask, uint32_t mode, uint32_t pull)
{
    if (!port) {
        return;
    }
    enable_gpio_clock(port);
    HAL_GPIO_DeInit(port, pin_mask);
    configurePin(port, pin_mask, mode, pull);
}

// -----------------------------------------------------------------------------
// ADC (analogRead) support
// -----------------------------------------------------------------------------

static bool adc_initialized = false;

static void adc_init_once(void)
{
    if (adc_initialized) {
        return;
    }

    // Enable ADC clock.
    RCC->APB2ENR |= RCC_APB2ENR_ADC1EN;

    // Ensure ADC is disabled before calibration/config.
    if (ADC1->CR & ADC_CR_ADEN) {
        ADC1->CR |= ADC_CR_ADDIS;
        for (volatile uint32_t guard = 0; guard < 1000000u; ++guard) {
            if ((ADC1->CR & ADC_CR_ADEN) == 0) {
                break;
            }
        }
    }

    // ADC calibration.
    ADC1->CR |= ADC_CR_ADCAL;
    for (volatile uint32_t guard = 0; guard < 1000000u; ++guard) {
        if ((ADC1->CR & ADC_CR_ADCAL) == 0) {
            break;
        }
    }

    // 12-bit, right-aligned, single conversion; ADC clocked by PCLK/2.
    ADC1->CFGR1 = 0;
    ADC1->CFGR2 = (ADC1->CFGR2 & ~ADC_CFGR2_CKMODE) | ADC_CFGR2_CKMODE_0;

    // Use a long sampling time to support VREFINT/TEMP/VBAT reliably.
    ADC1->SMPR = (ADC_SMPR_SMP_0 | ADC_SMPR_SMP_1 | ADC_SMPR_SMP_2);

    // Enable ADC.
    ADC1->ISR |= ADC_ISR_ADRDY;
    ADC1->CR |= ADC_CR_ADEN;
    for (volatile uint32_t guard = 0; guard < 1000000u; ++guard) {
        if (ADC1->ISR & ADC_ISR_ADRDY) {
            break;
        }
    }

    adc_initialized = true;
}

static bool adc_channel_from_pin(GPIO_TypeDef *port, uint8_t pin_index, uint32_t *out_chsel_bit)
{
    if (!out_chsel_bit || !port) {
        return false;
    }

    int channel = -1;
    if (port == GPIOA) {
        // STM32F042 ADC_IN0..7 map to PA0..PA7.
        if (pin_index <= 7u) {
            channel = (int)pin_index;
        }
    } else if (port == GPIOB) {
        // STM32F042 ADC_IN8..9 map to PB0..PB1.
        if (pin_index <= 1u) {
            channel = 8 + (int)pin_index;
        }
    }

    if (channel < 0 || channel > 18) {
        return false;
    }

    *out_chsel_bit = (uint32_t)(1u << (uint32_t)channel);
    return true;
}

static bool adc_read_single(uint32_t chsel_bit, uint16_t *out_value)
{
    if (!out_value) {
        return false;
    }

    adc_init_once();
    if (!adc_initialized) {
        return false;
    }

    // Stop any ongoing conversion.
    if (ADC1->CR & ADC_CR_ADSTART) {
        ADC1->CR |= ADC_CR_ADSTP;
        for (volatile uint32_t guard = 0; guard < 1000000u; ++guard) {
            if ((ADC1->CR & ADC_CR_ADSTART) == 0) {
                break;
            }
        }
    }

    // Select exactly one channel.
    ADC1->CHSELR = chsel_bit;

    // Clear status flags.
    ADC1->ISR |= (ADC_ISR_EOC | ADC_ISR_EOS | ADC_ISR_OVR);

    // Start conversion and wait for EOC.
    ADC1->CR |= ADC_CR_ADSTART;
    for (volatile uint32_t guard = 0; guard < 1000000u; ++guard) {
        if (ADC1->ISR & ADC_ISR_EOC) {
            uint16_t v = (uint16_t)(ADC1->DR & 0xFFFFu);
            *out_value = v;
            return true;
        }
    }

    return false;
}

// -----------------------------------------------------------------------------
// UART/I2C support (PB6/PB7)
// -----------------------------------------------------------------------------

typedef enum {
    BUS_OWNER_NONE = 0,
    BUS_OWNER_UART1 = 1,
    BUS_OWNER_I2C1 = 2,
} bus_owner_t;

static bus_owner_t bus_owner = BUS_OWNER_NONE;

static bool uart1_initialized = false;
static uint32_t uart1_baud = 115200u;

static bool i2c1_initialized = false;
static uint32_t i2c1_hz = 100000u;

static void gpio_release_pb6_pb7(void)
{
    __HAL_RCC_GPIOB_CLK_ENABLE();
    HAL_GPIO_DeInit(GPIOB, GPIO_PIN_6 | GPIO_PIN_7);
}

static void uart1_deinit(void)
{
    if (USART1->CR1 & USART_CR1_UE) {
        USART1->CR1 &= ~USART_CR1_UE;
        for (volatile uint32_t guard = 0; guard < 1000000u; ++guard) {
            if ((USART1->CR1 & USART_CR1_UE) == 0) {
                break;
            }
        }
    }
    RCC->APB2ENR &= ~RCC_APB2ENR_USART1EN;
    gpio_release_pb6_pb7();

    uart1_initialized = false;
    if (bus_owner == BUS_OWNER_UART1) {
        bus_owner = BUS_OWNER_NONE;
    }
}

static bool uart1_ensure(uint32_t baud)
{
    if (baud == 0) {
        baud = 115200u;
    }

    if (bus_owner == BUS_OWNER_UART1 && uart1_initialized && uart1_baud == baud) {
        return true;
    }

    if (bus_owner == BUS_OWNER_I2C1) {
        // Deinit I2C before taking over the pins/peripheral clocks.
        i2c1_initialized = false;
        I2C1->CR1 &= ~I2C_CR1_PE;
        RCC->APB1ENR &= ~RCC_APB1ENR_I2C1EN;
        gpio_release_pb6_pb7();
        bus_owner = BUS_OWNER_NONE;
    }

    // Configure PB6/PB7 as USART1 TX/RX (AF0).
    __HAL_RCC_GPIOB_CLK_ENABLE();
    GPIO_InitTypeDef GPIO_InitStruct = {0};
    GPIO_InitStruct.Pin = GPIO_PIN_6 | GPIO_PIN_7;
    GPIO_InitStruct.Mode = GPIO_MODE_AF_PP;
    GPIO_InitStruct.Pull = GPIO_PULLUP;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    GPIO_InitStruct.Alternate = GPIO_AF0_USART1;
    HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);

    // Enable USART1 clock and (re)configure.
    RCC->APB2ENR |= RCC_APB2ENR_USART1EN;

    // Disable UE while configuring.
    USART1->CR1 &= ~USART_CR1_UE;

    uint32_t pclk = HAL_RCC_GetHCLKFreq();
    if (pclk == 0) {
        pclk = 48000000u;
    }
    uint32_t brr = (pclk + (baud / 2u)) / baud;
    if (brr == 0) {
        brr = 1;
    }
    USART1->BRR = brr;

    // 8N1, oversampling 16, enable TX/RX.
    USART1->CR2 = 0;
    USART1->CR3 = 0;
    USART1->CR1 = USART_CR1_TE | USART_CR1_RE;

    USART1->ICR = 0xFFFFFFFFu;
    USART1->RQR = USART_RQR_RXFRQ;

    USART1->CR1 |= USART_CR1_UE;

    uart1_baud = baud;
    uart1_initialized = true;
    bus_owner = BUS_OWNER_UART1;
    return true;
}

static bool uart1_write(const uint8_t *data, size_t len, uint32_t timeout_ms, size_t *out_written)
{
    if (out_written) {
        *out_written = 0;
    }
    if (!data || len == 0) {
        return true;
    }
    if (!uart1_ensure(uart1_baud)) {
        return false;
    }

    uint32_t start = HAL_GetTick();
    for (size_t i = 0; i < len; ++i) {
        while ((USART1->ISR & USART_ISR_TXE) == 0) {
            if ((HAL_GetTick() - start) > timeout_ms) {
                return false;
            }
        }
        USART1->TDR = data[i];
        if (out_written) {
            *out_written = i + 1;
        }
    }

    while ((USART1->ISR & USART_ISR_TC) == 0) {
        if ((HAL_GetTick() - start) > timeout_ms) {
            return false;
        }
    }

    return true;
}

static bool uart1_read(uint8_t *out, size_t len, uint32_t timeout_ms, size_t *out_read)
{
    if (out_read) {
        *out_read = 0;
    }
    if (!out || len == 0) {
        return true;
    }
    if (!uart1_ensure(uart1_baud)) {
        return false;
    }

    uint32_t start = HAL_GetTick();
    size_t got = 0;
    while (got < len) {
        if (USART1->ISR & USART_ISR_RXNE) {
            out[got++] = (uint8_t)(USART1->RDR & 0xFFu);
            if (out_read) {
                *out_read = got;
            }
            start = HAL_GetTick(); // reset timeout after progress
            continue;
        }
        if ((HAL_GetTick() - start) > timeout_ms) {
            break;
        }
    }
    return true;
}

static uint32_t i2c1_timing_for_hz(uint32_t hz)
{
    // NOTE: These are intentionally conservative, "works on short wires" timings for a 48 MHz core clock.
    // The goal is a simple bring-up path (Wire-like I2C), not perfect spec edge coverage.
    //
    // TIMINGR fields: PRESC[31:28], SCLDEL[23:20], SDADEL[19:16], SCLH[15:8], SCLL[7:0].
    if (hz >= 400000u) {
        // ~400 kHz (@48 MHz).
        return 0x00213B3Bu;
    }
    // ~100 kHz (@48 MHz).
    return 0x10427777u;
}

static void i2c1_deinit(void)
{
    if (I2C1->CR1 & I2C_CR1_PE) {
        I2C1->CR1 &= ~I2C_CR1_PE;
    }
    RCC->APB1ENR &= ~RCC_APB1ENR_I2C1EN;
    gpio_release_pb6_pb7();

    i2c1_initialized = false;
    if (bus_owner == BUS_OWNER_I2C1) {
        bus_owner = BUS_OWNER_NONE;
    }
}

static bool i2c1_ensure(uint32_t hz)
{
    if (hz == 0) {
        hz = 100000u;
    }

    if (bus_owner == BUS_OWNER_I2C1 && i2c1_initialized && i2c1_hz == hz) {
        return true;
    }

    if (bus_owner == BUS_OWNER_UART1) {
        uart1_deinit();
    }

    // Configure PB6/PB7 as I2C1 SCL/SDA (AF1, open-drain).
    __HAL_RCC_GPIOB_CLK_ENABLE();
    GPIO_InitTypeDef GPIO_InitStruct = {0};
    GPIO_InitStruct.Pin = GPIO_PIN_6 | GPIO_PIN_7;
    GPIO_InitStruct.Mode = GPIO_MODE_AF_OD;
    GPIO_InitStruct.Pull = GPIO_PULLUP;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    GPIO_InitStruct.Alternate = GPIO_AF1_I2C1;
    HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);

    // Enable and reset I2C1.
    RCC->APB1ENR |= RCC_APB1ENR_I2C1EN;
    RCC->APB1RSTR |= RCC_APB1RSTR_I2C1RST;
    RCC->APB1RSTR &= ~RCC_APB1RSTR_I2C1RST;

    I2C1->CR1 &= ~I2C_CR1_PE;
    I2C1->TIMINGR = i2c1_timing_for_hz(hz);
    I2C1->ICR = 0xFFFFFFFFu;
    I2C1->CR1 = I2C_CR1_PE;

    i2c1_hz = hz;
    i2c1_initialized = true;
    bus_owner = BUS_OWNER_I2C1;
    return true;
}

static bool i2c1_wait_flag(uint32_t isr_mask, bool set, uint32_t timeout_ms)
{
    uint32_t start = HAL_GetTick();
    while (1) {
        bool is_set = (I2C1->ISR & isr_mask) != 0;
        if (is_set == set) {
            return true;
        }
        if ((HAL_GetTick() - start) > timeout_ms) {
            return false;
        }
        if (I2C1->ISR & (I2C_ISR_NACKF | I2C_ISR_BERR | I2C_ISR_ARLO)) {
            return false;
        }
    }
}

static void i2c1_clear_errors(void)
{
    I2C1->ICR = I2C_ICR_NACKCF | I2C_ICR_BERRCF | I2C_ICR_ARLOCF | I2C_ICR_STOPCF;
}

static bool i2c1_write_then_maybe_stop(uint8_t addr7, const uint8_t *data, size_t len, bool send_stop, uint32_t timeout_ms)
{
    if (!i2c1_ensure(i2c1_hz)) {
        return false;
    }
    if (addr7 > 0x7F) {
        return false;
    }

    i2c1_clear_errors();
    I2C1->CR2 =
        ((uint32_t)addr7 << 1) |
        ((uint32_t)len << I2C_CR2_NBYTES_Pos) |
        (send_stop ? I2C_CR2_AUTOEND : 0) |
        I2C_CR2_START;

    for (size_t i = 0; i < len; ++i) {
        if (!i2c1_wait_flag(I2C_ISR_TXIS, true, timeout_ms)) {
            return false;
        }
        I2C1->TXDR = data[i];
    }

    if (send_stop) {
        if (!i2c1_wait_flag(I2C_ISR_STOPF, true, timeout_ms)) {
            return false;
        }
        I2C1->ICR = I2C_ICR_STOPCF;
    } else {
        if (!i2c1_wait_flag(I2C_ISR_TC, true, timeout_ms)) {
            return false;
        }
    }
    return true;
}

static bool i2c1_read_with_stop(uint8_t addr7, uint8_t *out, size_t len, uint32_t timeout_ms)
{
    if (!i2c1_ensure(i2c1_hz)) {
        return false;
    }
    if (!out || len == 0) {
        return true;
    }
    if (addr7 > 0x7F) {
        return false;
    }

    i2c1_clear_errors();
    I2C1->CR2 =
        ((uint32_t)addr7 << 1) |
        ((uint32_t)len << I2C_CR2_NBYTES_Pos) |
        I2C_CR2_RD_WRN |
        I2C_CR2_AUTOEND |
        I2C_CR2_START;

    for (size_t i = 0; i < len; ++i) {
        if (!i2c1_wait_flag(I2C_ISR_RXNE, true, timeout_ms)) {
            return false;
        }
        out[i] = (uint8_t)(I2C1->RXDR & 0xFFu);
    }

    if (!i2c1_wait_flag(I2C_ISR_STOPF, true, timeout_ms)) {
        return false;
    }
    I2C1->ICR = I2C_ICR_STOPCF;
    return true;
}

static bool i2c1_xfer(uint8_t addr7,
                      const uint8_t *w, size_t wlen,
                      uint8_t *r, size_t rlen,
                      uint32_t timeout_ms)
{
    if (!i2c1_ensure(i2c1_hz)) {
        return false;
    }
    if (addr7 > 0x7F) {
        return false;
    }
    if (wlen == 0) {
        return i2c1_read_with_stop(addr7, r, rlen, timeout_ms);
    }
    if (rlen == 0) {
        return i2c1_write_then_maybe_stop(addr7, w, wlen, true, timeout_ms);
    }

    // Write without STOP, then repeated-start read with STOP.
    if (!i2c1_write_then_maybe_stop(addr7, w, wlen, false, timeout_ms)) {
        return false;
    }
    return i2c1_read_with_stop(addr7, r, rlen, timeout_ms);
}

// Minimal CLI parsing (copied/adapted from stm/emwaver-firmware command_registry.c).
#define CLI_MAX_ARGS 10
#define CLI_MAX_POSITIONAL 4
#define CLI_COMMAND_BUFFER 256

typedef struct {
    const char *key;
    const char *value;
} cli_arg_view_t;

typedef struct {
    char *verb;
    cli_arg_view_t args[CLI_MAX_ARGS];
    size_t arg_count;
    char *positional[CLI_MAX_POSITIONAL];
    size_t positional_count;
} cli_command_view_t;

static bool is_cli_space(char ch)
{
    return ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n';
}

static char *next_token(char **cursor)
{
    if (!cursor || !*cursor) {
        return NULL;
    }

    char *p = *cursor;
    while (*p && is_cli_space(*p)) {
        p++;
    }
    if (!*p) {
        *cursor = p;
        return NULL;
    }

    char *start = p;
    while (*p && !is_cli_space(*p)) {
        p++;
    }
    if (*p) {
        *p = '\0';
        p++;
    }
    *cursor = p;
    return start;
}

static bool parse_cli_command_inplace(char *line, cli_command_view_t *out)
{
    if (!line || !out) {
        return false;
    }

    memset(out, 0, sizeof(*out));

    char *cursor = line;
    char *verb = next_token(&cursor);
    if (!verb) {
        return false;
    }
    out->verb = verb;

    char *pending = NULL;
    while (1) {
        char *token = pending ? pending : next_token(&cursor);
        pending = NULL;
        if (!token) {
            break;
        }

        if (strncmp(token, "--", 2) == 0) {
            char *key = token + 2;
            const char *value = NULL;
            char *eq = strchr(key, '=');
            if (eq) {
                *eq = '\0';
                value = eq + 1;
            } else {
                char *next = next_token(&cursor);
                if (!next) {
                    value = "1";
                } else if (strncmp(next, "--", 2) == 0) {
                    value = "1";
                    pending = next;
                } else {
                    value = next;
                }
            }
            if (out->arg_count < CLI_MAX_ARGS) {
                out->args[out->arg_count].key = key;
                out->args[out->arg_count].value = value ? value : "";
                out->arg_count++;
            }
        } else {
            if (out->positional_count < CLI_MAX_POSITIONAL) {
                out->positional[out->positional_count] = token;
                out->positional_count++;
            }
        }
    }

    return true;
}

static const char *cli_get_arg_view(const cli_command_view_t *cmd, const char *key)
{
    if (!cmd || !key) {
        return NULL;
    }
    for (size_t i = 0; i < cmd->arg_count; ++i) {
        if (cmd->args[i].key && strcmp(cmd->args[i].key, key) == 0) {
            return cmd->args[i].value;
        }
    }
    return NULL;
}

static bool cli_parse_int(const char *str, int *out_value)
{
    if (!str || !out_value) {
        return false;
    }
    char *end = NULL;
    long value = strtol(str, &end, 0);
    if (end == str || (end && *end != '\0')) {
        return false;
    }
    *out_value = (int)value;
    return true;
}

static int from_hex(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
    if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
    return -1;
}

static bool cli_parse_hex_bytes(const char *str, uint8_t *out, size_t max_len, size_t *out_len)
{
    if (!str || !out || !out_len) {
        return false;
    }

    size_t written = 0;
    int pending = -1;

    for (const char *p = str; *p; ++p) {
        char c = *p;

        if (c == '0' && (p[1] == 'x' || p[1] == 'X')) {
            ++p;
            continue;
        }

        if (c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == ',' || c == ':' || c == '_' || c == '-') {
            continue;
        }

        int nib = from_hex(c);
        if (nib < 0) {
            return false;
        }

        if (pending < 0) {
            pending = nib;
        } else {
            if (written >= max_len) {
                return false;
            }
            out[written++] = (uint8_t)((pending << 4) | nib);
            pending = -1;
        }
    }

    if (pending >= 0) {
        return false;
    }

    *out_len = written;
    return true;
}

/* USER CODE END 0 */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{
  /* USER CODE BEGIN 1 */

  /* USER CODE END 1 */

  /* MCU Configuration--------------------------------------------------------*/

  /* Reset of all peripherals, Initializes the Flash interface and the Systick. */
  HAL_Init();

  /* USER CODE BEGIN Init */

  /* USER CODE END Init */

  /* Configure the system clock */
  SystemClock_Config();

  /* USER CODE BEGIN SysInit */

  /* USER CODE END SysInit */

  /* Initialize all configured peripherals */
  MX_GPIO_Init();
  MX_TIM2_Init();
  MX_TIM1_Init();
  MX_USB_DEVICE_Init();
  MX_TIM3_Init();
  MX_SPI1_Init();
  /* USER CODE BEGIN 2 */
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */
      if (ism_mode == ISM_MODE_RAW_SAMPLING) {
          if (bufferReady == 1) {
              // Only transmit when we have a fresh 64B sampler chunk.
              // Any pending command response is piggybacked in lane0.
              send_sampling_superframe((const uint8_t *)transmitBuffer);
              bufferReady = 0;
          }
      }

      if (bulk_packet == NULL) {
          continue;
      }

      if (bulk_packet_len < 1) {
          command_send_err(NULL);
          free_bulk_packet();
          continue;
      }

      static char scratch_line[CLI_COMMAND_BUFFER + 1];
      size_t line_len = bulk_packet_len;
      if (line_len > CLI_COMMAND_BUFFER) {
          line_len = CLI_COMMAND_BUFFER;
      }
      size_t effective = 0;
      for (size_t i = 0; i < line_len; i++) {
          if (bulk_packet[i] == '\0') {
              break;
          }
          scratch_line[i] = (char)bulk_packet[i];
          effective++;
      }
      scratch_line[effective] = '\0';
      // Trim trailing whitespace/newlines.
      while (effective > 0 && is_cli_space(scratch_line[effective - 1])) {
          scratch_line[effective - 1] = '\0';
          effective--;
      }

      cli_command_view_t cmd;
      if (!parse_cli_command_inplace(scratch_line, &cmd)) {
          command_send_err(NULL);
          free_bulk_packet();
          continue;
      }

      if (cmd.verb && strcmp(cmd.verb, "version") == 0) {
          char name[DEVICE_NAME_MAX_LEN + 1];
          get_device_name(name, sizeof(name));
          char msg[128];
          if (name[0] != '\0') {
              snprintf(msg, sizeof(msg), "%s %s (%s)", EMWAVER_FIRMWARE_WELCOME, EMWAVER_FIRMWARE_VERSION, name);
          } else {
              snprintf(msg, sizeof(msg), "%s %s", EMWAVER_FIRMWARE_WELCOME, EMWAVER_FIRMWARE_VERSION);
          }
          command_send_ok((const uint8_t *)msg, strlen(msg));
          free_bulk_packet();
          continue;
      }

      if (cmd.verb && strcmp(cmd.verb, "name") == 0) {
          if (cmd.positional_count > 0) {
              const char* new_name = cmd.positional[0];
              size_t len = strlen(new_name);
              if (len > DEVICE_NAME_MAX_LEN) len = DEVICE_NAME_MAX_LEN;

              HAL_FLASH_Unlock();
              FLASH_EraseInitTypeDef EraseInitStruct;
              EraseInitStruct.TypeErase = FLASH_TYPEERASE_PAGES;
              EraseInitStruct.PageAddress = USER_DATA_FLASH_ADDR;
              EraseInitStruct.NbPages = 1;
              uint32_t PageError = 0;

              if (HAL_FLASHEx_Erase(&EraseInitStruct, &PageError) != HAL_OK) {
                  command_send_err("Erase failed");
              } else {
                  for (size_t i = 0; i < len; i += 2) {
                      uint16_t data = (unsigned char)new_name[i];
                      if (i + 1 < len) data |= ((unsigned char)new_name[i+1] << 8);
                      if (HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD, USER_DATA_FLASH_ADDR + i, data) != HAL_OK) {
                          command_send_err("Write failed");
                          break;
                      }
                  }
                  if (len % 2 == 0) {
                       HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD, USER_DATA_FLASH_ADDR + len, 0);
                  }
                  command_send_ok(NULL, 0);
              }
              HAL_FLASH_Lock();
          } else {
              char name[DEVICE_NAME_MAX_LEN + 1];
              get_device_name(name, sizeof(name));
              if (name[0] != '\0') {
                  command_send_ok((const uint8_t*)name, strlen(name));
              } else {
                  command_send_ok((const uint8_t*)"(no name)", 9);
              }
          }
          free_bulk_packet();
          continue;
      }

	      if (cmd.verb && strcmp(cmd.verb, "usb") == 0 && cmd.positional_count > 0) {
	          const char *sub = cmd.positional[0];
	          if (strcmp(sub, "stats") == 0) {
              uint32_t tx_ok = 0, tx_busy = 0, tx_timeout = 0, tx_fail = 0, rx_in = 0;
              MIDI_GetUsbStats_FS(&tx_ok, &tx_busy, &tx_timeout, &tx_fail, &rx_in);
              uint32_t data_in = USBD_MIDI_GetDataInCount();
              char stats_buf[64];
              int len = snprintf(stats_buf, sizeof(stats_buf),
                  "tx=%lu di=%lu busy=%lu to=%lu fail=%lu in=%lu",
                  (unsigned long)tx_ok, (unsigned long)data_in,
                  (unsigned long)tx_busy, (unsigned long)tx_timeout,
                  (unsigned long)tx_fail, (unsigned long)rx_in);
              if (len > 0 && (size_t)len < sizeof(stats_buf)) {
                  command_send_ok((const uint8_t *)stats_buf, (size_t)len);
              } else {
                  command_send_ok(NULL, 0);
              }
          } else {
              command_send_err(NULL);
          }
          free_bulk_packet();
	          continue;
	      }

	      if (cmd.verb && strcmp(cmd.verb, "adc") == 0 && cmd.positional_count > 0) {
	          const char *sub = cmd.positional[0];

	          if (strcmp(sub, "read") == 0) {
	              const char *pin_str = cli_get_arg_view(&cmd, "pin");
	              const char *src_str = cli_get_arg_view(&cmd, "src");
	              const char *samples_str = cli_get_arg_view(&cmd, "samples");

	              if ((pin_str && src_str) || (!pin_str && !src_str)) {
	                  command_send_err(NULL);
	                  free_bulk_packet();
	                  continue;
	              }

	              int samples_i = 1;
	              if (samples_str && !cli_parse_int(samples_str, &samples_i)) {
	                  command_send_err(NULL);
	                  free_bulk_packet();
	                  continue;
	              }
	              if (samples_i < 1) samples_i = 1;
	              if (samples_i > 64) samples_i = 64;

	              uint32_t chsel_bit = 0;

	              if (pin_str) {
	                  int pin_enc = -1;
	                  if (!cli_parse_int(pin_str, &pin_enc) || pin_enc < 0 || pin_enc > 31) {
	                      command_send_err(NULL);
	                      free_bulk_packet();
	                      continue;
	                  }

	                  GPIO_TypeDef *port = NULL;
	                  uint16_t pin_mask = 0;
	                  if (!decode_encoded_pin(pin_enc, &port, &pin_mask)) {
	                      command_send_err(NULL);
	                      free_bulk_packet();
	                      continue;
	                  }

	                  uint8_t pin_index = 0;
	                  if (!pin_mask_to_index(pin_mask, &pin_index)) {
	                      command_send_err(NULL);
	                      free_bulk_packet();
	                      continue;
	                  }

	                  disable_tim2_output_if_needed(port, pin_index);
	                  gpio_set_mode(port, pin_mask, GPIO_MODE_ANALOG, GPIO_NOPULL);

	                  if (!adc_channel_from_pin(port, pin_index, &chsel_bit)) {
	                      command_send_err(NULL);
	                      free_bulk_packet();
	                      continue;
	                  }
	              } else {
	                  // Internal sources: temp sensor (CH16), VREFINT (CH17), VBAT (CH18).
	                  if (strcmp(src_str, "temp") == 0) {
	                      ADC1_COMMON->CCR |= (ADC_CCR_TSEN | ADC_CCR_VREFEN);
	                      chsel_bit = ADC_CHSELR_CHSEL16;
	                  } else if (strcmp(src_str, "vrefint") == 0) {
	                      ADC1_COMMON->CCR |= ADC_CCR_VREFEN;
	                      chsel_bit = ADC_CHSELR_CHSEL17;
	                  } else if (strcmp(src_str, "vbat") == 0) {
	                      ADC1_COMMON->CCR |= ADC_CCR_VBATEN;
	                      chsel_bit = ADC_CHSELR_CHSEL18;
	                  } else {
	                      command_send_err(NULL);
	                      free_bulk_packet();
	                      continue;
	                  }
	              }

	              uint32_t sum = 0;
	              for (int i = 0; i < samples_i; ++i) {
	                  uint16_t v = 0;
	                  if (!adc_read_single(chsel_bit, &v)) {
	                      command_send_err(NULL);
	                      free_bulk_packet();
	                      goto adc_done;
	                  }
	                  sum += (uint32_t)v;
	              }

	              uint16_t avg = (uint16_t)((sum + (uint32_t)(samples_i / 2)) / (uint32_t)samples_i);
	              uint8_t out[2] = {(uint8_t)(avg & 0xFFu), (uint8_t)((avg >> 8) & 0xFFu)};
	              command_send_ok(out, sizeof(out));
	              free_bulk_packet();
adc_done:
	              continue;
	          }

		          command_send_err(NULL);
		          free_bulk_packet();
		          continue;
		      }

		      if (cmd.verb && strcmp(cmd.verb, "uart") == 0 && cmd.positional_count > 0) {
		          const char *sub = cmd.positional[0];

		          if (strcmp(sub, "open") == 0) {
		              int baud_i = 115200;
		              const char *baud_str = cli_get_arg_view(&cmd, "baud");
		              if (baud_str && !cli_parse_int(baud_str, &baud_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (baud_i <= 0) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              uart1_baud = (uint32_t)baud_i;
		              if (!uart1_ensure(uart1_baud)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              command_send_ok(NULL, 0);
		              free_bulk_packet();
		              continue;
		          }

		          if (strcmp(sub, "close") == 0) {
		              uart1_deinit();
		              command_send_ok(NULL, 0);
		              free_bulk_packet();
		              continue;
		          }

		          if (strcmp(sub, "write") == 0) {
		              int baud_i = (int)uart1_baud;
		              int timeout_i = 1000;
		              const char *baud_str = cli_get_arg_view(&cmd, "baud");
		              const char *timeout_str = cli_get_arg_view(&cmd, "timeout");
		              const char *tx_str = cli_get_arg_view(&cmd, "tx");
		              if (baud_str && !cli_parse_int(baud_str, &baud_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (timeout_str && !cli_parse_int(timeout_str, &timeout_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (!tx_str || tx_str[0] == '\0') {
		                  command_send_ok(NULL, 0);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (baud_i <= 0) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }

		              uart1_baud = (uint32_t)baud_i;
		              if (!uart1_ensure(uart1_baud)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }

		              uint8_t tx_buf[64] = {0};
		              size_t tx_len = 0;
		              if (!cli_parse_hex_bytes(tx_str, tx_buf, 63u, &tx_len)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }

		              size_t written = 0;
		              if (!uart1_write(tx_buf, tx_len, (uint32_t)timeout_i, &written)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              uint8_t out = (uint8_t)(written & 0xFFu);
		              command_send_ok(&out, 1);
		              free_bulk_packet();
		              continue;
		          }

		          if (strcmp(sub, "read") == 0) {
		              int baud_i = (int)uart1_baud;
		              int timeout_i = 250;
		              int n_i = 0;
		              const char *baud_str = cli_get_arg_view(&cmd, "baud");
		              const char *timeout_str = cli_get_arg_view(&cmd, "timeout");
		              const char *n_str = cli_get_arg_view(&cmd, "n");
		              if (baud_str && !cli_parse_int(baud_str, &baud_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (timeout_str && !cli_parse_int(timeout_str, &timeout_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (!cli_parse_int(n_str, &n_i) || n_i < 0) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (n_i == 0) {
		                  command_send_ok(NULL, 0);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (n_i > 63) {
		                  n_i = 63;
		              }
		              if (baud_i <= 0) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }

		              uart1_baud = (uint32_t)baud_i;
		              if (!uart1_ensure(uart1_baud)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }

		              uint8_t rx_buf[64] = {0};
		              size_t got = 0;
		              if (!uart1_read(rx_buf, (size_t)n_i, (uint32_t)timeout_i, &got)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              command_send_ok(rx_buf, got);
		              free_bulk_packet();
		              continue;
		          }

		          command_send_err(NULL);
		          free_bulk_packet();
		          continue;
		      }

		      if (cmd.verb && strcmp(cmd.verb, "i2c") == 0 && cmd.positional_count > 0) {
		          const char *sub = cmd.positional[0];

		          if (strcmp(sub, "open") == 0) {
		              int hz_i = 100000;
		              const char *hz_str = cli_get_arg_view(&cmd, "hz");
		              if (hz_str && !cli_parse_int(hz_str, &hz_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (hz_i <= 0) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              i2c1_hz = (uint32_t)hz_i;
		              if (!i2c1_ensure(i2c1_hz)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              command_send_ok(NULL, 0);
		              free_bulk_packet();
		              continue;
		          }

		          if (strcmp(sub, "close") == 0) {
		              i2c1_deinit();
		              command_send_ok(NULL, 0);
		              free_bulk_packet();
		              continue;
		          }

		          if (strcmp(sub, "write") == 0) {
		              int hz_i = (int)i2c1_hz;
		              int timeout_i = 250;
		              int addr_i = -1;
		              const char *hz_str = cli_get_arg_view(&cmd, "hz");
		              const char *timeout_str = cli_get_arg_view(&cmd, "timeout");
		              const char *addr_str = cli_get_arg_view(&cmd, "addr");
		              const char *tx_str = cli_get_arg_view(&cmd, "tx");
		              if (hz_str && !cli_parse_int(hz_str, &hz_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (timeout_str && !cli_parse_int(timeout_str, &timeout_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (!cli_parse_int(addr_str, &addr_i) || addr_i < 0 || addr_i > 0x7F) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (!tx_str || tx_str[0] == '\0') {
		                  command_send_ok(NULL, 0);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (hz_i <= 0) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }

		              i2c1_hz = (uint32_t)hz_i;
		              if (!i2c1_ensure(i2c1_hz)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }

		              uint8_t tx_buf[64] = {0};
		              size_t tx_len = 0;
		              if (!cli_parse_hex_bytes(tx_str, tx_buf, 63u, &tx_len)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }

		              if (!i2c1_write_then_maybe_stop((uint8_t)addr_i, tx_buf, tx_len, true, (uint32_t)timeout_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              command_send_ok(NULL, 0);
		              free_bulk_packet();
		              continue;
		          }

		          if (strcmp(sub, "read") == 0) {
		              int hz_i = (int)i2c1_hz;
		              int timeout_i = 250;
		              int addr_i = -1;
		              int n_i = 0;
		              const char *hz_str = cli_get_arg_view(&cmd, "hz");
		              const char *timeout_str = cli_get_arg_view(&cmd, "timeout");
		              const char *addr_str = cli_get_arg_view(&cmd, "addr");
		              const char *n_str = cli_get_arg_view(&cmd, "n");
		              if (hz_str && !cli_parse_int(hz_str, &hz_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (timeout_str && !cli_parse_int(timeout_str, &timeout_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (!cli_parse_int(addr_str, &addr_i) || addr_i < 0 || addr_i > 0x7F) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (!cli_parse_int(n_str, &n_i) || n_i < 0) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (n_i == 0) {
		                  command_send_ok(NULL, 0);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (n_i > 63) {
		                  n_i = 63;
		              }
		              if (hz_i <= 0) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }

		              i2c1_hz = (uint32_t)hz_i;
		              if (!i2c1_ensure(i2c1_hz)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }

		              uint8_t rx_buf[64] = {0};
		              if (!i2c1_read_with_stop((uint8_t)addr_i, rx_buf, (size_t)n_i, (uint32_t)timeout_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              command_send_ok(rx_buf, (size_t)n_i);
		              free_bulk_packet();
		              continue;
		          }

		          if (strcmp(sub, "xfer") == 0) {
		              int hz_i = (int)i2c1_hz;
		              int timeout_i = 250;
		              int addr_i = -1;
		              int rx_i = 0;
		              const char *hz_str = cli_get_arg_view(&cmd, "hz");
		              const char *timeout_str = cli_get_arg_view(&cmd, "timeout");
		              const char *addr_str = cli_get_arg_view(&cmd, "addr");
		              const char *tx_str = cli_get_arg_view(&cmd, "tx");
		              const char *rx_str = cli_get_arg_view(&cmd, "rx");
		              if (hz_str && !cli_parse_int(hz_str, &hz_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (timeout_str && !cli_parse_int(timeout_str, &timeout_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (!cli_parse_int(addr_str, &addr_i) || addr_i < 0 || addr_i > 0x7F) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (rx_str && !cli_parse_int(rx_str, &rx_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (rx_i < 0) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }
		              if (rx_i > 63) {
		                  rx_i = 63;
		              }
		              if (hz_i <= 0) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }

		              i2c1_hz = (uint32_t)hz_i;
		              if (!i2c1_ensure(i2c1_hz)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }

		              uint8_t tx_buf[64] = {0};
		              size_t tx_len = 0;
		              if (tx_str && tx_str[0] != '\0') {
		                  if (!cli_parse_hex_bytes(tx_str, tx_buf, 63u, &tx_len)) {
		                      command_send_err(NULL);
		                      free_bulk_packet();
		                      continue;
		                  }
		              }

		              uint8_t rx_buf[64] = {0};
		              if (!i2c1_xfer((uint8_t)addr_i,
		                             tx_buf, tx_len,
		                             rx_buf, (size_t)rx_i,
		                             (uint32_t)timeout_i)) {
		                  command_send_err(NULL);
		                  free_bulk_packet();
		                  continue;
		              }

		              command_send_ok(rx_buf, (size_t)rx_i);
		              free_bulk_packet();
		              continue;
		          }

		          command_send_err(NULL);
		          free_bulk_packet();
		          continue;
		      }

		      if (cmd.verb && strcmp(cmd.verb, "spi") == 0 && cmd.positional_count > 0) {
		          const char *sub = cmd.positional[0];

		          if (strcmp(sub, "xfer") == 0) {
	              int cs_i = 4; // Default CS pin: PA4 (NSS_RFID / CC1101 CS).
              int rx_i = 0;
              const char *cs_str = cli_get_arg_view(&cmd, "cs");
              const char *rx_str = cli_get_arg_view(&cmd, "rx");
              const char *tx_str = cli_get_arg_view(&cmd, "tx");

              if (cs_str && !cli_parse_int(cs_str, &cs_i)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }
              if (rx_str && !cli_parse_int(rx_str, &rx_i)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              if (cs_i < 0 || cs_i > 31 || rx_i < 0) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              GPIO_TypeDef *cs_port = NULL;
              uint16_t cs_pin_mask = 0;
              if (!decode_encoded_pin(cs_i, &cs_port, &cs_pin_mask)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              uint8_t tx_buf[64] = {0};
              size_t tx_len = 0;
              if (tx_str && tx_str[0] != '\0') {
                  if (!cli_parse_hex_bytes(tx_str, tx_buf, sizeof(tx_buf), &tx_len)) {
                      command_send_err(NULL);
                      free_bulk_packet();
                      continue;
                  }
              }

              size_t requested_rx = 0;
              if (rx_i > 0) {
                  requested_rx = (size_t)rx_i;
                  if (requested_rx > 63u) {
                      requested_rx = 63u;
                  }
              }

              size_t xfer_len = 0;
              if (requested_rx == 0) {
                  // If `--rx` is omitted or 0, return tx_len bytes.
                  xfer_len = tx_len;
                  requested_rx = tx_len;
              } else {
                  // If `--tx` is omitted, clock out 0x00 bytes to read rx bytes.
                  xfer_len = tx_len > requested_rx ? tx_len : requested_rx;
              }

              if (xfer_len == 0 || requested_rx == 0) {
                  command_send_ok(NULL, 0);
                  free_bulk_packet();
                  continue;
              }

              uint8_t tx_xfer[64] = {0};
              if (tx_len > 0) {
                  memcpy(tx_xfer, tx_buf, tx_len);
              }
              uint8_t rx_buf[64] = {0};

              // Ensure CS is configured and idle-high.
              //
              // Important: preload the output latch HIGH before switching the pin to output mode.
              // Otherwise, HAL_GPIO_Init() can briefly drive the default output state (often LOW),
              // creating a short CS pulse that can break some slaves (including CC1101).
              enable_gpio_clock(cs_port);
              gpio_write_latch(cs_port, cs_pin_mask, true);
              configurePin(cs_port, cs_pin_mask, GPIO_MODE_OUTPUT_PP, GPIO_NOPULL);
              HAL_GPIO_WritePin(cs_port, cs_pin_mask, GPIO_PIN_SET);

              HAL_GPIO_WritePin(cs_port, cs_pin_mask, GPIO_PIN_RESET);
              HAL_StatusTypeDef st = HAL_SPI_TransmitReceive(&hspi1, tx_xfer, rx_buf, (uint16_t)xfer_len, 100u);
              HAL_GPIO_WritePin(cs_port, cs_pin_mask, GPIO_PIN_SET);

              if (st != HAL_OK) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              command_send_ok(rx_buf, requested_rx);
              free_bulk_packet();
              continue;
          }

          command_send_err(NULL);
          free_bulk_packet();
          continue;
      }

	      if (cmd.verb && strcmp(cmd.verb, "sample") == 0 && cmd.positional_count > 0) {
	          const char *sub = cmd.positional[0];
	          if (strcmp(sub, "start") == 0) {
              int pin_enc = -1;
              const char *pin_str = cli_get_arg_view(&cmd, "pin");
              if (!cli_parse_int(pin_str, &pin_enc)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              GPIO_TypeDef *port = NULL;
              uint16_t pin_mask = 0;
              if (!decode_encoded_pin(pin_enc, &port, &pin_mask)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              uint32_t pull = (port == GPIOA && pin_mask == GPIO_PIN_1) ? GPIO_NOPULL : GPIO_PULLDOWN;
              configurePin(port, pin_mask, GPIO_MODE_INPUT, pull);
              samplerPort = port;
              samplerPin = pin_mask;

              bufferA = (uint8_t *)malloc(64);
              bufferB = (uint8_t *)malloc(64);
              if (bufferA == NULL || bufferB == NULL) {
                  command_send_err(NULL);
                  free((void *)bufferA);
                  free((void *)bufferB);
                  bufferA = NULL;
                  bufferB = NULL;
                  free_bulk_packet();
                  continue;
              }
              currentBuffer = bufferA;
              transmitBuffer = NULL;
              bufferIndex = 0;
              bufferReady = 0;

              EMW_USB_SetBufferType_FS(EMW_BUFFER_DOUBLE);
              ism_mode = ISM_MODE_RAW_SAMPLING;
              HAL_TIM_Base_Start_IT(&htim3);
              command_send_ok(NULL, 0);
          } else if (strcmp(sub, "stop") == 0) {
              stop_sampling();
              command_send_ok(NULL, 0);
          } else {
              command_send_err(NULL);
          }

          free_bulk_packet();
          continue;
      }

      if (cmd.verb && strcmp(cmd.verb, "gpio") == 0 && cmd.positional_count > 0) {
          const char *sub = cmd.positional[0];
          if (strcmp(sub, "in") == 0 || strcmp(sub, "out") == 0 ||
              strcmp(sub, "read") == 0 || strcmp(sub, "high") == 0 ||
              strcmp(sub, "low") == 0 || strcmp(sub, "pull") == 0 ||
              strcmp(sub, "info") == 0) {
              int pin_enc = -1;
              const char *pin_str = cli_get_arg_view(&cmd, "pin");
              if (!cli_parse_int(pin_str, &pin_enc)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              GPIO_TypeDef *port = NULL;
              uint16_t pin_mask = 0;
              if (!decode_encoded_pin(pin_enc, &port, &pin_mask)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              uint8_t pin_index = 0;
              if (!pin_mask_to_index(pin_mask, &pin_index)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              disable_tim2_output_if_needed(port, pin_index);

              if (strcmp(sub, "in") == 0) {
                  gpio_set_mode(port, pin_mask, GPIO_MODE_INPUT, GPIO_NOPULL);
                  command_send_ok(NULL, 0);
              } else if (strcmp(sub, "out") == 0) {
                  gpio_set_mode(port, pin_mask, GPIO_MODE_OUTPUT_PP, GPIO_NOPULL);
                  command_send_ok(NULL, 0);
              } else if (strcmp(sub, "pull") == 0) {
                  int pull_mode = 0;
                  const char *mode_str = cli_get_arg_view(&cmd, "mode");
                  if (!cli_parse_int(mode_str, &pull_mode)) {
                      command_send_err(NULL);
                      free_bulk_packet();
                      continue;
                  }
                  uint32_t pull = GPIO_NOPULL;
                  if (pull_mode == 1) {
                      pull = GPIO_PULLUP;
                  } else if (pull_mode == 2) {
                      pull = GPIO_PULLDOWN;
                  } else if (pull_mode != 0) {
                      command_send_err(NULL);
                      free_bulk_packet();
                      continue;
                  }
                  gpio_set_mode(port, pin_mask, GPIO_MODE_INPUT, pull);
                  command_send_ok(NULL, 0);
              } else if (strcmp(sub, "read") == 0) {
                  gpio_set_mode(port, pin_mask, GPIO_MODE_INPUT, GPIO_NOPULL);
                  uint8_t out = (uint8_t)HAL_GPIO_ReadPin(port, pin_mask);
                  command_send_ok(&out, 1);
              } else if (strcmp(sub, "high") == 0 || strcmp(sub, "low") == 0) {
                  bool value = (strcmp(sub, "high") == 0);
                  gpio_write_latch(port, pin_mask, value);
                  gpio_set_mode(port, pin_mask, GPIO_MODE_OUTPUT_PP, GPIO_NOPULL);
                  HAL_GPIO_WritePin(port, pin_mask, value ? GPIO_PIN_SET : GPIO_PIN_RESET);
                  uint8_t out = (uint8_t)HAL_GPIO_ReadPin(port, pin_mask);
                  command_send_ok(&out, 1);
              } else if (strcmp(sub, "info") == 0) {
                  enable_gpio_clock(port);
                  uint32_t moder = port->MODER;
                  uint32_t otyper = port->OTYPER;
                  uint32_t pupdr = port->PUPDR;
                  uint32_t idr = port->IDR;
                  uint32_t odr = port->ODR;
                  uint32_t afr = (pin_index < 8) ? port->AFR[0] : port->AFR[1];

                  uint8_t mode = (uint8_t)((moder >> (pin_index * 2)) & 0x03);
                  uint8_t otype = (uint8_t)((otyper >> pin_index) & 0x01);
                  uint8_t pupd = (uint8_t)((pupdr >> (pin_index * 2)) & 0x03);
                  uint8_t idr_bit = (uint8_t)((idr >> pin_index) & 0x01);
                  uint8_t odr_bit = (uint8_t)((odr >> pin_index) & 0x01);
                  uint8_t af = (uint8_t)((afr >> ((pin_index % 8) * 4)) & 0x0F);

                  uint8_t response[6] = {mode, otype, pupd, af, idr_bit, odr_bit};
                  command_send_ok(response, sizeof(response));
              } else {
                  command_send_err(NULL);
              }

              free_bulk_packet();
              continue;
          }

          if (strcmp(sub, "R") == 0 && cmd.positional_count >= 3) {
              int port_int = 0;
              int pin_int = 0;
              if (!cli_parse_int(cmd.positional[1], &port_int) || !cli_parse_int(cmd.positional[2], &pin_int)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }
              GPIO_TypeDef *port = (port_int == 0) ? GPIOA : (port_int == 1) ? GPIOB : NULL;
              if (!port || pin_int < 0 || pin_int > 15) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }
              uint16_t pin_mask = (uint16_t)(1u << (uint8_t)pin_int);
              disable_tim2_output_if_needed(port, (uint8_t)pin_int);
              gpio_set_mode(port, pin_mask, GPIO_MODE_INPUT, GPIO_NOPULL);
              uint8_t out = (uint8_t)HAL_GPIO_ReadPin(port, pin_mask);
              command_send_ok(&out, 1);
              free_bulk_packet();
              continue;
          }

          if (strcmp(sub, "W") == 0 && cmd.positional_count >= 4) {
              int port_int = 0;
              int pin_int = 0;
              int value_int = 0;
              if (!cli_parse_int(cmd.positional[1], &port_int) ||
                  !cli_parse_int(cmd.positional[2], &pin_int) ||
                  !cli_parse_int(cmd.positional[3], &value_int)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }
              GPIO_TypeDef *port = (port_int == 0) ? GPIOA : (port_int == 1) ? GPIOB : NULL;
              if (!port || pin_int < 0 || pin_int > 15) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }
              uint16_t pin_mask = (uint16_t)(1u << (uint8_t)pin_int);
              disable_tim2_output_if_needed(port, (uint8_t)pin_int);
              bool value = value_int ? true : false;
              gpio_write_latch(port, pin_mask, value);
              gpio_set_mode(port, pin_mask, GPIO_MODE_OUTPUT_PP, GPIO_NOPULL);
              HAL_GPIO_WritePin(port, pin_mask, value ? GPIO_PIN_SET : GPIO_PIN_RESET);
              uint8_t out = (uint8_t)HAL_GPIO_ReadPin(port, pin_mask);
              command_send_ok(&out, 1);
              free_bulk_packet();
              continue;
          }

          if (strcmp(sub, "I") == 0 && cmd.positional_count >= 3) {
              int port_int = 0;
              int pin_int = 0;
              if (!cli_parse_int(cmd.positional[1], &port_int) || !cli_parse_int(cmd.positional[2], &pin_int)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }
              GPIO_TypeDef *port = (port_int == 0) ? GPIOA : (port_int == 1) ? GPIOB : NULL;
              if (!port || pin_int < 0 || pin_int > 15) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }
              enable_gpio_clock(port);
              uint32_t moder = port->MODER;
              uint32_t otyper = port->OTYPER;
              uint32_t pupdr = port->PUPDR;
              uint32_t idr = port->IDR;
              uint32_t odr = port->ODR;
              uint32_t afr = (pin_int < 8) ? port->AFR[0] : port->AFR[1];

              uint8_t mode = (uint8_t)((moder >> (pin_int * 2)) & 0x03);
              uint8_t otype = (uint8_t)((otyper >> pin_int) & 0x01);
              uint8_t pupd = (uint8_t)((pupdr >> (pin_int * 2)) & 0x03);
              uint8_t idr_bit = (uint8_t)((idr >> pin_int) & 0x01);
              uint8_t odr_bit = (uint8_t)((odr >> pin_int) & 0x01);
              uint8_t af = (uint8_t)((afr >> ((pin_int % 8) * 4)) & 0x0F);

              uint8_t response[6] = {mode, otype, pupd, af, idr_bit, odr_bit};
              command_send_ok(response, sizeof(response));
              free_bulk_packet();
              continue;
          }

          command_send_err(NULL);
          free_bulk_packet();
          continue;
      }

      if (cmd.verb && strcmp(cmd.verb, "pwm") == 0 && cmd.positional_count > 0) {
          const char *sub = cmd.positional[0];

          if (strcmp(sub, "freq") == 0) {
              int hz_i = 0;
              const char *hz_str = cli_get_arg_view(&cmd, "hz");
              if (!cli_parse_int(hz_str, &hz_i) || hz_i <= 0) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }
              if (!tim2_set_pwm_hz((uint32_t)hz_i)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }
              command_send_ok(NULL, 0);
              free_bulk_packet();
              continue;
          }

          if (strcmp(sub, "stop") == 0 || strcmp(sub, "off") == 0) {
              int pin_enc = -1;
              const char *pin_str = cli_get_arg_view(&cmd, "pin");
              if (!cli_parse_int(pin_str, &pin_enc)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              GPIO_TypeDef *port = NULL;
              uint16_t pin_mask = 0;
              if (!decode_encoded_pin(pin_enc, &port, &pin_mask)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              uint8_t pin_index = 0;
              if (!pin_mask_to_index(pin_mask, &pin_index)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              uint32_t channel = 0;
              if (!tim2_channel_from_pin(port, pin_index, &channel)) {
                  command_send_err("PWM supports PA0..PA3 only");
                  free_bulk_packet();
                  continue;
              }

              tim2_stop_pwm_channel(channel);
              gpio_write_latch(port, pin_mask, false);
              gpio_set_mode(port, pin_mask, GPIO_MODE_OUTPUT_PP, GPIO_NOPULL);
              HAL_GPIO_WritePin(port, pin_mask, GPIO_PIN_RESET);

              command_send_ok(NULL, 0);
              free_bulk_packet();
              continue;
          }

          if (strcmp(sub, "write") == 0) {
              int pin_enc = -1;
              int value_i = 0;
              int hz_i = 0;
              const char *pin_str = cli_get_arg_view(&cmd, "pin");
              const char *value_str = cli_get_arg_view(&cmd, "value");
              const char *hz_str = cli_get_arg_view(&cmd, "hz");
              if (!cli_parse_int(pin_str, &pin_enc) || !cli_parse_int(value_str, &value_i)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }
              if (hz_str && !cli_parse_int(hz_str, &hz_i)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              if (value_i < 0) value_i = 0;
              if (value_i > 4095) value_i = 4095;

              GPIO_TypeDef *port = NULL;
              uint16_t pin_mask = 0;
              if (!decode_encoded_pin(pin_enc, &port, &pin_mask)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              uint8_t pin_index = 0;
              if (!pin_mask_to_index(pin_mask, &pin_index)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              uint32_t channel = 0;
              if (!tim2_channel_from_pin(port, pin_index, &channel)) {
                  command_send_err("PWM supports PA0..PA3 only");
                  free_bulk_packet();
                  continue;
              }

              if (hz_str && hz_i > 0) {
                  if (!tim2_set_pwm_hz((uint32_t)hz_i)) {
                      command_send_err(NULL);
                      free_bulk_packet();
                      continue;
                  }
              }

              if (value_i == 0) {
                  tim2_stop_pwm_channel(channel);
                  gpio_write_latch(port, pin_mask, false);
                  gpio_set_mode(port, pin_mask, GPIO_MODE_OUTPUT_PP, GPIO_NOPULL);
                  HAL_GPIO_WritePin(port, pin_mask, GPIO_PIN_RESET);
              } else if (value_i >= 4095) {
                  tim2_stop_pwm_channel(channel);
                  gpio_write_latch(port, pin_mask, true);
                  gpio_set_mode(port, pin_mask, GPIO_MODE_OUTPUT_PP, GPIO_NOPULL);
                  HAL_GPIO_WritePin(port, pin_mask, GPIO_PIN_SET);
              } else {
                  // PWM output on TIM2 (AF2), duty in 12-bit units.
                  configurePin(port, pin_mask, GPIO_MODE_AF_PP, GPIO_NOPULL);
                  tim2_set_ccr_from_u12(channel, (uint16_t)value_i);
                  startPWM_TIM2(channel);
                  (void)HAL_TIM_PWM_Start(&htim2, channel);
              }

              command_send_ok(NULL, 0);
              free_bulk_packet();
              continue;
          }

          command_send_err(NULL);
          free_bulk_packet();
          continue;
      }

      if (cmd.verb && strcmp(cmd.verb, "transmit") == 0 && cmd.positional_count > 0) {
          const char *sub = cmd.positional[0];
          if (strcmp(sub, "start") == 0) {
              int pin_enc = -1;
              const char *pin_str = cli_get_arg_view(&cmd, "pin");
              if (!cli_parse_int(pin_str, &pin_enc)) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }
              if (pin_enc < 0 || pin_enc > 3) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              uint32_t tim_channel = 0;
              uint16_t gpio_pin = 0;
              switch (pin_enc) {
                  case 0: tim_channel = TIM_CHANNEL_1; gpio_pin = GPIO_PIN_0; break;
                  case 1: tim_channel = TIM_CHANNEL_2; gpio_pin = GPIO_PIN_1; break;
                  case 2: tim_channel = TIM_CHANNEL_3; gpio_pin = GPIO_PIN_2; break;
                  case 3: tim_channel = TIM_CHANNEL_4; gpio_pin = GPIO_PIN_3; break;
              }

              // Keep the legacy "tran" flow:
              // - switch to circular RX buffer
              // - wait for initial fill (or timeout)
              // - enable TIM3 ISR which drains RX buffer into PWM gating
              // - block until RX buffer drains to 0
              configurePin(GPIOA, gpio_pin, GPIO_MODE_AF_PP, GPIO_PULLDOWN);
              setDutyCycle_TIM2(tim_channel, 50);
              selectedChannel = tim_channel;
              (void)HAL_TIM_PWM_Start(&htim2, tim_channel);

              EMW_USB_InitRxBuffer_FS();
              EMW_USB_SetBufferType_FS(EMW_BUFFER_CIRCULAR);

              uint32_t start = HAL_GetTick();
              while (EMW_USB_GetRxBufferBytesAvailable_FS() < 250) {
                  MIDI_PollTx_FS();
                  if ((HAL_GetTick() - start) > 2000) {
                      break;
                  }
              }

              HAL_TIM_Base_Start_IT(&htim3);
              while (EMW_USB_GetRxBufferBytesAvailable_FS() != 0) {
                  MIDI_PollTx_FS();
              }

              HAL_TIM_Base_Stop_IT(&htim3);
              EMW_USB_SetBufferType_FS(EMW_BUFFER_PACKET);
              stopPWM_TIM2(tim_channel);
              EMW_USB_FlushRxBuffer_FS();
              EMW_USB_FreeRxBuffer_FS();

              command_send_ok(NULL, 0);
          } else if (strcmp(sub, "stop") == 0) {
              command_send_ok(NULL, 0);
          } else {
              command_send_err(NULL);
          }

          free_bulk_packet();
          continue;
      }

      command_send_err(NULL);
      free_bulk_packet();
  }
  /* USER CODE END 3 */
}

/**
  * @brief System Clock Configuration
  * @retval None
  */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};
  RCC_PeriphCLKInitTypeDef PeriphClkInit = {0};

  /** Initializes the RCC Oscillators according to the specified parameters
  * in the RCC_OscInitTypeDef structure.
  */
  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSI48;
  RCC_OscInitStruct.HSI48State = RCC_HSI48_ON;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_NONE;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  /** Initializes the CPU, AHB and APB buses clocks
  */
  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK
                              |RCC_CLOCKTYPE_PCLK1;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_HSI48;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV1;

  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_1) != HAL_OK)
  {
    Error_Handler();
  }
  PeriphClkInit.PeriphClockSelection = RCC_PERIPHCLK_USB;
  PeriphClkInit.UsbClockSelection = RCC_USBCLKSOURCE_HSI48;

  if (HAL_RCCEx_PeriphCLKConfig(&PeriphClkInit) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief SPI1 Initialization Function
  * @param None
  * @retval None
  */
static void MX_SPI1_Init(void)
{

  /* USER CODE BEGIN SPI1_Init 0 */

  /* USER CODE END SPI1_Init 0 */

  /* USER CODE BEGIN SPI1_Init 1 */

  /* USER CODE END SPI1_Init 1 */
  /* SPI1 parameter configuration*/
  hspi1.Instance = SPI1;
  hspi1.Init.Mode = SPI_MODE_MASTER;
  hspi1.Init.Direction = SPI_DIRECTION_2LINES;
  hspi1.Init.DataSize = SPI_DATASIZE_8BIT;
  hspi1.Init.CLKPolarity = SPI_POLARITY_LOW;
  hspi1.Init.CLKPhase = SPI_PHASE_1EDGE;
  hspi1.Init.NSS = SPI_NSS_SOFT;
  hspi1.Init.BaudRatePrescaler = SPI_BAUDRATEPRESCALER_64;
  hspi1.Init.FirstBit = SPI_FIRSTBIT_MSB;
  hspi1.Init.TIMode = SPI_TIMODE_DISABLE;
  hspi1.Init.CRCCalculation = SPI_CRCCALCULATION_DISABLE;
  hspi1.Init.CRCPolynomial = 7;
  hspi1.Init.CRCLength = SPI_CRC_LENGTH_DATASIZE;
  hspi1.Init.NSSPMode = SPI_NSS_PULSE_DISABLE;
  if (HAL_SPI_Init(&hspi1) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN SPI1_Init 2 */

  /* USER CODE END SPI1_Init 2 */

}

/**
  * @brief TIM1 Initialization Function
  * @param None
  * @retval None
  */
static void MX_TIM1_Init(void)
{

  /* USER CODE BEGIN TIM1_Init 0 */

  /* USER CODE END TIM1_Init 0 */

  TIM_ClockConfigTypeDef sClockSourceConfig = {0};
  TIM_MasterConfigTypeDef sMasterConfig = {0};

  /* USER CODE BEGIN TIM1_Init 1 */

  /* USER CODE END TIM1_Init 1 */
  htim1.Instance = TIM1;
  htim1.Init.Prescaler = 48-1;
  htim1.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim1.Init.Period = 0xFFFF - 1;
  htim1.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim1.Init.RepetitionCounter = 0;
  htim1.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_Base_Init(&htim1) != HAL_OK)
  {
    Error_Handler();
  }
  sClockSourceConfig.ClockSource = TIM_CLOCKSOURCE_INTERNAL;
  if (HAL_TIM_ConfigClockSource(&htim1, &sClockSourceConfig) != HAL_OK)
  {
    Error_Handler();
  }
  sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
  sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim1, &sMasterConfig) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN TIM1_Init 2 */

  /* USER CODE END TIM1_Init 2 */

}

/**
  * @brief TIM2 Initialization Function
  * @param None
  * @retval None
  */
static void MX_TIM2_Init(void)
{

  /* USER CODE BEGIN TIM2_Init 0 */

  /* USER CODE END TIM2_Init 0 */

  TIM_ClockConfigTypeDef sClockSourceConfig = {0};
  TIM_MasterConfigTypeDef sMasterConfig = {0};
  TIM_OC_InitTypeDef sConfigOC = {0};

  /* USER CODE BEGIN TIM2_Init 1 */

  /* USER CODE END TIM2_Init 1 */
  htim2.Instance = TIM2;
  htim2.Init.Prescaler = 0;
  htim2.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim2.Init.Period = 1263-1;
  htim2.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim2.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_Base_Init(&htim2) != HAL_OK)
  {
    Error_Handler();
  }
  sClockSourceConfig.ClockSource = TIM_CLOCKSOURCE_INTERNAL;
  if (HAL_TIM_ConfigClockSource(&htim2, &sClockSourceConfig) != HAL_OK)
  {
    Error_Handler();
  }
  if (HAL_TIM_PWM_Init(&htim2) != HAL_OK)
  {
    Error_Handler();
  }
  sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
  sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim2, &sMasterConfig) != HAL_OK)
  {
    Error_Handler();
  }
  sConfigOC.OCMode = TIM_OCMODE_PWM1;
  sConfigOC.Pulse = (1263-1)/2;
  sConfigOC.OCPolarity = TIM_OCPOLARITY_HIGH;
  sConfigOC.OCFastMode = TIM_OCFAST_DISABLE;
  if (HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_3) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN TIM2_Init 2 */
  // Configure Channel 1 (PA0)
  if (HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_1) != HAL_OK)
  {
    Error_Handler();
  }

  // Configure Channel 2 (PA1)
  if (HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_2) != HAL_OK)
  {
    Error_Handler();
  }

  // Configure Channel 3 (PA2)
  if (HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_3) != HAL_OK)
  {
    Error_Handler();
  }

  // Configure Channel 4 (PA3)
  if (HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_4) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE END TIM2_Init 2 */
  HAL_TIM_MspPostInit(&htim2);

}

/**
  * @brief TIM3 Initialization Function
  * @param None
  * @retval None
  */
static void MX_TIM3_Init(void)
{

  /* USER CODE BEGIN TIM3_Init 0 */

  /* USER CODE END TIM3_Init 0 */

  TIM_ClockConfigTypeDef sClockSourceConfig = {0};
  TIM_MasterConfigTypeDef sMasterConfig = {0};

  /* USER CODE BEGIN TIM3_Init 1 */

  /* USER CODE END TIM3_Init 1 */
  htim3.Instance = TIM3;
  htim3.Init.Prescaler = 0;
  htim3.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim3.Init.Period = 480-1;
  htim3.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim3.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_Base_Init(&htim3) != HAL_OK)
  {
    Error_Handler();
  }
  sClockSourceConfig.ClockSource = TIM_CLOCKSOURCE_INTERNAL;
  if (HAL_TIM_ConfigClockSource(&htim3, &sClockSourceConfig) != HAL_OK)
  {
    Error_Handler();
  }
  sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
  sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim3, &sMasterConfig) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN TIM3_Init 2 */

  /* USER CODE END TIM3_Init 2 */

}

/**
  * @brief GPIO Initialization Function
  * @param None
  * @retval None
  */
static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStruct = {0};
/* USER CODE BEGIN MX_GPIO_Init_1 */
  // VCTL (antenna switch): PB0 low selects the 433 MHz antenna path.
/* USER CODE END MX_GPIO_Init_1 */

  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /* USER CODE BEGIN MX_GPIO_Init_1b */
  // Drive VCTL low as early as possible (before configuring the pin) to avoid glitches.
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_RESET);
  /* USER CODE END MX_GPIO_Init_1b */

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_SET);

  /*Configure GPIO pin : IR_RX_Pin */
  GPIO_InitStruct.Pin = IR_RX_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  HAL_GPIO_Init(IR_RX_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pin : NSS_RFID_Pin */
  GPIO_InitStruct.Pin = NSS_RFID_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(NSS_RFID_GPIO_Port, &GPIO_InitStruct);

/* USER CODE BEGIN MX_GPIO_Init_2 */
  /*Configure GPIO pin : PB0 (VCTL) */
  GPIO_InitStruct.Pin = GPIO_PIN_0;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);
/* USER CODE END MX_GPIO_Init_2 */
}

/* USER CODE BEGIN 4 */

/* USER CODE END 4 */

/**
  * @brief  This function is executed in case of error occurrence.
  * @retval None
  */
void Error_Handler(void)
{
  /* USER CODE BEGIN Error_Handler_Debug */
  /* User can add his own implementation to report the HAL error return state */
  __disable_irq();
  while (1)
  {
  }
  /* USER CODE END Error_Handler_Debug */
}

#ifdef  USE_FULL_ASSERT
/**
  * @brief  Reports the name of the source file and the source line number
  *         where the assert_param error has occurred.
  * @param  file: pointer to the source file name
  * @param  line: assert_param error line source number
  * @retval None
  */
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  /* User can add his own implementation to report the file name and line number,
     ex: printf("Wrong parameters value: file %s on line %d\r\n", file, line) */
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */
