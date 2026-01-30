/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.ui.emwaver;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;

import com.emwaver.emwaverandroidapp.BuildConfig;
import com.emwaver.emwaverandroidapp.DeviceConnectionManager;
import com.emwaver.emwaverandroidapp.DeviceConnectionService;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.USBService;

import java.util.Locale;

public class EMWaverFragment extends Fragment {
    private static final int EMW_OP_VERSION = 0x01;

    private TextView connectionStateText;
    private TextView connectionDetailText;
    private ImageView deviceIconView;
    private TextView deviceVersionText;
    private TextView deviceVersionStatusText;
    private TextView updateLabel;
    private Button updateButton;

    private DeviceConnectionManager connectionManager;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable tickRunnable;

    private boolean lastConnected = false;
    private String deviceEmwaverVersion = null;
    private final String appEmwaverVersion = BuildConfig.VERSION_NAME;

    private long lastAutoConnectAttemptMs = 0;
    private long lastVersionRequestMs = 0;

    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        View root = inflater.inflate(R.layout.fragment_emwaver, container, false);

        connectionStateText = root.findViewById(R.id.connection_state_text);
        connectionDetailText = root.findViewById(R.id.connection_detail_text);
        deviceIconView = root.findViewById(R.id.device_icon);
        deviceVersionText = root.findViewById(R.id.device_version_text);
        deviceVersionStatusText = root.findViewById(R.id.device_version_status_text);
        updateLabel = root.findViewById(R.id.update_label);
        updateButton = root.findViewById(R.id.update_device_button);

        if (deviceIconView != null) {
            deviceIconView.setImageResource(R.drawable.emwaver_icon);
        }

        if (updateButton != null) {
            updateButton.setOnClickListener(v -> openUpdateModal());
        }

