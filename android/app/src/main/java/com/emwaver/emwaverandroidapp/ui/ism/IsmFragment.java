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

package com.emwaver.emwaverandroidapp.ui.ism;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.Log;
import android.util.TypedValue;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.graphics.drawable.Drawable;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.AdapterView;
import android.view.Gravity;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.constraintlayout.widget.ConstraintLayout;
import androidx.constraintlayout.widget.ConstraintSet;
import androidx.fragment.app.Fragment;
import androidx.core.content.ContextCompat;
import androidx.core.view.MenuHost;
import androidx.core.view.MenuProvider;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.ViewModelProvider;

import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.databinding.FragmentIsmBinding;
import com.emwaver.emwaverandroidapp.DeviceConnectionManager;
import com.emwaver.emwaverandroidapp.DeviceConnectionService;
import com.emwaver.emwaverandroidapp.Utils;

import java.io.ByteArrayOutputStream;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Consumer;

public class IsmFragment extends Fragment {

    private FragmentIsmBinding binding;
    private DeviceConnectionManager connectionManager;
    private DeviceConnectionService activeService;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private IsmViewModel viewModel;
    private Map<String, TextView> registerTextViews = new HashMap<>();
    private Thread loadingThread;
    private AlertDialog loadingDialog;
    private TextView loadingDialogCommandText;
    private TextView loadingDialogCountText;
    private ProgressBar loadingDialogProgressBar;
    private volatile boolean loadingCancelled = false;
    private int totalLoadSteps = 0;
    private int completedSteps = 0;
    private boolean suppressRfControlCallbacks = false;
    private int rfControlSuppressDepth = 0;
    private RadioChip rfControlsChip = RadioChip.UNKNOWN;

    private enum RadioChip {
        UNKNOWN,
        CC1101
    }

    private RadioChip selectedChip = RadioChip.UNKNOWN;

    private static final class RegisterSpec {
        final String name;
        final byte addr;

        RegisterSpec(String name, int addr) {
            this.name = name;
            this.addr = (byte) (addr & 0xFF);
        }
    }

    private static RegisterSpec reg(String name, int addr) {
        return new RegisterSpec(name, addr);
    }

    private static final List<RegisterSpec> CC1101_CONFIG_REGISTERS = Arrays.asList(
            reg("IOCFG2", 0x00),
            reg("IOCFG1", 0x01),
            reg("IOCFG0", 0x02),
            reg("FIFOTHR", 0x03),
            reg("SYNC1", 0x04),
            reg("SYNC0", 0x05),
            reg("PKTLEN", 0x06),
            reg("PKTCTRL1", 0x07),
            reg("PKTCTRL0", 0x08),
            reg("ADDR", 0x09),
            reg("CHANNR", 0x0A),
            reg("FSCTRL1", 0x0B),
            reg("FSCTRL0", 0x0C),
            reg("FREQ2", 0x0D),
            reg("FREQ1", 0x0E),
            reg("FREQ0", 0x0F),
            reg("MDMCFG4", 0x10),
            reg("MDMCFG3", 0x11),
            reg("MDMCFG2", 0x12),
            reg("MDMCFG1", 0x13),
            reg("MDMCFG0", 0x14),
            reg("DEVIATN", 0x15),
            reg("MCSM2", 0x16),
            reg("MCSM1", 0x17),
            reg("MCSM0", 0x18),
            reg("FOCCFG", 0x19),
            reg("BSCFG", 0x1A),
            reg("AGCCTRL2", 0x1B),
            reg("AGCCTRL1", 0x1C),
            reg("AGCCTRL0", 0x1D),
            reg("WOREVT1", 0x1E),
            reg("WOREVT0", 0x1F),
            reg("WORCTRL", 0x20),
            reg("FREND1", 0x21),
            reg("FREND0", 0x22),
            reg("FSCAL3", 0x23),
            reg("FSCAL2", 0x24),
            reg("FSCAL1", 0x25),
            reg("FSCAL0", 0x26),
            reg("RCCTRL1", 0x27),
            reg("RCCTRL0", 0x28),
            reg("FSTEST", 0x29),
            reg("PTEST", 0x2A),
            reg("AGCTEST", 0x2B),
            reg("TEST2", 0x2C),
            reg("TEST1", 0x2D),
            reg("TEST0", 0x2E)
    );

    private static final List<RegisterSpec> CC1101_STATUS_REGISTERS = Arrays.asList(
            reg("PARTNUM", 0x30),
            reg("VERSION", 0x31),
            reg("FREQEST", 0x32),
            reg("LQI", 0x33),
            reg("RSSI", 0x34),
            reg("MARCSTATE", 0x35),
            reg("WORTIME1", 0x36),
            reg("WORTIME0", 0x37),
            reg("PKTSTATUS", 0x38),
            reg("VCO_VC_DAC", 0x39),
            reg("TXBYTES", 0x3A),
            reg("RXBYTES", 0x3B),
            reg("RCCTRL1_STATUS", 0x3C),
            reg("RCCTRL0_STATUS", 0x3D)
    );

    private static final int RF_PARAMETER_STEPS = 6;
    private static final int CC1101_PA_TABLE_SIZE = 8;
    private static final byte CC1101_PATABLE_ADDR = (byte) 0x3E;

    // Desktop-parity CC1101 wiring uses encoded CS pin `4`.
    private static final int DEFAULT_CC1101_CS = 4;

    // Binary protocol opcodes (must match script_bootstrap + firmware).
    private static final int EMW_OP_SPI_XFER = 0x50;

    // CC1101 modulation values (MDMCFG2.MOD_FORMAT)
    private static final int CC1101_MOD_2FSK = 0;
    private static final int CC1101_MOD_GFSK = 1;
    private static final int CC1101_MOD_ASK = 3;
    private static final int CC1101_MOD_4FSK = 4;
    private static final int CC1101_MOD_MSK = 7;

    private static final double CC1101_F_XTAL_HZ = 26_000_000.0;
    private static final byte CC1101_REG_FREQ2 = 0x0D;
    private static final byte CC1101_REG_FREQ1 = 0x0E;
    private static final byte CC1101_REG_FREQ0 = 0x0F;
    private static final byte CC1101_REG_MDMCFG4 = 0x10;
    private static final byte CC1101_REG_MDMCFG3 = 0x11;
    private static final byte CC1101_REG_MDMCFG2 = 0x12;
    private static final byte CC1101_REG_DEVIATN = 0x15;
    private static final byte CC1101_REG_FREND0 = 0x22;

    private static final int[] CC1101_POWER_LEVELS_DBM = {-30, -20, -15, -10, 0, 5, 7, 10};
    private static final byte[] CC1101_POWER_SETTING_315MHZ = {
            (byte) 0x12, (byte) 0x0D, (byte) 0x1C, (byte) 0x34,
            (byte) 0x51, (byte) 0x85, (byte) 0xCB, (byte) 0xC2
    };
    private static final byte[] CC1101_POWER_SETTING_433MHZ = {
            (byte) 0x12, (byte) 0x0E, (byte) 0x1D, (byte) 0x34,
            (byte) 0x60, (byte) 0x84, (byte) 0xC8, (byte) 0xC0
    };
    private static final byte[] CC1101_POWER_SETTING_868MHZ = {
            (byte) 0x03, (byte) 0x0F, (byte) 0x1E, (byte) 0x27,
            (byte) 0x50, (byte) 0x81, (byte) 0xCB, (byte) 0xC2
    };
    private static final byte[] CC1101_POWER_SETTING_915MHZ = {
            (byte) 0x03, (byte) 0x0E, (byte) 0x1E, (byte) 0x27,
            (byte) 0x8E, (byte) 0xCD, (byte) 0xC7, (byte) 0xC0
    };

    // Command observer for loading dialog
    private volatile Consumer<String> commandObserver;

