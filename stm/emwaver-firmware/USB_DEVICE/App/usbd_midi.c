/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : usbd_midi.c
  * @brief          : USB Device MIDI class (Audio/MIDI Streaming).
  ******************************************************************************
  *
  * Minimal class-compliant USB MIDI implementation for EMWaver testing.
  *
  * EMWaver modifications
  * Copyright (c) 2026 Luís Marnoto
  */
/* USER CODE END Header */

#include "usbd_midi.h"
#include "usbd_ctlreq.h"

typedef struct
{
  uint8_t *RxBuffer;
  uint8_t *TxBuffer;
  uint32_t RxLength;
  uint32_t TxLength;
  __IO uint32_t TxState;
} USBD_MIDI_ClassDataTypeDef;

// USB Audio class-specific descriptor types.
#define CS_INTERFACE 0x24U
#define CS_ENDPOINT  0x25U

// USB Audio Control (AC) / MIDI Streaming (MS) subtypes.
#define AC_HEADER 0x01U
#define MS_HEADER 0x01U
#define MIDI_IN_JACK  0x02U
#define MIDI_OUT_JACK 0x03U
#define MS_GENERAL    0x01U

// Jack types.
#define JACK_EMBEDDED 0x01U
#define JACK_EXTERNAL 0x02U

// Audio Interface class/subclass for MIDI.
#define USB_DEVICE_CLASS_AUDIO 0x01U
#define AUDIO_SUBCLASS_CONTROL 0x01U
#define AUDIO_SUBCLASS_MIDISTREAMING 0x03U

// Descriptor sizes.
#define USB_CONFIGURATION_DESC_SIZE 9U
#define USB_INTERFACE_DESC_SIZE 9U
#define USB_ENDPOINT_DESC_SIZE 7U

