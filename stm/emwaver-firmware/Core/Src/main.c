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
  * SPDX-License-Identifier: Apache-2.0
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
#include "emwaver_usb_io.h"
#include "emw_proto.h"
/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */
#define USB_TIMEOUT 100
#define EMWAVER_FIRMWARE_VERSION_MAJOR 1u
#define EMWAVER_FIRMWARE_VERSION_MINOR 0u
#define EMWAVER_FIRMWARE_VERSION_PATCH 2u

// Internal dev toggle: force ROM DFU on boot by erasing the initial flash pages.
// Keep disabled in normal firmware builds.
#define EMW_FORCE_DFU_ON_BOOT 0u
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
volatile uint16_t selectedChannelMask = TIM_CCER_CC3E;
static volatile uint8_t emw_tick_us = 5u;

uint8_t midi_packet[18];
volatile uint8_t midi_packet_ready = 0;

// Sampler capture ring (18-byte lanes). Ping-pong isn't robust at 5us: any brief USB stall
// causes overwrite. Keep it bounded but allow a small backlog.
#define SAMPLER_RING_LANES 16u
#define SAMPLER_RING_MASK (SAMPLER_RING_LANES - 1u)
static uint8_t sampler_ring[SAMPLER_RING_LANES][18];
static uint8_t sampler_overflow_lane[18];
static volatile uint8_t sampler_ring_head = 0; // lane currently being filled
static volatile uint8_t sampler_ring_tail = 0; // next lane to transmit
static volatile uint8_t sampler_ring_count = 0;
static volatile uint8_t sampler_overflow_active = 0;
static volatile uint32_t sampler_dropped_lanes = 0;

// State for 1-bit sampler packing (TIM3 ISR).
static volatile uint8_t sampler_bit_index = 0;
static volatile uint8_t sampler_byte_index = 0;
static volatile uint8_t sampler_current_byte = 0;

// State for retransmit playback (TIM3 ISR).
static volatile uint8_t tx_bit_index = 0;
static volatile uint8_t tx_current_byte = 0;
static volatile uint8_t tx_out_enabled = 0;

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

typedef void (*emw_pfn_void)(void);

__attribute__((noreturn, noinline, section(".RamFunc"))) static void emw_enter_rom_dfu_by_erasing_flash(void)
{
    __disable_irq();

    // Stop SysTick (startup/HAL may have configured it).
    SysTick->CTRL = 0u;
    SysTick->LOAD = 0u;
    SysTick->VAL = 0u;

    // Disable and clear pending IRQs.
    NVIC->ICER[0] = 0xFFFFFFFFu;
    NVIC->ICPR[0] = 0xFFFFFFFFu;

    // --- Erase initial flash pages so the ROM empty-check passes (AN2606, STM32F04xxx) ---
    // WARNING: this destroys the running application (including the vector table).
    // This routine runs entirely from SRAM.
    const uint32_t page0_addr = 0x08000000u;
    const uint32_t page_size = 0x400u; // 1 KB on STM32F042
    const uint32_t pages_to_erase = 4u;

    // Unlock flash if needed.
    if ((FLASH->CR & FLASH_CR_LOCK) != 0u) {
        FLASH->KEYR = 0x45670123u;
        FLASH->KEYR = 0xCDEF89ABu;
    }

    // Clear error flags and EOP (write 1 to clear).
    FLASH->SR |= (FLASH_SR_EOP | FLASH_SR_WRPERR | FLASH_SR_PGERR);

    // Wait for idle.
    while ((FLASH->SR & FLASH_SR_BSY) != 0u) {
    }

    for (uint32_t i = 0; i < pages_to_erase; i++) {
        const uint32_t addr = page0_addr + (i * page_size);

        // Wait for idle.
        while ((FLASH->SR & FLASH_SR_BSY) != 0u) {
        }

        // Page erase at addr.
        FLASH->CR |= FLASH_CR_PER;
        FLASH->AR = addr;
        FLASH->CR |= FLASH_CR_STRT;
        while ((FLASH->SR & FLASH_SR_BSY) != 0u) {
        }
        FLASH->SR |= FLASH_SR_EOP;
        FLASH->CR &= ~FLASH_CR_PER;
    }

    // Lock flash again.
    FLASH->CR |= FLASH_CR_LOCK;

    // --- Reset ---
    // With the initial flash erased, the ROM bootloader's empty-check will fall
    // through to system memory bootloader (DFU) on the next reset.
    NVIC_SystemReset();
    while (1) { }
}

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
// Mini-frame lanes (cmd + stream) decoded from a single USB MIDI OUT callback.
#define EMW_LANE_SIZE 18u
#define EMW_SUPERFRAME_SIZE 36u

typedef enum {
    ISM_MODE_IDLE = 0,
    ISM_MODE_RAW_SAMPLING = 1,
} ism_mode_t;

static volatile ism_mode_t ism_mode = ISM_MODE_IDLE;
volatile uint8_t pending_cmd_lane[EMW_LANE_SIZE];
volatile uint8_t pending_cmd_ready = 0;


static void midi_packet_consume(void)
{
    midi_packet_ready = 0;
    for (uint32_t i = 0; i < EMW_LANE_SIZE; i++) {
        midi_packet[i] = 0;
    }
}

static void free_bulk_packet(void)
{
    midi_packet_consume();
}

static size_t strbuf_append(char *buf, size_t cap, size_t offset, const char *src)
{
    if (cap == 0) {
        return 0;
    }
    if (!buf) {
        return 0;
    }
    if (!src) {
        buf[offset < cap ? offset : (cap - 1u)] = '\0';
        return offset < cap ? offset : (cap - 1u);
    }

    size_t out = offset;
    if (out >= cap) {
        out = cap - 1u;
    }
    while (*src && out + 1u < cap) {
        buf[out++] = *src++;
    }
    buf[out] = '\0';
    return out;
}

static size_t strbuf_append_char(char *buf, size_t cap, size_t offset, char c)
{
    char tmp[2];
    tmp[0] = c;
    tmp[1] = '\0';
    return strbuf_append(buf, cap, offset, tmp);
}

