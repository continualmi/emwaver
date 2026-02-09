use base64::Engine as _;

// Rust port of apple/EMWaverAppleCore/Sources/EMWaverTransport/UsbMidiSysex.swift
// Matches STM32 firmware `usbd_midi_if.c` framing.

const SYSEX_START: u8 = 0xF0;
const SYSEX_END: u8 = 0xF7;
const MANUFACTURER_ID: u8 = 0x7D; // non-commercial
const MAGIC: &[u8; 3] = b"EMW";

pub const SUPERFRAME_SIZE: usize = 36;
pub const LANE_SIZE: usize = 18;

fn encode_payload_7bit(in128: &[u8]) -> Result<Vec<u8>, String> {
    if in128.len() != SUPERFRAME_SIZE {
        return Err("superframe must be 36 bytes".to_string());
    }

    // Fixed-size: 36 raw -> 42 encoded.
    let mut out: Vec<u8> = Vec::with_capacity(42);

    let mut in_pos = 0;
    while in_pos < SUPERFRAME_SIZE {
        let mut prefix: u8 = 0;
        let mut chunk: [u8; 7] = [0; 7];
        let mut chunk_len = 0usize;

        for j in 0..7 {
            if in_pos >= SUPERFRAME_SIZE {
                break;
            }
            let b = in128[in_pos];
            in_pos += 1;
            if (b & 0x80) != 0 {
                prefix |= 1 << j;
            }
            chunk[j] = b & 0x7F;
            chunk_len += 1;
        }

        out.push(prefix & 0x7F);
        out.extend_from_slice(&chunk[..chunk_len]);
    }

    Ok(out)
}

fn decode_payload_7bit(input: &[u8]) -> Result<[u8; SUPERFRAME_SIZE], String> {
    if input.is_empty() {
        return Err("encoded payload is empty".to_string());
    }

    let mut out = [0u8; SUPERFRAME_SIZE];
    let mut in_pos = 0usize;
    let mut out_pos = 0usize;

    while in_pos < input.len() && out_pos < SUPERFRAME_SIZE {
        let prefix = input[in_pos] & 0x7F;
        in_pos += 1;

        for j in 0..7 {
            if out_pos >= SUPERFRAME_SIZE {
                break;
            }
            if in_pos >= input.len() {
                return Err("truncated encoded payload".to_string());
            }
            let mut v = input[in_pos] & 0x7F;
            in_pos += 1;
            if (prefix & (1 << j)) != 0 {
                v |= 0x80;
            }
            out[out_pos] = v;
            out_pos += 1;
        }
    }

    if out_pos != SUPERFRAME_SIZE {
        return Err("decoded payload wrong size".to_string());
    }
    Ok(out)
}

pub fn encode_superframe(superframe: &[u8]) -> Result<Vec<u8>, String> {
    if superframe.len() != SUPERFRAME_SIZE {
        return Err("superframe must be 36 bytes".to_string());
    }
    let encoded = encode_payload_7bit(superframe)?;
    if encoded.len() != 42 {
        return Err(format!("encoded payload must be 42 bytes (got {})", encoded.len()));
    }

    let mut out: Vec<u8> = Vec::with_capacity(48);
    out.push(SYSEX_START);
    out.push(MANUFACTURER_ID);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&encoded);
    out.push(SYSEX_END);
    Ok(out)
}

pub fn decode_sysex_to_superframe(sysex: &[u8]) -> Result<[u8; SUPERFRAME_SIZE], String> {
    if sysex.len() < 7 {
        return Err("sysex too short".to_string());
    }
    if sysex[0] != SYSEX_START || sysex[sysex.len() - 1] != SYSEX_END {
        return Err("invalid sysex framing".to_string());
    }
    if sysex[1] != MANUFACTURER_ID {
        return Err("not EMW manufacturer id".to_string());
    }
    if sysex.len() < 1 + 1 + 3 + 1 {
        return Err("sysex too short".to_string());
    }
    if &sysex[2..5] != MAGIC {
        return Err("not EMW magic".to_string());
    }

    let encoded = &sysex[5..sysex.len() - 1];
    decode_payload_7bit(encoded)
}

pub fn make_superframe(cmd_lane: Option<&[u8]>, stream_lane: Option<&[u8]>) -> [u8; SUPERFRAME_SIZE] {
    let mut sf = [0u8; SUPERFRAME_SIZE];
    if let Some(c) = cmd_lane {
        let len = std::cmp::min(c.len(), LANE_SIZE);
        if len > 0 {
            sf[..len].copy_from_slice(&c[..len]);
        }
    }
    if let Some(s) = stream_lane {
        let len = std::cmp::min(s.len(), LANE_SIZE);
        if len > 0 {
            sf[LANE_SIZE..LANE_SIZE + len].copy_from_slice(&s[..len]);
        }
    }
    sf
}

pub fn make_packet(data: &[u8]) -> Result<[u8; LANE_SIZE], String> {
    if data.len() > LANE_SIZE {
        return Err(format!("packet too large: {} bytes (max {})", data.len(), LANE_SIZE));
    }
    let mut out = [0u8; LANE_SIZE];
    out[..data.len()].copy_from_slice(data);
    Ok(out)
}

/// Accumulates byte streams into complete SysEx frames.
pub struct SysexAccumulator {
    buf: Vec<u8>,
    in_sysex: bool,
}

impl SysexAccumulator {
    pub fn new() -> Self {
        Self {
            buf: Vec::with_capacity(512),
            in_sysex: false,
        }
    }

    pub fn feed(&mut self, data: &[u8]) -> Vec<Vec<u8>> {
        let mut out: Vec<Vec<u8>> = Vec::new();

        for &b in data {
            if b == SYSEX_START {
                self.buf.clear();
                self.in_sysex = true;
            }
            if !self.in_sysex {
                continue;
            }
            self.buf.push(b);
            if b == SYSEX_END {
                out.push(self.buf.clone());
                self.buf.clear();
                self.in_sysex = false;
            }
        }

        out
    }
}

#[allow(dead_code)]
pub fn debug_sysex_b64(sysex: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(sysex)
}
