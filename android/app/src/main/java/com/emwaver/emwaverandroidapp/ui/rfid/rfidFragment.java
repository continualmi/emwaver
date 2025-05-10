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
import android.widget.Button;
import android.widget.EditText;
import android.widget.Spinner;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.databinding.FragmentRfidBinding;
import com.emwaver.emwaverandroidapp.Utils;

import java.nio.charset.StandardCharsets;

public class rfidFragment extends Fragment {

    private FragmentRfidBinding binding;
    private BLEService bleService;
    private boolean isServiceBound = false;

    private EditText blockAddressInput;
    private EditText[] keyInputs = new EditText[6];
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

        // Set up hex input filters for block address, key inputs, and combined data input
        InputFilter hexFilter = (source, start, end, dest, dstart, dend) -> {
            for (int i = start; i < end; i++) {
                if (!Character.toString(source.charAt(i)).matches("[0-9A-Fa-f ]")) {
                    return "";
                }
            }
            return null;
        };

        blockAddressInput.setFilters(new InputFilter[]{new InputFilter.LengthFilter(2), hexFilter});
        for (EditText keyInput : keyInputs) {
            keyInput.setFilters(new InputFilter[]{new InputFilter.LengthFilter(2), hexFilter});
        }
        combinedDataInput.setFilters(new InputFilter[]{hexFilter});

        // Set default values
        setDefaultValues();

