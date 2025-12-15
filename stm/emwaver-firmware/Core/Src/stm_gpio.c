#include "stm_gpio.h"

#include "command_registry.h"
#include "main.h"
#include "usbd_cdc_if.h"

#include <stdbool.h>
#include <stdio.h>
#include <stdint.h>

#define CDC_TIMEOUT 100

extern TIM_HandleTypeDef htim2;

static GPIO_TypeDef *get_gpio_port(uint8_t port)
{
    switch (port) {
        case 0:
            __HAL_RCC_GPIOA_CLK_ENABLE();
            return GPIOA;
        case 1:
            __HAL_RCC_GPIOB_CLK_ENABLE();
            return GPIOB;
        default:
            return NULL;
    }
}

static void gpio_write_latch(GPIO_TypeDef *gpio_port, uint16_t gpio_pin, bool value)
{
    if (!gpio_port) {
        return;
    }
    if (value) {
        gpio_port->BSRR = gpio_pin;
    } else {
        gpio_port->BSRR = (uint32_t)gpio_pin << 16;
    }
}

static void set_pin_mode(uint8_t port, uint8_t pin, uint8_t mode)
{
    GPIO_TypeDef *gpio_port = get_gpio_port(port);
    if (!gpio_port) {
        return;
    }

    GPIO_InitTypeDef GPIO_InitStruct = {0};
    GPIO_InitStruct.Pin = (uint16_t)(1u << pin);
    if (mode == 0) {
        GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
    } else if (mode == 1) {
        GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
    } else {
        return;
    }
    GPIO_InitStruct.Pull = GPIO_NOPULL;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
    HAL_GPIO_DeInit(gpio_port, GPIO_InitStruct.Pin);
    HAL_GPIO_Init(gpio_port, &GPIO_InitStruct);
}

