package com.emwaver.emwaverandroidapp.ui.packetmode;

import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;

import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;

public class PacketModeViewModel extends ViewModel {

    private final MutableLiveData<String> mText;

    private Queue<Byte> responseQueue = new ConcurrentLinkedQueue<>();

    public PacketModeViewModel() {
        mText = new MutableLiveData<>();
        mText.setValue("receive mode");

    }

    public LiveData<String> getText() {
        return mText;
    }

    public void addResponseByte(Byte responseByte) {
        responseQueue.add(responseByte);
    }
    // Method to retrieve and clear data from the queue
    public byte[] getAndClearResponse(int expectedSize) {
        byte[] response = new byte[expectedSize];
        for (int i = 0; i < expectedSize; i++) {
            response[i] = responseQueue.poll(); // or handle nulls if necessary
        }
        return response;
    }

    public int getResponseQueueSize() {
        return responseQueue.size();
    }

}
