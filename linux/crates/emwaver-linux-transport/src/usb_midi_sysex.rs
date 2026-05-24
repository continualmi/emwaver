use thiserror::Error;

pub const LANE_SIZE_BYTES: usize = 18;
pub const SUPERFRAME_SIZE_BYTES: usize = 36;
pub const ENCODED_PAYLOAD_SIZE_BYTES: usize = 42;
pub const SYSEX_SIZE_BYTES: usize = 48;
pub const USB_MIDI_PACKET_SIZE_BYTES: usize = 64;

const SYSEX_START: u8 = 0xf0;
const SYSEX_END: u8 = 0xf7;
const MANUFACTURER_ID: u8 = 0x7d;
const MAGIC: [u8; 3] = *b"EMW";
const USB_MIDI_CONTINUE_CIN: u8 = 0x04;
const USB_MIDI_ENDS_3_CIN: u8 = 0x07;

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum UsbMidiSysexError {
    #[error("superframe must be exactly {SUPERFRAME_SIZE_BYTES} bytes")]
    InvalidSuperframeSize,
    #[error("SysEx frame must be exactly {SYSEX_SIZE_BYTES} bytes")]
    InvalidSysexSize,
    #[error("USB MIDI packet must be exactly {USB_MIDI_PACKET_SIZE_BYTES} bytes")]
    InvalidUsbMidiPacketSize,
    #[error("invalid EMWaver SysEx header or trailer")]
    InvalidSysexEnvelope,
    #[error("invalid 7-bit payload")]
    InvalidPayload,
}

pub fn encode_superframe_to_sysex(
    superframe: &[u8],
) -> Result<[u8; SYSEX_SIZE_BYTES], UsbMidiSysexError> {
    if superframe.len() != SUPERFRAME_SIZE_BYTES {
        return Err(UsbMidiSysexError::InvalidSuperframeSize);
    }

    let encoded = encode_payload_7bit(superframe)?;
    let mut out = [0u8; SYSEX_SIZE_BYTES];
    out[0] = SYSEX_START;
    out[1] = MANUFACTURER_ID;
    out[2..5].copy_from_slice(&MAGIC);
    out[5..47].copy_from_slice(&encoded);
    out[47] = SYSEX_END;
    Ok(out)
}

pub fn decode_sysex_to_superframe(
    sysex: &[u8],
) -> Result<[u8; SUPERFRAME_SIZE_BYTES], UsbMidiSysexError> {
    if sysex.len() != SYSEX_SIZE_BYTES {
        return Err(UsbMidiSysexError::InvalidSysexSize);
    }
    if sysex[0] != SYSEX_START
        || sysex[1] != MANUFACTURER_ID
        || sysex[2..5] != MAGIC
        || sysex[47] != SYSEX_END
    {
        return Err(UsbMidiSysexError::InvalidSysexEnvelope);
    }

    decode_payload_7bit(&sysex[5..47])
}

pub fn pack_sysex_to_usb_midi(
    sysex: &[u8],
) -> Result<[u8; USB_MIDI_PACKET_SIZE_BYTES], UsbMidiSysexError> {
    if sysex.len() != SYSEX_SIZE_BYTES {
        return Err(UsbMidiSysexError::InvalidSysexSize);
    }

    let mut out = [0u8; USB_MIDI_PACKET_SIZE_BYTES];
    for event_index in 0..16 {
        let cin = if event_index == 15 {
            USB_MIDI_ENDS_3_CIN
        } else {
            USB_MIDI_CONTINUE_CIN
        };
        let usb = event_index * 4;
        let midi = event_index * 3;
        out[usb] = cin;
        out[usb + 1] = sysex[midi];
        out[usb + 2] = sysex[midi + 1];
        out[usb + 3] = sysex[midi + 2];
    }
    Ok(out)
}

pub fn unpack_usb_midi_to_sysex(
    packet: &[u8],
) -> Result<[u8; SYSEX_SIZE_BYTES], UsbMidiSysexError> {
    if packet.len() != USB_MIDI_PACKET_SIZE_BYTES {
        return Err(UsbMidiSysexError::InvalidUsbMidiPacketSize);
    }

    let mut sysex = [0u8; SYSEX_SIZE_BYTES];
    for event_index in 0..16 {
        let usb = event_index * 4;
        let midi = event_index * 3;
        sysex[midi] = packet[usb + 1];
        sysex[midi + 1] = packet[usb + 2];
        sysex[midi + 2] = packet[usb + 3];
    }
    Ok(sysex)
}

pub fn encode_superframe_to_usb_midi(
    superframe: &[u8],
) -> Result<[u8; USB_MIDI_PACKET_SIZE_BYTES], UsbMidiSysexError> {
    let sysex = encode_superframe_to_sysex(superframe)?;
    pack_sysex_to_usb_midi(&sysex)
}

pub fn decode_usb_midi_to_superframe(
    packet: &[u8],
) -> Result<[u8; SUPERFRAME_SIZE_BYTES], UsbMidiSysexError> {
    let sysex = unpack_usb_midi_to_sysex(packet)?;
    decode_sysex_to_superframe(&sysex)
}