static void command_send_status(uint8_t status, const uint8_t *payload, size_t payload_len)
{
    // Binary response format:
    //   lane0[0] = status
    //   lane0[1..] = payload
    if (payload_len > EMW_RESP_MAX_PAYLOAD) {
        payload_len = EMW_RESP_MAX_PAYLOAD;
    }

    // Sampling / retransmit mode: only one response lane can be piggybacked.
    // During sampling/retransmit, a command response is piggybacked onto the next outgoing frame.
    if (ism_mode == ISM_MODE_RAW_SAMPLING || EMW_USB_GetBufferType_FS() == EMW_BUFFER_CIRCULAR) {
        uint8_t lane[EMW_LANE_SIZE] = {0};
        lane[0] = status;
        if (payload && payload_len > 0) {
            memcpy(&lane[1], payload, payload_len);
        }
        memcpy((void *)pending_cmd_lane, lane, EMW_LANE_SIZE);
        pending_cmd_ready = 1;
        return;
    }

    uint8_t frame[EMW_SUPERFRAME_SIZE] = {0};
    uint8_t *cmd_lane = &frame[0];
    cmd_lane[0] = status;
    if (payload && payload_len > 0) {
        memcpy(&cmd_lane[1], payload, payload_len);
    }
    (void)EMW_USB_SendResponsePkt_FS(frame, (uint16_t)sizeof(frame), USB_TIMEOUT);
}

static void command_send_ok(const uint8_t *data, size_t len)
{
    command_send_status(EMW_RESP_STATUS_OK, data, len);
}

static void command_send_err(const char *msg)
{
    (void)msg;
    command_send_status(EMW_RESP_STATUS_ERR, NULL, 0);
}

