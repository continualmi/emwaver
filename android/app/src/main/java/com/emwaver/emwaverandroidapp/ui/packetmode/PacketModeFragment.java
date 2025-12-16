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
import com.emwaver.emwaverandroidapp.DeviceConnectionService;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.databinding.FragmentPacketModeBinding;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

public class PacketModeFragment extends Fragment {

    private FragmentPacketModeBinding binding;

    private PacketModeViewModel packetModeViewModel;

    private DeviceConnectionManager connectionManager;

    private static final String TAG = "PacketMode";

    private static final double CC1101_F_XTAL_HZ = 26_000_000.0;
    private static final double DEFAULT_FREQ_MHZ = 433.920;

    // NOTE: If your Tesla encoding really is ~400 µs per bit, that’s ~2500 bps.
    // If you want the legacy 100 kbps scripts instead, change this or use the UI to set it.
    private static final int DEFAULT_DATARATE_BPS = 2_500;
    private static final int DEFAULT_TX_POWER_DBM = 10;
    private static final byte[] DEFAULT_TESLA_SYNC_WORD = {(byte) 0xCB, (byte) 0x8A};
    private static final byte[] DEFAULT_TESLA_PAYLOAD = {
            (byte) 0x32, (byte) 0xCC, (byte) 0xCC, (byte) 0xCB, (byte) 0x4D, (byte) 0x2D, (byte) 0x4A,
            (byte) 0xD3, (byte) 0x4C, (byte) 0xAB, (byte) 0x4B, (byte) 0x15, (byte) 0x96, (byte) 0x65,
            (byte) 0x99, (byte) 0x99, (byte) 0x96, (byte) 0x9A, (byte) 0x5A, (byte) 0x95, (byte) 0xA6,
            (byte) 0x99, (byte) 0x56, (byte) 0x96, (byte) 0x2B, (byte) 0x2C, (byte) 0xCB, (byte) 0x33,
            (byte) 0x33, (byte) 0x2D, (byte) 0x34, (byte) 0xB5, (byte) 0x2B, (byte) 0x4D, (byte) 0x32,
            (byte) 0xAD, (byte) 0x28
    };

    // CC1101 registers
    private static final byte CC1101_IOCFG2 = 0x00;
    private static final byte CC1101_IOCFG1 = 0x01;
    private static final byte CC1101_IOCFG0 = 0x02;
    private static final byte CC1101_FIFOTHR = 0x03;
    private static final byte CC1101_SYNC1 = 0x04;
    private static final byte CC1101_SYNC0 = 0x05;
    private static final byte CC1101_PKTLEN = 0x06;
    private static final byte CC1101_PKTCTRL1 = 0x07;
    private static final byte CC1101_PKTCTRL0 = 0x08;
    private static final byte CC1101_ADDR = 0x09;
    private static final byte CC1101_CHANNR = 0x0A;
    private static final byte CC1101_FSCTRL1 = 0x0B;
    private static final byte CC1101_FSCTRL0 = 0x0C;
    private static final byte CC1101_FREQ2 = 0x0D;
    private static final byte CC1101_FREQ1 = 0x0E;
    private static final byte CC1101_FREQ0 = 0x0F;
    private static final byte CC1101_MDMCFG4 = 0x10;
    private static final byte CC1101_MDMCFG3 = 0x11;
    private static final byte CC1101_MDMCFG2 = 0x12;
    private static final byte CC1101_MDMCFG1 = 0x13;
    private static final byte CC1101_MDMCFG0 = 0x14;
    private static final byte CC1101_DEVIATN = 0x15;

