use emwaver_buffer_core::{buffer as core_buf, packet, sampler, status, tx};
use std::sync::{Mutex, OnceLock};

struct State {
    buffer: core_buf::Buffer,
}

static STATE: OnceLock<Mutex<State>> = OnceLock::new();

fn with_state<R>(f: impl FnOnce(&mut State) -> R) -> R {
    let mutex = STATE.get_or_init(|| Mutex::new(State {
        buffer: core_buf::Buffer::default(),
    }));
    let mut guard = mutex.lock().expect("buffer state lock poisoned");
    f(&mut *guard)
}

fn slice_from_raw<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        return &[];
    }
    // SAFETY: caller promises pointer is valid for len bytes.
    unsafe { std::slice::from_raw_parts(ptr, len) }
}

fn slice_from_raw_u64<'a>(ptr: *const u64, len: usize) -> &'a [u64] {
    if ptr.is_null() || len == 0 {
        return &[];
    }
    // SAFETY: caller promises pointer is valid for len elements.
    unsafe { std::slice::from_raw_parts(ptr, len) }
}

fn write_out_vec_u8(out_ptr: *mut *mut u8, out_len: *mut usize, v: Vec<u8>) {
    if out_ptr.is_null() || out_len.is_null() {
        return;
    }
    if v.is_empty() {
        // SAFETY: caller provided valid pointers.
        unsafe {
            *out_ptr = std::ptr::null_mut();
            *out_len = 0;
        }
        return;
    }
    let len = v.len();
    let boxed = v.into_boxed_slice();
    let ptr = Box::into_raw(boxed) as *mut u8;
    // SAFETY: caller provided valid pointers.
    unsafe {
        *out_ptr = ptr;
        *out_len = len;
    }
}

fn write_out_vec_u64(out_ptr: *mut *mut u64, out_len: *mut usize, v: Vec<u64>) {
    if out_ptr.is_null() || out_len.is_null() {
        return;
    }
    if v.is_empty() {
        // SAFETY: caller provided valid pointers.
        unsafe {
            *out_ptr = std::ptr::null_mut();
            *out_len = 0;
        }
        return;
    }
    let len = v.len();
    let boxed = v.into_boxed_slice();
    let ptr = Box::into_raw(boxed) as *mut u64;
    // SAFETY: caller provided valid pointers.
    unsafe {
        *out_ptr = ptr;
        *out_len = len;
    }
}

