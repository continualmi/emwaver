/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
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
import android.util.Log;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

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

import com.emwaver.emwaverandroidapp.databinding.ActivityMainBinding;
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
                if (menuItem.getItemId() == R.id.action_hosts) {
                    com.emwaver.emwaverandroidapp.ui.hosts.HostsBottomSheetDialogFragment dialog = new com.emwaver.emwaverandroidapp.ui.hosts.HostsBottomSheetDialogFragment();
                    dialog.show(getSupportFragmentManager(), "Hosts");
                    return true;
                }
                if (menuItem.getItemId() == R.id.action_sign_in) {
                    com.emwaver.emwaverandroidapp.cloud.CloudAuthManager auth = com.emwaver.emwaverandroidapp.cloud.CloudAuthManager.getInstance();
                    auth.ensureInitialized(MainActivity.this);

                    if (auth.isSignedIn()) {
                        String email = auth.getSignedInEmail();
                        new AlertDialog.Builder(MainActivity.this)
                                .setTitle("Account")
                                .setMessage(email != null && !email.isEmpty() ? email : "Signed in")
                                .setPositiveButton("Sign out", (d, w) -> auth.signOut())
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

        // Best-effort host session heartbeat.
        com.emwaver.emwaverandroidapp.cloud.CloudHostSessionManager.getInstance().start(this, connectionManager);

        // Remote control host WS (web can attach + drive scripts/UI).
        com.emwaver.emwaverandroidapp.cloud.RemoteControlHostService.getInstance().start(this);
        
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
        final boolean secureConnected = usbService != null && usbService.isSecureConnected();

        // If the device is already in Update Mode, the primary action is "Update".
        // Don't force an extra click through the actions list.
        if (dfuConnected && !connected) {
            com.emwaver.emwaverandroidapp.ui.emwaver.UpdateDeviceDialogFragment update =
                new com.emwaver.emwaverandroidapp.ui.emwaver.UpdateDeviceDialogFragment();
            update.show(getSupportFragmentManager(), "UpdateDeviceDialogFragment");
            return;
        }

        List<String> actions = new ArrayList<>();
        actions.add("Search for device");
        if (connected) {
            actions.add("Disconnect");
        }
        actions.add("Update device...");

        String status;
        if (connected) {
            status = secureConnected ? "Connected (Secure)" : "Connected (Not secure)";
        } else {
            status = dfuConnected ? "Update Mode detected" : "Disconnected";
        }

        AlertDialog.Builder builder = new AlertDialog.Builder(this)
            .setTitle("Connection")
            .setMessage(status)
            .setItems(actions.toArray(new String[0]), (dialog, which) -> {
                String selected = actions.get(which);
                if ("Search for device".equals(selected)) {
                    if (connectionManager != null) {
                        connectionManager.checkForUsbDevices();
                    }
                } else if ("Disconnect".equals(selected)) {
                    if (connectionManager != null) {
                        connectionManager.disconnect();
                    }
                } else if ("Update device...".equals(selected)) {
                    // Avoid dialog-on-dialog weirdness (especially when Android is also showing
                    // a USB permission prompt). Dismiss this actions dialog first, then show the
                    // update dialog on the next loop tick.
                    dialog.dismiss();
                    new Handler(Looper.getMainLooper()).post(() -> {
                        com.emwaver.emwaverandroidapp.ui.emwaver.UpdateDeviceDialogFragment update =
                            new com.emwaver.emwaverandroidapp.ui.emwaver.UpdateDeviceDialogFragment();
                        update.show(getSupportFragmentManager(), "UpdateDeviceDialogFragment");
                    });
                }
            })
            .setNegativeButton("Close", null);

        if (connected && secureConnected) {
            builder.setIcon(R.drawable.ic_securewaver);
        }

        builder.show();
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
            return ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
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
    }
    
}
