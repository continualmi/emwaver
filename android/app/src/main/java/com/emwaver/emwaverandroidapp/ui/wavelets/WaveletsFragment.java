package com.emwaver.emwaverandroidapp.ui.wavelets;

import android.app.Activity;
import android.app.AlertDialog;
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
import android.util.Log;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.cardview.widget.CardView;
import androidx.constraintlayout.widget.Group;
import androidx.core.content.ContextCompat;
import androidx.core.view.MenuHost;
import androidx.core.view.MenuProvider;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.Lifecycle;

import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.Utils;
import com.emwaver.emwaverandroidapp.databinding.FragmentWaveletsBinding;
import com.emwaver.emwaverandroidapp.ir.IrEncoderWrapper;
import com.emwaver.emwaverandroidapp.ui.ism.CC1101;
import com.emwaver.emwaverandroidapp.wavelets.WaveletEngine;
import com.emwaver.emwaverandroidapp.wavelets.WaveletRenderView;
import com.emwaver.emwaverandroidapp.wavelets.WaveletTree;

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
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class WaveletsFragment extends Fragment {

    private static final String TAG = "WaveletsFragment";
    private static final String SCRIPTS_DIR = "scripts";
    private static final long AUTO_SAVE_DELAY_MS = 3000L;

    private FragmentWaveletsBinding binding;
    private final List<String> recentScripts = new ArrayList<>();
    private ArrayAdapter<String> scriptAdapter;
    private String currentScriptName;
    private boolean hasUnsavedChanges;
    private final Handler autoSaveHandler = new Handler(Looper.getMainLooper());

    private BLEService bleService;
    private boolean isServiceBound;
    private CC1101 cc1101;
    private Utils utils;
    private IrEncoderWrapper irEncoderWrapper;

    private WaveletEngine waveletEngine;
    private WaveletRenderView waveletRenderView;
    private WaveletTree activeWaveletTree;
    private boolean isRenderingWavelet;
    private boolean showingPreview;

    private ActivityResultLauncher<Intent> createFileLauncher;
    private ActivityResultLauncher<String[]> openFileLauncher;
    private MenuItem executeMenuItem;

    private TextView scriptsListTitle;
    private CardView scriptListCard;
    private TextView scriptEditorTitle;
    private CardView scriptEditorCard;
    private Group editorGroup;

    private final Runnable autoSaveRunnable = () -> {
        if (hasUnsavedChanges && currentScriptName != null) {
            saveScriptToInternalStorage(currentScriptName, getEditorText());
            hasUnsavedChanges = false;
            updateScriptEditorTitle();
        }
    };

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            BLEService.LocalBinder binder = (BLEService.LocalBinder) service;
            bleService = binder.getService();
            isServiceBound = true;
            cc1101 = new CC1101(bleService);
            ensureWaveletEngineBindings();
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            isServiceBound = false;
            bleService = null;
            cc1101 = null;
            ensureWaveletEngineBindings();
        }
    };

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        binding = FragmentWaveletsBinding.inflate(inflater, container, false);
        View root = binding.getRoot();

        utils = new Utils();
        utils.setContext(requireContext());
        irEncoderWrapper = new IrEncoderWrapper();

        setupMenu();
        setupFileLaunchers();
        setupEditor();
        setupScriptList();
        setupCollapsibleSections();
        editorGroup = binding.editorGroup;
        showingPreview = false;
        updateViewMode();
        updateWaveletPlaceholder();

        return root;
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

    @Override
    public void onDestroyView() {
        autoSaveHandler.removeCallbacksAndMessages(null);
        if (waveletEngine != null) {
            waveletEngine.shutdown();
            waveletEngine = null;
        }
        waveletRenderView = null;
        showingPreview = false;
        executeMenuItem = null;
        binding = null;
        super.onDestroyView();
    }

    private void setupMenu() {
        MenuHost menuHost = requireActivity();
        menuHost.addMenuProvider(new MenuProvider() {
            @Override
            public void onCreateMenu(@NonNull Menu menu, @NonNull MenuInflater menuInflater) {
                menuInflater.inflate(R.menu.console_menu, menu);
                executeMenuItem = menu.findItem(R.id.execute);
                updateExecuteMenuIcon();
            }

            @Override
            public boolean onMenuItemSelected(@NonNull MenuItem menuItem) {
                int itemId = menuItem.getItemId();
                if (itemId == R.id.execute) {
                    if (showingPreview) {
                        exitPreview();
                    } else {
                        executeScript();
                    }
                    return true;
                } else if (itemId == R.id.open) {
                    openFile();
                    return true;
                } else if (itemId == R.id.save_to_storage) {
                    saveAsFile();
                    return true;
                } else if (itemId == R.id.make_copy) {
                    showNameInputDialog("Copy Script", "Enter a name for the copy:", WaveletsFragment.this::copyCurrentScript);
                    return true;
                } else if (itemId == R.id.new_script) {
                    showNameInputDialog("New Script", "Enter a name for the new script:", WaveletsFragment.this::createNewScript);
                    return true;
                }
                return false;
            }
        }, getViewLifecycleOwner(), Lifecycle.State.RESUMED);
    }

    private void setupFileLaunchers() {
        createFileLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                Uri uri = result.getData().getData();
                if (uri != null) {
                    int takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                    requireContext().getContentResolver().takePersistableUriPermission(uri, takeFlags);
                    saveFileToUri(uri);
                    currentScriptName = getFileNameFromUri(requireContext(), uri);
                    hasUnsavedChanges = false;
                    updateScriptEditorTitle();
                }
            }
        });

        openFileLauncher = registerForActivityResult(new ActivityResultContracts.OpenDocument(), uri -> {
            if (uri != null) {
                readScriptFromUri(uri);
                currentScriptName = getFileNameFromUri(requireContext(), uri);
                hasUnsavedChanges = false;
                updateScriptEditorTitle();
            }
        });
    }

    private void setupEditor() {
        binding.jsCodeInput.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                hasUnsavedChanges = true;
                updateScriptEditorTitle();
                scheduleAutoSave();
            }

            @Override
            public void afterTextChanged(Editable s) {}
        });
    }

    private void setupScriptList() {
        scriptsListTitle = binding.scriptsListTitle;
        scriptListCard = binding.scriptListCard;
        scriptEditorTitle = binding.scriptEditorTitle;
        scriptEditorCard = binding.scriptEditorCard;

        scriptAdapter = new ArrayAdapter<>(requireContext(), android.R.layout.simple_list_item_1, recentScripts);
        binding.scriptListView.setAdapter(scriptAdapter);

        createDefaultScriptsIfNeeded();
        recentScripts.clear();
        recentScripts.addAll(getInternalScriptsList());
        Collections.sort(recentScripts, String.CASE_INSENSITIVE_ORDER);
        scriptAdapter.notifyDataSetChanged();

        binding.scriptListView.setOnItemClickListener((parent, view, position, id) -> {
            String scriptName = recentScripts.get(position);
            loadScript(scriptName);
        });

        binding.scriptListView.setOnItemLongClickListener((parent, view, position, id) -> {
            String scriptName = recentScripts.get(position);
            showScriptOptionsDialog(scriptName);
            return true;
        });
    }

    private void setupCollapsibleSections() {
        updateArrow(scriptsListTitle, scriptListCard.getVisibility() == View.VISIBLE);
        updateArrow(scriptEditorTitle, scriptEditorCard.getVisibility() == View.VISIBLE);

        scriptsListTitle.setOnClickListener(v -> {
            toggleVisibility(scriptListCard);
            updateArrow((TextView) v, scriptListCard.getVisibility() == View.VISIBLE);
        });

        scriptEditorTitle.setOnClickListener(v -> {
            toggleVisibility(scriptEditorCard);
            updateArrow((TextView) v, scriptEditorCard.getVisibility() == View.VISIBLE);
        });
    }

    private void executeScript() {
        String script = getEditorText();
        if (script.trim().isEmpty()) {
            showToast("No script to execute.");
            return;
        }
        renderWavelet(script);
    }

    private void renderWavelet(String script) {
        setupWaveletEngineIfNeeded();
        if (waveletEngine == null) {
            showToast("Wavelet engine not ready.");
            return;
        }
        isRenderingWavelet = true;
        activeWaveletTree = null;
        showingPreview = true;
        updateViewMode();
        ensureWaveletRenderView();
        if (waveletRenderView != null) {
            waveletRenderView.clear();
        }
        updateWaveletPlaceholder();
        waveletEngine.execute(script, () -> {
            isRenderingWavelet = false;
            updateWaveletPlaceholder();
        });
    }

    private void setupWaveletEngineIfNeeded() {
        ensureWaveletEngineBindings();
        if (waveletEngine == null) {
            waveletEngine = new WaveletEngine();
            waveletEngine.setup(this::printLog, this::handleWaveletTree, buildBindings());
        }
    }

    private void ensureWaveletEngineBindings() {
        if (waveletEngine != null) {
            waveletEngine.registerGlobalBindings(buildBindings());
        }
    }

    private Map<String, Object> buildBindings() {
        Map<String, Object> bindings = new HashMap<>();
        if (cc1101 != null) {
            bindings.put("CC1101", cc1101);
        }
        if (utils != null) {
            bindings.put("Utils", utils);
        }
        if (bleService != null) {
            bindings.put("BLEService", bleService);
        }
        if (irEncoderWrapper != null) {
            bindings.put("IrEncoder", irEncoderWrapper);
        }
        return bindings;
    }

    private void handleWaveletTree(WaveletTree tree) {
        if (!isAdded() || binding == null) {
            return;
        }
        if (tree == null || tree.getRoot() == null) {
            Log.w(TAG, "Received empty wavelet tree");
            activeWaveletTree = null;
            isRenderingWavelet = false;
            updateWaveletPlaceholder();
            return;
        }
        activeWaveletTree = tree;
        isRenderingWavelet = false;
        renderWaveletTree(tree);
    }

    private void ensureWaveletRenderView() {
        if (waveletRenderView != null) {
            return;
        }
        Context context = requireContext();
        waveletRenderView = new WaveletRenderView(context);
        waveletRenderView.setEventListener((token, arguments) -> {
            if (waveletEngine != null) {
                waveletEngine.invoke(token, arguments);
            }
        });
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        binding.waveletContainer.addView(waveletRenderView, 0, params);
    }

    private void renderWaveletTree(WaveletTree tree) {
        ensureWaveletRenderView();
        if (waveletRenderView != null) {
            waveletRenderView.render(tree);
        }
        updateWaveletPlaceholder();
    }

    private void exitPreview() {
        showingPreview = false;
        isRenderingWavelet = false;
        activeWaveletTree = null;
        if (waveletRenderView != null) {
            waveletRenderView.clear();
        }
        updateViewMode();
    }

    private void updateViewMode() {
        if (binding == null) {
            return;
        }
        if (editorGroup != null) {
            editorGroup.setVisibility(showingPreview ? View.GONE : View.VISIBLE);
        }
        binding.waveletContainer.setVisibility(showingPreview ? View.VISIBLE : View.GONE);
        updateExecuteMenuIcon();
        updateWaveletPlaceholder();
    }

    private void updateExecuteMenuIcon() {
        if (executeMenuItem == null || !isAdded()) {
            return;
        }
        int iconRes = showingPreview ? R.drawable.ic_arrow_back_black : R.drawable.ai_play;
        executeMenuItem.setIcon(ContextCompat.getDrawable(requireContext(), iconRes));
        executeMenuItem.setTitle(showingPreview ? "Back" : "Execute");
    }

    private void updateWaveletPlaceholder() {
        if (binding == null) {
            return;
        }
        if (!showingPreview) {
            binding.waveletProgress.setVisibility(View.GONE);
            binding.waveletEmptyState.setVisibility(View.GONE);
            return;
        }
        binding.waveletProgress.setVisibility(isRenderingWavelet ? View.VISIBLE : View.GONE);
        boolean showEmpty = !isRenderingWavelet && activeWaveletTree == null;
        binding.waveletEmptyState.setVisibility(showEmpty ? View.VISIBLE : View.GONE);
        if (waveletRenderView != null) {
            waveletRenderView.setVisibility(showEmpty ? View.GONE : View.VISIBLE);
            if (showEmpty) {
                waveletRenderView.clear();
            }
        }
    }

    private void scheduleAutoSave() {
        autoSaveHandler.removeCallbacks(autoSaveRunnable);
        if (currentScriptName != null) {
            autoSaveHandler.postDelayed(autoSaveRunnable, AUTO_SAVE_DELAY_MS);
        }
    }

    private void loadScript(String scriptName) {
        String content = loadScriptFromInternalStorage(scriptName);
        setEditorText(content);
        currentScriptName = scriptName;
        hasUnsavedChanges = false;
        updateScriptEditorTitle();
        updateRecentScripts(scriptName);
    }

    private void createNewScript(String name) {
        saveScriptToInternalStorage(name, buildNewScriptTemplate());
        updateRecentScripts(name);
        loadScript(name);
        showToast("New script created: " + name);
    }

    private void copyCurrentScript(String name) {
        if (currentScriptName == null) {
            showToast("No script to copy");
            return;
        }
        saveScriptToInternalStorage(name, getEditorText());
        updateRecentScripts(name);
        loadScript(name);
        showToast("Script copied: " + name);
    }

    private void updateRecentScripts(String scriptName) {
        if (!recentScripts.contains(scriptName)) {
            recentScripts.add(scriptName);
            Collections.sort(recentScripts, String.CASE_INSENSITIVE_ORDER);
        }
        scriptAdapter.notifyDataSetChanged();
    }

    private void updateScriptEditorTitle() {
        if (binding == null) {
            return;
        }
        String name = currentScriptName != null ? currentScriptName : "Unsaved Script";
        if (hasUnsavedChanges) {
            name = name + " *";
        }
        binding.scriptEditorTitle.setText(String.format(Locale.US, "Script Editor (%s)", name));
    }

    private void showScriptOptionsDialog(String scriptName) {
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle("Rename Script");
        View dialogView = getLayoutInflater().inflate(R.layout.dialog_rename_script, null);
        EditText input = dialogView.findViewById(R.id.edit_script_name);
        input.setText(scriptName);
        builder.setView(dialogView);

        builder.setPositiveButton("OK", null);
        builder.setNegativeButton("Cancel", null);
        builder.setNeutralButton("Delete", null);

        AlertDialog dialog = builder.create();
        dialog.show();

        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String newName = input.getText().toString();
            if (newName.isEmpty()) {
                input.setError("Script name cannot be empty");
                return;
            }
            if (!newName.equals(scriptName)) {
                renameScript(scriptName, newName);
            }
            dialog.dismiss();
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
            if (!recentScripts.contains(newName)) {
                recentScripts.add(newName);
            }
            Collections.sort(recentScripts, String.CASE_INSENSITIVE_ORDER);
            scriptAdapter.notifyDataSetChanged();
            if (oldName.equals(currentScriptName)) {
                currentScriptName = newName;
                updateScriptEditorTitle();
            }
            showToast("Script renamed to: " + newName);
        } else {
            showToast("Failed to rename script");
        }
    }

    private void showDeleteConfirmationDialog(String scriptName) {
        new AlertDialog.Builder(requireContext())
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
            if (scriptName.equals(currentScriptName)) {
                setEditorText("");
                currentScriptName = null;
                hasUnsavedChanges = false;
                updateScriptEditorTitle();
            }
            showToast("Script deleted: " + scriptName);
        } else {
            showToast("Failed to delete script");
        }
    }

    private void showNameInputDialog(String title, String message, ScriptNameCallback callback) {
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle(title);
        builder.setMessage(message);
        final EditText input = new EditText(requireContext());
        builder.setView(input);
        builder.setPositiveButton("OK", (dialog, which) -> {
            String name = input.getText().toString();
            if (!name.isEmpty()) {
                callback.onNameEntered(name);
            }
        });
        builder.setNegativeButton("Cancel", null);
        builder.show();
    }

    private void openFile() {
        openFileLauncher.launch(new String[]{"*/*"});
    }

    private void saveAsFile() {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/javascript");
        intent.putExtra(Intent.EXTRA_TITLE, currentScriptName != null ? currentScriptName : "wavelet_script.js");
        createFileLauncher.launch(intent);
    }

    private void saveFileToUri(Uri uri) {
        try (OutputStream out = requireContext().getContentResolver().openOutputStream(uri)) {
            out.write(getEditorText().getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            Log.e(TAG, "Error writing to uri", e);
            showToast("Failed to save script");
        }
    }

    private void readScriptFromUri(Uri uri) {
        try (InputStream in = requireContext().getContentResolver().openInputStream(uri)) {
            if (in == null) {
                return;
            }
            String content = readTextFromInputStream(in);
            setEditorText(content);
        } catch (IOException e) {
            Log.e(TAG, "Error reading script", e);
            showToast("Failed to read script");
        }
    }

    private String readTextFromInputStream(InputStream inputStream) throws IOException {
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        byte[] buffer = new byte[1024];
        int length;
        while ((length = inputStream.read(buffer)) != -1) {
            result.write(buffer, 0, length);
        }
        return result.toString(StandardCharsets.UTF_8.name());
    }

    private void createDefaultScriptsIfNeeded() {
        File scriptsDir = getScriptsDir();
        if (!scriptsDir.exists() && !scriptsDir.mkdirs()) {
            Log.e(TAG, "Unable to create scripts directory");
            return;
        }

        ensureAssetScript("wavelet_demo.js");
        ensureAssetScript("wavelet_rfid.js");
        ensureAssetScript("wavelet_ism.js");
        ensureScriptExists("cc1101_radio_console.js", buildCc1101RadioConsoleScript());
        ensureScriptExists("hello_world_usb.js", buildDefaultBadUsbScript());
    }

    private void ensureScriptExists(String name, String content) {
        File file = new File(getScriptsDir(), name);
        if (!file.exists()) {
            saveScriptToInternalStorage(name, content);
        }
    }

    private void ensureAssetScript(String assetName) {
        File target = new File(getScriptsDir(), assetName);
        if (target.exists()) {
            return;
        }
        if (!isAdded()) {
            return;
        }
        try (InputStream in = requireContext().getAssets().open(assetName);
             FileOutputStream out = new FileOutputStream(target)) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        } catch (IOException e) {
            Log.e(TAG, "Unable to copy asset script: " + assetName, e);
        }
    }

    private File getScriptsDir() {
        File dir = new File(requireContext().getFilesDir(), SCRIPTS_DIR);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private List<String> getInternalScriptsList() {
        File[] files = getScriptsDir().listFiles();
        List<String> names = new ArrayList<>();
        if (files != null) {
            for (File file : files) {
                names.add(file.getName());
            }
        }
        return names;
    }

    private void saveScriptToInternalStorage(String fileName, String content) {
        File file = new File(getScriptsDir(), fileName);
        try (FileOutputStream fos = new FileOutputStream(file)) {
            fos.write(content.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            Log.e(TAG, "Error saving script", e);
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
            Log.e(TAG, "Error loading script", e);
        }
        return content.toString();
    }

    private void printLog(String message) {
        Log.d(TAG, message);
        if (message != null && message.startsWith("Wavelet error")) {
            showToast(message);
        }
    }

    private void toggleVisibility(View view) {
        view.setVisibility(view.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE);
    }

    private void updateArrow(TextView titleView, boolean isExpanded) {
        int drawable = isExpanded ? R.drawable.ic_arrow_up_black : R.drawable.ic_arrow_down_black;
        titleView.setCompoundDrawablesWithIntrinsicBounds(0, 0, drawable, 0);
    }

    private String getEditorText() {
        Editable text = binding.jsCodeInput.getText();
        return text != null ? text.toString() : "";
    }

    private void setEditorText(String text) {
        binding.jsCodeInput.setText(text);
    }

    private void showToast(String message) {
        if (!isAdded() || getActivity() == null) {
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (isAdded()) {
                Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show();
            }
        }
        );
    }

    private static String getFileNameFromUri(Context context, Uri uri) {
        String fileName = null;
        ContentResolver resolver = context.getContentResolver();
        Cursor cursor = resolver.query(uri, null, null, null, null);
        if (cursor != null) {
            try {
                if (cursor.moveToFirst()) {
                    int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (index != -1) {
                        fileName = cursor.getString(index);
                    }
                }
            } finally {
                cursor.close();
            }
        }
        return fileName != null ? fileName : "script.js";
    }

    private String buildNewScriptTemplate() {
        return "// Wavelet script\n" +
            "WaveletConsole.subscribe(render);\n" +
            "render();\n\n" +
            "function render() {\n" +
            "    UI.render(UI.column({\n" +
            "        padding: 16,\n" +
            "        spacing: 12,\n" +
            "        children: [\n" +
            "            UI.text({ text: 'Wavelet Title', font: 'title2', fontWeight: 'semibold' }),\n" +
            "            UI.text({ text: 'Customize this script to add controls and logic.', foregroundColor: '#6B7280' }),\n" +
            "            WaveletConsole.view({ minHeight: 160, backgroundColor: '#111827', foregroundColor: '#F9FAFB', padding: { top: 12, bottom: 12, leading: 12, trailing: 12 }, cornerRadius: 8 })\n" +
            "        ]\n" +
            "    }));\n" +
            "}\n";
    }

    private String buildDefaultBadUsbScript() {
        return "WaveletConsole.subscribe(render);\n" +
            "render();\n\n" +
            "function render() {\n" +
            "    UI.render(UI.column({\n" +
            "        padding: 16,\n" +
            "        spacing: 12,\n" +
            "        children: [\n" +
            "            UI.text({ text: 'BadUSB Hello World', font: 'title2', fontWeight: 'semibold' }),\n" +
            "            UI.text({ text: 'Send a simple HID payload to the connected host.', foregroundColor: '#6B7280' }),\n" +
            "            UI.button({ label: 'Execute Payload', backgroundColor: '#1D4ED8', foregroundColor: '#FFFFFF', onTap: runDemo }),\n" +
            "            WaveletConsole.view({\n" +
            "                minHeight: 160,\n" +
            "                backgroundColor: '#111827',\n" +
            "                foregroundColor: '#F9FAFB',\n" +
            "                padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },\n" +
            "                cornerRadius: 8\n" +
            "            })\n" +
            "        ]\n" +
            "    }));\n" +
            "}\n\n" +
            "function runDemo() {\n" +
            "    print('[BadUSB] Setting up HID attack mode...');\n" +
            "    BLEService.sendString('usb ATTACKMODE HID');\n" +
            "    Utils.delay(2000);\n" +
            "    BLEService.sendString('usb STRING_DELAY 10');\n" +
            "    Utils.delay(500);\n" +
            "    BLEService.sendString('usb STRING Hello, World!');\n" +
            "    Utils.delay(500);\n" +
            "    BLEService.sendString('usb ENTER');\n" +
            "    Utils.delay(500);\n" +
            "    print('[BadUSB] Payload complete.');\n" +
            "}\n";
    }

    private String buildCc1101RadioConsoleScript() {
        return "const state = {\n" +
            "    status: 'Idle',\n" +
            "    mode: 'Idle',\n" +
            "    log: [],\n" +
            "    initialized: false\n" +
            "};\n\n" +
            "function pushLog(message) {\n" +
            "    var stamp = new Date().toLocaleTimeString();\n" +
            "    state.log.push('[' + stamp + '] ' + message);\n" +
            "    if (state.log.length > 200) {\n" +
            "        state.log.shift();\n" +
            "    }\n" +
            "    render();\n" +
            "}\n\n" +
            "function setStatus(text, mode) {\n" +
            "    state.status = text;\n" +
            "    if (mode) {\n" +
            "        state.mode = mode;\n" +
            "    }\n" +
            "    render();\n" +
            "}\n\n" +
            "function ensureBridge() {\n" +
            "    if (typeof CC1101 !== 'object') {\n" +
            "        throw new Error('CC1101 bridge unavailable');\n" +
            "    }\n" +
            "}\n\n" +
            "function configureRadioBase() {\n" +
            "    ensureBridge();\n" +
            "    CC1101.spiStrobe(CC1101.SRES);\n" +
            "    CC1101.init();\n" +
            "    CC1101.writeReg(CC1101.PKTCTRL0, 0x32);\n" +
            "    CC1101.setGDOMode(0x2E, 0x2E, 0x0D);\n" +
            "    CC1101.setFrequencyMHz(433.92);\n" +
            "    CC1101.setDataRate(100000);\n" +
            "    CC1101.setModulationAndPower(CC1101.MOD_ASK, CC1101.POWER_10_DBM);\n" +
            "}\n\n" +
            "function startRx() {\n" +
            "    pushLog('Start RX pressed.');\n" +
            "    try {\n" +
            "        configureRadioBase();\n" +
            "        CC1101.spiStrobe(CC1101.SRX);\n" +
            "        setStatus('Receiving packets', 'RX');\n" +
            "        pushLog('RX active. Listening for packets.');\n" +
            "    } catch (error) {\n" +
            "        pushLog('RX error: ' + error);\n" +
            "    }\n" +
            "}\n\n" +
            "function startTx() {\n" +
            "    pushLog('Start TX pressed.');\n" +
            "    try {\n" +
            "        configureRadioBase();\n" +
            "        CC1101.spiStrobe(CC1101.STX);\n" +
            "        setStatus('Transmitting continuously', 'TX');\n" +
            "        pushLog('TX active. Broadcasting test signal.');\n" +
            "    } catch (error) {\n" +
            "        pushLog('TX error: ' + error);\n" +
            "    }\n" +
            "}\n\n" +
            "function stopRadio() {\n" +
            "    pushLog('Stop requested.');\n" +
            "    try {\n" +
            "        ensureBridge();\n" +
            "        CC1101.spiStrobe(CC1101.SIDLE);\n" +
            "        setStatus('Idle', 'Idle');\n" +
            "        pushLog('Radio set to IDLE.');\n" +
            "    } catch (error) {\n" +
            "        pushLog('Stop error: ' + error);\n" +
            "    }\n" +
            "}\n\n" +
            "function clearLog() {\n" +
            "    state.log = [];\n" +
            "    render();\n" +
            "}\n\n" +
            "function renderLogEntries() {\n" +
            "    if (state.log.length === 0) {\n" +
            "        return [UI.text({ text: 'No activity yet.', foregroundColor: '#6B7280' })];\n" +
            "    }\n" +
            "    return state.log.slice().reverse().map(function(entry) {\n" +
            "        return UI.text({ text: entry, fontDesign: 'monospaced', foregroundColor: '#374151' });\n" +
            "    });\n" +
            "}\n\n" +
            "function render() {\n" +
            "    UI.render(UI.column({\n" +
            "        padding: 16,\n" +
            "        spacing: 16,\n" +
            "        children: [\n" +
            "            UI.text({ text: 'CC1101 Radio Console', font: 'title2', fontWeight: 'semibold' }),\n" +
            "            UI.text({ text: 'Status: ' + state.status, fontWeight: 'medium' }),\n" +
            "            UI.text({ text: 'Bridge: ' + (typeof CC1101 === 'object' ? 'available' : 'missing'), foregroundColor: '#6B7280' }),\n" +
            "            UI.row({\n" +
            "                spacing: 8,\n" +
            "                children: [\n" +
            "                    UI.button({ label: 'Start RX', backgroundColor: '#2563EB', foregroundColor: '#FFFFFF', onTap: startRx }),\n" +
            "                    UI.button({ label: 'Start TX', backgroundColor: '#DC2626', foregroundColor: '#FFFFFF', onTap: startTx }),\n" +
            "                    UI.button({ label: 'Stop', buttonStyle: 'bordered', onTap: stopRadio }),\n" +
            "                    UI.button({ label: 'Clear Log', buttonStyle: 'bordered', onTap: clearLog })\n" +
            "                ]\n" +
            "            }),\n" +
            "            UI.scroll({\n" +
            "                minHeight: 200,\n" +
            "                padding: { top: 8, bottom: 8 },\n" +
            "                children: [\n" +
            "                    UI.column({\n" +
            "                        spacing: 4,\n" +
            "                        children: renderLogEntries()\n" +
            "                    })\n" +
            "                ]\n" +
            "            })\n" +
            "        ]\n" +
            "    }));\n" +
            "}\n\n" +
            "if (!state.initialized) {\n" +
            "    state.initialized = true;\n" +
            "    pushLog('Bridge ready: ' + (typeof CC1101));\n" +
            "}\n" +
            "render();\n";
    }
    private interface ScriptNameCallback {
        void onNameEntered(String name);
    }
}