    public static IsmFragment newInstance() {
        return new IsmFragment();
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        viewModel = new ViewModelProvider(requireActivity()).get(IsmViewModel.class);
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
        applyBottomNavPadding(view);
        rfControlsChip = RadioChip.UNKNOWN;
        rfControlSuppressDepth = 0;
        suppressRfControlCallbacks = false;

        // Show UI immediately; loading happens only when the user triggers it.
        binding.registersProgressBar.setVisibility(View.GONE);
        binding.registersContainer.setVisibility(View.VISIBLE);
        binding.rfParametersProgressBar.setVisibility(View.GONE);
        binding.rfParametersContainer.setVisibility(View.VISIBLE);
        
        setupChipSpinner();

        // Set up spinners
        setupSpinners();

        buildRegisterViews();
        setupMenu();
        setupObservers();
        restoreCachedStateIfAvailable();
        setupClickListeners();
        updateChipDependentVisibility();
    }

    private void applyBottomNavPadding(@NonNull View root) {
        root.post(() -> {
            if (!isAdded()) {
                return;
            }

            BottomNavigationView bottomNav = requireActivity().findViewById(R.id.nav_view_bottom);
            if (bottomNav == null) {
                return;
            }

            int bottomNavHeight = bottomNav.getHeight();
            if (bottomNavHeight <= 0) {
                bottomNav.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED);
                bottomNavHeight = bottomNav.getMeasuredHeight();
            }

            if (bottomNavHeight > 0 && root.getPaddingBottom() != bottomNavHeight) {
                root.setPadding(root.getPaddingLeft(), root.getPaddingTop(), root.getPaddingRight(), bottomNavHeight);
            }
        });
    }

    private class Cc1101ModulationAdapter extends ArrayAdapter<String> {
        private final int[] MOD_VALUES = {
                CC1101_MOD_2FSK,
                CC1101_MOD_GFSK,
                CC1101_MOD_ASK,
                CC1101_MOD_4FSK,
                CC1101_MOD_MSK
        };

        public Cc1101ModulationAdapter(Context context, int resource) {
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
            if (position >= 0 && position < MOD_VALUES.length) {
                return MOD_VALUES[position];
            }
            return MOD_VALUES[0];
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
            -30, -20, -15, -10, 0, 5, 7, 10
        };

        public PowerAdapter(Context context, int resource) {
            super(context, resource);
        }

        @Override
        public int getPosition(String item) {
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
            return POWER_VALUES[0];
        }

        public int getPositionForPowerValue(int powerValue) {
            for (int i = 0; i < POWER_VALUES.length; i++) {
                if (POWER_VALUES[i] == powerValue) {
                    return i;
                }
            }
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
        // TX Power Spinner
        String[] powerLevels = getResources().getStringArray(R.array.tx_power_levels);
        PowerAdapter powerAdapter = new PowerAdapter(requireContext(),
                android.R.layout.simple_spinner_item);
        
        for (String level : powerLevels) {
            powerAdapter.add(level);
        }
        
        powerAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        binding.txPowerSpinner.setAdapter(powerAdapter);

        applyRfControlAdaptersForChip();
        setupRfControlListeners();
    }

    private void applyRfControlAdaptersForChip() {
        if (binding == null) return;
        withRfControlsSuppressed(() -> {
            String[] modulationFormats = getResources().getStringArray(R.array.cc1101_modulation_formats);
            Cc1101ModulationAdapter modulationAdapter = new Cc1101ModulationAdapter(requireContext(),
                    android.R.layout.simple_spinner_item);
            for (String format : modulationFormats) {
                modulationAdapter.add(format);
            }
            modulationAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
            binding.modulationFormatSpinner.setAdapter(modulationAdapter);
        });
    }

    private void setupRfControlListeners() {
        if (binding == null) return;

        binding.modulationFormatSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (suppressRfControlCallbacks || selectedChip == RadioChip.UNKNOWN) return;
                // Only act on user-driven changes (avoid programmatic adapter/selection updates).
                if (parent != null && !parent.isPressed()) return;
                if (!ensureConnected()) return;
                if (!ensureCc1101Open()) {
                    return;
                }
                applyModulationAndPowerFromUi();
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });

        binding.txPowerSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (suppressRfControlCallbacks || selectedChip == RadioChip.UNKNOWN) return;
                // Only act on user-driven changes (avoid programmatic adapter/selection updates).
                if (parent != null && !parent.isPressed()) return;
                if (!ensureConnected()) return;
                if (!ensureCc1101Open()) {
                    return;
                }
                applyModulationAndPowerFromUi();
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });
    }

    private void applyModulationAndPowerFromUi() {
        if (binding == null) return;
        if (!(binding.txPowerSpinner.getAdapter() instanceof PowerAdapter)) return;
        PowerAdapter powerAdapter = (PowerAdapter) binding.txPowerSpinner.getAdapter();
        int dbm = powerAdapter.getPowerValue(binding.txPowerSpinner.getSelectedItemPosition());

        if (!(binding.modulationFormatSpinner.getAdapter() instanceof Cc1101ModulationAdapter)) return;
        int modulation = ((Cc1101ModulationAdapter) binding.modulationFormatSpinner.getAdapter())
                .getModValue(binding.modulationFormatSpinner.getSelectedItemPosition());

        if (!cc1101SetModulationAndPower(modulation, dbm)) {
            showToast("Failed to update CC1101 modulation/power");
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        connectionManager = DeviceConnectionManager.getInstance(requireContext());
        activeService = connectionManager.getActiveService();

        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (!isAdded()) {
                return;
            }
            if (isConnected()) {
                showContent();
            } else {
                showDisconnectedState();
            }
        }, 250);
    }

    @Override
    public void onStop() {
        super.onStop();
        cancelLoadingThread();
        // No explicit close command in firmware yet; we just stop sending.
        commandObserver = null;
        dismissLoadingDialog();
        loadingCancelled = false;
    }

    private DeviceConnectionService getActiveService() {
        if (connectionManager == null && isAdded()) {
            connectionManager = DeviceConnectionManager.getInstance(requireContext());
        }
        if (connectionManager != null) {
            activeService = connectionManager.getActiveService();
        }
        return activeService;
    }

    private boolean isConnected() {
        DeviceConnectionService service = getActiveService();
        return service != null && service.checkConnection();
    }

    private boolean ensureConnected() {
        if (isConnected()) {
            return true;
        }
        showToast("Not connected");
        showDisconnectedState();
        return false;
    }


    private void setupClickListeners() {
        binding.loadButton.setOnClickListener(v -> refreshData(true));

        binding.frequencyTextView.setOnClickListener(v -> {
            if (!ensureConnected()) return;
            showNumberEditDialog("Frequency (MHz)", binding.frequencyTextView.getText().toString(), true, this::updateFrequency);
        });
        binding.dataRateTextView.setOnClickListener(v -> {
             if (!ensureConnected()) return;
            showNumberEditDialog("Data Rate", binding.dataRateTextView.getText().toString(), false, this::updateDataRate);
        });
        binding.bandwidthTextView.setOnClickListener(v -> {
             if (!ensureConnected()) return;
            boolean allowDecimal = selectedChip == RadioChip.CC1101;
            showNumberEditDialog("Bandwidth (kHz)", binding.bandwidthTextView.getText().toString(), allowDecimal, this::updateBandwidth);
        });
        binding.deviationTextView.setOnClickListener(v -> {
             if (!ensureConnected()) return;
            showNumberEditDialog("Deviation (Hz)", binding.deviationTextView.getText().toString(), false, this::updateDeviation);
        });
    }

    private void setupMenu() {
        MenuHost menuHost = requireActivity();
        menuHost.addMenuProvider(new MenuProvider() {
            @Override
            public void onCreateMenu(@NonNull Menu menu, @NonNull MenuInflater menuInflater) {
                menuInflater.inflate(R.menu.ism_menu, menu);
            }

            @Override
            public boolean onMenuItemSelected(@NonNull MenuItem menuItem) {
                if (menuItem.getItemId() == R.id.action_refresh_ism) {
                    refreshData(true);
                    return true;
                }
                return false;
            }
        }, getViewLifecycleOwner(), Lifecycle.State.RESUMED);
    }

    private void setupObservers() {
        viewModel.getRegisterValues().observe(getViewLifecycleOwner(), this::applyRegisterValues);
        viewModel.getRfParameters().observe(getViewLifecycleOwner(), this::applyRfParameters);
        viewModel.hasLoaded().observe(getViewLifecycleOwner(), loaded -> {
            if (Boolean.TRUE.equals(loaded)) {
                showContent();
            }
        });
    }

    private void restoreCachedStateIfAvailable() {
        if (viewModel == null) {
            return;
        }
        if (selectedChip == RadioChip.UNKNOWN) {
            return;
        }
        if (Boolean.TRUE.equals(viewModel.hasLoaded().getValue())) {
            Map<String, String> cachedRegisters = viewModel.getRegisterValues().getValue();
            if (cachedRegisters != null) {
                applyRegisterValues(cachedRegisters);
            }
            IsmViewModel.RfParameters params = viewModel.getRfParameters().getValue();
            if (params != null) {
                applyRfParameters(params);
            }
            showContent();
        }
    }

    private void applyRegisterValues(Map<String, String> values) {
        if (values == null || binding == null || registerTextViews.isEmpty()) {
            return;
        }
        for (Map.Entry<String, String> entry : values.entrySet()) {
            TextView textView = registerTextViews.get(entry.getKey());
            if (textView != null && entry.getValue() != null) {
                textView.setText(entry.getValue());
            }
        }
    }

    private void applyRfParameters(IsmViewModel.RfParameters params) {
        if (selectedChip == RadioChip.UNKNOWN || params == null || binding == null) {
            return;
        }
        binding.frequencyTextView.setText(String.format(Locale.US, "%.6f", params.getFrequencyMHz()));
        binding.dataRateTextView.setText(String.format(Locale.US, "%d", params.getDataRate()));
        binding.bandwidthTextView.setText(String.format(Locale.US, "%.1f", params.getBandwidthKHz()));
        binding.deviationTextView.setText(String.format(Locale.US, "%d", params.getDeviationHz()));

        suppressRfControlCallbacks = true;
        try {
            if (binding.modulationFormatSpinner.getAdapter() instanceof Cc1101ModulationAdapter) {
                Cc1101ModulationAdapter adapter = (Cc1101ModulationAdapter) binding.modulationFormatSpinner.getAdapter();
                binding.modulationFormatSpinner.setSelection(adapter.getPositionForModValue(params.getModulation()));
            }
            if (binding.txPowerSpinner.getAdapter() instanceof PowerAdapter) {
                PowerAdapter powerAdapter = (PowerAdapter) binding.txPowerSpinner.getAdapter();
                binding.txPowerSpinner.setSelection(powerAdapter.getPositionForPowerValue(params.getTxPowerDbm()));
            }
        } finally {
            suppressRfControlCallbacks = false;
        }
    }

    private void showContent() {
        if (binding == null) {
            return;
        }
        binding.registersProgressBar.setVisibility(View.GONE);
        binding.registersContainer.setVisibility(View.VISIBLE);
        binding.rfParametersProgressBar.setVisibility(View.GONE);
        binding.rfParametersContainer.setVisibility(View.VISIBLE);
        updateChipDependentVisibility();
    }

    private void startInitialLoad() {
        if (!isAdded()) {
            return;
        }
        if (viewModel != null && Boolean.TRUE.equals(viewModel.hasLoaded().getValue())) {
            showContent();
            return;
        }
        refreshData(true);
    }

    private void showLoadingDialog() {
        if (!isAdded()) {
            return;
        }

        if (loadingDialog != null && loadingDialog.isShowing()) {
            return;
        }

        LinearLayout container = new LinearLayout(requireContext());
        container.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 16,
                getResources().getDisplayMetrics());
        container.setPadding(padding, padding, padding, padding);

        ProgressBar progressBar = new ProgressBar(requireContext(), null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setIndeterminate(false);
        progressBar.setMax(Math.max(totalLoadSteps, 1));
        progressBar.setProgress(completedSteps);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        progressParams.topMargin = 0;
        progressParams.bottomMargin = padding / 2;
        container.addView(progressBar, progressParams);

        TextView countText = new TextView(requireContext());
        countText.setText(String.format(Locale.US, "%d / %d", completedSteps, totalLoadSteps));
        countText.setGravity(Gravity.END);
        countText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        LinearLayout.LayoutParams countParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        countParams.bottomMargin = padding / 4;
        container.addView(countText, countParams);

        TextView commandText = new TextView(requireContext());
        commandText.setText("Preparing...");
        container.addView(commandText, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        String chipName = selectedChip == RadioChip.CC1101 ? "CC1101" : "Radio";
        builder.setTitle("Initializing " + chipName);
        builder.setView(container);
        builder.setNegativeButton("Cancel", null);
        builder.setCancelable(false);

        loadingDialog = builder.create();
        loadingDialog.show();

        Button cancelButton = loadingDialog.getButton(AlertDialog.BUTTON_NEGATIVE);
        if (cancelButton != null) {
            cancelButton.setOnClickListener(v -> {
                loadingCancelled = true;
                cancelLoadingThread();
                showDisconnectedState();
            });
        }

        loadingDialogCommandText = commandText;
        loadingDialogProgressBar = progressBar;
        loadingDialogCountText = countText;
        updateLoadingProgressUI();
    }

    private void initializeProgressTracking() {
        totalLoadSteps = calculateTotalLoadSteps();
        if (totalLoadSteps <= 0) {
            totalLoadSteps = 1;
        }
        completedSteps = 0;
        if (viewModel != null) {
            viewModel.resetLoadingState();
        }
        updateLoadingProgressUI();
    }

    private int calculateTotalLoadSteps() {
        int steps = getConfigRegisters().size() + getStatusRegisters().size();
        if (selectedChip == RadioChip.CC1101) {
            steps += CC1101_PA_TABLE_SIZE;
        }
        if (selectedChip == RadioChip.CC1101) {
            steps += RF_PARAMETER_STEPS;
        }
        return steps;
    }

    private void updateLoadingProgressUI() {
        final int total = Math.max(totalLoadSteps, 1);
        final int progress = Math.min(completedSteps, total);
        handler.post(() -> {
            if (loadingDialogProgressBar != null) {
                loadingDialogProgressBar.setMax(total);
                loadingDialogProgressBar.setProgress(progress);
            }
            if (loadingDialogCountText != null) {
                loadingDialogCountText.setText(String.format(Locale.US, "%d / %d", progress, total));
            }
        });
    }

    private void incrementProgress() {
        synchronized (this) {
            if (completedSteps < totalLoadSteps) {
                completedSteps++;
            }
        }
        updateLoadingProgressUI();
    }

    private void updateLoadingCommand(String command) {
        handler.post(() -> {
            if (loadingDialogCommandText != null) {
                loadingDialogCommandText.setText(command);
            }
        });
    }

    private void dismissLoadingDialog() {
        handler.post(() -> {
            if (loadingDialog != null) {
                if (loadingDialog.isShowing()) {
                    loadingDialog.dismiss();
                }
                loadingDialog = null;
            }
            loadingDialogCommandText = null;
            loadingDialogProgressBar = null;
            loadingDialogCountText = null;
        });
    }

    private void cancelLoadingThread() {
        loadingCancelled = true;
        Thread thread = loadingThread;
        if (thread != null && thread.isAlive()) {
            thread.interrupt();
        }
    }

    private void refreshData(boolean showDialog) {
        if (!isAdded() || binding == null) {
            return;
        }

        if (selectedChip == RadioChip.UNKNOWN) {
            showToast("Select a radio chip first");
            showContent();
            return;
        }

        if (!isConnected()) {
            handler.post(this::showDisconnectedState);
            return;
        }

        cancelLoadingThread();
        loadingCancelled = false;
        initializeProgressTracking();

        binding.registersProgressBar.setVisibility(View.VISIBLE);
        binding.registersContainer.setVisibility(View.GONE);
        binding.rfParametersProgressBar.setVisibility(View.VISIBLE);
        binding.rfParametersContainer.setVisibility(View.VISIBLE);
        updateChipDependentVisibility();

        buildRegisterViews();
        final Consumer<String> commandObserver = this::updateLoadingCommand;
        this.commandObserver = commandObserver;

        if (showDialog) {
            showLoadingDialog();
        }

        // Ensure radio is initialized before any operations (and show command in the dialog while doing so).
        if (!ensureCc1101Open()) {
            Log.e("IsmFragment", "Failed to initialize radio: " + selectedChip);
            this.commandObserver = null;
            handler.post(this::showDisconnectedState);
            return;
        }

        loadingThread = new Thread(() -> {
            boolean registersLoaded = populateRegisterValues();
            boolean rfLoaded = false;
            if (!loadingCancelled && registersLoaded) {
                rfLoaded = loadRfParametersData();
            }
            final boolean success = !loadingCancelled && registersLoaded && rfLoaded;
            this.commandObserver = null;
            if (viewModel != null) {
                viewModel.setLoaded(success);
            }
            handler.post(() -> {
                if (loadingCancelled || !success) {
                    showDisconnectedState();
                } else {
                    dismissLoadingDialog();
                    showContent();
                }
                loadingCancelled = false;
            });
            loadingThread = null;
        }, "ISM-LoadThread");
        loadingThread.start();
    }

    private List<RegisterSpec> getConfigRegisters() {
        if (selectedChip == RadioChip.CC1101) return CC1101_CONFIG_REGISTERS;
        return java.util.Collections.emptyList();
    }

    private List<RegisterSpec> getStatusRegisters() {
        if (selectedChip == RadioChip.CC1101) return CC1101_STATUS_REGISTERS;
        return java.util.Collections.emptyList();
    }

    private void buildRegisterViews() {
        if (binding == null) {
            return;
        }

        ConstraintLayout registersContainer = binding.registersContainer;
        int childCount = registersContainer.getChildCount();
        if (childCount > 1) {
            registersContainer.removeViews(1, childCount - 1);
        }
        registerTextViews.clear();

        TextView previousTextView = binding.registersTitle;
        int marginInPixels = (int) (8 * getResources().getDisplayMetrics().density);

        if (selectedChip == RadioChip.UNKNOWN) {
            TextView hint = new TextView(requireContext());
            hint.setId(View.generateViewId());
            hint.setText("Select a chip, then tap “Initialize & Read”.");
            ConstraintLayout.LayoutParams layoutParams = new ConstraintLayout.LayoutParams(
                    ConstraintLayout.LayoutParams.WRAP_CONTENT,
                    ConstraintLayout.LayoutParams.WRAP_CONTENT
            );
            layoutParams.topMargin = marginInPixels;
            hint.setLayoutParams(layoutParams);
            registersContainer.addView(hint);

            ConstraintSet constraintSet = new ConstraintSet();
            constraintSet.clone(registersContainer);
            constraintSet.connect(hint.getId(), ConstraintSet.START, ConstraintSet.PARENT_ID, ConstraintSet.START);
            constraintSet.connect(hint.getId(), ConstraintSet.TOP, binding.registersTitle.getId(), ConstraintSet.BOTTOM);
            constraintSet.applyTo(registersContainer);
            return;
        }

        for (int i = 0; i < getConfigRegisters().size(); i++) {
            final RegisterSpec spec = getConfigRegisters().get(i);
            final String registerName = spec.name;
            final byte registerAddress = spec.addr;

            TextView registerAddressTextView = new TextView(requireContext());
            registerAddressTextView.setId(View.generateViewId());
            registerAddressTextView.setText(registerName);
            ConstraintLayout.LayoutParams layoutParams = new ConstraintLayout.LayoutParams(
                    ConstraintLayout.LayoutParams.WRAP_CONTENT,
                    ConstraintLayout.LayoutParams.WRAP_CONTENT
            );
            layoutParams.topMargin = marginInPixels;
            registerAddressTextView.setLayoutParams(layoutParams);

            TextView registerValueTextView = new TextView(requireContext());
            registerValueTextView.setId(View.generateViewId());
            registerValueTextView.setText("--");
            registerValueTextView.setClickable(true);
            Drawable configBackground = ContextCompat.getDrawable(requireContext(), android.R.drawable.list_selector_background);
            if (configBackground != null) {
                registerValueTextView.setBackground(configBackground);
            }
            registerValueTextView.setOnClickListener(v -> showEditDialog(registerName, registerValueTextView.getText().toString(), newValue -> {
                if (!ensureConnected()) return;
                try {
                    byte value = (byte) Integer.parseInt(newValue, 16);
                    writeReg(registerAddress, value);
                    String formatted = String.format(Locale.US, "%02X", value & 0xFF);
                    registerValueTextView.setText(formatted);
                    if (viewModel != null) {
                        viewModel.postRegisterValue(registerName, formatted);
                    }
                } catch (NumberFormatException e) {
                    showToast("Invalid hexadecimal value");
                } catch (Exception e) {
                    Log.e("ismFragment", "Failed to update register", e);
                    showToast("Failed to update register");
                }
            }));

            registerTextViews.put(registerName, registerValueTextView);

            registersContainer.addView(registerAddressTextView);
            registersContainer.addView(registerValueTextView);

            ConstraintSet constraintSet = new ConstraintSet();
            constraintSet.clone(registersContainer);
            constraintSet.connect(registerAddressTextView.getId(), ConstraintSet.START, ConstraintSet.PARENT_ID, ConstraintSet.START);
            constraintSet.connect(registerAddressTextView.getId(), ConstraintSet.TOP, previousTextView.getId(), ConstraintSet.BOTTOM);
            constraintSet.connect(registerValueTextView.getId(), ConstraintSet.END, ConstraintSet.PARENT_ID, ConstraintSet.END);
            constraintSet.connect(registerValueTextView.getId(), ConstraintSet.TOP, registerAddressTextView.getId(), ConstraintSet.TOP);
            constraintSet.connect(registerValueTextView.getId(), ConstraintSet.BOTTOM, registerAddressTextView.getId(), ConstraintSet.BOTTOM);
            constraintSet.applyTo(registersContainer);

            previousTextView = registerAddressTextView;
        }

        for (int i = 0; i < getStatusRegisters().size(); i++) {
            final RegisterSpec spec = getStatusRegisters().get(i);
            final String registerName = spec.name;

            TextView registerAddressTextView = new TextView(requireContext());
            registerAddressTextView.setId(View.generateViewId());
            registerAddressTextView.setText(registerName);
            ConstraintLayout.LayoutParams layoutParams = new ConstraintLayout.LayoutParams(
                    ConstraintLayout.LayoutParams.WRAP_CONTENT,
                    ConstraintLayout.LayoutParams.WRAP_CONTENT
            );
            layoutParams.topMargin = marginInPixels;
            registerAddressTextView.setLayoutParams(layoutParams);

            TextView registerValueTextView = new TextView(requireContext());
            registerValueTextView.setId(View.generateViewId());
            registerValueTextView.setText("--");
            registerValueTextView.setClickable(false);

            registerTextViews.put(registerName, registerValueTextView);

            registersContainer.addView(registerAddressTextView);
            registersContainer.addView(registerValueTextView);

            ConstraintSet constraintSet = new ConstraintSet();
            constraintSet.clone(registersContainer);
            constraintSet.connect(registerAddressTextView.getId(), ConstraintSet.START, ConstraintSet.PARENT_ID, ConstraintSet.START);
            constraintSet.connect(registerAddressTextView.getId(), ConstraintSet.TOP, previousTextView.getId(), ConstraintSet.BOTTOM);
            constraintSet.connect(registerValueTextView.getId(), ConstraintSet.END, ConstraintSet.PARENT_ID, ConstraintSet.END);
            constraintSet.connect(registerValueTextView.getId(), ConstraintSet.TOP, registerAddressTextView.getId(), ConstraintSet.TOP);
            constraintSet.connect(registerValueTextView.getId(), ConstraintSet.BOTTOM, registerAddressTextView.getId(), ConstraintSet.BOTTOM);
            constraintSet.applyTo(registersContainer);

            previousTextView = registerAddressTextView;
        }

        if (selectedChip == RadioChip.CC1101) {
            for (int i = 0; i < CC1101_PA_TABLE_SIZE; i++) {
                final int index = i;
                final String registerName = "PA_TABLE" + index;

                TextView registerAddressTextView = new TextView(requireContext());
                registerAddressTextView.setId(View.generateViewId());
                registerAddressTextView.setText(registerName);
                ConstraintLayout.LayoutParams layoutParams = new ConstraintLayout.LayoutParams(
                        ConstraintLayout.LayoutParams.WRAP_CONTENT,
                        ConstraintLayout.LayoutParams.WRAP_CONTENT
                );
                layoutParams.topMargin = marginInPixels;
                registerAddressTextView.setLayoutParams(layoutParams);

                TextView registerValueTextView = new TextView(requireContext());
                registerValueTextView.setId(View.generateViewId());
                registerValueTextView.setText("--");
                registerValueTextView.setClickable(true);
                Drawable paBackground = ContextCompat.getDrawable(requireContext(), android.R.drawable.list_selector_background);
                if (paBackground != null) {
                    registerValueTextView.setBackground(paBackground);
                }
                registerValueTextView.setOnClickListener(v -> showEditDialog(registerName, registerValueTextView.getText().toString(), newValue -> {
                    if (!ensureConnected()) return;
                    try {
                        byte value = (byte) Integer.parseInt(newValue, 16);
                        byte[] table = cc1101ReadBurstReg(CC1101_PATABLE_ADDR, CC1101_PA_TABLE_SIZE);
                        if (table.length < CC1101_PA_TABLE_SIZE) {
                            showToast("Failed to read PA table");
                            return;
                        }
                        table[index] = value;
                        if (!cc1101WriteBurstReg(CC1101_PATABLE_ADDR, table)) {
                            showToast("Failed to write PA table");
                            return;
                        }
                        byte[] verify = cc1101ReadBurstReg(CC1101_PATABLE_ADDR, CC1101_PA_TABLE_SIZE);
                        if (verify.length >= CC1101_PA_TABLE_SIZE) {
                            for (int j = 0; j < CC1101_PA_TABLE_SIZE; j++) {
                                final String key = "PA_TABLE" + j;
                                final String formatted = String.format(Locale.US, "%02X", verify[j] & 0xFF);
                                TextView tv = registerTextViews.get(key);
                                if (tv != null) {
                                    tv.setText(formatted);
                                }
                                if (viewModel != null) {
                                    viewModel.postRegisterValue(key, formatted);
                                }
                            }
                        } else {
                            String formatted = String.format(Locale.US, "%02X", value & 0xFF);
                            registerValueTextView.setText(formatted);
                            if (viewModel != null) {
                                viewModel.postRegisterValue(registerName, formatted);
                            }
                        }
                    } catch (NumberFormatException e) {
                        showToast("Invalid hexadecimal value");
                    } catch (Exception e) {
                        Log.e("ismFragment", "Failed to update PA table", e);
                        showToast("Failed to update PA table");
                    }
                }));

                registerTextViews.put(registerName, registerValueTextView);

                registersContainer.addView(registerAddressTextView);
                registersContainer.addView(registerValueTextView);

                ConstraintSet constraintSet = new ConstraintSet();
                constraintSet.clone(registersContainer);
                constraintSet.connect(registerAddressTextView.getId(), ConstraintSet.START, ConstraintSet.PARENT_ID, ConstraintSet.START);
                constraintSet.connect(registerAddressTextView.getId(), ConstraintSet.TOP, previousTextView.getId(), ConstraintSet.BOTTOM);
                constraintSet.connect(registerValueTextView.getId(), ConstraintSet.END, ConstraintSet.PARENT_ID, ConstraintSet.END);
                constraintSet.connect(registerValueTextView.getId(), ConstraintSet.TOP, registerAddressTextView.getId(), ConstraintSet.TOP);
                constraintSet.connect(registerValueTextView.getId(), ConstraintSet.BOTTOM, registerAddressTextView.getId(), ConstraintSet.BOTTOM);
                constraintSet.applyTo(registersContainer);

                previousTextView = registerAddressTextView;
            }
        }
    }

    private boolean populateRegisterValues() {
        if (!isConnected()) return false;

        try {
            for (int i = 0; i < getConfigRegisters().size(); i++) {
                if (loadingCancelled || Thread.currentThread().isInterrupted()) {
                    return false;
                }
                final RegisterSpec spec = getConfigRegisters().get(i);
                final String registerName = spec.name;
                byte value = readReg(spec.addr);
                final String hexValue = String.format(Locale.US, "%02X", value & 0xFF);
                TextView textView = registerTextViews.get(registerName);
                if (textView != null) {
                    handler.post(() -> {
                        if (binding != null) {
                            textView.setText(hexValue);
                        }
                    });
                }
                if (viewModel != null) {
                    viewModel.postRegisterValue(registerName, hexValue);
                }
                incrementProgress();
            }

            for (int i = 0; i < getStatusRegisters().size(); i++) {
                if (loadingCancelled || Thread.currentThread().isInterrupted()) {
                    return false;
                }
                final RegisterSpec spec = getStatusRegisters().get(i);
                final String registerName = spec.name;
                byte value = readReg(spec.addr);
                final String hexValue = String.format(Locale.US, "%02X", value & 0xFF);
                handler.post(() -> {
                    if (binding != null) {
                        TextView textView = registerTextViews.get(registerName);
                        if (textView != null) {
                            textView.setText(hexValue);
                        }
                    }
                });
                if (viewModel != null) {
                    viewModel.postRegisterValue(registerName, hexValue);
                }
                incrementProgress();
            }

            if (selectedChip == RadioChip.CC1101) {
                byte[] paTableValues = cc1101ReadBurstReg(CC1101_PATABLE_ADDR, CC1101_PA_TABLE_SIZE);
                for (int i = 0; i < paTableValues.length && i < CC1101_PA_TABLE_SIZE; i++) {
                    if (loadingCancelled || Thread.currentThread().isInterrupted()) {
                        return false;
                    }
                    final String registerName = "PA_TABLE" + i;
                    final String hexValue = String.format(Locale.US, "%02X", paTableValues[i] & 0xFF);
                    TextView textView = registerTextViews.get(registerName);
                    if (textView != null) {
                        handler.post(() -> {
                            if (binding != null) {
                                textView.setText(hexValue);
                            }
                        });
                    }
                    if (viewModel != null) {
                        viewModel.postRegisterValue(registerName, hexValue);
                    }
                    incrementProgress();
                }
            }
            return true;
        } catch (Exception e) {
            Log.e("ismFragment", "Error reading registers for " + selectedChip, e);
            handler.post(() -> showToast("Error reading registers. Check connection."));
            return false;
        }
    }

    private boolean loadRfParametersData() {
        if (selectedChip == RadioChip.UNKNOWN) return true;
        if (!isConnected()) return false;

        try {
            double frequency = cc1101GetFrequencyMHz();
            if (loadingCancelled || Thread.currentThread().isInterrupted()) {
                return false;
            }
            handler.post(() -> {
                if (binding != null) {
                    binding.frequencyTextView.setText(String.format(Locale.US, "%.6f", frequency));
                }
            });
            incrementProgress();

            int dataRate = cc1101GetDataRate();
            if (loadingCancelled || Thread.currentThread().isInterrupted()) {
                return false;
            }
            handler.post(() -> {
                if (binding != null) {
                    binding.dataRateTextView.setText(String.format(Locale.US, "%d", dataRate));
                }
            });
            incrementProgress();

            double bandwidth = cc1101GetBandwidthKHz();
            if (loadingCancelled || Thread.currentThread().isInterrupted()) {
                return false;
            }
            handler.post(() -> {
                if (binding != null) {
                    binding.bandwidthTextView.setText(String.format(Locale.US, "%.1f", bandwidth));
                }
            });
            incrementProgress();

            int deviation = cc1101GetDeviation();
            if (loadingCancelled || Thread.currentThread().isInterrupted()) {
                return false;
            }
            handler.post(() -> {
                if (binding != null) {
                    binding.deviationTextView.setText(String.format(Locale.US, "%d", deviation));
                }
            });
            incrementProgress();

            int modulation = cc1101GetModulation();
            if (loadingCancelled || Thread.currentThread().isInterrupted()) {
                return false;
            }
            handler.post(() -> {
                if (binding != null) {
                    suppressRfControlCallbacks = true;
                    try {
                        if (binding.modulationFormatSpinner.getAdapter() instanceof Cc1101ModulationAdapter) {
                            Cc1101ModulationAdapter adapter = (Cc1101ModulationAdapter) binding.modulationFormatSpinner.getAdapter();
                            binding.modulationFormatSpinner.setSelection(adapter.getPositionForModValue(modulation));
                        }
                    } finally {
                        suppressRfControlCallbacks = false;
                    }
                }
            });
            incrementProgress();

            int txPower = cc1101GetPowerLevel();
            if (loadingCancelled || Thread.currentThread().isInterrupted()) {
                return false;
            }
            handler.post(() -> {
                if (binding != null) {
                    suppressRfControlCallbacks = true;
                    try {
                        PowerAdapter powerAdapter = (PowerAdapter) binding.txPowerSpinner.getAdapter();
                        binding.txPowerSpinner.setSelection(powerAdapter.getPositionForPowerValue(txPower));
                    } finally {
                        suppressRfControlCallbacks = false;
                    }
                }
            });
            incrementProgress();

            if (viewModel != null) {
                viewModel.postRfParameters(frequency, dataRate, bandwidth, deviation, modulation, txPower);
            }

            return true;
        } catch (Exception e) {
            Log.e("ismFragment", "Error loading RF parameters", e);
            handler.post(() -> showToast("Error loading RF parameters. Check connection."));
            return false;
        }
    }

    private void showNumberEditDialog(String title, String currentValue, boolean allowDecimal, Consumer<String> updateFunction) {
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle("Edit " + title);

        final EditText input = new EditText(requireContext());
        int inputType = InputType.TYPE_CLASS_NUMBER;
        if (allowDecimal) {
            inputType |= InputType.TYPE_NUMBER_FLAG_DECIMAL;
        }
        input.setInputType(inputType);
        input.setText(currentValue);

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
        builder.setPositiveButton("OK", (dialog, which) -> updateFunction.accept(input.getText().toString().trim()));
        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());

        AlertDialog dialog = builder.create();
        dialog.setOnShowListener(dialogInterface -> {
            String pattern = allowDecimal ? "^[0-9]+(\\.[0-9]+)?$" : "^[0-9]+$";
            dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                    .setEnabled(input.getText().toString().trim().matches(pattern));
            input.addTextChangedListener(new TextWatcher() {
                @Override
                public void beforeTextChanged(CharSequence s, int start, int count, int after) {
                }

                @Override
                public void onTextChanged(CharSequence s, int start, int before, int count) {
                }

                @Override
                public void afterTextChanged(Editable s) {
                    String t = s.toString().trim();
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(t.matches(pattern));
                }
            });
        });
        dialog.show();
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
        if (!ensureConnected()) return;
        try {
            double frequency = Double.parseDouble(newValue);
            if (!ensureCc1101Open()) {
                return;
            }
            if (!cc1101SetFrequencyMHz(frequency)) {
                showToast("Failed to set CC1101 frequency");
                return;
            }
            reloadCardViews();
        } catch (NumberFormatException e) {
            showToast("Invalid frequency value");
        }
    }

    private void updateDataRate(String newValue) {
        if (!ensureConnected()) return;
        try {
            int dataRate = Integer.parseInt(newValue);
            if (!ensureCc1101Open()) {
                return;
            }
            if (!cc1101SetDataRate(dataRate)) {
                showToast("Failed to set CC1101 data rate");
                return;
            }
            reloadCardViews();
        } catch (NumberFormatException e) {
            showToast("Invalid data rate value");
        }
    }

    private void updateBandwidth(String newValue) {
        if (!ensureConnected()) return;
        try {
            if (!ensureCc1101Open()) {
                return;
            }
            double bwKHz = Double.parseDouble(newValue);
            if (!cc1101SetBandwidth(bwKHz)) {
                showToast("Failed to set CC1101 bandwidth");
                return;
            }
            reloadCardViews();
        } catch (NumberFormatException e) {
            showToast("Invalid bandwidth value");
        }
    }

    private void updateDeviation(String newValue) {
        if (!ensureConnected()) return;
        try {
            int deviation = Integer.parseInt(newValue);
            if (!ensureCc1101Open()) {
                return;
            }
            if (!cc1101SetDeviation(deviation)) {
                showToast("Failed to set CC1101 deviation");
                return;
            }
            reloadCardViews();
        } catch (NumberFormatException e) {
            showToast("Invalid deviation value");
        }
    }

    // ===== Firmware command helpers (binary-only; no command strings) =====

    private void notifyCommandObserver(String command) {
        Consumer<String> obs = this.commandObserver;
        if (obs != null) {
            obs.accept(command);
        }
    }

    private byte[] sendPacket(byte[] payload, int timeoutMs) {
        DeviceConnectionService service = getActiveService();
        if (service == null || !service.checkConnection()) {
            return null;
        }
        // Surface something meaningful in the loading dialog.
        notifyCommandObserver("cmd (bin) len=" + (payload != null ? payload.length : 0));
        byte[] resp = service.sendCommand(payload, timeoutMs);
        return resp;
    }

    private byte[] cc1101SpiXfer(byte[] tx, int rxLen, int timeoutMs) {
        if (tx == null) {
            return null;
        }

        // Mini-frame cmd lane is 18 bytes total: [op, cs, rx_req, tx_len, payload...]
        int txLen = Math.min(14, tx.length);
        int rx = Math.max(0, Math.min(17, rxLen));

        byte[] pkt = new byte[4 + txLen];
        pkt[0] = (byte) (EMW_OP_SPI_XFER & 0xFF);
        pkt[1] = (byte) (DEFAULT_CC1101_CS & 0xFF);
        pkt[2] = (byte) (rx & 0xFF);
        pkt[3] = (byte) (txLen & 0xFF);
        System.arraycopy(tx, 0, pkt, 4, txLen);

        notifyCommandObserver("spi xfer (bin) cs=" + DEFAULT_CC1101_CS + " tx=" + txLen + " rx=" + (rx > 0 ? rx : txLen));
        byte[] resp = sendPacket(pkt, timeoutMs);
        if (resp == null || resp.length < 2) {
            return null;
        }
        // Firmware response is: [status=0x80, payload...]
        if ((resp[0] & 0xFF) != 0x80) {
            return null;
        }
        int want = (rx > 0 ? rx : txLen);
        int end = Math.min(resp.length, 1 + want);
        if (end <= 1) {
            return new byte[0];
        }
        byte[] out = new byte[end - 1];
        System.arraycopy(resp, 1, out, 0, out.length);
        return out;
    }

    private static String bytesToHex(byte[] bytes) {
        if (bytes == null) return "";
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format(Locale.US, "%02X ", b & 0xFF));
        }
        return sb.toString().trim();
    }

    private byte readReg(byte addr) {
        int a = addr & 0xFF;
        boolean isStatus = a >= 0x30 && a <= 0x3D;
        int cmd = (a & 0x3F) | (isStatus ? 0xC0 : 0x80);
        byte[] resp = cc1101SpiXfer(new byte[]{(byte) (cmd & 0xFF), 0x00}, 2, 1000);
        if (resp == null || resp.length < 2) {
            return 0;
        }
        return resp[1];
    }

    private void writeReg(byte addr, byte value) {
        int a = addr & 0x3F;
        cc1101SpiXfer(new byte[]{(byte) (a & 0xFF), value}, 0, 1000);
    }

    private byte[] cc1101ReadBurstReg(byte addr, int len) {
        if (selectedChip != RadioChip.CC1101) {
            return new byte[0];
        }

        int want = Math.max(0, Math.min(63, len));
        if (want == 0) {
            return new byte[0];
        }

        // We can only transfer up to 13 data bytes per mini-frame (txLen <= 14 including the command).
        ByteArrayOutputStream out = new ByteArrayOutputStream(want);
        int remaining = want;
        int base = addr & 0x3F;
        while (remaining > 0) {
            int chunk = Math.min(13, remaining);
            byte[] tx = new byte[1 + chunk];
            tx[0] = (byte) ((base | 0xC0) & 0xFF);
            for (int i = 0; i < chunk; i++) {
                tx[1 + i] = 0;
            }
            byte[] resp = cc1101SpiXfer(tx, 0, 1500);
            if (resp == null || resp.length < 1) {
                break;
            }
            // SPI response includes a status byte first; data begins at index 1.
            int take = Math.min(chunk, Math.max(0, resp.length - 1));
            out.write(resp, 1, take);
            remaining -= take;
            if (take < chunk) {
                break;
            }
        }
        return out.toByteArray();
    }

    private boolean cc1101WriteBurstReg(byte addr, byte[] data) {
        if (selectedChip != RadioChip.CC1101) {
            return false;
        }

        if (data == null || data.length == 0) {
            return true;
        }

        int base = addr & 0x3F;
        int offset = 0;
        while (offset < data.length) {
            int chunk = Math.min(13, data.length - offset);
            byte[] tx = new byte[1 + chunk];
            tx[0] = (byte) ((base | 0x40) & 0xFF);
            System.arraycopy(data, offset, tx, 1, chunk);
            byte[] resp = cc1101SpiXfer(tx, 0, 1500);
            if (resp == null) {
                return false;
            }
            offset += chunk;
        }
        return true;
    }

    private void cc1101Strobe(int strobe) {
        cc1101SpiXfer(new byte[]{(byte) (strobe & 0xFF)}, 0, 1000);
    }

    // ===== CC1101 RF parameter helpers (firmware-side register access) =====

    private double cc1101GetFrequencyMHz() {
        if (selectedChip != RadioChip.CC1101) return 0.0;
        int freq2 = readReg(CC1101_REG_FREQ2) & 0xFF;
        int freq1 = readReg(CC1101_REG_FREQ1) & 0xFF;
        int freq0 = readReg(CC1101_REG_FREQ0) & 0xFF;
        long word = ((long) freq2 << 16) | ((long) freq1 << 8) | (long) freq0;
        return (word * (CC1101_F_XTAL_HZ / Math.pow(2, 16))) / 1e6;
    }

    private boolean cc1101SetFrequencyMHz(double frequencyMHz) {
        if (selectedChip != RadioChip.CC1101) return false;
        long word = Math.round(frequencyMHz * 1e6 * Math.pow(2, 16) / CC1101_F_XTAL_HZ);
        byte freq2 = (byte) ((word >> 16) & 0xFF);
        byte freq1 = (byte) ((word >> 8) & 0xFF);
        byte freq0 = (byte) (word & 0xFF);

        writeReg(CC1101_REG_FREQ2, freq2);
        writeReg(CC1101_REG_FREQ1, freq1);
        writeReg(CC1101_REG_FREQ0, freq0);
        cc1101Strobe(54); // SIDLE (0x36)
        cc1101Strobe(51); // SCAL (0x33)

        return Math.abs(cc1101GetFrequencyMHz() - frequencyMHz) < 0.001;
    }

    private int cc1101GetDataRate() {
        if (selectedChip != RadioChip.CC1101) return 0;
        int mdmcfg4 = readReg(CC1101_REG_MDMCFG4) & 0xFF;
        int drateE = mdmcfg4 & 0x0F;
        int drateM = readReg(CC1101_REG_MDMCFG3) & 0xFF;
        double bitRate = ((256.0 + drateM) * Math.pow(2.0, drateE) * CC1101_F_XTAL_HZ) / Math.pow(2.0, 28.0);
        return (int) Math.round(bitRate);
    }

    private boolean cc1101SetDataRate(int bitRate) {
        if (selectedChip != RadioChip.CC1101) return false;
        if (bitRate <= 0) return false;

        double target = bitRate * Math.pow(2.0, 28.0) / CC1101_F_XTAL_HZ;
        double minDifference = Double.MAX_VALUE;
        int bestM = 0;
        int bestE = 0;
        for (int e = 0; e <= 15; e++) {
            for (int m = 0; m <= 255; m++) {
                double currentValue = (256.0 + m) * Math.pow(2.0, e);
                double difference = Math.abs(currentValue - target);
                if (difference < minDifference) {
                    minDifference = difference;
                    bestM = m;
                    bestE = e;
                }
            }
        }

        int mdmcfg4 = readReg(CC1101_REG_MDMCFG4) & 0xFF;
        int bandwidthPart = mdmcfg4 & 0xF0;
        byte newMdmcfg4 = (byte) (bandwidthPart | (bestE & 0x0F));
        byte newMdmcfg3 = (byte) (bestM & 0xFF);
        cc1101WriteBurstReg(CC1101_REG_MDMCFG4, new byte[]{newMdmcfg4, newMdmcfg3});

        byte[] confirm = cc1101ReadBurstReg(CC1101_REG_MDMCFG4, 2);
        return confirm.length == 2 && confirm[0] == newMdmcfg4 && confirm[1] == newMdmcfg3;
    }

    private double cc1101GetBandwidthKHz() {
        if (selectedChip != RadioChip.CC1101) return 0.0;
        int v = readReg(CC1101_REG_MDMCFG4) & 0xFF;
        int bwExp = (v >> 6) & 0x03;
        int bwMant = (v >> 4) & 0x03;
        double bandwidthHz = CC1101_F_XTAL_HZ / (8.0 * (4.0 + bwMant) * Math.pow(2.0, bwExp));
        return bandwidthHz / 1000.0;
    }

    private boolean cc1101SetBandwidth(double bandwidthKHz) {
        if (selectedChip != RadioChip.CC1101) return false;
        if (bandwidthKHz <= 0) return false;
        double targetHz = bandwidthKHz * 1000.0;

        int bestExp = 0;
        int bestMant = 0;
        double bestDiff = Double.MAX_VALUE;
        for (int exp = 0; exp <= 3; exp++) {
            for (int mant = 0; mant <= 3; mant++) {
                double bwHz = CC1101_F_XTAL_HZ / (8.0 * (4.0 + mant) * Math.pow(2.0, exp));
                double diff = Math.abs(bwHz - targetHz);
                if (diff < bestDiff) {
                    bestDiff = diff;
                    bestExp = exp;
                    bestMant = mant;
                }
            }
        }

        int current = readReg(CC1101_REG_MDMCFG4) & 0xFF;
        int drateE = current & 0x0F;
        byte newMdmcfg4 = (byte) ((bestExp << 6) | (bestMant << 4) | drateE);
        writeReg(CC1101_REG_MDMCFG4, newMdmcfg4);
        return readReg(CC1101_REG_MDMCFG4) == newMdmcfg4;
    }

    private int cc1101GetDeviation() {
        if (selectedChip != RadioChip.CC1101) return 0;
        int v = readReg(CC1101_REG_DEVIATN) & 0xFF;
        int deviationM = v & 0x07;
        int deviationE = (v >> 4) & 0x07;
        double deviationHz = ((8.0 + deviationM) * Math.pow(2.0, deviationE)) * (CC1101_F_XTAL_HZ / Math.pow(2.0, 17.0));
        return (int) Math.round(deviationHz);
    }

    private boolean cc1101SetDeviation(int deviationHz) {
        if (selectedChip != RadioChip.CC1101) return false;
        if (deviationHz <= 0) return false;

        int bestE = 0;
        int bestM = 0;
        double bestDiff = Double.MAX_VALUE;
        for (int e = 0; e <= 7; e++) {
            for (int m = 0; m <= 7; m++) {
                double currentHz = ((8.0 + m) * Math.pow(2.0, e)) * (CC1101_F_XTAL_HZ / Math.pow(2.0, 17.0));
                double diff = Math.abs(currentHz - deviationHz);
                if (diff < bestDiff) {
                    bestDiff = diff;
                    bestE = e;
                    bestM = m;
                }
            }
        }

        byte value = (byte) ((bestE << 4) | (bestM & 0x07));
        writeReg(CC1101_REG_DEVIATN, value);
        return readReg(CC1101_REG_DEVIATN) == value;
    }

    private int cc1101GetModulation() {
        if (selectedChip != RadioChip.CC1101) return CC1101_MOD_2FSK;
        int mdmcfg2 = readReg(CC1101_REG_MDMCFG2) & 0xFF;
        return (mdmcfg2 >> 4) & 0x07;
    }

    private int cc1101GetPowerLevel() {
        if (selectedChip != RadioChip.CC1101) return 0;

        double frequencyMHz = cc1101GetFrequencyMHz();
        byte[] powerSettings;
        if (frequencyMHz >= 300 && frequencyMHz <= 348) {
            powerSettings = CC1101_POWER_SETTING_315MHZ;
        } else if (frequencyMHz >= 378 && frequencyMHz <= 464) {
            powerSettings = CC1101_POWER_SETTING_433MHZ;
        } else if (frequencyMHz >= 779 && frequencyMHz <= 899.99) {
            powerSettings = CC1101_POWER_SETTING_868MHZ;
        } else if (frequencyMHz >= 900 && frequencyMHz <= 928) {
            powerSettings = CC1101_POWER_SETTING_915MHZ;
        } else {
            return 0;
        }

        int modulation = cc1101GetModulation();
        byte[] pa = cc1101ReadBurstReg(CC1101_PATABLE_ADDR, 2);
        if (pa.length < 2) return 0;
        int current = (modulation == CC1101_MOD_ASK ? pa[1] : pa[0]) & 0xFF;

        for (int i = 0; i < powerSettings.length && i < CC1101_POWER_LEVELS_DBM.length; i++) {
            if ((powerSettings[i] & 0xFF) == current) {
                return CC1101_POWER_LEVELS_DBM[i];
            }
        }

        int closestIndex = 0;
        int smallestDifference = Integer.MAX_VALUE;
        for (int i = 0; i < powerSettings.length && i < CC1101_POWER_LEVELS_DBM.length; i++) {
            int v = powerSettings[i] & 0xFF;
            int diff = Math.abs(v - current);
            if (diff < smallestDifference) {
                smallestDifference = diff;
                closestIndex = i;
            }
        }
        return CC1101_POWER_LEVELS_DBM[closestIndex];
    }

    private boolean cc1101SetModulationAndPower(int modulation, int dbm) {
        if (selectedChip != RadioChip.CC1101) return false;
        double frequencyMHz = cc1101GetFrequencyMHz();

        int powerIndex = -1;
        for (int i = 0; i < CC1101_POWER_LEVELS_DBM.length; i++) {
            if (dbm == CC1101_POWER_LEVELS_DBM[i]) {
                powerIndex = i;
                break;
            }
        }
        if (powerIndex < 0) return false;

        byte powerSetting;
        if (frequencyMHz >= 300 && frequencyMHz <= 348) {
            powerSetting = CC1101_POWER_SETTING_315MHZ[powerIndex];
        } else if (frequencyMHz >= 378 && frequencyMHz <= 464) {
            powerSetting = CC1101_POWER_SETTING_433MHZ[powerIndex];
        } else if (frequencyMHz >= 779 && frequencyMHz <= 899.99) {
            powerSetting = CC1101_POWER_SETTING_868MHZ[powerIndex];
        } else if (frequencyMHz >= 900 && frequencyMHz <= 928) {
            powerSetting = CC1101_POWER_SETTING_915MHZ[powerIndex];
        } else {
            return false;
        }

        int currentMdmcfg2 = readReg(CC1101_REG_MDMCFG2) & 0xFF;
        byte newMdmcfg2 = (byte) ((currentMdmcfg2 & 0x0F) | ((modulation & 0x07) << 4));
        byte frend0 = (modulation == CC1101_MOD_ASK) ? (byte) 0x11 : (byte) 0x10;
        writeReg(CC1101_REG_MDMCFG2, newMdmcfg2);
        writeReg(CC1101_REG_FREND0, frend0);

        byte[] paTable = new byte[CC1101_PA_TABLE_SIZE];
        if (modulation == CC1101_MOD_ASK) {
            paTable[0] = 0;
            paTable[1] = powerSetting;
        } else {
            paTable[0] = powerSetting;
            paTable[1] = 0;
        }
        if (!cc1101WriteBurstReg(CC1101_PATABLE_ADDR, paTable)) {
            return false;
        }

        return readReg(CC1101_REG_MDMCFG2) == newMdmcfg2 && readReg(CC1101_REG_FREND0) == frend0;
    }

    private void reloadCardViews() {
        refreshData(false);
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
        dismissLoadingDialog();
        if (binding != null) {
            binding.registersProgressBar.setVisibility(View.GONE);
            binding.registersContainer.setVisibility(View.VISIBLE);
            binding.rfParametersProgressBar.setVisibility(View.GONE);
            binding.rfParametersContainer.setVisibility(View.VISIBLE);
            updateChipDependentVisibility();
        }
        Log.d("ismFragment", "UI updated to disconnected state.");
    }

    private void setupChipSpinner() {
        if (binding == null) {
            return;
        }

        if (selectedChip == RadioChip.UNKNOWN) {
            android.content.SharedPreferences preferences =
                    androidx.preference.PreferenceManager.getDefaultSharedPreferences(requireContext());
            String saved = preferences.getString("ism_selected_chip", "");
            if ("CC1101".equalsIgnoreCase(saved)) selectedChip = RadioChip.CC1101;
        }

        ArrayAdapter<String> adapter = new ArrayAdapter<>(
                requireContext(),
                android.R.layout.simple_spinner_item,
                new String[]{"Select chip…", "CC1101"}
        );
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        binding.chipSpinner.setAdapter(adapter);

        int initialSelection;
        if (selectedChip == RadioChip.CC1101) initialSelection = 1;
        else initialSelection = 0;
        binding.chipSpinner.setSelection(initialSelection, false);

        binding.chipSpinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                RadioChip newChip;
                if (position == 1) newChip = RadioChip.CC1101;
                else newChip = RadioChip.UNKNOWN;
                if (newChip == selectedChip) {
                    return;
                }
                selectedChip = newChip;
                android.content.SharedPreferences preferences =
                        androidx.preference.PreferenceManager.getDefaultSharedPreferences(requireContext());
                preferences.edit().putString(
                        "ism_selected_chip",
                        selectedChip == RadioChip.CC1101 ? "CC1101" : ""
                ).apply();
                if (viewModel != null) {
                    viewModel.clearRegisterValues();
                    viewModel.clearRfParameters();
                    viewModel.resetLoadingState();
                }
                buildRegisterViews();
                showContent();
            }

            @Override
            public void onNothingSelected(android.widget.AdapterView<?> parent) {
            }
        });
    }

    private void updateChipDependentVisibility() {
        if (binding == null) return;
        binding.rfm69ParametersContainer.setVisibility(selectedChip == RadioChip.CC1101 ? View.VISIBLE : View.GONE);
        binding.cc1101HintTextView.setVisibility(selectedChip == RadioChip.CC1101 ? View.VISIBLE : View.GONE);
        binding.loadButton.setEnabled(selectedChip == RadioChip.CC1101);
        if (rfControlsChip != selectedChip) {
            applyRfControlAdaptersForChip();
            rfControlsChip = selectedChip;
        }
    }

    private void withRfControlsSuppressed(@NonNull Runnable action) {
        rfControlSuppressDepth++;
        suppressRfControlCallbacks = true;
        try {
            action.run();
        } finally {
            rfControlSuppressDepth = Math.max(0, rfControlSuppressDepth - 1);
            // Some Spinner selection callbacks are posted; clear suppression on next tick.
            handler.post(() -> {
                if (rfControlSuppressDepth == 0) {
                    suppressRfControlCallbacks = false;
                }
            });
        }
    }

    private boolean ensureCc1101Open() {
        if (!ensureConnected()) return false;

        // Probe VERSION status register using the CC1101 SPI protocol.
        // VERSION is at 0x31 (status); read command becomes 0xF1.
        byte version = readReg((byte) 0x31);
        if ((version & 0xFF) == 0x00) {
            showToast("CC1101 probe failed: no response");
            return false;
        }
        return true;
    }
}