// A very small, class-compliant USB MIDI 1.0 configuration: 2 interfaces (AC + MS) and 2 bulk EPs.
__ALIGN_BEGIN static uint8_t USBD_MIDI_CfgFSDesc[] __ALIGN_END =
{
  // Configuration Descriptor
  0x09,                         // bLength
  USB_DESC_TYPE_CONFIGURATION,  // bDescriptorType
  0x61, 0x00,                   // wTotalLength (97 bytes)
  0x02,                         // bNumInterfaces (AC + MS)
  0x01,                         // bConfigurationValue
  0x00,                         // iConfiguration
  0x80,                         // bmAttributes (bus powered)
  0x32,                         // bMaxPower (100mA)

  // Interface 0: Audio Control (no endpoints)
  0x09,                         // bLength
  USB_DESC_TYPE_INTERFACE,      // bDescriptorType
  0x00,                         // bInterfaceNumber
  0x00,                         // bAlternateSetting
  0x00,                         // bNumEndpoints
  USB_DEVICE_CLASS_AUDIO,       // bInterfaceClass (Audio)
  AUDIO_SUBCLASS_CONTROL,       // bInterfaceSubClass (Audio Control)
  0x00,                         // bInterfaceProtocol
  0x00,                         // iInterface

  // Class-specific AC Interface Header Descriptor
  0x09,                         // bLength
  CS_INTERFACE,                 // bDescriptorType
  AC_HEADER,                    // bDescriptorSubtype
  0x00, 0x01,                   // bcdADC (1.00)
  0x09, 0x00,                   // wTotalLength
  0x01,                         // bInCollection
  0x01,                         // baInterfaceNr(1) = MIDI Streaming interface 1

  // Interface 1: MIDI Streaming
  0x09,                         // bLength
  USB_DESC_TYPE_INTERFACE,      // bDescriptorType
  0x01,                         // bInterfaceNumber
  0x00,                         // bAlternateSetting
  0x02,                         // bNumEndpoints (Bulk IN + Bulk OUT)
  USB_DEVICE_CLASS_AUDIO,       // bInterfaceClass (Audio)
  AUDIO_SUBCLASS_MIDISTREAMING, // bInterfaceSubClass (MIDI Streaming)
  0x00,                         // bInterfaceProtocol
  0x00,                         // iInterface

  // Class-specific MS Interface Header Descriptor
  0x07,                         // bLength
  CS_INTERFACE,                 // bDescriptorType
  MS_HEADER,                    // bDescriptorSubtype
  0x00, 0x01,                   // bcdMSC (1.00)
  0x2F, 0x00,                   // wTotalLength (47 bytes)

  // MIDI IN Jack Descriptor (Embedded) - ID 0x01
  0x06,                         // bLength
  CS_INTERFACE,                 // bDescriptorType
  MIDI_IN_JACK,                 // bDescriptorSubtype
  JACK_EMBEDDED,                // bJackType
  0x01,                         // bJackID
  0x00,                         // iJack

  // MIDI IN Jack Descriptor (External) - ID 0x02
  0x06,                         // bLength
  CS_INTERFACE,                 // bDescriptorType
  MIDI_IN_JACK,                 // bDescriptorSubtype
  JACK_EXTERNAL,                // bJackType
  0x02,                         // bJackID
  0x00,                         // iJack

  // MIDI OUT Jack Descriptor (Embedded) - ID 0x03, source = External IN (0x02)
  0x09,                         // bLength
  CS_INTERFACE,                 // bDescriptorType
  MIDI_OUT_JACK,                // bDescriptorSubtype
  JACK_EMBEDDED,                // bJackType
  0x03,                         // bJackID
  0x01,                         // bNrInputPins
  0x02,                         // BaSourceID(1)
  0x01,                         // BaSourcePin(1)
  0x00,                         // iJack

  // MIDI OUT Jack Descriptor (External) - ID 0x04, source = Embedded IN (0x01)
  0x09,                         // bLength
  CS_INTERFACE,                 // bDescriptorType
  MIDI_OUT_JACK,                // bDescriptorSubtype
  JACK_EXTERNAL,                // bJackType
  0x04,                         // bJackID
  0x01,                         // bNrInputPins
  0x01,                         // BaSourceID(1)
  0x01,                         // BaSourcePin(1)
  0x00,                         // iJack

  // OUT Endpoint Descriptor (host -> device)
  0x07,                         // bLength
  USB_DESC_TYPE_ENDPOINT,       // bDescriptorType
  MIDI_OUT_EP,                  // bEndpointAddress
  0x02,                         // bmAttributes (Bulk)
  LOBYTE(MIDI_DATA_FS_MAX_PACKET_SIZE), HIBYTE(MIDI_DATA_FS_MAX_PACKET_SIZE), // wMaxPacketSize
  0x00,                         // bInterval

  // Class-specific MS Bulk OUT Endpoint Descriptor
  0x05,                         // bLength
  CS_ENDPOINT,                  // bDescriptorType
  MS_GENERAL,                   // bDescriptorSubtype
  0x01,                         // bNumEmbMIDIJack
  0x01,                         // BaAssocJackID(1) = Embedded IN Jack (0x01)

  // IN Endpoint Descriptor (device -> host)
  0x07,                         // bLength
  USB_DESC_TYPE_ENDPOINT,       // bDescriptorType
  MIDI_IN_EP,                   // bEndpointAddress
  0x02,                         // bmAttributes (Bulk)
  LOBYTE(MIDI_DATA_FS_MAX_PACKET_SIZE), HIBYTE(MIDI_DATA_FS_MAX_PACKET_SIZE), // wMaxPacketSize
  0x00,                         // bInterval

  // Class-specific MS Bulk IN Endpoint Descriptor
  0x05,                         // bLength
  CS_ENDPOINT,                  // bDescriptorType
  MS_GENERAL,                   // bDescriptorSubtype
  0x01,                         // bNumEmbMIDIJack
  0x03,                         // BaAssocJackID(1) = Embedded OUT Jack (0x03)
};