        return root;
    }

    private void setDefaultValues() {
        // Set block address to "00"
        blockAddressInput.setText("00");

        // Set all key inputs to "FF"
        for (EditText keyInput : keyInputs) {
            keyInput.setText("FF");
        }

        // Set combined data input to "00 00 00 ... 00"
        combinedDataInput.setText("00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00");

        // Set default auth mode to Key A
        authModeSpinner.setSelection(0);
    }

    @Override
    public void onStart() {
        super.onStart();
        Intent intent = new Intent(getActivity(), BLEService.class);
        getActivity().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
    }

    @Override
    public void onStop() {
        super.onStop();
        if (isServiceBound) {
            getActivity().unbindService(serviceConnection);
            isServiceBound = false;
        }
    }

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName className, IBinder service) {
            BLEService.LocalBinder binder = (BLEService.LocalBinder) service;
            bleService = binder.getService();
            isServiceBound = true;
        }

        @Override
        public void onServiceDisconnected(ComponentName arg0) {
            isServiceBound = false;
        }
    };


    private void sendReadCommand() {
        if (isServiceBound && bleService != null) {
            String blockAddress = blockAddressInput.getText().toString();
            if (blockAddress.isEmpty() || !isKeyComplete()) {
                binding.textResult.setText("Please enter block address and complete key.");
                binding.textResult.setTextColor(Color.RED);
                return;
            }

            byte[] command = new byte[20]; // Increased size to accommodate new format
            
            // Format: "mfrc522 read [blockAddr] [authMode] [6 bytes key]"
            String cmdPrefix = "mfrc522 read ";
            System.arraycopy(cmdPrefix.getBytes(), 0, command, 0, cmdPrefix.length());
            command[cmdPrefix.length()] = (byte) Integer.parseInt(blockAddress, 16);
            command[cmdPrefix.length() + 1] = (byte) (authModeSpinner.getSelectedItemPosition() == 0 ? 0x60 : 0x61); // Auth mode byte

            for (int i = 0; i < 6; i++) {
                command[cmdPrefix.length() + 2 + i] = (byte) Integer.parseInt(keyInputs[i].getText().toString(), 16);
            }

            byte[] response = bleService.sendCommand(command, 2000); // 2000ms timeout
            processReadResponse(response);
        } else {
            binding.textResult.setText("USB Service not bound. Please reconnect.");
            binding.textResult.setTextColor(Color.RED);
        }
    }

    private void sendWriteCommand() {
        if (isServiceBound && bleService != null) {
            String blockAddress = blockAddressInput.getText().toString();
            if (blockAddress.isEmpty() || !isKeyComplete() || !isCombinedDataComplete()) {
                binding.textResult.setText("Please enter block address, complete key, and data.");
                binding.textResult.setTextColor(Color.RED);
                return;
            }

            byte[] command = new byte[40]; // Increased size to accommodate new format
            
            // Format: "mfrc522 write [blockAddr] [authMode] [6 bytes key] [16 bytes data]"
            String cmdPrefix = "mfrc522 write ";
            System.arraycopy(cmdPrefix.getBytes(), 0, command, 0, cmdPrefix.length());
            command[cmdPrefix.length()] = (byte) Integer.parseInt(blockAddress, 16);
            command[cmdPrefix.length() + 1] = (byte) (authModeSpinner.getSelectedItemPosition() == 0 ? 0x60 : 0x61);

            for (int i = 0; i < 6; i++) {
                command[cmdPrefix.length() + 2 + i] = (byte) Integer.parseInt(keyInputs[i].getText().toString(), 16);
            }

            String combinedData = combinedDataInput.getText().toString().replaceAll(" ", "");
            for (int i = 0; i < 16; i++) {
                command[cmdPrefix.length() + 8 + i] = (byte) Integer.parseInt(combinedData.substring(i * 2, i * 2 + 2), 16);
            }

            byte[] response = bleService.sendCommand(command, 2000); // 2000ms timeout
            processWriteResponse(response);
        } else {
            binding.textResult.setText("USB Service not bound. Please reconnect.");
            binding.textResult.setTextColor(Color.RED);
        }
    }

    private boolean isKeyComplete() {
        for (EditText keyInput : keyInputs) {
            if (keyInput.getText().toString().isEmpty()) {
                return false;
            }
        }
        return true;
    }

    private boolean isCombinedDataComplete() {
        String combinedData = combinedDataInput.getText().toString().replaceAll(" ", "");
        return combinedData.length() == 32;
    }

    private void processReadResponse(byte[] response) {
        if (response == null || response.length == 0) {
            showError("No response received.");
            Log.e("RFID", "Null or empty response");
            return;
        }

        // First log the raw response for debugging
        logRawResponse(response);
        
        // Check if response is a plain text error message
        String responseString = new String(response, StandardCharsets.US_ASCII);
        Log.d("RFID", "Response as string: '" + responseString + "'");
        
        if (responseString.contains("No card detected")) {
            showError("Error: No card detected");
            return;
        }
        
        if (responseString.contains("RFID module not connected")) {
            showError("Error: RFID module not connected");
            return;
        }

        if (response.length >= 2) {
            String cardType = getTagType(response[0], response[1]);
            StringBuilder result = new StringBuilder();
            result.append("Card Type: ").append(cardType).append("\n");

            if (response.length >= 6) {
                String uid = String.format("%02X %02X %02X %02X", response[2], response[3], response[4], response[5]);
                result.append("UID: ").append(uid).append("\n");
            }

            if (response.length > 6) {
                if (response[6] == (byte) 0xFF) {
                    // Error occurred
                    String errorMsg = new String(response, 7, response.length - 7, StandardCharsets.US_ASCII);
                    result.append("Error: ").append(errorMsg);
                    showError(result.toString());
                } else if (response[6] == (byte) 0x00 && response.length >= 23) {
                    // Successful read
                    StringBuilder data = new StringBuilder();
                    for (int i = 7; i < 23; i++) {
                        data.append(String.format("%02X ", response[i]));
                    }
                    result.append("Data: ").append(data.toString().trim());
                    showResultDialog(result.toString(), data.toString().trim()); // Pass the full result and only the data part to the dialog
                    clearError(); // Clear any previous error message
                } else {
                    // Unexpected response format - log more details
                    StringBuilder details = new StringBuilder("Unexpected response format.\n");
                    details.append("Length: ").append(response.length).append("\n");
                    if (response.length > 6) {
                        details.append("Status byte: 0x").append(String.format("%02X", response[6])).append("\n");
                    }
                    details.append("Full response (hex): ");
                    for (byte b : response) {
                        details.append(String.format("%02X ", b));
                    }
                    Log.e("RFID", details.toString());
                    showError("Unexpected response format. See logs for details.");
                }
            } else {
                showError("Incomplete response received (length: " + response.length + ")");
                Log.e("RFID", "Incomplete response. Length: " + response.length);
            }
        } else {
            showError("Invalid response format (length: " + response.length + ")");
            Log.e("RFID", "Invalid response format. Length: " + response.length);
        }

        logResponse("read", response);
    }

    private void processWriteResponse(byte[] response) {
        if (response == null || response.length == 0) {
            showError("No response received.");
            Log.e("RFID", "Null or empty response for write command");
            return;
        }

        // Log the raw response for debugging
        logRawResponse(response);
        
        String responseString = new String(response, StandardCharsets.US_ASCII);
        Log.d("RFID", "Write response as string: '" + responseString + "'");
        
        if (responseString.contains("No card detected")) {
            showError("Error: No card detected");
            return;
        }
        
        if (responseString.contains("RFID module not connected")) {
            showError("Error: RFID module not connected");
            return;
        }

        if (responseString.contains("Success")) {
            showResultDialog("Write successful", ""); // Pass an empty string for data
            clearError(); // Clear any previous error message
        } else {
            // More detailed error reporting
            StringBuilder errorDetails = new StringBuilder("Error: ");
            errorDetails.append(responseString);
            errorDetails.append("\nRaw response size: ").append(response.length).append(" bytes");
            showError(errorDetails.toString());
            Log.e("RFID Write", "Error response: " + responseString);
        }

        logResponse("write", response);
    }

    private void clearError() {
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                binding.textResult.setText("");
            });
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
        int tagType = (b1 << 8) | b2;
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

    private void logAntiCollisionResponse(byte[] response) {
        if (response.length >= 5) {
            StringBuilder sb = new StringBuilder();
            sb.append("Anti-Collision Response: ");
            sb.append("Status: ").append(String.format("%02X", response[0])).append(", ");
            sb.append("UID: ");
            for (int i = 1; i < 5; i++) {
                sb.append(String.format("%02X", response[i]));
                if (i < 4) sb.append(" ");
            }
            Log.i("RFID Anti-Collision", sb.toString());
        } else {
            Log.e("RFID Anti-Collision", "Unexpected response length: " + response.length);
        }
    }

    // Add this new method to log the raw response in different formats
    private void logRawResponse(byte[] response) {
        // Log as hex
        StringBuilder hexSb = new StringBuilder("Raw response (hex): ");
        for (byte b : response) {
            hexSb.append(String.format("%02X ", b));
        }
        Log.d("RFID", hexSb.toString());
        
        // Log as ASCII
        StringBuilder asciiSb = new StringBuilder("Raw response (ASCII): ");
        for (byte b : response) {
            if (b >= 32 && b < 127) { // Printable ASCII
                asciiSb.append((char)b);
            } else {
                asciiSb.append(".");
            }
        }
        Log.d("RFID", asciiSb.toString());
        
        // Log as decimal
        StringBuilder decSb = new StringBuilder("Raw response (decimal): ");
        for (byte b : response) {
            decSb.append((b & 0xFF)).append(" ");
        }
        Log.d("RFID", decSb.toString());
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
