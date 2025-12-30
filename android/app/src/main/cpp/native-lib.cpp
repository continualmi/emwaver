#include <jni.h>
#include <string>
#include <vector>
#include <android/log.h>
#include <algorithm>
#include <cstdint>

// Define these macros for easier logging
#define TAG "NATIVELib"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

static constexpr size_t PACKET_SIZE = 64;

// Desktop-parity buffer model:
// - RX bytes are append-only; notification boundaries are not preserved.
// - RX packet timestamps are per completed 64B packet.
// - TX bytes are logged as flattened padded 64B packets, with per-packet timestamps.
//
// Android keeps a separate byte cursor for getCommand() to preserve existing behavior.
static std::vector<uint8_t> rx_bytes;
static uint64_t rx_counter_packets = 0;
static std::vector<uint64_t> rx_ts_ms;

static std::vector<uint8_t> tx_bytes;
static std::vector<uint64_t> tx_ts_ms;

static size_t command_cursor_bytes = 0;
static size_t status_offset = 0;
static bool capture_mode = false;
static bool capture_invert = false;

static inline uint64_t rx_packet_count() {
    return static_cast<uint64_t>(rx_bytes.size() / PACKET_SIZE);
}

static inline uint64_t tx_packet_count() {
    return static_cast<uint64_t>(tx_ts_ms.size());
}

static void append_rx_bytes_with_ts(const uint8_t* data, size_t len, uint64_t ts_ms) {
    if (data == nullptr || len == 0) {
        return;
    }

    const uint64_t prev_packets = rx_packet_count();

    rx_bytes.reserve(rx_bytes.size() + len);
    if (capture_mode && capture_invert) {
        for (size_t i = 0; i < len; i++) {
            rx_bytes.push_back(static_cast<uint8_t>(~data[i]));
        }
    } else {
        rx_bytes.insert(rx_bytes.end(), data, data + len);
    }

    const uint64_t new_packets = rx_packet_count();
    const uint64_t delta = (new_packets > prev_packets) ? (new_packets - prev_packets) : 0;
    if (delta > 0) {
        rx_ts_ms.insert(rx_ts_ms.end(), static_cast<size_t>(delta), ts_ms);
    }
}

static void append_tx_bytes_with_ts(const uint8_t* data, size_t len, uint64_t ts_ms) {
    if (data == nullptr || len == 0) {
        return;
    }

    const size_t packet_count = (len + PACKET_SIZE - 1) / PACKET_SIZE;
    tx_bytes.reserve(tx_bytes.size() + packet_count * PACKET_SIZE);
    tx_ts_ms.reserve(tx_ts_ms.size() + packet_count);

    for (size_t offset = 0; offset < len; offset += PACKET_SIZE) {
        const size_t take = std::min(PACKET_SIZE, len - offset);
        uint8_t packet[PACKET_SIZE] = {0};
        std::copy(data + offset, data + offset + take, packet);
        tx_bytes.insert(tx_bytes.end(), packet, packet + PACKET_SIZE);
        tx_ts_ms.push_back(ts_ms);
    }
}

