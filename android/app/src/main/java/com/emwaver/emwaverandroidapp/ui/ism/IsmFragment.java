package com.emwaver.emwaverandroidapp.ui.ism;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.text.Editable;
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.Log;
import android.util.TypedValue;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.constraintlayout.widget.ConstraintLayout;
import androidx.constraintlayout.widget.ConstraintSet;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.databinding.FragmentIsmBinding;
import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.Utils;


import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Consumer;

public class IsmFragment extends Fragment {

    private FragmentIsmBinding binding;
    private CC1101 cc1101;
    private BLEService bleService;
    private boolean isServiceBound = false;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Map<String, TextView> registerTextViews = new HashMap<>();

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName className, IBinder service) {
            BLEService.LocalBinder binder = (BLEService.LocalBinder) service;
            bleService = binder.getService();
            isServiceBound = true;
            cc1101 = new CC1101(bleService);
            Log.i("service binding", "onServiceConnected");
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (isServiceBound && bleService != null && bleService.checkConnection()) {
                    loadRegisters();
                    loadRFParameters(); // This calls loadCC1101Registers internally
                } else {
                    showDisconnectedState();
                    showToast("Please connect to the BLE device first");
                }
            }, 500); // 0.5 second delay
        }

        @Override
        public void onServiceDisconnected(ComponentName arg0) {
            isServiceBound = false;
            Log.i("service binding", "onServiceDisconnected");
        }
    };

    public static IsmFragment newInstance() {
        return new IsmFragment();
    }

    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        binding = FragmentIsmBinding.inflate(inflater, container, false);
        return binding.getRoot();
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        // Initially show progress wheels and hide content
        binding.registersProgressBar.setVisibility(View.VISIBLE);
        binding.registersContainer.setVisibility(View.GONE);
        binding.rfParametersProgressBar.setVisibility(View.VISIBLE);
        binding.rfParametersContainer.setVisibility(View.GONE);
        
        // Set up spinners
        setupSpinners();

        setupClickListeners();
    }

    private class ModulationAdapter extends ArrayAdapter<String> {
        private final int[] MOD_VALUES = {
            CC1101.MOD_2FSK,  // 2-FSK
            CC1101.MOD_GFSK,  // GFSK
            CC1101.MOD_ASK,   // ASK/OOK
            CC1101.MOD_4FSK,  // 4-FSK
            CC1101.MOD_MSK    // MSK
        };

        public ModulationAdapter(Context context, int resource) {
            super(context, resource);
        }

        @Override
        public int getPosition(String item) {
            for (int i = 0; i < MOD_VALUES.length; i++) {
                if (item.equals(getItem(i))) {
                    return i;
                }
            }
            return 0;
        }

        public int getModValue(int position) {
            return MOD_VALUES[position];
        }

        public int getPositionForModValue(int modValue) {
            for (int i = 0; i < MOD_VALUES.length; i++) {
                if (MOD_VALUES[i] == modValue) {
                    return i;
                }
            }
            return 0;
        }
    }

    private class PowerAdapter extends ArrayAdapter<String> {
        private final int[] POWER_VALUES = {
            CC1101.POWER_MINUS_30_DBM,  // -30 dBm
            CC1101.POWER_MINUS_20_DBM,  // -20 dBm
            CC1101.POWER_MINUS_15_DBM,  // -15 dBm
            CC1101.POWER_MINUS_10_DBM,  // -10 dBm
            CC1101.POWER_0_DBM,         // 0 dBm
            CC1101.POWER_5_DBM,         // 5 dBm
            CC1101.POWER_7_DBM,         // 7 dBm
            CC1101.POWER_10_DBM         // 10 dBm
        };

        public PowerAdapter(Context context, int resource) {
            super(context, resource);
        }

        @Override
        public int getPosition(String item) {
            // Parse the dBm value from the string (e.g., "-30 dBm" -> -30)
            try {
                int dbm = Integer.parseInt(item.split(" ")[0]);
                return getPositionForPowerValue(dbm);
            } catch (Exception e) {
                return 0;
            }
        }

        public int getPowerValue(int position) {
            if (position >= 0 && position < POWER_VALUES.length) {
                return POWER_VALUES[position];
            }
            return POWER_VALUES[0]; // Default to lowest power if invalid position
        }

        public int getPositionForPowerValue(int powerValue) {
            for (int i = 0; i < POWER_VALUES.length; i++) {
                if (POWER_VALUES[i] == powerValue) {
                    return i;
                }
            }
            // If no exact match is found, find the closest value
            int closestPosition = 0;
            int minDifference = Math.abs(POWER_VALUES[0] - powerValue);
            
            for (int i = 1; i < POWER_VALUES.length; i++) {
                int difference = Math.abs(POWER_VALUES[i] - powerValue);
                if (difference < minDifference) {
                    minDifference = difference;
                    closestPosition = i;
                }
            }
            return closestPosition;
        }
    }

    private void setupSpinners() {
        // Modulation Format Spinner
        String[] modulationFormats = getResources().getStringArray(R.array.modulation_formats);
        ModulationAdapter modulationAdapter = new ModulationAdapter(requireContext(),
                android.R.layout.simple_spinner_item);
        
        for (String format : modulationFormats) {
            modulationAdapter.add(format);
        }
        
        modulationAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        binding.modulationFormatSpinner.setAdapter(modulationAdapter);

        // TX Power Spinner
        String[] powerLevels = getResources().getStringArray(R.array.tx_power_levels);
        PowerAdapter powerAdapter = new PowerAdapter(requireContext(),
                android.R.layout.simple_spinner_item);
        
        for (String level : powerLevels) {
            powerAdapter.add(level);
        }
        
        powerAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        binding.txPowerSpinner.setAdapter(powerAdapter);
    }

    private void loadRFParameters() {
        if (!isServiceBound || bleService == null || !bleService.checkConnection() || cc1101 == null) {
            Log.e("ismFragment", "Not connected or CC1101 not initialized when trying to load RF parameters.");
            showDisconnectedState();
            return;
        }

        try {
            // Frequency
            double frequency = cc1101.getFrequency();
            binding.frequencyTextView.setText(String.format(Locale.US, "%.6f", frequency));

            // Data Rate
            int dataRate = cc1101.getDataRate();
            binding.dataRateTextView.setText(String.format(Locale.US, "%d", dataRate));

            // Bandwidth
            double bandwidth = cc1101.getBandwidth();
            binding.bandwidthTextView.setText(String.format(Locale.US, "%.1f", bandwidth));

            // Deviation
            int deviation = cc1101.getDeviation();
            binding.deviationTextView.setText(String.format(Locale.US, "%d", deviation));

            // Modulation Format
            int modulation = cc1101.getModulation();
            ModulationAdapter adapter = (ModulationAdapter) binding.modulationFormatSpinner.getAdapter();
            binding.modulationFormatSpinner.setSelection(adapter.getPositionForModValue(modulation));

            // TX Power
            int txPower = cc1101.getPowerLevel();
            PowerAdapter powerAdapter = (PowerAdapter) binding.txPowerSpinner.getAdapter();
            binding.txPowerSpinner.setSelection(powerAdapter.getPositionForPowerValue(txPower));

            // Load CC1101 Registers
            loadCC1101Registers();

            // After loading all parameters, hide progress bar and show content
            binding.rfParametersProgressBar.setVisibility(View.GONE);
            binding.rfParametersContainer.setVisibility(View.VISIBLE);
        } catch (Exception e) {
            Log.e("ismFragment", "Error loading RF parameters", e);
            showToast("Error loading RF parameters. Check connection.");
            showDisconnectedState();
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        if (!isServiceBound && getActivity() != null) {
            Intent intent = new Intent(getActivity(), BLEService.class);
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

    private void loadCC1101Registers() {
        if (binding == null) {
            Log.e("ismFragment", "Binding is null in loadCC1101Registers");
            return;
        }
        if (!isServiceBound || cc1101 == null || bleService == null || !bleService.checkConnection()) {
            Log.e("ismFragment", "Not connected or CC1101 not initialized when trying to load CC1101 registers.");
            return;
        }

        try {
            List<String> registers = Arrays.asList(
                    "IOCFG2", "IOCFG1", "IOCFG0", "FIFOTHR", "SYNC1", "SYNC0", "PKTLEN", "PKTCTRL1", "PKTCTRL0",
                    "ADDR", "CHANNR", "FSCTRL1", "FSCTRL0", "FREQ2", "FREQ1", "FREQ0", "MDMCFG4", "MDMCFG3",
                    "MDMCFG2", "MDMCFG1", "MDMCFG0", "DEVIATN", "MCSM2", "MCSM1", "MCSM0", "FOCCFG", "BSCFG",
                    "AGCTRL2", "AGCTRL1", "AGCTRL0", "WOREVT1", "WOREVT0", "WORCTRL", "FREND1", "FREND0",
                    "FSCAL3", "FSCAL2", "FSCAL1", "FSCAL0", "RCCTRL1", "RCCTRL0", "FSTEST", "PTEST", "AGCTEST",
                    "TEST2", "TEST1", "TEST0"
            );

            for (int i = 0; i < registers.size(); i++) {
                String register = registers.get(i);
                TextView textView = registerTextViews.get(register);
                if (textView != null) {
                    byte value = cc1101.readReg((byte) i);
                    String hexValue = String.format("%02X", value);
                    textView.setText(hexValue);
                    Log.d("ismFragment", "Setting " + register + " to " + hexValue);
                } else {
                    Log.e("ismFragment", "TextView not found for " + register);
                }
            }

            // Handle status registers separately
            List<String> statusRegisters = Arrays.asList(
                    "PARTNUM", "VERSION", "FREQEST", "LQI", "RSSI", "MARCSTATE",
                    "WORTIME1", "WORTIME0", "PKTSTATUS", "VCO_VC_DAC", "TXBYTES", "RXBYTES"
            );

            for (int i = 0; i < statusRegisters.size(); i++) {
                String register = statusRegisters.get(i);
                TextView textView = registerTextViews.get(register);
                if (textView != null) {
                    byte value = cc1101.readReg((byte) (CC1101.PARTNUM + i | CC1101.READ_BURST));
                    String hexValue = String.format("%02X", value);
                    textView.setText(hexValue);
                    Log.d("ismFragment", "Setting status register " + register + " to " + hexValue);
                } else {
                    Log.e("ismFragment", "TextView not found for status register " + register);
                }
            }

            // Handle PA_TABLE separately as it requires burst read
            byte[] paTableValues = cc1101.readBurstReg(CC1101.PATABLE, 8);
            for (int i = 0; i < 8; i++) {
                String register = "PA_TABLE" + i;
                TextView textView = registerTextViews.get(register);
                if (textView != null) {
                    String hexValue = String.format("%02X", paTableValues[i]);
                    textView.setText(hexValue);
                    Log.d("ismFragment", "Setting " + register + " to " + hexValue);
                } else {
                    Log.e("ismFragment", "TextView not found for " + register);
                }
            }
        } catch (Exception e) {
            Log.e("ismFragment", "Error reading CC1101 registers", e);
            showToast("Error reading registers. Check connection.");
        }
    }

    private void loadRegisters() {
        if (binding == null) {
            Log.e("ismFragment", "Binding is null");
            return;
        }

        // Check connection status before proceeding
        if (!isServiceBound || bleService == null || !bleService.checkConnection()) {
            Log.e("ismFragment", "Not connected when trying to load registers UI.");
            showDisconnectedState();
            return;
        }

        // Clear existing views
        binding.registersContainer.removeAllViews();
        registerTextViews.clear();

        List<String> registers = Arrays.asList(
                "IOCFG2", "IOCFG1", "IOCFG0", "FIFOTHR", "SYNC1", "SYNC0", "PKTLEN", "PKTCTRL1", "PKTCTRL0",
                "ADDR", "CHANNR", "FSCTRL1", "FSCTRL0", "FREQ2", "FREQ1", "FREQ0", "MDMCFG4", "MDMCFG3",
                "MDMCFG2", "MDMCFG1", "MDMCFG0", "DEVIATN", "MCSM2", "MCSM1", "MCSM0", "FOCCFG", "BSCFG",
                "AGCTRL2", "AGCTRL1", "AGCTRL0", "WOREVT1", "WOREVT0", "WORCTRL", "FREND1", "FREND0",
                "FSCAL3", "FSCAL2", "FSCAL1", "FSCAL0", "RCCTRL1", "RCCTRL0", "FSTEST", "PTEST", "AGCTEST",
                "TEST2", "TEST1", "TEST0"
        );

        ConstraintLayout registersContainer = binding.registersContainer;
        TextView previousTextView = binding.registersTitle; // Assuming you have a title TextView

        int marginInPixels = (int) (8 * getResources().getDisplayMetrics().density); // 8dp margin

        for (String register : registers) {
            TextView registerAddressTextView = new TextView(requireContext());
            registerAddressTextView.setId(View.generateViewId());
            registerAddressTextView.setText(register);
            ConstraintLayout.LayoutParams layoutParams = new ConstraintLayout.LayoutParams(
                    ConstraintLayout.LayoutParams.WRAP_CONTENT,
                    ConstraintLayout.LayoutParams.WRAP_CONTENT
            );
            layoutParams.topMargin = marginInPixels;
            registerAddressTextView.setLayoutParams(layoutParams);

            TextView registerValueTextView = new TextView(requireContext());
            registerValueTextView.setId(View.generateViewId());
            registerValueTextView.setText("00"); // Set text instead of hint
            registerValueTextView.setClickable(true);
            registerValueTextView.setBackground(getResources().getDrawable(android.R.drawable.list_selector_background));
            registerValueTextView.setOnClickListener(v -> showEditDialog(register, registerValueTextView.getText().toString(), newValue -> {
                if (!isServiceBound || cc1101 == null || bleService == null || !bleService.checkConnection()) {
                    showToast("Not connected. Cannot write register.");
                    return;
                }
                try {
                    byte value = (byte) Integer.parseInt(newValue, 16);
                    cc1101.writeReg((byte) registers.indexOf(register), value);
                    registerValueTextView.setText(newValue);
                } catch (NumberFormatException e) {
                    showToast("Invalid hexadecimal value");
                }
            }));

            registerTextViews.put(register, registerValueTextView);

            registersContainer.addView(registerAddressTextView);
            registersContainer.addView(registerValueTextView);

            ConstraintSet constraintSet = new ConstraintSet();
            constraintSet.clone(registersContainer);

            // Constrain TextView
            constraintSet.connect(registerAddressTextView.getId(), ConstraintSet.START, ConstraintSet.PARENT_ID, ConstraintSet.START);
            constraintSet.connect(registerAddressTextView.getId(), ConstraintSet.TOP, previousTextView.getId(), ConstraintSet.BOTTOM);

            // Constrain TextView
            constraintSet.connect(registerValueTextView.getId(), ConstraintSet.END, ConstraintSet.PARENT_ID, ConstraintSet.END);
            constraintSet.connect(registerValueTextView.getId(), ConstraintSet.TOP, registerAddressTextView.getId(), ConstraintSet.TOP);
            constraintSet.connect(registerValueTextView.getId(), ConstraintSet.BOTTOM, registerAddressTextView.getId(), ConstraintSet.BOTTOM);

            constraintSet.applyTo(registersContainer);

            previousTextView = registerAddressTextView; // Update for the next iteration
        }

        // Handle status registers separately
        List<String> statusRegisters = Arrays.asList(
                "PARTNUM", "VERSION", "FREQEST", "LQI", "RSSI", "MARCSTATE",
                "WORTIME1", "WORTIME0", "PKTSTATUS", "VCO_VC_DAC", "TXBYTES", "RXBYTES"
        );

        for (String register : statusRegisters) {
            TextView registerAddressTextView = new TextView(requireContext());
            registerAddressTextView.setId(View.generateViewId());
            registerAddressTextView.setText(register);
            ConstraintLayout.LayoutParams layoutParams = new ConstraintLayout.LayoutParams(
                    ConstraintLayout.LayoutParams.WRAP_CONTENT,
                    ConstraintLayout.LayoutParams.WRAP_CONTENT
            );
            layoutParams.topMargin = marginInPixels;
            registerAddressTextView.setLayoutParams(layoutParams);

            TextView registerValueTextView = new TextView(requireContext());
            registerValueTextView.setId(View.generateViewId());
            registerValueTextView.setText("00"); // Set text instead of hint
            registerValueTextView.setClickable(true);
            registerValueTextView.setBackground(getResources().getDrawable(android.R.drawable.list_selector_background));
            registerValueTextView.setOnClickListener(v -> showEditDialog(register, registerValueTextView.getText().toString(), newValue -> {
                if (!isServiceBound || cc1101 == null || bleService == null || !bleService.checkConnection()) {
                    showToast("Not connected. Cannot write register.");
                    return;
                }
                try {
                    byte value = (byte) Integer.parseInt(newValue, 16);
                    cc1101.writeReg((byte) (registers.size() + statusRegisters.indexOf(register)), value);
                    registerValueTextView.setText(newValue);
                } catch (NumberFormatException e) {
                    showToast("Invalid hexadecimal value");
                }
            }));

            registerTextViews.put(register, registerValueTextView);

            registersContainer.addView(registerAddressTextView);
            registersContainer.addView(registerValueTextView);

            ConstraintSet constraintSet = new ConstraintSet();
            constraintSet.clone(registersContainer);

            // Constrain TextView
            constraintSet.connect(registerAddressTextView.getId(), ConstraintSet.START, ConstraintSet.PARENT_ID, ConstraintSet.START);
            constraintSet.connect(registerAddressTextView.getId(), ConstraintSet.TOP, previousTextView.getId(), ConstraintSet.BOTTOM);

            // Constrain TextView
            constraintSet.connect(registerValueTextView.getId(), ConstraintSet.END, ConstraintSet.PARENT_ID, ConstraintSet.END);
            constraintSet.connect(registerValueTextView.getId(), ConstraintSet.TOP, registerAddressTextView.getId(), ConstraintSet.TOP);
            constraintSet.connect(registerValueTextView.getId(), ConstraintSet.BOTTOM, registerAddressTextView.getId(), ConstraintSet.BOTTOM);

            constraintSet.applyTo(registersContainer);

            previousTextView = registerAddressTextView; // Update for the next iteration
        }

        // Handle PA_TABLE separately
        for (int i = 0; i < 8; i++) {
            final int index = i;  // Create a final variable to use in the lambda
            String register = "PA_TABLE" + index;
            TextView registerAddressTextView = new TextView(requireContext());
            registerAddressTextView.setId(View.generateViewId());
            registerAddressTextView.setText(register);
            ConstraintLayout.LayoutParams layoutParams = new ConstraintLayout.LayoutParams(
                    ConstraintLayout.LayoutParams.WRAP_CONTENT,
                    ConstraintLayout.LayoutParams.WRAP_CONTENT
            );
            layoutParams.topMargin = marginInPixels;
            registerAddressTextView.setLayoutParams(layoutParams);

            TextView registerValueTextView = new TextView(requireContext());
            registerValueTextView.setId(View.generateViewId());
            registerValueTextView.setText("00"); // Set text instead of hint
            registerValueTextView.setClickable(true);
            registerValueTextView.setBackground(getResources().getDrawable(android.R.drawable.list_selector_background));
            registerValueTextView.setOnClickListener(v -> showEditDialog(register, registerValueTextView.getText().toString(), newValue -> {
                if (!isServiceBound || cc1101 == null || bleService == null || !bleService.checkConnection()) {
                    showToast("Not connected. Cannot write register.");
                    return;
                }
                try {
                    byte value = (byte) Integer.parseInt(newValue, 16);
                    cc1101.writeReg((byte) (CC1101.PATABLE + index), value);
                    registerValueTextView.setText(newValue);
                } catch (NumberFormatException e) {
                    showToast("Invalid hexadecimal value");
                }
            }));

            registerTextViews.put(register, registerValueTextView);

            registersContainer.addView(registerAddressTextView);
            registersContainer.addView(registerValueTextView);

            ConstraintSet constraintSet = new ConstraintSet();
            constraintSet.clone(registersContainer);

            // Constrain TextView
            constraintSet.connect(registerAddressTextView.getId(), ConstraintSet.START, ConstraintSet.PARENT_ID, ConstraintSet.START);
            constraintSet.connect(registerAddressTextView.getId(), ConstraintSet.TOP, previousTextView.getId(), ConstraintSet.BOTTOM);

            // Constrain TextView
            constraintSet.connect(registerValueTextView.getId(), ConstraintSet.END, ConstraintSet.PARENT_ID, ConstraintSet.END);
            constraintSet.connect(registerValueTextView.getId(), ConstraintSet.TOP, registerAddressTextView.getId(), ConstraintSet.TOP);
            constraintSet.connect(registerValueTextView.getId(), ConstraintSet.BOTTOM, registerAddressTextView.getId(), ConstraintSet.BOTTOM);

            constraintSet.applyTo(registersContainer);

            previousTextView = registerAddressTextView; // Update for the next iteration
        }

        // After adding all views, update their values
        loadCC1101Registers();

        // Hide progress wheel and show registers container
        binding.registersProgressBar.setVisibility(View.GONE);
        binding.registersContainer.setVisibility(View.VISIBLE);
        Log.d("ismFragment", "Registers container set to visible");
    }

    private void setupClickListeners() {
        binding.frequencyTextView.setOnClickListener(v -> {
            if (!isServiceBound || bleService == null || !bleService.checkConnection()) {
                showToast("Not connected"); return;
            }
            showEditDialog("Frequency", binding.frequencyTextView.getText().toString(), this::updateFrequency);
        });
        binding.dataRateTextView.setOnClickListener(v -> {
             if (!isServiceBound || bleService == null || !bleService.checkConnection()) {
                 showToast("Not connected"); return;
             }
            showEditDialog("Data Rate", binding.dataRateTextView.getText().toString(), this::updateDataRate);
        });
        binding.bandwidthTextView.setOnClickListener(v -> {
             if (!isServiceBound || bleService == null || !bleService.checkConnection()) {
                 showToast("Not connected"); return;
             }
            showEditDialog("Bandwidth", binding.bandwidthTextView.getText().toString(), this::updateBandwidth);
        });
        binding.deviationTextView.setOnClickListener(v -> {
             if (!isServiceBound || bleService == null || !bleService.checkConnection()) {
                 showToast("Not connected"); return;
             }
            showEditDialog("Deviation", binding.deviationTextView.getText().toString(), this::updateDeviation);
        });
    }

    private void showEditDialog(String title, String currentValue, Consumer<String> updateFunction) {
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle("Edit " + title);

        final EditText input = new EditText(requireContext());
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        input.setText(currentValue);
        
        // Create a container for the EditText
        FrameLayout container = new FrameLayout(requireContext());
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 
                ViewGroup.LayoutParams.WRAP_CONTENT);
        params.leftMargin = params.rightMargin = 
            (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 20,
            getResources().getDisplayMetrics());
        input.setLayoutParams(params);
        container.addView(input);
        
        builder.setView(container);

        builder.setPositiveButton("OK", (dialog, which) -> {
            String newValue = input.getText().toString();
            updateFunction.accept(newValue);
        });
        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());

        AlertDialog dialog = builder.create();
        dialog.setOnShowListener(dialogInterface -> {
            input.addTextChangedListener(new TextWatcher() {
                @Override
                public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

                @Override
                public void onTextChanged(CharSequence s, int start, int before, int count) {}

                @Override
                public void afterTextChanged(Editable s) {
                    String input = s.toString();
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(input.matches("[0-9A-Fa-f]+") && input.length() > 0);
                }
            });
        });
        dialog.show();
    }

    private void updateFrequency(String newValue) {
        Log.d("updateFrequency", "update freq");
        if (!isServiceBound || cc1101 == null || bleService == null || !bleService.checkConnection()) {
            showToast("Not connected");
            return;
        }
        try {
            double frequency = Double.parseDouble(newValue);
            if (cc1101.setFrequencyMHz(frequency)) {
                reloadCardViews();
            } else {
                showToast("Failed to set frequency");
            }
        } catch (NumberFormatException e) {
            showToast("Invalid frequency value");
        }
    }

    private void updateDataRate(String newValue) {
        if (!isServiceBound || cc1101 == null || bleService == null || !bleService.checkConnection()) {
            showToast("Not connected");
            return;
        }
        try {
            int dataRate = Integer.parseInt(newValue);
            if (cc1101.setDataRate(dataRate)) {
                reloadCardViews();
            } else {
                showToast("Failed to set data rate");
            }
        } catch (NumberFormatException e) {
            showToast("Invalid data rate value");
        }
    }

    private void updateBandwidth(String newValue) {
        if (!isServiceBound || cc1101 == null || bleService == null || !bleService.checkConnection()) {
            showToast("Not connected");
            return;
        }
        try {
            double bandwidth = Double.parseDouble(newValue);
            if (cc1101.setBandwidth(bandwidth)) {
                reloadCardViews();
            } else {
                showToast("Failed to set bandwidth");
            }
        } catch (NumberFormatException e) {
            showToast("Invalid bandwidth value");
        }
    }

    private void updateDeviation(String newValue) {
        if (!isServiceBound || cc1101 == null || bleService == null || !bleService.checkConnection()) {
            showToast("Not connected");
            return;
        }
        try {
            int deviation = Integer.parseInt(newValue);
            if (cc1101.setDeviation(deviation)) {
                reloadCardViews();
            } else {
                showToast("Failed to set deviation");
            }
        } catch (NumberFormatException e) {
            showToast("Invalid deviation value");
        }
    }

    private void reloadCardViews() {
        Log.i("reloadCardViews", "here");
        loadRFParameters();
        loadRegisters();
    }

    private void showToast(String message) {
        if (getContext() != null) {
            Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show();
        } else {
            Log.w("ismFragment", "Context not available for Toast: " + message);
        }
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

    private void showDisconnectedState() {
        if (binding != null) {
            binding.registersProgressBar.setVisibility(View.GONE);
            binding.registersContainer.setVisibility(View.GONE);
            binding.rfParametersProgressBar.setVisibility(View.GONE);
            binding.rfParametersContainer.setVisibility(View.GONE);
        }
        Log.d("ismFragment", "UI updated to disconnected state.");
    }
}
