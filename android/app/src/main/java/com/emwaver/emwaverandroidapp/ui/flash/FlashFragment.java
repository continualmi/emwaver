/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.emwaver.emwaverandroidapp.ui.flash;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.AssetManager;
import android.database.Cursor;
import android.graphics.Color;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.ArrayAdapter;
import android.widget.AdapterView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.view.MenuProvider;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.Lifecycle;

import com.emwaver.emwaverandroidapp.BLEReceiver;
import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.DeviceConnectionManager;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.USBService;
import com.emwaver.emwaverandroidapp.Utils;
import com.emwaver.emwaverandroidapp.databinding.FragmentFlashBinding;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

public class FlashFragment extends Fragment {
    private FragmentFlashBinding binding;
    private Dfu dfu;
    private DeviceConnectionManager connectionManager;
    private USBService usbService;
    private BLEService bleService;
    private ActivityResultLauncher<String[]> openDfuFileLauncher;
    private ActivityResultLauncher<String[]> openOtaFileLauncher;
    private Uri selectedFileUri = null;
    private Uri selectedOtaFileUri = null;
    private AlertDialog progressDialog;
    private TextView progressTextView;
    private Button okButton;
    private ProgressBar progressBar;
    private String selectedAssetPath = "dfu/ism.dfu";
    private String selectedOtaLabel = "ota/emwaveresp.bin";
    private BLEReceiver bleReceiver;

    private static final String TAG = "FlashFragment";
    private static final String[] FIRMWARE_LABELS = new String[]{
        "ISM",
        "GPIO",
        "IR",
        "RFID"
    };
    private static final String[] FIRMWARE_ASSETS = new String[]{
        "dfu/ism.dfu",
        "dfu/gpio.dfu",
        "dfu/ir.dfu",
        "dfu/rfid.dfu"
    };


    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        openDfuFileLauncher = registerForActivityResult(new ActivityResultContracts.OpenDocument(), this::onDfuFileSelected);
        openOtaFileLauncher = registerForActivityResult(new ActivityResultContracts.OpenDocument(), this::onOtaFileSelected);
        
