#include <jni.h>
#include <string>
#include <vector>
#include <android/log.h>

// Define these macros for easier logging
#define TAG "NATIVELib"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

// Keep sampled data (used by sampler UI / retransmit) separate from
// command/status traffic (used by console + flow control).
static std::vector<char> sample_buffer;
static std::vector<char> rx_buffer;

static bool rx_isNewCommandAvailable = false;
static bool capture_mode = false;

extern "C" {

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_clearBuffer(JNIEnv *env, jobject) {
    sample_buffer.clear();
}

JNIEXPORT jint JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_getBufferLength(JNIEnv *env, jobject) {
    return static_cast<jint>(sample_buffer.size());
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_loadBuffer(JNIEnv *env, jobject, jbyteArray data) {
    if (data) {
        jsize dataSize = env->GetArrayLength(data);
        jbyte* dataBytes = env->GetByteArrayElements(data, 0);

        sample_buffer.clear();
        sample_buffer.insert(sample_buffer.end(), dataBytes, dataBytes + dataSize);

        env->ReleaseByteArrayElements(data, dataBytes, 0);
    }
}

JNIEXPORT jbyteArray JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_getBuffer(JNIEnv *env, jobject) {
    jbyteArray javaArray = env->NewByteArray(sample_buffer.size());
    if (!sample_buffer.empty()) {
        env->SetByteArrayRegion(javaArray, 0, sample_buffer.size(), reinterpret_cast<const jbyte*>(sample_buffer.data()));
    }
    return javaArray;
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_storeBulkPkt(JNIEnv *env, jobject, jbyteArray data) {
    jbyte* bufferPtr = env->GetByteArrayElements(data, nullptr);
    jsize lengthOfArray = env->GetArrayLength(data);

    if (capture_mode) {
        sample_buffer.insert(sample_buffer.end(), bufferPtr, bufferPtr + lengthOfArray);
    } else {
        rx_buffer.insert(rx_buffer.end(), bufferPtr, bufferPtr + lengthOfArray);
        rx_isNewCommandAvailable = true;
    }

    env->ReleaseByteArrayElements(data, bufferPtr, JNI_ABORT);
}

JNIEXPORT jbyteArray JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_getCommand(JNIEnv *env, jobject) {
    if (!rx_isNewCommandAvailable) {
        return env->NewByteArray(0);
    }

    jbyteArray returnArray = env->NewByteArray(rx_buffer.size());
    if (!rx_buffer.empty()) {
        env->SetByteArrayRegion(returnArray, 0, rx_buffer.size(), reinterpret_cast<const jbyte*>(rx_buffer.data()));
    }

    rx_buffer.clear();
    rx_isNewCommandAvailable = false;

    return returnArray;
}

JNIEXPORT jint JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_getStatusNumber(JNIEnv *env, jobject) {
    const std::string HEADER = "BS";
    const size_t HEADER_SIZE = HEADER.size();
    const size_t STATUS_SIZE = 2;

    for (size_t i = rx_buffer.size(); i >= HEADER_SIZE + STATUS_SIZE; --i) {
        std::string currentHeader(rx_buffer.begin() + i - HEADER_SIZE - STATUS_SIZE, rx_buffer.begin() + i - STATUS_SIZE);
        if (currentHeader == "BS") {
            uint16_t status = (static_cast<uint8_t>(rx_buffer[i - STATUS_SIZE]) << 8) | static_cast<uint8_t>(rx_buffer[i - STATUS_SIZE + 1]);
            
            rx_buffer.erase(rx_buffer.begin() + (i - HEADER_SIZE - STATUS_SIZE), rx_buffer.end());
            
            return static_cast<jint>(status);
        }
    }

    return -1;
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_clearCommandBuffer(JNIEnv *env, jobject) {
    rx_buffer.clear();
    rx_isNewCommandAvailable = false;
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_setCaptureMode(JNIEnv *env, jobject, jboolean enabled) {
    capture_mode = (enabled == JNI_TRUE);
}

JNIEXPORT jobjectArray JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_compressDataBits(JNIEnv *env, jobject, jint rangeStart, jint rangeEnd, jint numberBins) {
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
            if (byteIndex < sample_buffer.size()) {
                uint8_t bit = (sample_buffer[byteIndex] >> bitIndex) & 1;
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
                if (byteIndex < sample_buffer.size()) {
                    uint8_t bit = (sample_buffer[byteIndex] >> bitIndex) & 1;
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

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_invertBuffer(JNIEnv *env, jobject) {
    for (size_t i = 0; i < sample_buffer.size(); ++i) {
        sample_buffer[i] = ~sample_buffer[i];  // Bitwise NOT operation inverts all bits
    }
}

// USBService native methods - share the same buffer as BLEService
JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_USBService_clearBuffer(JNIEnv *env, jobject) {
    sample_buffer.clear();
}

JNIEXPORT jint JNICALL Java_com_emwaver_emwaverandroidapp_USBService_getBufferLength(JNIEnv *env, jobject) {
    return static_cast<jint>(sample_buffer.size());
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_USBService_loadBuffer(JNIEnv *env, jobject, jbyteArray data) {
    if (data) {
        jsize dataSize = env->GetArrayLength(data);
        jbyte* dataBytes = env->GetByteArrayElements(data, 0);

        sample_buffer.clear();
        sample_buffer.insert(sample_buffer.end(), dataBytes, dataBytes + dataSize);

        env->ReleaseByteArrayElements(data, dataBytes, 0);
    }
}

JNIEXPORT jbyteArray JNICALL Java_com_emwaver_emwaverandroidapp_USBService_getBuffer(JNIEnv *env, jobject) {
    jbyteArray javaArray = env->NewByteArray(sample_buffer.size());
    if (!sample_buffer.empty()) {
        env->SetByteArrayRegion(javaArray, 0, sample_buffer.size(), reinterpret_cast<const jbyte*>(sample_buffer.data()));
    }
    return javaArray;
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_USBService_storeBulkPkt(JNIEnv *env, jobject, jbyteArray data) {
    jbyte* bufferPtr = env->GetByteArrayElements(data, nullptr);
    jsize lengthOfArray = env->GetArrayLength(data);

    if (capture_mode) {
        sample_buffer.insert(sample_buffer.end(), bufferPtr, bufferPtr + lengthOfArray);
    } else {
        rx_buffer.insert(rx_buffer.end(), bufferPtr, bufferPtr + lengthOfArray);
        rx_isNewCommandAvailable = true;
    }

    env->ReleaseByteArrayElements(data, bufferPtr, JNI_ABORT);
}

JNIEXPORT jbyteArray JNICALL Java_com_emwaver_emwaverandroidapp_USBService_getCommand(JNIEnv *env, jobject) {
    if (!rx_isNewCommandAvailable) {
        return env->NewByteArray(0);
    }

    jbyteArray returnArray = env->NewByteArray(rx_buffer.size());
    if (!rx_buffer.empty()) {
        env->SetByteArrayRegion(returnArray, 0, rx_buffer.size(), reinterpret_cast<const jbyte*>(rx_buffer.data()));
    }

    rx_buffer.clear();
    rx_isNewCommandAvailable = false;

    return returnArray;
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_USBService_clearCommandBuffer(JNIEnv *env, jobject) {
    rx_buffer.clear();
    rx_isNewCommandAvailable = false;
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_USBService_setCaptureMode(JNIEnv *env, jobject, jboolean enabled) {
    capture_mode = (enabled == JNI_TRUE);
}

JNIEXPORT jint JNICALL Java_com_emwaver_emwaverandroidapp_USBService_getStatusNumber(JNIEnv *env, jobject) {
    const std::string HEADER = "BS";
    const size_t HEADER_SIZE = HEADER.size();
    const size_t STATUS_SIZE = 2;

    for (size_t i = rx_buffer.size(); i >= HEADER_SIZE + STATUS_SIZE; --i) {
        std::string currentHeader(rx_buffer.begin() + i - HEADER_SIZE - STATUS_SIZE, rx_buffer.begin() + i - STATUS_SIZE);
        if (currentHeader == "BS") {
            uint16_t status = (static_cast<uint8_t>(rx_buffer[i - STATUS_SIZE]) << 8) | static_cast<uint8_t>(rx_buffer[i - STATUS_SIZE + 1]);
            
            rx_buffer.erase(rx_buffer.begin() + (i - HEADER_SIZE - STATUS_SIZE), rx_buffer.end());
            
            return static_cast<jint>(status);
        }
    }

    return -1;
}

JNIEXPORT jobjectArray JNICALL Java_com_emwaver_emwaverandroidapp_USBService_compressDataBits(JNIEnv *env, jobject, jint rangeStart, jint rangeEnd, jint numberBins) {
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
            if (byteIndex < sample_buffer.size()) {
                uint8_t bit = (sample_buffer[byteIndex] >> bitIndex) & 1;
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
                if (byteIndex < sample_buffer.size()) {
                    uint8_t bit = (sample_buffer[byteIndex] >> bitIndex) & 1;
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

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_USBService_invertBuffer(JNIEnv *env, jobject) {
    for (size_t i = 0; i < sample_buffer.size(); ++i) {
        sample_buffer[i] = ~sample_buffer[i];  // Bitwise NOT operation inverts all bits
    }
}

} 
