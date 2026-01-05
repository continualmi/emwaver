/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file.
  *                   This file contains the common defines of the application.
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

/* Define to prevent recursive inclusion -------------------------------------*/
#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

/* Includes ------------------------------------------------------------------*/
#include "stm32f0xx_hal.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */

/* USER CODE END Includes */

/* Exported types ------------------------------------------------------------*/
/* USER CODE BEGIN ET */

/* USER CODE END ET */

/* Exported constants --------------------------------------------------------*/
/* USER CODE BEGIN EC */

/* USER CODE END EC */

/* Exported macro ------------------------------------------------------------*/
/* USER CODE BEGIN EM */

/* USER CODE END EM */

void HAL_TIM_MspPostInit(TIM_HandleTypeDef *htim);

/* Exported functions prototypes ---------------------------------------------*/
void Error_Handler(void);

/* USER CODE BEGIN EFP */
extern SPI_HandleTypeDef hspi1;
/* USER CODE END EFP */

/* Private defines -----------------------------------------------------------*/
#define IR_RX_Pin GPIO_PIN_1
#define IR_RX_GPIO_Port GPIOA
#define NSS_RFID_Pin GPIO_PIN_4
#define NSS_RFID_GPIO_Port GPIOA
#define RESET_Pin GPIO_PIN_6
#define RESET_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
#define CC1101_CS_Pin NSS_RFID_Pin
#define CC1101_CS_GPIO_Port NSS_RFID_GPIO_Port
#define CC1101_MISO_Pin GPIO_PIN_6
#define CC1101_MISO_GPIO_Port GPIOA

#define CommandReg     0x01
#define ComIEnReg      0x02
#define DivIEnReg      0x03
#define ComIrqReg      0x04
#define DivIrqReg      0x05
#define ErrorReg       0x06
#define Status1Reg     0x07
#define Status2Reg     0x08
#define FIFODataReg    0x09
#define FIFOLevelReg   0x0A
#define WaterLevelReg  0x0B
#define ControlReg     0x0C
#define BitFramingReg  0x0D
#define CollReg        0x0E

#define ModeReg        0x11
#define TxModeReg      0x12
#define RxModeReg      0x13
#define TxControlReg   0x14
#define TxASKReg       0x15
#define TxSelReg       0x16
#define RxSelReg       0x17
#define RxThresholdReg 0x18
#define DemodReg       0x19
#define MifareReg      0x1C
#define SerialSpeedReg 0x1F

#define CRCResultRegH  0x21
#define CRCResultRegL  0x22
#define ModWidthReg    0x24
#define RFCfgReg       0x26
#define GsNReg         0x27
#define CWGsPReg       0x28
#define ModGsPReg      0x29
#define TModeReg       0x2A
#define TPrescalerReg  0x2B
#define TReloadRegH    0x2C
#define TReloadRegL    0x2D
#define TCounterValueRegH 0x2E
#define TCounterValueRegL 0x2F

#define VersionReg 0x37

#define TRUE 1
#define FALSE 0

#define PICC_CMD_REQA 0x26



#define STATUS_OK 0
#define STATUS_TIMEOUT 1
#define STATUS_COLLISION 2

// MFRC522 Commands
#define PCD_Idle       0x00
#define PCD_Mem        0x01
#define PCD_GenerateRandomID 0x02
#define PCD_CalcCRC    0x03
#define PCD_Transmit   0x04
#define PCD_NoCmdChange 0x07
#define PCD_Receive    0x08
#define PCD_Transceive 0x0C
#define PCD_MFAuthent  0x0E
#define PCD_SoftReset  0x0F
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
