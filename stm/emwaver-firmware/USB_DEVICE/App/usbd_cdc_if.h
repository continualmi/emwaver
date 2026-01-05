/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : usbd_cdc_if.h
  * @brief          : Compatibility CDC interface header (stub).
  ******************************************************************************
  *
  * This firmware uses USB MIDI at runtime. This header exists only to keep
  * legacy STM32CubeIDE-generated makefiles (that still reference CDC sources)
  * building without requiring regeneration.
  */
/* USER CODE END Header */

#ifndef __USBD_CDC_IF_H__
#define __USBD_CDC_IF_H__

#ifdef __cplusplus
 extern "C" {
#endif

#include <stdint.h>

typedef enum {
  CDC_BUFFER_PACKET = 0,
  CDC_BUFFER_CIRCULAR = 1,
  CDC_BUFFER_DOUBLE = 2,
} CDC_Buffer_Type;

uint8_t CDC_ReadRxBuffer_FS(uint8_t* Buf, uint16_t Len);
uint16_t CDC_GetRxBufferBytesAvailable_FS(void);
void CDC_FlushRxBuffer_FS(void);
void CDC_InitRxBuffer_FS(void);
void CDC_FreeRxBuffer_FS(void);
void CDC_SendStatusPacket_FS(uint16_t status);
void CDC_Print_FS(const char* str);
uint8_t CDC_SendResponsePkt_FS(uint8_t* packet, uint16_t length, uint32_t timeout);

void CDC_SetBufferType_FS(CDC_Buffer_Type buffer_type);
uint8_t CDC_GetBufferType_FS(void);

#ifdef __cplusplus
}
#endif

#endif /* __USBD_CDC_IF_H__ */