fn write_out_vec_f32(out_ptr: *mut *mut f32, out_len: *mut usize, v: Vec<f32>) {
    if out_ptr.is_null() || out_len.is_null() {
        return;
    }
    if v.is_empty() {
        // SAFETY: caller provided valid pointers.
        unsafe {
            *out_ptr = std::ptr::null_mut();
            *out_len = 0;
        }
        return;
    }
    let len = v.len();
    let boxed = v.into_boxed_slice();
    let ptr = Box::into_raw(boxed) as *mut f32;
    // SAFETY: caller provided valid pointers.
    unsafe {
        *out_ptr = ptr;
        *out_len = len;
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_free_u8(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    // SAFETY: ptr/len were produced by write_out_vec_u8.
    unsafe {
        let slice = std::ptr::slice_from_raw_parts_mut(ptr, len);
        drop(Box::from_raw(slice));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_free_u64(ptr: *mut u64, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    // SAFETY: ptr/len were produced by write_out_vec_u64.
    unsafe {
        let slice = std::ptr::slice_from_raw_parts_mut(ptr, len);
        drop(Box::from_raw(slice));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_free_f32(ptr: *mut f32, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    // SAFETY: ptr/len were produced by write_out_vec_f32.
    unsafe {
        let slice = std::ptr::slice_from_raw_parts_mut(ptr, len);
        drop(Box::from_raw(slice));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_clear_all() {
    with_state(|state| core_buf::clear(&mut state.buffer));
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_rx_len_bytes() -> usize {
    with_state(|state| core_buf::rx_len_bytes(&state.buffer))
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_rx_packet_count() -> u64 {
    with_state(|state| core_buf::rx_packet_count(&state.buffer))
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_tx_packet_count() -> u64 {
    with_state(|state| core_buf::tx_packet_count(&state.buffer))
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_get_rx_counter() -> u64 {
    with_state(|state| state.buffer.rx_counter)
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_set_rx_counter(value: u64) {
    with_state(|state| {
        let packets = core_buf::rx_packet_count(&state.buffer);
        state.buffer.rx_counter = value.min(packets);
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_set_invert_rx(enabled: bool) {
    with_state(|state| core_buf::set_invert_rx(&mut state.buffer, enabled));
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_load_rx_bytes(data: *const u8, len: usize) {
    let bytes = slice_from_raw(data, len).to_vec();
    with_state(|state| core_buf::rx_set_bytes(&mut state.buffer, bytes));
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_get_rx_snapshot(out_ptr: *mut *mut u8, out_len: *mut usize) {
    let snapshot = with_state(|state| core_buf::rx_snapshot(&state.buffer));
    write_out_vec_u8(out_ptr, out_len, snapshot);
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_store_bulk_pkt(data: *const u8, len: usize, ts_ms: u64) {
    let bytes = slice_from_raw(data, len);
    with_state(|state| core_buf::append_rx_bytes(&mut state.buffer, bytes, ts_ms));
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_append_tx_bytes(data: *const u8, len: usize, ts_ms: u64) {
    let bytes = slice_from_raw(data, len);
    with_state(|state| {
        for chunk in bytes.chunks(packet::PACKET_SIZE) {
            let Ok(pkt) = packet::make_packet64(chunk) else {
                continue;
            };
            core_buf::append_tx_packet(&mut state.buffer, &pkt, ts_ms);
        }
    });
}

fn read_packets_to_out(
    rp: core_buf::ReadPackets,
    out_data_ptr: *mut *mut u8,
    out_data_len: *mut usize,
    out_ts_ptr: *mut *mut u64,
    out_ts_len: *mut usize,
    out_next_packet_index: *mut u64,
    out_available_packets: *mut u64,
) {
    write_out_vec_u8(out_data_ptr, out_data_len, rp.data);
    write_out_vec_u64(out_ts_ptr, out_ts_len, rp.ts_ms);
    if !out_next_packet_index.is_null() {
        // SAFETY: caller provided valid pointer.
        unsafe {
            *out_next_packet_index = rp.next_packet_index;
        }
    }
    if !out_available_packets.is_null() {
        // SAFETY: caller provided valid pointer.
        unsafe {
            *out_available_packets = rp.available_packets;
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_read_rx_since(
    packet_index: u64,
    max_packets: usize,
    out_data_ptr: *mut *mut u8,
    out_data_len: *mut usize,
    out_ts_ptr: *mut *mut u64,
    out_ts_len: *mut usize,
    out_next_packet_index: *mut u64,
    out_available_packets: *mut u64,
) {
    let rp = with_state(|state| core_buf::read_rx_since(&state.buffer, packet_index, max_packets));
    read_packets_to_out(
        rp,
        out_data_ptr,
        out_data_len,
        out_ts_ptr,
        out_ts_len,
        out_next_packet_index,
        out_available_packets,
    );
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_read_tx_since(
    packet_index: u64,
    max_packets: usize,
    out_data_ptr: *mut *mut u8,
    out_data_len: *mut usize,
    out_ts_ptr: *mut *mut u64,
    out_ts_len: *mut usize,
    out_next_packet_index: *mut u64,
    out_available_packets: *mut u64,
) {
    let rp = with_state(|state| core_buf::read_tx_since(&state.buffer, packet_index, max_packets));
    read_packets_to_out(
        rp,
        out_data_ptr,
        out_data_len,
        out_ts_ptr,
        out_ts_len,
        out_next_packet_index,
        out_available_packets,
    );
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_next_rx_packet(
    out_packet64: *mut u8,
    out_packet64_len: usize,
    out_ts_ms: *mut u64,
) -> bool {
    if out_packet64.is_null() || out_packet64_len < packet::PACKET_SIZE || out_ts_ms.is_null() {
        return false;
    }

    let pkt = with_state(|state| core_buf::next_rx_packet(&mut state.buffer));
    let Some(pkt) = pkt else {
        return false;
    };
    if pkt.data.len() != packet::PACKET_SIZE {
        return false;
    }

    // SAFETY: caller provided a valid output pointer for PACKET_SIZE bytes and out_ts_ms.
    unsafe {
        std::ptr::copy_nonoverlapping(pkt.data.as_ptr(), out_packet64, packet::PACKET_SIZE);
        *out_ts_ms = pkt.ts_ms;
    }
    true
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_packet_make_packet64(
    data: *const u8,
    len: usize,
    out_packet64: *mut u8,
    out_packet64_len: usize,
) -> bool {
    if out_packet64.is_null() || out_packet64_len < packet::PACKET_SIZE {
        return false;
    }
    let bytes = slice_from_raw(data, len);
    let Ok(pkt) = packet::make_packet64(bytes) else {
        return false;
    };
    // SAFETY: caller provided a valid output pointer for PACKET_SIZE bytes.
    unsafe {
        std::ptr::copy_nonoverlapping(pkt.as_ptr(), out_packet64, packet::PACKET_SIZE);
    }
    true
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_status_parse_bs(packet64: *const u8, len: usize) -> i32 {
    let bytes = slice_from_raw(packet64, len);
    status::parse_bs(bytes).map(|v| v as i32).unwrap_or(-1)
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_compress_data_bits(
    range_start: i32,
    range_end: i32,
    number_bins: i32,
    out_time_ptr: *mut *mut f32,
    out_time_len: *mut usize,
    out_data_ptr: *mut *mut f32,
    out_data_len: *mut usize,
) {
    let start = if range_start < 0 { 0 } else { range_start as usize };
    let end = if range_end < 0 { 0 } else { range_end as usize };
    let bins = if number_bins < 0 {
        0
    } else {
        number_bins as usize
    };

    let bytes = with_state(|state| core_buf::rx_snapshot(&state.buffer));
    let (time_values, data_values) = sampler::compress_bits(&bytes, start, end, bins);
    write_out_vec_f32(out_time_ptr, out_time_len, time_values);
    write_out_vec_f32(out_data_ptr, out_data_len, data_values);
}

#[repr(C)]
pub struct EmwBleTxProfile {
    max_packet_size: i32,
    min_packet_size: i32,
    initial_packet_size: i32,
    fixed_delay_ms: i32,
    target_buffer_level: i32,
    buffer_high_threshold: i32,
    buffer_low_threshold: i32,
    initial_fill_bytes: i32,
    nudge_band: i32,
    step_large: i32,
    step_small: i32,
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_tx_ble_profile_default() -> EmwBleTxProfile {
    let p = tx::BleTxProfile::default();
    EmwBleTxProfile {
        max_packet_size: p.max_packet_size as i32,
        min_packet_size: p.min_packet_size as i32,
        initial_packet_size: p.initial_packet_size as i32,
        fixed_delay_ms: p.fixed_delay_ms as i32,
        target_buffer_level: p.target_buffer_level,
        buffer_high_threshold: p.buffer_high_threshold,
        buffer_low_threshold: p.buffer_low_threshold,
        initial_fill_bytes: p.initial_fill_bytes as i32,
        nudge_band: p.nudge_band,
        step_large: p.step_large as i32,
        step_small: p.step_small as i32,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_tx_ble_next_packet_size(
    bytes_sent: i32,
    last_status: i32,
    current_packet_size: i32,
) -> i32 {
    let bytes_sent = if bytes_sent < 0 { 0 } else { bytes_sent as usize };
    let current_packet_size = if current_packet_size < 0 {
        0
    } else {
        current_packet_size as usize
    };
    tx::ble_next_packet_size(
        tx::BleTxProfile::default(),
        bytes_sent,
        last_status,
        current_packet_size,
    ) as i32
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_take_rx_state(
    out_rx_bytes_ptr: *mut *mut u8,
    out_rx_bytes_len: *mut usize,
    out_rx_ts_ptr: *mut *mut u64,
    out_rx_ts_len: *mut usize,
    out_rx_counter: *mut u64,
) {
    let (rx_bytes, rx_ts, rx_counter) = with_state(|state| {
        (
            std::mem::take(&mut state.buffer.rx_bytes),
            std::mem::take(&mut state.buffer.rx_ts_ms),
            state.buffer.rx_counter,
        )
    });

    write_out_vec_u8(out_rx_bytes_ptr, out_rx_bytes_len, rx_bytes);
    write_out_vec_u64(out_rx_ts_ptr, out_rx_ts_len, rx_ts);

    if !out_rx_counter.is_null() {
        // SAFETY: caller provided valid pointer.
        unsafe {
            *out_rx_counter = rx_counter;
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn emw_buffer_restore_rx_state(
    rx_bytes: *const u8,
    rx_bytes_len: usize,
    rx_ts_ms: *const u64,
    rx_ts_len: usize,
    rx_counter: u64,
) {
    let bytes = slice_from_raw(rx_bytes, rx_bytes_len).to_vec();
    let ts = slice_from_raw_u64(rx_ts_ms, rx_ts_len).to_vec();

    with_state(|state| {
        state.buffer.rx_bytes = bytes;
        state.buffer.rx_ts_ms = ts;

        let packets = core_buf::rx_packet_count(&state.buffer);
        if state.buffer.rx_ts_ms.len() < packets as usize {
            state.buffer.rx_ts_ms.resize(packets as usize, 0);
        } else if state.buffer.rx_ts_ms.len() > packets as usize {
            state.buffer.rx_ts_ms.truncate(packets as usize);
        }

        state.buffer.rx_counter = rx_counter.min(packets);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    unsafe fn take_u8(out_ptr: *mut u8, out_len: usize) -> Vec<u8> {
        if out_ptr.is_null() || out_len == 0 {
            return Vec::new();
        }
        let bytes = unsafe { std::slice::from_raw_parts(out_ptr, out_len) }.to_vec();
        emw_free_u8(out_ptr, out_len);
        bytes
    }

    unsafe fn take_u64(out_ptr: *mut u64, out_len: usize) -> Vec<u64> {
        if out_ptr.is_null() || out_len == 0 {
            return Vec::new();
        }
        let vals = unsafe { std::slice::from_raw_parts(out_ptr, out_len) }.to_vec();
        emw_free_u64(out_ptr, out_len);
        vals
    }

    #[test]
    fn make_packet64_rejects_oversize() {
        let mut out = [0u8; packet::PACKET_SIZE];
        let ok = emw_packet_make_packet64(
            [0u8; packet::PACKET_SIZE + 1].as_ptr(),
            packet::PACKET_SIZE + 1,
            out.as_mut_ptr(),
            out.len(),
        );
        assert!(!ok);
    }

    #[test]
    fn store_bulk_pkt_timestamps_per_completed_packet() {
        emw_buffer_clear_all();

        emw_buffer_store_bulk_pkt([0u8; 10].as_ptr(), 10, 111);
        emw_buffer_store_bulk_pkt([0u8; 54].as_ptr(), 54, 222);

        let mut data_ptr: *mut u8 = std::ptr::null_mut();
        let mut data_len: usize = 0;
        let mut ts_ptr: *mut u64 = std::ptr::null_mut();
        let mut ts_len: usize = 0;
        let mut next_idx: u64 = 0;
        let mut avail: u64 = 0;

        emw_buffer_read_rx_since(
            0,
            10,
            &mut data_ptr,
            &mut data_len,
            &mut ts_ptr,
            &mut ts_len,
            &mut next_idx,
            &mut avail,
        );

        let data = unsafe { take_u8(data_ptr, data_len) };
        let ts = unsafe { take_u64(ts_ptr, ts_len) };

        assert_eq!(avail, 1);
        assert_eq!(next_idx, 1);
        assert_eq!(data.len(), packet::PACKET_SIZE);
        assert_eq!(ts, vec![222]);
    }
}
