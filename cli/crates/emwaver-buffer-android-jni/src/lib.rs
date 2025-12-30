use emwaver_buffer_core::{buffer as core_buf, packet, sampler, status};
use jni::{
    objects::{JByteArray, JClass, JLongArray, JObject, JValue},
    sys::{jbyteArray, jint, jlong, jlongArray, jobjectArray},
    JNIEnv,
};
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

fn now_ms_from_java(ts_ms: jlong) -> u64 {
    if ts_ms < 0 { 0 } else { ts_ms as u64 }
}

fn bytes_from_raw(env: &mut JNIEnv<'_>, data: jbyteArray) -> Option<Vec<u8>> {
    if data.is_null() {
        return Some(Vec::new());
    }
    let arr = unsafe { JByteArray::from_raw(data) };
    env.convert_byte_array(arr).ok()
}

fn u64s_from_raw_long_array(env: &mut JNIEnv<'_>, data: jlongArray) -> Vec<u64> {
    if data.is_null() {
        return Vec::new();
    }
    let arr = unsafe { JLongArray::from_raw(data) };
    let Ok(len) = env.get_array_length(&arr) else {
        return Vec::new();
    };
    if len <= 0 {
        return Vec::new();
    }
    let mut tmp = vec![0 as jlong; len as usize];
    if env.get_long_array_region(&arr, 0, &mut tmp).is_err() {
        return Vec::new();
    }
    tmp.into_iter()
        .map(|v| if v < 0 { 0 } else { v as u64 })
        .collect()
}

fn throw_illegal_argument(env: &mut JNIEnv<'_>, message: &str) {
    let _ = env.throw_new("java/lang/IllegalArgumentException", message);
}

fn make_byte_array<'a>(env: &mut JNIEnv<'a>, bytes: &[u8]) -> Option<JByteArray<'a>> {
    let Ok(out) = env.new_byte_array(bytes.len() as i32) else {
        return None;
    };
    if !bytes.is_empty() {
        let tmp: Vec<i8> = bytes.iter().map(|b| *b as i8).collect();
        if env.set_byte_array_region(&out, 0, &tmp).is_err() {
            return None;
        }
    }
    Some(out)
}

fn make_long_array<'a>(
    env: &mut JNIEnv<'a>,
    values: &[u64],
) -> Option<jni::objects::JLongArray<'a>> {
    let Ok(out) = env.new_long_array(values.len() as i32) else {
        return None;
    };
    if !values.is_empty() {
        let tmp: Vec<jlong> = values.iter().map(|v| *v as jlong).collect();
        if env.set_long_array_region(&out, 0, &tmp).is_err() {
            return None;
        }
    }
    Some(out)
}

fn make_float_array<'a>(
    env: &mut JNIEnv<'a>,
    values: &[f32],
) -> Option<jni::objects::JFloatArray<'a>> {
    let Ok(out) = env.new_float_array(values.len() as i32) else {
        return None;
    };
    if !values.is_empty() {
        if env.set_float_array_region(&out, 0, values).is_err() {
            return None;
        }
    }
    Some(out)
}

fn make_long_object<'a>(env: &mut JNIEnv<'a>, value: u64) -> Option<JObject<'a>> {
    let Ok(long_class) = env.find_class("java/lang/Long") else {
        return None;
    };
    env.new_object(long_class, "(J)V", &[JValue::Long(value as jlong)])
        .ok()
}

