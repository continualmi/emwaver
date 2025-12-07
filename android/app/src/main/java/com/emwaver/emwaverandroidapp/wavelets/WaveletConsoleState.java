package com.emwaver.emwaverandroidapp.wavelets;

import androidx.annotation.NonNull;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class WaveletConsoleState {
    private static final WaveletConsoleState INSTANCE = new WaveletConsoleState();

    private final Object lock = new Object();
    private final ArrayList<String> lines = new ArrayList<>();
    private final MutableLiveData<List<String>> liveData = new MutableLiveData<>(Collections.emptyList());
    private int limit = 500;

    private WaveletConsoleState() {
    }

    @NonNull
    public static WaveletConsoleState getInstance() {
        return INSTANCE;
    }

    @NonNull
    public LiveData<List<String>> observe() {
        return liveData;
    }

    @NonNull
    public List<String> snapshot() {
        synchronized (lock) {
            return new ArrayList<>(lines);
        }
    }

    public void append(@NonNull String message) {
        synchronized (lock) {
            lines.add(message);
            trimLocked();
            publishLocked();
        }
    }

    public void clear() {
        synchronized (lock) {
            lines.clear();
            publishLocked();
        }
    }

    public int setLimit(int requested) {
        if (requested <= 0) {
            return getLimit();
        }
        synchronized (lock) {
            limit = requested;
            trimLocked();
            publishLocked();
            return limit;
        }
    }

    public int getLimit() {
        synchronized (lock) {
            return limit;
        }
    }

    private void trimLocked() {
        if (lines.size() <= limit) {
            return;
        }
        int overflow = lines.size() - limit;
        lines.subList(0, overflow).clear();
    }

    private void publishLocked() {
        liveData.postValue(new ArrayList<>(lines));
    }
}