    private static final byte CC1101_MCSM2 = 0x16;
    private static final byte CC1101_MCSM1 = 0x17;
    private static final byte CC1101_MCSM0 = 0x18;
    private static final byte CC1101_FOCCFG = 0x19;
    private static final byte CC1101_BSCFG = 0x1A;
    private static final byte CC1101_AGCCTRL2 = 0x1B;
    private static final byte CC1101_AGCCTRL1 = 0x1C;
    private static final byte CC1101_AGCCTRL0 = 0x1D;
    private static final byte CC1101_WOREVT1 = 0x1E;
    private static final byte CC1101_WOREVT0 = 0x1F;
    private static final byte CC1101_WORCTRL = 0x20;
    private static final byte CC1101_FREND1 = 0x21;
    private static final byte CC1101_FREND0 = 0x22;
    private static final byte CC1101_FSCAL3 = 0x23;
    private static final byte CC1101_FSCAL2 = 0x24;
    private static final byte CC1101_FSCAL1 = 0x25;
    private static final byte CC1101_FSCAL0 = 0x26;
    private static final byte CC1101_RCCTRL1 = 0x27;
    private static final byte CC1101_RCCTRL0 = 0x28;
    private static final byte CC1101_FSTEST = 0x29;
    private static final byte CC1101_PTEST = 0x2A;
    private static final byte CC1101_AGCTEST = 0x2B;
    private static final byte CC1101_TEST2 = 0x2C;
    private static final byte CC1101_TEST1 = 0x2D;
    private static final byte CC1101_TEST0 = 0x2E;

    // Status registers / FIFOs
    private static final byte CC1101_TXBYTES = 0x3A;
    private static final byte CC1101_RXBYTES = 0x3B;
    private static final byte CC1101_PATABLE = 0x3E;
    private static final byte CC1101_TXFIFO = 0x3F;
    private static final byte CC1101_RXFIFO = 0x3F;

    // Strobes
    private static final byte CC1101_SRES = 0x30;
    private static final byte CC1101_SCAL = 0x33;
    private static final byte CC1101_SRX = 0x34;
    private static final byte CC1101_STX = 0x35;
    private static final byte CC1101_SIDLE = 0x36;
    private static final byte CC1101_SFRX = 0x3A;
    private static final byte CC1101_SFTX = 0x3B;

    // Modulations (MDMCFG2 bits 6:4)
    private static final byte MOD_2FSK = 0;
    private static final byte MOD_ASK = 3;

    private static final byte BYTES_IN_RXFIFO = 0x7F;
    private static final byte PKTCTRL0_PACKET_MODE = 0x00;

    public View onCreateView(@NonNull LayoutInflater inflater,
                             ViewGroup container, Bundle savedInstanceState) {

        packetModeViewModel = new ViewModelProvider(this).get(PacketModeViewModel.class);

        binding = FragmentPacketModeBinding.inflate(inflater, container, false);
        View root = binding.getRoot();

        connectionManager = DeviceConnectionManager.getInstance(requireContext());

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
                    boolean ok = sendTeslaFromUi();
                    showToastOnUiThread(ok ? "sent" : "send failed");
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
                    if(setManchesterEncoding(isChecked)) {
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
                        if (setDataRate(dataRate)) {
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
                        if (setDeviation(deviation)) {
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
                    byte[] syncWord = convertHexStringToByteArray(hexInput);
                    if (syncWord == null) {
                        showToastOnUiThread("Invalid hex input");
                        return;
                    }
                    // Set the sync word
                    if (setSyncWord(syncWord)) {
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
                    sendInit();
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
                    sendInitRx();
                    showToastOnUiThread("check terminal");
                }).start();
            }
        });

        binding.receivePayloadDataTextInput.setFilters(new InputFilter[]{hexFilter});

        binding.receivePayloadButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (connectionManager == null || !connectionManager.isConnected()) {
                    showToastOnUiThread("Not connected");
                    return;
                }
                new Thread(() -> {
                    byte [] receivedBytes = receiveData();
                    if(receivedBytes == null){
                        showToastOnUiThread("no data in fifo");
                        return;
                    }
                    Log.i("Received", toHexStringWithHexPrefix(receivedBytes));
                    String hexString = bytesToHexString(receivedBytes);
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
                    if(setModulation(MOD_ASK)){
                        showToastOnUiThread("modulation set successfully to ASK");
                    }
                    else
                        showToastOnUiThread("Failed to set modulation");
                } else if ("FSK".equals(selectedItem)) {
                    if(setModulation(MOD_2FSK)){
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
                if(setNumPreambleBytes(position)) {
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
                if(setSyncMode((byte)position)) {
                    showToastOnUiThread("Sync mode set successfully to index " + position);
                } else {
                    showToastOnUiThread("Failed to set sync mode");
                }
            }).start();
        });