static void disable_tim2_output_if_needed(uint8_t port, uint8_t pin)
{
    if (port != 0) {
        return;
    }

    uint32_t channel = 0;
    uint32_t ccer_mask = 0;
    switch (pin) {
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

    TIM2->CCER &= ~ccer_mask;
    HAL_TIM_PWM_Stop(&htim2, channel);
}

static void cmd_gpio_info(int port_int, int pin_int)
{
    if (!((port_int == 0) || (port_int == 1))) {
        CDC_Print_FS("ERR: Invalid GPIO port\n");
        return;
    }
    if (pin_int < 0 || pin_int > 15) {
        CDC_Print_FS("ERR: Invalid GPIO pin\n");
        return;
    }

    uint8_t port = (uint8_t)port_int;
    uint8_t pin = (uint8_t)pin_int;
    GPIO_TypeDef *gpio_port = get_gpio_port(port);
    if (!gpio_port) {
        CDC_Print_FS("ERR: Invalid GPIO port\n");
        return;
    }

    uint32_t moder = gpio_port->MODER;
    uint32_t otyper = gpio_port->OTYPER;
    uint32_t pupdr = gpio_port->PUPDR;
    uint32_t idr = gpio_port->IDR;
    uint32_t odr = gpio_port->ODR;
    uint32_t afr = (pin < 8) ? gpio_port->AFR[0] : gpio_port->AFR[1];

    uint8_t mode = (uint8_t)((moder >> (pin * 2)) & 0x03);
    uint8_t otype = (uint8_t)((otyper >> pin) & 0x01);
    uint8_t pupd = (uint8_t)((pupdr >> (pin * 2)) & 0x03);
    uint8_t idr_bit = (uint8_t)((idr >> pin) & 0x01);
    uint8_t odr_bit = (uint8_t)((odr >> pin) & 0x01);
    uint8_t af = (uint8_t)((afr >> ((pin % 8) * 4)) & 0x0F);

    uint8_t response[6] = {mode, otype, pupd, af, idr_bit, odr_bit};
    (void)CDC_SendResponsePkt_FS(response, sizeof(response), CDC_TIMEOUT);

    const char *mode_str = "unknown";
    switch (mode) {
        case 0: mode_str = "input"; break;
        case 1: mode_str = "output"; break;
        case 2: mode_str = "af"; break;
        case 3: mode_str = "analog"; break;
    }

    const char *pupd_str = "unknown";
    switch (pupd) {
        case 0: pupd_str = "none"; break;
        case 1: pupd_str = "pullup"; break;
        case 2: pupd_str = "pulldown"; break;
        case 3: pupd_str = "reserved"; break;
    }

    static char line[96];
    (void)snprintf(line,
                   sizeof(line),
                   "OK: GPIO info mode=%s otype=%u pupd=%s af=%u idr=%u odr=%u\n",
                   mode_str,
                   (unsigned)otype,
                   pupd_str,
                   (unsigned)af,
                   (unsigned)idr_bit,
                   (unsigned)odr_bit);
    CDC_Print_FS(line);
}

static void cmd_gpio_read(int port_int, int pin_int)
{
    if (!((port_int == 0) || (port_int == 1))) {
        CDC_Print_FS("ERR: Invalid GPIO port\n");
        return;
    }
    if (pin_int < 0 || pin_int > 15) {
        CDC_Print_FS("ERR: Invalid GPIO pin\n");
        return;
    }

    uint8_t port = (uint8_t)port_int;
    uint8_t pin = (uint8_t)pin_int;
    GPIO_TypeDef *gpio_port = get_gpio_port(port);
    if (!gpio_port) {
        CDC_Print_FS("ERR: Invalid GPIO port\n");
        return;
    }
    uint16_t gpio_pin = (uint16_t)(1u << pin);

    disable_tim2_output_if_needed(port, pin);
    set_pin_mode(port, pin, 0);
    uint8_t response_val = (uint8_t)HAL_GPIO_ReadPin(gpio_port, gpio_pin);
    (void)CDC_SendResponsePkt_FS(&response_val, 1, CDC_TIMEOUT);
    CDC_Print_FS("OK: GPIO read\n");
}

static void cmd_gpio_write(int port_int, int pin_int, int value_int)
{
    if (!((port_int == 0) || (port_int == 1))) {
        CDC_Print_FS("ERR: Invalid GPIO port\n");
        return;
    }
    if (pin_int < 0 || pin_int > 15) {
        CDC_Print_FS("ERR: Invalid GPIO pin\n");
        return;
    }

    uint8_t port = (uint8_t)port_int;
    uint8_t pin = (uint8_t)pin_int;
    GPIO_TypeDef *gpio_port = get_gpio_port(port);
    if (!gpio_port) {
        CDC_Print_FS("ERR: Invalid GPIO port\n");
        return;
    }
    uint16_t gpio_pin = (uint16_t)(1u << pin);
    bool value = value_int ? true : false;

    disable_tim2_output_if_needed(port, pin);
    gpio_write_latch(gpio_port, gpio_pin, value);
    set_pin_mode(port, pin, 1);
    HAL_GPIO_WritePin(gpio_port, gpio_pin, value ? GPIO_PIN_SET : GPIO_PIN_RESET);
    uint8_t response_val = (uint8_t)HAL_GPIO_ReadPin(gpio_port, gpio_pin);
    (void)CDC_SendResponsePkt_FS(&response_val, 1, CDC_TIMEOUT);
    CDC_Print_FS("OK: GPIO written\n");
}

void stm_gpio_register_commands(void)
{
    static const cmd_arg_spec_t gpio_r_args[] = {
        {.name = NULL, .type = CMD_ARG_INT, .required = true}, // port
        {.name = NULL, .type = CMD_ARG_INT, .required = true}, // pin
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const cmd_arg_spec_t gpio_w_args[] = {
        {.name = NULL, .type = CMD_ARG_INT, .required = true}, // port
        {.name = NULL, .type = CMD_ARG_INT, .required = true}, // pin
        {.name = NULL, .type = CMD_ARG_INT, .required = true}, // value
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const cmd_arg_spec_t gpio_i_args[] = {
        {.name = NULL, .type = CMD_ARG_INT, .required = true}, // port
        {.name = NULL, .type = CMD_ARG_INT, .required = true}, // pin
        {.name = NULL, .type = CMD_ARG_DONE, .required = false},
    };

    static const command_entry_t gpio_command_table[] = {
        {.verb = "gpio R", .args = gpio_r_args, .handler = (void *)cmd_gpio_read},
        {.verb = "gpio W", .args = gpio_w_args, .handler = (void *)cmd_gpio_write},
        {.verb = "gpio I", .args = gpio_i_args, .handler = (void *)cmd_gpio_info},
    };

    (void)command_registry_add_table(gpio_command_table,
                                    sizeof(gpio_command_table) / sizeof(gpio_command_table[0]));
}
