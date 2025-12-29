use serde::Serialize;

pub const PACKET_SIZE: usize = 64;
const TS_SIZE: usize = 8;
const TX_ENTRY_SIZE: usize = TS_SIZE + PACKET_SIZE;

// Minimal model (still tuple-based, no state struct):
// - `buffer.0` => RX bytes (append-only, notification boundaries are not preserved)
// - `buffer.1` => RX buffer_counter (how many 64B packets have been consumed)
// - `buffer.2` => TX log entries (each entry: 8B ts_ms + 64B packet)
pub type Buffer = (Vec<u8>, u64, Vec<u8>);

#[derive(Clone, Serialize)]
pub struct ReadPackets {
    pub data: Vec<u8>,
    pub ts_ms: Vec<u64>,
    pub next_packet_index: u64,
    pub available_packets: u64,
}

pub fn clear(buffer: &mut Buffer) {
    buffer.0.clear();
    buffer.1 = 0;
    buffer.2.clear();
}

pub fn rx_len_bytes(buffer: &Buffer) -> usize {
    buffer.0.len()
}

pub fn rx_snapshot(buffer: &Buffer) -> Vec<u8> {
    buffer.0.clone()
}

pub fn rx_set_bytes(buffer: &mut Buffer, data: Vec<u8>) {
    buffer.0 = data;
    buffer.1 = 0;
}

pub fn rx_copy_byte_range(buffer: &Buffer, byte_start: usize, byte_end: usize) -> Vec<u8> {
    if byte_start >= byte_end || byte_start >= buffer.0.len() {
        return Vec::new();
    }
    let end = byte_end.min(buffer.0.len());
    buffer.0.get(byte_start..end).unwrap_or_default().to_vec()
}

pub fn rx_packet_count(buffer: &Buffer) -> u64 {
    (buffer.0.len() / PACKET_SIZE) as u64
}

pub fn tx_packet_count(buffer: &Buffer) -> u64 {
    (buffer.2.len() / TX_ENTRY_SIZE) as u64
}

pub fn append_rx_bytes(buffer: &mut Buffer, data: &[u8]) {
    if data.is_empty() {
        return;
    }
    buffer.0.extend_from_slice(data);
}

fn push_tx_entry(out: &mut Vec<u8>, packet: &[u8; PACKET_SIZE], ts_ms: u64) {
    out.extend_from_slice(&ts_ms.to_le_bytes());
    out.extend_from_slice(packet);
}

pub fn append_rx_packet(buffer: &mut Buffer, packet: &[u8; PACKET_SIZE], ts_ms: u64) {
    let _ = ts_ms;
    append_rx_bytes(buffer, packet);
}

pub fn append_tx_packet(buffer: &mut Buffer, packet: &[u8; PACKET_SIZE], ts_ms: u64) {
    push_tx_entry(&mut buffer.2, packet, ts_ms);
}

fn read_tx_entries(src: &[u8], packet_index: u64, max_packets: usize) -> ReadPackets {
    let available_packets = (src.len() / TX_ENTRY_SIZE) as u64;
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

    let start = packet_index as usize * TX_ENTRY_SIZE;
    let end = start + take_packets * TX_ENTRY_SIZE;
    let slice = src.get(start..end).unwrap_or_default();

    let mut data = Vec::with_capacity(take_packets * PACKET_SIZE);
    let mut ts_ms = Vec::with_capacity(take_packets);
    for i in 0..take_packets {
        let base = i * TX_ENTRY_SIZE;
        let ts_bytes: [u8; 8] = slice
            .get(base..base + TS_SIZE)
            .unwrap_or_default()
            .try_into()
            .unwrap_or([0u8; 8]);
        ts_ms.push(u64::from_le_bytes(ts_bytes));
        data.extend_from_slice(
            slice
                .get(base + TS_SIZE..base + TS_SIZE + PACKET_SIZE)
                .unwrap_or_default(),
        );
    }

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
    let slice = buffer.0.get(start..end).unwrap_or_default();

    ReadPackets {
        data: slice.to_vec(),
        ts_ms: vec![0u64; take_packets],
        next_packet_index: packet_index + take_packets as u64,
        available_packets,
    }
}

pub fn read_tx_since(buffer: &Buffer, packet_index: u64, max_packets: usize) -> ReadPackets {
    read_tx_entries(&buffer.2, packet_index, max_packets)
}

#[derive(Clone, Serialize)]
pub struct Packet {
    pub data: Vec<u8>,
    pub ts_ms: u64,
}

pub fn next_rx_packet(buffer: &mut Buffer) -> Option<Packet> {
    let packet_index = buffer.1;
    let response = read_rx_since(buffer, packet_index, 1);
    if response.data.len() != PACKET_SIZE || response.ts_ms.len() != 1 {
        return None;
    }

    buffer.1 = buffer.1.saturating_add(1);
    Some(Packet {
        data: response.data,
        ts_ms: response.ts_ms[0],
    })
}