        applyTeslaDefaultsToUi();

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

    private byte[] sendCommandString(String command, int timeoutMs) {
        if (connectionManager == null) {
            return null;
        }
        DeviceConnectionService service = connectionManager.getActiveService();
        if (service == null || !service.checkConnection()) {
            return null;
        }
        String framed = command != null ? command : "";
        if (!framed.endsWith("\n")) {
            framed += "\n";
        }
        return service.sendCommand(framed.getBytes(StandardCharsets.UTF_8), timeoutMs);
    }

    private static boolean isAckOk(byte[] response) {
        return response != null && response.length == 1 && (response[0] & 0xFF) == 0x00;
    }

    private void spiStrobe(byte commandStrobe) {
        sendCommandString(String.format("cc1101 strobe --cmd=0x%02X", commandStrobe & 0xFF), 1000);
    }

    private void writeReg(byte addr, byte data) {
        sendCommandString(
                String.format("cc1101 write --reg=0x%02X --val=0x%02X", addr & 0xFF, data & 0xFF),
                1000
        );
    }

    private byte readReg(byte addr) {
        byte[] response = sendCommandString(
                String.format("cc1101 read --reg=0x%02X", addr & 0xFF),
                1000
        );
        if (response == null || response.length < 1) {
            return 0;
        }
        return response[0];
    }

    private void writeBurstReg(byte addr, byte[] data, int len) {
        if (data == null || data.length == 0 || len <= 0) {
            return;
        }
        int toSend = Math.min(data.length, len);
        StringBuilder hex = new StringBuilder();
        for (int i = 0; i < toSend; i++) {
            if (i > 0) {
                hex.append(',');
            }
            hex.append(String.format("0x%02X", data[i] & 0xFF));
        }
        sendCommandString(
                String.format("cc1101 write_burst --reg=0x%02X --data=%s", addr & 0xFF, hex),
                1000
        );
    }

    private byte[] readBurstReg(byte addr, int len) {
        if (len <= 0) {
            return new byte[0];
        }
        byte[] response = sendCommandString(
                String.format("cc1101 read_burst --reg=0x%02X --len=%d", addr & 0xFF, len),
                1000
        );
        if (response == null || response.length != len) {
            return null;
        }
        return response;
    }

    private void setGDOMode(byte gdo2, byte gdo1, byte gdo0) {
        writeReg(CC1101_IOCFG2, gdo2);
        writeReg(CC1101_IOCFG1, gdo1);
        writeReg(CC1101_IOCFG0, gdo0);
    }

    private boolean setModulationAndPower(byte modulation, int dbm) {
        byte[] response = sendCommandString(
                String.format("cc1101 set_mod_power --mod=%d --dbm=%d", modulation & 0xFF, dbm),
                1000
        );
        return isAckOk(response);
    }

    private void sendData(byte[] txBuffer, int size, int t) {
        if (txBuffer == null || size <= 0) {
            return;
        }

        // Packet mode: PKTLEN must match the payload length (fixed length mode).
        writeReg(CC1101_PKTCTRL0, PKTCTRL0_PACKET_MODE);
        writeReg(CC1101_PKTLEN, (byte) (size & 0xFF));

        spiStrobe(CC1101_SIDLE);
        spiStrobe(CC1101_SFTX);

        byte[] payload = txBuffer;
        if (size != txBuffer.length) {
            payload = Arrays.copyOf(txBuffer, size);
        }
        writeBurstReg(CC1101_TXFIFO, payload, size);

        spiStrobe(CC1101_STX);
        try {
            Thread.sleep(t);
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        }
        spiStrobe(CC1101_SIDLE);
        spiStrobe(CC1101_SFTX);
    }

