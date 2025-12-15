#include "stm_sampler.h"

#include "command_registry.h"
#include "main.h"
#include "usbd_cdc_if.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>

extern TIM_HandleTypeDef htim2;
extern TIM_HandleTypeDef htim3;

typedef enum {
    IDLE,
    SAMPLING,
    TRANSMITTING
} SystemState;

static uint16_t sampler_pin;
static uint32_t selected_channel = TIM_CHANNEL_3;
static volatile SystemState current_state = IDLE;
static volatile int transmit_duty_cycle = 50;

static volatile uint8_t *buffer_a = NULL;
static volatile uint8_t *buffer_b = NULL;
static volatile uint8_t *current_buffer = NULL;
static volatile uint8_t *transmit_buffer = NULL;
static volatile int buffer_index = 0;
static volatile uint8_t buffer_ready = 0;

static void configure_pin(uint16_t pin, uint32_t mode, uint32_t pull)
{
    GPIO_InitTypeDef GPIO_InitStruct = {0};

    __HAL_RCC_GPIOA_CLK_ENABLE();

    GPIO_InitStruct.Pin = pin;
    GPIO_InitStruct.Mode = mode;
    GPIO_InitStruct.Pull = pull;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    if (mode == GPIO_MODE_AF_PP) {
        GPIO_InitStruct.Alternate = GPIO_AF2_TIM2;
    }

    HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);
}

static void start_pwm_tim2(uint32_t channel)
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
    }
}

static void stop_pwm_tim2(uint32_t channel)
{
    switch (channel) {
        case TIM_CHANNEL_1:
            TIM2->CCER &= ~TIM_CCER_CC1E;
            break;
        case TIM_CHANNEL_2:
            TIM2->CCER &= ~TIM_CCER_CC2E;
            break;
        case TIM_CHANNEL_3:
            TIM2->CCER &= ~TIM_CCER_CC3E;
            break;
        case TIM_CHANNEL_4:
            TIM2->CCER &= ~TIM_CCER_CC4E;
            break;
    }
}

static void set_duty_cycle_tim2(uint32_t channel, uint8_t percentage)
{
    if (percentage < 1) percentage = 1;
    if (percentage > 100) percentage = 100;

    uint32_t period = TIM2->ARR;
    uint32_t new_ccr = (period * percentage) / 100;

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
    }
}

static void isr_sampler_raw(void)
{
    static uint8_t bit_index = 0;
    static uint8_t current_byte = 0;

    uint8_t pin_state = HAL_GPIO_ReadPin(GPIOA, sampler_pin);

    if (pin_state) {
        current_byte |= (uint8_t)(1u << bit_index);
    } else {
        current_byte &= (uint8_t)~(1u << bit_index);
    }

    bit_index++;
    if (bit_index >= 8) {
        current_buffer[buffer_index] = current_byte;
        buffer_index++;
        bit_index = 0;
        current_byte = 0;

        if (buffer_index >= 64) {
            transmit_buffer = current_buffer;
            current_buffer = (current_buffer == buffer_a) ? buffer_b : buffer_a;
            buffer_index = 0;
            buffer_ready = 1;
        }
    }
}

static void isr_sampler_writing(void)
{
    static uint8_t bit_index = 0;
    static uint8_t current_byte = 0;

    if (CDC_GetRxBufferBytesAvailable_FS() > 0) {
        if (bit_index == 0) {
            CDC_ReadRxBuffer_FS(&current_byte, 1);
        }

        if (current_byte & (uint8_t)(1u << bit_index)) {
            start_pwm_tim2(selected_channel);
        } else {
            stop_pwm_tim2(selected_channel);
        }

        bit_index++;
        if (bit_index > 7) {
            bit_index = 0;
        }
    } else {
        stop_pwm_tim2(selected_channel);
    }
}

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim)
{
    if (htim != &htim3) {
        return;
    }

    switch (CDC_GetBufferType_FS()) {
        case CDC_BUFFER_CIRCULAR:
            isr_sampler_writing();
            break;
        case CDC_BUFFER_DOUBLE:
            isr_sampler_raw();
            break;
        case CDC_BUFFER_PACKET:
        default:
            break;
    }
}

static void stop_sampling(void)
{
    HAL_TIM_Base_Stop_IT(&htim3);
    CDC_SetBufferType_FS(CDC_BUFFER_PACKET);
    if (buffer_a) {
        free((void *)buffer_a);
        buffer_a = NULL;
    }
    if (buffer_b) {
        free((void *)buffer_b);
        buffer_b = NULL;
    }
    current_buffer = NULL;
    transmit_buffer = NULL;
    buffer_index = 0;
    buffer_ready = 0;
    current_state = IDLE;
}

static void stop_transmitting(void)
{
    HAL_TIM_Base_Stop_IT(&htim3);
    stop_pwm_tim2(selected_channel);
    CDC_FlushRxBuffer_FS();
    CDC_FreeRxBuffer_FS();
    CDC_SetBufferType_FS(CDC_BUFFER_PACKET);
    current_state = IDLE;
}

