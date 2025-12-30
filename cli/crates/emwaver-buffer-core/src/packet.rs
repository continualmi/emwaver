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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn make_packet64_pads_with_zeros() {
        let pkt = make_packet64(&[1, 2, 3]).unwrap();
        assert_eq!(pkt[0..3], [1, 2, 3]);
        assert!(pkt[3..].iter().all(|b| *b == 0));
    }

    #[test]
    fn make_packet64_rejects_oversize() {
        let data = vec![0u8; PACKET_SIZE + 1];
        assert!(make_packet64(&data).is_err());
    }
}