    private byte[] receiveData() {
        byte sizeReading = readReg(CC1101_RXBYTES);
        if ((sizeReading & BYTES_IN_RXFIFO) > 0) {
            byte[] rxBuffer = readBurstReg(CC1101_RXFIFO, sizeReading & 0xFF);
            spiStrobe(CC1101_SFRX);
            spiStrobe(CC1101_SRX);
            return rxBuffer;
        }
        spiStrobe(CC1101_SFRX);
        spiStrobe(CC1101_SRX);
        return null;
    }

    private void sendInit() {
        sendCommandString("cc1101 init", 1500);
        spiStrobe(CC1101_SRES);
        sendCommandString("cc1101 apply_defaults", 1500);

        writeReg(CC1101_PKTCTRL0, PKTCTRL0_PACKET_MODE);
        // PKTLEN is only used in fixed-length packet mode. Set a sane default here so register reads
        // don't show 0x00 after init.
        int defaultPktLen = DEFAULT_TESLA_PAYLOAD.length;
        try {
            String payloadHex = binding != null && binding.transmitPayloadDataTextInput.getText() != null
                    ? binding.transmitPayloadDataTextInput.getText().toString()
                    : "";
            byte[] parsed = convertHexStringToByteArray(payloadHex);
            if (parsed != null && parsed.length > 0) {
                defaultPktLen = parsed.length;
            }
        } catch (Exception ignored) {
        }
        writeReg(CC1101_PKTLEN, (byte) (defaultPktLen & 0xFF));

        // If you need a specific GDO mapping for debug, re-enable and set it here.
        // setGDOMode((byte) 0x2E, (byte) 0x2E, (byte) 0x0D);

        setFrequencyMHz(DEFAULT_FREQ_MHZ);
        setDataRate(DEFAULT_DATARATE_BPS);
        setModulationAndPower(MOD_ASK, DEFAULT_TX_POWER_DBM);

        spiStrobe(CC1101_SIDLE);
        spiStrobe(CC1101_SFTX);
    }

    private void sendInitRx() {
        sendInit();
        spiStrobe(CC1101_SFRX);
        spiStrobe(CC1101_SRX);
    }

    private boolean setFrequencyMHz(double frequencyMHz) {
        long word = Math.round(frequencyMHz * 1e6 * Math.pow(2, 16) / CC1101_F_XTAL_HZ);
        byte freq2 = (byte) ((word >> 16) & 0xFF);
        byte freq1 = (byte) ((word >> 8) & 0xFF);
        byte freq0 = (byte) (word & 0xFF);

        writeReg(CC1101_FREQ2, freq2);
        writeReg(CC1101_FREQ1, freq1);
        writeReg(CC1101_FREQ0, freq0);

        spiStrobe(CC1101_SIDLE);
        spiStrobe(CC1101_SCAL);
        return true;
    }

    private boolean setDataRate(int bitRate) {
        final double fOsc = 26_000_000.0;
        final int drateMMax = 255;
        final int drateEMax = 15;

        double target = bitRate * Math.pow(2, 28) / fOsc;
        double minDifference = Double.MAX_VALUE;
        int bestM = 0;
        int bestE = 0;

        for (int e = 0; e <= drateEMax; e++) {
            for (int m = 0; m <= drateMMax; m++) {
                double currentValue = (256 + m) * Math.pow(2, e);
                double difference = Math.abs(currentValue - target);
                if (difference < minDifference) {
                    minDifference = difference;
                    bestM = m;
                    bestE = e;
                }
            }
        }

        byte mdmcfg4Current = readReg(CC1101_MDMCFG4);
        int bandwidthPart = mdmcfg4Current & 0xF0;
        int combinedE = bandwidthPart | (bestE & 0x0F);

        byte[] mdmcfg = {(byte) combinedE, (byte) bestM};
        writeBurstReg(CC1101_MDMCFG4, mdmcfg, 2);

        byte[] confirmValue = readBurstReg(CC1101_MDMCFG4, 2);
        return confirmValue != null && Arrays.equals(confirmValue, mdmcfg);
    }

