pub fn parse_bs(data: &[u8]) -> Option<u16> {
    if data.len() < 4 || data[0] != b'B' || data[1] != b'S' {
        return None;
    }
    Some(u16::from_be_bytes([data[2], data[3]]))
}

