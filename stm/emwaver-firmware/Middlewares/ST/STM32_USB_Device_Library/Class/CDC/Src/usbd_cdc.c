/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : usbd_cdc.c
  * @brief          : USB CDC class stub (compatibility).
  ******************************************************************************
  *
  * EMWaver firmware uses USB MIDI at runtime. This stub exists only so older
  * CubeIDE-generated makefiles that still list `usbd_cdc.c` can compile/link.
  */
/* USER CODE END Header */

#include "usbd_cdc.h"

USBD_ClassTypeDef USBD_CDC = {0};

uint8_t USBD_CDC_RegisterInterface(USBD_HandleTypeDef *pdev, USBD_CDC_ItfTypeDef *fops)
{
  (void)pdev;
  (void)fops;
  return (uint8_t)USBD_OK;
}

uint8_t USBD_CDC_SetTxBuffer(USBD_HandleTypeDef *pdev, uint8_t *pbuff, uint16_t length)
{
  (void)pdev;
  (void)pbuff;
  (void)length;
  return (uint8_t)USBD_OK;
}

uint8_t USBD_CDC_SetRxBuffer(USBD_HandleTypeDef *pdev, uint8_t *pbuff)
{
  (void)pdev;
  (void)pbuff;
  return (uint8_t)USBD_OK;
}

uint8_t USBD_CDC_TransmitPacket(USBD_HandleTypeDef *pdev)
{
  (void)pdev;
  return (uint8_t)USBD_OK;
}

uint8_t USBD_CDC_ReceivePacket(USBD_HandleTypeDef *pdev)
{
  (void)pdev;
  return (uint8_t)USBD_OK;
}