        return root;
    }

    @Override
    public void onStart() {
        super.onStart();
        connectionManager = DeviceConnectionManager.getInstance(requireContext());
        startTicking();
    }

    @Override
    public void onStop() {
        super.onStop();
        stopTicking();
    }

    private void startTicking() {
        stopTicking();
        tickRunnable = new Runnable() {
            @Override
            public void run() {
                updateUiOnce();
                handler.postDelayed(this, 900);
            }
        };
        handler.post(tickRunnable);
    }

    private void stopTicking() {
        if (tickRunnable != null) {
            handler.removeCallbacks(tickRunnable);
            tickRunnable = null;
        }
    }

    private void openUpdateModal() {
        if (connectionManager != null && connectionManager.isConnected()) {
            connectionManager.disconnect();
        }

        UpdateDeviceDialogFragment dialog = new UpdateDeviceDialogFragment();
        dialog.show(getParentFragmentManager(), "UpdateDeviceDialogFragment");
    }

    private void updateUiOnce() {
        if (!isAdded()) {
            return;
        }
        if (connectionManager == null) {
            connectionManager = DeviceConnectionManager.getInstance(requireContext());
        }

        boolean connected = connectionManager != null && connectionManager.isConnected();
        USBService usbService = connectionManager != null ? connectionManager.getUsbService() : null;
        boolean dfuConnected = usbService != null && usbService.isFlashDeviceConnected();

        // Auto-connect (desktop parity): when not connected and not explicitly in Update Mode.
        long now = System.currentTimeMillis();
        if (!connected && !dfuConnected && connectionManager != null) {
            if (now - lastAutoConnectAttemptMs > 1200) {
                lastAutoConnectAttemptMs = now;
                connectionManager.checkForUsbDevices();
            }
        }

        if (connected != lastConnected) {
            lastConnected = connected;
            if (!connected) {
                deviceEmwaverVersion = null;
            }
        }

        // Connection UI
        if (connectionStateText != null) {
            if (connected) {
                connectionStateText.setText("Connected");
                connectionStateText.setTextColor(ContextCompat.getColor(requireContext(), android.R.color.holo_green_dark));
            } else if (dfuConnected) {
                connectionStateText.setText("Update Mode detected");
                connectionStateText.setTextColor(ContextCompat.getColor(requireContext(), android.R.color.holo_orange_dark));
            } else {
                connectionStateText.setText("Searching for device...");
                connectionStateText.setTextColor(ContextCompat.getColor(requireContext(), R.color.textSecondary));
            }
        }
        if (connectionDetailText != null) {
            if (connected) {
                connectionDetailText.setText("Device");
            } else if (dfuConnected) {
                connectionDetailText.setText("plugged in (Update Mode)");
            } else {
                connectionDetailText.setText("connect device or enter Update Mode");
            }
        }

        // Version query (opcode 0x01)
        if (connected && (deviceEmwaverVersion == null) && (now - lastVersionRequestMs > 1200)) {
            lastVersionRequestMs = now;
            queryDeviceVersionAsync();
        }

        if (deviceVersionText != null) {
            if (connected && deviceEmwaverVersion != null) {
                deviceVersionText.setText(deviceEmwaverVersion);
            } else {
                deviceVersionText.setText("");
            }
        }

        boolean mismatch = connected
            && deviceEmwaverVersion != null
            && appEmwaverVersion != null
            && !deviceEmwaverVersion.equals(appEmwaverVersion);

        Integer cmp = (mismatch ? compareSemver(deviceEmwaverVersion, appEmwaverVersion) : null);
        boolean deviceOlder = mismatch && (cmp == null || cmp < 0);

        if (deviceVersionStatusText != null) {
            if (dfuConnected) {
                deviceVersionStatusText.setText("Device connected in Update Mode.");
            } else if (!connected) {
                deviceVersionStatusText.setText("Connect a device to check");
            } else if (deviceEmwaverVersion == null) {
                deviceVersionStatusText.setText("Checking device...");
            } else if (mismatch) {
                deviceVersionStatusText.setText(
                    "Your device is running an "
                        + (deviceOlder ? "older" : "different")
                        + " EMWaver version "
                        + deviceEmwaverVersion
                        + ". Update it."
                );
            } else {
                deviceVersionStatusText.setText("Device emwaver version is up to date");
            }
        }

        boolean showUpdate = dfuConnected || mismatch;
        if (updateLabel != null) {
            updateLabel.setVisibility(showUpdate ? View.VISIBLE : View.GONE);
        }
        if (updateButton != null) {
            updateButton.setVisibility(showUpdate ? View.VISIBLE : View.GONE);
        }
    }

    private void queryDeviceVersionAsync() {
        new Thread(() -> {
            try {
                if (connectionManager == null || !connectionManager.isConnected()) {
                    return;
                }
                DeviceConnectionService service = connectionManager.getActiveService();
                if (service == null || !service.checkConnection()) {
                    return;
                }

                byte[] resp = service.sendCommand(new byte[]{(byte) EMW_OP_VERSION}, 1500);
                String parsed = parseVersionResponse(resp);
                if (parsed == null) {
                    return;
                }

                handler.post(() -> {
                    if (!isAdded()) return;
                    deviceEmwaverVersion = parsed;
                    updateUiOnce();
                });
            } catch (Exception ignored) {
            }
        }, "EMW-Version").start();
    }

    private static String parseVersionResponse(byte[] response) {
        if (response == null || response.length < 4) {
            return null;
        }

        int status = response[0] & 0xFF;
        if (status != 0x80) {
            return null;
        }
        int major = response[1] & 0xFF;
        int minor = response[2] & 0xFF;
        int patch = response[3] & 0xFF;
        return String.format(Locale.US, "%d.%d.%d", major, minor, patch);
    }

    private static int[] parseSemver(String input) {
        if (input == null) return null;
        String trimmed = input.trim();
        String[] parts = trimmed.split("\\.");
        if (parts.length != 3) return null;
        try {
            int a = Integer.parseInt(parts[0]);
            int b = Integer.parseInt(parts[1]);
            int c = Integer.parseInt(parts[2]);
            if (a < 0 || b < 0 || c < 0) return null;
            return new int[]{a, b, c};
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Integer compareSemver(String a, String b) {
        int[] pa = parseSemver(a);
        int[] pb = parseSemver(b);
        if (pa == null || pb == null) return null;
        for (int i = 0; i < 3; i++) {
            if (pa[i] < pb[i]) return -1;
            if (pa[i] > pb[i]) return 1;
        }
        return 0;
    }
}
