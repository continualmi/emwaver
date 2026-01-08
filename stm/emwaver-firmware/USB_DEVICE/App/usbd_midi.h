/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : usbd_midi.h
  * @brief          : USB Device MIDI class (Audio/MIDI Streaming) header.
  ******************************************************************************
  *
  * Minimal class-compliant USB MIDI implementation for EMWaver testing.
  *
  * EMWaver modifications
  * Copyright (c) 2026 Luís Marnoto
  */
/* USER CODE END Header */

#ifndef __USBD_MIDI_H
#define __USBD_MIDI_H

#ifdef __cplusplus
extern "C" {
#endif

#include "usbd_ioreq.h"

#define USBD_MIDI_EP0_MAX_PACKET_SIZE 64U

#define MIDI_IN_EP  0x81U
#define MIDI_OUT_EP 0x01U

#define MIDI_DATA_FS_MAX_PACKET_SIZE 64U

typedef struct _USBD_MIDI_Itf
{
  int8_t (*Init)(void);
  int8_t (*DeInit)(void);
  int8_t (*Receive)(uint8_t *buf, uint32_t *len);
} USBD_MIDI_ItfTypeDef;

typedef struct
{
  uint32_t data[8]; /* 32-byte alignment storage; sized by MAX_STATIC_ALLOC_SIZE elsewhere */
} USBD_MIDI_HandleTypeDef;

extern USBD_ClassTypeDef USBD_MIDI;

uint8_t USBD_MIDI_RegisterInterface(USBD_HandleTypeDef *pdev, USBD_MIDI_ItfTypeDef *fops);

uint8_t USBD_MIDI_SetTxBuffer(USBD_HandleTypeDef *pdev, uint8_t *pbuff, uint16_t length);
uint8_t USBD_MIDI_TransmitPacket(USBD_HandleTypeDef *pdev);
uint8_t USBD_MIDI_IsTxBusy(USBD_HandleTypeDef *pdev);
uint32_t USBD_MIDI_GetDataInCount(void);

uint8_t USBD_MIDI_SetRxBuffer(USBD_HandleTypeDef *pdev, uint8_t *pbuff);
uint8_t USBD_MIDI_ReceivePacket(USBD_HandleTypeDef *pdev);

#ifdef __cplusplus
}
#endif

#endif /* __USBD_MIDI_H */

