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
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"
#include "usb_device.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include <stdlib.h>
#include <string.h>
#include "usbd_cdc_if.h"
#include "cc1101.h"
/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */
#define CDC_TIMEOUT 100
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
uint16_t samplerPin;
volatile uint32_t selectedChannel = TIM_CHANNEL_3; // Default to channel 3 for backward compatibility

uint8_t * bulk_packet = NULL;
size_t bulk_packet_len = 0;

volatile uint8_t* bufferA = NULL;
volatile uint8_t* bufferB = NULL;
volatile uint8_t* currentBuffer = NULL;
volatile uint8_t* transmitBuffer = NULL;
volatile int bufferIndex = 0;
volatile uint8_t bufferReady = 0;

volatile CDC_Buffer_Type cdc_buf_type = CDC_BUFFER_PACKET;
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

static void send_err(void)
{
    static const uint8_t msg[] = "ERR";
    (void)CDC_SendResponsePkt_FS((uint8_t *)msg, (uint16_t)(sizeof(msg) - 1), CDC_TIMEOUT);
}

static void send_ok(void)
{
    static const uint8_t msg[] = "OK";
    (void)CDC_SendResponsePkt_FS((uint8_t *)msg, (uint16_t)(sizeof(msg) - 1), CDC_TIMEOUT);
}

