#include <jni.h>
#include <string>
#include <vector>
#include <android/log.h>

// Define these macros for easier logging
#define TAG "NATIVELib"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

// Single buffer strategy: everything lands in rx_buffer.
// buffer_counter tracks how much data has been consumed by getCommand.
static std::vector<char> rx_buffer;
static size_t buffer_counter = 0;
static size_t status_offset = 0;
static bool capture_mode = false;
static bool capture_invert = false;

extern "C" {

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_clearBuffer(JNIEnv *env, jclass) {
    rx_buffer.clear();
    buffer_counter = 0;
    status_offset = 0;
}

JNIEXPORT jint JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_getBufferLength(JNIEnv *env, jclass) {
    return static_cast<jint>(rx_buffer.size());
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_loadBuffer(JNIEnv *env, jclass, jbyteArray data) {
    if (data) {
        jsize dataSize = env->GetArrayLength(data);
        jbyte* dataBytes = env->GetByteArrayElements(data, 0);

        rx_buffer.clear();
        rx_buffer.insert(rx_buffer.end(), dataBytes, dataBytes + dataSize);
        buffer_counter = 0;
        status_offset = 0;

        env->ReleaseByteArrayElements(data, dataBytes, 0);
    }
}

JNIEXPORT jbyteArray JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_getBuffer(JNIEnv *env, jclass) {
    jbyteArray javaArray = env->NewByteArray(rx_buffer.size());
    if (!rx_buffer.empty()) {
        env->SetByteArrayRegion(javaArray, 0, rx_buffer.size(), reinterpret_cast<const jbyte*>(rx_buffer.data()));
    }
    return javaArray;
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_storeBulkPkt(JNIEnv *env, jclass, jbyteArray data) {
    jbyte* bufferPtr = env->GetByteArrayElements(data, nullptr);
    jsize lengthOfArray = env->GetArrayLength(data);

    if (capture_mode && capture_invert) {
        rx_buffer.reserve(rx_buffer.size() + static_cast<size_t>(lengthOfArray));
        for (jsize i = 0; i < lengthOfArray; i++) {
            const uint8_t v = static_cast<uint8_t>(bufferPtr[i]);
            rx_buffer.push_back(static_cast<char>(~v));
        }
    } else {
        rx_buffer.insert(rx_buffer.end(), bufferPtr, bufferPtr + lengthOfArray);
    }

    env->ReleaseByteArrayElements(data, bufferPtr, JNI_ABORT);
}

JNIEXPORT jbyteArray JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_getCommand(JNIEnv *env, jclass) {
    if (buffer_counter >= rx_buffer.size()) {
        return env->NewByteArray(0);
    }

    const size_t bytes_available = rx_buffer.size() - buffer_counter;
    jbyteArray returnArray = env->NewByteArray(bytes_available);
    if (bytes_available > 0) {
        env->SetByteArrayRegion(
            returnArray,
            0,
            bytes_available,
            reinterpret_cast<const jbyte*>(rx_buffer.data() + buffer_counter)
        );
    }

    buffer_counter = rx_buffer.size();

    return returnArray;
}

JNIEXPORT jint JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_getStatusNumber(JNIEnv *env, jclass) {
    const std::string HEADER = "BS";
    const size_t HEADER_SIZE = HEADER.size();
    const size_t STATUS_SIZE = 2;

    if (rx_buffer.size() < HEADER_SIZE + STATUS_SIZE || status_offset >= rx_buffer.size()) {
        return -1;
    }

    const size_t search_end = rx_buffer.size() - (HEADER_SIZE + STATUS_SIZE) + 1;
    for (size_t i = status_offset; i < search_end; ++i) {
        if (rx_buffer[i] == 'B' && rx_buffer[i + 1] == 'S') {
            const size_t status_index = i + HEADER_SIZE;
            uint16_t status = (static_cast<uint8_t>(rx_buffer[status_index]) << 8)
                | static_cast<uint8_t>(rx_buffer[status_index + 1]);
            status_offset = status_index + STATUS_SIZE;
            return static_cast<jint>(status);
        }
    }

    return -1;
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_NativeBuffer_clearCommandBuffer(JNIEnv *env, jclass) {
    rx_buffer.clear();
    buffer_counter = 0;
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
            if (byteIndex < rx_buffer.size()) {
                uint8_t bit = (rx_buffer[byteIndex] >> bitIndex) & 1;
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
                if (byteIndex < rx_buffer.size()) {
                    uint8_t bit = (rx_buffer[byteIndex] >> bitIndex) & 1;
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
    for (size_t i = 0; i < rx_buffer.size(); ++i) {
        rx_buffer[i] = ~rx_buffer[i];  // Bitwise NOT operation inverts all bits
    }
}

} 
