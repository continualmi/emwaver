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
#include <stdio.h>
#include <stdlib.h>
#include "usbd_cdc_if.h"
#include "MFRC522.h"
#include "command_registry.h"
#include "cc1101.h"
#include "stm_gpio.h"
#include "stm_sampler.h"
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
uint8_t * bulk_packet = NULL;
size_t bulk_packet_len = 0;

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

static void stm_register_commands(void);

static void cmd_version(void);

static void stm_register_commands(void)
{
    static const command_entry_t stm_command_table[] = {
        {.verb = "version", .args = NULL, .handler = (void *)cmd_version},
    };

    (void)command_registry_add_table(stm_command_table,
                                    sizeof(stm_command_table) / sizeof(stm_command_table[0]));
}

void startPWM_TIM2_CH3() {
    // Enable the timer first
    TIM2->CR1 |= TIM_CR1_CEN;
    // Enable the channel with current duty cycle
    TIM2->CCER |= TIM_CCER_CC3E;
}

void stopPWM_TIM2_CH3() {
    // Disable only the channel, keep timer running
    TIM2->CCER &= ~TIM_CCER_CC3E;
}

uint32_t getCurrentFrequency() {

    uint32_t timerClock = 48000000;  // Assuming the timer clock is 48 MHz
    uint32_t period = TIM2->ARR;     // Read the current period value

    // Calculate the current frequency
    uint32_t frequency = timerClock / (period + 1);
    uint8_t responsePacket[4]; // 4 bytes for the frequency
	responsePacket[0] = (uint8_t)(frequency >> 24); // Frequency high byte
	responsePacket[1] = (uint8_t)(frequency >> 16) & 0xFF; // Frequency middle byte
	responsePacket[2] = (uint8_t)(frequency >> 8) & 0xFF; // Frequency low byte
	responsePacket[3] = (uint8_t)frequency & 0xFF; // Frequency low byte

    CDC_SendResponsePkt_FS(responsePacket, 4, 100); // Adjust the timeout as needed

    return frequency;
}

void changeFrequency(uint32_t desiredFrequency) {
    uint32_t timerClock = 48000000;  // Assuming the timer clock is 48 MHz
    uint32_t period;

    // Calculate the period for the desired frequency
    period = timerClock / desiredFrequency - 1;

    // Check if the calculated period is within the valid range
    if (period > 0xFFFF) {
        // Handle error: desired frequency is too low to achieve with the current prescaler
        return;
    }

    // Stop the timer before making changes
    HAL_TIM_PWM_Stop(&htim2, TIM_CHANNEL_3);

    // Directly set the timer period
    TIM2->ARR = period;

    // Directly set the PWM channel duty cycle (pulse width)
    TIM2->CCR3 = period / 2;  // Assuming 50% duty cycle
    // Generate an update event to update the shadow registers
    TIM2->EGR = TIM_EGR_UG;

    // Restart the PWM generation
    HAL_TIM_PWM_Start(&htim2, TIM_CHANNEL_3);

    // Optionally, retrieve and send back the current frequency to confirm the change
    getCurrentFrequency();
}

void delay_us(uint32_t microseconds)
{
    // Assuming TIM1 has been initialized elsewhere in your code
    // with Prescaler = 48 - 1 and Period = 0xFFFF - 1

    // Reset the counter value
    __HAL_TIM_SET_COUNTER(&htim1, 0);

    // Start the timer
    HAL_TIM_Base_Start(&htim1);

    // Wait until the timer reaches the specified microseconds
    while (__HAL_TIM_GET_COUNTER(&htim1) < microseconds);

    // Stop the timer
    HAL_TIM_Base_Stop(&htim1);
}

void sendPulse(uint32_t burstLength, uint32_t spaceLength)
{
	// Start PWM output for the burst length
	startPWM_TIM2_CH3(); // Start PWM
	delay_us(burstLength); // Delay for the burst duration in microseconds

	// Stop PWM output for the space length
	stopPWM_TIM2_CH3(); // Stop PWM
	delay_us(spaceLength); // Delay for the space duration in microseconds
}

void free_bulk_packet(){
	if (bulk_packet != NULL) {
	    free(bulk_packet);
	    bulk_packet = NULL; // Ensure the pointer is set to NULL after freeing
	}
}

void setDutyCycle_TIM2_CH3(uint8_t percentage) {
    // Ensure percentage is between 1 and 100
    if (percentage < 1) percentage = 1;
    if (percentage > 100) percentage = 100;

    // Calculate the new CCR value
    uint32_t period = TIM2->ARR;
    uint32_t new_ccr = (period * percentage) / 100;

    // Set the new CCR value
    TIM2->CCR3 = new_ccr;
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
	  command_registry_init();
	  cc1101_register_commands();
	  stm_gpio_register_commands();
	  stm_sampler_register_commands();
	  mfrc522_register_commands();
	  stm_register_commands();

	  /* USER CODE END 2 */

	/* USER CODE BEGIN 1 */
	/* USER CODE END 1 */
/* USER CODE BEGIN 2 */

  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
		  while (1) {
			      if (bulk_packet != NULL) {
			          size_t cmd_len = bulk_packet_len;
			          if (cmd_len > CLI_COMMAND_BUFFER) {
			              cmd_len = CLI_COMMAND_BUFFER;
			          }

			          static command_t cmd;
			          memcpy(cmd.data, bulk_packet, cmd_len);
			          cmd.length = (uint16_t)cmd_len;
			          free_bulk_packet();

			          if (command_registry_is_ascii(&cmd)) {
			              command_registry_handle(&cmd);
			          }
			      }

        stm_sampler_process();
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

static void cmd_version(void)
{
    static const uint8_t versionMsg[] = "OK: 1.0.0 - Welcome to EMWaver!\n";
    (void)CDC_SendResponsePkt_FS((uint8_t *)versionMsg, (uint16_t)(sizeof(versionMsg) - 1), CDC_TIMEOUT);
}

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