static void cmd_sample_start(int pin_num)
{
    if (current_state == SAMPLING) {
        CDC_Print_FS("ERR: Already sampling\n");
        return;
    }

    if (current_state == TRANSMITTING) {
        stop_transmitting();
    }

    uint16_t gpio_pin_mask = 0;
    uint32_t pull_mode = GPIO_PULLDOWN;
    switch (pin_num) {
        case 0:
            gpio_pin_mask = GPIO_PIN_0;
            break;
        case 1:
            gpio_pin_mask = GPIO_PIN_1;
            pull_mode = GPIO_NOPULL;
            break;
        case 2:
            gpio_pin_mask = GPIO_PIN_2;
            break;
        case 3:
            gpio_pin_mask = GPIO_PIN_3;
            break;
        default:
            CDC_Print_FS("ERR: Invalid sample pin\n");
            return;
    }

    configure_pin(gpio_pin_mask, GPIO_MODE_INPUT, pull_mode);
    sampler_pin = gpio_pin_mask;

    if (buffer_a == NULL) buffer_a = (uint8_t *)malloc(64);
    if (buffer_b == NULL) buffer_b = (uint8_t *)malloc(64);
    current_buffer = buffer_a;
    transmit_buffer = NULL;
    buffer_index = 0;
    buffer_ready = 0;
    CDC_SetBufferType_FS(CDC_BUFFER_DOUBLE);

    HAL_TIM_Base_Start_IT(&htim3);
    current_state = SAMPLING;
    CDC_Print_FS("OK: Sampling started\n");
}

static void cmd_sample_stop(void)
{
    if (current_state != SAMPLING) {
        CDC_Print_FS("ERR: Not sampling\n");
        return;
    }

    stop_sampling();
    CDC_Print_FS("OK: Sampling stopped\n");
}

static void cmd_transmit_start(int pin_num)
{
    uint16_t gpio_pin = 0;
    uint32_t tim_channel = 0;
    switch (pin_num) {
        case 0:
            tim_channel = TIM_CHANNEL_1;
            gpio_pin = GPIO_PIN_0;
            break;
        case 1:
            tim_channel = TIM_CHANNEL_2;
            gpio_pin = GPIO_PIN_1;
            break;
        case 2:
            tim_channel = TIM_CHANNEL_3;
            gpio_pin = GPIO_PIN_2;
            break;
        case 3:
            tim_channel = TIM_CHANNEL_4;
            gpio_pin = GPIO_PIN_3;
            break;
        default:
            CDC_Print_FS("ERR: Invalid transmit pin\n");
            return;
    }

    if (current_state == TRANSMITTING) {
        CDC_Print_FS("ERR: Already transmitting\n");
        return;
    }

    if (current_state == SAMPLING) {
        stop_sampling();
    }

    configure_pin(gpio_pin, GPIO_MODE_AF_PP, GPIO_PULLDOWN);
    set_duty_cycle_tim2(tim_channel, (uint8_t)transmit_duty_cycle);
    selected_channel = tim_channel;

    HAL_TIM_PWM_Start(&htim2, tim_channel);
    CDC_InitRxBuffer_FS();
    CDC_SetBufferType_FS(CDC_BUFFER_CIRCULAR);
    HAL_TIM_Base_Start_IT(&htim3);

    current_state = TRANSMITTING;
    CDC_Print_FS("OK: Transmission started\n");
}

static void cmd_transmit_stop(void)
{
    if (current_state != TRANSMITTING) {
        CDC_Print_FS("ERR: Not transmitting\n");
        return;
    }

    stop_transmitting();
    CDC_Print_FS("OK: Transmission stopped\n");
}

void stm_sampler_register_commands(void)
{
    static const cmd_arg_spec_t sample_start_args[] = {
        {.name = "pin", .type = CMD_ARG_INT, .required = true},
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const cmd_arg_spec_t transmit_start_args[] = {
        {.name = "pin", .type = CMD_ARG_INT, .required = true},
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const command_entry_t sampler_command_table[] = {
        {.verb = "sample start", .args = sample_start_args, .handler = (void *)cmd_sample_start},
        {.verb = "sample stop", .args = NULL, .handler = (void *)cmd_sample_stop},
        {.verb = "transmit start", .args = transmit_start_args, .handler = (void *)cmd_transmit_start},
        {.verb = "transmit stop", .args = NULL, .handler = (void *)cmd_transmit_stop},
    };

    (void)command_registry_add_table(sampler_command_table,
                                    sizeof(sampler_command_table) / sizeof(sampler_command_table[0]));
}

void stm_sampler_process(void)
{
    if (current_state == SAMPLING) {
        if (buffer_ready == 1) {
            if (CDC_Transmit_FS((uint8_t *)transmit_buffer, 64) == USBD_OK) {
                buffer_ready = 0;
            }
        }
        return;
    }

    if (current_state == TRANSMITTING) {
        static uint32_t last_data_tick = 0;
        if (CDC_GetRxBufferBytesAvailable_FS() > 0) {
            last_data_tick = HAL_GetTick();
        }
        if (HAL_GetTick() - last_data_tick > 2000) {
            stop_transmitting();
            CDC_Print_FS("OK: Transmission stopped (timeout)\n");
        }
    }
}