    private boolean setModulation(byte modulation) {
        byte currentValue = readReg(CC1101_MDMCFG2);
        byte mask = 0b01110000;
        currentValue &= ~mask;
        currentValue |= (byte) ((modulation << 4) & mask);
        writeReg(CC1101_MDMCFG2, currentValue);
        return readReg(CC1101_MDMCFG2) == currentValue;
    }

    private boolean setManchesterEncoding(boolean manchester){
        byte mdmcfg2 = readReg(CC1101_MDMCFG2);
        if(manchester){
            mdmcfg2 |= 0b00001000;
        }
        else{
            mdmcfg2 &= 0b11110111;
        }
        writeReg(CC1101_MDMCFG2, mdmcfg2);
        return readReg(CC1101_MDMCFG2) == mdmcfg2;
    }

    private boolean setSyncMode(byte syncmode){
        byte currentValue = readReg(CC1101_MDMCFG2);
        byte mask = 0b00000111;
        currentValue &= ~mask;
        currentValue |= (syncmode);
        writeReg(CC1101_MDMCFG2, currentValue);
        return readReg(CC1101_MDMCFG2) == currentValue;
    }

    private boolean setSyncWord(byte[] syncWord) {
        if (syncWord == null || syncWord.length != 2) {
            return false;
        }
        writeReg(CC1101_SYNC1, syncWord[0]);
        writeReg(CC1101_SYNC0, syncWord[1]);
        return readReg(CC1101_SYNC1) == syncWord[0] && readReg(CC1101_SYNC0) == syncWord[1];
    }

    private boolean setNumPreambleBytes(int index) {
        // MDMCFG1[6:4] = NUM_PREAMBLE.
        if (index < 0 || index > 7) {
            return false;
        }
        byte mdmcfg1 = readReg(CC1101_MDMCFG1);
        mdmcfg1 &= (byte) 0b10001111;
        mdmcfg1 |= (byte) ((index & 0x07) << 4);
        writeReg(CC1101_MDMCFG1, mdmcfg1);
        return readReg(CC1101_MDMCFG1) == mdmcfg1;
    }

    private boolean setDeviation(int deviation) {
        final double fOsc = 26_000_000.0;
        final int deviationMMax = 7;
        final int deviationEMax = 7;
        double target = deviation * Math.pow(2, 17) / fOsc;

        double minDifference = Double.MAX_VALUE;
        int bestM = 0;
        int bestE = 0;
        for (int e = 0; e <= deviationEMax; e++) {
            for (int m = 0; m <= deviationMMax; m++) {
                double currentValue = (8 + m) * Math.pow(2, e);
                double difference = Math.abs(currentValue - target);
                if (difference < minDifference) {
                    minDifference = difference;
                    bestM = m;
                    bestE = e;
                }
            }
        }

        byte deviatn = (byte) (((bestE & 0x07) << 4) | (bestM & 0x07));
        writeReg(CC1101_DEVIATN, deviatn);
        return readReg(CC1101_DEVIATN) == deviatn;
    }