static void ISR_Sampler_raw(void)
{
    static uint8_t bitIndex = 0;
    static uint8_t currentByte = 0;

    uint8_t pin_state = HAL_GPIO_ReadPin(GPIOA, samplerPin);

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

    if (CDC_GetRxBufferBytesAvailable_FS() > 0) {
        if (bitIndex == 0) {
            (void)CDC_ReadRxBuffer_FS(&currentByte, 1);
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
        switch (CDC_GetBufferType_FS()) {
            case CDC_BUFFER_CIRCULAR:
                ISR_Sampler_writing();
                break;
            case CDC_BUFFER_DOUBLE:
                ISR_Sampler_raw();
                break;
            case CDC_BUFFER_PACKET:
            default:
                break;
        }
    }
}

static void configurePin(uint16_t pin, uint32_t mode, uint32_t pull)
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
	  cc1101_init();

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
              while (CDC_Transmit_FS((uint8_t *)transmitBuffer, 64) == USBD_BUSY) {
              }
              bufferReady = 0;
          }

          if (bulk_packet != NULL && bulk_packet_len >= 1 && bulk_packet[0] == 's') {
              HAL_TIM_Base_Stop_IT(&htim3);
              CDC_SetBufferType_FS(CDC_BUFFER_PACKET);

              free((void *)bufferA);
              free((void *)bufferB);
              bufferA = NULL;
              bufferB = NULL;
              currentBuffer = NULL;
              transmitBuffer = NULL;
              bufferIndex = 0;
              bufferReady = 0;
              ism_mode = ISM_MODE_IDLE;
              free_bulk_packet();
          }
          continue;
      }

      if (bulk_packet == NULL) {
          continue;
      }

      if (bulk_packet_len < 1) {
          send_err();
          free_bulk_packet();
          continue;
      }

      // Legacy CC1101 register access protocol (from ../emwaver-firmware):
      //  ! [addr] [val]            => write reg, returns readback (1 byte)
      //  ? [addr]                  => read reg, returns value (1 byte)
      //  % [cmd]                   => strobe, returns status (1 byte)
      //  > [addr] [len] [data...]  => burst write, returns status (1 byte)
      //  < [addr] [len]            => burst read, returns data (len bytes)
      //  I                         => init cc1101, returns "OK"
      // Legacy sampler/tx (from ../emwaver-firmware):
      //  raw [pin]                 => start sampler (64-byte packets) until 's'
      //  tran [pin#][duty%]        => transmit using circular CDC buffer (auto-stops when drained)

      if (bulk_packet[0] == '!') {
          if (bulk_packet_len < 3) {
              send_err();
              free_bulk_packet();
              continue;
          }
          uint8_t addr = bulk_packet[1];
          uint8_t val = bulk_packet[2];
          cc1101_write_reg(addr, val);
          uint8_t readback = cc1101_read_reg(addr);
          (void)CDC_SendResponsePkt_FS(&readback, 1, CDC_TIMEOUT);
          free_bulk_packet();
      } else if (bulk_packet[0] == '?') {
          if (bulk_packet_len < 2) {
              send_err();
              free_bulk_packet();
              continue;
          }
          uint8_t addr = bulk_packet[1];
          uint8_t reading = cc1101_read_reg(addr);
          (void)CDC_SendResponsePkt_FS(&reading, 1, CDC_TIMEOUT);
          free_bulk_packet();
      } else if (bulk_packet[0] == '%') {
          if (bulk_packet_len < 2) {
              send_err();
              free_bulk_packet();
              continue;
          }
          uint8_t cmd = bulk_packet[1];
          uint8_t status = cc1101_strobe(cmd);
          (void)CDC_SendResponsePkt_FS(&status, 1, CDC_TIMEOUT);
          free_bulk_packet();
      } else if (bulk_packet[0] == '>') {
          if (bulk_packet_len < 3) {
              send_err();
              free_bulk_packet();
              continue;
          }
          uint8_t addr = bulk_packet[1];
          uint8_t len = bulk_packet[2];
          if (len > ISM_BURST_MAX) {
              len = ISM_BURST_MAX;
          }
          if (bulk_packet_len < (size_t)(3u + len)) {
              send_err();
              free_bulk_packet();
              continue;
          }
          uint8_t status = cc1101_write_burst(addr, &bulk_packet[3], (size_t)len);
          (void)CDC_SendResponsePkt_FS(&status, 1, CDC_TIMEOUT);
          free_bulk_packet();
      } else if (bulk_packet[0] == '<') {
          if (bulk_packet_len < 3) {
              send_err();
              free_bulk_packet();
              continue;
          }
          uint8_t addr = bulk_packet[1];
          uint8_t len = bulk_packet[2];
          if (len > ISM_BURST_MAX) {
              len = ISM_BURST_MAX;
          }
          uint8_t out[ISM_BURST_MAX] = {0};
          cc1101_read_burst(addr, out, (size_t)len);
          (void)CDC_SendResponsePkt_FS(out, len, CDC_TIMEOUT);
          free_bulk_packet();
      } else if (bulk_packet[0] == 'I') {
          cc1101_init();
          send_ok();
          free_bulk_packet();
      } else if (bulk_packet_len >= 4 && memcmp((const void *)bulk_packet, "raw", 3) == 0) {
          // raw [pin] (same packet layout as legacy): bulk_packet[3] is GPIO_PIN_0..GPIO_PIN_7
          uint32_t pull = (bulk_packet[3] == GPIO_PIN_1) ? GPIO_NOPULL : GPIO_PULLDOWN;
          configurePin(bulk_packet[3], GPIO_MODE_INPUT, pull);
          samplerPin = bulk_packet[3];

          bufferA = (uint8_t *)malloc(64);
          bufferB = (uint8_t *)malloc(64);
          if (bufferA == NULL || bufferB == NULL) {
              send_err();
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
          CDC_SetBufferType_FS(CDC_BUFFER_DOUBLE);
          ism_mode = ISM_MODE_RAW_SAMPLING;

          HAL_TIM_Base_Start_IT(&htim3);
          free_bulk_packet();
      } else if (bulk_packet_len >= 6 && memcmp((const void *)bulk_packet, "tran", 4) == 0) {
          uint8_t pin_number = bulk_packet[4];
          uint8_t duty_cycle = bulk_packet[5];
          uint32_t tim_channel;
          uint16_t gpio_pin;

          switch (pin_number) {
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
                  send_err();
                  free_bulk_packet();
                  continue;
          }

          configurePin(gpio_pin, GPIO_MODE_AF_PP, GPIO_PULLDOWN);
          setDutyCycle_TIM2(tim_channel, duty_cycle);
          selectedChannel = tim_channel;
          (void)HAL_TIM_PWM_Start(&htim2, tim_channel);

          CDC_InitRxBuffer_FS();
          CDC_SetBufferType_FS(CDC_BUFFER_CIRCULAR);

          uint32_t start = HAL_GetTick();
          while (CDC_GetRxBufferBytesAvailable_FS() < 250) {
              if ((HAL_GetTick() - start) > 2000) {
                  break;
              }
          }

          HAL_TIM_Base_Start_IT(&htim3);
          while (CDC_GetRxBufferBytesAvailable_FS() != 0) {
          }
          CDC_SetBufferType_FS(CDC_BUFFER_PACKET);
          HAL_TIM_Base_Stop_IT(&htim3);

          stopPWM_TIM2(tim_channel);
          CDC_FlushRxBuffer_FS();
          CDC_FreeRxBuffer_FS();

          send_ok();
          free_bulk_packet();
      } else {
          send_err();
          free_bulk_packet();
      }
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
