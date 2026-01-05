/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : usbd_cdc.h
  * @brief          : USB CDC class stub (compatibility).
  ******************************************************************************
  *
  * EMWaver firmware uses USB MIDI at runtime. This stub exists only so older
  * CubeIDE-generated makefiles that still list `usbd_cdc.c` can compile/link.
  */
/* USER CODE END Header */

#ifndef __USBD_CDC_H
#define __USBD_CDC_H

#ifdef __cplusplus
extern "C" {
#endif

#include "usbd_ioreq.h"

typedef struct _USBD_CDC_Itf
{
  int8_t (*Init)(void);
  int8_t (*DeInit)(void);
  int8_t (*Control)(uint8_t cmd, uint8_t *pbuf, uint16_t length);
  int8_t (*Receive)(uint8_t *buf, uint32_t *len);
} USBD_CDC_ItfTypeDef;

typedef struct
{
  uint32_t data[8];
} USBD_CDC_HandleTypeDef;

extern USBD_ClassTypeDef USBD_CDC;

uint8_t USBD_CDC_RegisterInterface(USBD_HandleTypeDef *pdev, USBD_CDC_ItfTypeDef *fops);
uint8_t USBD_CDC_SetTxBuffer(USBD_HandleTypeDef *pdev, uint8_t *pbuff, uint16_t length);
uint8_t USBD_CDC_SetRxBuffer(USBD_HandleTypeDef *pdev, uint8_t *pbuff);
uint8_t USBD_CDC_TransmitPacket(USBD_HandleTypeDef *pdev);
uint8_t USBD_CDC_ReceivePacket(USBD_HandleTypeDef *pdev);

#ifdef __cplusplus
}
#endif

#endif /* __USBD_CDC_H */