    private byte[] convertHexStringToByteArray(String hexString) {
        if (hexString == null) {
            return null;
        }
        StringBuilder filtered = new StringBuilder();
        String s0 = hexString.trim();
        for (int i = 0; i < s0.length(); i++) {
            char c = s0.charAt(i);
            if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
                filtered.append(c);
            }
        }
        String s = filtered.toString();
        if ((s.length() % 2) != 0) {
            return null;
        }
        byte[] bytes = new byte[s.length() / 2];
        try {
            for (int i = 0; i < s.length(); i += 2) {
                bytes[i / 2] = (byte) Integer.parseInt(s.substring(i, i + 2), 16);
            }
        } catch (NumberFormatException e) {
            Log.w(TAG, "Invalid hex string", e);
            return null;
        }
        return bytes;
    }

    private void applyTeslaDefaultsToUi() {
        getActivity().runOnUiThread(() -> {
            if (binding == null) {
                return;
            }
            if (binding.datarateTextInput.getText() == null || binding.datarateTextInput.getText().toString().trim().isEmpty()) {
                binding.datarateTextInput.setText(String.valueOf(DEFAULT_DATARATE_BPS));
            }
            if (binding.syncwordTextInput.getText() == null || binding.syncwordTextInput.getText().toString().trim().isEmpty()) {
                binding.syncwordTextInput.setText("CB8A");
            }
            if (binding.transmitPayloadDataTextInput.getText() == null || binding.transmitPayloadDataTextInput.getText().toString().trim().isEmpty()) {
                binding.transmitPayloadDataTextInput.setText(bytesToHexString(DEFAULT_TESLA_PAYLOAD));
            }
            binding.modulationSelector.setText("ASK", false);
            binding.preambleSelector.setText("3", false);
            binding.syncModeSelector.setText("16/16 bits", false);
            binding.manchesterSwitch.setChecked(false);
        });
    }

    private boolean sendTeslaFromUi() {
        // Apply a known-good baseline first.
        sendInit();

        // Tesla defaults (user can override the UI inputs; this makes the button self-contained).
        setModulationAndPower(MOD_ASK, DEFAULT_TX_POWER_DBM);
        setManchesterEncoding(false);
        setSyncMode((byte) 2); // "16/16 bits"
        setNumPreambleBytes(1); // "3" preamble bytes

        int dataRate = DEFAULT_DATARATE_BPS;
        try {
            String dr = binding.datarateTextInput.getText() != null ? binding.datarateTextInput.getText().toString().trim() : "";
            if (!dr.isEmpty()) {
                dataRate = Integer.parseInt(dr);
            }
        } catch (Exception ignored) {
        }
        setDataRate(dataRate);

        byte[] syncWord = DEFAULT_TESLA_SYNC_WORD;
        try {
            String sw = binding.syncwordTextInput.getText() != null ? binding.syncwordTextInput.getText().toString().trim() : "";
            byte[] parsed = convertHexStringToByteArray(sw);
            if (parsed != null && parsed.length == 2) {
                syncWord = parsed;
            }
        } catch (Exception ignored) {
        }
        setSyncWord(syncWord);

        byte[] payload = null;
        String payloadHex = binding.transmitPayloadDataTextInput.getText() != null
                ? binding.transmitPayloadDataTextInput.getText().toString()
                : "";
        byte[] raw = convertHexStringToByteArray(payloadHex);
        if (raw == null || raw.length == 0) {
            payload = DEFAULT_TESLA_PAYLOAD;
        } else if (raw.length >= 5 &&
                (raw[0] & 0xFF) == 0xAA && (raw[1] & 0xFF) == 0xAA && (raw[2] & 0xFF) == 0xAA) {
            // If the user pasted a full capture (AA AA AA + sync + payload), strip preamble+sync for packet mode.
            byte[] sw = {raw[3], raw[4]};
            setSyncWord(sw);
            payload = Arrays.copyOfRange(raw, 5, raw.length);
        } else {
            payload = raw;
        }

        if (payload == null || payload.length == 0) {
            return false;
        }
        sendData(payload, payload.length, 300);
        return true;
    }

    private String bytesToHexString(byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            return "";
        }
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02X", b & 0xFF));
        }
        return sb.toString();
    }

    private String toHexStringWithHexPrefix(byte[] array) {
        if (array == null) {
            return "null";
        }
        StringBuilder hexString = new StringBuilder("[");
        for (int i = 0; i < array.length; i++) {
            String hex = "0x" + Integer.toHexString(array[i] & 0xFF).toUpperCase();
            hexString.append(hex);
            if (i < array.length - 1) {
                hexString.append(", ");
            }
        }
        hexString.append("]");
        return hexString.toString();
    }

}
