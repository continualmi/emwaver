package com.emwaver.emwaverandroidapp.ui.packetmode;

import android.os.Bundle;
import android.text.InputFilter;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;

import com.emwaver.emwaverandroidapp.DeviceConnectionManager;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.databinding.FragmentPacketModeBinding;

public class PacketModeFragment extends Fragment {

    private FragmentPacketModeBinding binding;

    private PacketModeViewModel packetModeViewModel;

    private CC1101 cc;
    private DeviceConnectionManager connectionManager;

    public View onCreateView(@NonNull LayoutInflater inflater,
                             ViewGroup container, Bundle savedInstanceState) {

        packetModeViewModel = new ViewModelProvider(this).get(PacketModeViewModel.class);

        binding = FragmentPacketModeBinding.inflate(inflater, container, false);
        View root = binding.getRoot();

        connectionManager = DeviceConnectionManager.getInstance(requireContext());
        cc = new CC1101(new DeviceConnectionCommandSender(connectionManager));

        InputFilter hexFilter = (source, start, end, dest, dstart, dend) -> {
            for (int i = start; i < end; i++) {
                if (!Character.toString(source.charAt(i)).matches("[0-9a-fA-F]*")) {
                    return "";
                }
            }
            return null;
        };


        binding.sendTesla.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (connectionManager == null || !connectionManager.isConnected()) {
                    showToastOnUiThread("Not connected");
                    return;
                }
                new Thread(() -> {
                    byte [] teslaSignal = {(byte)0xAA, (byte)0xAA, (byte)0xAA, (byte)0xCB, (byte)0x8A, 50, -52, -52, -53, 77, 45, 74, -45, 76, -85, 75, 21, -106, 101, -103, -103, -106, -102, 90, -107, -90, -103, 86, -106, 43, 44, -53, 51, 51, 45, 52, -75, 43, 77, 50, -83, 40};
                    cc.sendData(teslaSignal, teslaSignal.length, 300);
                    showToastOnUiThread("tesla signal sent");
                }).start();
            }
        });

        binding.manchesterSwitch.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (connectionManager == null || !connectionManager.isConnected()) {
                    showToastOnUiThread("Not connected");
                    binding.manchesterSwitch.setChecked(!binding.manchesterSwitch.isChecked());
                    return;
                }
                boolean isChecked = binding.manchesterSwitch.isChecked();
                // isChecked will be true if the switch is currently to the right (Manchester)
                new Thread(() -> {
                    if(cc.setManchesterEncoding(isChecked)) {
                        showToastOnUiThread("Manchester encoding set successfully to " + isChecked);
                    } else {
                        showToastOnUiThread("Failed to set encoding");
                        // Revert the switch to its previous state on failure
                        // Must run on UI thread as it modifies the view
                        getActivity().runOnUiThread(() -> binding.manchesterSwitch.setChecked(!isChecked));
                    }
                }).start();
            }
        });


        binding.datarateTextInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                if (connectionManager == null || !connectionManager.isConnected()) {
                    showToastOnUiThread("Not connected");
                    return false;
                }
                new Thread(() -> {
                    String dataRateStr = binding.datarateTextInput.getText().toString();
                    // Parse the string to an integer
                    try {
                        int dataRate = Integer.parseInt(dataRateStr);

                        // Now use dataRate to set the data rate
                        if (cc.setDataRate(dataRate)) {
                            showToastOnUiThread("Data rate set to " + dataRate + " successfully");
                        } else {
                            showToastOnUiThread("Error setting data rate");
                        }
                    } catch (NumberFormatException e) {
                        showToastOnUiThread("Invalid data rate entered");
                    }
                }).start();
            }
            return false;
        });

        binding.deviationTextInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                if (connectionManager == null || !connectionManager.isConnected()) {
                    showToastOnUiThread("Not connected");
                    return false;
                }
                new Thread(() -> {
                    String deviationStr = binding.deviationTextInput.getText().toString().trim();
                    // Parse the string to an integer
                    try {
                        int deviation = Integer.parseInt(deviationStr);

                        // Now use deviation to set the deviation
                        if (cc.setDeviation(deviation)) {
                            showToastOnUiThread("Deviation set to " + deviation + " successfully");
                        } else {
                            showToastOnUiThread("Error setting deviation");
                        }
                    } catch (NumberFormatException e) {
                        showToastOnUiThread("Invalid deviation entered");
                    }
                }).start();
                return true; // Consume the action
            }
            return false; // Pass the event on to other listeners
        });


        binding.syncwordTextInput.setFilters(new InputFilter[]{hexFilter});
        binding.syncwordTextInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                if (connectionManager == null || !connectionManager.isConnected()) {
                    showToastOnUiThread("Not connected");
                    return false;
                }
                new Thread(() -> {
                    String hexInput = binding.syncwordTextInput.getText().toString().trim();
                    // Check if the input is a 4-character hex string
                    if (hexInput.length() != 4) {
                        showToastOnUiThread("Input must be a 4-character hex value");
                        return;
                    }
                    // Convert hex string to byte array
                    byte[] syncWord = cc.convertHexStringToByteArray(hexInput);
                    if (syncWord == null) {
                        showToastOnUiThread("Invalid hex input");
                        return;
                    }
                    // Set the sync word
                    if (cc.setSyncWord(syncWord)) {
                        showToastOnUiThread("Sync word set successfully to " + hexInput);
                    } else {
                        showToastOnUiThread("Error setting Sync word");
                    }
                }).start();
            }
            return false;
        });




        binding.initTransmitButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (connectionManager == null || !connectionManager.isConnected()) {
                    showToastOnUiThread("Not connected");
                    return;
                }
                new Thread(() -> {
                    cc.sendInit();
                    showToastOnUiThread("check terminal");
                }).start();
            }
        });

        binding.initReceiveButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (connectionManager == null || !connectionManager.isConnected()) {
                    showToastOnUiThread("Not connected");
                    return;
                }
                new Thread(() -> {
                    cc.sendInitRx();
                    showToastOnUiThread("check terminal");
                }).start();
            }
        });

        binding.receivePayloadDataTextInput.setFilters(new InputFilter[]{hexFilter});
        // Set an OnClickListener for the button
        binding.sendPayloadButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (connectionManager == null || !connectionManager.isConnected()) {
                    showToastOnUiThread("Not connected");
                    return;
                }
                String payload = binding.transmitPayloadDataTextInput.getText().toString();
                Log.i("Payload", payload);
                byte [] payload_bytes = cc.convertHexStringToByteArray(payload);
                if (payload_bytes == null) {
                    showToastOnUiThread("Invalid hex payload");
                    return;
                }

                new Thread(() -> {
                    cc.sendData(payload_bytes, payload_bytes.length, 300);
                }).start();
            }
        });

        binding.receivePayloadButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (connectionManager == null || !connectionManager.isConnected()) {
                    showToastOnUiThread("Not connected");
                    return;
                }
                new Thread(() -> {
                    byte [] receivedBytes = cc.receiveData();
                    if(receivedBytes == null){
                        showToastOnUiThread("no data in fifo");
                        return;
                    }
                    Log.i("Received", cc.toHexStringWithHexPrefix(receivedBytes));
                    String hexString = cc.bytesToHexString(receivedBytes);
                    getActivity().runOnUiThread(() ->
                            binding.receivePayloadDataTextInput.setText(hexString));
                }).start();
            }
        });

        binding.transferPayloadTxButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                getActivity().runOnUiThread(() ->
                        binding.transmitPayloadDataTextInput.setText(binding.receivePayloadDataTextInput.getText().toString()));
            }
        });


        String[] modulations = getResources().getStringArray(R.array.modulations);
        ArrayAdapter<String> modulationsAdapter = new ArrayAdapter<>(requireContext(), android.R.layout.simple_spinner_dropdown_item, modulations);
        binding.modulationSelector.setAdapter(modulationsAdapter);
        binding.modulationSelector.setOnClickListener(v -> binding.modulationSelector.showDropDown());

        binding.modulationSelector.setOnItemClickListener((parent, view, position, id) -> {
            // Get the selected item
            String selectedItem = (String) parent.getItemAtPosition(position);
            if (connectionManager == null || !connectionManager.isConnected()) {
                showToastOnUiThread("Not connected");
                return;
            }
            new Thread(() -> {
                // Handle the selection
                if ("ASK".equals(selectedItem)) {
                    if(cc.setModulation(CC1101.MOD_ASK)){
                        showToastOnUiThread("modulation set successfully to ASK");
                    }
                    else
                        showToastOnUiThread("Failed to set modulation");
                } else if ("FSK".equals(selectedItem)) {
                    if(cc.setModulation(CC1101.MOD_2FSK)){
                        showToastOnUiThread("modulation set successfully to 2FSK");
                    }
                    else
                        showToastOnUiThread("Failed to set modulation");
                }
            }).start();
        });




        String[] preambles = getResources().getStringArray(R.array.preambles);
        ArrayAdapter<String> preamblesAdapter = new ArrayAdapter<>(requireContext(), android.R.layout.simple_spinner_dropdown_item, preambles);
        binding.preambleSelector.setAdapter(preamblesAdapter);
        binding.preambleSelector.setOnClickListener(v -> binding.preambleSelector.showDropDown());

        binding.preambleSelector.setOnItemClickListener((parent, view, position, id) -> {
            if (connectionManager == null || !connectionManager.isConnected()) {
                showToastOnUiThread("Not connected");
                return;
            }
            new Thread(() -> {
                // Handle the selection based on index
                if(cc.setNumPreambleBytes(position)) {
                    showToastOnUiThread("Preamble set successfully to index " + position);
                } else {
                    showToastOnUiThread("Failed to set preamble");
                }
            }).start();
        });

        String[] syncmodes = getResources().getStringArray(R.array.sync_modes);
        ArrayAdapter<String> syncmodeAdapter = new ArrayAdapter<>(requireContext(), android.R.layout.simple_spinner_dropdown_item, syncmodes);
        binding.syncModeSelector.setAdapter(syncmodeAdapter);
        binding.syncModeSelector.setOnClickListener(v -> binding.syncModeSelector.showDropDown());

        binding.syncModeSelector.setOnItemClickListener((parent, view, position, id) -> {
            if (connectionManager == null || !connectionManager.isConnected()) {
                showToastOnUiThread("Not connected");
                return;
            }
            new Thread(() -> {
                // Handle the selection based on index
                if(cc.setSyncMode((byte)position)) {
                    showToastOnUiThread("Sync mode set successfully to index " + position);
                } else {
                    showToastOnUiThread("Failed to set sync mode");
                }
            }).start();
        });


        return root;
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null;
    }




    public void showToastOnUiThread(final String message) {
        if (isAdded() && getActivity() != null) { // Check if Fragment is currently added to its activity
            getActivity().runOnUiThread(() ->
                    Toast.makeText(getContext(), message, Toast.LENGTH_SHORT).show());
        }
    }


}
