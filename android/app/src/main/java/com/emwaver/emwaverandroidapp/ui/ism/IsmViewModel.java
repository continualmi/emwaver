/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.ui.ism;

import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;

import java.util.HashMap;
import java.util.Map;

public class IsmViewModel extends ViewModel {

    private final MutableLiveData<Map<String, String>> registerValues =
            new MutableLiveData<>(new HashMap<>());
    private final MutableLiveData<RfParameters> rfParameters = new MutableLiveData<>();
    private final MutableLiveData<Boolean> hasLoaded = new MutableLiveData<>(false);

    public LiveData<Map<String, String>> getRegisterValues() {
        return registerValues;
    }

    public LiveData<RfParameters> getRfParameters() {
        return rfParameters;
    }

    public LiveData<Boolean> hasLoaded() {
        return hasLoaded;
    }

    public void resetLoadingState() {
        hasLoaded.postValue(false);
    }

    public void postRegisterValue(String key, String value) {
        Map<String, String> current = registerValues.getValue();
        Map<String, String> updated = current != null ? new HashMap<>(current) : new HashMap<>();
        updated.put(key, value);
        registerValues.postValue(updated);
    }

    public void postRegisterValues(Map<String, String> values) {
        registerValues.postValue(new HashMap<>(values));
    }

    public void clearRegisterValues() {
        registerValues.postValue(new HashMap<>());
    }

    public void clearRfParameters() {
        rfParameters.postValue(null);
    }

    public void postRfParameters(double frequencyMHz,
                                 int dataRate,
                                 double bandwidthKHz,
                                 int deviationHz,
                                 int modulation,
                                 int txPowerDbm) {
        rfParameters.postValue(new RfParameters(frequencyMHz, dataRate, bandwidthKHz,
                deviationHz, modulation, txPowerDbm));
    }

    public void setLoaded(boolean loaded) {
        hasLoaded.postValue(loaded);
    }

    public static class RfParameters {
        private final double frequencyMHz;
        private final int dataRate;
        private final double bandwidthKHz;
        private final int deviationHz;
        private final int modulation;
        private final int txPowerDbm;

        RfParameters(double frequencyMHz,
                     int dataRate,
                     double bandwidthKHz,
                     int deviationHz,
                     int modulation,
                     int txPowerDbm) {
            this.frequencyMHz = frequencyMHz;
            this.dataRate = dataRate;
            this.bandwidthKHz = bandwidthKHz;
            this.deviationHz = deviationHz;
            this.modulation = modulation;
            this.txPowerDbm = txPowerDbm;
        }

        public double getFrequencyMHz() {
            return frequencyMHz;
        }

        public int getDataRate() {
            return dataRate;
        }

        public double getBandwidthKHz() {
            return bandwidthKHz;
        }

        public int getDeviationHz() {
            return deviationHz;
        }

        public int getModulation() {
            return modulation;
        }

        public int getTxPowerDbm() {
            return txPowerDbm;
        }
    }
}
