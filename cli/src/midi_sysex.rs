use anyhow::{Result, bail};

const SYSEX_START: u8 = 0xF0;
const SYSEX_END: u8 = 0xF7;
const MFR_NON_COMMERCIAL: u8 = 0x7D;
const PROTO_MAGIC: [u8; 3] = *b"EMW";
const PROTO_VERSION: u8 = 0x01;

pub(crate) fn encode_packet64(packet: &[u8; 64]) -> Vec<u8> {
    let mut out = Vec::with_capacity(1 + 1 + 3 + 1 + 74 + 1);
    out.push(SYSEX_START);
    out.push(MFR_NON_COMMERCIAL);
    out.extend_from_slice(&PROTO_MAGIC);
    out.push(PROTO_VERSION);

    // 7-byte groups -> 1 prefix + 7 bytes (MSB cleared)
    for chunk in packet.chunks(7) {
        let mut prefix = 0u8;
        let mut data = [0u8; 7];
        for (i, &b) in chunk.iter().enumerate() {
            if (b & 0x80) != 0 {
                prefix |= 1u8 << i;
            }
            data[i] = b & 0x7F;
        }
        out.push(prefix);
        out.extend_from_slice(&data[..chunk.len()]);
    }

    out.push(SYSEX_END);
    out
}

pub(crate) fn decode_packet64(msg: &[u8]) -> Result<Option<[u8; 64]>> {
    if msg.len() < 8 {
        return Ok(None);
    }
    if msg[0] != SYSEX_START || *msg.last().unwrap() != SYSEX_END {
        return Ok(None);
    }
    if msg[1] != MFR_NON_COMMERCIAL || msg.get(2..5) != Some(&PROTO_MAGIC) || msg[5] != PROTO_VERSION
    {
        return Ok(None);
    }

    let encoded = &msg[6..msg.len() - 1];
    let mut out = [0u8; 64];
    let mut out_pos = 0usize;
    let mut in_pos = 0usize;

    while in_pos < encoded.len() && out_pos < 64 {
        let prefix = encoded[in_pos];
        in_pos += 1;
        for bit in 0..7 {
            if out_pos >= 64 {
                break;
            }
            let Some(&b) = encoded.get(in_pos) else {
                bail!("truncated sysex payload");
            };
            in_pos += 1;
            let mut v = b & 0x7F;
            if (prefix & (1u8 << bit)) != 0 {
                v |= 0x80;
            }
            out[out_pos] = v;
            out_pos += 1;
        }
    }

    if out_pos != 64 {
        bail!("invalid sysex payload length");
    }
    Ok(Some(out))
}

