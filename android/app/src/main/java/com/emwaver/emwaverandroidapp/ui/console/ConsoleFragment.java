package com.emwaver.emwaverandroidapp.ui.console;

import android.app.Activity;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.text.Editable;
import android.text.TextWatcher;
import android.text.method.ScrollingMovementMethod;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;
import android.app.AlertDialog;
import android.widget.AdapterView;
import androidx.cardview.widget.CardView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.core.view.MenuHost;
import androidx.core.view.MenuProvider;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.Lifecycle;
import androidx.core.content.ContextCompat;

import com.emwaver.emwaverandroidapp.databinding.FragmentConsoleBinding;
import com.emwaver.emwaverandroidapp.ui.ism.CC1101;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.Utils;
import com.emwaver.emwaverandroidapp.ir.IrEncoderWrapper;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public class ConsoleFragment extends Fragment {
    private FragmentConsoleBinding binding;
    private CC1101 cc;
    private BLEService bleService;
    private boolean isServiceBound = false;
    private ActivityResultLauncher<Intent> createFileLauncher;
    private ActivityResultLauncher<String[]> openFileLauncher;
    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName className, IBinder service) {
            BLEService.LocalBinder binder = (BLEService.LocalBinder) service;
            bleService = binder.getService();
            isServiceBound = true;
            Log.i("service binding", "onServiceConnected");
            cc = new CC1101(bleService);
        }
        @Override
        public void onServiceDisconnected(ComponentName arg0) {
            isServiceBound = false;
            Log.i("service binding", "onServiceDisconnected");
        }
    };

    private ListView scriptListView;
    private List<String> recentScripts = new ArrayList<>();
    private ArrayAdapter<String> scriptAdapter;

    private static final String SCRIPTS_DIR = "scripts";

    private Handler autoSaveHandler = new Handler(Looper.getMainLooper());
    private static final long AUTO_SAVE_DELAY_MS = 3000; // 1 second delay
    private String currentScriptName;
    private boolean hasUnsavedChanges = false;

    private Utils utils;
    private IrEncoderWrapper irEncoderWrapper;

    // Views for collapsible sections
    private TextView scriptsListTitle;
    private CardView scriptListCard;
    private TextView scriptEditorTitle;
    private CardView scriptEditorCard;
    private TextView consoleMonitorTitle;
    private CardView consoleMonitorCard;

    private File getScriptsDir() {
        File dir = new File(getContext().getFilesDir(), SCRIPTS_DIR);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private void saveScriptToInternalStorage(String fileName, String content) {
        File file = new File(getScriptsDir(), fileName);
        try (FileOutputStream fos = new FileOutputStream(file)) {
            fos.write(content.getBytes());
        } catch (IOException e) {
            Log.e("ConsoleFragment", "Error saving script to internal storage", e);
        }
    }

    private String loadScriptFromInternalStorage(String fileName) {
        File file = new File(getScriptsDir(), fileName);
        StringBuilder content = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new FileReader(file))) {
            String line;
            while ((line = br.readLine()) != null) {
                content.append(line).append('\n');
            }
        } catch (IOException e) {
            Log.e("ConsoleFragment", "Error loading script from internal storage", e);
        }
        return content.toString();
    }

    private List<String> getInternalScriptsList() {
        File[] files = getScriptsDir().listFiles();
        List<String> scriptNames = new ArrayList<>();
        if (files != null) {
            for (File file : files) {
                scriptNames.add(file.getName());
            }
        }
        return scriptNames;
    }

    private MenuItem executeMenuItem;
    private boolean isScriptRunning = false;

    public View onCreateView(@NonNull LayoutInflater inflater,
                             ViewGroup container, Bundle savedInstanceState) {

        binding = FragmentConsoleBinding.inflate(inflater, container, false);
        View root = binding.getRoot(); // inflate fragment_terminal.xml

        // Clear the text view
        binding.jsCodeInput.setText("");

        // Set initial status
        currentScriptName = null;
        hasUnsavedChanges = false;

        MenuHost menuHost = requireActivity();
        menuHost.addMenuProvider(new MenuProvider() {
            @Override
            public void onCreateMenu(@NonNull Menu menu, @NonNull MenuInflater menuInflater) {
                menuInflater.inflate(R.menu.console_menu, menu);
                executeMenuItem = menu.findItem(R.id.execute);
            }
            @Override
            public boolean onMenuItemSelected(@NonNull MenuItem menuItem) {
                int itemId = menuItem.getItemId();
                if (itemId == R.id.open) {
                    openFile();
                    return true;
                } else if (itemId == R.id.make_copy) {
                    showNameInputDialog("Copy Script", "Enter a name for the copy:", ConsoleFragment.this::copyCurrentScript);
                    return true;
                } else if (itemId == R.id.new_script) {
                    showNameInputDialog("New Script", "Enter a name for the new script:", ConsoleFragment.this::createNewScript);
                    return true;
                } else if (itemId == R.id.execute) {
                    if (isScriptRunning) {
                        stopScript();
                    } else {
                        executeScript();
                    }
                    return true;
                } else if (itemId == R.id.clear) {
                    clearConsole();
                    return true;
                } else if (itemId == R.id.save_to_storage) {
                    saveAsFile();
                    return true;
                }
                return false;
            }
        }, getViewLifecycleOwner(), Lifecycle.State.RESUMED);

        binding.consoleWindowText.setMovementMethod(new ScrollingMovementMethod()); // Set the TextView as scrollable

        createFileLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                Uri uri = result.getData().getData();
                if (uri != null) {
                    final int takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                    getContext().getContentResolver().takePersistableUriPermission(uri, takeFlags);
                    saveFileToUri(uri);
                    currentScriptName = getFileNameFromUri(getContext(), uri);
                    updateScriptEditorTitle();
                }
            } else {
                // If no file was selected, revert to the initial status
                currentScriptName = null;
                hasUnsavedChanges = false;
                updateScriptEditorTitle();
            }
        });

        openFileLauncher = registerForActivityResult(new ActivityResultContracts.OpenDocument(), uri -> {
            if (uri != null) {
                try {
                    final int takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                    getContext().getContentResolver().takePersistableUriPermission(uri, takeFlags);
                    
                    String content = readTextFromUri(uri);
                    String fileName = getFileNameFromUri(getContext(), uri);
                    
                    // Save to internal storage
                    saveScriptToInternalStorage(fileName, content);
                    
                    // Update UI
                    binding.jsCodeInput.setText(content);
                    updateRecentScripts(fileName);
                    
                    // Update script editor title and save URI
                    currentScriptName = fileName;
                    updateScriptEditorTitle();
                    
                    showToastOnUiThread("Script loaded and saved to internal storage: " + fileName);
                } catch (IOException e) {
                    Log.e("ConsoleFragment", "Error reading file", e);
                    showToastOnUiThread("Error loading file: " + e.getMessage());
                }
            } else {
                // If no file was selected, revert to the initial status
                currentScriptName = null;
                hasUnsavedChanges = false;
                updateScriptEditorTitle();
            }
        });

        scriptListView = binding.scriptListView;
        setupScriptList();

        setupAutoSave();

        utils = new Utils();
        irEncoderWrapper = new IrEncoderWrapper();
        utils.setContext(requireContext());

        // Setup collapsible sections
        setupCollapsibleSections();

        // Initialize console output
        binding.consoleWindowText.setText("<Console>");
        
        // Now that views are initialized, update the title
        currentScriptName = null;
        hasUnsavedChanges = false;
        updateScriptEditorTitle();

        return root;
    }

    private void setupCollapsibleSections() {
        scriptsListTitle = binding.scriptsListTitle;
        scriptListCard = binding.scriptListCard;
        scriptEditorTitle = binding.scriptEditorTitle;
        scriptEditorCard = binding.scriptEditorCard;
        consoleMonitorTitle = binding.consoleMonitorTitle;
        consoleMonitorCard = binding.cardView; // ID of the console's CardView is 'cardView'

        // Set initial visibility and arrows (optional - default is visible, arrow down)
        updateArrow(scriptsListTitle, scriptListCard.getVisibility() == View.VISIBLE);
        updateArrow(scriptEditorTitle, scriptEditorCard.getVisibility() == View.VISIBLE);
        updateArrow(consoleMonitorTitle, consoleMonitorCard.getVisibility() == View.VISIBLE);

        scriptsListTitle.setOnClickListener(v -> {
            toggleVisibility(scriptListCard);
            updateArrow((TextView) v, scriptListCard.getVisibility() == View.VISIBLE);
        });
        scriptEditorTitle.setOnClickListener(v -> {
            toggleVisibility(scriptEditorCard);
            updateArrow((TextView) v, scriptEditorCard.getVisibility() == View.VISIBLE);
        });
        consoleMonitorTitle.setOnClickListener(v -> {
            toggleVisibility(consoleMonitorCard);
            updateArrow((TextView) v, consoleMonitorCard.getVisibility() == View.VISIBLE);
        });
    }

    private void toggleVisibility(View view) {
        if (view.getVisibility() == View.VISIBLE) {
            view.setVisibility(View.GONE);
        } else {
            view.setVisibility(View.VISIBLE);
        }
    }

    private void updateArrow(TextView titleView, boolean isExpanded) {
        if (isExpanded) {
            titleView.setCompoundDrawablesWithIntrinsicBounds(0, 0, R.drawable.ic_arrow_up_black, 0);
        } else {
            titleView.setCompoundDrawablesWithIntrinsicBounds(0, 0, R.drawable.ic_arrow_down_black, 0);
        }
    }

    private void executeScript(){
        isScriptRunning = true;
        updateExecuteMenuIcon();
        new Thread(() -> {
            try {
                String jsCode = binding.jsCodeInput.getText().toString();
                ScriptsEngine scriptsEngine = new ScriptsEngine(cc, utils, bleService, irEncoderWrapper, this::print);
                String result = scriptsEngine.executeJavaScript(jsCode);
                if(result != null){
                    print(result);
                }
            } finally {
                isScriptRunning = false;
                updateExecuteMenuIcon();
                unbindServiceIfNeeded();
            }
        }).start();
    }

    private void stopScript() {
        // Implement script stopping logic here
        // For example, you might set a flag in ScriptsEngine to stop execution
        isScriptRunning = false;
        updateExecuteMenuIcon();
        print("Script execution stopped.");
    }

    private void updateExecuteMenuIcon() {
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                if (executeMenuItem != null) {
                    if (isScriptRunning) {
                        executeMenuItem.setIcon(ContextCompat.getDrawable(requireContext(), R.drawable.ai_stop));
                        executeMenuItem.setTitle("Stop");
                    } else {
                        executeMenuItem.setIcon(ContextCompat.getDrawable(requireContext(), R.drawable.ai_play));
                        executeMenuItem.setTitle("Execute");
                    }
                }
            });
        }
    }

    private void clearConsole(){
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                binding.consoleWindowText.setText("");
                print("<Console>");
            });
        }
    }

    private void unbindServiceIfNeeded() {
        if (isServiceBound && !isFragmentActive() && getActivity() != null) {
            getActivity().unbindService(serviceConnection);
            isServiceBound = false;
        }
    }
    private boolean isFragmentActive() {
        return isAdded() && !isDetached() && !isRemoving();
    }

    @Override
    public void onStart() {
        super.onStart();
        // bind service
        if (!isServiceBound && getActivity() != null) {
            Intent intent = new Intent(getActivity(), BLEService.class);
            getActivity().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
        }
    }

    @Override
    public void onStop() {
        super.onStop();
    }
    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null; // Important for avoiding memory leaks
    }

    public void saveAsFile() {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*"); // Set MIME Type as per your requirement
        intent.putExtra(Intent.EXTRA_TITLE, "myScript.js");

        createFileLauncher.launch(intent);
    }

    public void openFile() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*"); // MIME type for .raw files or use "*/*" for any file type
        openFileLauncher.launch(new String[]{"*/*"}); // Pass the MIME type as an array
    }


    private void saveFileToUri(Uri uri) {
        try (OutputStream outstream = getActivity().getContentResolver().openOutputStream(uri)) {
            String fileContent = binding.jsCodeInput.getText().toString();
            outstream.write(fileContent.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            Log.e("filesys", "Error writing to file", e);
        }
    }

    public static String getFileNameFromUri(Context context, Uri uri) {
        if (uri == null) return "No File Selected";
        String fileName = null;
        ContentResolver contentResolver = context.getContentResolver();
        Cursor cursor = null;
        try {
            cursor = contentResolver.query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameIndex != -1) {
                    fileName = cursor.getString(nameIndex);
                }
            }
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return fileName != null ? fileName : "Unknown File";
    }

    private void setupScriptList() {
        recentScripts = getInternalScriptsList();
        scriptAdapter = new ArrayAdapter<>(getContext(), android.R.layout.simple_list_item_1, recentScripts);
        scriptListView.setAdapter(scriptAdapter);

        // Create default scripts if they don't exist
        createDefaultScriptsIfNeeded();

        scriptListView.setOnItemClickListener((parent, view, position, id) -> {
            String scriptName = recentScripts.get(position);
            loadScript(scriptName);
        });

        scriptListView.setOnItemLongClickListener((parent, view, position, id) -> {
            String scriptName = recentScripts.get(position);
            showScriptOptionsDialog(scriptName);
            return true;
        });
    }

    private void loadScript(String scriptName) {
        currentScriptName = scriptName;
        String content = loadScriptFromInternalStorage(scriptName);
        binding.jsCodeInput.setText(content);
        hasUnsavedChanges = false;
        updateScriptEditorTitle();
    }

    private void updateRecentScripts(String scriptName) {
        recentScripts.remove(scriptName);
        recentScripts.add(0, scriptName);
        if (recentScripts.size() > 10) {
            String oldestScript = recentScripts.remove(recentScripts.size() - 1);
            new File(getScriptsDir(), oldestScript).delete();
        }
        scriptAdapter.notifyDataSetChanged();
    }

    public void showToastOnUiThread(final String message) {
        if (isAdded()) { // Check if Fragment is currently added to its activity
            getActivity().runOnUiThread(() ->
                    Toast.makeText(getContext(), message, Toast.LENGTH_SHORT).show());
        }
    }

    private String readTextFromUri(Uri uri) throws IOException {
        StringBuilder stringBuilder = new StringBuilder();
        try (InputStream inputStream = getContext().getContentResolver().openInputStream(uri);
             BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream))) {
            String line;
            while ((line = reader.readLine()) != null) {
                stringBuilder.append(line).append("\n");
            }
        }
        return stringBuilder.toString();
    }

    private void setupAutoSave() {
        binding.jsCodeInput.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {}

            @Override
            public void afterTextChanged(Editable s) {
                hasUnsavedChanges = true;
                updateScriptEditorTitle();
                autoSaveHandler.removeCallbacksAndMessages(null);
                autoSaveHandler.postDelayed(() -> autoSaveScript(), AUTO_SAVE_DELAY_MS);
            }
        });
    }

    private void autoSaveScript() {
        if (currentScriptName != null && !currentScriptName.isEmpty()) {
            String content = binding.jsCodeInput.getText().toString();
            saveScriptToInternalStorage(currentScriptName, content);
            hasUnsavedChanges = false;
            updateScriptEditorTitle();
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        autoSaveHandler.removeCallbacksAndMessages(null);
    }

    private void showNameInputDialog(String title, String message, ScriptNameCallback callback) {
        AlertDialog.Builder builder = new AlertDialog.Builder(getContext());
        builder.setTitle(title);
        builder.setMessage(message);

        final EditText input = new EditText(getContext());
        builder.setView(input);

        builder.setPositiveButton("OK", (dialog, which) -> {
            String scriptName = input.getText().toString();
            if (!scriptName.isEmpty()) {
                callback.onNameEntered(scriptName);
            }
        });
        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());

        builder.show();
    }

    private void copyCurrentScript(String newScriptName) {
        if (currentScriptName != null && !currentScriptName.isEmpty()) {
            String content = binding.jsCodeInput.getText().toString();
            saveScriptToInternalStorage(newScriptName, content);
            updateRecentScripts(newScriptName);
            loadScript(newScriptName);
            showToastOnUiThread("Script copied: " + newScriptName);
        } else {
            showToastOnUiThread("No script to copy");
        }
    }

    private void createNewScript(String newScriptName) {
        saveScriptToInternalStorage(newScriptName, "// New script");
        updateRecentScripts(newScriptName);
        loadScript(newScriptName);
        showToastOnUiThread("New script created: " + newScriptName);
    }

    private void showScriptOptionsDialog(String scriptName) {
        AlertDialog.Builder builder = new AlertDialog.Builder(getContext());
        builder.setTitle("Rename Script");

        View dialogView = getLayoutInflater().inflate(R.layout.dialog_rename_script, null);
        final EditText input = dialogView.findViewById(R.id.edit_script_name);
        input.setText(scriptName);
        builder.setView(dialogView);

        builder.setPositiveButton("OK", null);
        builder.setNegativeButton("Cancel", null);
        builder.setNeutralButton("Delete", null);

        AlertDialog dialog = builder.create();
        dialog.show();

        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String newName = input.getText().toString();
            if (!newName.isEmpty() && !newName.equals(scriptName)) {
                renameScript(scriptName, newName);
                dialog.dismiss();
            } else if (newName.isEmpty()) {
                input.setError("Script name cannot be empty");
            } else if (newName.equals(scriptName)) {
                dialog.dismiss();
            }
        });

        dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> {
            showDeleteConfirmationDialog(scriptName);
            dialog.dismiss();
        });
    }

    private void renameScript(String oldName, String newName) {
        File oldFile = new File(getScriptsDir(), oldName);
        File newFile = new File(getScriptsDir(), newName);
        if (oldFile.renameTo(newFile)) {
            recentScripts.remove(oldName);
            recentScripts.add(newName);
            scriptAdapter.notifyDataSetChanged();
            if (currentScriptName != null && currentScriptName.equals(oldName)) {
                currentScriptName = newName;
                updateScriptEditorTitle();
            }
            showToastOnUiThread("Script renamed to: " + newName);
        } else {
            showToastOnUiThread("Failed to rename script");
        }
    }

    private void showDeleteConfirmationDialog(String scriptName) {
        new AlertDialog.Builder(getContext())
            .setTitle("Delete Script")
            .setMessage("Are you sure you want to delete " + scriptName + "?")
            .setPositiveButton("Delete", (dialog, which) -> deleteScript(scriptName))
            .setNegativeButton("Cancel", null)
            .show();
    }

    private void deleteScript(String scriptName) {
        File file = new File(getScriptsDir(), scriptName);
        if (file.delete()) {
            recentScripts.remove(scriptName);
            scriptAdapter.notifyDataSetChanged();
            if (currentScriptName != null && currentScriptName.equals(scriptName)) {
                binding.jsCodeInput.setText("");
                currentScriptName = null;
                updateScriptEditorTitle();
            }
            showToastOnUiThread("Script deleted: " + scriptName);
        } else {
            showToastOnUiThread("Failed to delete script");
        }
    }

    private interface ScriptNameCallback {
        void onNameEntered(String name);
    }

    private void print(String message) {
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                binding.consoleWindowText.append(message + "\n");
                binding.consoleWindowScrollView.post(() -> 
                    binding.consoleWindowScrollView.fullScroll(View.FOCUS_DOWN));
            });
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // Update script editor title when entering this fragment
        updateScriptEditorTitle();
    }

    @Override
    public void onPause() {
        super.onPause();
        // No longer need to clear action bar status
    }

    private void createDefaultScriptsIfNeeded() {
        // RX Continuous Script
        String rxScriptName = "cc1101_rx_continuous.js";
        File rxScript = new File(getScriptsDir(), rxScriptName);
        
        if (!rxScript.exists()) {
            String rxContent = 
                "CC1101.spiStrobe(CC1101.SRES);\n" +
                "CC1101.init();\n" +
                "CC1101.writeReg(CC1101.PKTCTRL0, 0x32);\n" +
                "CC1101.setGDOMode(0x2E, 0x2E, 0x0D);\n" +
                "CC1101.setFrequencyMHz(433.92);\n" +
                "CC1101.setDataRate(100000);\n" +
                "CC1101.setModulationAndPower(CC1101.MOD_ASK, CC1101.POWER_10_DBM);\n" +
                "CC1101.spiStrobe(CC1101.SRX);\n" +
                "print(\"init rx continuous successful!\");";

            saveScriptToInternalStorage(rxScriptName, rxContent);
            updateRecentScripts(rxScriptName);
            showToastOnUiThread("Default CC1101 RX continuous script created");
        }

        // TX Continuous Script
        String txScriptName = "cc1101_tx_continuous.js";
        File txScript = new File(getScriptsDir(), txScriptName);
        
        if (!txScript.exists()) {
            String txContent = 
                "CC1101.spiStrobe(CC1101.SRES);\n" +
                "CC1101.init();\n" +
                "CC1101.writeReg(CC1101.PKTCTRL0, 0x32);\n" +
                "CC1101.setGDOMode(0x2E, 0x2E, 0x0D);\n" +
                "CC1101.setFrequencyMHz(433.92);\n" +
                "CC1101.setDataRate(100000);\n" +
                "CC1101.setModulationAndPower(CC1101.MOD_ASK, CC1101.POWER_10_DBM);\n" +
                "CC1101.spiStrobe(CC1101.STX);\n" +
                "print(\"init tx continuous successful!\");";

            saveScriptToInternalStorage(txScriptName, txContent);
            updateRecentScripts(txScriptName);
            showToastOnUiThread("Default CC1101 TX continuous script created");
        }
        
        // BadUSB Hello World Script
        String badUsbScriptName = "hello_world_usb.js";
        File badUsbScript = new File(getScriptsDir(), badUsbScriptName);
        
        if (!badUsbScript.exists()) {
            String badUsbContent = 
                "// This script demonstrates basic BadUSB functionality using the EMWaver\n\n" +
                "print(\"Setting up BadUSB mode...\");\n" +
                "BLEService.sendString(\"usb ATTACKMODE HID\");\n\n" +
                "Utils.delay(2000);\n\n" +
                "BLEService.sendString(\"usb STRING_DELAY 10\");\n" +
                "Utils.delay(500);\n\n" +
                "BLEService.sendString(\"usb STRING Hello, World!\");\n" +
                "Utils.delay(500);\n\n" +
                "BLEService.sendString(\"usb ENTER\");\n" +
                "Utils.delay(500);\n\n" +
                "print(\"BadUSB test complete!\");";
            saveScriptToInternalStorage(badUsbScriptName, badUsbContent);
            updateRecentScripts(badUsbScriptName);
            showToastOnUiThread("Default BadUSB hello world script created");
        }
    }

    private void updateScriptEditorTitle() {
        if (getActivity() != null && scriptEditorTitle != null) {
            getActivity().runOnUiThread(() -> {
                String title;
                if (currentScriptName != null && !currentScriptName.isEmpty()) {
                    title = currentScriptName + (hasUnsavedChanges ? " *" : "");
                } else {
                    title = "Script Editor [No script open]";
                }
                scriptEditorTitle.setText(title);
            });
        }
    }
}
