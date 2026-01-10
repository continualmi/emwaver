/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : usbd_midi_if.c
  * @brief          : USB Device MIDI interface for EMWaver.
  ******************************************************************************
  *
  * Implements a small SysEx tunnel:
  *   F0 7D 'E' 'M' 'W' 01 <encoded 64B payload> F7
  *
  * Payload encoding is MIDI-safe (7-bit) using a prefix/MSB scheme:
  *   for each group of up to 7 bytes:
  *     prefix byte packs the MSBs (bit j = byte[j]>>7), followed by 7 bytes with MSB cleared.
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

extern uint8_t midi_packet[64];
extern volatile uint8_t midi_packet_ready;
extern volatile EMW_Buffer_Type emw_buf_type;

static uint8_t midi_rx_buf[64];
static uint8_t midi_tx_buf[256];

#define HL_RX_BUFFER_SIZE 512
static uint8_t rxBuffer[HL_RX_BUFFER_SIZE];
static uint16_t rxBufferHeadPos = 0;
static uint16_t rxBufferTailPos = 0;

static uint8_t sysex_buf[256];
static uint16_t sysex_len = 0;
static uint8_t in_sysex = 0;

// EMWaver multiplexed superframe: 2 lanes of 64 bytes.
#define EMW_LANE_SIZE 64u
#define EMW_SUPERFRAME_SIZE 128u
#define EMW_CMD_MARKER 0xA5u

// USB TX statistics for debugging.
static volatile uint32_t usb_tx_ok = 0;
static volatile uint32_t usb_tx_busy = 0;
static volatile uint32_t usb_tx_timeout = 0;
static volatile uint32_t usb_tx_fail = 0;
static volatile uint32_t usb_rx_in = 0;

static void sysex_reset(void)
{
  sysex_len = 0;
  in_sysex = 0;
}

static void sysex_feed_byte(uint8_t b);
static int decode_payload_7bit(const uint8_t *in, uint16_t in_len, uint8_t out[EMW_SUPERFRAME_SIZE]);
static uint16_t encode_payload_7bit(const uint8_t in[EMW_SUPERFRAME_SIZE], uint8_t *out, uint16_t out_max);
static uint16_t pack_sysex_to_usb_events(const uint8_t *sysex, uint16_t sysex_len, uint8_t *out, uint16_t out_max);

