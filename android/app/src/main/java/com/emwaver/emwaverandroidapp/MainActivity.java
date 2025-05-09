package com.emwaver.emwaverandroidapp;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.IBinder;
import android.util.Log;
import android.view.View;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.drawerlayout.widget.DrawerLayout;
import androidx.navigation.NavController;
import androidx.navigation.Navigation;
import androidx.navigation.ui.AppBarConfiguration;
import androidx.navigation.ui.NavigationUI;

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
    private BLEService bleService;
    private boolean isBleServiceBound = false;
    private NavController navController;

    private final ServiceConnection bleServiceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName className, IBinder service) {
            BLEService.LocalBinder binder = (BLEService.LocalBinder) service;
            bleService = binder.getService();
            isBleServiceBound = true;
            Log.d(TAG, "BLE Service Connected");
        }

        @Override
        public void onServiceDisconnected(ComponentName arg0) {
            isBleServiceBound = false;
            Log.d(TAG, "BLE Service Disconnected");
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        binding = ActivityMainBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        DrawerLayout drawer = binding.drawerLayout;
        NavigationView navigationView = binding.navView;

        // Set up the AppBarConfiguration with BLE replacing USB
        appBarConfiguration = new AppBarConfiguration.Builder(
                R.id.navigation_cc1101, R.id.navigation_rfid,
                R.id.navigation_sampler, R.id.navigation_console, R.id.navigation_buttons,
                R.id.navigation_emwaver, R.id.navigation_template,
                R.id.navigation_firmware_update, R.id.navigation_bad_usb, R.id.navigation_ghz24)
                .setOpenableLayout(drawer)
                .build();

        navController = Navigation.findNavController(this, R.id.nav_host_fragment_activity_main);
        NavigationUI.setupActionBarWithNavController(this, navController, appBarConfiguration);
        NavigationUI.setupWithNavController(navigationView, navController);
        
        // Set up Bottom Navigation
        BottomNavigationView bottomNavigationView = binding.bottomNavView;
        NavigationUI.setupWithNavController(bottomNavigationView, navController);
        
        // Only show bottom navigation items that are in the bottom navigation menu
        bottomNavigationView.setOnItemSelectedListener(item -> {
            navController.navigate(item.getItemId());
            return true;
        });
        
        // Update bottom navigation when destination changes
        navController.addOnDestinationChangedListener((controller, destination, arguments) -> {
            int destinationId = destination.getId();
            if (destinationId == R.id.navigation_emwaver || 
                destinationId == R.id.navigation_cc1101 || 
                destinationId == R.id.navigation_sampler || 
                destinationId == R.id.navigation_console || 
                destinationId == R.id.navigation_buttons) {
                bottomNavigationView.setVisibility(View.VISIBLE);
                bottomNavigationView.getMenu().findItem(destinationId).setChecked(true);
            } else {
                // Hide bottom navigation for other destinations not in the bottom nav menu
                bottomNavigationView.setVisibility(View.GONE);
            }
        });

        // Add settings menu item click listener
        navigationView.getMenu().findItem(R.id.navigation_settings).setOnMenuItemClickListener(item -> {
            startActivity(new Intent(this, SettingsActivity.class));
            return true;
        });

        // Request ALL necessary permissions at startup
        requestAllRequiredPermissions();
        
        // Start BLE service only after permissions are requested
        // The service will be started in onRequestPermissionsResult if permissions are granted
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
            // All permissions already granted, start BLE service
            startBleService();
        }
    }
    
    private void startBleService() {
        Log.d(TAG, "Starting BLE Service");
        Intent bleServiceIntent = new Intent(this, BLEService.class);
        startService(bleServiceIntent);
    }

    @Override
    public boolean onSupportNavigateUp() {
        NavController navController = Navigation.findNavController(this, R.id.nav_host_fragment_activity_main);
        return NavigationUI.navigateUp(navController, appBarConfiguration)
                || super.onSupportNavigateUp();
    }

    @Override
    protected void onStart() {
        super.onStart();
        
        // Only bind to the service if we have the necessary permissions
        if (hasRequiredPermissions()) {
            // Bind to the BLE service
            Intent bleIntent = new Intent(this, BLEService.class);
            bindService(bleIntent, bleServiceConnection, Context.BIND_AUTO_CREATE);
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
                   ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        }
        
        return true;
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Unbind from the BLE service
        if (isBleServiceBound) {
            unbindService(bleServiceConnection);
            isBleServiceBound = false;
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
                
                // Start BLE service now that we have permissions
                startBleService();
                
                // Bind to service as well
                Intent bleIntent = new Intent(this, BLEService.class);
                bindService(bleIntent, bleServiceConnection, Context.BIND_AUTO_CREATE);
            } else {
                // Notify the user that the app needs these permissions
                Toast.makeText(this, "This app requires the requested permissions to function properly", Toast.LENGTH_LONG).show();
                Log.e(TAG, "Some permissions were not granted");
            }
        }
    }
    
    // Check if Bluetooth is enabled when resumed
    @Override
    protected void onResume() {
        super.onResume();
        
        // Make sure Bluetooth is enabled
        checkBluetoothEnabled();
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
                // Bluetooth is now enabled, start/bind service if needed
                if (!isBleServiceBound) {
                    startBleService();
                    Intent bleIntent = new Intent(this, BLEService.class);
                    bindService(bleIntent, bleServiceConnection, Context.BIND_AUTO_CREATE);
                }
            } else {
                Log.d(TAG, "User declined to enable Bluetooth");
                Toast.makeText(this, "Bluetooth must be enabled to use BLE functionality", Toast.LENGTH_LONG).show();
            }
        }
    }
}


