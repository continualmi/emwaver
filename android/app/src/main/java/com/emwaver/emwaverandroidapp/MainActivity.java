/*
 * EMWaver Android App
 * Copyright (C) 2025 Luís Marnoto
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

package com.emwaver.emwaverandroidapp;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.IBinder;
import android.util.Log;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.navigation.NavController;
import androidx.navigation.fragment.NavHostFragment;
import androidx.navigation.ui.AppBarConfiguration;
import androidx.navigation.ui.NavigationUI;
import androidx.core.view.MenuProvider;
import androidx.lifecycle.Lifecycle;

import com.emwaver.emwaverandroidapp.databinding.ActivityMainBinding;
import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.google.android.material.navigation.NavigationView;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "MainActivity";
    private static final int PERMISSION_REQUEST_CODE = 1;
    private static final int REQUEST_ENABLE_BT = 1;
    
    private AppBarConfiguration appBarConfiguration;
    private ActivityMainBinding binding;
    private DeviceConnectionManager connectionManager;
    private NavController navController;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        binding = ActivityMainBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        
        // Handle OAuth callback intent
        handleOAuthCallback(getIntent());

        NavHostFragment navHostFragment = (NavHostFragment) getSupportFragmentManager()
                .findFragmentById(R.id.nav_host_fragment_activity_main);
        if (navHostFragment == null) {
            throw new IllegalStateException("NavHostFragment not found");
        }
        navController = navHostFragment.getNavController();
        
        // Set up the AppBarConfiguration with drawer layout
        androidx.drawerlayout.widget.DrawerLayout drawer = binding.drawerLayout;
        appBarConfiguration = new AppBarConfiguration.Builder(
                R.id.navigation_cc1101, R.id.navigation_emwaver,
                R.id.navigation_rfid, R.id.navigation_sampler, R.id.navigation_wavelets,
                R.id.navigation_git, R.id.navigation_flash, R.id.navigation_packet_mode)
                .setOpenableLayout(drawer)
                .build();
        
        NavigationUI.setupActionBarWithNavController(this, navController, appBarConfiguration);
        
        // Set up BottomNavigationView
        BottomNavigationView bottomNavView = binding.navViewBottom;
        NavigationUI.setupWithNavController(bottomNavView, navController);
        
        // Set up NavigationView (drawer)
        NavigationView navigationView = binding.navView;
        NavigationUI.setupWithNavController(navigationView, navController);
        
        // Handle Settings menu item click (it's not a fragment, it's an activity)
        navigationView.getMenu().findItem(R.id.navigation_settings).setOnMenuItemClickListener(item -> {
            startActivity(new Intent(this, SettingsActivity.class));
            return true;
        });

        addMenuProvider(new MenuProvider() {
            @Override
            public void onCreateMenu(@NonNull Menu menu, @NonNull MenuInflater menuInflater) {
                menuInflater.inflate(R.menu.main_overflow_menu, menu);
            }

            @Override
            public boolean onMenuItemSelected(@NonNull MenuItem menuItem) {
                if (menuItem.getItemId() == R.id.action_open_settings) {
                    startActivity(new Intent(MainActivity.this, SettingsActivity.class));
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

    private void requestAllRequiredPermissions() {
        List<String> permissions = new ArrayList<>();
        
        // Storage permissions
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }
        
        // Location permission is REQUIRED for BLE scanning on all Android versions
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        
        // Bluetooth permissions for Android 12+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH_SCAN);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH_ADVERTISE);
            }
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
        
        // Check if we're on the wavelets fragment and handle preview/editor mode
        if (navController.getCurrentDestination() != null && 
            navController.getCurrentDestination().getId() == R.id.navigation_wavelets) {
            androidx.fragment.app.Fragment navHost = getSupportFragmentManager()
                .findFragmentById(R.id.nav_host_fragment_activity_main);
            if (navHost instanceof NavHostFragment) {
                androidx.fragment.app.Fragment currentFragment = ((NavHostFragment) navHost)
                    .getChildFragmentManager().getPrimaryNavigationFragment();
                if (currentFragment instanceof com.emwaver.emwaverandroidapp.ui.wavelets.WaveletsFragment) {
                    com.emwaver.emwaverandroidapp.ui.wavelets.WaveletsFragment waveletsFragment = 
                        (com.emwaver.emwaverandroidapp.ui.wavelets.WaveletsFragment) currentFragment;
                    if (waveletsFragment.isShowingPreview() || waveletsFragment.isShowingEditor()) {
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
    }
    
    private boolean hasRequiredPermissions() {
        // Check basic BLE permissions
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        
        // Check Android 12+ BLE permissions
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
                   ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
                   ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED;
        }
        
        return true;
    }

    @Override
    protected void onStop() {
        super.onStop();
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
    
    // Check if Bluetooth is enabled when resumed
    @Override
    protected void onResume() {
        super.onResume();
        
        // Handle OAuth callback intent (in case app was already running)
        handleOAuthCallback(getIntent());
        
        // Make sure Bluetooth is enabled
        checkBluetoothEnabled();
        
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
        handleOAuthCallback(intent);
    }
    
    private void handleOAuthCallback(Intent intent) {
        if (intent == null) return;
        
        Uri data = intent.getData();
        if (data != null && "emwaver".equals(data.getScheme()) && "oauth".equals(data.getHost())) {
            // OAuth callback - let GitFragment handle it
            // The fragment will check the intent in onResume
        }
    }
    
    private void checkBluetoothEnabled() {
        if (hasRequiredPermissions()) {
            BluetoothManager bluetoothManager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
            if (bluetoothManager != null) {
                BluetoothAdapter bluetoothAdapter = bluetoothManager.getAdapter();
                
                if (bluetoothAdapter != null && !bluetoothAdapter.isEnabled()) {
                    Log.d(TAG, "Requesting to enable Bluetooth");
                    Intent enableBtIntent = new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE);
                    
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
                            startActivityForResult(enableBtIntent, REQUEST_ENABLE_BT);
                        }
                    } else {
                        startActivityForResult(enableBtIntent, REQUEST_ENABLE_BT);
                    }
                }
            }
        }
    }
    
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        
        if (requestCode == REQUEST_ENABLE_BT) {
            if (resultCode == RESULT_OK) {
                Log.d(TAG, "Bluetooth enabled by user");
                // Bluetooth is now enabled, initialize connection manager if needed
                if (connectionManager != null) {
                    connectionManager.initialize();
                }
            } else {
                Log.d(TAG, "User declined to enable Bluetooth");
                Toast.makeText(this, "Bluetooth must be enabled to use BLE functionality", Toast.LENGTH_LONG).show();
            }
        }
    }
}

