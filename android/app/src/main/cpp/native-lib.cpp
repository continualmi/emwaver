#include <jni.h>
#include <string>
#include <vector>
#include <android/log.h>

// Forward declaration for main in EncodeIR.cpp
int main(int argc, char** argv);

// Define these macros for easier logging
#define TAG "NATIVELib"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

// Single unified buffer
std::vector<char> ble_buffer;

bool ble_isNewCommandAvailable = false;

extern "C" {

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_clearBuffer(JNIEnv *env, jobject) {
    ble_buffer.clear();
}

JNIEXPORT jint JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_getBufferLength(JNIEnv *env, jobject) {
    return static_cast<jint>(ble_buffer.size());
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_loadBuffer(JNIEnv *env, jobject, jbyteArray data) {
    if (data) {
        jsize dataSize = env->GetArrayLength(data);
        jbyte* dataBytes = env->GetByteArrayElements(data, 0);

        ble_buffer.clear();
        ble_buffer.insert(ble_buffer.end(), dataBytes, dataBytes + dataSize);

        env->ReleaseByteArrayElements(data, dataBytes, 0);
    }
}

JNIEXPORT jbyteArray JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_getBuffer(JNIEnv *env, jobject) {
    if (ble_buffer.empty()) {
        return nullptr;
    }

    jbyteArray javaArray = env->NewByteArray(ble_buffer.size());
    env->SetByteArrayRegion(javaArray, 0, ble_buffer.size(), reinterpret_cast<const jbyte*>(ble_buffer.data()));
    return javaArray;
}

JNIEXPORT void JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_storeBulkPkt(JNIEnv *env, jobject, jbyteArray data) {
    jbyte* bufferPtr = env->GetByteArrayElements(data, nullptr);
    jsize lengthOfArray = env->GetArrayLength(data);

    ble_buffer.insert(ble_buffer.end(), bufferPtr, bufferPtr + lengthOfArray);
    ble_isNewCommandAvailable = true;

    env->ReleaseByteArrayElements(data, bufferPtr, JNI_ABORT);
}

JNIEXPORT jbyteArray JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_getCommand(JNIEnv *env, jobject) {
    if (!ble_isNewCommandAvailable) {
        return env->NewByteArray(0);
    }

    jbyteArray returnArray = env->NewByteArray(ble_buffer.size());
    env->SetByteArrayRegion(returnArray, 0, ble_buffer.size(), reinterpret_cast<const jbyte*>(ble_buffer.data()));

    ble_buffer.clear();
    ble_isNewCommandAvailable = false;

    return returnArray;
}

JNIEXPORT jint JNICALL Java_com_emwaver_emwaverandroidapp_BLEService_getStatusNumber(JNIEnv *env, jobject) {
    const std::string HEADER = "BS";
    const size_t HEADER_SIZE = HEADER.size();
    const size_t STATUS_SIZE = 2;

    for (size_t i = ble_buffer.size(); i >= HEADER_SIZE + STATUS_SIZE; --i) {
        std::string currentHeader(ble_buffer.begin() + i - HEADER_SIZE - STATUS_SIZE, ble_buffer.begin() + i - STATUS_SIZE);
        if (currentHeader == "BS") {
            uint16_t status = (static_cast<uint8_t>(ble_buffer[i - STATUS_SIZE]) << 8) | static_cast<uint8_t>(ble_buffer[i - STATUS_SIZE + 1]);
            
            ble_buffer.erase(ble_buffer.begin() + (i - HEADER_SIZE - STATUS_SIZE), ble_buffer.end());
            
            return static_cast<jint>(status);
        }
    }

    return -1;
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
            if (byteIndex < ble_buffer.size()) {
                uint8_t bit = (ble_buffer[byteIndex] >> bitIndex) & 1;
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
                if (byteIndex < ble_buffer.size()) {
                    uint8_t bit = (ble_buffer[byteIndex] >> bitIndex) & 1;
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
    for (size_t i = 0; i < ble_buffer.size(); ++i) {
        ble_buffer[i] = ~ble_buffer[i];  // Bitwise NOT operation inverts all bits
    }
}

JNIEXPORT jfloatArray JNICALL Java_com_emwaver_emwaverandroidapp_Utils_encodeIR(JNIEnv *env, jobject obj, jstring protocol, jint device, jint subdevice, jint function) {
    const char* nativeProtocol = env->GetStringUTFChars(protocol, 0);

    char arg1[1024], arg2[50], arg3[50], arg4[50];
    strcpy(arg1, nativeProtocol);
    sprintf(arg2, "%d", device);
    sprintf(arg3, "%d", subdevice);
    sprintf(arg4, "%d", function);

    const char* argv[] = { "encodeir", arg1, arg2, arg3, arg4 };
    int argc = 5;

    int result = main(argc, (char**)argv);
    if (result != 0) {
        env->ReleaseStringUTFChars(protocol, nativeProtocol);
        return NULL;
    }

    extern float seq[];
    extern int seq_size;
    jfloatArray jResult = env->NewFloatArray(seq_size);
    if (jResult == NULL) {
        env->ReleaseStringUTFChars(protocol, nativeProtocol);
        return NULL;
    }
    env->SetFloatArrayRegion(jResult, 0, seq_size, seq);

    env->ReleaseStringUTFChars(protocol, nativeProtocol);

    return jResult;
}

} 