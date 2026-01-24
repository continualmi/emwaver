/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : usbd_midi_if.c
  * @brief          : USB Device MIDI interface for EMWaver.
  ******************************************************************************
  *
  * Mini-frame SysEx tunnel (single-callback, fixed-size):
  *
  *   One USB OUT transaction (64 bytes) == one EMW frame.
  *   The USB payload is 16 USB-MIDI event packets (4 bytes each).
  *   Each event packet carries 3 MIDI bytes => 48 MIDI bytes per transaction.
  *
  *   MIDI bytes are a complete SysEx message (no spanning):
  *     F0 7D 'E' 'M' 'W' <42 encoded bytes> F7
  *
  *   The 42 encoded bytes use a 7-bit prefix/MSB scheme:
  *     for each group of up to 7 raw bytes:
  *       prefix byte packs the MSBs (bit j = raw[j]>>7), followed by raw bytes with MSB cleared.
  *
  *   42 encoded bytes decode to 36 raw bytes split into 2 lanes:
  *     cmd lane: 18 bytes
  *     stream lane: 18 bytes
  *
  * EMWaver modifications
  * Copyright (c) 2026 Luís Marnoto
  */
/* USER CODE END Header */

#include "usbd_midi_if.h"
#include "usbd_midi.h"

#include "main.h"
#include <string.h>

extern USBD_HandleTypeDef hUsbDeviceFS;

extern uint8_t midi_packet[18];
extern volatile uint8_t midi_packet_ready;
extern volatile EMW_Buffer_Type emw_buf_type;

static uint8_t midi_rx_buf[64];
static uint8_t midi_tx_buf[64];

#define HL_RX_BUFFER_SIZE 512
static uint8_t rxBuffer[HL_RX_BUFFER_SIZE];
static uint16_t rxBufferHeadPos = 0;
static uint16_t rxBufferTailPos = 0;

// Mini-frame sizing (decoded).
#define EMW_LANE_SIZE 18u
#define EMW_FRAME_SIZE 36u

// Fixed SysEx message sizing (encoded MIDI bytes).
#define EMW_SYSEX_BYTES 48u
#define EMW_ENCODED_BYTES 42u

// USB TX statistics for debugging.
static volatile uint32_t usb_tx_ok = 0;
static volatile uint32_t usb_tx_busy = 0;
static volatile uint32_t usb_tx_timeout = 0;
static volatile uint32_t usb_tx_fail = 0;
static volatile uint32_t usb_rx_in = 0;

static int decode_payload_7bit_fixed(const uint8_t *in, uint8_t *out);
static void encode_payload_7bit_fixed(const uint8_t *in, uint8_t *out);

static int8_t MIDI_Init_FS(void)
{
  USBD_MIDI_SetTxBuffer(&hUsbDeviceFS, midi_tx_buf, 0);
  USBD_MIDI_SetRxBuffer(&hUsbDeviceFS, midi_rx_buf);
  return (USBD_OK);
}

static int8_t MIDI_DeInit_FS(void)
{
  return (USBD_OK);
}

static int8_t MIDI_Receive_FS(uint8_t* Buf, uint32_t *Len)
{
  uint32_t len = *Len;
  usb_rx_in++;

  // Single-callback rule: one transaction must be exactly 64 bytes.
  if (len != 64u) {
    (void)USBD_MIDI_ReceivePacket(&hUsbDeviceFS);
    return (USBD_OK);
  }

  // Reconstruct the 48 MIDI bytes (ignore the USB-MIDI header byte per 4-byte event).
  uint8_t sysex[EMW_SYSEX_BYTES];
  uint32_t pos = 0;
  for (uint32_t i = 0; i < 64u; i += 4u) {
    sysex[pos++] = Buf[i + 1u];
    sysex[pos++] = Buf[i + 2u];
    sysex[pos++] = Buf[i + 3u];
  }

  // Validate fixed SysEx header/trailer.
  if (sysex[0] != 0xF0 || sysex[1] != 0x7D ||
      sysex[2] != 'E' || sysex[3] != 'M' || sysex[4] != 'W' ||
      sysex[EMW_SYSEX_BYTES - 1u] != 0xF7) {
    (void)USBD_MIDI_ReceivePacket(&hUsbDeviceFS);
    return (USBD_OK);
  }

  // Decode fixed payload.
  uint8_t decoded[EMW_FRAME_SIZE];
  const uint8_t *encoded = &sysex[5];
  if (decode_payload_7bit_fixed(encoded, decoded) != 0) {
    (void)USBD_MIDI_ReceivePacket(&hUsbDeviceFS);
    return (USBD_OK);
  }

  const uint8_t *cmd_lane = &decoded[0];
  const uint8_t *stream_lane = &decoded[EMW_LANE_SIZE];

  if (emw_buf_type == EMW_BUFFER_CIRCULAR) {
    // Append stream lane into the circular buffer.
    uint16_t tempHeadPos = rxBufferHeadPos;
    for (uint32_t i = 0; i < EMW_LANE_SIZE; i++) {
      rxBuffer[tempHeadPos] = stream_lane[i];
      tempHeadPos = (uint16_t)((uint16_t)(tempHeadPos + 1u) % HL_RX_BUFFER_SIZE);
      if (tempHeadPos == rxBufferTailPos) {
        // Drop on overflow.
        (void)USBD_MIDI_ReceivePacket(&hUsbDeviceFS);
        return (USBD_OK);
      }
    }
    rxBufferHeadPos = tempHeadPos;
    // Queue BS for main-loop TX.
    MIDI_QueueStatusPacket_FS(MIDI_GetRxBufferBytesAvailable_FS());
  }

  // Only dispatch when cmd lane is non-empty.
  uint8_t cmd_any = 0;
  for (uint32_t i = 0; i < EMW_LANE_SIZE; i++) {
    if (cmd_lane[i] != 0u) {
      cmd_any = 1;
      break;
    }
  }
  if (cmd_any && !midi_packet_ready) {
    memcpy(midi_packet, cmd_lane, EMW_LANE_SIZE);
    midi_packet_ready = 1;
  }

  (void)USBD_MIDI_ReceivePacket(&hUsbDeviceFS);
  return (USBD_OK);
}

