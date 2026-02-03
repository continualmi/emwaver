/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Shared buffer core (Rust) for Windows.
//
// This is a pure logic library:
// - Transport (USB MIDI SysEx) remains native to Windows.
// - UI remains native (WinUI 3).
// - Framing/buffering/status/compression/tx pacing policy live here.
//
// Note: The protocol uses fixed-size lanes (18-byte packets) inside the
// 64-byte USB framing model.

// --- Global state (platform parity) ---

void emw_buffer_clear_all(void);
size_t emw_buffer_rx_len_bytes(void);
uint64_t emw_buffer_rx_packet_count(void);
uint64_t emw_buffer_tx_packet_count(void);

uint64_t emw_buffer_get_rx_counter(void);
void emw_buffer_set_rx_counter(uint64_t value);
// emw_buffer_set_invert_rx removed (legacy).

// --- RX/TX logging ---

// Replaces RX bytes and resets rx_counter; timestamps are reset to 0 per packet.
void emw_buffer_load_rx_bytes(const uint8_t *data, size_t len);

// Returns a newly allocated snapshot of RX bytes. Caller must free via emw_free_u8.
void emw_buffer_get_rx_snapshot(uint8_t **out_ptr, size_t *out_len);

// Append raw incoming bytes; timestamps are assigned per completed 18B packet.
void emw_buffer_store_bulk_pkt(const uint8_t *data, size_t len, uint64_t ts_ms);

// Append outbound bytes to TX log as padded 18B packets (one ts_ms per 18B packet).
void emw_buffer_append_tx_bytes(const uint8_t *data, size_t len, uint64_t ts_ms);

// Read packet slices (18B packets + timestamps). Allocates output arrays; caller frees.
void emw_buffer_read_rx_since(
    uint64_t packet_index,
    size_t max_packets,
    uint8_t **out_data_ptr,
    size_t *out_data_len,
    uint64_t **out_ts_ptr,
    size_t *out_ts_len,
    uint64_t *out_next_packet_index,
    uint64_t *out_available_packets);

void emw_buffer_read_tx_since(
    uint64_t packet_index,
    size_t max_packets,
    uint8_t **out_data_ptr,
    size_t *out_data_len,
    uint64_t **out_ts_ptr,
    size_t *out_ts_len,
    uint64_t *out_next_packet_index,
    uint64_t *out_available_packets);

// Cursor-consuming response API: writes an 18B packet into out_packet64 when available.
bool emw_buffer_next_rx_packet(uint8_t *out_packet64, size_t out_packet64_len, uint64_t *out_ts_ms);

// --- Protocol helpers ---

// Writes an 18B padded packet into out_packet64; returns false when len > 18.
bool emw_packet_make_packet64(const uint8_t *data, size_t len, uint8_t *out_packet64, size_t out_packet64_len);

// Returns -1 when the packet is not a BS frame; otherwise returns 0..65535.
int32_t emw_status_parse_bs(const uint8_t *packet64, size_t len);

// --- Sampler compression (min/max bins) ---

// Compresses the current RX buffer bits for chart display.
// Allocates output arrays; caller frees via emw_free_f32.
void emw_buffer_compress_data_bits(
    int32_t range_start,
    int32_t range_end,
    int32_t number_bins,
    float **out_time_ptr,
    size_t *out_time_len,
    float **out_data_ptr,
    size_t *out_data_len);

// --- Transmit pacing policy helpers (pure logic; transport does I/O) ---

typedef struct {
    int32_t max_packet_size;
    int32_t min_packet_size;
    int32_t initial_packet_size;
    int32_t fixed_delay_ms;
    int32_t target_buffer_level;
    int32_t buffer_high_threshold;
    int32_t buffer_low_threshold;
    int32_t initial_fill_bytes;
    int32_t nudge_band;
    int32_t step_large;
    int32_t step_small;
} EmwTxProfile;

EmwTxProfile emw_tx_profile_default(void);
int32_t emw_tx_next_packet_size(int32_t bytes_sent, int32_t last_status, int32_t current_packet_size);

// --- Internal RX swap (avoid contaminating sampler capture with BS packets during TX) ---

void emw_buffer_take_rx_state(
    uint8_t **out_rx_bytes_ptr,
    size_t *out_rx_bytes_len,
    uint64_t **out_rx_ts_ptr,
    size_t *out_rx_ts_len,
    uint64_t *out_rx_counter);

void emw_buffer_restore_rx_state(
    const uint8_t *rx_bytes,
    size_t rx_bytes_len,
    const uint64_t *rx_ts_ms,
    size_t rx_ts_len,
    uint64_t rx_counter);

// --- Allocation helpers ---

void emw_free_u8(uint8_t *ptr, size_t len);
void emw_free_u64(uint64_t *ptr, size_t len);
void emw_free_f32(float *ptr, size_t len);

#ifdef __cplusplus
} // extern "C"
#endif