static uint8_t USBD_MIDI_Init(USBD_HandleTypeDef *pdev, uint8_t cfgidx);
static uint8_t USBD_MIDI_DeInit(USBD_HandleTypeDef *pdev, uint8_t cfgidx);
static uint8_t USBD_MIDI_Setup(USBD_HandleTypeDef *pdev, USBD_SetupReqTypedef *req);
static uint8_t USBD_MIDI_DataIn(USBD_HandleTypeDef *pdev, uint8_t epnum);
static uint8_t USBD_MIDI_DataOut(USBD_HandleTypeDef *pdev, uint8_t epnum);
static uint8_t *USBD_MIDI_GetFSCfgDesc(uint16_t *length);

USBD_ClassTypeDef USBD_MIDI =
{
  USBD_MIDI_Init,
  USBD_MIDI_DeInit,
  USBD_MIDI_Setup,
  NULL,
  NULL,
  USBD_MIDI_DataIn,
  USBD_MIDI_DataOut,
  NULL,
  NULL,
  NULL,
  USBD_MIDI_GetFSCfgDesc,
  USBD_MIDI_GetFSCfgDesc,
  USBD_MIDI_GetFSCfgDesc,
  NULL,
};

static uint8_t USBD_MIDI_Init(USBD_HandleTypeDef *pdev, uint8_t cfgidx)
{
  (void)cfgidx;

  USBD_MIDI_ClassDataTypeDef *hmidi;
  pdev->pClassData = USBD_malloc(sizeof(USBD_MIDI_ClassDataTypeDef));
  if (pdev->pClassData == NULL) {
    return USBD_FAIL;
  }
  hmidi = (USBD_MIDI_ClassDataTypeDef *)pdev->pClassData;
  hmidi->TxState = 0U;
  hmidi->RxBuffer = NULL;
  hmidi->TxBuffer = NULL;
  hmidi->RxLength = 0U;
  hmidi->TxLength = 0U;

  // Open endpoints
  (void)USBD_LL_OpenEP(pdev, MIDI_IN_EP, USBD_EP_TYPE_BULK, MIDI_DATA_FS_MAX_PACKET_SIZE);
  (void)USBD_LL_OpenEP(pdev, MIDI_OUT_EP, USBD_EP_TYPE_BULK, MIDI_DATA_FS_MAX_PACKET_SIZE);

  // Start reception
  ((USBD_MIDI_ItfTypeDef *)pdev->pUserData)->Init();
  if (hmidi->RxBuffer != NULL) {
    (void)USBD_LL_PrepareReceive(pdev, MIDI_OUT_EP, hmidi->RxBuffer, MIDI_DATA_FS_MAX_PACKET_SIZE);
  }

  return USBD_OK;
}

static uint8_t USBD_MIDI_DeInit(USBD_HandleTypeDef *pdev, uint8_t cfgidx)
{
  (void)cfgidx;

  (void)USBD_LL_CloseEP(pdev, MIDI_IN_EP);
  (void)USBD_LL_CloseEP(pdev, MIDI_OUT_EP);

  if (pdev->pClassData != NULL) {
    ((USBD_MIDI_ItfTypeDef *)pdev->pUserData)->DeInit();
    USBD_free(pdev->pClassData);
    pdev->pClassData = NULL;
  }

  return USBD_OK;
}

static uint8_t USBD_MIDI_Setup(USBD_HandleTypeDef *pdev, USBD_SetupReqTypedef *req)
{
  switch (req->bmRequest & USB_REQ_TYPE_MASK)
  {
    case USB_REQ_TYPE_CLASS:
      // No class-specific control requests needed for basic USB MIDI streaming.
      // Accept and no-op to keep hosts happy.
      (void)pdev;
      (void)req;
      return USBD_OK;

    case USB_REQ_TYPE_STANDARD:
      switch (req->bRequest)
      {
        case USB_REQ_GET_DESCRIPTOR:
        case USB_REQ_GET_INTERFACE:
        case USB_REQ_SET_INTERFACE:
        default:
          break;
      }
      break;

    default:
      break;
  }

  return USBD_OK;
}

