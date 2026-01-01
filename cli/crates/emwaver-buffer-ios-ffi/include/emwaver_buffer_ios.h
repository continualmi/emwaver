/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Shared buffer core (Rust) for iOS. This is a pure logic library:
// CoreBluetooth/USB transport and UI remain native; framing/buffering/status/compression live here.

// --- Global state (desktop/Android parity) ---

void emw_buffer_clear_all(void);
size_t emw_buffer_rx_len_bytes(void);
uint64_t emw_buffer_rx_packet_count(void);
uint64_t emw_buffer_tx_packet_count(void);

uint64_t emw_buffer_get_rx_counter(void);
void emw_buffer_set_rx_counter(uint64_t value);
void emw_buffer_set_invert_rx(bool enabled);

// --- RX/TX logging ---

// Replaces RX bytes and resets rx_counter; timestamps are reset to 0 per packet.
void emw_buffer_load_rx_bytes(const uint8_t *data, size_t len);

// Returns a newly allocated snapshot of RX bytes. Caller must free via emw_free_u8.
void emw_buffer_get_rx_snapshot(uint8_t **out_ptr, size_t *out_len);

// Append raw incoming bytes; timestamps are assigned per completed 64B packet.
void emw_buffer_store_bulk_pkt(const uint8_t *data, size_t len, uint64_t ts_ms);

// Append outbound bytes to TX log as padded 64B packets (one ts_ms per 64B packet).
void emw_buffer_append_tx_bytes(const uint8_t *data, size_t len, uint64_t ts_ms);

// Read packet slices (64B packets + timestamps). Allocates output arrays; caller frees.
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

// Cursor-consuming response API: writes a 64B packet into out_packet64 when available.
bool emw_buffer_next_rx_packet(uint8_t *out_packet64, size_t out_packet64_len, uint64_t *out_ts_ms);

// --- Protocol helpers ---

// Writes a 64B padded packet into out_packet64; returns false when len > 64.
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
} EmwBleTxProfile;

EmwBleTxProfile emw_tx_ble_profile_default(void);
int32_t emw_tx_ble_next_packet_size(int32_t bytes_sent, int32_t last_status, int32_t current_packet_size);

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