extern "C" {

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_clearBuffer(JNIEnv *env, jclass) {
    rx_bytes.clear();
    rx_counter_packets = 0;
    rx_ts_ms.clear();
    command_cursor_bytes = 0;
    status_offset = 0;
}

JNIEXPORT jint JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_getBufferLength(JNIEnv *env, jclass) {
    return static_cast<jint>(rx_bytes.size());
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_loadBuffer(JNIEnv *env, jclass, jbyteArray data) {
    if (data) {
        jsize dataSize = env->GetArrayLength(data);
        jbyte* dataBytes = env->GetByteArrayElements(data, 0);

        rx_bytes.clear();
        rx_bytes.insert(rx_bytes.end(), reinterpret_cast<uint8_t*>(dataBytes), reinterpret_cast<uint8_t*>(dataBytes) + dataSize);
        rx_counter_packets = 0;
        rx_ts_ms.assign(static_cast<size_t>(rx_packet_count()), 0ULL);
        command_cursor_bytes = 0;
        status_offset = 0;

        env->ReleaseByteArrayElements(data, dataBytes, 0);
    }
}

JNIEXPORT jbyteArray JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_getBuffer(JNIEnv *env, jclass) {
    jbyteArray javaArray = env->NewByteArray(rx_bytes.size());
    if (!rx_bytes.empty()) {
        env->SetByteArrayRegion(javaArray, 0, rx_bytes.size(), reinterpret_cast<const jbyte*>(rx_bytes.data()));
    }
    return javaArray;
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_storeBulkPkt(JNIEnv *env, jclass, jbyteArray data, jlong tsMs) {
    jbyte* bufferPtr = env->GetByteArrayElements(data, nullptr);
    jsize lengthOfArray = env->GetArrayLength(data);

    append_rx_bytes_with_ts(reinterpret_cast<uint8_t*>(bufferPtr), static_cast<size_t>(lengthOfArray), static_cast<uint64_t>(tsMs));

    env->ReleaseByteArrayElements(data, bufferPtr, JNI_ABORT);
}

JNIEXPORT jbyteArray JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_getCommand(JNIEnv *env, jclass) {
    if (command_cursor_bytes >= rx_bytes.size()) {
        return env->NewByteArray(0);
    }

    const size_t bytes_available = rx_bytes.size() - command_cursor_bytes;
    jbyteArray returnArray = env->NewByteArray(bytes_available);
    if (bytes_available > 0) {
        env->SetByteArrayRegion(
            returnArray,
            0,
            bytes_available,
            reinterpret_cast<const jbyte*>(rx_bytes.data() + command_cursor_bytes)
        );
    }

    command_cursor_bytes = rx_bytes.size();

    return returnArray;
}

JNIEXPORT jint JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_getStatusNumber(JNIEnv *env, jclass) {
    const std::string HEADER = "BS";
    const size_t HEADER_SIZE = HEADER.size();
    const size_t STATUS_SIZE = 2;

    if (rx_bytes.size() < HEADER_SIZE + STATUS_SIZE || status_offset >= rx_bytes.size()) {
        return -1;
    }

    const size_t search_end = rx_bytes.size() - (HEADER_SIZE + STATUS_SIZE) + 1;
    for (size_t i = status_offset; i < search_end; ++i) {
        if (rx_bytes[i] == 'B' && rx_bytes[i + 1] == 'S') {
            const size_t status_index = i + HEADER_SIZE;
            uint16_t status = (static_cast<uint8_t>(rx_bytes[status_index]) << 8)
                | static_cast<uint8_t>(rx_bytes[status_index + 1]);
            status_offset = status_index + STATUS_SIZE;
            return static_cast<jint>(status);
        }
    }

    return -1;
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_clearCommandBuffer(JNIEnv *env, jclass) {
    rx_bytes.clear();
    rx_counter_packets = 0;
    rx_ts_ms.clear();
    command_cursor_bytes = 0;
    status_offset = 0;
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_setCaptureMode(JNIEnv *env, jclass, jboolean enabled) {
    capture_mode = (enabled == JNI_TRUE);
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_setCaptureInvert(JNIEnv *env, jclass, jboolean enabled) {
    capture_invert = (enabled == JNI_TRUE);
}

JNIEXPORT jobjectArray JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_compressDataBits(JNIEnv *env, jclass, jint rangeStart, jint rangeEnd, jint numberBins) {
    float timePerSample = 1.0f;
    float totalPointsInRange = (rangeEnd - rangeStart) / timePerSample;
    std::vector<float> timeValues;
    std::vector<float> dataValues;

    jclass floatArrayClass = env->FindClass("[F");
    jobjectArray result = env->NewObjectArray(2, floatArrayClass, nullptr);

    if (totalPointsInRange <= numberBins * 2) {
        for (int i = rangeStart; i < rangeEnd; ++i) {
            int byteIndex = i / 8;
            int bitIndex = i % 8;
            if (byteIndex < static_cast<int>(rx_bytes.size())) {
                uint8_t bit = (rx_bytes[byteIndex] >> bitIndex) & 1;
                timeValues.push_back(static_cast<float>(i * timePerSample));
                dataValues.push_back(bit ? 255.0f : 0.0f);
            }
        }
    } else {
        float binWidth = totalPointsInRange / static_cast<float>(numberBins);
        for (int bin = 0; bin < numberBins; ++bin) {
            int binStart = static_cast<int>(rangeStart + bin * binWidth);
            int binEnd = std::min(static_cast<int>(binStart + binWidth), rangeEnd);

            bool foundData = false;
            float minVal = 255.0f;
            float maxVal = 0.0f;

            for (int i = binStart; i < binEnd; ++i) {
                int byteIndex = i / 8;
                int bitIndex = i % 8;
                if (byteIndex < static_cast<int>(rx_bytes.size())) {
                    uint8_t bit = (rx_bytes[byteIndex] >> bitIndex) & 1;
                    float value = bit ? 255.0f : 0.0f;
                    minVal = std::min(minVal, value);
                    maxVal = std::max(maxVal, value);
                    foundData = true;
                }
            }

            if (foundData) {
                timeValues.push_back(static_cast<float>(binStart * timePerSample));
                dataValues.push_back(minVal);
                timeValues.push_back(static_cast<float>((binEnd - 1) * timePerSample));
                dataValues.push_back(maxVal);
            }
        }
    }

    jfloatArray timeArray = env->NewFloatArray(timeValues.size());
    jfloatArray dataArray = env->NewFloatArray(dataValues.size());
    env->SetFloatArrayRegion(timeArray, 0, timeValues.size(), timeValues.data());
    env->SetFloatArrayRegion(dataArray, 0, dataValues.size(), dataValues.data());

    env->SetObjectArrayElement(result, 0, timeArray);
    env->SetObjectArrayElement(result, 1, dataArray);

    env->DeleteLocalRef(timeArray);
    env->DeleteLocalRef(dataArray);

    return result;
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_invertBuffer(JNIEnv *env, jclass) {
    for (size_t i = 0; i < rx_bytes.size(); ++i) {
        rx_bytes[i] = ~rx_bytes[i];  // Bitwise NOT operation inverts all bits
    }
}

JNIEXPORT jobjectArray JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_readRxSince(JNIEnv *env, jclass, jlong packetIndex, jint maxPackets) {
    const uint64_t available = rx_packet_count();
    const uint64_t index = packetIndex < 0 ? 0 : static_cast<uint64_t>(packetIndex);
    const uint64_t bounded_index = std::min(index, available);

    uint64_t take = 0;
    if (maxPackets > 0 && bounded_index < available) {
        take = std::min<uint64_t>(available - bounded_index, static_cast<uint64_t>(maxPackets));
    }

    const size_t byte_start = static_cast<size_t>(bounded_index * PACKET_SIZE);
    const size_t byte_end = byte_start + static_cast<size_t>(take * PACKET_SIZE);

    jbyteArray dataArray = env->NewByteArray(static_cast<jsize>(take * PACKET_SIZE));
    if (take > 0 && byte_end <= rx_bytes.size()) {
        env->SetByteArrayRegion(dataArray, 0, static_cast<jsize>(take * PACKET_SIZE), reinterpret_cast<const jbyte*>(rx_bytes.data() + byte_start));
    }

    jlongArray tsArray = env->NewLongArray(static_cast<jsize>(take));
    if (take > 0) {
        std::vector<jlong> tmp;
        tmp.reserve(static_cast<size_t>(take));
        for (uint64_t i = 0; i < take; i++) {
            const size_t ts_index = static_cast<size_t>(bounded_index + i);
            tmp.push_back(static_cast<jlong>(ts_index < rx_ts_ms.size() ? rx_ts_ms[ts_index] : 0ULL));
        }
        env->SetLongArrayRegion(tsArray, 0, static_cast<jsize>(take), tmp.data());
    }

    jclass objectClass = env->FindClass("java/lang/Object");
    jobjectArray result = env->NewObjectArray(4, objectClass, nullptr);
    env->SetObjectArrayElement(result, 0, dataArray);
    env->SetObjectArrayElement(result, 1, tsArray);
    env->SetObjectArrayElement(result, 2, env->NewObject(env->FindClass("java/lang/Long"), env->GetMethodID(env->FindClass("java/lang/Long"), "<init>", "(J)V"), static_cast<jlong>(bounded_index + take)));
    env->SetObjectArrayElement(result, 3, env->NewObject(env->FindClass("java/lang/Long"), env->GetMethodID(env->FindClass("java/lang/Long"), "<init>", "(J)V"), static_cast<jlong>(available)));

    env->DeleteLocalRef(dataArray);
    env->DeleteLocalRef(tsArray);

    return result;
}

JNIEXPORT jobjectArray JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_readTxSince(JNIEnv *env, jclass, jlong packetIndex, jint maxPackets) {
    const uint64_t available = tx_packet_count();
    const uint64_t index = packetIndex < 0 ? 0 : static_cast<uint64_t>(packetIndex);
    const uint64_t bounded_index = std::min(index, available);

    uint64_t take = 0;
    if (maxPackets > 0 && bounded_index < available) {
        take = std::min<uint64_t>(available - bounded_index, static_cast<uint64_t>(maxPackets));
    }

    const size_t byte_start = static_cast<size_t>(bounded_index * PACKET_SIZE);
    const size_t byte_end = byte_start + static_cast<size_t>(take * PACKET_SIZE);

    jbyteArray dataArray = env->NewByteArray(static_cast<jsize>(take * PACKET_SIZE));
    if (take > 0 && byte_end <= tx_bytes.size()) {
        env->SetByteArrayRegion(dataArray, 0, static_cast<jsize>(take * PACKET_SIZE), reinterpret_cast<const jbyte*>(tx_bytes.data() + byte_start));
    }

    jlongArray tsArray = env->NewLongArray(static_cast<jsize>(take));
    if (take > 0) {
        std::vector<jlong> tmp;
        tmp.reserve(static_cast<size_t>(take));
        for (uint64_t i = 0; i < take; i++) {
            const size_t ts_index = static_cast<size_t>(bounded_index + i);
            tmp.push_back(static_cast<jlong>(ts_index < tx_ts_ms.size() ? tx_ts_ms[ts_index] : 0ULL));
        }
        env->SetLongArrayRegion(tsArray, 0, static_cast<jsize>(take), tmp.data());
    }

    jclass objectClass = env->FindClass("java/lang/Object");
    jobjectArray result = env->NewObjectArray(4, objectClass, nullptr);
    env->SetObjectArrayElement(result, 0, dataArray);
    env->SetObjectArrayElement(result, 1, tsArray);
    env->SetObjectArrayElement(result, 2, env->NewObject(env->FindClass("java/lang/Long"), env->GetMethodID(env->FindClass("java/lang/Long"), "<init>", "(J)V"), static_cast<jlong>(bounded_index + take)));
    env->SetObjectArrayElement(result, 3, env->NewObject(env->FindClass("java/lang/Long"), env->GetMethodID(env->FindClass("java/lang/Long"), "<init>", "(J)V"), static_cast<jlong>(available)));

    env->DeleteLocalRef(dataArray);
    env->DeleteLocalRef(tsArray);

    return result;
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_appendTxBytes(JNIEnv *env, jclass, jbyteArray data, jlong tsMs) {
    if (!data) {
        return;
    }
    jbyte* bufferPtr = env->GetByteArrayElements(data, nullptr);
    jsize lengthOfArray = env->GetArrayLength(data);
    append_tx_bytes_with_ts(reinterpret_cast<uint8_t*>(bufferPtr), static_cast<size_t>(lengthOfArray), static_cast<uint64_t>(tsMs));
    env->ReleaseByteArrayElements(data, bufferPtr, JNI_ABORT);
}

} 
