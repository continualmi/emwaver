/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : usbd_midi_if.h
  * @brief          : Header for usbd_midi_if.c file.
  ******************************************************************************
  *
  * EMWaver modifications
  * Copyright (c) 2026 Luís Marnoto
  */
/* USER CODE END Header */

#ifndef __USBD_MIDI_IF_H__
#define __USBD_MIDI_IF_H__

#ifdef __cplusplus
 extern "C" {
#endif

#include <stdint.h>
#include "usbd_midi.h"

typedef enum {
  EMW_BUFFER_PACKET = 0,
  EMW_BUFFER_CIRCULAR = 1,
  EMW_BUFFER_DOUBLE = 2,
} EMW_Buffer_Type;

extern USBD_MIDI_ItfTypeDef USBD_MIDI_Interface_fops_FS;

uint8_t MIDI_ReadRxBuffer_FS(uint8_t* Buf, uint16_t Len);
uint16_t MIDI_GetRxBufferBytesAvailable_FS(void);
void MIDI_FlushRxBuffer_FS(void);
void MIDI_InitRxBuffer_FS(void);
void MIDI_FreeRxBuffer_FS(void);
void MIDI_SendStatusPacket_FS(uint16_t status);
void MIDI_Print_FS(const char* str);
uint8_t MIDI_SendResponsePkt_FS(uint8_t* packet, uint16_t length, uint32_t timeout);

void MIDI_SetBufferType_FS(EMW_Buffer_Type buffer_type);
EMW_Buffer_Type MIDI_GetBufferType_FS(void);

#ifdef __cplusplus
}
#endif

#endif /* __USBD_MIDI_IF_H__ */