fn make_object_array<'a>(
    env: &mut JNIEnv<'a>,
    len: i32,
) -> Option<jni::objects::JObjectArray<'a>> {
    let Ok(object_class) = env.find_class("java/lang/Object") else {
        return None;
    };
    env.new_object_array(len, object_class, JObject::null())
        .ok()
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_clearAll(
    _env: JNIEnv<'_>,
    _class: JClass<'_>,
) {
    with_state(|state| core_buf::clear(&mut state.buffer));
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_getBufferLength(
    _env: JNIEnv<'_>,
    _class: JClass<'_>,
) -> jint {
    with_state(|state| core_buf::rx_len_bytes(&state.buffer) as jint)
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_getBuffer(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
) -> jbyteArray {
    let snapshot = with_state(|state| core_buf::rx_snapshot(&state.buffer));
    let Some(arr) = make_byte_array(&mut env, &snapshot) else {
        return std::ptr::null_mut();
    };
    arr.into_raw()
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_loadBuffer(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    data: jbyteArray,
) {
    let Some(vec) = bytes_from_raw(&mut env, data) else {
        return;
    };
    with_state(|state| core_buf::rx_set_bytes(&mut state.buffer, vec));
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_storeBulkPkt(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    data: jbyteArray,
    ts_ms: jlong,
) {
    let Some(bytes) = bytes_from_raw(&mut env, data) else {
        return;
    };
    let ts = now_ms_from_java(ts_ms);
    with_state(|state| core_buf::append_rx_bytes(&mut state.buffer, &bytes, ts));
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_appendTxBytes(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    data: jbyteArray,
    ts_ms: jlong,
) {
    let Some(bytes) = bytes_from_raw(&mut env, data) else {
        return;
    };
    let ts = now_ms_from_java(ts_ms);

    with_state(|state| {
        for chunk in bytes.chunks(packet::PACKET_SIZE) {
            let Ok(pkt) = packet::make_packet64(chunk) else {
                continue;
            };
            core_buf::append_tx_packet(&mut state.buffer, &pkt, ts);
        }
    });
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_getRxPacketCount(
    _env: JNIEnv<'_>,
    _class: JClass<'_>,
) -> jlong {
    with_state(|state| core_buf::rx_packet_count(&state.buffer) as jlong)
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_getRxCounter(
    _env: JNIEnv<'_>,
    _class: JClass<'_>,
) -> jlong {
    with_state(|state| state.buffer.rx_counter as jlong)
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_setRxCounter(
    _env: JNIEnv<'_>,
    _class: JClass<'_>,
    value: jlong,
) {
    with_state(|state| {
        let v = if value < 0 { 0 } else { value as u64 };
        let available = core_buf::rx_packet_count(&state.buffer);
        state.buffer.rx_counter = v.min(available);
    });
}

// Returns Object[] { byte[] packet64, Long tsMs } or null if no packet is available.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_nextRxPacket(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
) -> jobjectArray {
    let pkt = with_state(|state| core_buf::next_rx_packet(&mut state.buffer));
    let Some(pkt) = pkt else {
        return std::ptr::null_mut();
    };

    let Some(data_array) = make_byte_array(&mut env, &pkt.data) else {
        return std::ptr::null_mut();
    };
    let Some(ts_obj) = make_long_object(&mut env, pkt.ts_ms) else {
        return std::ptr::null_mut();
    };
    let Some(result) = make_object_array(&mut env, 2) else {
        return std::ptr::null_mut();
    };

    let _ = env.set_object_array_element(&result, 0, data_array);
    let _ = env.set_object_array_element(&result, 1, ts_obj);
    result.into_raw()
}

// Returns Object[] { byte[] data, long[] tsMs, long nextPacketIndex, long availablePackets }.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_readRxSince(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    packet_index: jlong,
    max_packets: jint,
) -> jobjectArray {
    let packet_index = if packet_index < 0 { 0 } else { packet_index as u64 };
    let max_packets = if max_packets < 0 { 0 } else { max_packets as usize };

    let resp = with_state(|state| core_buf::read_rx_since(&state.buffer, packet_index, max_packets));

    let Some(data_array) = make_byte_array(&mut env, &resp.data) else {
        return std::ptr::null_mut();
    };
    let Some(ts_array) = make_long_array(&mut env, &resp.ts_ms) else {
        return std::ptr::null_mut();
    };
    let Some(next_obj) = make_long_object(&mut env, resp.next_packet_index) else {
        return std::ptr::null_mut();
    };
    let Some(avail_obj) = make_long_object(&mut env, resp.available_packets) else {
        return std::ptr::null_mut();
    };
    let Some(result) = make_object_array(&mut env, 4) else {
        return std::ptr::null_mut();
    };

    let _ = env.set_object_array_element(&result, 0, data_array);
    let _ = env.set_object_array_element(&result, 1, ts_array);
    let _ = env.set_object_array_element(&result, 2, next_obj);
    let _ = env.set_object_array_element(&result, 3, avail_obj);
    result.into_raw()
}

// Returns Object[] { byte[] data, long[] tsMs, long nextPacketIndex, long availablePackets }.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_readTxSince(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    packet_index: jlong,
    max_packets: jint,
) -> jobjectArray {
    let packet_index = if packet_index < 0 { 0 } else { packet_index as u64 };
    let max_packets = if max_packets < 0 { 0 } else { max_packets as usize };

    let resp = with_state(|state| core_buf::read_tx_since(&state.buffer, packet_index, max_packets));

    let Some(data_array) = make_byte_array(&mut env, &resp.data) else {
        return std::ptr::null_mut();
    };
    let Some(ts_array) = make_long_array(&mut env, &resp.ts_ms) else {
        return std::ptr::null_mut();
    };
    let Some(next_obj) = make_long_object(&mut env, resp.next_packet_index) else {
        return std::ptr::null_mut();
    };
    let Some(avail_obj) = make_long_object(&mut env, resp.available_packets) else {
        return std::ptr::null_mut();
    };
    let Some(result) = make_object_array(&mut env, 4) else {
        return std::ptr::null_mut();
    };

    let _ = env.set_object_array_element(&result, 0, data_array);
    let _ = env.set_object_array_element(&result, 1, ts_array);
    let _ = env.set_object_array_element(&result, 2, next_obj);
    let _ = env.set_object_array_element(&result, 3, avail_obj);
    result.into_raw()
}

// Returns Object[] { float[] timeValues, float[] dataValues }.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_compressDataBits(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    range_start: jint,
    range_end: jint,
    number_bins: jint,
) -> jobjectArray {
    let range_start = if range_start < 0 { 0 } else { range_start as usize };
    let range_end = if range_end < 0 { 0 } else { range_end as usize };
    let number_bins = if number_bins < 0 { 0 } else { number_bins as usize };

    let bytes = with_state(|state| core_buf::rx_snapshot(&state.buffer));
    let (time_values, data_values) = sampler::compress_bits(&bytes, range_start, range_end, number_bins);

    let Some(time_array) = make_float_array(&mut env, &time_values) else {
        return std::ptr::null_mut();
    };
    let Some(data_array) = make_float_array(&mut env, &data_values) else {
        return std::ptr::null_mut();
    };
    let Some(result) = make_object_array(&mut env, 2) else {
        return std::ptr::null_mut();
    };
    let _ = env.set_object_array_element(&result, 0, time_array);
    let _ = env.set_object_array_element(&result, 1, data_array);
    result.into_raw()
}

// Returns a 64B-padded packet or throws IllegalArgumentException.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_makePacket64(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    data: jbyteArray,
) -> jbyteArray {
    let Some(bytes) = bytes_from_raw(&mut env, data) else {
        return std::ptr::null_mut();
    };
    let Ok(pkt) = packet::make_packet64(&bytes) else {
        throw_illegal_argument(&mut env, "Command too large (max 64 bytes)");
        return std::ptr::null_mut();
    };

    let Some(arr) = make_byte_array(&mut env, &pkt) else {
        return std::ptr::null_mut();
    };
    arr.into_raw()
}

// Returns -1 when the packet is not a BS frame.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_parseBsStatus(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    packet64: jbyteArray,
) -> jint {
    let Some(bytes) = bytes_from_raw(&mut env, packet64) else {
        return -1;
    };
    status::parse_bs(&bytes).map(|v| v as jint).unwrap_or(-1)
}

// Internal: returns Object[] { byte[] rxBytes, long[] rxTsMs, long rxCounter }.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_takeRxState(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
) -> jobjectArray {
    let (rx_bytes, rx_ts, rx_counter) = with_state(|state| {
        (
            std::mem::take(&mut state.buffer.rx_bytes),
            std::mem::take(&mut state.buffer.rx_ts_ms),
            state.buffer.rx_counter,
        )
    });

    let Some(bytes_arr) = make_byte_array(&mut env, &rx_bytes) else {
        return std::ptr::null_mut();
    };
    let Some(ts_arr) = make_long_array(&mut env, &rx_ts) else {
        return std::ptr::null_mut();
    };
    let Some(counter_obj) = make_long_object(&mut env, rx_counter) else {
        return std::ptr::null_mut();
    };
    let Some(result) = make_object_array(&mut env, 3) else {
        return std::ptr::null_mut();
    };
    let _ = env.set_object_array_element(&result, 0, bytes_arr);
    let _ = env.set_object_array_element(&result, 1, ts_arr);
    let _ = env.set_object_array_element(&result, 2, counter_obj);
    result.into_raw()
}

// Internal: restores the state returned from takeRxState.
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_restoreRxState(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    rx_bytes: jbyteArray,
    rx_ts_ms: jlongArray,
    rx_counter: jlong,
) {
    let Some(bytes) = bytes_from_raw(&mut env, rx_bytes) else {
        return;
    };
    let ts = u64s_from_raw_long_array(&mut env, rx_ts_ms);

    with_state(|state| {
        state.buffer.rx_bytes = bytes;
        state.buffer.rx_ts_ms = ts;

        let packets = core_buf::rx_packet_count(&state.buffer);
        if state.buffer.rx_ts_ms.len() < packets as usize {
            state.buffer.rx_ts_ms.resize(packets as usize, 0);
        } else if state.buffer.rx_ts_ms.len() > packets as usize {
            state.buffer.rx_ts_ms.truncate(packets as usize);
        }

        let desired = if rx_counter < 0 { 0 } else { rx_counter as u64 };
        state.buffer.rx_counter = desired.min(packets);
    });
}