fn encode_payload_7bit(
    input: &[u8],
) -> Result<[u8; ENCODED_PAYLOAD_SIZE_BYTES], UsbMidiSysexError> {
    if input.len() != SUPERFRAME_SIZE_BYTES {
        return Err(UsbMidiSysexError::InvalidSuperframeSize);
    }

    let mut out = [0u8; ENCODED_PAYLOAD_SIZE_BYTES];
    let mut input_pos = 0;
    let mut output_pos = 0;

    while input_pos < SUPERFRAME_SIZE_BYTES {
        let prefix_pos = output_pos;
        output_pos += 1;
        let mut prefix = 0u8;

        for bit in 0..7 {
            if input_pos >= SUPERFRAME_SIZE_BYTES {
                break;
            }
            let byte = input[input_pos];
            input_pos += 1;
            if byte & 0x80 != 0 {
                prefix |= 1 << bit;
            }
            out[output_pos] = byte & 0x7f;
            output_pos += 1;
        }

        out[prefix_pos] = prefix & 0x7f;
    }

    if output_pos != ENCODED_PAYLOAD_SIZE_BYTES {
        return Err(UsbMidiSysexError::InvalidPayload);
    }
    Ok(out)
}

fn decode_payload_7bit(input: &[u8]) -> Result<[u8; SUPERFRAME_SIZE_BYTES], UsbMidiSysexError> {
    if input.len() != ENCODED_PAYLOAD_SIZE_BYTES {
        return Err(UsbMidiSysexError::InvalidPayload);
    }

    let mut out = [0u8; SUPERFRAME_SIZE_BYTES];
    let mut input_pos = 0;
    let mut output_pos = 0;

    while input_pos < input.len() && output_pos < SUPERFRAME_SIZE_BYTES {
        let prefix = input[input_pos] & 0x7f;
        input_pos += 1;

        for bit in 0..7 {
            if output_pos >= SUPERFRAME_SIZE_BYTES {
                break;
            }
            if input_pos >= input.len() {
                return Err(UsbMidiSysexError::InvalidPayload);
            }

            let mut value = input[input_pos] & 0x7f;
            input_pos += 1;
            if prefix & (1 << bit) != 0 {
                value |= 0x80;
            }
            out[output_pos] = value;
            output_pos += 1;
        }
    }

    if output_pos != SUPERFRAME_SIZE_BYTES {
        return Err(UsbMidiSysexError::InvalidPayload);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patterned_superframe() -> [u8; SUPERFRAME_SIZE_BYTES] {
        let mut data = [0u8; SUPERFRAME_SIZE_BYTES];
        for (index, byte) in data.iter_mut().enumerate() {
            *byte = ((index * 17) as u8) ^ 0xa5;
        }
        data
    }

    #[test]
    fn encodes_fixed_emwaver_sysex_envelope() {
        let sysex = encode_superframe_to_sysex(&[0u8; SUPERFRAME_SIZE_BYTES]).unwrap();
        assert_eq!(sysex.len(), SYSEX_SIZE_BYTES);
        assert_eq!(sysex[0], SYSEX_START);
        assert_eq!(sysex[1], MANUFACTURER_ID);
        assert_eq!(&sysex[2..5], b"EMW");
        assert_eq!(sysex[47], SYSEX_END);
    }

    #[test]
    fn round_trips_superframe_through_sysex() {
        let superframe = patterned_superframe();
        let sysex = encode_superframe_to_sysex(&superframe).unwrap();
        let decoded = decode_sysex_to_superframe(&sysex).unwrap();
        assert_eq!(decoded, superframe);
    }

    #[test]
    fn round_trips_superframe_through_usb_midi_packet() {
        let superframe = patterned_superframe();
        let packet = encode_superframe_to_usb_midi(&superframe).unwrap();
        assert_eq!(packet.len(), USB_MIDI_PACKET_SIZE_BYTES);
        for event_index in 0..16 {
            let expected = if event_index == 15 {
                USB_MIDI_ENDS_3_CIN
            } else {
                USB_MIDI_CONTINUE_CIN
            };
            assert_eq!(packet[event_index * 4], expected);
        }

        let decoded = decode_usb_midi_to_superframe(&packet).unwrap();
        assert_eq!(decoded, superframe);
    }

    #[test]
    fn rejects_wrong_size_or_wrong_magic() {
        assert_eq!(
            encode_superframe_to_sysex(&[0u8; 1]).unwrap_err(),
            UsbMidiSysexError::InvalidSuperframeSize
        );

        let mut sysex = encode_superframe_to_sysex(&[0u8; SUPERFRAME_SIZE_BYTES]).unwrap();
        sysex[2] = b'X';
        assert_eq!(
            decode_sysex_to_superframe(&sysex).unwrap_err(),
            UsbMidiSysexError::InvalidSysexEnvelope
        );
    }
}