static uint8_t USBD_MIDI_DataIn(USBD_HandleTypeDef *pdev, uint8_t epnum)
{
  (void)epnum;
  USBD_MIDI_ClassDataTypeDef *hmidi = (USBD_MIDI_ClassDataTypeDef *)pdev->pClassData;
  hmidi->TxState = 0U;
  return USBD_OK;
}

static uint8_t USBD_MIDI_DataOut(USBD_HandleTypeDef *pdev, uint8_t epnum)
{
  (void)epnum;
  USBD_MIDI_ClassDataTypeDef *hmidi = (USBD_MIDI_ClassDataTypeDef *)pdev->pClassData;

  hmidi->RxLength = USBD_LL_GetRxDataSize(pdev, MIDI_OUT_EP);
  if (pdev->pUserData != NULL && hmidi->RxBuffer != NULL) {
    uint32_t len32 = hmidi->RxLength;
    (void)((USBD_MIDI_ItfTypeDef *)pdev->pUserData)->Receive(hmidi->RxBuffer, &len32);
  }

  (void)USBD_LL_PrepareReceive(pdev, MIDI_OUT_EP, hmidi->RxBuffer, MIDI_DATA_FS_MAX_PACKET_SIZE);
  return USBD_OK;
}

static uint8_t *USBD_MIDI_GetFSCfgDesc(uint16_t *length)
{
  *length = (uint16_t)sizeof(USBD_MIDI_CfgFSDesc);
  return USBD_MIDI_CfgFSDesc;
}

uint8_t USBD_MIDI_RegisterInterface(USBD_HandleTypeDef *pdev, USBD_MIDI_ItfTypeDef *fops)
{
  if (fops == NULL) {
    return USBD_FAIL;
  }
  pdev->pUserData = fops;
  return USBD_OK;
}

uint8_t USBD_MIDI_SetTxBuffer(USBD_HandleTypeDef *pdev, uint8_t *pbuff, uint16_t length)
{
  USBD_MIDI_ClassDataTypeDef *hmidi = (USBD_MIDI_ClassDataTypeDef *)pdev->pClassData;
  hmidi->TxBuffer = pbuff;
  hmidi->TxLength = length;
  return USBD_OK;
}

uint8_t USBD_MIDI_TransmitPacket(USBD_HandleTypeDef *pdev)
{
  USBD_MIDI_ClassDataTypeDef *hmidi = (USBD_MIDI_ClassDataTypeDef *)pdev->pClassData;
  if (hmidi->TxState != 0U) {
    return USBD_BUSY;
  }
  hmidi->TxState = 1U;
  return (uint8_t)USBD_LL_Transmit(pdev, MIDI_IN_EP, hmidi->TxBuffer, (uint16_t)hmidi->TxLength);
}

uint8_t USBD_MIDI_SetRxBuffer(USBD_HandleTypeDef *pdev, uint8_t *pbuff)
{
  USBD_MIDI_ClassDataTypeDef *hmidi = (USBD_MIDI_ClassDataTypeDef *)pdev->pClassData;
  hmidi->RxBuffer = pbuff;
  return USBD_OK;
}

uint8_t USBD_MIDI_ReceivePacket(USBD_HandleTypeDef *pdev)
{
  USBD_MIDI_ClassDataTypeDef *hmidi = (USBD_MIDI_ClassDataTypeDef *)pdev->pClassData;
  if (hmidi->RxBuffer == NULL) {
    return USBD_FAIL;
  }
  return (uint8_t)USBD_LL_PrepareReceive(pdev, MIDI_OUT_EP, hmidi->RxBuffer, MIDI_DATA_FS_MAX_PACKET_SIZE);
}