USBD_MIDI_ItfTypeDef USBD_MIDI_Interface_fops_FS =
{
  MIDI_Init_FS,
  MIDI_DeInit_FS,
  MIDI_Receive_FS
};

static int decode_payload_7bit_fixed(const uint8_t *in, uint8_t *out)
{
  uint16_t in_pos = 0;
  uint16_t out_pos = 0;

  while (in_pos < EMW_ENCODED_BYTES && out_pos < EMW_FRAME_SIZE) {
    uint8_t prefix = in[in_pos++];
    for (uint8_t j = 0; j < 7u && out_pos < EMW_FRAME_SIZE; j++) {
      if (in_pos >= EMW_ENCODED_BYTES) {
        return -1;
      }
      uint8_t v = (uint8_t)(in[in_pos++] & 0x7Fu);
      if (prefix & (uint8_t)(1u << j)) {
        v |= 0x80u;
      }
      out[out_pos++] = v;
    }
  }

  return (out_pos == EMW_FRAME_SIZE) ? 0 : -1;
}

static void encode_payload_7bit_fixed(const uint8_t *in, uint8_t *out)
{
  uint16_t out_pos = 0;
  uint16_t in_pos = 0;

  while (in_pos < EMW_FRAME_SIZE && out_pos < EMW_ENCODED_BYTES) {
    uint8_t prefix = 0;
    uint8_t chunk[7] = {0};
    uint8_t chunk_len = 0;

    for (uint8_t j = 0; j < 7u && in_pos < EMW_FRAME_SIZE; j++) {
      uint8_t b = in[in_pos++];
      if (b & 0x80u) {
        prefix |= (uint8_t)(1u << j);
      }
      chunk[j] = (uint8_t)(b & 0x7Fu);
      chunk_len++;
    }

    out[out_pos++] = prefix;
    for (uint8_t j = 0; j < chunk_len; j++) {
      out[out_pos++] = chunk[j];
    }
  }
}

void MIDI_SetBufferType_FS(EMW_Buffer_Type buffer_type)
{
  emw_buf_type = buffer_type;
}

EMW_Buffer_Type MIDI_GetBufferType_FS(void)
{
  return emw_buf_type;
}

uint16_t MIDI_GetRxBufferBytesAvailable_FS(void)
{
  return (uint16_t)(rxBufferHeadPos - rxBufferTailPos) % HL_RX_BUFFER_SIZE;
}

uint8_t MIDI_ReadRxBuffer_FS(uint8_t* Buf, uint16_t Len)
{
  uint16_t bytesAvailable = MIDI_GetRxBufferBytesAvailable_FS();
  if (bytesAvailable < Len) {
    return EMW_USB_RX_BUFFER_NO_DATA;
  }

  for (uint16_t i = 0; i < Len; i++) {
    Buf[i] = rxBuffer[rxBufferTailPos];
    rxBufferTailPos = (uint16_t)((uint16_t)(rxBufferTailPos + 1u) % HL_RX_BUFFER_SIZE);
  }

  return EMW_USB_RX_BUFFER_OK;
}

void MIDI_FlushRxBuffer_FS(void)
{
  memset(rxBuffer, 0, HL_RX_BUFFER_SIZE);
  rxBufferHeadPos = 0;
  rxBufferTailPos = 0;
}

void MIDI_InitRxBuffer_FS(void)
{
  memset(rxBuffer, 0, HL_RX_BUFFER_SIZE);
  rxBufferHeadPos = 0;
  rxBufferTailPos = 0;
}

void MIDI_FreeRxBuffer_FS(void)
{
  // No-op: static buffer.
  rxBufferHeadPos = 0;
  rxBufferTailPos = 0;
}

