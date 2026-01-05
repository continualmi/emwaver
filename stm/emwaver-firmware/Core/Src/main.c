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
#include "emwaver_usb_io.h"
#include "cc1101.h"
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

#define ISM_BURST_MAX 64u

typedef enum {
    ISM_MODE_IDLE = 0,
    ISM_MODE_RAW_SAMPLING = 1,
} ism_mode_t;

static volatile ism_mode_t ism_mode = ISM_MODE_IDLE;

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
    // Match stm/emwaver-ism-firmware framing: always send 64-byte packets.
    // The desktop/mobile buffer logic treats USB as fixed 64B framing.
    if (!data || len == 0) {
        uint8_t packet[64] = {0};
        packet[0] = 0x00;
        (void)EMW_USB_SendResponsePkt_FS(packet, (uint16_t)sizeof(packet), CDC_TIMEOUT);
        return;
    }

    size_t offset = 0;
    while (offset < len) {
        uint8_t packet[64] = {0};
        size_t chunk = len - offset;
        if (chunk > sizeof(packet)) {
            chunk = sizeof(packet);
        }
        memcpy(packet, data + offset, chunk);
        (void)EMW_USB_SendResponsePkt_FS(packet, (uint16_t)sizeof(packet), CDC_TIMEOUT);
        offset += chunk;
    }
}

static void command_send_err(const char *msg)
{
    (void)msg;
    // Match the registry firmware behavior: errors are best-effort no-ops.
    const uint8_t packet[64] = {0};
    (void)EMW_USB_SendResponsePkt_FS((uint8_t *)packet, (uint16_t)sizeof(packet), CDC_TIMEOUT);
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

	/* USER CODE BEGIN 1 */
	/* USER CODE END 1 */
/* USER CODE BEGIN 2 */

  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1) {
      if (ism_mode == ISM_MODE_RAW_SAMPLING) {
          if (bufferReady == 1) {
              (void)EMW_USB_SendResponsePkt_FS((uint8_t *)transmitBuffer, 64, CDC_TIMEOUT);
              bufferReady = 0;
          }

          if (bulk_packet != NULL) {
              // `sample stop`
              if (bulk_packet_len >= 11 && memcmp((const void *)bulk_packet, "sample stop", 11) == 0) {
                  stop_sampling();
                  command_send_ok(NULL, 0);
              }
              free_bulk_packet();
          }
          continue;
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
          static const char msg[] = EMWAVER_FIRMWARE_WELCOME " " EMWAVER_FIRMWARE_VERSION;
          command_send_ok((const uint8_t *)msg, sizeof(msg) - 1u);
          free_bulk_packet();
          continue;
      }

      if (cmd.verb && strcmp(cmd.verb, "cc1101") == 0 && cmd.positional_count > 0) {
          const char *sub = cmd.positional[0];

          if (strcmp(sub, "init") == 0) {
              // `--cs` is accepted for parity with other platforms, but STM32 uses a fixed CS pin.
              // (See `CC1101_CS_*` in `cc1101.c`.)
              cc1101_init();
              command_send_ok(NULL, 0);
              free_bulk_packet();
              continue;
          }

          if (!cc1101_is_initialized()) {
              cc1101_init();
          }

          if (strcmp(sub, "read") == 0) {
              int reg_i = -1;
              const char *reg_str = cli_get_arg_view(&cmd, "reg");
              if (!cli_parse_int(reg_str, &reg_i) || reg_i < 0 || reg_i > 255) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }
              uint8_t out = cc1101_read_reg((uint8_t)reg_i);
              command_send_ok(&out, 1);
              free_bulk_packet();
              continue;
          }

          if (strcmp(sub, "write") == 0) {
              int reg_i = -1;
              int val_i = -1;
              const char *reg_str = cli_get_arg_view(&cmd, "reg");
              const char *val_str = cli_get_arg_view(&cmd, "val");
              if (!cli_parse_int(reg_str, &reg_i) || reg_i < 0 || reg_i > 255 ||
                  !cli_parse_int(val_str, &val_i) || val_i < 0 || val_i > 255) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }
              cc1101_write_reg((uint8_t)reg_i, (uint8_t)val_i);
              command_send_ok(NULL, 0);
              free_bulk_packet();
              continue;
          }

          if (strcmp(sub, "strobe") == 0) {
              int cmd_i = -1;
              const char *cmd_str = cli_get_arg_view(&cmd, "cmd");
              if (!cli_parse_int(cmd_str, &cmd_i) || cmd_i < 0 || cmd_i > 255) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }
              uint8_t status = cc1101_strobe((uint8_t)cmd_i);
              command_send_ok(&status, 1);
              free_bulk_packet();
              continue;
          }

          if (strcmp(sub, "read_burst") == 0) {
              int reg_i = -1;
              int len_i = -1;
              const char *reg_str = cli_get_arg_view(&cmd, "reg");
              const char *len_str = cli_get_arg_view(&cmd, "len");
              if (!cli_parse_int(reg_str, &reg_i) || reg_i < 0 || reg_i > 255 ||
                  !cli_parse_int(len_str, &len_i) || len_i <= 0) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              size_t len = (size_t)len_i;
              if (len > 64u) {
                  len = 64u;
              }

              uint8_t out[64] = {0};
              cc1101_read_burst((uint8_t)reg_i, out, len);
              command_send_ok(out, len);
              free_bulk_packet();
              continue;
          }

          if (strcmp(sub, "write_burst") == 0) {
              int reg_i = -1;
              const char *reg_str = cli_get_arg_view(&cmd, "reg");
              const char *data_str = cli_get_arg_view(&cmd, "data");
              if (!cli_parse_int(reg_str, &reg_i) || reg_i < 0 || reg_i > 255 || !data_str) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              uint8_t bytes[64] = {0};
              size_t bytes_len = 0;
              if (!cli_parse_hex_bytes(data_str, bytes, sizeof(bytes), &bytes_len) || bytes_len == 0) {
                  command_send_err(NULL);
                  free_bulk_packet();
                  continue;
              }

              (void)cc1101_write_burst((uint8_t)reg_i, bytes, bytes_len);
              command_send_ok(NULL, 0);
              free_bulk_packet();
              continue;
          }

          if (strcmp(sub, "defaults") == 0) {
              cc1101_apply_defaults();
              command_send_ok(NULL, 0);
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
                  if ((HAL_GetTick() - start) > 2000) {
                      break;
                  }
              }

              HAL_TIM_Base_Start_IT(&htim3);
              while (EMW_USB_GetRxBufferBytesAvailable_FS() != 0) {
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

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(RESET_GPIO_Port, RESET_Pin, GPIO_PIN_RESET);

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

  /*Configure GPIO pin : RESET_Pin */
  GPIO_InitStruct.Pin = RESET_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(RESET_GPIO_Port, &GPIO_InitStruct);

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
