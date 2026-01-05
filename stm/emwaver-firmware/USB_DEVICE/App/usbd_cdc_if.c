/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : usbd_cdc_if.c
  * @brief          : Compatibility CDC interface implementation (stub).
  ******************************************************************************
  *
  * This firmware uses USB MIDI at runtime. This source exists only to keep
  * legacy STM32CubeIDE-generated makefiles (that still reference CDC sources)
  * building without requiring regeneration.
  */
/* USER CODE END Header */

#include "usbd_cdc_if.h"
#include "usbd_midi_if.h"

uint8_t CDC_ReadRxBuffer_FS(uint8_t* Buf, uint16_t Len) { return MIDI_ReadRxBuffer_FS(Buf, Len); }
uint16_t CDC_GetRxBufferBytesAvailable_FS(void) { return MIDI_GetRxBufferBytesAvailable_FS(); }
void CDC_FlushRxBuffer_FS(void) { MIDI_FlushRxBuffer_FS(); }
void CDC_InitRxBuffer_FS(void) { MIDI_InitRxBuffer_FS(); }
void CDC_FreeRxBuffer_FS(void) { MIDI_FreeRxBuffer_FS(); }
void CDC_SendStatusPacket_FS(uint16_t status) { MIDI_SendStatusPacket_FS(status); }
void CDC_Print_FS(const char* str) { MIDI_Print_FS(str); }
uint8_t CDC_SendResponsePkt_FS(uint8_t* packet, uint16_t length, uint32_t timeout) {
  return MIDI_SendResponsePkt_FS(packet, length, timeout);
}

void CDC_SetBufferType_FS(CDC_Buffer_Type buffer_type) { MIDI_SetBufferType_FS((EMW_Buffer_Type)buffer_type); }
uint8_t CDC_GetBufferType_FS(void) { return (uint8_t)MIDI_GetBufferType_FS(); }