static void ISR_Sampler_raw(void)
{
    // Fast path: direct GPIO read + bounded ring buffering.
    uint8_t pin_state = ((samplerPort->IDR & samplerPin) != 0u) ? 1u : 0u;

    if (pin_state) {
        sampler_current_byte |= (uint8_t)(1u << sampler_bit_index);
    }

    sampler_bit_index++;
    if (sampler_bit_index < 8u) {
        return;
    }

    // Completed one byte.
    sampler_bit_index = 0;

    uint8_t *lane = sampler_overflow_active ? sampler_overflow_lane : sampler_ring[sampler_ring_head];
    lane[sampler_byte_index] = sampler_current_byte;
    sampler_current_byte = 0;
    sampler_byte_index++;
    if (sampler_byte_index < EMW_LANE_SIZE) {
        return;
    }

    // Completed one lane (18 bytes).
    sampler_byte_index = 0;

    if (sampler_overflow_active) {
        // We were discarding due to a full ring. If space exists now, resume into the ring.
        if (sampler_ring_count < SAMPLER_RING_LANES) {
            sampler_overflow_active = 0;
        }
        return;
    }

    uint8_t cnt = sampler_ring_count;
    if (cnt >= SAMPLER_RING_LANES) {
        sampler_dropped_lanes++;
        sampler_overflow_active = 1;
        return;
    }

    // Commit filled lane and advance head.
    sampler_ring_count = (uint8_t)(cnt + 1u);
    sampler_ring_head = (uint8_t)((uint8_t)(sampler_ring_head + 1u) & (uint8_t)SAMPLER_RING_MASK);
    if (sampler_ring_count >= SAMPLER_RING_LANES) {
        // Ring is now full; avoid overwriting unsent lanes.
        sampler_overflow_active = 1;
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
    // Fast playback: cache 1 byte and toggle only on state changes.
    if (EMW_USB_GetRxBufferBytesAvailable_FS() > 0u) {
        if (tx_bit_index == 0u) {
            (void)EMW_USB_ReadRxBuffer_FS((uint8_t *)&tx_current_byte, 1);
        }

        uint8_t bit = (uint8_t)((tx_current_byte >> tx_bit_index) & 1u);
        if (bit != 0u) {
            if (!tx_out_enabled) {
                TIM2->CCER |= selectedChannelMask;
                tx_out_enabled = 1u;
            }
        } else {
            if (tx_out_enabled) {
                TIM2->CCER &= (uint16_t)~selectedChannelMask;
                tx_out_enabled = 0u;
            }
        }

        tx_bit_index = (uint8_t)(tx_bit_index + 1u);
        if (tx_bit_index >= 8u) {
            tx_bit_index = 0u;
        }
    } else {
        if (tx_out_enabled) {
            TIM2->CCER &= (uint16_t)~selectedChannelMask;
            tx_out_enabled = 0u;
        }
        tx_bit_index = 0u;
    }
}

// TIM3 hot path (called directly from the TIM3 IRQ handler).
void EMW_TIM3_Tick_ISR(void)
{
    // Keep this extremely small: 5us tick at 48MHz => ~240 cycles budget.
    EMW_Buffer_Type t = emw_buf_type;
    if (t == EMW_BUFFER_CIRCULAR) {
        ISR_Sampler_writing();
        return;
    }
    if (t == EMW_BUFFER_DOUBLE && ism_mode == ISM_MODE_RAW_SAMPLING) {
        ISR_Sampler_raw();
        return;
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

static void configurePin(GPIO_TypeDef *port, uint16_t pin, uint32_t mode, uint32_t pull, uint8_t alternate)
{
    GPIO_InitTypeDef GPIO_InitStruct = {0};

    enable_gpio_clock(port);
    GPIO_InitStruct.Pin = pin;
    GPIO_InitStruct.Mode = mode;
    GPIO_InitStruct.Pull = pull;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    if (mode == GPIO_MODE_AF_PP) {
        GPIO_InitStruct.Alternate = alternate;
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

typedef enum {
    PWM_TIMER_NONE = 0,
    PWM_TIMER_TIM2 = 2,
    PWM_TIMER_TIM14 = 14,
    PWM_TIMER_TIM16 = 16,
    PWM_TIMER_TIM17 = 17,
} pwm_timer_id_t;

typedef struct {
    pwm_timer_id_t timer_id;
    uint32_t channel;      // TIM_CHANNEL_x (TIM2 only uses 1..4; others use CH1)
    uint8_t is_complement; // 1 => CH1N
    uint8_t af;            // GPIO_AFx_* value
} pwm_route_t;

static bool pwm_route_from_pin(GPIO_TypeDef *port, uint8_t pin_index, pwm_route_t *out)
{
    if (!out) {
        return false;
    }

    // NOTE: We intentionally exclude TIM3-based PWM routes to avoid conflicts
    // with the sampler/retransmit tick ISR.

    // Defaults.
    out->timer_id = PWM_TIMER_NONE;
    out->channel = 0;
    out->is_complement = 0;
    out->af = 0;

    if (port == GPIOA) {
        switch (pin_index) {
            case 0: out->timer_id = PWM_TIMER_TIM2; out->channel = TIM_CHANNEL_1; out->af = GPIO_AF2_TIM2; return true; // A0
            case 1: out->timer_id = PWM_TIMER_TIM2; out->channel = TIM_CHANNEL_2; out->af = GPIO_AF2_TIM2; return true; // A1
            case 2: out->timer_id = PWM_TIMER_TIM2; out->channel = TIM_CHANNEL_3; out->af = GPIO_AF2_TIM2; return true; // A2
            // A3 is TIM3_CH4 (excluded)
            case 4: out->timer_id = PWM_TIMER_TIM14; out->channel = TIM_CHANNEL_1; out->af = GPIO_AF4_TIM14; return true; // A4
            case 5: out->timer_id = PWM_TIMER_TIM2; out->channel = TIM_CHANNEL_1; out->af = GPIO_AF2_TIM2; return true; // A5 (shares with A0)
            case 6: out->timer_id = PWM_TIMER_TIM16; out->channel = TIM_CHANNEL_1; out->af = GPIO_AF5_TIM16; return true; // A6
            case 7: out->timer_id = PWM_TIMER_TIM17; out->channel = TIM_CHANNEL_1; out->af = GPIO_AF5_TIM17; return true; // A7
            default: break;
        }
    } else if (port == GPIOB) {
        switch (pin_index) {
            case 6: out->timer_id = PWM_TIMER_TIM16; out->channel = TIM_CHANNEL_1; out->is_complement = 1; out->af = GPIO_AF2_TIM16; return true; // B6 CH1N
            case 7: out->timer_id = PWM_TIMER_TIM17; out->channel = TIM_CHANNEL_1; out->is_complement = 1; out->af = GPIO_AF2_TIM17; return true; // B7 CH1N
            case 8: out->timer_id = PWM_TIMER_TIM16; out->channel = TIM_CHANNEL_1; out->af = GPIO_AF2_TIM16; return true; // B8
            default: break;
        }
    }

    return false;
}

static bool tim2_channel_from_pin(GPIO_TypeDef *port, uint8_t pin_index, uint32_t *out_channel)
{
    pwm_route_t r = {0};
    if (!out_channel) {
        return false;
    }
    if (!pwm_route_from_pin(port, pin_index, &r)) {
        return false;
    }
    if (r.timer_id != PWM_TIMER_TIM2) {
        return false;
    }
    *out_channel = r.channel;
    return true;
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

static bool tim16_17_set_pwm_hz(TIM_TypeDef *tim, uint32_t hz)
{
    if (!tim || hz < 1u) {
        return false;
    }

    uint32_t timclk = HAL_RCC_GetHCLKFreq();
    if (timclk == 0u) {
        timclk = 48000000u;
    }

    uint32_t ticks = timclk / hz;
    if (ticks < 2u) {
        ticks = 2u;
    }

    // 16-bit timer: choose PSC so ARR fits.
    uint32_t psc = 0u;
    if (ticks > 0x10000u) {
        psc = (ticks + 0xFFFFu) / 0x10000u;
        if (psc > 0u) {
            psc -= 1u;
        }
        if (psc > 0xFFFFu) {
            psc = 0xFFFFu;
        }
    }

    uint32_t div = psc + 1u;
    uint32_t arr = (ticks / div);
    if (arr < 2u) {
        arr = 2u;
    }
    if (arr > 0x10000u) {
        arr = 0x10000u;
    }

    tim->PSC = (uint16_t)psc;
    tim->ARR = (uint16_t)(arr - 1u);
    tim->EGR = TIM_EGR_UG;
    return true;
}

static bool tim14_set_pwm_hz(uint32_t hz)
{
    return tim16_17_set_pwm_hz(TIM14, hz);
}

static void tim14_16_17_set_ccr_from_u12(TIM_TypeDef *tim, uint16_t value_u12)
{
    if (!tim) {
        return;
    }

    uint32_t arr = (uint32_t)tim->ARR;
    uint32_t period = arr + 1u;

    uint32_t ccr = (period * (uint32_t)value_u12 + 2047u) / 4095u;
    if (ccr > arr) {
        ccr = arr;
    }

    tim->CCR1 = (uint16_t)ccr;
}

static void pwm_timer_enable_once(pwm_timer_id_t id)
{
    if (id == PWM_TIMER_TIM14) {
        __HAL_RCC_TIM14_CLK_ENABLE();
        // PWM mode 1 on CH1.
        TIM14->CR1 |= TIM_CR1_ARPE;
        TIM14->CCMR1 = (TIM14->CCMR1 & (uint16_t)~TIM_CCMR1_OC1M) | (uint16_t)(6u << TIM_CCMR1_OC1M_Pos) | TIM_CCMR1_OC1PE;
        return;
    }
    if (id == PWM_TIMER_TIM16) {
        __HAL_RCC_TIM16_CLK_ENABLE();
        TIM16->CR1 |= TIM_CR1_ARPE;
        TIM16->CCMR1 = (TIM16->CCMR1 & (uint16_t)~TIM_CCMR1_OC1M) | (uint16_t)(6u << TIM_CCMR1_OC1M_Pos) | TIM_CCMR1_OC1PE;
        TIM16->BDTR |= TIM_BDTR_MOE;
        return;
    }
    if (id == PWM_TIMER_TIM17) {
        __HAL_RCC_TIM17_CLK_ENABLE();
        TIM17->CR1 |= TIM_CR1_ARPE;
        TIM17->CCMR1 = (TIM17->CCMR1 & (uint16_t)~TIM_CCMR1_OC1M) | (uint16_t)(6u << TIM_CCMR1_OC1M_Pos) | TIM_CCMR1_OC1PE;
        TIM17->BDTR |= TIM_BDTR_MOE;
        return;
    }
}

static void pwm_start_route(const pwm_route_t *r)
{
    if (!r) {
        return;
    }

    if (r->timer_id == PWM_TIMER_TIM2) {
        startPWM_TIM2(r->channel);
        (void)HAL_TIM_PWM_Start(&htim2, r->channel);
        return;
    }

    pwm_timer_enable_once(r->timer_id);

    TIM_TypeDef *tim = NULL;
    if (r->timer_id == PWM_TIMER_TIM14) tim = TIM14;
    if (r->timer_id == PWM_TIMER_TIM16) tim = TIM16;
    if (r->timer_id == PWM_TIMER_TIM17) tim = TIM17;
    if (!tim) return;

    tim->CR1 |= TIM_CR1_CEN;
    if (r->is_complement) {
        tim->CCER |= TIM_CCER_CC1NE;
    } else {
        tim->CCER |= TIM_CCER_CC1E;
    }
}

static void pwm_stop_route(const pwm_route_t *r)
{
    if (!r) {
        return;
    }

    if (r->timer_id == PWM_TIMER_TIM2) {
        tim2_stop_pwm_channel(r->channel);
        return;
    }

    TIM_TypeDef *tim = NULL;
    if (r->timer_id == PWM_TIMER_TIM14) tim = TIM14;
    if (r->timer_id == PWM_TIMER_TIM16) tim = TIM16;
    if (r->timer_id == PWM_TIMER_TIM17) tim = TIM17;
    if (!tim) return;

    if (r->is_complement) {
        tim->CCER &= (uint16_t)~TIM_CCER_CC1NE;
    } else {
        tim->CCER &= (uint16_t)~TIM_CCER_CC1E;
    }
}

static void stop_sampling(void)
{
    HAL_TIM_Base_Stop_IT(&htim3);
    EMW_USB_SetBufferType_FS(EMW_BUFFER_PACKET);

    sampler_ring_head = 0;
    sampler_ring_tail = 0;
    sampler_ring_count = 0;
    sampler_overflow_active = 0;
    sampler_bit_index = 0;
    sampler_byte_index = 0;
    sampler_current_byte = 0;
    ism_mode = ISM_MODE_IDLE;
}

static void tim3_set_tick_us(uint8_t requested_us)
{
    // TIM3 clock is 48 MHz => 48 ticks per microsecond.
    // Keep sampler/retransmit resolution bounded: min 5us.
    uint8_t us = requested_us;
    if (us < 5u) {
        us = 5u;
    }

    uint32_t ticks = (uint32_t)us * 48u;
    if (ticks < 2u) {
        ticks = 2u;
    }
    if (ticks > 0x10000u) {
        ticks = 0x10000u;
    }

    uint16_t arr = (uint16_t)(ticks - 1u);

    __disable_irq();
    uint16_t cr1 = TIM3->CR1;
    TIM3->CR1 = (uint16_t)(cr1 & (uint16_t)~TIM_CR1_CEN);
    TIM3->ARR = arr;
    TIM3->EGR = TIM_EGR_UG;
    TIM3->SR &= (uint16_t)~TIM_SR_UIF;
    TIM3->CR1 = cr1;
    emw_tick_us = us;
    __enable_irq();
}

static uint8_t try_send_sampling_superframe(const uint8_t *stream_lane)
{
    uint8_t frame[EMW_SUPERFRAME_SIZE] = {0};
    if (pending_cmd_ready) {
        memcpy(&frame[0], (const void *)pending_cmd_lane, EMW_LANE_SIZE);
    }

    if (stream_lane != NULL) {
        memcpy(&frame[EMW_LANE_SIZE], stream_lane, EMW_LANE_SIZE);
    }

    uint8_t res = EMW_USB_TrySendResponsePkt_FS(frame, (uint16_t)sizeof(frame));
    if (res == 0u) {
        pending_cmd_ready = 0;
        return 1u;
    }
    return 0u;
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
    // Generic pin-mode helper does not know which AF to use; leave at AF0.
    configurePin(port, pin_mask, mode, pull, 0);
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

static uint16_t emw_u16_le(const uint8_t *p)
{
    return (uint16_t)p[0] | (uint16_t)((uint16_t)p[1] << 8);
}

static uint32_t emw_u32_le(const uint8_t *p)
{
    return (uint32_t)p[0]
        | ((uint32_t)p[1] << 8)
        | ((uint32_t)p[2] << 16)
        | ((uint32_t)p[3] << 24);
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

  /* USER CODE BEGIN Init */
#if EMW_FORCE_DFU_ON_BOOT
  emw_enter_rom_dfu_by_erasing_flash();
#endif
  /* USER CODE END Init */

  /* Reset of all peripherals, Initializes the Flash interface and the Systick. */
  HAL_Init();

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
          if (sampler_ring_count > 0u) {
              uint8_t lane_index = sampler_ring_tail;
              const uint8_t *lane = (const uint8_t *)sampler_ring[lane_index];
              // Non-blocking: if USB is busy we'll retry next loop.
              if (try_send_sampling_superframe(lane)) {
                  __disable_irq();
                  sampler_ring_tail = (uint8_t)((uint8_t)(sampler_ring_tail + 1u) & (uint8_t)SAMPLER_RING_MASK);
                  if (sampler_ring_count > 0u) {
                      sampler_ring_count--;
                  }
                  __enable_irq();
              }
          }
      }

      if (!midi_packet_ready) {
          continue;
      }

      size_t midi_packet_len = EMW_LANE_SIZE;
      if (midi_packet_len < 1) {
          command_send_err(NULL);
          midi_packet_consume();
          continue;
      }

      const uint8_t opcode = midi_packet[0];
      switch (opcode) {
          case 0x00u: {
              command_send_ok(NULL, 0);
              break;
          }

          case EMW_OP_VERSION: {
              uint8_t out[3] = {
                  (uint8_t)EMWAVER_FIRMWARE_VERSION_MAJOR,
                  (uint8_t)EMWAVER_FIRMWARE_VERSION_MINOR,
                  (uint8_t)EMWAVER_FIRMWARE_VERSION_PATCH,
              };
              command_send_ok(out, sizeof(out));
              break;
          }

          case EMW_OP_RESET: {
              command_send_ok(NULL, 0);
              midi_packet_consume();
              HAL_Delay(10);
              NVIC_SystemReset();
              while (1) {}
          }

          case EMW_OP_ENTER_DFU: {
              // Enter ROM DFU bootloader (STM32F042: erase initial pages, then reset).
              // This is destructive by design: the device will be in DFU until re-flashed.
              command_send_ok(NULL, 0);
              midi_packet_consume();
              HAL_Delay(5);
              emw_enter_rom_dfu_by_erasing_flash();
              while (1) {}
          }

          case EMW_OP_HELP: {
              // Intentionally empty: docs are host-side.
              command_send_ok(NULL, 0);
              break;
          }

          case EMW_OP_HARDWARE_UID_GET: {
              uint32_t uid0 = HAL_GetUIDw0();
              uint32_t uid1 = HAL_GetUIDw1();
              uint32_t uid2 = HAL_GetUIDw2();
              uint8_t out[12] = {
                  (uint8_t)(uid0 & 0xFFu),
                  (uint8_t)((uid0 >> 8) & 0xFFu),
                  (uint8_t)((uid0 >> 16) & 0xFFu),
                  (uint8_t)((uid0 >> 24) & 0xFFu),
                  (uint8_t)(uid1 & 0xFFu),
                  (uint8_t)((uid1 >> 8) & 0xFFu),
                  (uint8_t)((uid1 >> 16) & 0xFFu),
                  (uint8_t)((uid1 >> 24) & 0xFFu),
                  (uint8_t)(uid2 & 0xFFu),
                  (uint8_t)((uid2 >> 8) & 0xFFu),
                  (uint8_t)((uid2 >> 16) & 0xFFu),
                  (uint8_t)((uid2 >> 24) & 0xFFu),
              };
              command_send_ok(out, sizeof(out));
              break;
          }

          case EMW_OP_BOARD_GET: {
              static const uint8_t out[] = "stm32f042";
              command_send_ok(out, sizeof(out) - 1u);
              break;
          }

          case EMW_OP_NAME_GET: {
              char name[DEVICE_NAME_MAX_LEN + 1];
              get_device_name(name, sizeof(name));
              size_t len = strlen(name);
              command_send_ok((const uint8_t *)name, len);
              break;
          }

          case EMW_OP_NAME_SET: {
              uint8_t len = midi_packet[1];
              // Requests are limited to the cmd lane size. Host must not send oversized requests.
              uint8_t max_len = (uint8_t)(EMW_LANE_SIZE - 2u);
              if (len > max_len) {
                  len = max_len;
              }
              if (len > DEVICE_NAME_MAX_LEN) {
                  len = DEVICE_NAME_MAX_LEN;
              }

              HAL_FLASH_Unlock();
              FLASH_EraseInitTypeDef EraseInitStruct;
              EraseInitStruct.TypeErase = FLASH_TYPEERASE_PAGES;
              EraseInitStruct.PageAddress = USER_DATA_FLASH_ADDR;
              EraseInitStruct.NbPages = 1;
              uint32_t PageError = 0;

              if (HAL_FLASHEx_Erase(&EraseInitStruct, &PageError) != HAL_OK) {
                  command_send_err(NULL);
              } else {
                  for (size_t i = 0; i < len; i += 2) {
                      uint16_t data = (uint16_t)midi_packet[2 + i];
                      if (i + 1 < len) {
                          data |= (uint16_t)((uint16_t)midi_packet[2 + i + 1] << 8);
                      }
                      if (HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD, USER_DATA_FLASH_ADDR + i, data) != HAL_OK) {
                          command_send_err(NULL);
                          break;
                      }
                  }
                  if ((len % 2u) == 0u) {
                      (void)HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD, USER_DATA_FLASH_ADDR + len, 0);
                  }
                  command_send_ok(NULL, 0);
              }
              HAL_FLASH_Lock();
              break;
          }

          case EMW_OP_GPIO: {
              uint8_t sub = midi_packet[1];
              uint8_t pin_enc = midi_packet[2];
              if (pin_enc > 31u) {
                  command_send_err(NULL);
                  break;
              }

              GPIO_TypeDef *port = NULL;
              uint16_t pin_mask = 0;
              if (!decode_encoded_pin((int)pin_enc, &port, &pin_mask)) {
                  command_send_err(NULL);
                  break;
              }

              uint8_t pin_index = 0;
              if (!pin_mask_to_index(pin_mask, &pin_index)) {
                  command_send_err(NULL);
                  break;
              }

              disable_tim2_output_if_needed(port, pin_index);

              if (sub == EMW_GPIO_IN) {
                  gpio_set_mode(port, pin_mask, GPIO_MODE_INPUT, GPIO_NOPULL);
                  command_send_ok(NULL, 0);
                  break;
              }
              if (sub == EMW_GPIO_OUT) {
                  gpio_set_mode(port, pin_mask, GPIO_MODE_OUTPUT_PP, GPIO_NOPULL);
                  command_send_ok(NULL, 0);
                  break;
              }
              if (sub == EMW_GPIO_PULL) {
                  uint8_t pull_mode = midi_packet[3];
                  uint32_t pull = GPIO_NOPULL;
                  if (pull_mode == 1u) {
                      pull = GPIO_PULLUP;
                  } else if (pull_mode == 2u) {
                      pull = GPIO_PULLDOWN;
                  } else if (pull_mode != 0u) {
                      command_send_err(NULL);
                      break;
                  }
                  gpio_set_mode(port, pin_mask, GPIO_MODE_INPUT, pull);
                  command_send_ok(NULL, 0);
                  break;
              }
              if (sub == EMW_GPIO_READ) {
                  gpio_set_mode(port, pin_mask, GPIO_MODE_INPUT, GPIO_NOPULL);
                  uint8_t out = (uint8_t)HAL_GPIO_ReadPin(port, pin_mask);
                  command_send_ok(&out, 1);
                  break;
              }
              if (sub == EMW_GPIO_HIGH || sub == EMW_GPIO_LOW) {
                  bool value = (sub == EMW_GPIO_HIGH);
                  gpio_write_latch(port, pin_mask, value);
                  gpio_set_mode(port, pin_mask, GPIO_MODE_OUTPUT_PP, GPIO_NOPULL);
                  HAL_GPIO_WritePin(port, pin_mask, value ? GPIO_PIN_SET : GPIO_PIN_RESET);
                  uint8_t out = (uint8_t)HAL_GPIO_ReadPin(port, pin_mask);
                  command_send_ok(&out, 1);
                  break;
              }
              if (sub == EMW_GPIO_INFO) {
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
                  break;
              }

              command_send_err(NULL);
              break;
          }

          case EMW_OP_ADC_READ: {
              uint8_t src = midi_packet[1];
              uint8_t pin_enc = midi_packet[2];
              uint8_t samples = midi_packet[3];
              if (samples < 1u) samples = 1u;
              if (samples > 64u) samples = 64u;

              uint32_t chsel_bit = 0;
              if (src == EMW_ADC_SRC_PIN) {
                  if (pin_enc > 31u) {
                      command_send_err(NULL);
                      break;
                  }
                  GPIO_TypeDef *port = NULL;
                  uint16_t pin_mask = 0;
                  if (!decode_encoded_pin((int)pin_enc, &port, &pin_mask)) {
                      command_send_err(NULL);
                      break;
                  }

                  uint8_t pin_index = 0;
                  if (!pin_mask_to_index(pin_mask, &pin_index)) {
                      command_send_err(NULL);
                      break;
                  }

                  disable_tim2_output_if_needed(port, pin_index);
                  gpio_set_mode(port, pin_mask, GPIO_MODE_ANALOG, GPIO_NOPULL);
                  if (!adc_channel_from_pin(port, pin_index, &chsel_bit)) {
                      command_send_err(NULL);
                      break;
                  }
              } else if (src == EMW_ADC_SRC_TEMP) {
                  ADC1_COMMON->CCR |= (ADC_CCR_TSEN | ADC_CCR_VREFEN);
                  chsel_bit = ADC_CHSELR_CHSEL16;
              } else if (src == EMW_ADC_SRC_VREFINT) {
                  ADC1_COMMON->CCR |= ADC_CCR_VREFEN;
                  chsel_bit = ADC_CHSELR_CHSEL17;
              } else if (src == EMW_ADC_SRC_VBAT) {
                  ADC1_COMMON->CCR |= ADC_CCR_VBATEN;
                  chsel_bit = ADC_CHSELR_CHSEL18;
              } else {
                  command_send_err(NULL);
                  break;
              }

              uint32_t sum = 0;
              for (uint32_t i = 0; i < (uint32_t)samples; i++) {
                  uint16_t v = 0;
                  if (!adc_read_single(chsel_bit, &v)) {
                      command_send_err(NULL);
                      goto adc_done_bin;
                  }
                  sum += (uint32_t)v;
              }
              uint16_t avg = (uint16_t)((sum + (uint32_t)(samples / 2u)) / (uint32_t)samples);
              uint8_t out[2] = {(uint8_t)(avg & 0xFFu), (uint8_t)((avg >> 8) & 0xFFu)};
              command_send_ok(out, sizeof(out));
adc_done_bin:
              break;
          }

          case EMW_OP_UART: {
              uint8_t sub = midi_packet[1];
              uint32_t baud = emw_u32_le(&midi_packet[2]);
              uint16_t timeout_ms = emw_u16_le(&midi_packet[6]);
              uint8_t n_or_len = midi_packet[8];

              if (sub == EMW_UART_OPEN) {
                  if (baud == 0u) baud = 115200u;
                  uart1_baud = baud;
                  if (!uart1_ensure(uart1_baud)) {
                      command_send_err(NULL);
                      break;
                  }
                  command_send_ok(NULL, 0);
                  break;
              }

              if (sub == EMW_UART_CLOSE) {
                  uart1_deinit();
                  command_send_ok(NULL, 0);
                  break;
              }

              if (sub == EMW_UART_WRITE) {
                  if (baud != 0u) {
                      uart1_baud = baud;
                  }
                  if (!uart1_ensure(uart1_baud)) {
                      command_send_err(NULL);
                      break;
                  }
                  if (timeout_ms == 0u) timeout_ms = 1000u;

                  uint8_t tx_len = n_or_len;
                  uint8_t max_tx = (uint8_t)(EMW_LANE_SIZE > 9u ? (EMW_LANE_SIZE - 9u) : 0u);
                  if (tx_len > max_tx) {
                      tx_len = max_tx;
                  }
                  size_t written = 0;
                  if (tx_len == 0u) {
                      uint8_t out = 0;
                      command_send_ok(&out, 1);
                      break;
                  }
                  if (!uart1_write(&midi_packet[9], tx_len, (uint32_t)timeout_ms, &written)) {
                      command_send_err(NULL);
                      break;
                  }
                  uint8_t out = (uint8_t)(written & 0xFFu);
                  command_send_ok(&out, 1);
                  break;
              }

              if (sub == EMW_UART_READ) {
                  if (baud != 0u) {
                      uart1_baud = baud;
                  }
                  if (!uart1_ensure(uart1_baud)) {
                      command_send_err(NULL);
                      break;
                  }
                  if (timeout_ms == 0u) timeout_ms = 250u;
                  uint8_t n = n_or_len;
                  // Response uses payload[0]=got + up to (EMW_RESP_MAX_PAYLOAD-1) bytes.
                  uint8_t max_n = (uint8_t)(EMW_RESP_MAX_PAYLOAD > 1u ? (EMW_RESP_MAX_PAYLOAD - 1u) : 0u);
                  if (n > max_n) n = max_n;
                  if (n == 0u) {
                      command_send_ok(NULL, 0);
                      break;
                  }
                  uint8_t rx_buf[64] = {0};
                  size_t got = 0;
                  if (!uart1_read(rx_buf, (size_t)n, (uint32_t)timeout_ms, &got)) {
                      command_send_err(NULL);
                      break;
                  }
                  if (got > max_n) got = max_n;
                  uint8_t payload[EMW_RESP_MAX_PAYLOAD] = {0};
                  payload[0] = (uint8_t)got;
                  if (got > 0) {
                      memcpy(&payload[1], rx_buf, got);
                  }
                  command_send_ok(payload, 1u + got);
                  break;
              }

              command_send_err(NULL);
              break;
          }

          case EMW_OP_I2C: {
              uint8_t sub = midi_packet[1];
              uint32_t hz = emw_u32_le(&midi_packet[2]);
              uint16_t timeout_ms = emw_u16_le(&midi_packet[6]);
              uint8_t addr = midi_packet[8] & 0x7Fu;
              uint8_t tx_len = midi_packet[9];
              uint8_t rx_len = midi_packet[10];

              if (hz != 0u) {
                  i2c1_hz = hz;
              }
              if (timeout_ms == 0u) timeout_ms = 250u;

              if (sub == EMW_I2C_OPEN) {
                  if (i2c1_hz == 0u) i2c1_hz = 100000u;
                  if (!i2c1_ensure(i2c1_hz)) {
                      command_send_err(NULL);
                      break;
                  }
                  command_send_ok(NULL, 0);
                  break;
              }

              if (sub == EMW_I2C_CLOSE) {
                  i2c1_deinit();
                  command_send_ok(NULL, 0);
                  break;
              }

              if (!i2c1_ensure(i2c1_hz)) {
                  command_send_err(NULL);
                  break;
              }

              if (sub == EMW_I2C_WRITE) {
                  if (tx_len == 0u) {
                      command_send_ok(NULL, 0);
                      break;
                  }
                  uint8_t max_tx = (uint8_t)(EMW_LANE_SIZE > 11u ? (EMW_LANE_SIZE - 11u) : 0u);
                  if (tx_len > max_tx) tx_len = max_tx;
                  if (!i2c1_write_then_maybe_stop(addr, &midi_packet[11], tx_len, true, (uint32_t)timeout_ms)) {
                      command_send_err(NULL);
                      break;
                  }
                  command_send_ok(NULL, 0);
                  break;
              }

              if (sub == EMW_I2C_READ) {
                  uint8_t n = tx_len;
                  if (n > EMW_RESP_MAX_PAYLOAD) n = (uint8_t)EMW_RESP_MAX_PAYLOAD;
                  if (n == 0u) {
                      command_send_ok(NULL, 0);
                      break;
                  }
                  uint8_t rx_buf[64] = {0};
                  if (!i2c1_read_with_stop(addr, rx_buf, (size_t)n, (uint32_t)timeout_ms)) {
                      command_send_err(NULL);
                      break;
                  }
                  command_send_ok(rx_buf, n);
                  break;
              }

              if (sub == EMW_I2C_XFER) {
                  uint8_t max_tx = (uint8_t)(EMW_LANE_SIZE > 11u ? (EMW_LANE_SIZE - 11u) : 0u);
                  if (tx_len > max_tx) tx_len = max_tx;
                  if (rx_len > EMW_RESP_MAX_PAYLOAD) rx_len = (uint8_t)EMW_RESP_MAX_PAYLOAD;
                  uint8_t rx_buf[64] = {0};
                  if (!i2c1_xfer(addr, &midi_packet[11], tx_len, rx_buf, (size_t)rx_len, (uint32_t)timeout_ms)) {
                      command_send_err(NULL);
                      break;
                  }
                  command_send_ok(rx_buf, rx_len);
                  break;
              }

              command_send_err(NULL);
              break;
          }

          case EMW_OP_SPI_XFER: {
              uint8_t cs_enc = midi_packet[1];
              uint8_t rx_req = midi_packet[2];
              uint8_t tx_len = midi_packet[3];
              if (cs_enc > 31u) {
                  command_send_err(NULL);
                  break;
              }
              uint8_t max_tx = (uint8_t)(EMW_LANE_SIZE > 4u ? (EMW_LANE_SIZE - 4u) : 0u);
              if (tx_len > max_tx) tx_len = max_tx;

              GPIO_TypeDef *cs_port = NULL;
              uint16_t cs_pin_mask = 0;
              if (!decode_encoded_pin((int)cs_enc, &cs_port, &cs_pin_mask)) {
                  command_send_err(NULL);
                  break;
              }

              uint8_t requested_rx = rx_req;
              if (requested_rx == 0u) {
                  requested_rx = tx_len;
              }
              if (requested_rx > EMW_RESP_MAX_PAYLOAD) requested_rx = (uint8_t)EMW_RESP_MAX_PAYLOAD;

              uint8_t xfer_len = tx_len > requested_rx ? tx_len : requested_rx;
              if (xfer_len == 0u || requested_rx == 0u) {
                  command_send_ok(NULL, 0);
                  break;
              }

              uint8_t tx_xfer[64] = {0};
              if (tx_len > 0u) {
                  memcpy(tx_xfer, &midi_packet[4], tx_len);
              }
              uint8_t rx_buf[64] = {0};

              enable_gpio_clock(cs_port);
              gpio_write_latch(cs_port, cs_pin_mask, true);
              configurePin(cs_port, cs_pin_mask, GPIO_MODE_OUTPUT_PP, GPIO_NOPULL, 0);
              HAL_GPIO_WritePin(cs_port, cs_pin_mask, GPIO_PIN_SET);

              HAL_GPIO_WritePin(cs_port, cs_pin_mask, GPIO_PIN_RESET);
              HAL_StatusTypeDef st = HAL_SPI_TransmitReceive(&hspi1, tx_xfer, rx_buf, (uint16_t)xfer_len, 100u);
              HAL_GPIO_WritePin(cs_port, cs_pin_mask, GPIO_PIN_SET);

              if (st != HAL_OK) {
                  command_send_err(NULL);
                  break;
              }

              command_send_ok(rx_buf, requested_rx);
              break;
          }

          case EMW_OP_SAMPLE: {
              uint8_t sub = midi_packet[1];
              if (sub == EMW_SAMPLE_START) {
                  uint8_t pin_enc = midi_packet[2];
                  uint8_t tick_us = midi_packet[3];
                  if (pin_enc > 31u) {
                      command_send_err(NULL);
                      break;
                  }
                  GPIO_TypeDef *port = NULL;
                  uint16_t pin_mask = 0;
                  if (!decode_encoded_pin((int)pin_enc, &port, &pin_mask)) {
                      command_send_err(NULL);
                      break;
                  }
                  uint32_t pull = (port == GPIOA && pin_mask == GPIO_PIN_1) ? GPIO_NOPULL : GPIO_PULLDOWN;
                  configurePin(port, pin_mask, GPIO_MODE_INPUT, pull, 0);
                  samplerPort = port;
                  samplerPin = pin_mask;

                  if (tick_us != 0u) {
                      tim3_set_tick_us(tick_us);
                  }

                  __disable_irq();
                  sampler_ring_head = 0;
                  sampler_ring_tail = 0;
                  sampler_ring_count = 0;
                  sampler_overflow_active = 0;
                  sampler_dropped_lanes = 0;
                  sampler_bit_index = 0;
                  sampler_byte_index = 0;
                  sampler_current_byte = 0;
                  __enable_irq();

                  EMW_USB_SetBufferType_FS(EMW_BUFFER_DOUBLE);
                  ism_mode = ISM_MODE_RAW_SAMPLING;
                  HAL_TIM_Base_Start_IT(&htim3);
                  command_send_ok(NULL, 0);
                  break;
              }
              if (sub == EMW_SAMPLE_STOP) {
                  stop_sampling();
                  command_send_ok(NULL, 0);
                  break;
              }
              command_send_err(NULL);
              break;
          }

          case EMW_OP_PWM: {
              uint8_t sub = midi_packet[1];
              if (sub == EMW_PWM_FREQ) {
                  uint32_t hz = emw_u32_le(&midi_packet[2]);
                  if (hz == 0u || !tim2_set_pwm_hz(hz)) {
                      command_send_err(NULL);
                      break;
                  }
                  command_send_ok(NULL, 0);
                  break;
              }

              if (sub == EMW_PWM_STOP) {
                  uint8_t pin_enc = midi_packet[2];
                  GPIO_TypeDef *port = NULL;
                  uint16_t pin_mask = 0;
                  if (!decode_encoded_pin((int)pin_enc, &port, &pin_mask)) {
                      command_send_err(NULL);
                      break;
                  }
                  uint8_t pin_index = 0;
                  if (!pin_mask_to_index(pin_mask, &pin_index)) {
                      command_send_err(NULL);
                      break;
                  }
                  uint32_t channel = 0;
                  pwm_route_t r = {0};
                  if (!pwm_route_from_pin(port, pin_index, &r)) {
                      command_send_err(NULL);
                      break;
                  }
                  // TIM3 routes are intentionally excluded (see pwm_route_from_pin).
                  pwm_stop_route(&r);
                  gpio_write_latch(port, pin_mask, false);
                  gpio_set_mode(port, pin_mask, GPIO_MODE_OUTPUT_PP, GPIO_NOPULL);
                  HAL_GPIO_WritePin(port, pin_mask, GPIO_PIN_RESET);
                  command_send_ok(NULL, 0);
                  break;
              }

              if (sub == EMW_PWM_WRITE) {
                  uint8_t pin_enc = midi_packet[2];
                  uint16_t value = emw_u16_le(&midi_packet[3]);
                  uint32_t hz = emw_u32_le(&midi_packet[5]);
                  if (value > 4095u) value = 4095u;

                  GPIO_TypeDef *port = NULL;
                  uint16_t pin_mask = 0;
                  if (!decode_encoded_pin((int)pin_enc, &port, &pin_mask)) {
                      command_send_err(NULL);
                      break;
                  }
                  uint8_t pin_index = 0;
                  if (!pin_mask_to_index(pin_mask, &pin_index)) {
                      command_send_err(NULL);
                      break;
                  }
                  pwm_route_t r = {0};
                  if (!pwm_route_from_pin(port, pin_index, &r)) {
                      command_send_err(NULL);
                      break;
                  }

                  if (hz != 0u) {
                      bool ok = false;
                      if (r.timer_id == PWM_TIMER_TIM2) ok = tim2_set_pwm_hz(hz);
                      else if (r.timer_id == PWM_TIMER_TIM14) ok = tim14_set_pwm_hz(hz);
                      else if (r.timer_id == PWM_TIMER_TIM16) ok = tim16_17_set_pwm_hz(TIM16, hz);
                      else if (r.timer_id == PWM_TIMER_TIM17) ok = tim16_17_set_pwm_hz(TIM17, hz);
                      if (!ok) {
                          command_send_err(NULL);
                          break;
                      }
                  }

                  if (value == 0u) {
                      pwm_stop_route(&r);
                      gpio_write_latch(port, pin_mask, false);
                      gpio_set_mode(port, pin_mask, GPIO_MODE_OUTPUT_PP, GPIO_NOPULL);
                      HAL_GPIO_WritePin(port, pin_mask, GPIO_PIN_RESET);
                  } else if (value >= 4095u) {
                      pwm_stop_route(&r);
                      gpio_write_latch(port, pin_mask, true);
                      gpio_set_mode(port, pin_mask, GPIO_MODE_OUTPUT_PP, GPIO_NOPULL);
                      HAL_GPIO_WritePin(port, pin_mask, GPIO_PIN_SET);
                  } else {
                      configurePin(port, pin_mask, GPIO_MODE_AF_PP, GPIO_NOPULL, r.af);
                      if (r.timer_id == PWM_TIMER_TIM2) {
                          tim2_set_ccr_from_u12(r.channel, value);
                      } else {
                          TIM_TypeDef *tim = (r.timer_id == PWM_TIMER_TIM14) ? TIM14 : (r.timer_id == PWM_TIMER_TIM16) ? TIM16 : TIM17;
                          tim14_16_17_set_ccr_from_u12(tim, value);
                      }
                      pwm_start_route(&r);
                  }
                  command_send_ok(NULL, 0);
                  break;
              }

              command_send_err(NULL);
              break;
          }

          case EMW_OP_TRANSMIT: {
              uint8_t sub = midi_packet[1];
              uint8_t pin = midi_packet[2];
              if (sub == EMW_TRANSMIT_STOP) {
                  command_send_ok(NULL, 0);
                  break;
              }
              if (sub != EMW_TRANSMIT_START || pin > 3u) {
                  command_send_err(NULL);
                  break;
              }

              // Optional configuration (mini-frame):
              //   [3] duty_percent (1..100, 0 => default)
              //   [4..7] pwm_hz (u32 LE, 0 => keep current/default)
              //   [8] tick_us (>=5, 0 => keep current)
              uint8_t duty_percent = midi_packet[3];
              if (duty_percent == 0u) {
                  duty_percent = 50u;
              }
              if (duty_percent > 100u) {
                  duty_percent = 100u;
              }
              uint32_t pwm_hz = emw_u32_le(&midi_packet[4]);
              uint8_t tick_us = midi_packet[8];

              uint32_t tim_channel = 0;
              uint16_t gpio_pin = 0;
              switch (pin) {
                  case 0: tim_channel = TIM_CHANNEL_1; gpio_pin = GPIO_PIN_0; break;
                  case 1: tim_channel = TIM_CHANNEL_2; gpio_pin = GPIO_PIN_1; break;
                  case 2: tim_channel = TIM_CHANNEL_3; gpio_pin = GPIO_PIN_2; break;
                  case 3: tim_channel = TIM_CHANNEL_4; gpio_pin = GPIO_PIN_3; break;
              }

              configurePin(GPIOA, gpio_pin, GPIO_MODE_AF_PP, GPIO_PULLDOWN, GPIO_AF2_TIM2);

              if (pwm_hz != 0u) {
                  (void)tim2_set_pwm_hz(pwm_hz);
              }
              setDutyCycle_TIM2(tim_channel, duty_percent);
              selectedChannel = tim_channel;
              selectedChannelMask = tim2_ccer_mask_from_channel(tim_channel);
              tx_bit_index = 0u;
              tx_current_byte = 0u;
              tx_out_enabled = 0u;
              (void)HAL_TIM_PWM_Start(&htim2, tim_channel);

              if (tick_us != 0u) {
                  tim3_set_tick_us(tick_us);
              }

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
              break;
          }

          default: {
              command_send_err(NULL);
              break;
          }
      }

      midi_packet_consume();
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
  htim3.Init.Period = 240-1;
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