        // Get connection manager
        connectionManager = DeviceConnectionManager.getInstance(requireContext());
        usbService = connectionManager.getUsbService();
        bleService = connectionManager.getBleService();
    }

    @Override
    public View onCreateView(@NonNull LayoutInflater inflater,
                             ViewGroup container, Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        binding = FragmentFlashBinding.inflate(inflater, container, false);

        // Initialize DFU if USB service is available
        if (usbService != null) {
            dfu = new Dfu(usbService);
        }

        // Set up click listeners for the buttons
        binding.buttonConnect.setOnClickListener(v -> requestOrConnectDFU());
        binding.buttonFlashFile.setOnClickListener(v -> flashFile());
        binding.buttonOtaFlashStock.setOnClickListener(v -> flashOtaStock());
        binding.buttonOtaSelectBin.setOnClickListener(v -> selectOtaExternalFile());
        binding.buttonOtaFlashSelected.setOnClickListener(v -> flashOtaSelected());
        binding.buttonOtaWifiStart.setOnClickListener(v -> startWifiOtaMode());
        binding.buttonOtaWifiSettings.setOnClickListener(v -> openWifiSettings());
        binding.radioGroupOtaTransport.setOnCheckedChangeListener((group, checkedId) -> updateOtaUiState());

        ArrayAdapter<String> firmwareAdapter = new ArrayAdapter<>(
            requireContext(),
            android.R.layout.simple_spinner_item,
            FIRMWARE_LABELS
        );
        firmwareAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        binding.spinnerFirmware.setAdapter(firmwareAdapter);
        binding.spinnerFirmware.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (position < 0 || position >= FIRMWARE_ASSETS.length) {
                    return;
                }
                selectedAssetPath = FIRMWARE_ASSETS[position];
                selectedFileUri = null;
                binding.textViewFileName.setText(selectedAssetPath);
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
                // Keep existing selection.
            }
        });

        // Set up the options menu
        requireActivity().addMenuProvider(new MenuProvider() {
            @Override
            public void onCreateMenu(@NonNull Menu menu, @NonNull MenuInflater menuInflater) {
                menuInflater.inflate(R.menu.flash_menu, menu);
            }

            @Override
            public boolean onMenuItemSelected(@NonNull MenuItem menuItem) {
                if (menuItem.getItemId() == R.id.action_flash_external) {
                    selectExternalFile();
                    return true;
                }
                return false;
            }
        }, getViewLifecycleOwner(), Lifecycle.State.RESUMED);

        updateStatusText("Not ready", Color.RED);
        binding.buttonFlashFile.setEnabled(false);
        updateOtaUiState();

        return binding.getRoot();
    }

    private void requestOrConnectDFU() {
        if (connectionManager != null && usbService != null) {
            if (usbService.checkConnection()) {
                // Device is in normal CDC Class mode
                updateStatusText("Device is in normal mode. Please reconnect the device with the BOOT0 switch in the other direction.", Color.RED);
                binding.buttonFlashFile.setEnabled(false);
            } else if (!usbService.isFlashDeviceConnected()) {
                // No DFU device found
                updateStatusText("No DFU device found. Please connect the device in DFU mode.", Color.RED);
                binding.buttonFlashFile.setEnabled(false);
            } else {
                // Device is not in normal mode and a DFU device is present
                if (usbService.hasUsbPermission()) {
                    usbService.connectUSBFlash();
                    if (usbService.isFlashDeviceConnected()) {
                        updateStatusText("Connected to STM32 DFU BOOTLOADER", Color.GREEN);
                        binding.buttonFlashFile.setEnabled(true);
                    } else {
                        updateStatusText("Failed to connect to DFU BOOTLOADER", Color.RED);
                        binding.buttonFlashFile.setEnabled(false);
                    }
                } else {
                    usbService.requestUsbPermission();
                    // Set up a handler to check for permission after a delay
                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        if (usbService.hasUsbPermission()) {
                            updateStatusText("USB permission granted. You can now connect.", Color.GREEN);
                        } else {
                            updateStatusText("USB permission denied or no response. Please try again.", Color.RED);
                        }
                    }, 5000); // 5 second delay
                    updateStatusText("Requesting USB permission...", Color.YELLOW);
                    binding.buttonFlashFile.setEnabled(false);
                }
            }
        } else {
            updateStatusText("USB Service not available", Color.RED);
            binding.buttonFlashFile.setEnabled(false);
        }
    }

    private void flashFile() {
        if (selectedFileUri != null) {
            flashWithExternalFile(selectedFileUri);
        } else {
            flashWithAssetFile();
        }
    }

    private void selectExternalFile() {
        openDfuFileLauncher.launch(new String[]{"*/*"});
    }

    private void onDfuFileSelected(Uri uri) {
        if (uri != null) {
            selectedFileUri = uri;
            String fileName = getFileName(uri);
            binding.textViewFileName.setText(fileName);
        }
    }

    private void selectOtaExternalFile() {
        openOtaFileLauncher.launch(new String[]{"*/*"});
    }

    private void onOtaFileSelected(Uri uri) {
        if (uri != null) {
            selectedOtaFileUri = uri;
            String fileName = getFileName(uri);
            binding.textViewOtaFileName.setText(fileName);
            binding.buttonOtaFlashSelected.setEnabled(true);
        }
    }

    @SuppressLint("Range")
    private String getFileName(Uri uri) {
        String result = null;
        if (uri.getScheme().equals("content")) {
            try (Cursor cursor = getActivity().getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    result = cursor.getString(cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME));
                }
            }
        }
        if (result == null) {
            result = uri.getPath();
            int cut = result.lastIndexOf('/');
            if (cut != -1) {
                result = result.substring(cut + 1);
            }
        }
        return result;
    }

    private void flashWithAssetFile() {
        if (connectionManager != null && usbService != null && usbService.isFlashDeviceConnected()) {
            showFlashConfirmationDialog(() -> {
                showProgressDialog();
                new Thread(() -> {
                    try {
                        updateProgressDialog("Starting mass erase...");
                        massErase();
                        updateProgressDialog("Mass erase complete. Setting address pointer...");
                        setAddressPointer(0x08000000);
                        updateProgressDialog("Address pointer set. Starting flash write...");
                        writeFlashFromAssetsFile(selectedAssetPath);
                        updateProgressDialog("Flash write completed successfully!");
                    } catch (Exception e) {
                        updateProgressDialog("Error writing flash: " + e.getMessage());
                        e.printStackTrace();
                    }
                }).start();
            });
        } else {
            Toast.makeText(getContext(), "Flash device not connected", Toast.LENGTH_SHORT).show();
        }
    }

    private void massErase() throws Exception {
        if (usbService == null || dfu == null) {
            throw new Exception("USB service or DFU not available");
        }
        
        byte[] massEraseCommand = {0x41};
        byte[] status = new byte[6];
        int bwPollTimeout;

        dfu.waitDownloadIdle();

        int length = usbService.getUsbDeviceConnection().controlTransfer(
            Dfu.DFU_REQUEST_TYPE_OUT, Dfu.DFU_DNLOAD, 0, 0, massEraseCommand, 1, 50);
        if (length < 0) {
            throw new Exception("error: mass_erase() control transfer failed");
        }

        dfu.getStatus(status);
        if ((status[4] == Dfu.STATE_DFU_DOWNLOAD_BUSY || status[4] == Dfu.STATE_DFU_DOWNLOAD_IDLE)) {
            updateProgressDialog("Mass erasing...");
        } else {
            throw new Exception("error while mass erasing (not dfuDNBUSY)");
        }

        bwPollTimeout = (status[3] & 0xFF) << 16 | (status[2] & 0xFF) << 8 | (status[1] & 0xFF);
        Thread.sleep(bwPollTimeout);

        dfu.getStatus(status);
        if ((status[4] == Dfu.STATE_DFU_IDLE || status[4] == Dfu.STATE_DFU_DOWNLOAD_IDLE)) {
            updateProgressDialog("Mass erase complete.");
        } else {
            throw new Exception("mass erase failed");
        }
    }

    private void setAddressPointer(int address) throws Exception {
        if (usbService == null || dfu == null) {
            throw new Exception("USB service or DFU not available");
        }
        
        byte[] buffer = new byte[5];
        int bwPollTimeout;

        buffer[0] = 0x21;
        buffer[1] = (byte) (address & 0xFF);
        buffer[2] = (byte) ((address >> 8) & 0xFF);
        buffer[3] = (byte) ((address >> 16) & 0xFF);
        buffer[4] = (byte) ((address >> 24) & 0xFF);

        dfu.waitDownloadIdle();

        int length = usbService.getUsbDeviceConnection().controlTransfer(
            Dfu.DFU_REQUEST_TYPE_OUT, Dfu.DFU_DNLOAD, 0, 0, buffer, buffer.length, 50);
        if (length < 0) {
            throw new Exception("error: set_address_pointer() control transfer failed");
        }

        byte[] status = new byte[6];
        dfu.getStatus(status);
        if (status[4] == Dfu.STATE_DFU_DOWNLOAD_BUSY || status[4] == Dfu.STATE_DFU_DOWNLOAD_IDLE) {
            updateProgressDialog("Setting address pointer...");
        } else {
            throw new Exception("error while setting pointer (not dfuDNBUSY)");
        }

        bwPollTimeout = (status[3] & 0xFF) << 16 | (status[2] & 0xFF) << 8 | (status[1] & 0xFF);
        Thread.sleep(bwPollTimeout);

        dfu.getStatus(status);
        if (status[4] == Dfu.STATE_DFU_IDLE || status[4] == Dfu.STATE_DFU_DOWNLOAD_IDLE) {
            updateProgressDialog("Address pointer set successfully.");
        } else {
            throw new Exception("setting pointer failed");
        }
    }

    private void writeBlock(byte[] buffer, int block, int numBytes) throws Exception {
        if (usbService == null || dfu == null) {
            throw new Exception("USB service or DFU not available");
        }
        
        int bwPollTimeout;

        dfu.waitDownloadIdle(); // Make sure we are in dfuIDLE or dfuDNLOAD-IDLE state

        // Write block control transfer
        int length = usbService.getUsbDeviceConnection().controlTransfer(
            Dfu.DFU_REQUEST_TYPE_OUT, Dfu.DFU_DNLOAD, block, 0, buffer, numBytes, 500);
        if (length < 0) {
            throw new Exception("error: write_block() control transfer failed");
        }

        // Verify execution and success
        byte[] status = new byte[6];
        dfu.getStatus(status);
        if (status[4] == Dfu.STATE_DFU_DOWNLOAD_BUSY || status[4] == Dfu.STATE_DFU_DOWNLOAD_IDLE) {
            updateProgressDialog("Writing block...");
        } else {
            throw new Exception("error while writing (not dfuDNBUSY)");
        }

        bwPollTimeout = (status[3] & 0xFF) << 16;
        bwPollTimeout |= (status[2] & 0xFF) << 8;
        bwPollTimeout |= (status[1] & 0xFF);
        Thread.sleep(bwPollTimeout); //Minimum time, in milliseconds, that the host should wait before sending a subsequent DFU_GETSTATUS request

        dfu.getStatus(status);
        if (status[4] == Dfu.STATE_DFU_IDLE || status[4] == Dfu.STATE_DFU_DOWNLOAD_IDLE) {
            updateProgressDialog("Block write complete.");
        } else {
            throw new Exception("block write failed");
        }
    }

    private void writeFlashFromAssetsFile(String assetPath) throws Exception {
        AssetManager assetManager = getContext().getAssets();
        InputStream inputStream = assetManager.open(assetPath);

        byte[] writeBuffer = new byte[Dfu.BLOCK_SIZE];
        byte[] readBuffer = new byte[Dfu.BLOCK_SIZE];
        int blockNum = 2;
        int readBytes;

        while ((readBytes = inputStream.read(writeBuffer, 0, Dfu.BLOCK_SIZE)) > 0) {
            updateProgressDialog("Writing block " + blockNum + "...");
            writeBlock(writeBuffer, blockNum, readBytes);

            updateProgressDialog("Verifying block " + blockNum + "...");
            dfu.waitUploadIdle();
            dfu.readBlock(readBuffer, blockNum, readBytes);

            if (equalArrays(writeBuffer, readBuffer, readBytes)) {
                updateProgressDialog("Block " + blockNum + " verified successfully.");
            } else {
                throw new Exception("Error verifying block " + (blockNum-2) + ".");
            }

            blockNum++;
        }

        inputStream.close();
        updateProgressDialog("Flash write completed successfully.");
    }

    private boolean equalArrays(byte[] a, byte[] b, int length) {
        if (a == b) return true;
        if (a == null || b == null || a.length < length || b.length < length) return false;
        for (int i = 0; i < length; i++) {
            if (a[i] != b[i]) return false;
        }
        return true;
    }

    private void flashWithExternalFile(Uri fileUri) {
        if (connectionManager != null && usbService != null && usbService.isFlashDeviceConnected()) {
            showFlashConfirmationDialog(() -> {
                showProgressDialog();
                new Thread(() -> {
                    try {
                        updateProgressDialog("Starting mass erase...");
                        massErase();
                        updateProgressDialog("Mass erase complete. Setting address pointer...");
                        setAddressPointer(0x08000000);
                        updateProgressDialog("Address pointer set. Starting flash write...");
                        writeFlashFromExternalFile(fileUri);
                        updateProgressDialog("Flash write completed successfully!");
                    } catch (Exception e) {
                        updateProgressDialog("Error writing flash: " + e.getMessage());
                        e.printStackTrace();
                    }
                }).start();
            });
        } else {
            Toast.makeText(getContext(), "Flash device not connected", Toast.LENGTH_SHORT).show();
        }
    }

    private void updateStatusText(String status, int color) {
        binding.textViewStatus.setText(status);
        binding.textViewStatus.setTextColor(color);
    }

    private void showFlashConfirmationDialog(Runnable onConfirm) {
        new AlertDialog.Builder(getContext())
            .setTitle("Confirm Flashing")
            .setMessage("This will erase and replace the current code in the device. Are you sure you want to proceed?")
            .setPositiveButton("Flash", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    onConfirm.run();
                }
            })
            .setNegativeButton("Cancel", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    // Do nothing, just dismiss the dialog
                }
            })
            .show();
    }

    @Override
    public void onStart() {
        super.onStart();
        // Refresh USB service reference
        if (connectionManager != null) {
            usbService = connectionManager.getUsbService();
            bleService = connectionManager.getBleService();
            if (usbService != null && dfu == null) {
                dfu = new Dfu(usbService);
            }
        }
        IntentFilter filter = new IntentFilter(USBService.ACTION_CONNECT_USB_BOOTLOADER);
        requireActivity().registerReceiver(connectReceiver, filter);
    }

    @Override
    public void onStop() {
        super.onStop();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        try {
            requireActivity().unregisterReceiver(connectReceiver);
        } catch (IllegalArgumentException e) {
            // Receiver was not registered, ignore
        }
    }

    private final BroadcastReceiver connectReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (USBService.ACTION_CONNECT_USB_BOOTLOADER.equals(intent.getAction())) {
                synchronized (this) {
                    UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);

                    if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                        if (device != null && usbService != null) {
                            UsbDeviceConnection connection =
                                    ((UsbManager) context.getSystemService(Context.USB_SERVICE)).openDevice(device);
                            usbService.setUsbDeviceConnection(connection);
                            updateStatusText("USB Permission Granted", Color.GREEN);
                        }
                    } else {
                        updateStatusText("USB Permission Denied", Color.RED);
                    }
                }
            }
        }
    };

    private void showProgressDialog() {
        AlertDialog.Builder builder = new AlertDialog.Builder(getContext());
        View view = getLayoutInflater().inflate(R.layout.dialog_flash_progress, null);
        progressTextView = view.findViewById(R.id.textViewProgress);
        okButton = view.findViewById(R.id.buttonOk);
        progressBar = view.findViewById(R.id.progressBar);
        okButton.setVisibility(View.GONE);
        okButton.setOnClickListener(v -> dismissProgressDialog());
        
        builder.setView(view);
        builder.setCancelable(false);
        builder.setTitle("Flashing Progress");
        progressDialog = builder.create();
        progressDialog.show();
    }

    private void updateProgressDialog(String message) {
        if (progressDialog != null && progressDialog.isShowing()) {
            getActivity().runOnUiThread(() -> {
                progressTextView.setText(message);
                if (message.contains("completed") ||
                        message.contains("Error") ||
                        message.startsWith("OK:") ||
                        message.contains("Connect to Wi‑Fi")) {
                    progressBar.setVisibility(View.GONE);
                    okButton.setVisibility(View.VISIBLE);
                } else {
                    progressBar.setVisibility(View.VISIBLE);
                    okButton.setVisibility(View.GONE);
                }
            });
        }
    }

    private void dismissProgressDialog() {
        if (progressDialog != null && progressDialog.isShowing()) {
            progressDialog.dismiss();
            progressDialog = null;
        }
    }

    private void writeFlashFromExternalFile(Uri fileUri) throws Exception {
        InputStream inputStream = getContext().getContentResolver().openInputStream(fileUri);

        if (inputStream == null) {
            throw new Exception("Unable to open input stream for the selected file.");
        }

        byte[] writeBuffer = new byte[Dfu.BLOCK_SIZE];
        byte[] readBuffer = new byte[Dfu.BLOCK_SIZE];
        int blockNum = 2;
        int readBytes;

        while ((readBytes = inputStream.read(writeBuffer, 0, Dfu.BLOCK_SIZE)) > 0) {
            updateProgressDialog("Writing block " + blockNum + "...");
            writeBlock(writeBuffer, blockNum, readBytes);

            updateProgressDialog("Verifying block " + blockNum + "...");
            dfu.waitUploadIdle();
            dfu.readBlock(readBuffer, blockNum, readBytes);

            if (equalArrays(writeBuffer, readBuffer, readBytes)) {
                updateProgressDialog("Block " + blockNum + " verified successfully.");
            } else {
                throw new Exception("Error verifying block " + (blockNum-2) + ".");
            }

            blockNum++;
        }

        inputStream.close();
        updateProgressDialog("Flash write completed successfully.");
    }

    private void updateOtaUiState() {
        boolean connected = bleService != null && bleService.checkConnection();
        boolean wifi = binding != null && binding.radioOtaWifi.isChecked();
        String transportLabel = wifi ? "Wi‑Fi OTA" : "BLE OTA";
        binding.textViewOtaStatus.setText(connected ? "BLE connected (" + transportLabel + ")" : "BLE not connected");
        binding.textViewOtaStatus.setTextColor(connected ? Color.GREEN : Color.RED);
        binding.buttonOtaFlashStock.setEnabled(connected);
        binding.buttonOtaSelectBin.setEnabled(connected);
        binding.buttonOtaFlashSelected.setEnabled(connected && selectedOtaFileUri != null);
        binding.buttonOtaWifiStart.setEnabled(connected && wifi);
        binding.buttonOtaWifiSettings.setEnabled(wifi);
        binding.textViewOtaFileName.setText(selectedOtaFileUri != null ? getFileName(selectedOtaFileUri) : selectedOtaLabel);
    }

    private void startWifiOtaMode() {
        if (bleService == null || !bleService.checkConnection()) {
            Toast.makeText(getContext(), "BLE not connected", Toast.LENGTH_SHORT).show();
            return;
        }
        showProgressDialog();
        updateProgressDialog("Starting Wi‑Fi OTA mode...");
        bleService.otaWifiStart((success, message) -> requireActivity().runOnUiThread(() -> {
            updateProgressDialog((success ? "OK: " : "Error: ") + message);
            if (success) {
                updateProgressDialog("Connect to Wi‑Fi 'EMWaver-OTA' then flash.");
            }
        }));
    }

    private void openWifiSettings() {
        dismissProgressDialog();
        try {
            startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS));
        } catch (Exception e) {
            Toast.makeText(getContext(), "Unable to open Wi‑Fi settings", Toast.LENGTH_SHORT).show();
        }
    }

    private void flashOtaStock() {
        if (bleService == null || !bleService.checkConnection()) {
            Toast.makeText(getContext(), "BLE not connected", Toast.LENGTH_SHORT).show();
            return;
        }
        showFlashConfirmationDialog(() -> {
            showProgressDialog();
            new Thread(() -> {
                try {
                    updateProgressDialog("Loading stock OTA firmware...");
                    byte[] firmware = readAllBytesFromAssets("ota/emwaveresp.bin");
                    otaFlashBytes(firmware);
                } catch (Exception e) {
                    updateProgressDialog("Error: " + e.getMessage());
                }
            }).start();
        });
    }

    private void flashOtaSelected() {
        if (selectedOtaFileUri == null) {
            Toast.makeText(getContext(), "No OTA file selected", Toast.LENGTH_SHORT).show();
            return;
        }
        if (bleService == null || !bleService.checkConnection()) {
            Toast.makeText(getContext(), "BLE not connected", Toast.LENGTH_SHORT).show();
            return;
        }
        showFlashConfirmationDialog(() -> {
            showProgressDialog();
            new Thread(() -> {
                try {
                    updateProgressDialog("Loading OTA file...");
                    InputStream inputStream = getContext().getContentResolver().openInputStream(selectedOtaFileUri);
                    if (inputStream == null) {
                        updateProgressDialog("Error: Unable to open selected file");
                        return;
                    }
                    byte[] firmware = readAllBytes(inputStream);
                    otaFlashBytes(firmware);
                } catch (Exception e) {
                    updateProgressDialog("Error: " + e.getMessage());
                }
            }).start();
        });
    }

    private void otaFlashBytes(byte[] firmware) {
        boolean wifi = binding != null && binding.radioOtaWifi.isChecked();
        if (!wifi) {
            bleService.otaFlash(firmware, new BLEService.OtaProgressCallback() {
                @Override
                public void onProgress(String message, int sentBytes, int totalBytes) {
                    updateProgressDialog(message + " (" + sentBytes + "/" + totalBytes + ")");
                }

                @Override
                public void onComplete(boolean success, String message) {
                    updateProgressDialog((success ? "completed: " : "Error: ") + message);
                }
            });
            return;
        }

        otaWifiFlashBytes(firmware);
    }

    private void otaWifiFlashBytes(byte[] firmware) {
        try {
            updateProgressDialog("Computing SHA‑256...");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] sha = digest.digest(firmware);
            String shaHex = toHexLower(sha);

            updateProgressDialog("Uploading over Wi‑Fi... (ensure you're connected to EMWaver-OTA)");
            HttpURLConnection conn = (HttpURLConnection) new URL("http://192.168.4.1/ota").openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("Content-Type", "application/octet-stream");
            conn.setRequestProperty("X-Emwaver-Sha256", shaHex);
            conn.setFixedLengthStreamingMode(firmware.length);

            int sent = 0;
            try (OutputStream out = conn.getOutputStream()) {
                int offset = 0;
                byte[] buf = new byte[16 * 1024];
                while (offset < firmware.length) {
                    int n = Math.min(buf.length, firmware.length - offset);
                    System.arraycopy(firmware, offset, buf, 0, n);
                    out.write(buf, 0, n);
                    offset += n;
                    sent += n;

                    int finalSent = sent;
                    requireActivity().runOnUiThread(() -> updateProgressDialog("Uploading... (" + finalSent + "/" + firmware.length + ")"));
                }
                out.flush();
            }

            int code = conn.getResponseCode();
            if (code != 200) {
                updateProgressDialog("Error: HTTP " + code);
                return;
            }

            updateProgressDialog("Waiting for device to finalize...");
            bleService.otaClearStatusQueue();
            boolean ok = bleService.waitForOtaTerminalStatus(new BLEService.OtaProgressCallback() {
                @Override
                public void onProgress(String message, int sentBytes, int totalBytes) {
                    updateProgressDialog(message + " (" + sentBytes + "/" + totalBytes + ")");
                }

                @Override
                public void onComplete(boolean success, String message) {
                }
            }, firmware.length, 30000);

            updateProgressDialog(ok ? "completed: OTA successful" : "Error: OTA failed or timed out");
        } catch (Exception e) {
            updateProgressDialog("Error: " + e.getMessage());
        }
    }

    private String toHexLower(byte[] bytes) {
        final char[] hex = "0123456789abcdef".toCharArray();
        char[] out = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            int v = bytes[i] & 0xFF;
            out[i * 2] = hex[v >>> 4];
            out[i * 2 + 1] = hex[v & 0x0F];
        }
        return new String(out);
    }

    private byte[] readAllBytesFromAssets(String assetPath) throws Exception {
        AssetManager assetManager = getContext().getAssets();
        try (InputStream inputStream = assetManager.open(assetPath)) {
            return readAllBytes(inputStream);
        }
    }

    private byte[] readAllBytes(InputStream inputStream) throws Exception {
        try (InputStream in = inputStream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int read;
            while ((read = in.read(buf)) > 0) {
                out.write(buf, 0, read);
            }
            return out.toByteArray();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        Utils.updateActionBarStatus(this, "");
        updateOtaUiState();

        bleReceiver = new BLEReceiver(connected -> {
            if (connectionManager != null) {
                bleService = connectionManager.getBleService();
            }
            if (binding != null) {
                requireActivity().runOnUiThread(this::updateOtaUiState);
            }
        });
        IntentFilter filter = new IntentFilter(BLEReceiver.ACTION_BLE_CONNECTION_STATUS);
        requireActivity().registerReceiver(bleReceiver, filter);
    }

    @Override
    public void onPause() {
        super.onPause();
        Utils.updateActionBarStatus(this, "");
        if (bleReceiver != null) {
            requireActivity().unregisterReceiver(bleReceiver);
            bleReceiver = null;
        }
    }
}