static int8_t MIDI_Init_FS(void)
{
  USBD_MIDI_SetTxBuffer(&hUsbDeviceFS, midi_tx_buf, 0);
  USBD_MIDI_SetRxBuffer(&hUsbDeviceFS, midi_rx_buf);
  sysex_reset();
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
  // USB-MIDI event packets are 4 bytes. Parse and feed MIDI bytes.
  for (uint32_t i = 0; i + 3 < len; i += 4) {
    uint8_t cin = (uint8_t)(Buf[i] & 0x0F);

    uint8_t b0 = Buf[i + 1];
    uint8_t b1 = Buf[i + 2];
    uint8_t b2 = Buf[i + 3];

    switch (cin) {
      case 0x4: // SysEx starts/continues, 3 bytes
        sysex_feed_byte(b0);
        sysex_feed_byte(b1);
        sysex_feed_byte(b2);
        break;
      case 0x5: // SysEx ends with 1 byte
        sysex_feed_byte(b0);
        break;
      case 0x6: // SysEx ends with 2 bytes
        sysex_feed_byte(b0);
        sysex_feed_byte(b1);
        break;
      case 0x7: // SysEx ends with 3 bytes
        sysex_feed_byte(b0);
        sysex_feed_byte(b1);
        sysex_feed_byte(b2);
        break;
      default:
        // Ignore other message types for now.
        break;
    }
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

static void handle_complete_sysex(void)
{
  // Minimum header: F0 7D 'E' 'M' 'W' 01 ... F7
  if (sysex_len < 8) {
    sysex_reset();
    return;
  }
  if (sysex_buf[0] != 0xF0 || sysex_buf[1] != 0x7D ||
      sysex_buf[2] != 'E' || sysex_buf[3] != 'M' || sysex_buf[4] != 'W' ||
      sysex_buf[5] != 0x01 || sysex_buf[sysex_len - 1] != 0xF7) {
    sysex_reset();
    return;
  }

  // Extract encoded payload (everything after version up to before F7).
  const uint8_t *encoded = &sysex_buf[6];
  uint16_t encoded_len = (uint16_t)(sysex_len - 7);

  uint8_t decoded[EMW_SUPERFRAME_SIZE];
  if (decode_payload_7bit(encoded, encoded_len, decoded) != 0) {
    sysex_reset();
    return;
  }

  const uint8_t *cmd_lane = &decoded[0];
  const uint8_t *stream_lane = &decoded[EMW_LANE_SIZE];

  if (emw_buf_type == EMW_BUFFER_CIRCULAR) {
    // Mirror the previous circular RX buffer behavior for retransmission flow-control.
    uint16_t tempHeadPos = rxBufferHeadPos;
    for (uint32_t i = 0; i < EMW_LANE_SIZE; i++) {
      rxBuffer[tempHeadPos] = stream_lane[i];
      tempHeadPos = (uint16_t)((uint16_t)(tempHeadPos + 1) % HL_RX_BUFFER_SIZE);
      if (tempHeadPos == rxBufferTailPos) {
        sysex_reset();
        return;
      }
    }
    rxBufferHeadPos = tempHeadPos;
    // Don't send from within the USB RX path; queue BS and flush from main.
    MIDI_QueueStatusPacket_FS(MIDI_GetRxBufferBytesAvailable_FS());
  }

  // Always accept the cmd lane too (needed for commands during retransmit).
  // Avoid allocating for the common case where cmd_lane is all zeros.
  uint8_t cmd_any = 0;
  for (uint32_t i = 0; i < EMW_LANE_SIZE; i++) {
    if (cmd_lane[i] != 0) {
      cmd_any = 1;
      break;
    }
  }

  if (cmd_any) {
    if (!midi_packet_ready) {
      memcpy(midi_packet, cmd_lane, EMW_LANE_SIZE);
      midi_packet_ready = 1;
    }
  }

  sysex_reset();
}

static void sysex_feed_byte(uint8_t b)
{
  if (b == 0xF0) {
    sysex_len = 0;
    in_sysex = 1;
  }

  if (!in_sysex) {
    return;
  }

  if (sysex_len < sizeof(sysex_buf)) {
    sysex_buf[sysex_len++] = b;
  } else {
    // Overflow: reset.
    sysex_reset();
    return;
  }

  if (b == 0xF7) {
    handle_complete_sysex();
  }
}

static int decode_payload_7bit(const uint8_t *in, uint16_t in_len, uint8_t out[EMW_SUPERFRAME_SIZE])
{
  uint16_t in_pos = 0;
  uint16_t out_pos = 0;

  while (in_pos < in_len && out_pos < EMW_SUPERFRAME_SIZE) {
    uint8_t prefix = in[in_pos++];
    for (uint8_t j = 0; j < 7 && out_pos < EMW_SUPERFRAME_SIZE; j++) {
      if (in_pos >= in_len) {
        return -1;
      }
      uint8_t v = in[in_pos++] & 0x7F;
      if (prefix & (1u << j)) {
        v |= 0x80;
      }
      out[out_pos++] = v;
    }
  }

  return (out_pos == EMW_SUPERFRAME_SIZE) ? 0 : -1;
}

static uint16_t encode_payload_7bit(const uint8_t in[EMW_SUPERFRAME_SIZE], uint8_t *out, uint16_t out_max)
{
  uint16_t out_pos = 0;
  uint16_t in_pos = 0;

  while (in_pos < EMW_SUPERFRAME_SIZE) {
    uint8_t prefix = 0;
    uint8_t chunk[7] = {0};
    uint8_t chunk_len = 0;

    for (uint8_t j = 0; j < 7 && in_pos < EMW_SUPERFRAME_SIZE; j++) {
      uint8_t b = in[in_pos++];
      if (b & 0x80) {
        prefix |= (uint8_t)(1u << j);
      }
      chunk[j] = (uint8_t)(b & 0x7F);
      chunk_len++;
    }

    if ((uint16_t)(out_pos + 1 + chunk_len) > out_max) {
      return 0;
    }
    out[out_pos++] = prefix;
    for (uint8_t j = 0; j < chunk_len; j++) {
      out[out_pos++] = chunk[j];
    }
  }

  return out_pos;
}

static uint16_t pack_sysex_to_usb_events(const uint8_t *sysex, uint16_t sysex_len_in, uint8_t *out, uint16_t out_max)
{
  uint16_t in_pos = 0;
  uint16_t out_pos = 0;

  while (in_pos < sysex_len_in) {
    uint16_t remaining = (uint16_t)(sysex_len_in - in_pos);
    uint8_t cin = 0x4; // SysEx starts/continues

    uint8_t b0 = sysex[in_pos];
    uint8_t b1 = (remaining > 1) ? sysex[in_pos + 1] : 0;
    uint8_t b2 = (remaining > 2) ? sysex[in_pos + 2] : 0;

    if (remaining == 1) {
      cin = 0x5;
    } else if (remaining == 2) {
      cin = 0x6;
    } else if (remaining == 3) {
      if (b0 == 0xF7) cin = 0x5;
      else if (b1 == 0xF7) cin = 0x6;
      else if (b2 == 0xF7) cin = 0x7;
      else cin = 0x4;
    }

    if ((uint16_t)(out_pos + 4) > out_max) {
      return 0;
    }
    out[out_pos++] = (uint8_t)(0x00 | (cin & 0x0F)); // cable=0
    out[out_pos++] = b0;
    out[out_pos++] = b1;
    out[out_pos++] = b2;

    if (remaining >= 3) in_pos += 3;
    else in_pos = sysex_len_in;
  }

  return out_pos;
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
    rxBufferTailPos = (uint16_t)((uint16_t)(rxBufferTailPos + 1) % HL_RX_BUFFER_SIZE);
  }

  return EMW_USB_RX_BUFFER_OK;
}

void MIDI_FlushRxBuffer_FS(void)
{
  for (int i = 0; i < HL_RX_BUFFER_SIZE; i++) {
    rxBuffer[i] = 0;
  }
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
  // Only attempt when USB isn't busy; otherwise wait until the next poll.
  if (USBD_MIDI_IsTxBusy(&hUsbDeviceFS)) {
    return;
  }
  pending_bs_ready = 0;
  MIDI_SendStatusPacket_FS(pending_bs_status);
}

void MIDI_SendStatusPacket_FS(uint16_t status)
{
  uint8_t superframe[EMW_SUPERFRAME_SIZE] = {0};
  uint8_t *stream_lane = &superframe[EMW_LANE_SIZE];
  stream_lane[0] = 'B';
  stream_lane[1] = 'S';
  stream_lane[2] = (uint8_t)(status >> 8);
  stream_lane[3] = (uint8_t)(status & 0xFF);

  if (pending_cmd_ready) {
    memcpy(&superframe[0], (const void *)pending_cmd_lane, EMW_LANE_SIZE);
    pending_cmd_ready = 0;
  }

  (void)MIDI_SendResponsePkt_FS(superframe, EMW_SUPERFRAME_SIZE, 100);
}

void MIDI_Print_FS(const char* str)
{
  if (str == NULL) return;
  // Best-effort: print as packets with '\0' termination.
  uint8_t superframe[EMW_SUPERFRAME_SIZE] = {0};
  uint8_t *cmd_lane = &superframe[0];
  size_t len = strlen(str);
  size_t offset = 0;
  while (offset < len) {
    memset(superframe, 0, sizeof(superframe));
    size_t chunk = len - offset;
    if (chunk > (EMW_LANE_SIZE - 1u)) chunk = EMW_LANE_SIZE - 1u;
    memcpy(cmd_lane, str + offset, chunk);
    // Mark as a command/response payload (used to distinguish from empty lane).
    cmd_lane[EMW_LANE_SIZE - 1u] = EMW_CMD_MARKER;
    (void)MIDI_SendResponsePkt_FS(superframe, EMW_SUPERFRAME_SIZE, 100);
    offset += chunk;
  }
}

uint8_t MIDI_SendResponsePkt_FS(uint8_t* packet, uint16_t length, uint32_t timeout)
{
  if (length != EMW_SUPERFRAME_SIZE || packet == NULL) {
    usb_tx_fail++;
    return (uint8_t)-1;
  }

  uint8_t encoded[192];
  uint16_t encoded_len = encode_payload_7bit(packet, encoded, sizeof(encoded));
  if (encoded_len == 0) {
    usb_tx_fail++;
    return (uint8_t)-1;
  }

  uint8_t sysex[256];
  uint16_t sysex_pos = 0;
  sysex[sysex_pos++] = 0xF0;
  sysex[sysex_pos++] = 0x7D;
  sysex[sysex_pos++] = 'E';
  sysex[sysex_pos++] = 'M';
  sysex[sysex_pos++] = 'W';
  sysex[sysex_pos++] = 0x01;
  if ((uint16_t)(sysex_pos + encoded_len + 1) > sizeof(sysex)) {
    usb_tx_fail++;
    return (uint8_t)-1;
  }
  memcpy(&sysex[sysex_pos], encoded, encoded_len);
  sysex_pos += encoded_len;
  sysex[sysex_pos++] = 0xF7;

  uint16_t usb_len = pack_sysex_to_usb_events(sysex, sysex_pos, midi_tx_buf, sizeof(midi_tx_buf));
  if (usb_len == 0) {
    usb_tx_fail++;
    return (uint8_t)-1;
  }

  uint32_t start = HAL_GetTick();

  // Phase 1: Wait for any previous TX to complete (TxState cleared by DataIn callback).
  while (USBD_MIDI_IsTxBusy(&hUsbDeviceFS)) {
    usb_tx_busy++;
    if ((HAL_GetTick() - start) >= timeout) {
      usb_tx_timeout++;
      return (uint8_t)-1;
    }
  }

  // Phase 2: Queue the new transmission.
  USBD_MIDI_SetTxBuffer(&hUsbDeviceFS, midi_tx_buf, usb_len);
  uint8_t res = USBD_MIDI_TransmitPacket(&hUsbDeviceFS);
  if (res != USBD_OK) {
    usb_tx_fail++;
    return (uint8_t)-1;
  }

  // Phase 3: Wait for this TX to complete. This ensures the data actually left the device
  // before we return, preventing the next command from overwriting the buffer.
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
