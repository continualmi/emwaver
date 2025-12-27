package com.emwaver.emwaverandroidapp.ui.template;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import com.emwaver.emwaverandroidapp.DeviceConnectionManager;
import com.emwaver.emwaverandroidapp.DeviceConnectionService;
import com.emwaver.emwaverandroidapp.databinding.FragmentTemplateBinding;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class TemplateFragment extends Fragment {

    private FragmentTemplateBinding binding;
    private DeviceConnectionManager connectionManager;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private final Handler statusHandler = new Handler(Looper.getMainLooper());

    private final Runnable statusTicker = new Runnable() {
        @Override
        public void run() {
            updateConnectionStatus();
            statusHandler.postDelayed(this, 500);
        }
    };

    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        binding = FragmentTemplateBinding.inflate(inflater, container, false);
        return binding.getRoot();
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        connectionManager = DeviceConnectionManager.getInstance(requireContext());

        binding.buttonSendVersion.setOnClickListener(v -> runCommand("version\n"));

        binding.buttonClearOutput.setOnClickListener(v -> binding.outputText.setText(""));

        updateConnectionStatus();
    }

    @Override
    public void onResume() {
        super.onResume();
        statusHandler.post(statusTicker);
    }

    @Override
    public void onPause() {
        super.onPause();
        statusHandler.removeCallbacks(statusTicker);
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null;
    }

    private void updateConnectionStatus() {
        if (binding == null) {
            return;
        }

        DeviceConnectionService.ConnectionType type = connectionManager.getActiveConnectionType();
        String status = connectionManager.getConnectionStatus();
        binding.connectionStatus.setText(String.format(Locale.US, "%s • %s", type.name(), status));
    }

    private void runCommand(String asciiCommand) {
        if (!connectionManager.isConnected()) {
            binding.outputText.setText("Not connected. Connect via the EMWaver page first, then come back here.\n");
            return;
        }

        DeviceConnectionService service = connectionManager.getActiveService();
        if (service == null) {
            binding.outputText.setText("No active connection service.\n");
            return;
        }

        binding.outputText.append("> " + asciiCommand);

        final byte[] commandBytes = asciiCommand.getBytes(StandardCharsets.UTF_8);
        executor.execute(() -> {
            byte[] response = service.sendCommand(commandBytes, 2500);
            uiHandler.post(() -> {
                if (binding == null) {
                    return;
                }
                if (response == null || response.length == 0) {
                    binding.outputText.append("(timeout)\n");
                    return;
                }
                binding.outputText.append("< " + bytesToAscii(response) + "\n");
            });
        });
    }

    private static String bytesToHex(byte[] data) {
        StringBuilder sb = new StringBuilder(data.length * 3);
        for (int i = 0; i < data.length; i++) {
            sb.append(String.format(Locale.US, "%02X", data[i]));
            if (i != data.length - 1) {
                sb.append(" ");
            }
        }
        return sb.toString();
    }

    private static String bytesToAscii(byte[] data) {
        StringBuilder sb = new StringBuilder(data.length);
        for (byte b : data) {
            int value = b & 0xFF;
            sb.append(value >= 32 && value <= 126 ? (char) value : '.');
        }
        return sb.toString().trim();
    }
}
