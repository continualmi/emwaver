/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.util.Log;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.os.Handler;
import android.os.Looper;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.emwaver.emwaverandroidapp.BuildConfig;

import android.app.AlertDialog;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.app.ActivityCompat;
import androidx.navigation.NavController;
import androidx.navigation.fragment.NavHostFragment;
import androidx.navigation.ui.AppBarConfiguration;
import androidx.navigation.ui.NavigationUI;
import androidx.core.view.MenuProvider;
import androidx.lifecycle.Lifecycle;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import com.emwaver.emwaverandroidapp.databinding.ActivityMainBinding;
import com.emwaver.emwaverandroidapp.agent.AgentApiKeyStore;
import com.emwaver.emwaverandroidapp.ui.agent.AgentChatBottomSheetDialogFragment;
import com.emwaver.emwaverandroidapp.ui.auth.SignInBottomSheetDialogFragment;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "MainActivity";
    private static final int PERMISSION_REQUEST_CODE = 1;

    private AppBarConfiguration appBarConfiguration;
    private ActivityMainBinding binding;
    private DeviceConnectionManager connectionManager;
    private NavController navController;

    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private Runnable uiTick;
    private MenuItem connectionMenuItem;

    private long lastAutoConnectAttemptMs = 0;
    private String lastWiFiHost = "";
    private String lastWiFiPort = String.valueOf(AndroidWiFiTransport.DEFAULT_PORT);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        binding = ActivityMainBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        
        NavHostFragment navHostFragment = (NavHostFragment) getSupportFragmentManager()
                .findFragmentById(R.id.nav_host_fragment_activity_main);
        if (navHostFragment == null) {
            throw new IllegalStateException("NavHostFragment not found");
        }
        navController = navHostFragment.getNavController();
        
        appBarConfiguration = new AppBarConfiguration.Builder(R.id.navigation_scripts).build();
        
        NavigationUI.setupActionBarWithNavController(this, navController, appBarConfiguration);

        navController.addOnDestinationChangedListener((controller, destination, arguments) -> {
            if (getSupportActionBar() != null && destination.getId() == R.id.navigation_scripts) {
                // ScriptsFragment may override title when previewing/editing.
                if (getSupportActionBar().getTitle() == null || "".contentEquals(getSupportActionBar().getTitle())) {
                    getSupportActionBar().setTitle("EMWaver");
                }
            }
        });

        addMenuProvider(new MenuProvider() {
            @Override
            public void onCreateMenu(@NonNull Menu menu, @NonNull MenuInflater menuInflater) {
                menuInflater.inflate(R.menu.main_top_menu, menu);
                connectionMenuItem = menu.findItem(R.id.action_connection);
            }

            @Override
            public boolean onMenuItemSelected(@NonNull MenuItem menuItem) {
                if (menuItem.getItemId() == R.id.action_open_settings) {
                    startActivity(new Intent(MainActivity.this, SettingsActivity.class));
                    return true;
                }
                if (menuItem.getItemId() == R.id.action_connection) {
                    showConnectionActionsDialog();
                    return true;
                }
                if (menuItem.getItemId() == R.id.action_agent) {
                    AgentChatBottomSheetDialogFragment dialog = new AgentChatBottomSheetDialogFragment();
                    dialog.show(getSupportFragmentManager(), "AgentChat");
                    return true;
                }
                if (menuItem.getItemId() == R.id.action_sign_in) {
                    AgentApiKeyStore keyStore = AgentApiKeyStore.getInstance();
                    keyStore.ensureInitialized(MainActivity.this);

                    if (keyStore.hasAgentKey()) {
                        new AlertDialog.Builder(MainActivity.this)
                                .setTitle("Agent Key")
                                .setMessage("Agent key saved")
                                .setPositiveButton("Remove key", (d, w) -> keyStore.clear())
                                .setNegativeButton("Close", null)
                                .show();
                    } else {
                        SignInBottomSheetDialogFragment dialog = new SignInBottomSheetDialogFragment();
                        dialog.show(getSupportFragmentManager(), "SignIn");
                    }
                    return true;
                }
                return false;
            }
        }, this, Lifecycle.State.RESUMED);

        // Initialize DeviceConnectionManager
        connectionManager = DeviceConnectionManager.getInstance(this);

        // Request ALL necessary permissions at startup
        requestAllRequiredPermissions();
        
        // Services will be initialized after permissions are granted
    }

    private void startUiTicking() {
        stopUiTicking();
        uiTick = new Runnable() {
            @Override
            public void run() {
                updateConnectionUiOnce();
                uiHandler.postDelayed(this, 900);
            }
        };
        uiHandler.post(uiTick);
    }

    private void stopUiTicking() {
        if (uiTick != null) {
            uiHandler.removeCallbacks(uiTick);
            uiTick = null;
        }
    }

    private void updateConnectionUiOnce() {
        if (connectionManager == null) {
            connectionManager = DeviceConnectionManager.getInstance(this);
        }
        boolean connected = connectionManager != null && connectionManager.isConnected();
        USBService usbService = connectionManager != null ? connectionManager.getUsbService() : null;
        boolean dfuConnected = usbService != null && usbService.isFlashDeviceConnected();

        long now = System.currentTimeMillis();
        if (!connected && !dfuConnected && connectionManager != null) {
            if (now - lastAutoConnectAttemptMs > 1200) {
                lastAutoConnectAttemptMs = now;
                connectionManager.checkForUsbDevices();
            }
        }

        int tint;
        if (connected) {
            tint = ContextCompat.getColor(this, android.R.color.holo_green_dark);
        } else if (dfuConnected) {
            tint = ContextCompat.getColor(this, android.R.color.holo_orange_dark);
        } else {
            tint = ContextCompat.getColor(this, android.R.color.holo_red_dark);
        }

        if (getSupportActionBar() != null) {
            getSupportActionBar().setTitle("EMWaver");
            getSupportActionBar().setSubtitle(null);
        }

        if (connectionMenuItem != null && connectionMenuItem.getIcon() != null) {
            connectionMenuItem.getIcon().setTint(tint);
        }
    }

    private void showConnectionActionsDialog() {
        if (connectionManager == null) {
            connectionManager = DeviceConnectionManager.getInstance(this);
        }
        final boolean connected = connectionManager != null && connectionManager.isConnected();
        final USBService usbService = connectionManager != null ? connectionManager.getUsbService() : null;
        final boolean dfuConnected = usbService != null && usbService.isFlashDeviceConnected();
        final String deviceVer = usbService != null ? usbService.getDeviceFirmwareVersion() : null;
        final String bundledVer = BuildConfig.EMWAVER_BUNDLED_FW_VERSION;
        final boolean upToDate = deviceVer != null && bundledVer != null && !bundledVer.isEmpty() && deviceVer.equals(bundledVer);

        // If the device is already in Update Mode, the primary action is "Update".
        // Don't force an extra click through the actions list.
        if (dfuConnected && !connected) {
            com.emwaver.emwaverandroidapp.ui.emwaver.UpdateDeviceDialogFragment update =
                new com.emwaver.emwaverandroidapp.ui.emwaver.UpdateDeviceDialogFragment();
            update.show(getSupportFragmentManager(), "UpdateDeviceDialogFragment");
            return;
        }

        // Keep this modal lightweight; actions are explicit buttons (like macOS).

        String status;
        if (connected) {
            status = "Connected";
        } else {
            status = dfuConnected ? "Update Mode detected" : "Disconnected";
        }
        String connectionStatus = connectionManager != null ? connectionManager.getConnectionStatus() : null;
        if (connectionStatus != null && !"Not connected".equalsIgnoreCase(connectionStatus)) {
            status = connectionStatus;
        }

        String versionLine = "";
        if (connected) {
            String dv = (deviceVer != null && !deviceVer.isEmpty()) ? deviceVer : "?";
            String bv = (bundledVer != null && !bundledVer.isEmpty()) ? bundledVer : "?";
            versionLine = "\n\nFirmware: " + dv + " (bundled: " + bv + ")" + (upToDate ? " • Up to date" : " • Update available");
        }

        AlertDialog.Builder builder = new AlertDialog.Builder(this)
            .setTitle("Connection")
            .setMessage(status + versionLine)
            .setNegativeButton("Close", null);

        // Primary action: Update firmware.
        // IMPORTANT: do NOT switch into DFU here. The update dialog has an explicit confirmation
        // button for entering Update Mode (with a warning that the device becomes unusable until flashed).
        builder.setPositiveButton("Update firmware…", (d, w) -> {
            if (connectionManager == null) {
                return;
            }
            USBService svc = connectionManager.getUsbService();
            boolean isConnected = connectionManager.isConnected();
            boolean isDfu = svc != null && svc.isFlashDeviceConnected();

            if (!isConnected && !isDfu) {
                Toast.makeText(MainActivity.this, "Connect a device first", Toast.LENGTH_SHORT).show();
                return;
            }

            com.emwaver.emwaverandroidapp.ui.emwaver.UpdateDeviceDialogFragment update =
                new com.emwaver.emwaverandroidapp.ui.emwaver.UpdateDeviceDialogFragment();
            update.show(getSupportFragmentManager(), "UpdateDeviceDialogFragment");
        });

        // Secondary actions.
        if (connected) {
            builder.setNeutralButton("Wi-Fi Setup…", (d, w) -> showWiFiSetupDialog());
        } else {
            builder.setNeutralButton("Wi-Fi…", (d, w) -> showWiFiConnectionDialog());
        }

        builder.show();
    }

    private void showWiFiConnectionDialog() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (20 * getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding / 2, padding, 0);

        EditText hostInput = new EditText(this);
        hostInput.setHint("Host or IP");
        hostInput.setSingleLine(true);
        hostInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        hostInput.setText(lastWiFiHost);
        layout.addView(hostInput);

        EditText portInput = new EditText(this);
        portInput.setHint("Port");
        portInput.setSingleLine(true);
        portInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        portInput.setText(lastWiFiPort);
        layout.addView(portInput);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Connect Wi-Fi")
                .setMessage("Connect directly to an ESP32 on your trusted LAN or VPN.")
                .setView(layout)
                .setPositiveButton("Connect", null)
                .setNegativeButton("Cancel", null)
                .setNeutralButton("Search USB/BLE", (d, w) -> {
                    if (connectionManager != null) {
                        connectionManager.checkForUsbDevices();
                    }
                })
                .create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String host = hostInput.getText() != null ? hostInput.getText().toString().trim() : "";
            String portText = portInput.getText() != null ? portInput.getText().toString().trim() : "";
            int port = AndroidWiFiTransport.DEFAULT_PORT;
            if (!portText.isEmpty()) {
                try {
                    port = Integer.parseInt(portText);
                } catch (NumberFormatException ignored) {
                    port = -1;
                }
            }

            if (!AndroidWiFiTransport.isValidManualHost(host)) {
                hostInput.setError("Enter a hostname or IP address without scheme, path, or port.");
                return;
            }
            if (!AndroidWiFiTransport.isValidPort(port)) {
                portInput.setError("Port must be 1-65535.");
                return;
            }

            lastWiFiHost = host;
            lastWiFiPort = String.format(Locale.US, "%d", port);
            if (connectionManager != null) {
                connectionManager.connectWiFi(host, port);
            }
            dialog.dismiss();
        }));
        dialog.show();
    }

    private void showWiFiSetupDialog() {
        if (connectionManager == null || !connectionManager.isConnected()) {
            Toast.makeText(this, "Connect a Wi-Fi-capable ESP32 board first", Toast.LENGTH_SHORT).show();
            return;
        }

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (20 * getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding / 2, padding, 0);

        EditText ssidInput = new EditText(this);
        ssidInput.setHint("SSID");
        ssidInput.setSingleLine(true);
        ssidInput.setInputType(InputType.TYPE_CLASS_TEXT);
        layout.addView(ssidInput);

        EditText passwordInput = new EditText(this);
        passwordInput.setHint("Wi-Fi password");
        passwordInput.setSingleLine(true);
        passwordInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        layout.addView(passwordInput);

        TextView statusText = new TextView(this);
        statusText.setText("");
        statusText.setPadding(0, padding / 2, 0, padding / 2);
        layout.addView(statusText);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.VERTICAL);
        actions.setPadding(0, padding / 2, 0, 0);

        Button sendButton = new Button(this);
        sendButton.setText("Send Wi-Fi Setup");
        actions.addView(sendButton);

        Button clearButton = new Button(this);
        clearButton.setText("Clear Setup");
        actions.addView(clearButton);

        Button statusButton = new Button(this);
        statusButton.setText("Status");
        actions.addView(statusButton);
        layout.addView(actions);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Wi-Fi Setup")
                .setMessage("Send, clear, or inspect ESP32 Wi-Fi credentials over the active local connection.")
                .setView(layout)
                .setPositiveButton("Close", null)
                .setNeutralButton("Disconnect", (d, w) -> {
                    if (connectionManager != null) {
                        connectionManager.disconnect();
                    }
                })
                .create();

        sendButton.setOnClickListener(v -> {
            String ssid = ssidInput.getText() != null ? ssidInput.getText().toString() : "";
            String password = passwordInput.getText() != null ? passwordInput.getText().toString() : "";
            if (ssid.trim().isEmpty()) {
                ssidInput.setError("SSID is required.");
                return;
            }
            runWiFiSetupAction(statusText, () -> connectionManager.provisionWiFi(ssid, password));
        });
        clearButton.setOnClickListener(v -> runWiFiSetupAction(statusText, () -> connectionManager.clearWiFiProvisioning()));
        statusButton.setOnClickListener(v -> runWiFiSetupAction(statusText, () -> connectionManager.refreshWiFiProvisioningStatus()));

        dialog.show();
    }

    private interface WiFiSetupAction {
        String run();
    }

    private void runWiFiSetupAction(TextView statusText, WiFiSetupAction action) {
        statusText.setText("Working...");
        new Thread(() -> {
            String message;
            try {
                message = action.run();
            } catch (Throwable t) {
                Log.e(TAG, "Wi-Fi setup action failed", t);
                message = "Wi-Fi setup action failed.";
            }
            String finalMessage = message;
            uiHandler.post(() -> {
                statusText.setText(finalMessage);
                Toast.makeText(MainActivity.this, finalMessage, Toast.LENGTH_SHORT).show();
            });
        }, "emw-wifi-setup").start();
    }

    private void requestAllRequiredPermissions() {
        List<String> permissions = new ArrayList<>();
        
        // Storage permissions
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }
        
        // Notification permission for Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH_SCAN);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
        } else if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        
        if (!permissions.isEmpty()) {
            Log.d(TAG, "Requesting permissions: " + permissions);
            ActivityCompat.requestPermissions(this, permissions.toArray(new String[0]), PERMISSION_REQUEST_CODE);
        } else {
            // All permissions already granted, initialize connection manager
            initializeConnectionManager();
        }
    }
    
    private void initializeConnectionManager() {
        Log.d(TAG, "Initializing DeviceConnectionManager");
        connectionManager.initialize();
    }

    @Override
    public boolean onSupportNavigateUp() {
        if (navController == null) {
            return super.onSupportNavigateUp();
        }
        
        // Check if we're on the scripts fragment and handle preview/editor mode
        if (navController.getCurrentDestination() != null && 
            navController.getCurrentDestination().getId() == R.id.navigation_scripts) {
            androidx.fragment.app.Fragment navHost = getSupportFragmentManager()
                .findFragmentById(R.id.nav_host_fragment_activity_main);
            if (navHost instanceof NavHostFragment) {
                androidx.fragment.app.Fragment currentFragment = ((NavHostFragment) navHost)
                    .getChildFragmentManager().getPrimaryNavigationFragment();
                if (currentFragment instanceof com.emwaver.emwaverandroidapp.ui.scripts.ScriptsFragment) {
                    com.emwaver.emwaverandroidapp.ui.scripts.ScriptsFragment scriptsFragment = 
                        (com.emwaver.emwaverandroidapp.ui.scripts.ScriptsFragment) currentFragment;
                    if (scriptsFragment.isShowingPreview() || scriptsFragment.isShowingEditor()) {
                        // Trigger the back pressed callback manually
                        getOnBackPressedDispatcher().onBackPressed();
                        return true;
                    }
                }
            }
        }
        
        return NavigationUI.navigateUp(navController, appBarConfiguration)
                || super.onSupportNavigateUp();
    }

    @Override
    protected void onStart() {
        super.onStart();
        
        // Initialize connection manager if permissions are granted
        if (hasRequiredPermissions() && connectionManager != null) {
            connectionManager.initialize();
        }

        startUiTicking();
    }
    
    private boolean hasRequiredPermissions() {
        // Keep legacy storage + notification permissions; USB permission is granted per-device.
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
                    && ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        }
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    protected void onStop() {
        super.onStop();
        stopUiTicking();
        // Note: We don't cleanup connectionManager here as it should persist
        // across activity lifecycle. Cleanup happens in onDestroy if needed.
    }
    
    @Override
    protected void onDestroy() {
        super.onDestroy();
        // Cleanup connection manager when activity is destroyed
        if (connectionManager != null) {
            connectionManager.cleanup();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                         @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE) {
            boolean allPermissionsGranted = grantResults.length > 0;
            
            for (int result : grantResults) {
                if (result != PackageManager.PERMISSION_GRANTED) {
                    allPermissionsGranted = false;
                    break;
                }
            }
            
            if (allPermissionsGranted) {
                Log.d(TAG, "All required permissions granted");
                
                // Create app directory
                File dir = new File(Environment.getExternalStorageDirectory(), "emwaver");
                if (!dir.exists()) {
                    boolean dirCreated = dir.mkdirs();
                    Log.d(TAG, "App directory created: " + dirCreated);
                }
                
                // Initialize connection manager now that we have permissions
                initializeConnectionManager();
            } else {
                // Notify the user that the app needs these permissions
                Toast.makeText(this, "This app requires the requested permissions to function properly", Toast.LENGTH_LONG).show();
                Log.e(TAG, "Some permissions were not granted");
            }
        }
    }
    
    // USB device attachment receiver
    private final BroadcastReceiver usbDeviceReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action)) {
                UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (device != null) {
                    Log.d(TAG, "USB device attached: " + device.getDeviceName());
                    // Check for USB devices when one is attached
                    if (connectionManager != null) {
                        connectionManager.checkForUsbDevices();
                    }
                }
            }
        }
    };
    
    // Keep USB attachment receiver registered while resumed.
    @Override
    protected void onResume() {
        super.onResume();

        // Register USB device attachment receiver
        IntentFilter usbFilter = new IntentFilter();
        usbFilter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        registerReceiver(usbDeviceReceiver, usbFilter);
    }
    
    @Override
    protected void onPause() {
        super.onPause();
        // Unregister USB receiver
        try {
            unregisterReceiver(usbDeviceReceiver);
        } catch (IllegalArgumentException e) {
            // Receiver was not registered, ignore
        }
    }
    
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);

        // If Android launched us due to a USB attach event, kick the USB scan.
        if (intent != null && UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(intent.getAction())) {
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (connectionManager == null) {
                    connectionManager = DeviceConnectionManager.getInstance(this);
                }
                if (connectionManager != null) {
                    connectionManager.checkForUsbDevices();
                }
            }, 250);
        }
    }

}
