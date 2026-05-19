/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;

import java.net.InetAddress;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class AndroidWiFiDiscovery {
    private static final String TAG = "AndroidWiFiDiscovery";

    interface Listener {
        void onDevicesChanged(List<AndroidWiFiTransport.DiscoveredDevice> devices);
        void onError(String message);
    }

    private final NsdManager nsdManager;
    private final Object lock = new Object();
    private final Map<String, AndroidWiFiTransport.DiscoveredDevice> devicesById = new LinkedHashMap<>();
    private NsdManager.DiscoveryListener discoveryListener;
    private Listener listener;
    private boolean discovering;

    AndroidWiFiDiscovery(Context context) {
        nsdManager = (NsdManager) context.getApplicationContext().getSystemService(Context.NSD_SERVICE);
    }

    void start(Listener listener) {
        synchronized (lock) {
            stopLocked(false);
            this.listener = listener;
            devicesById.clear();
            discoveryListener = createDiscoveryListener();
            discovering = true;
            nsdManager.discoverServices(AndroidWiFiTransport.SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener);
            publishLocked();
        }
    }

    void stop(boolean clearDevices) {
        synchronized (lock) {
            stopLocked(clearDevices);
        }
    }

    private void stopLocked(boolean clearDevices) {
        if (discoveryListener != null && discovering) {
            try {
                nsdManager.stopServiceDiscovery(discoveryListener);
            } catch (IllegalArgumentException ignored) {
            }
        }
        discoveryListener = null;
        discovering = false;
        if (clearDevices) {
            devicesById.clear();
        }
        publishLocked();
    }

    private NsdManager.DiscoveryListener createDiscoveryListener() {
        return new NsdManager.DiscoveryListener() {
            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                notifyError("Wi-Fi discovery failed to start.");
                stop(false);
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                notifyError("Wi-Fi discovery failed to stop.");
            }

            @Override
            public void onDiscoveryStarted(String serviceType) {
                Log.d(TAG, "Wi-Fi discovery started: " + serviceType);
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {
                Log.d(TAG, "Wi-Fi discovery stopped: " + serviceType);
            }

            @Override
            public void onServiceFound(NsdServiceInfo serviceInfo) {
                if (!AndroidWiFiTransport.SERVICE_TYPE.equals(serviceInfo.getServiceType())) {
                    return;
                }
                nsdManager.resolveService(serviceInfo, new NsdManager.ResolveListener() {
                    @Override
                    public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {
                        Log.d(TAG, "Wi-Fi discovery resolve failed: " + errorCode);
                    }

                    @Override
                    public void onServiceResolved(NsdServiceInfo resolvedInfo) {
                        addResolvedDevice(resolvedInfo);
                    }
                });
            }

            @Override
            public void onServiceLost(NsdServiceInfo serviceInfo) {
                synchronized (lock) {
                    devicesById.entrySet().removeIf(entry -> entry.getValue().displayName.equals(serviceInfo.getServiceName()));
                    publishLocked();
                }
            }
        };
    }

    private void addResolvedDevice(NsdServiceInfo serviceInfo) {
        InetAddress host = serviceInfo.getHost();
        String hostName = host != null ? host.getHostAddress() : serviceInfo.getServiceName();
        Map<String, String> metadata = decodeAttributes(serviceInfo.getAttributes());
        AndroidWiFiTransport.DiscoveredDevice device = AndroidWiFiTransport.discoveredDevice(
                serviceInfo.getServiceName(),
                hostName,
                serviceInfo.getPort(),
                metadata);
        if (device == null) {
            notifyError("Discovered Wi-Fi device did not include a usable host.");
            return;
        }
        synchronized (lock) {
            devicesById.put(device.id, device);
            publishLocked();
        }
    }

    private void notifyError(String message) {
        Listener active;
        synchronized (lock) {
            active = listener;
        }
        if (active != null) {
            active.onError(message);
        }
    }

    private void publishLocked() {
        if (listener == null) {
            return;
        }
        List<AndroidWiFiTransport.DiscoveredDevice> devices = new ArrayList<>(devicesById.values());
        Collections.sort(devices, (a, b) -> a.displayName.compareToIgnoreCase(b.displayName));
        listener.onDevicesChanged(devices);
    }

    private static Map<String, String> decodeAttributes(Map<String, byte[]> attributes) {
        Map<String, String> result = new HashMap<>();
        if (attributes == null) {
            return result;
        }
        for (Map.Entry<String, byte[]> entry : attributes.entrySet()) {
            String value = AndroidWiFiTransport.decodeTextAttribute(entry.getValue());
            if (value != null && !value.isEmpty()) {
                result.put(entry.getKey(), value);
            }
        }
        return result;
    }
}
