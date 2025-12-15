package com.emwaver.emwaverandroidapp.ui.rfid;

import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.graphics.Color;
import android.os.Bundle;
import android.os.IBinder;
import android.text.InputFilter;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.Spinner;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.USBService;
import com.emwaver.emwaverandroidapp.Utils;
import com.emwaver.emwaverandroidapp.databinding.FragmentRfidBinding;

import java.nio.charset.StandardCharsets;

public class RfidFragment extends Fragment {

    private FragmentRfidBinding binding;
    private USBService usbService;
    private boolean isServiceBound = false;

    private EditText blockAddressInput;
    private final EditText[] keyInputs = new EditText[6];
    private EditText combinedDataInput;
    private Spinner authModeSpinner;

    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        binding = FragmentRfidBinding.inflate(inflater, container, false);
        View root = binding.getRoot();

        binding.buttonRead.setOnClickListener(v -> sendReadCommand());
        binding.buttonWrite.setOnClickListener(v -> sendWriteCommand());

        blockAddressInput = binding.editTextBlockAddress;
        keyInputs[0] = binding.editTextKey1;
        keyInputs[1] = binding.editTextKey2;
        keyInputs[2] = binding.editTextKey3;
        keyInputs[3] = binding.editTextKey4;
        keyInputs[4] = binding.editTextKey5;
        keyInputs[5] = binding.editTextKey6;

        combinedDataInput = binding.editTextCombinedData;

        authModeSpinner = binding.spinnerAuthMode;
        ArrayAdapter<CharSequence> adapter = ArrayAdapter.createFromResource(getContext(),
            R.array.auth_modes, android.R.layout.simple_spinner_item);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        authModeSpinner.setAdapter(adapter);

        InputFilter hexFilter = (source, start, end, dest, dstart, dend) -> {
            for (int i = start; i < end; i++) {
                if (!Character.toString(source.charAt(i)).matches("[0-9A-Fa-f]")) {
                    return "";
                }
            }
            return null;
        };

        blockAddressInput.setFilters(new InputFilter[]{new InputFilter.LengthFilter(2), hexFilter});
        for (EditText keyInput : keyInputs) {
            keyInput.setFilters(new InputFilter[]{new InputFilter.LengthFilter(2), hexFilter});
        }
        InputFilter hexAndSpaceFilter = (source, start, end, dest, dstart, dend) -> {
            for (int i = start; i < end; i++) {
                if (!Character.toString(source.charAt(i)).matches("[0-9A-Fa-f ]")) {
                    return "";
                }
            }
            return null;
        };
        combinedDataInput.setFilters(new InputFilter[]{hexAndSpaceFilter});

        setDefaultValues();

