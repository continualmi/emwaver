use serde::Serialize;

pub const PACKET_SIZE: usize = 64;

// Minimal model: exactly two things.
// - `buffer.0` => RX byte buffer (append-only)
// - `buffer.1` => RX buffer_counter (how many 64B packets have been consumed)
pub type Buffer = (Vec<u8>, u64);

#[derive(Clone, Serialize)]
pub struct ReadPackets {
    pub data: Vec<u8>,
    pub next_packet_index: u64,
    pub available_packets: u64,
    pub buffer_counter: u64,
}

pub fn clear(buffer: &mut Buffer) {
    buffer.0.clear();
    buffer.1 = 0;
}

pub fn append(buffer: &mut Buffer, data: &[u8]) {
    if data.is_empty() {
        return;
    }
    buffer.0.extend_from_slice(data);
}

pub fn packet_count(buffer: &Buffer) -> u64 {
    (buffer.0.len() / PACKET_SIZE) as u64
}

pub fn read_since(buffer: &Buffer, packet_index: u64, max_packets: usize) -> ReadPackets {
    let available_packets = packet_count(buffer);
    if available_packets == 0 || max_packets == 0 || packet_index >= available_packets {
        return ReadPackets {
            data: Vec::new(),
            next_packet_index: packet_index.min(available_packets),
            available_packets,
            buffer_counter: buffer.1,
        };
    }

    let take_packets = (available_packets - packet_index) as usize;
    let take_packets = take_packets.min(max_packets);
    let start = packet_index as usize * PACKET_SIZE;
    let end = start + take_packets * PACKET_SIZE;
    let data = buffer.0.get(start..end).unwrap_or_default().to_vec();

    ReadPackets {
        data,
        next_packet_index: packet_index + take_packets as u64,
        available_packets,
        buffer_counter: buffer.1,
    }
}

pub fn next_packet(buffer: &mut Buffer) -> Option<[u8; PACKET_SIZE]> {
    let packet_index = buffer.1;
    let response = read_since(buffer, packet_index, 1);
    if response.data.len() != PACKET_SIZE {
        return None;
    }

    let mut packet = [0u8; PACKET_SIZE];
    packet.copy_from_slice(&response.data);
    buffer.1 = buffer.1.saturating_add(1);
    Some(packet)
}

