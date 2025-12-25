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

import com.emwaver.emwaverandroidapp.DeviceConnectionManager;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.USBService;
import com.emwaver.emwaverandroidapp.Utils;
import com.emwaver.emwaverandroidapp.databinding.FragmentFlashBinding;

import java.io.InputStream;

public class FlashFragment extends Fragment {
    private FragmentFlashBinding binding;
    private Dfu dfu;
    private DeviceConnectionManager connectionManager;
    private USBService usbService;
    private ActivityResultLauncher<String[]> openFileLauncher;
    private Uri selectedFileUri = null;
    private AlertDialog progressDialog;
    private TextView progressTextView;
    private Button okButton;
    private ProgressBar progressBar;
    private String selectedAssetPath = "dfu/ism.dfu";

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
        openFileLauncher = registerForActivityResult(new ActivityResultContracts.OpenDocument(), this::onFileSelected);
        
        // Get connection manager
        connectionManager = DeviceConnectionManager.getInstance(requireContext());
        usbService = connectionManager.getUsbService();
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
        openFileLauncher.launch(new String[]{"*/*"});
    }

    private void onFileSelected(Uri uri) {
        if (uri != null) {
            selectedFileUri = uri;
            String fileName = getFileName(uri);
            binding.textViewFileName.setText(fileName);
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
                if (message.contains("completed") || message.contains("Error")) {
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
