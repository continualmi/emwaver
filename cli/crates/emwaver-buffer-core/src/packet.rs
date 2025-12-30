pub const PACKET_SIZE: usize = 64;

pub fn make_packet64(data: &[u8]) -> Result<[u8; PACKET_SIZE], String> {
    if data.len() > PACKET_SIZE {
        return Err(format!(
            "Command too large: {} bytes (max {})",
            data.len(),
            PACKET_SIZE
        ));
    }
    let mut packet = [0u8; PACKET_SIZE];
    packet[..data.len()].copy_from_slice(data);
    Ok(packet)
}