extern volatile uint8_t pending_cmd_lane[EMW_LANE_SIZE];
extern volatile uint8_t pending_cmd_ready;

static volatile uint16_t pending_bs_status = 0;
static volatile uint8_t pending_bs_ready = 0;

void MIDI_QueueStatusPacket_FS(uint16_t status)
{
  pending_bs_status = status;
  pending_bs_ready = 1;
}

void MIDI_PollTx_FS(void)
{
  if (!pending_bs_ready) {
    return;
  }
  if (USBD_MIDI_IsTxBusy(&hUsbDeviceFS)) {
    return;
  }
  pending_bs_ready = 0;
  MIDI_SendStatusPacket_FS(pending_bs_status);
}

void MIDI_SendStatusPacket_FS(uint16_t status)
{
  uint8_t frame[EMW_FRAME_SIZE] = {0};
  uint8_t *stream_lane = &frame[EMW_LANE_SIZE];
  stream_lane[0] = 'B';
  stream_lane[1] = 'S';
  stream_lane[2] = (uint8_t)(status >> 8);
  stream_lane[3] = (uint8_t)(status & 0xFFu);

  if (pending_cmd_ready) {
    memcpy(&frame[0], (const void *)pending_cmd_lane, EMW_LANE_SIZE);
    pending_cmd_ready = 0;
  }

  (void)MIDI_SendResponsePkt_FS(frame, (uint16_t)sizeof(frame), 100);
}

void MIDI_Print_FS(const char* str)
{
  if (str == NULL) {
    return;
  }

  uint8_t frame[EMW_FRAME_SIZE] = {0};
  uint8_t *cmd_lane = &frame[0];
  size_t len = strlen(str);
  size_t offset = 0;
  while (offset < len) {
    memset(frame, 0, sizeof(frame));
    size_t chunk = len - offset;
    if (chunk > EMW_LANE_SIZE) {
      chunk = EMW_LANE_SIZE;
    }
    memcpy(cmd_lane, str + offset, chunk);
    (void)MIDI_SendResponsePkt_FS(frame, (uint16_t)sizeof(frame), 100);
    offset += chunk;
  }
}

uint8_t MIDI_SendResponsePkt_FS(uint8_t* packet, uint16_t length, uint32_t timeout)
{
  if (length != EMW_FRAME_SIZE || packet == NULL) {
    usb_tx_fail++;
    return (uint8_t)-1;
  }

  uint8_t encoded[EMW_ENCODED_BYTES];
  encode_payload_7bit_fixed(packet, encoded);

  uint8_t sysex[EMW_SYSEX_BYTES];
  sysex[0] = 0xF0;
  sysex[1] = 0x7D;
  sysex[2] = 'E';
  sysex[3] = 'M';
  sysex[4] = 'W';
  memcpy(&sysex[5], encoded, EMW_ENCODED_BYTES);
  sysex[EMW_SYSEX_BYTES - 1u] = 0xF7;

  // Pack 48 bytes into 16 USB-MIDI event packets (4 bytes each) => exactly 64 USB bytes.
  for (uint32_t i = 0; i < 16u; i++) {
    uint8_t cin = (i == 15u) ? 0x7u : 0x4u;
    midi_tx_buf[i * 4u + 0u] = (uint8_t)(cin & 0x0Fu);
    midi_tx_buf[i * 4u + 1u] = sysex[i * 3u + 0u];
    midi_tx_buf[i * 4u + 2u] = sysex[i * 3u + 1u];
    midi_tx_buf[i * 4u + 3u] = sysex[i * 3u + 2u];
  }

  uint32_t start = HAL_GetTick();
  while (USBD_MIDI_IsTxBusy(&hUsbDeviceFS)) {
    usb_tx_busy++;
    if ((HAL_GetTick() - start) >= timeout) {
      usb_tx_timeout++;
      return (uint8_t)-1;
    }
  }

  USBD_MIDI_SetTxBuffer(&hUsbDeviceFS, midi_tx_buf, (uint16_t)sizeof(midi_tx_buf));
  uint8_t res = USBD_MIDI_TransmitPacket(&hUsbDeviceFS);
  if (res != USBD_OK) {
    usb_tx_fail++;
    return (uint8_t)-1;
  }

  while (USBD_MIDI_IsTxBusy(&hUsbDeviceFS)) {
    if ((HAL_GetTick() - start) >= timeout) {
      usb_tx_timeout++;
      return (uint8_t)-1;
    }
  }

  usb_tx_ok++;
  return 0;
}

void MIDI_GetUsbStats_FS(uint32_t *tx_ok, uint32_t *tx_busy, uint32_t *tx_timeout, uint32_t *tx_fail, uint32_t *rx_in)
{
  if (tx_ok) *tx_ok = usb_tx_ok;
  if (tx_busy) *tx_busy = usb_tx_busy;
  if (tx_timeout) *tx_timeout = usb_tx_timeout;
  if (tx_fail) *tx_fail = usb_tx_fail;
  if (rx_in) *rx_in = usb_rx_in;
}
