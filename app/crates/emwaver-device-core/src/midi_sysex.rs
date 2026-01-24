use anyhow::{bail, Result};

const SYSEX_START: u8 = 0xF0;
const SYSEX_END: u8 = 0xF7;
const MFR_NON_COMMERCIAL: u8 = 0x7D;
const PROTO_MAGIC: [u8; 3] = *b"EMW";
const PROTO_VERSION: u8 = 0x01;

pub(crate) const LANE_SIZE: usize = 64;
pub(crate) const SUPERFRAME_SIZE: usize = 128;

pub(crate) fn build_superframe(
    cmd_lane: [u8; LANE_SIZE],
    stream_lane: [u8; LANE_SIZE],
) -> [u8; SUPERFRAME_SIZE] {
    let mut sf = [0u8; SUPERFRAME_SIZE];
    sf[0..LANE_SIZE].copy_from_slice(&cmd_lane);
    sf[LANE_SIZE..SUPERFRAME_SIZE].copy_from_slice(&stream_lane);
    sf
}

pub(crate) fn split_superframe(sf: &[u8; SUPERFRAME_SIZE]) -> ([u8; LANE_SIZE], [u8; LANE_SIZE]) {
    let mut cmd = [0u8; LANE_SIZE];
    let mut stream = [0u8; LANE_SIZE];
    cmd.copy_from_slice(&sf[0..LANE_SIZE]);
    stream.copy_from_slice(&sf[LANE_SIZE..SUPERFRAME_SIZE]);
    (cmd, stream)
}

pub(crate) fn encode_superframe(sf: &[u8; SUPERFRAME_SIZE]) -> Vec<u8> {
    // Worst-case: 7-bit encoding expands payload by ~8/7.
    let mut out = Vec::with_capacity(1 + 1 + 3 + 1 + 160 + 1);
    out.push(SYSEX_START);
    out.push(MFR_NON_COMMERCIAL);
    out.extend_from_slice(&PROTO_MAGIC);
    out.push(PROTO_VERSION);

    // 7-byte groups -> 1 prefix + 7 bytes (MSB cleared)
    for chunk in sf.chunks(7) {
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

pub(crate) fn decode_superframe(msg: &[u8]) -> Result<Option<[u8; SUPERFRAME_SIZE]>> {
    if msg.len() < 8 {
        return Ok(None);
    }
    if msg[0] != SYSEX_START || *msg.last().unwrap() != SYSEX_END {
        return Ok(None);
    }
    if msg[1] != MFR_NON_COMMERCIAL
        || msg.get(2..5) != Some(&PROTO_MAGIC)
        || msg[5] != PROTO_VERSION
    {
        return Ok(None);
    }

    let encoded = &msg[6..msg.len() - 1];
    let mut out = [0u8; SUPERFRAME_SIZE];
    let mut out_pos = 0usize;
    let mut in_pos = 0usize;

    while in_pos < encoded.len() && out_pos < SUPERFRAME_SIZE {
        let prefix = encoded[in_pos];
        in_pos += 1;
        for bit in 0..7 {
            if out_pos >= SUPERFRAME_SIZE {
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

    if out_pos != SUPERFRAME_SIZE {
        bail!("invalid sysex payload length");
    }
    Ok(Some(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn superframe_roundtrips() {
        let mut cmd = [0u8; LANE_SIZE];
        let mut stream = [0u8; LANE_SIZE];
        for (i, b) in cmd.iter_mut().enumerate() {
            *b = (i as u8).wrapping_mul(3);
        }
        for (i, b) in stream.iter_mut().enumerate() {
            *b = (i as u8).wrapping_mul(7) ^ 0xAA;
        }

        let sf = build_superframe(cmd, stream);
        let sysex = encode_superframe(&sf);
        let decoded = decode_superframe(&sysex).unwrap().unwrap();
        assert_eq!(decoded, sf);
    }
}
