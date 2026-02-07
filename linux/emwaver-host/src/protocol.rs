use anyhow::Result;

pub const SYSEX_START: u8 = 0xF0;
pub const SYSEX_END: u8 = 0xF7;
pub const MANUFACTURER_ID: u8 = 0x7D;
pub const MAGIC: &[u8; 3] = b"EMW";

pub const SUPERFRAME_SIZE: usize = 36;
pub const LANE_SIZE: usize = 18;

pub fn make_superframe(cmd_lane: Option<&[u8]>, stream_lane: Option<&[u8]>) -> [u8; SUPERFRAME_SIZE] {
    let mut sf = [0u8; SUPERFRAME_SIZE];
    if let Some(c) = cmd_lane {
        let len = c.len().min(LANE_SIZE);
        sf[..len].copy_from_slice(&c[..len]);
    }
    if let Some(s) = stream_lane {
        let len = s.len().min(LANE_SIZE);
        sf[LANE_SIZE..LANE_SIZE + len].copy_from_slice(&s[..len]);
    }
    sf
}

/// Encode 36B superframe into EMWaver SysEx frame.
/// Format: F0 7D 'E''M''W' <42B 7-bit encoded payload> F7
pub fn encode_superframe(superframe: &[u8; SUPERFRAME_SIZE]) -> Vec<u8> {
    let encoded = encode_payload_7bit(superframe);
    let mut out = Vec::with_capacity(1 + 1 + 3 + encoded.len() + 1);
    out.push(SYSEX_START);
    out.push(MANUFACTURER_ID);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&encoded);
    out.push(SYSEX_END);
    out
}

pub fn decode_sysex_to_superframe(sysex: &[u8]) -> Result<[u8; SUPERFRAME_SIZE]> {
    if sysex.len() < 7 {
        anyhow::bail!("sysex too short");
    }
    if sysex[0] != SYSEX_START || *sysex.last().unwrap() != SYSEX_END {
        anyhow::bail!("invalid sysex markers");
    }
    if sysex[1] != MANUFACTURER_ID {
        anyhow::bail!("invalid manufacturer");
    }
    if sysex[2..5] != MAGIC[..] {
        anyhow::bail!("invalid magic");
    }

    let encoded = &sysex[5..sysex.len() - 1];
    decode_payload_7bit(encoded)
}

fn encode_payload_7bit(input: &[u8; SUPERFRAME_SIZE]) -> Vec<u8> {
    // 36 raw -> 42 encoded.
    let mut out = Vec::with_capacity(42);
    let mut pos = 0usize;
    while pos < SUPERFRAME_SIZE {
        let mut prefix: u8 = 0;
        let mut chunk = [0u8; 7];
        let mut chunk_len = 0usize;
        for j in 0..7 {
            if pos >= SUPERFRAME_SIZE {
                break;
            }
            let b = input[pos];
            pos += 1;
            if (b & 0x80) != 0 {
                prefix |= 1 << j;
            }
            chunk[j] = b & 0x7F;
            chunk_len += 1;
        }
        out.push(prefix & 0x7F);
        out.extend_from_slice(&chunk[..chunk_len]);
    }
    out
}

fn decode_payload_7bit(encoded: &[u8]) -> Result<[u8; SUPERFRAME_SIZE]> {
    if encoded.is_empty() {
        anyhow::bail!("empty payload");
    }

    let mut out = [0u8; SUPERFRAME_SIZE];
    let mut in_pos = 0usize;
    let mut out_pos = 0usize;

    while in_pos < encoded.len() && out_pos < SUPERFRAME_SIZE {
        let prefix = encoded[in_pos] & 0x7F;
        in_pos += 1;

        for j in 0..7 {
            if out_pos >= SUPERFRAME_SIZE {
                break;
            }
            if in_pos >= encoded.len() {
                anyhow::bail!("truncated payload");
            }
            let mut v = encoded[in_pos] & 0x7F;
            in_pos += 1;
            if (prefix & (1 << j)) != 0 {
                v |= 0x80;
            }
            out[out_pos] = v;
            out_pos += 1;
        }
    }

    if out_pos != SUPERFRAME_SIZE {
        anyhow::bail!("payload size mismatch");
    }

    Ok(out)
}
