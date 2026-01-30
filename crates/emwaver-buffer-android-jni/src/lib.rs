/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

use emwaver_buffer_core::{buffer as core_buf, packet, sampler, status, tx};
use jni::{
    objects::{JByteArray, JClass, JLongArray, JObject, JValue},
    sys::{jbyteArray, jint, jintArray, jlong, jlongArray, jobjectArray},
    JNIEnv,
};
use std::sync::{Mutex, OnceLock};

struct State {
    buffer: core_buf::Buffer,
}

static STATE: OnceLock<Mutex<State>> = OnceLock::new();

fn with_state<R>(f: impl FnOnce(&mut State) -> R) -> R {
    let mutex = STATE.get_or_init(|| {
        Mutex::new(State {
            buffer: core_buf::Buffer::default(),
        })
    });
    let mut guard = mutex.lock().expect("buffer state lock poisoned");
    f(&mut *guard)
}

fn now_ms_from_java(ts_ms: jlong) -> u64 {
    if ts_ms < 0 {
        0
    } else {
        ts_ms as u64
    }
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

fn make_int_array<'a>(
    env: &mut JNIEnv<'a>,
    values: &[jint],
) -> Option<jni::objects::JIntArray<'a>> {
    let Ok(out) = env.new_int_array(values.len() as i32) else {
        return None;
    };
    if !values.is_empty() {
        if env.set_int_array_region(&out, 0, values).is_err() {
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

fn make_object_array<'a>(env: &mut JNIEnv<'a>, len: i32) -> Option<jni::objects::JObjectArray<'a>> {
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
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_setInvertRx(
    _env: JNIEnv<'_>,
    _class: JClass<'_>,
    enabled: jni::sys::jboolean,
) {
    let enabled = enabled != 0;
    with_state(|state| core_buf::set_invert_rx(&mut state.buffer, enabled));
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

// Returns Object[] { byte[] packet, Long tsMs } or null if no packet is available.
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
    let packet_index = if packet_index < 0 {
        0
    } else {
        packet_index as u64
    };
    let max_packets = if max_packets < 0 {
        0
    } else {
        max_packets as usize
    };

    let resp =
        with_state(|state| core_buf::read_rx_since(&state.buffer, packet_index, max_packets));

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
    let packet_index = if packet_index < 0 {
        0
    } else {
        packet_index as u64
    };
    let max_packets = if max_packets < 0 {
        0
    } else {
        max_packets as usize
    };

    let resp =
        with_state(|state| core_buf::read_tx_since(&state.buffer, packet_index, max_packets));

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
    let range_start = if range_start < 0 {
        0
    } else {
        range_start as usize
    };
    let range_end = if range_end < 0 { 0 } else { range_end as usize };
    let number_bins = if number_bins < 0 {
        0
    } else {
        number_bins as usize
    };

    let bytes = with_state(|state| core_buf::rx_snapshot(&state.buffer));
    let (time_values, data_values) =
        sampler::compress_bits(&bytes, range_start, range_end, number_bins);

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

// Returns an 18B-padded packet or throws IllegalArgumentException.
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
        throw_illegal_argument(
            &mut env,
            &format!("Command too large (max {} bytes)", packet::PACKET_SIZE),
        );
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

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_txBleProfile(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
) -> jintArray {
    let p = tx::BleTxProfile::default();
    let values: [jint; 11] = [
        p.max_packet_size as jint,
        p.min_packet_size as jint,
        p.initial_packet_size as jint,
        p.fixed_delay_ms as jint,
        p.target_buffer_level as jint,
        p.buffer_high_threshold as jint,
        p.buffer_low_threshold as jint,
        p.initial_fill_bytes as jint,
        p.nudge_band as jint,
        p.step_large as jint,
        p.step_small as jint,
    ];

    make_int_array(&mut env, &values)
        .map(|arr| arr.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_txBleNextPacketSize(
    _env: JNIEnv<'_>,
    _class: JClass<'_>,
    bytes_sent: jint,
    last_status: jint,
    current_packet_size: jint,
) -> jint {
    let bytes_sent = if bytes_sent < 0 {
        0
    } else {
        bytes_sent as usize
    };
    let current_packet_size = if current_packet_size < 0 {
        0
    } else {
        current_packet_size as usize
    };

    tx::ble_next_packet_size(
        tx::BleTxProfile::default(),
        bytes_sent,
        last_status as i32,
        current_packet_size,
    ) as jint
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_txUsbProfile(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
) -> jintArray {
    let p = tx::UsbTxProfile::default();
    let values: [jint; 5] = [
        p.packet_size as jint,
        p.period_ns as jint,
        p.flow_time_delta_ns as jint,
        p.buffer_high_threshold as jint,
        p.buffer_low_threshold as jint,
    ];

    make_int_array(&mut env, &values)
        .map(|arr| arr.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_emwaver_emwaverandroidapp_NativeBuffer_txUsbAdjustDeadlineNs(
    _env: JNIEnv<'_>,
    _class: JClass<'_>,
    deadline_ns: jlong,
    last_status: jint,
) -> jlong {
    let deadline_ns = deadline_ns as i64;
    tx::usb_adjust_deadline_ns(tx::UsbTxProfile::default(), deadline_ns, last_status as i32)
        as jlong
}
