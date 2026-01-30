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

#[cfg(feature = "serde")]
use serde::Serialize;

use crate::packet::PACKET_SIZE;

#[derive(Default)]
pub struct Buffer {
    pub rx_bytes: Vec<u8>,
    pub rx_counter: u64,
    pub rx_ts_ms: Vec<u64>,
    pub tx_bytes: Vec<u8>,
    pub tx_ts_ms: Vec<u64>,
    pub invert_rx: bool,
}

#[cfg_attr(feature = "serde", derive(Serialize))]
#[derive(Clone)]
pub struct ReadPackets {
    pub data: Vec<u8>,
    pub ts_ms: Vec<u64>,
    pub next_packet_index: u64,
    pub available_packets: u64,
}

pub fn clear(buffer: &mut Buffer) {
    buffer.rx_bytes.clear();
    buffer.rx_counter = 0;
    buffer.rx_ts_ms.clear();
    buffer.tx_bytes.clear();
    buffer.tx_ts_ms.clear();
    buffer.invert_rx = false;
}

pub fn rx_len_bytes(buffer: &Buffer) -> usize {
    buffer.rx_bytes.len()
}

pub fn rx_snapshot(buffer: &Buffer) -> Vec<u8> {
    buffer.rx_bytes.clone()
}

pub fn rx_set_bytes(buffer: &mut Buffer, data: Vec<u8>) {
    buffer.rx_bytes = data;
    buffer.rx_counter = 0;
    buffer.rx_ts_ms = vec![0u64; rx_packet_count(buffer) as usize];
    buffer.invert_rx = false;
}

pub fn rx_copy_byte_range(buffer: &Buffer, byte_start: usize, byte_end: usize) -> Vec<u8> {
    if byte_start >= byte_end || byte_start >= buffer.rx_bytes.len() {
        return Vec::new();
    }
    let end = byte_end.min(buffer.rx_bytes.len());
    buffer
        .rx_bytes
        .get(byte_start..end)
        .unwrap_or_default()
        .to_vec()
}

pub fn rx_packet_count(buffer: &Buffer) -> u64 {
    (buffer.rx_bytes.len() / PACKET_SIZE) as u64
}

pub fn tx_packet_count(buffer: &Buffer) -> u64 {
    buffer.tx_ts_ms.len() as u64
}

pub fn append_rx_bytes(buffer: &mut Buffer, data: &[u8], ts_ms: u64) {
    if data.is_empty() {
        return;
    }

    let prev_packets = (buffer.rx_bytes.len() / PACKET_SIZE) as u64;
    if buffer.invert_rx {
        buffer
            .rx_bytes
            .extend(data.iter().copied().map(|b| b ^ 0xFF));
    } else {
        buffer.rx_bytes.extend_from_slice(data);
    }
    let new_packets = (buffer.rx_bytes.len() / PACKET_SIZE) as u64;
    let delta = new_packets.saturating_sub(prev_packets);
    if delta > 0 {
        buffer
            .rx_ts_ms
            .extend(std::iter::repeat_n(ts_ms, delta as usize));
    }
}

pub fn set_invert_rx(buffer: &mut Buffer, enabled: bool) {
    buffer.invert_rx = enabled;
}

pub fn append_rx_packet(buffer: &mut Buffer, packet: &[u8; PACKET_SIZE], ts_ms: u64) {
    append_rx_bytes(buffer, packet, ts_ms);
}

pub fn append_tx_packet(buffer: &mut Buffer, packet: &[u8; PACKET_SIZE], ts_ms: u64) {
    buffer.tx_bytes.extend_from_slice(packet);
    buffer.tx_ts_ms.push(ts_ms);
}

pub fn read_tx_since(buffer: &Buffer, packet_index: u64, max_packets: usize) -> ReadPackets {
    let available_packets = tx_packet_count(buffer);
    if available_packets == 0 || max_packets == 0 || packet_index >= available_packets {
        return ReadPackets {
            data: Vec::new(),
            ts_ms: Vec::new(),
            next_packet_index: packet_index.min(available_packets),
            available_packets,
        };
    }

    let take_packets = (available_packets - packet_index) as usize;
    let take_packets = take_packets.min(max_packets);

    let start = packet_index as usize * PACKET_SIZE;
    let end = start + take_packets * PACKET_SIZE;
    let data = buffer.tx_bytes.get(start..end).unwrap_or_default().to_vec();

    let ts_start = packet_index as usize;
    let ts_end = ts_start + take_packets;
    let ts_ms = buffer
        .tx_ts_ms
        .get(ts_start..ts_end)
        .unwrap_or_default()
        .to_vec();

    ReadPackets {
        data,
        ts_ms,
        next_packet_index: packet_index + take_packets as u64,
        available_packets,
    }
}

pub fn read_rx_since(buffer: &Buffer, packet_index: u64, max_packets: usize) -> ReadPackets {
    let available_packets = rx_packet_count(buffer);
    if available_packets == 0 || max_packets == 0 || packet_index >= available_packets {
        return ReadPackets {
            data: Vec::new(),
            ts_ms: Vec::new(),
            next_packet_index: packet_index.min(available_packets),
            available_packets,
        };
    }

    let take_packets = (available_packets - packet_index) as usize;
    let take_packets = take_packets.min(max_packets);

    let start = packet_index as usize * PACKET_SIZE;
    let end = start + take_packets * PACKET_SIZE;
    let slice = buffer.rx_bytes.get(start..end).unwrap_or_default();

    let ts_start = packet_index as usize;
    let ts_end = ts_start + take_packets;
    let ts_ms = buffer
        .rx_ts_ms
        .get(ts_start..ts_end)
        .unwrap_or_default()
        .to_vec();

    ReadPackets {
        data: slice.to_vec(),
        ts_ms,
        next_packet_index: packet_index + take_packets as u64,
        available_packets,
    }
}

#[cfg_attr(feature = "serde", derive(Serialize))]
#[derive(Clone)]
pub struct Packet {
    pub data: Vec<u8>,
    pub ts_ms: u64,
}

pub fn next_rx_packet(buffer: &mut Buffer) -> Option<Packet> {
    let packet_index = buffer.rx_counter;
    let response = read_rx_since(buffer, packet_index, 1);
    if response.data.len() != PACKET_SIZE || response.ts_ms.len() != 1 {
        return None;
    }

    buffer.rx_counter = buffer.rx_counter.saturating_add(1);
    Some(Packet {
        data: response.data,
        ts_ms: response.ts_ms[0],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_rx_bytes_adds_ts_per_completed_packet() {
        let mut buf = Buffer::default();

        append_rx_bytes(&mut buf, &[0u8; 10], 111);
        assert_eq!(rx_packet_count(&buf), 0);
        assert_eq!(buf.rx_ts_ms.len(), 0);

        append_rx_bytes(&mut buf, &[0u8; 8], 222);
        assert_eq!(rx_packet_count(&buf), 1);
        assert_eq!(buf.rx_ts_ms, vec![222]);

        append_rx_bytes(&mut buf, &[0u8; 18], 333);
        assert_eq!(rx_packet_count(&buf), 2);
        assert_eq!(buf.rx_ts_ms, vec![222, 333]);
    }

    #[test]
    fn append_rx_bytes_inverts_when_enabled() {
        let mut buf = Buffer::default();
        set_invert_rx(&mut buf, true);
        append_rx_bytes(&mut buf, &[0x00, 0x0F, 0xFF], 1);
        assert_eq!(buf.rx_bytes, vec![0xFF, 0xF0, 0x00]);
    }
}