        return root;
    }

    private void setDefaultValues() {
        blockAddressInput.setText("00");

        for (EditText keyInput : keyInputs) {
            keyInput.setText("FF");
        }

        combinedDataInput.setText("00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00");

        authModeSpinner.setSelection(0);
    }

    @Override
    public void onStart() {
        super.onStart();
        Intent intent = new Intent(getActivity(), USBService.class);
        if (getActivity() != null) {
            getActivity().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        if (isServiceBound && getActivity() != null) {
            getActivity().unbindService(serviceConnection);
            isServiceBound = false;
        }
    }

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName className, IBinder service) {
            USBService.LocalBinder binder = (USBService.LocalBinder) service;
            usbService = binder.getService();
            isServiceBound = true;
        }

        @Override
        public void onServiceDisconnected(ComponentName arg0) {
            isServiceBound = false;
        }
    };

    private void sendReadCommand() {
        if (isServiceBound && usbService != null) {
            String blockAddress = blockAddressInput.getText().toString();
            if (blockAddress.isEmpty() || !isKeyComplete()) {
                binding.textResult.setText("Please enter block address and complete key.");
                binding.textResult.setTextColor(Color.RED);
                return;
            }

            int block = Integer.parseInt(blockAddress, 16) & 0xFF;
            int auth = (authModeSpinner.getSelectedItemPosition() == 0 ? 0x60 : 0x61);
            String key = buildHexCsv(keyInputs, 6);

            String cmd = String.format("rfid read --block=0x%02X --auth=0x%02X --key=%s", block, auth, key);
            Log.i("RFID", "TX: " + cmd);
            byte[] response = sendAsciiCommand(cmd, 2000);
            processReadResponse(response);
        } else {
            binding.textResult.setText("USB Service not bound. Please reconnect.");
            binding.textResult.setTextColor(Color.RED);
        }
    }

    private void sendWriteCommand() {
        if (isServiceBound && usbService != null) {
            String blockAddress = blockAddressInput.getText().toString();
            if (blockAddress.isEmpty() || !isKeyComplete() || !isCombinedDataComplete()) {
                binding.textResult.setText("Please enter block address, complete key, and data.");
                binding.textResult.setTextColor(Color.RED);
                return;
            }

            int block = Integer.parseInt(blockAddress, 16) & 0xFF;
            int auth = (authModeSpinner.getSelectedItemPosition() == 0 ? 0x60 : 0x61);
            String key = buildHexCsv(keyInputs, 6);
            String data = buildHexCsvFromString(combinedDataInput.getText().toString(), 16);

            String cmd = String.format("rfid write --block=0x%02X --auth=0x%02X --key=%s --data=%s", block, auth, key, data);
            Log.i("RFID", "TX: " + cmd);
            byte[] response = sendAsciiCommand(cmd, 2000);
            processWriteResponse(response);
        } else {
            binding.textResult.setText("USB Service not bound. Please reconnect.");
            binding.textResult.setTextColor(Color.RED);
        }
    }

    private boolean isKeyComplete() {
        for (EditText keyInput : keyInputs) {
            String v = keyInput.getText().toString().trim();
            if (v.isEmpty() || !v.matches("^[0-9A-Fa-f]{1,2}$")) {
                return false;
            }
        }
        return true;
    }

    private boolean isCombinedDataComplete() {
        String combinedData = combinedDataInput.getText().toString().replaceAll(" ", "");
        return combinedData.matches("^[0-9A-Fa-f]{32}$");
    }

    private void processReadResponse(byte[] response) {
        if (response == null || response.length == 0) {
            showError("No response received.");
            return;
        }

        // Firmware binary reply: [TagType(2)][UID(4)][Data(16)] = 22 bytes
        if (response.length == 22) {
            String cardType = getTagType(response[0], response[1]);
            String uid = String.format("%02X %02X %02X %02X",
                    response[2] & 0xFF, response[3] & 0xFF, response[4] & 0xFF, response[5] & 0xFF);

            StringBuilder data = new StringBuilder();
            for (int i = 6; i < 22; i++) {
                if (i > 6) data.append(" ");
                data.append(String.format("%02X", response[i] & 0xFF));
            }

            StringBuilder result = new StringBuilder();
            result.append("Card Type: ").append(cardType).append("\n");
            result.append("UID: ").append(uid).append("\n");
            result.append("Data: ").append(data);
            showResultDialog(result.toString(), data.toString());
            clearError();
        } else {
            String responseString = new String(response, StandardCharsets.US_ASCII).trim();
            if (responseString.equals("No card detected")) {
                showError("Error: No card detected");
                return;
            }
            if (responseString.startsWith("ERR:")) {
                showError(responseString);
                return;
            }
            showError("Unexpected response format.");
        }

        logResponse("read", response);
    }

    private void processWriteResponse(byte[] response) {
        if (response == null || response.length == 0) {
            showError("No response received.");
            return;
        }

        String responseString = new String(response, StandardCharsets.US_ASCII);
        if (responseString.equals("No card detected")) {
            showError("Error: No card detected");
            return;
        }

        if (responseString.equals("Success")) {
            showResultDialog("Write successful", "");
            clearError();
        } else {
            showError("Error: " + responseString);
        }

        logResponse("write", response);
    }

    private void clearError() {
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> binding.textResult.setText(""));
        }
    }

    private void showResultDialog(String result, String data) {
        if (getContext() == null) return;

        new AlertDialog.Builder(getContext())
            .setTitle("Result")
            .setMessage(result)
            .setPositiveButton("OK", null)
            .setNegativeButton("COPY to write", (dialog, which) -> copyToWrite(data))
            .show();
    }

    private void copyToWrite(String data) {
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                combinedDataInput.setText(data);
                Toast.makeText(getContext(), "Data copied to write field", Toast.LENGTH_SHORT).show();
            });
        }
    }

    private void showError(String errorMessage) {
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                binding.textResult.setText(errorMessage);
                binding.textResult.setTextColor(Color.RED);
            });
        }
    }

    private String getTagType(byte b1, byte b2) {
        int tagType = ((b1 & 0xFF) << 8) | (b2 & 0xFF);
        switch (tagType) {
            case 0x4400:
                return "Mifare_UltraLight";
            case 0x0400:
                return "Mifare_One(S50)";
            case 0x0200:
                return "Mifare_One(S70)";
            case 0x0800:
                return "Mifare_Pro(X)";
            case 0x4403:
                return "Mifare_DESFire";
            default:
                return "Unknown";
        }
    }

    private void logResponse(String operation, byte[] response) {
        if (response.length > 0) {
            StringBuilder sb = new StringBuilder();
            sb.append(operation).append(" Response: ");
            for (byte b : response) {
                sb.append(String.format("%02X ", b));
            }
            Log.i("RFID " + operation, sb.toString());
        } else {
            Log.e("RFID " + operation, "Empty response");
        }
    }

    private byte[] sendAsciiCommand(String command, int timeoutMs) {
        if (usbService == null) return null;
        return usbService.sendCommand((command + "\n").getBytes(StandardCharsets.UTF_8), timeoutMs);
    }

    private String buildHexCsv(EditText[] inputs, int expectedCount) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < expectedCount; i++) {
            if (i > 0) sb.append(",");
            String v = inputs[i].getText().toString().trim();
            if (v.length() == 1) v = "0" + v;
            sb.append("0x").append(v);
        }
        return sb.toString();
    }

    private String buildHexCsvFromString(String hexString, int expectedBytes) {
        String cleaned = hexString.replaceAll("[^0-9A-Fa-f]", "");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < expectedBytes; i++) {
            if (i > 0) sb.append(",");
            int start = i * 2;
            String byteHex = (start + 2 <= cleaned.length()) ? cleaned.substring(start, start + 2) : "00";
            sb.append("0x").append(byteHex);
        }
        return sb.toString();
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null;
    }

    @Override
    public void onResume() {
        super.onResume();
        Utils.updateActionBarStatus(this, "");
    }

    @Override
    public void onPause() {
        super.onPause();
        Utils.updateActionBarStatus(this, "");
    }
}
