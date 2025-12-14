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
        CC1101,
        RFM69
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

    private static final List<RegisterSpec> RFM69_CONFIG_REGISTERS = Arrays.asList(
            reg("OPMODE", 0x01),
            reg("DATAMODUL", 0x02),
            reg("BITRATEMSB", 0x03),
            reg("BITRATELSB", 0x04),
            reg("FDEVMSB", 0x05),
            reg("FDEVLSB", 0x06),
            reg("FRFMSB", 0x07),
            reg("FRFMID", 0x08),
            reg("FRFLSB", 0x09),
            reg("OSC1", 0x0A),
            reg("AFCCTRL", 0x0B),
            reg("LOWBAT", 0x0C),
            reg("LISTEN1", 0x0D),
            reg("LISTEN2", 0x0E),
            reg("LISTEN3", 0x0F),
            reg("PALEVEL", 0x11),
            reg("PARAMP", 0x12),
            reg("OCP", 0x13),
            reg("LNA", 0x18),
            reg("RXBW", 0x19),
            reg("AFCBW", 0x1A),
            reg("OOKPEAK", 0x1B),
            reg("OOKAVG", 0x1C),
            reg("OOKFIX", 0x1D),
            reg("AFCFEI", 0x1E),
            reg("AFCMSB", 0x1F),
            reg("AFCLSB", 0x20),
            reg("FEIMSB", 0x21),
            reg("FEILSB", 0x22),
            reg("RSSICONFIG", 0x23),
            reg("DIOMAPPING1", 0x25),
            reg("DIOMAPPING2", 0x26),
            reg("IRQFLAGS1", 0x27),
            reg("IRQFLAGS2", 0x28),
            reg("RSSITHRESH", 0x29),
            reg("RXTIMEOUT1", 0x2A),
            reg("RXTIMEOUT2", 0x2B),
            reg("PREAMBLEMSB", 0x2C),
            reg("PREAMBLELSB", 0x2D),
            reg("SYNCCONFIG", 0x2E),
            reg("PACKETCONFIG1", 0x37),
            reg("PAYLOADLENGTH", 0x38),
            reg("NODEADRS", 0x39),
            reg("BROADCASTADRS", 0x3A),
            reg("AUTOMODES", 0x3B),
            reg("FIFOTHRESH", 0x3C),
            reg("PACKETCONFIG2", 0x3D)
    );

    private static final List<RegisterSpec> RFM69_STATUS_REGISTERS = Arrays.asList(
            reg("VERSION", 0x10),
            reg("RSSIVALUE", 0x24),
            reg("TEMP1", 0x4E),
            reg("TEMP2", 0x4F)
    );

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

    // Defaults aligned with `esp/main/main.c` quick-check wiring.
    private static final int DEFAULT_RFM69_MISO = 13;
    private static final int DEFAULT_RFM69_MOSI = 11;
    private static final int DEFAULT_RFM69_SCK = 12;
    private static final int DEFAULT_RFM69_CS = 36;
    private static final boolean DEFAULT_RFM69_CS_ACTIVE_HIGH = true;

    // Defaults aligned with CC1101 wiring used elsewhere in the repo (IO10 for NSS).
    private static final int DEFAULT_CC1101_MISO = 13;
    private static final int DEFAULT_CC1101_MOSI = 11;
    private static final int DEFAULT_CC1101_SCK = 12;
    private static final int DEFAULT_CC1101_CS = 10;
    private static final boolean DEFAULT_CC1101_CS_ACTIVE_HIGH = false;

    // Modulation values (must match firmware expectations)
    private static final int MOD_FSK = 0;
    private static final int MOD_OOK = 1;

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

    private class ModulationAdapter extends ArrayAdapter<String> {
        private final int[] MOD_VALUES = {
            MOD_FSK,  // FSK
            MOD_OOK   // ASK/OOK
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
            if (selectedChip == RadioChip.CC1101) {
                String[] modulationFormats = getResources().getStringArray(R.array.cc1101_modulation_formats);
                Cc1101ModulationAdapter modulationAdapter = new Cc1101ModulationAdapter(requireContext(),
                        android.R.layout.simple_spinner_item);
                for (String format : modulationFormats) {
                    modulationAdapter.add(format);
                }
                modulationAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
                binding.modulationFormatSpinner.setAdapter(modulationAdapter);
            } else {
                String[] modulationFormats = getResources().getStringArray(R.array.modulation_formats);
                ModulationAdapter modulationAdapter = new ModulationAdapter(requireContext(),
                        android.R.layout.simple_spinner_item);
                for (String format : modulationFormats) {
                    modulationAdapter.add(format);
                }
                modulationAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
                binding.modulationFormatSpinner.setAdapter(modulationAdapter);
            }
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
                if (!ensureSelectedChipOpen()) {
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
                if (!ensureSelectedChipOpen()) {
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

        int modulation;
        if (binding.modulationFormatSpinner.getAdapter() instanceof Cc1101ModulationAdapter) {
            modulation = ((Cc1101ModulationAdapter) binding.modulationFormatSpinner.getAdapter())
                    .getModValue(binding.modulationFormatSpinner.getSelectedItemPosition());
        } else if (binding.modulationFormatSpinner.getAdapter() instanceof ModulationAdapter) {
            modulation = ((ModulationAdapter) binding.modulationFormatSpinner.getAdapter())
                    .getModValue(binding.modulationFormatSpinner.getSelectedItemPosition());
        } else {
            return;
        }

        if (selectedChip == RadioChip.RFM69) {
            sendCommand("rfm69 set_mod --mod=" + (modulation == MOD_OOK ? "ook" : "fsk"), 1000);
            sendCommand("rfm69 set_power --dbm=" + dbm, 1000);
            return;
        }

        if (selectedChip == RadioChip.CC1101) {
            if (!cc1101SetModulationAndPower(modulation, dbm)) {
                showToast("Failed to update CC1101 modulation/power");
            }
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
            } else if (binding.modulationFormatSpinner.getAdapter() instanceof ModulationAdapter) {
                ModulationAdapter adapter = (ModulationAdapter) binding.modulationFormatSpinner.getAdapter();
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
        String chipName = selectedChip == RadioChip.RFM69 ? "RFM69"
                : (selectedChip == RadioChip.CC1101 ? "CC1101" : "Radio");
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
        if (selectedChip == RadioChip.RFM69 || selectedChip == RadioChip.CC1101) {
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
        if (!ensureSelectedChipOpen()) {
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
        if (selectedChip == RadioChip.RFM69) return RFM69_CONFIG_REGISTERS;
        if (selectedChip == RadioChip.CC1101) return CC1101_CONFIG_REGISTERS;
        return java.util.Collections.emptyList();
    }

    private List<RegisterSpec> getStatusRegisters() {
        if (selectedChip == RadioChip.RFM69) return RFM69_STATUS_REGISTERS;
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
            double frequency = selectedChip == RadioChip.CC1101 ? cc1101GetFrequencyMHz() : getFrequency();
            if (loadingCancelled || Thread.currentThread().isInterrupted()) {
                return false;
            }
            handler.post(() -> {
                if (binding != null) {
                    binding.frequencyTextView.setText(String.format(Locale.US, "%.6f", frequency));
                }
            });
            incrementProgress();

            int dataRate = selectedChip == RadioChip.CC1101 ? cc1101GetDataRate() : getDataRate();
            if (loadingCancelled || Thread.currentThread().isInterrupted()) {
                return false;
            }
            handler.post(() -> {
                if (binding != null) {
                    binding.dataRateTextView.setText(String.format(Locale.US, "%d", dataRate));
                }
            });
            incrementProgress();

            double bandwidth = selectedChip == RadioChip.CC1101 ? cc1101GetBandwidthKHz() : getBandwidth();
            if (loadingCancelled || Thread.currentThread().isInterrupted()) {
                return false;
            }
            handler.post(() -> {
                if (binding != null) {
                    binding.bandwidthTextView.setText(String.format(Locale.US, "%.1f", bandwidth));
                }
            });
            incrementProgress();

            int deviation = selectedChip == RadioChip.CC1101 ? cc1101GetDeviation() : getDeviation();
            if (loadingCancelled || Thread.currentThread().isInterrupted()) {
                return false;
            }
            handler.post(() -> {
                if (binding != null) {
                    binding.deviationTextView.setText(String.format(Locale.US, "%d", deviation));
                }
            });
            incrementProgress();

            int modulation = selectedChip == RadioChip.CC1101 ? cc1101GetModulation() : getModulation();
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
                        } else if (binding.modulationFormatSpinner.getAdapter() instanceof ModulationAdapter) {
                            ModulationAdapter adapter = (ModulationAdapter) binding.modulationFormatSpinner.getAdapter();
                            binding.modulationFormatSpinner.setSelection(adapter.getPositionForModValue(modulation));
                        }
                    } finally {
                        suppressRfControlCallbacks = false;
                    }
                }
            });
            incrementProgress();

            int txPower = selectedChip == RadioChip.CC1101 ? cc1101GetPowerLevel() : getPowerLevel();
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
            if (!ensureSelectedChipOpen()) {
                return;
            }
            if (selectedChip == RadioChip.CC1101) {
                if (!cc1101SetFrequencyMHz(frequency)) {
                    showToast("Failed to set CC1101 frequency");
                    return;
                }
            } else {
                setFrequencyMHz((float) frequency);
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
            if (!ensureSelectedChipOpen()) {
                return;
            }
            if (selectedChip == RadioChip.CC1101) {
                if (!cc1101SetDataRate(dataRate)) {
                    showToast("Failed to set CC1101 data rate");
                    return;
                }
            } else {
                setDataRate(dataRate);
            }
            reloadCardViews();
        } catch (NumberFormatException e) {
            showToast("Invalid data rate value");
        }
    }

    private void updateBandwidth(String newValue) {
        if (!ensureConnected()) return;
        try {
            if (!ensureSelectedChipOpen()) {
                return;
            }
            if (selectedChip == RadioChip.CC1101) {
                double bwKHz = Double.parseDouble(newValue);
                if (!cc1101SetBandwidth(bwKHz)) {
                    showToast("Failed to set CC1101 bandwidth");
                    return;
                }
            } else {
                byte bandwidth = (byte) Integer.parseInt(newValue);
                setBandwidth(bandwidth);
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
            if (!ensureSelectedChipOpen()) {
                return;
            }
            if (selectedChip == RadioChip.CC1101) {
                if (!cc1101SetDeviation(deviation)) {
                    showToast("Failed to set CC1101 deviation");
                    return;
                }
            } else {
                setDeviation(deviation);
            }
            reloadCardViews();
        } catch (NumberFormatException e) {
            showToast("Invalid deviation value");
        }
    }

    // ===== Firmware command helpers (no RFM69.java wrapper) =====

    private void notifyCommandObserver(String command) {
        Consumer<String> obs = this.commandObserver;
        if (obs != null) {
            obs.accept(command);
        }
    }

    private byte[] sendCommand(String command, int timeoutMs) {
        DeviceConnectionService service = getActiveService();
        if (service == null) {
            return new byte[0];
        }
        notifyCommandObserver(command);
        byte[] resp = service.sendCommand((command + "\n").getBytes(java.nio.charset.StandardCharsets.UTF_8), timeoutMs);
        return resp != null ? resp : new byte[0];
    }

    private boolean isOkAck(byte[] response) {
        return response != null && response.length == 1 && (response[0] & 0xFF) == 0x00;
    }

    private boolean isErr(byte[] response) {
        return response != null && response.length == 1 && (response[0] & 0xFF) == 0xFF;
    }

    private byte[] parseRawPayload(byte[] response) {
        if (response == null || response.length == 0) return new byte[0];
        if (isOkAck(response) || isErr(response)) return new byte[0];
        return response;
    }

    private String parseRawString(byte[] response) {
        if (isErr(response) || isOkAck(response)) return "";
        if (response == null || response.length == 0) return "";
        return new String(response, java.nio.charset.StandardCharsets.UTF_8).trim();
    }

    private boolean ensureRfm69Open() {
        if (!ensureConnected()) return false;

        android.content.SharedPreferences preferences =
                androidx.preference.PreferenceManager.getDefaultSharedPreferences(requireContext());
        String csPin = preferences.getString("rfm69_cs_pin", String.valueOf(DEFAULT_RFM69_CS));
        boolean csActiveHigh = preferences.getBoolean("rfm69_cs_active_high", DEFAULT_RFM69_CS_ACTIVE_HIGH);

        int cs = DEFAULT_RFM69_CS;
        try {
            if (csPin != null) {
                cs = Integer.parseInt(csPin.trim());
            }
        } catch (NumberFormatException e) {
            Log.w("IsmFragment", "Invalid RFM69 CS pin in settings: '" + csPin + "', using default " + DEFAULT_RFM69_CS);
            cs = DEFAULT_RFM69_CS;
        }

        String cmd = String.format(
                Locale.US,
                "rfm69 init --miso=%d --mosi=%d --sck=%d --cs=%d --cs_active_high=%d",
                DEFAULT_RFM69_MISO,
                DEFAULT_RFM69_MOSI,
                DEFAULT_RFM69_SCK,
                cs,
                csActiveHigh ? 1 : 0
        );
        // First init right after connect can be slow; use a longer timeout and retry once.
        byte[] resp = sendCommand(cmd, 2000);
        if (resp == null || resp.length == 0) {
            try {
                Thread.sleep(100);
            } catch (InterruptedException ignored) {
            }
            resp = sendCommand(cmd, 2000);
        }

        if (resp == null || resp.length == 0) {
            Log.e("IsmFragment", "rfm69 init failed: empty response (timeout?)");
            showToast("RFM69 init failed: no response");
            return false;
        }

        // Accept ACK even if extra bytes are present (we'll warn).
        if ((resp[0] & 0xFF) == 0x00) {
            if (resp.length != 1) {
                Log.w("IsmFragment", "rfm69 init: ACK with extra bytes (" + resp.length + "): " + bytesToHex(resp));
            }
            return true;
        }

        if (isErr(resp)) {
            Log.e("IsmFragment", "rfm69 init failed: device returned ERR (0xFF)");
            showToast("RFM69 init failed: device returned error (0xFF)");
            return false;
        }

        // Helpful hint if we're still on legacy ASCII protocol.
        if (resp.length >= 2 && (resp[0] == 'o' || resp[0] == 'O') && (resp[1] == 'k' || resp[1] == 'K')) {
            Log.e("IsmFragment", "rfm69 init failed: device returned legacy ASCII ok/err format: " + bytesToHex(resp));
            showToast("RFM69 init failed: firmware still on ASCII protocol");
            return false;
        }

        Log.e("IsmFragment", "rfm69 init failed: unexpected response (" + resp.length + "): " + bytesToHex(resp));
        showToast("RFM69 init failed: unexpected response");
        return false;
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
        String verb = selectedChip == RadioChip.RFM69 ? "rfm69" : "cc1101";
        byte[] resp = sendCommand(String.format(Locale.US, "%s read --reg=%d", verb, addr & 0xFF), 1000);
        if (isErr(resp)) {
            return 0;
        }
        return (resp != null && resp.length > 0) ? resp[0] : 0;
    }

    private void writeReg(byte addr, byte value) {
        String verb = selectedChip == RadioChip.RFM69 ? "rfm69" : "cc1101";
        sendCommand(String.format(Locale.US, "%s write --reg=%d --val=%d", verb, addr & 0xFF, value & 0xFF), 1000);
    }

    private byte[] cc1101ReadBurstReg(byte addr, int len) {
        if (selectedChip != RadioChip.CC1101) {
            return new byte[0];
        }
        byte[] resp = sendCommand(
                String.format(Locale.US, "cc1101 read_burst --reg=%d --len=%d", addr & 0xFF, len),
                1500
        );
        if (isErr(resp)) {
            return new byte[0];
        }
        return parseRawPayload(resp);
    }

    private boolean cc1101WriteBurstReg(byte addr, byte[] data) {
        if (selectedChip != RadioChip.CC1101) {
            return false;
        }
        String cmd = String.format(
                Locale.US,
                "cc1101 write_burst --reg=%d --data=%s",
                addr & 0xFF,
                bytesToHexCsv(data)
        );
        byte[] resp = sendCommand(cmd, 1500);
        return isOkAck(resp);
    }

    private static String bytesToHexCsv(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return "0";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < bytes.length; i++) {
            if (i > 0) sb.append(",");
            sb.append(String.format(Locale.US, "0x%02X", bytes[i] & 0xFF));
        }
        return sb.toString();
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
        sendCommand("cc1101 strobe --cmd=54", 1000); // SIDLE
        sendCommand("cc1101 strobe --cmd=51", 1000); // SCAL

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

    private double getFrequency() {
        if (selectedChip != RadioChip.RFM69) {
            return 0.0;
        }
        String s = parseRawString(sendCommand("rfm69 get_freq", 1000));
        try {
            return Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return 0.0;
        }
    }

    private void setFrequencyMHz(float freqMHz) {
        if (selectedChip != RadioChip.RFM69) {
            return;
        }
        sendCommand(String.format(Locale.US, "rfm69 set_freq --mhz=%.6f", freqMHz), 1000);
    }

    private int getDataRate() {
        if (selectedChip != RadioChip.RFM69) {
            return 0;
        }
        String s = parseRawString(sendCommand("rfm69 get_bitrate", 1000));
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private void setDataRate(int bps) {
        if (selectedChip != RadioChip.RFM69) {
            return;
        }
        sendCommand("rfm69 set_bitrate --bps=" + bps, 1000);
    }

    private double getBandwidth() {
        if (selectedChip != RadioChip.RFM69) {
            return 0.0;
        }
        String s = parseRawString(sendCommand("rfm69 get_bw", 1000));
        try {
            return Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return 0.0;
        }
    }

    private void setBandwidth(byte bw) {
        if (selectedChip != RadioChip.RFM69) {
            return;
        }
        sendCommand("rfm69 set_bw --val=" + (bw & 0xFF), 1000);
    }

    private int getDeviation() {
        if (selectedChip != RadioChip.RFM69) {
            return 0;
        }
        String s = parseRawString(sendCommand("rfm69 get_dev", 1000));
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private void setDeviation(int hz) {
        if (selectedChip != RadioChip.RFM69) {
            return;
        }
        sendCommand("rfm69 set_dev --hz=" + hz, 1000);
    }

    private int getModulation() {
        if (selectedChip != RadioChip.RFM69) {
            return MOD_FSK;
        }
        String s = parseRawString(sendCommand("rfm69 get_mod", 1000));
        return "ook".equalsIgnoreCase(s) ? MOD_OOK : MOD_FSK;
    }

    private int getPowerLevel() {
        if (selectedChip != RadioChip.RFM69) {
            return 0;
        }
        String s = parseRawString(sendCommand("rfm69 get_power", 1000));
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return 0;
        }
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
            else if ("RFM69".equalsIgnoreCase(saved)) selectedChip = RadioChip.RFM69;
        }

        ArrayAdapter<String> adapter = new ArrayAdapter<>(
                requireContext(),
                android.R.layout.simple_spinner_item,
                new String[]{"Select chip…", "CC1101", "RFM69"}
        );
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        binding.chipSpinner.setAdapter(adapter);

        int initialSelection;
        if (selectedChip == RadioChip.CC1101) initialSelection = 1;
        else if (selectedChip == RadioChip.RFM69) initialSelection = 2;
        else initialSelection = 0;
        binding.chipSpinner.setSelection(initialSelection, false);

        binding.chipSpinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                RadioChip newChip;
                if (position == 2) newChip = RadioChip.RFM69;
                else if (position == 1) newChip = RadioChip.CC1101;
                else newChip = RadioChip.UNKNOWN;
                if (newChip == selectedChip) {
                    return;
                }
                selectedChip = newChip;
                android.content.SharedPreferences preferences =
                        androidx.preference.PreferenceManager.getDefaultSharedPreferences(requireContext());
                preferences.edit().putString(
                        "ism_selected_chip",
                        selectedChip == RadioChip.RFM69 ? "RFM69" : (selectedChip == RadioChip.CC1101 ? "CC1101" : "")
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
        binding.rfm69ParametersContainer.setVisibility(selectedChip == RadioChip.UNKNOWN ? View.GONE : View.VISIBLE);
        binding.cc1101HintTextView.setVisibility(selectedChip == RadioChip.CC1101 ? View.VISIBLE : View.GONE);
        binding.loadButton.setEnabled(selectedChip != RadioChip.UNKNOWN);
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

    private boolean ensureSelectedChipOpen() {
        return selectedChip == RadioChip.RFM69 ? ensureRfm69Open() : ensureCc1101Open();
    }

    private boolean ensureCc1101Open() {
        if (!ensureConnected()) return false;

        String command = String.format(
                Locale.US,
                "cc1101 init --miso=%d --mosi=%d --sck=%d --cs=%d --cs_active_high=%d",
                DEFAULT_CC1101_MISO,
                DEFAULT_CC1101_MOSI,
                DEFAULT_CC1101_SCK,
                DEFAULT_CC1101_CS,
                DEFAULT_CC1101_CS_ACTIVE_HIGH ? 1 : 0
        );

        byte[] resp = sendCommand(command, 1500);
        if (resp == null || resp.length == 0) {
            Log.e("IsmFragment", "cc1101 init failed: empty response (timeout?)");
            showToast("CC1101 init failed: no response");
            return false;
        }

        if ((resp[0] & 0xFF) == 0x00) {
            if (resp.length != 1) {
                Log.w("IsmFragment", "cc1101 init: ACK with extra bytes (" + resp.length + "): " + bytesToHex(resp));
            }
            return true;
        }

        if (isErr(resp)) {
            Log.e("IsmFragment", "cc1101 init failed: device returned ERR (0xFF)");
            showToast("CC1101 init failed: device returned error (0xFF)");
            return false;
        }

        if (resp.length >= 2 && (resp[0] == 'o' || resp[0] == 'O') && (resp[1] == 'k' || resp[1] == 'K')) {
            Log.e("IsmFragment", "cc1101 init failed: device returned legacy ASCII ok/err format: " + bytesToHex(resp));
            showToast("CC1101 init failed: firmware still on ASCII protocol");
            return false;
        }

        Log.e("IsmFragment", "cc1101 init failed: unexpected response (" + resp.length + "): " + bytesToHex(resp));
        showToast("CC1101 init failed: unexpected response");
        return false;
    }
}
