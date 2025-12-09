package com.emwaver.emwaverandroidapp.ui.wavelets;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.IBinder;
import android.provider.OpenableColumns;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.cardview.widget.CardView;
import androidx.core.view.MenuHost;
import androidx.core.view.MenuProvider;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.ViewModelProvider;

import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.Utils;
import com.emwaver.emwaverandroidapp.databinding.FragmentWaveletsBinding;
import com.emwaver.emwaverandroidapp.files.FileRepositoryLocal;
import com.emwaver.emwaverandroidapp.files.RepositoryCallback;
import com.emwaver.emwaverandroidapp.files.UserFileData;
import com.emwaver.emwaverandroidapp.files.UserFileMetadata;
import com.emwaver.emwaverandroidapp.ir.IrEncoderWrapper;
import com.emwaver.emwaverandroidapp.wavelets.WaveletConsoleState;
import com.emwaver.emwaverandroidapp.wavelets.WaveletEngine;
import com.emwaver.emwaverandroidapp.wavelets.WaveletRenderView;
import com.emwaver.emwaverandroidapp.wavelets.WaveletTree;
import com.google.android.material.button.MaterialButton;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

public class WaveletsFragment extends Fragment {

    private static final String TAG = "WaveletsFragment";
    private static final String SCRIPT_EXTENSION = ".js";

    private FragmentWaveletsBinding binding;
    private final List<UserFileMetadata> scriptFiles = new ArrayList<>();
    private ScriptListAdapter scriptAdapter;
    private UserFileMetadata currentScriptMetadata;
    private String currentScriptName;
    private String currentScriptEtag;
    private String currentDraftContent;
    private String pendingPreviewScriptId;

    private WaveletsViewModel viewModel;
    private FileRepositoryLocal fileRepository;

    private BLEService bleService;
    private boolean isServiceBound;
    private Utils utils;
    private IrEncoderWrapper irEncoderWrapper;

    private WaveletEngine waveletEngine;
    private WaveletRenderView waveletRenderView;
    private WaveletTree activeWaveletTree;
    private boolean isRenderingWavelet;
    private boolean showingPreview;
    private boolean showingEditor;
    
    public boolean isShowingPreview() {
        return showingPreview;
    }
    
    public boolean isShowingEditor() {
        return showingEditor;
    }
    private EditText scriptEditorContent;
    private FrameLayout scriptEditorContainer;

    private ActivityResultLauncher<String[]> openFileLauncher;

    private TextView scriptsListTitle;
    private CardView scriptListCard;
    private TextView consoleTitle;
    private CardView consoleCard;
    private ScrollView consoleScrollView;
    private TextView consoleTextView;
    private ScrollView editorScrollViewWrap;
    private HorizontalScrollView editorScrollViewNoWrap;
    private EditText scriptEditorContentWrap;
    private boolean lineWrapEnabled = false;
    private AlertDialog loadingDialog;

    private String getCurrentRecordId() {
        if (currentScriptMetadata != null && currentScriptMetadata.getId() != null) {
            return currentScriptMetadata.getId();
        }
        return WaveletsViewModel.UNSAVED_KEY;
    }

    private void updateDraftState(String content, boolean dirty) {
        if (viewModel == null) {
            return;
        }
        String id = getCurrentRecordId();
        String name = currentScriptName != null ? currentScriptName : "Unsaved Script";
        viewModel.updateDraft(id, name, content, dirty);
    }

    private boolean isCurrentScriptDirty() {
        if (viewModel == null) {
            return false;
        }
        return viewModel.isDirty(getCurrentRecordId());
    }

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            BLEService.LocalBinder binder = (BLEService.LocalBinder) service;
            bleService = binder.getService();
            isServiceBound = true;
            ensureWaveletEngineBindings();
            updateBleSyncStatus();
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            isServiceBound = false;
            bleService = null;
            ensureWaveletEngineBindings();
        }
    };

    private OnBackPressedCallback backPressedCallback;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        viewModel = new ViewModelProvider(requireActivity()).get(WaveletsViewModel.class);
        fileRepository = FileRepositoryLocal.getInstance(requireContext());
        
        backPressedCallback = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                if (showingEditor) {
                    exitEditor();
                } else if (showingPreview) {
                    exitPreview();
                }
            }
        };
        requireActivity().getOnBackPressedDispatcher().addCallback(this, backPressedCallback);
        
        // Handle action bar back button
        setHasOptionsMenu(true);
    }

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
        setupScriptList();
        setupConsoleSection();
        setupBleSyncToggle();
        setupCollapsibleSections();
        showingPreview = false;
        // Ensure console is hidden by default
        if (consoleTitle != null) {
            consoleTitle.setVisibility(View.GONE);
        }
        if (consoleCard != null) {
            consoleCard.setVisibility(View.GONE);
        }
        updateViewMode();
        updateWaveletPlaceholder();
        restoreFromViewModel();
        loadScriptsFromCloud();

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
        persistStateToViewModel();
        if (waveletEngine != null) {
            waveletEngine.shutdown();
            waveletEngine = null;
        }
        waveletRenderView = null;
        showingPreview = false;
        consoleTitle = null;
        consoleCard = null;
        consoleScrollView = null;
        consoleTextView = null;
        hideLoadingDialog();
        binding = null;
        super.onDestroyView();
    }

    private void setupMenu() {
        MenuHost menuHost = requireActivity();
        menuHost.addMenuProvider(new MenuProvider() {
            @Override
            public void onCreateMenu(@NonNull Menu menu, @NonNull MenuInflater menuInflater) {
                menuInflater.inflate(R.menu.console_menu, menu);
                
                // Show/hide editor-specific menu items
                MenuItem copyItem = menu.findItem(R.id.editor_copy);
                MenuItem pasteItem = menu.findItem(R.id.editor_paste);
                MenuItem previewItem = menu.findItem(R.id.editor_preview);
                MenuItem renameItem = menu.findItem(R.id.editor_rename);
                MenuItem deleteItem = menu.findItem(R.id.editor_delete);
                MenuItem lineWrapItem = menu.findItem(R.id.editor_line_wrap);
                MenuItem clearConsoleItem = menu.findItem(R.id.action_clear_console);
                
                boolean showEditorItems = showingEditor;
                if (copyItem != null) copyItem.setVisible(showEditorItems);
                if (pasteItem != null) pasteItem.setVisible(showEditorItems);
                if (previewItem != null) previewItem.setVisible(showEditorItems);
                if (renameItem != null) renameItem.setVisible(showEditorItems && currentScriptMetadata != null);
                if (deleteItem != null) deleteItem.setVisible(showEditorItems && currentScriptMetadata != null);
                if (lineWrapItem != null) {
                    lineWrapItem.setVisible(showEditorItems);
                    lineWrapItem.setChecked(lineWrapEnabled);
                }
                // Show clear console menu item only when previewing
                if (clearConsoleItem != null) clearConsoleItem.setVisible(showingPreview);
            }

            @Override
            public boolean onMenuItemSelected(@NonNull MenuItem menuItem) {
                int itemId = menuItem.getItemId();
                // Handle action bar home/back button when previewing
                if (itemId == android.R.id.home && showingPreview) {
                    exitPreview();
                    return true;
                }
                if (itemId == R.id.open) {
                    openFile();
                    return true;
                } else if (itemId == R.id.save_to_storage) {
                    saveCurrentScript();
                    return true;
                } else if (itemId == R.id.make_copy) {
                    showNameInputDialog("Copy Script", "Enter a name for the copy:", WaveletsFragment.this::copyCurrentScript);
                    return true;
                } else if (itemId == R.id.new_script) {
                    showNameInputDialog("New Script", "Enter a name for the new script:", WaveletsFragment.this::createNewScript);
                    return true;
                } else if (itemId == R.id.editor_copy) {
                    copyEditorContent();
                    return true;
                } else if (itemId == R.id.editor_paste) {
                    pasteEditorContent();
                    return true;
                } else if (itemId == R.id.editor_preview) {
                    previewEditorContent();
                    return true;
                } else if (itemId == R.id.editor_rename) {
                    if (currentScriptMetadata != null) {
                        showNameInputDialog(
                            "Rename Script",
                            "Enter a new name for the script:",
                            currentScriptMetadata.getName(),
                            newName -> renameScript(currentScriptMetadata, newName)
                        );
                    }
                    return true;
                } else if (itemId == R.id.editor_delete) {
                    if (currentScriptMetadata != null) {
                        showDeleteConfirmationDialog(currentScriptMetadata);
                    }
                    return true;
                } else if (itemId == R.id.editor_line_wrap) {
                    lineWrapEnabled = !lineWrapEnabled;
                    menuItem.setChecked(lineWrapEnabled);
                    updateLineWrap();
                    return true;
                } else if (itemId == R.id.reset_defaults) {
                    showResetDefaultsConfirmationDialog();
                    return true;
                } else if (itemId == R.id.action_clear_console) {
                    WaveletConsoleState.getInstance().clear();
                    return true;
                }
                return false;
            }
        }, getViewLifecycleOwner(), Lifecycle.State.RESUMED);
    }

    private void setupFileLaunchers() {
        openFileLauncher = registerForActivityResult(new ActivityResultContracts.OpenDocument(), uri -> {
            if (uri != null) {
                importScriptFromUri(uri);
            }
        });
    }

    private void setupScriptList() {
        scriptListCard = binding.scriptListCard;
        scriptAdapter = new ScriptListAdapter();
        binding.scriptListView.setAdapter(scriptAdapter);

        binding.scriptListView.setOnItemClickListener((parent, view, position, id) -> {
            Log.d(TAG, "ListView clicked at position " + position + ", scriptFiles.size=" + scriptFiles.size());
            if (position >= 0 && position < scriptFiles.size()) {
                previewScript(scriptFiles.get(position));
            }
        });

        binding.scriptListView.setOnItemLongClickListener((parent, view, position, id) -> {
            if (position >= 0 && position < scriptFiles.size()) {
                showScriptOptionsDialog(scriptFiles.get(position));
            }
            return true;
        });
    }

    private void setupConsoleSection() {
        consoleTitle = binding.consoleTitle;
        consoleCard = binding.consoleCard;
        consoleScrollView = binding.consoleScroll;
        consoleTextView = binding.consoleText;

        scriptEditorContainer = binding.scriptEditorContainer;
        scriptEditorContent = binding.scriptEditorContent;
        editorScrollViewWrap = binding.editorScrollViewWrap;
        editorScrollViewNoWrap = binding.editorScrollViewNowrap;
        scriptEditorContentWrap = binding.scriptEditorContentWrap;
        
        // Set up text watcher for both EditTexts
        scriptEditorContent.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            
            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                String updated = s != null ? s.toString() : "";
                setEditorText(updated);
                updateDraftState(updated, true);
                // Sync to wrap version
                if (scriptEditorContentWrap != null && !scriptEditorContentWrap.getText().toString().equals(updated)) {
                    scriptEditorContentWrap.setText(updated);
                }
            }
            
            @Override
            public void afterTextChanged(Editable s) {}
        });
        
        if (scriptEditorContentWrap != null) {
            scriptEditorContentWrap.addTextChangedListener(new TextWatcher() {
                @Override
                public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
                
                @Override
                public void onTextChanged(CharSequence s, int start, int before, int count) {
                    String updated = s != null ? s.toString() : "";
                    setEditorText(updated);
                    updateDraftState(updated, true);
                    // Sync to no-wrap version
                    if (scriptEditorContent != null && !scriptEditorContent.getText().toString().equals(updated)) {
                        scriptEditorContent.setText(updated);
                    }
                }
                
                @Override
                public void afterTextChanged(Editable s) {}
            });
        }
        
        scriptEditorContent.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            
            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                String updated = s != null ? s.toString() : "";
                setEditorText(updated);
                updateDraftState(updated, true);
            }
            
            @Override
            public void afterTextChanged(Editable s) {}
        });
        
        updateLineWrap();

        updateConsoleText(WaveletConsoleState.getInstance().snapshot());
        WaveletConsoleState.getInstance().observe().observe(getViewLifecycleOwner(), this::updateConsoleText);
    }

    private void setupBleSyncToggle() {
        TextView statusText = binding.bleSyncStatusText;
        MaterialButton toggleButton = binding.bleSyncToggleButton;

        toggleButton.setOnClickListener(v -> {
            if (bleService == null) {
                Toast.makeText(requireContext(), "BLE service not available", Toast.LENGTH_SHORT).show();
                return;
            }

            if (bleService.isFileSyncServerRunning()) {
                Log.d(TAG, "User clicked: Stopping file sync server");
                bleService.stopFileSyncServer();
                statusText.setText("📡 CLI File Sync: Inactive");
                statusText.setTextColor(getResources().getColor(R.color.textSecondary));
                toggleButton.setText("Enable");
            } else {
                Log.d(TAG, "User clicked: Starting file sync server");
                bleService.startFileSyncServer();
                statusText.setText("📡 CLI File Sync: Active");
                statusText.setTextColor(getResources().getColor(android.R.color.holo_green_dark));
                toggleButton.setText("Disable");
            }
        });

        // Initial state
        updateBleSyncStatus();
    }

    private void updateBleSyncStatus() {
        if (binding == null || bleService == null) {
            return;
        }

        TextView statusText = binding.bleSyncStatusText;
        MaterialButton toggleButton = binding.bleSyncToggleButton;

        if (bleService.isFileSyncServerRunning()) {
            statusText.setText("📡 CLI File Sync: Active");
            statusText.setTextColor(getResources().getColor(android.R.color.holo_green_dark));
            toggleButton.setText("Disable");
        } else {
            statusText.setText("📡 CLI File Sync: Inactive");
            statusText.setTextColor(getResources().getColor(R.color.textSecondary));
            toggleButton.setText("Enable");
        }
    }

    private void updateConsoleText(List<String> lines) {
        if (consoleTextView == null) {
            return;
        }
        String text;
        if (lines == null || lines.isEmpty()) {
            text = "Console is empty.";
        } else {
            text = TextUtils.join("\n", lines);
        }
        consoleTextView.setText(text);
        if (consoleScrollView != null && lines != null && !lines.isEmpty()) {
            consoleScrollView.post(() -> consoleScrollView.fullScroll(View.FOCUS_DOWN));
        }
    }

    private void refreshScriptList() {
        if (scriptAdapter != null) {
            Log.d(TAG, "refreshScriptList: notifying adapter with " + scriptFiles.size() + " items");
            scriptAdapter.notifyDataSetChanged();
        }
    }

    private void previewScript(UserFileMetadata metadata) {
        if (!isAdded() || metadata == null || TextUtils.isEmpty(metadata.getId())) {
            Log.w(TAG, "previewScript: invalid state or metadata");
            return;
        }
        Log.d(TAG, "previewScript: " + metadata.getName() + " (id=" + metadata.getId() + ")");
        pendingPreviewScriptId = metadata.getId();
        loadScript(metadata);
    }

    private class ScriptListAdapter extends ArrayAdapter<UserFileMetadata> {
        ScriptListAdapter() {
            super(requireContext(), 0, scriptFiles);
        }

        @NonNull
        @Override
        public View getView(int position, @Nullable View convertView, @NonNull ViewGroup parent) {
            View view = convertView;
            if (view == null) {
                view = LayoutInflater.from(getContext()).inflate(R.layout.item_script_entry, parent, false);
            }
            TextView nameView = view.findViewById(R.id.script_name);
            ImageButton editButton = view.findViewById(R.id.script_edit_button);
            UserFileMetadata metadata = getItem(position);
            if (metadata != null) {
                nameView.setText(metadata.getName());
                editButton.setOnClickListener(v -> {
                    v.setPressed(false);
                    showScriptEditorDialog(metadata);
                });
            } else {
                nameView.setText("-");
                editButton.setOnClickListener(null);
            }
            return view;
        }
    }

    private void loadScriptsFromCloud() {
        if (fileRepository == null) {
            return;
        }
        fileRepository.listFiles(SCRIPT_EXTENSION, new RepositoryCallback<List<UserFileMetadata>>() {
            @Override
            public void onSuccess(List<UserFileMetadata> value) {
                if (!isAdded()) {
                    return;
                }
                scriptFiles.clear();
                if (value != null) {
                    scriptFiles.addAll(value);
                }
                
                // Migrate CC1101 scripts to RFM69
                migrateCC1101ToRFM69();
                
                if (scriptFiles.isEmpty()) {
                    loadDefaultWaveletsFromAssets();
                } else {
                    Collections.sort(scriptFiles, (a, b) -> a.getName().compareToIgnoreCase(b.getName()));
                    refreshScriptList();
                    primeScriptCache(new ArrayList<>(scriptFiles), WaveletsFragment.this::handlePostListLoad);
                }
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) {
                    return;
                }
                showToast(message != null ? message : "Failed to load scripts");
                handlePostListLoad();
            }
        });
    }
    
    private void migrateCC1101ToRFM69() {
        if (fileRepository == null || scriptFiles.isEmpty()) {
            return;
        }
        
        List<UserFileMetadata> toDelete = new ArrayList<>();
        for (UserFileMetadata script : scriptFiles) {
            String name = script.getName().toLowerCase();
            if (name.equals("cc1101") || name.equals("cc1101_radio_console") || name.equals("cc1101_radio_module")) {
                toDelete.add(script);
            }
        }
        
        if (toDelete.isEmpty()) {
            return;
        }
        
        // Remove CC1101 scripts from the list synchronously
        for (UserFileMetadata script : toDelete) {
            scriptFiles.remove(script);
            if (viewModel != null) {
                viewModel.removeRecord(script.getId());
            }
            // Delete asynchronously in background
            fileRepository.deleteFile(script.getId(), script.getEtag(), new RepositoryCallback<Void>() {
                @Override
                public void onSuccess(Void value) {
                    Log.d(TAG, "Migrated CC1101 script: " + script.getName());
                }
                
                @Override
                public void onError(String message) {
                    Log.w(TAG, "Failed to delete CC1101 script during migration: " + script.getName());
                }
            });
        }
    }
    
    private void loadDefaultWaveletsFromAssets() {
        if (!isAdded()) {
            return;
        }
        
        String[] defaultWavelets = {
            "rfm69.js",
            "rfm69_radio_console.js",
            "rfm69_radio_module.js",
            "hello_world_usb.js",
            "wavelet_console_demo.js",
            "wavelet_demo.js",
            "wavelet_gpio.js",
            "wavelet_rfid.js"
        };
        
        AtomicInteger remaining = new AtomicInteger(defaultWavelets.length);
        AtomicInteger successCount = new AtomicInteger(0);
        
        for (String filename : defaultWavelets) {
            try {
                InputStream is = requireContext().getAssets().open(filename);
                String content = readTextFromInputStream(is);
                is.close();
                
                String name = filename.replace(".js", "");
                createScriptInBackground(name, content, () -> {
                    successCount.incrementAndGet();
                    if (remaining.decrementAndGet() == 0) {
                        onDefaultWaveletsLoaded(successCount.get());
                    }
                }, () -> {
                    if (remaining.decrementAndGet() == 0) {
                        onDefaultWaveletsLoaded(successCount.get());
                    }
                });
            } catch (IOException e) {
                Log.w(TAG, "Could not load default wavelet: " + filename, e);
                if (remaining.decrementAndGet() == 0) {
                    onDefaultWaveletsLoaded(successCount.get());
                }
            }
        }
    }
    
    private void onDefaultWaveletsLoaded(int count) {
        if (!isAdded()) {
            return;
        }
        requireActivity().runOnUiThread(() -> {
            if (count > 0) {
                showToast("Loaded " + count + " default wavelets");
            }
            loadScriptsFromCloud();
        });
    }
    
    private void createScriptInBackground(String name, String content, Runnable onSuccess, Runnable onError) {
        if (fileRepository == null) {
            if (onError != null) {
                onError.run();
            }
            return;
        }
        fileRepository.createTextFile(normalizeScriptName(name), content, new RepositoryCallback<UserFileMetadata>() {
            @Override
            public void onSuccess(UserFileMetadata metadata) {
                Log.d(TAG, "Created default wavelet: " + name);
                if (onSuccess != null) {
                    onSuccess.run();
                }
            }

            @Override
            public void onError(String message) {
                Log.w(TAG, "Failed to create default wavelet " + name + ": " + message);
                if (onError != null) {
                    onError.run();
                }
            }
        });
    }

    private void renameScript(UserFileMetadata metadata, String newName) {
        renameScript(metadata, newName, null);
    }

    private void renameScript(UserFileMetadata metadata, String newName, @Nullable Consumer<UserFileMetadata> onSuccess) {
        if (fileRepository == null) {
            return;
        }
        final String normalizedName = normalizeScriptName(newName);
        fileRepository.renameFile(metadata.getId(), normalizedName, new RepositoryCallback<UserFileMetadata>() {
            @Override
            public void onSuccess(UserFileMetadata updated) {
                if (!isAdded()) {
                    return;
                }
                addOrReplaceMetadata(updated);
                if (currentScriptMetadata != null && currentScriptMetadata.getId().equals(updated.getId())) {
                    currentScriptMetadata = updated;
                    currentScriptName = updated.getName();
                    currentScriptEtag = updated.getEtag();
                }
                if (viewModel != null) {
                    String draft = viewModel.getDraftContent(updated.getId());
                    boolean dirty = viewModel.isDirty(updated.getId());
                    String reference = draft != null ? draft : viewModel.getRemoteContent(updated.getId());
                    if (reference == null) {
                        reference = "";
                    }
                    viewModel.updateDraft(updated.getId(), updated.getName(), reference, dirty);
                    if (TextUtils.equals(viewModel.getLastScriptId(), updated.getId())) {
                        viewModel.setLastScriptName(updated.getName());
                        viewModel.setLastScriptContent(reference);
                    }
                }
                if (onSuccess != null) {
                    onSuccess.accept(updated);
                }
                showToast("Script renamed to: " + updated.getName());
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) {
                    return;
                }
                showToast(message != null ? message : "Failed to rename script");
            }
        });
    }

    private void handlePostListLoad() {
        if (!isAdded()) {
            return;
        }

        if (scriptFiles.isEmpty()) {
            if (binding != null) {
                String content = null;
                boolean dirty = false;
                if (viewModel != null) {
                    content = viewModel.getDraftContent(WaveletsViewModel.UNSAVED_KEY);
                    dirty = viewModel.isDirty(WaveletsViewModel.UNSAVED_KEY);
                }
                if (content == null) {
                    content = buildNewScriptTemplate();
                }
                currentScriptMetadata = null;
                currentScriptName = null;
                currentScriptEtag = null;
                setEditorText(content);
                updateDraftState(content, dirty);
            }
            return;
        }

        UserFileMetadata target = null;
        if (currentScriptMetadata != null) {
            target = findScriptById(currentScriptMetadata.getId());
        }
        if (target == null && viewModel != null) {
            String lastId = viewModel.getLastScriptId();
            if (!TextUtils.isEmpty(lastId)) {
                target = findScriptById(lastId);
            }
        }
        if (target == null) {
            target = scriptFiles.get(0);
        }
        if (target != null) {
            loadScript(target);
        }
    }

    private UserFileMetadata findScriptById(String id) {
        if (id == null) {
            return null;
        }
        for (UserFileMetadata metadata : scriptFiles) {
            if (metadata != null && TextUtils.equals(id, metadata.getId())) {
                return metadata;
            }
        }
        return null;
    }

    private void addOrReplaceMetadata(UserFileMetadata metadata) {
        if (metadata == null) {
            return;
        }
        boolean replaced = false;
        for (int i = 0; i < scriptFiles.size(); i++) {
            UserFileMetadata existing = scriptFiles.get(i);
            if (existing != null && TextUtils.equals(existing.getId(), metadata.getId())) {
                scriptFiles.set(i, metadata);
                replaced = true;
                break;
            }
        }
        if (!replaced) {
            scriptFiles.add(metadata);
        }
        Collections.sort(scriptFiles, (a, b) -> a.getName().compareToIgnoreCase(b.getName()));
        refreshScriptList();
    }

    private void removeMetadataById(String id) {
        for (int i = 0; i < scriptFiles.size(); i++) {
            if (scriptFiles.get(i).getId().equals(id)) {
                scriptFiles.remove(i);
                break;
            }
        }
    }

    private void onScriptCreated(UserFileMetadata metadata, String content) {
        if (binding == null) {
            return;
        }
        addOrReplaceMetadata(metadata);
        currentScriptMetadata = metadata;
        currentScriptName = metadata.getName();
        currentScriptEtag = metadata.getEtag();
        setEditorText(content);
        updateDraftState(content, false);
        if (viewModel != null) {
            viewModel.removeRecord(WaveletsViewModel.UNSAVED_KEY);
            viewModel.markClean(metadata.getId(), content, metadata.getEtag());
            viewModel.setLastScriptId(metadata.getId());
            viewModel.setLastScriptName(metadata.getName());
            viewModel.setLastScriptContent(content);
        }
        showScriptEditorDialog(metadata);
    }

    private void loadScript(UserFileMetadata metadata) {
        if (!isAdded() || metadata == null) {
            return;
        }

        currentScriptMetadata = metadata;
        currentScriptName = metadata.getName();
        currentScriptEtag = metadata.getEtag();

        final String scriptId = metadata.getId();
        final boolean hasRepository = fileRepository != null;

        boolean needsFetch = true;
        boolean hasContent = false;
        if (viewModel != null && scriptId != null) {
            String cachedDraft = viewModel.getDraftContent(scriptId);
            boolean dirty = viewModel.isDirty(scriptId);
            if (cachedDraft != null && !cachedDraft.trim().isEmpty()) {
                setEditorText(cachedDraft);
                updateDraftState(cachedDraft, dirty);
                hasContent = true;
                completePendingPreview(scriptId);
            }
            String cachedEtag = viewModel.getRemoteEtag(scriptId);
            String cachedRemote = viewModel.getRemoteContent(scriptId);
            if (!TextUtils.isEmpty(cachedEtag) && cachedRemote != null && TextUtils.equals(cachedEtag, metadata.getEtag())) {
                needsFetch = false;
                if (!dirty) {
                    setEditorText(cachedRemote);
                    updateDraftState(cachedRemote, false);
                }
                String contentToUse = getEditorText();
                if (contentToUse == null || contentToUse.trim().isEmpty()) {
                    contentToUse = cachedRemote;
                    setEditorText(cachedRemote);
                }
                viewModel.updateDraft(scriptId, metadata.getName(), contentToUse, dirty);
                viewModel.setLastScriptId(scriptId);
                viewModel.setLastScriptName(metadata.getName());
                viewModel.setLastScriptContent(contentToUse);
                hasContent = true;
                completePendingPreview(scriptId);
            }
        }

        // Only complete preview if we have content, otherwise wait for fetch
        if (!hasRepository || scriptId == null) {
            if (hasContent) {
                completePendingPreview(scriptId);
            } else {
                // No content and can't fetch - clear pending preview
                pendingPreviewScriptId = null;
                showToast("Failed to load script content");
            }
            return;
        }
        
        // If we don't need to fetch and have content, we've already called completePendingPreview above
        if (!needsFetch && hasContent) {
            return;
        }

        fileRepository.getFile(scriptId, new RepositoryCallback<UserFileData>() {
            @Override
            public void onSuccess(UserFileData data) {
                if (!isAdded() || binding == null) {
                    return;
                }
                String content = data != null && data.hasTextContent() ? data.getTextContent() : "";
                if (viewModel != null) {
                    viewModel.updateRemoteSnapshot(scriptId, metadata.getName(), metadata.getEtag(), content);
                    if (!viewModel.isDirty(scriptId)) {
                        viewModel.updateDraft(scriptId, metadata.getName(), content, false);
                    }
                    String draft = viewModel.getDraftContent(scriptId);
                    String display = draft != null ? draft : content;
                    setEditorText(display);
                    updateDraftState(display, viewModel.isDirty(scriptId));
                    viewModel.setLastScriptId(scriptId);
                    viewModel.setLastScriptName(metadata.getName());
                    viewModel.setLastScriptContent(display);
                    completePendingPreview(scriptId);
                } else {
                    setEditorText(content);
                    completePendingPreview(scriptId);
                }
            }

            @Override
            public void onError(String message) {
                if (TextUtils.equals(pendingPreviewScriptId, scriptId)) {
                    pendingPreviewScriptId = null;
                }
                if (!isAdded()) {
                    return;
                }
                showToast(message != null ? message : "Failed to load script");
            }
        });
    }

    private void createNewScript(String name) {
        createScriptWithContent(name, buildNewScriptTemplate(), "Script created: ");
    }

    private void createScriptWithContent(String name, String content, String successPrefix) {
        if (fileRepository == null) {
            return;
        }
        final String normalizedName = normalizeScriptName(name);
        final String resolvedContent = content != null ? content : "";
        fileRepository.createTextFile(normalizedName, resolvedContent, new RepositoryCallback<UserFileMetadata>() {
            @Override
            public void onSuccess(UserFileMetadata metadata) {
                if (!isAdded()) {
                    return;
                }
                onScriptCreated(metadata, resolvedContent);
                String message = successPrefix != null ? successPrefix + metadata.getName() : "Script created: " + metadata.getName();
                showToast(message);
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) {
                    return;
                }
                showToast(message != null ? message : "Failed to create script");
            }
        });
    }

    private void copyCurrentScript(String name) {
        if (fileRepository == null || currentScriptMetadata == null) {
            showToast("No script to copy");
            return;
        }
        final String normalizedName = normalizeScriptName(name);
        fileRepository.copyFile(currentScriptMetadata.getId(), normalizedName, new RepositoryCallback<UserFileMetadata>() {
            @Override
            public void onSuccess(UserFileMetadata metadata) {
                if (!isAdded()) {
                    return;
                }
                addOrReplaceMetadata(metadata);
                showScriptEditorDialog(metadata);
                showToast("Script copied: " + metadata.getName());
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) {
                    return;
                }
                showToast(message != null ? message : "Failed to copy script");
            }
        });
    }

    private void saveCurrentScript() {
        if (fileRepository == null) {
            return;
        }
        if (currentScriptMetadata == null) {
            showNameInputDialog(
                "Save Script",
                "Enter a name for the script:",
                currentScriptName != null ? currentScriptName : "wavelet_script.js",
                name -> createScriptWithContent(name, getEditorText(), "Script saved: ")
            );
            return;
        }
        if (!isCurrentScriptDirty()) {
            showToast("No changes to save");
            return;
        }
        final String etag = currentScriptEtag;
        if (TextUtils.isEmpty(etag)) {
            showToast("Please reload the script before saving");
            return;
        }
        final String content = getEditorText();
        fileRepository.updateTextFile(currentScriptMetadata.getId(), etag, content, new RepositoryCallback<UserFileMetadata>() {
            @Override
            public void onSuccess(UserFileMetadata metadata) {
                if (!isAdded()) {
                    return;
                }
                addOrReplaceMetadata(metadata);
                currentScriptMetadata = metadata;
                currentScriptName = metadata.getName();
                currentScriptEtag = metadata.getEtag();
                updateDraftState(content, false);
                if (viewModel != null) {
                    viewModel.setLastScriptId(metadata.getId());
                    viewModel.setLastScriptName(metadata.getName());
                    viewModel.setLastScriptContent(content);
                    viewModel.markClean(metadata.getId(), content, metadata.getEtag());
                }
                showToast("Script saved");
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) {
                    return;
                }
                showToast(message != null ? message : "Failed to save script");
            }
        });
    }

    private void showScriptOptionsDialog(UserFileMetadata metadata) {
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle("Rename Script");
        View dialogView = getLayoutInflater().inflate(R.layout.dialog_rename_script, null);
        EditText input = dialogView.findViewById(R.id.edit_script_name);
        input.setText(metadata.getName());
        builder.setView(dialogView);

        builder.setPositiveButton("OK", null);
        builder.setNegativeButton("Cancel", null);
        builder.setNeutralButton("Delete", null);

        AlertDialog dialog = builder.create();
        dialog.show();

        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String newName = input.getText().toString().trim();
            if (newName.isEmpty()) {
                input.setError("Script name cannot be empty");
                return;
            }
            renameScript(metadata, newName);
            dialog.dismiss();
        });

        dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> {
            showDeleteConfirmationDialog(metadata);
            dialog.dismiss();
        });
    }

    private void exitEditor() {
        showingEditor = false;
        currentScriptMetadata = null;
        currentScriptName = null;
        currentScriptEtag = null;
        updateViewMode();
    }

    private void showScriptEditorDialog(@Nullable UserFileMetadata metadata) {
        if (!isAdded()) {
            return;
        }
        
        showingEditor = true;
        pendingPreviewScriptId = null;
        final String scriptId = metadata != null ? metadata.getId() : WaveletsViewModel.UNSAVED_KEY;
        final String scriptName = metadata != null ? metadata.getName() : (currentScriptName != null ? currentScriptName : "Unsaved Script");

        if (metadata != null) {
            currentScriptMetadata = metadata;
            currentScriptName = metadata.getName();
            currentScriptEtag = metadata.getEtag();
        } else {
            currentScriptMetadata = null;
            currentScriptName = scriptName;
            currentScriptEtag = null;
        }

        String content = null;
        boolean dirty = false;
        if (viewModel != null) {
            content = viewModel.getDraftContent(scriptId);
            dirty = viewModel.isDirty(scriptId);
            if (content == null) {
                content = viewModel.getRemoteContent(scriptId);
            }
        }
        if (content == null) {
            content = metadata != null ? "" : buildNewScriptTemplate();
        }

        if (metadata != null && viewModel != null && TextUtils.isEmpty(viewModel.getRemoteEtag(scriptId)) && fileRepository != null) {
            showLoadingDialog("Loading script...");
            fileRepository.getFile(scriptId, new RepositoryCallback<UserFileData>() {
                @Override
                public void onSuccess(UserFileData data) {
                    hideLoadingDialog();
                    if (!isAdded()) {
                        return;
                    }
                    String remoteContent = data != null && data.hasTextContent() ? data.getTextContent() : "";
                    viewModel.updateRemoteSnapshot(scriptId, scriptName, metadata.getEtag(), remoteContent);
                    if (!viewModel.isDirty(scriptId)) {
                        viewModel.updateDraft(scriptId, scriptName, remoteContent, false);
                    }
                    setEditorText(remoteContent);
                    showScriptEditorDialog(metadata);
                }

                @Override
                public void onError(String message) {
                    hideLoadingDialog();
                    if (isAdded()) {
                        showToast(message != null ? message : "Failed to load script");
                    }
                }
            });
            return;
        }

        setEditorText(content);
        updateDraftState(content, dirty);
        if (viewModel != null) {
            viewModel.setLastScriptId(currentScriptMetadata != null ? currentScriptMetadata.getId() : null);
            viewModel.setLastScriptName(scriptName);
            viewModel.setLastScriptContent(content);
        }

        // Set text on the appropriate EditText based on line wrap state
        if (lineWrapEnabled && scriptEditorContentWrap != null) {
            scriptEditorContentWrap.setText(content);
            scriptEditorContentWrap.setSelection(content.length());
        } else if (!lineWrapEnabled && scriptEditorContent != null) {
            scriptEditorContent.setText(content);
            scriptEditorContent.setSelection(content.length());
        }
        updateLineWrap();
        updateViewMode();
    }

    private void showDeleteConfirmationDialog(UserFileMetadata metadata) {
        if (!isAdded() || metadata == null) {
            return;
        }
        new AlertDialog.Builder(requireContext())
            .setTitle("Delete Script")
            .setMessage("Are you sure you want to delete " + metadata.getName() + "?")
            .setPositiveButton("Delete", (dialog, which) -> deleteScript(metadata))
            .setNegativeButton("Cancel", null)
            .show();
    }
    
    private void showResetDefaultsConfirmationDialog() {
        if (!isAdded()) {
            return;
        }
        new AlertDialog.Builder(requireContext())
            .setTitle("Reset to Default Scripts")
            .setMessage("This will delete ALL scripts from internal storage and restore default scripts. This action cannot be undone.\n\nAre you sure you want to continue?")
            .setPositiveButton("Reset", (dialog, which) -> resetToDefaults())
            .setNegativeButton("Cancel", null)
            .show();
    }
    
    private void resetToDefaults() {
        if (fileRepository == null) {
            showToast("File repository unavailable");
            return;
        }
        
        if (scriptFiles.isEmpty()) {
            // No scripts to delete, just load defaults
            loadDefaultWaveletsFromAssets();
            return;
        }
        
        showLoadingDialog("Resetting to defaults...");
        
        // Delete all scripts
        AtomicInteger remaining = new AtomicInteger(scriptFiles.size());
        AtomicInteger successCount = new AtomicInteger(0);
        
        for (UserFileMetadata script : new ArrayList<>(scriptFiles)) {
            fileRepository.deleteFile(script.getId(), script.getEtag(), new RepositoryCallback<Void>() {
                @Override
                public void onSuccess(Void value) {
                    scriptFiles.remove(script);
                    if (viewModel != null) {
                        viewModel.removeRecord(script.getId());
                    }
                    successCount.incrementAndGet();
                    if (remaining.decrementAndGet() == 0) {
                        // All scripts deleted, now load defaults
                        hideLoadingDialog();
                        scriptFiles.clear();
                        if (viewModel != null) {
                            viewModel.clearAll();
                        }
                        currentScriptMetadata = null;
                        currentScriptName = null;
                        currentScriptEtag = null;
                        setEditorText("");
                        loadDefaultWaveletsFromAssets();
                    }
                }
                
                @Override
                public void onError(String message) {
                    Log.w(TAG, "Failed to delete script during reset: " + script.getName());
                    if (remaining.decrementAndGet() == 0) {
                        hideLoadingDialog();
                        // Still load defaults even if some deletions failed
                        scriptFiles.clear();
                        if (viewModel != null) {
                            viewModel.clearAll();
                        }
                        currentScriptMetadata = null;
                        currentScriptName = null;
                        currentScriptEtag = null;
                        setEditorText("");
                        loadDefaultWaveletsFromAssets();
                    }
                }
            });
        }
    }

    private void deleteScript(UserFileMetadata metadata) {
        if (fileRepository == null || metadata == null) {
            return;
        }
        showLoadingDialog("Deleting script...");
        fileRepository.deleteFile(metadata.getId(), metadata.getEtag(), new RepositoryCallback<Void>() {
            @Override
            public void onSuccess(Void value) {
                hideLoadingDialog();
                if (!isAdded()) {
                    return;
                }
                String deletedId = metadata.getId();
                removeMetadataById(deletedId);
                refreshScriptList();
                if (viewModel != null && !TextUtils.isEmpty(deletedId)) {
                    viewModel.removeRecord(deletedId);
                    if (TextUtils.equals(viewModel.getLastScriptId(), deletedId)) {
                        viewModel.setLastScriptId(null);
                        viewModel.setLastScriptName(null);
                        viewModel.setLastScriptContent(null);
                    }
                }
                if (currentScriptMetadata != null && TextUtils.equals(currentScriptMetadata.getId(), deletedId)) {
                    currentScriptMetadata = null;
                    currentScriptName = null;
                    currentScriptEtag = null;
                    setEditorText("");
                    updateDraftState("", false);
                }
                handlePostListLoad();
                showToast("Script deleted: " + metadata.getName());
            }

            @Override
            public void onError(String message) {
                hideLoadingDialog();
                if (!isAdded()) {
                    return;
                }
                showToast(message != null ? message : "Failed to delete script");
            }
        });
    }

    private void primeScriptCache(List<UserFileMetadata> metadataList, @Nullable Runnable completion) {
        if (!isAdded() || viewModel == null || fileRepository == null || metadataList == null || metadataList.isEmpty()) {
            if (completion != null) {
                runOnUiThreadSafe(completion);
            }
            return;
        }
        boolean needsRefresh = false;
        for (UserFileMetadata metadata : metadataList) {
            if (metadata == null || TextUtils.isEmpty(metadata.getId())) {
                continue;
            }
            String cachedEtag = viewModel.getRemoteEtag(metadata.getId());
            String cachedContent = viewModel.getRemoteContent(metadata.getId());
            if (TextUtils.isEmpty(cachedEtag) || cachedContent == null || !TextUtils.equals(cachedEtag, metadata.getEtag())) {
                needsRefresh = true;
                break;
            }
        }
        if (!needsRefresh) {
            if (completion != null) {
                runOnUiThreadSafe(completion);
            }
            return;
        }

        showLoadingDialog("Loading files...");
        fileRepository.listFilesWithContent(SCRIPT_EXTENSION, new RepositoryCallback<List<UserFileData>>() {
            @Override
            public void onSuccess(List<UserFileData> value) {
                if (!isAdded() || viewModel == null) {
                    hideLoadingDialog();
                    if (completion != null) {
                        completion.run();
                    }
                    return;
                }
                if (value != null) {
                    for (UserFileData data : value) {
                        if (data == null || data.getMetadata() == null) {
                            continue;
                        }
                        UserFileMetadata metadata = data.getMetadata();
                        String scriptId = metadata.getId();
                        if (TextUtils.isEmpty(scriptId)) {
                            continue;
                        }
                        String remoteContent = data.hasTextContent() ? data.getTextContent() : "";
                        viewModel.updateRemoteSnapshot(scriptId, metadata.getName(), metadata.getEtag(), remoteContent);
                        if (!viewModel.isDirty(scriptId)) {
                            viewModel.updateDraft(scriptId, metadata.getName(), remoteContent, false);
                        }
                    }
                }
                hideLoadingDialog();
                if (completion != null) {
                    completion.run();
                }
            }

            @Override
            public void onError(String message) {
                hideLoadingDialog();
                if (isAdded() && !TextUtils.isEmpty(message)) {
                    showToast(message);
                }
                if (completion != null) {
                    completion.run();
                }
            }
        });
    }

    private void setupCollapsibleSections() {
        if (scriptListCard != null) {
            scriptListCard.setVisibility(View.VISIBLE);
        }

        if (consoleTitle != null && consoleCard != null) {
            // Only allow collapsing/expanding when previewing
            consoleTitle.setOnClickListener(v -> {
                if (showingPreview) {
                    toggleVisibility(consoleCard);
                    updateArrow((TextView) v, consoleCard.getVisibility() == View.VISIBLE);
                }
            });
            // Initialize arrow state based on current visibility
            updateArrow(consoleTitle, consoleCard.getVisibility() == View.VISIBLE);
        }
    }

    private void renderWavelet(String script) {
        Log.d(TAG, "renderWavelet called with script length: " + (script != null ? script.length() : 0));
        setupWaveletEngineIfNeeded();
        if (waveletEngine == null) {
            Log.e(TAG, "Wavelet engine is null!");
            showToast("Wavelet engine not ready.");
            return;
        }
        waveletEngine.updateModuleSources(moduleSources());
        if (viewModel != null) {
            viewModel.setLastScriptContent(script);
            viewModel.setLastScriptName(currentScriptName);
            viewModel.setLastScriptId(currentScriptMetadata != null ? currentScriptMetadata.getId() : null);
            viewModel.setPreviewActive(true);
        }
        isRenderingWavelet = true;
        activeWaveletTree = null;
        showingPreview = true;
        // Show console title when previewing, but collapse console card by default
        if (consoleTitle != null) {
            consoleTitle.setVisibility(View.VISIBLE);
        }
        if (consoleCard != null) {
            consoleCard.setVisibility(View.GONE); // Collapsed by default
        }
        if (consoleTitle != null) {
            updateArrow(consoleTitle, false); // Update arrow to show collapsed state
        }
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
            waveletEngine.setDialogCallback(this::showDialog);
            waveletEngine.setup(this::printLog, this::handleWaveletTree, buildBindings());
            waveletEngine.updateModuleSources(moduleSources());
        }
    }

    private void ensureWaveletEngineBindings() {
        if (waveletEngine != null) {
            waveletEngine.registerGlobalBindings(buildBindings());
            waveletEngine.updateModuleSources(moduleSources());
        }
    }

    private Map<String, Object> buildBindings() {
        Map<String, Object> bindings = new HashMap<>();
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
        pendingPreviewScriptId = null;
        if (viewModel != null) {
            viewModel.setPreviewActive(false);
        }
        if (waveletRenderView != null) {
            waveletRenderView.clear();
        }
        if (getActivity() != null) {
            androidx.appcompat.app.AppCompatActivity activity = (androidx.appcompat.app.AppCompatActivity) getActivity();
            if (activity.getSupportActionBar() != null) {
                activity.getSupportActionBar().setDisplayHomeAsUpEnabled(false);
            }
        }
        updateViewMode();
    }

    private void updateViewMode() {
        if (binding == null) {
            return;
        }
        boolean hideMainView = showingPreview || showingEditor;
        
        if (backPressedCallback != null) {
            backPressedCallback.setEnabled(hideMainView);
        }
        
        if (scriptListCard != null) {
            scriptListCard.setVisibility(hideMainView ? View.GONE : View.VISIBLE);
            Log.d(TAG, "updateViewMode: scriptListCard visibility = " + (hideMainView ? "GONE" : "VISIBLE"));
        }
        binding.waveletContainer.setVisibility(showingPreview ? View.VISIBLE : View.GONE);
        scriptEditorContainer.setVisibility(showingEditor ? View.VISIBLE : View.GONE);
        
        // Console title and card should ONLY be visible when previewing
        if (consoleTitle != null) {
            consoleTitle.setVisibility(showingPreview ? View.VISIBLE : View.GONE);
        }
        if (consoleCard != null) {
            // Only show console card when previewing
            if (showingPreview) {
                // Console card starts collapsed (GONE) when preview begins, user can expand it via console title click
                // Don't change visibility here if it's already set (allows user to expand/collapse)
                // But ensure it's hidden if we're exiting preview
            } else {
                // Hide console card completely when not previewing
                consoleCard.setVisibility(View.GONE);
            }
        }
        
        if (getActivity() != null) {
            androidx.appcompat.app.AppCompatActivity activity = (androidx.appcompat.app.AppCompatActivity) getActivity();
            if (activity.getSupportActionBar() != null) {
                if (hideMainView) {
                    // Show back button when previewing or editing
                    String title = currentScriptName != null ? currentScriptName : "Wavelet Preview";
                    activity.getSupportActionBar().setTitle(title);
                    activity.getSupportActionBar().setDisplayHomeAsUpEnabled(true);
                    activity.getSupportActionBar().setHomeButtonEnabled(true);
                } else {
                    activity.getSupportActionBar().setTitle("Wavelets");
                    activity.getSupportActionBar().setDisplayHomeAsUpEnabled(false);
                    activity.getSupportActionBar().setHomeButtonEnabled(false);
                }
            }
        }
        
        updateWaveletPlaceholder();
        
        // Invalidate menu to update visibility of editor items
        if (getActivity() != null) {
            getActivity().invalidateOptionsMenu();
        }
    }

    private void copyEditorContent() {
        String code = getEditorText();
        ClipboardManager clipboard = (ClipboardManager) requireContext().getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData clip = ClipData.newPlainText("wavelet", code);
        clipboard.setPrimaryClip(clip);
        Toast.makeText(requireContext(), "Copied to clipboard", Toast.LENGTH_SHORT).show();
    }

    private void pasteEditorContent() {
        ClipboardManager clipboard = (ClipboardManager) requireContext().getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard.hasPrimaryClip()) {
            ClipData.Item item = clipboard.getPrimaryClip().getItemAt(0);
            CharSequence text = item.getText();
            if (text != null) {
                String content = text.toString();
                setEditorText(content);
                updateDraftState(content, true);
                // Update the visible EditText
                if (lineWrapEnabled && scriptEditorContentWrap != null) {
                    scriptEditorContentWrap.setText(content);
                } else if (!lineWrapEnabled && scriptEditorContent != null) {
                    scriptEditorContent.setText(content);
                }
                Toast.makeText(requireContext(), "Pasted from clipboard", Toast.LENGTH_SHORT).show();
            }
        }
    }

    private void previewEditorContent() {
        String content = getEditorText();
        if (content.trim().isEmpty()) {
            showToast("No script to preview.");
            return;
        }
        setEditorText(content);
        updateDraftState(content, true);
        if (viewModel != null) {
            viewModel.setLastScriptContent(content);
            viewModel.setLastScriptName(currentScriptName);
            viewModel.setLastScriptId(currentScriptMetadata != null ? currentScriptMetadata.getId() : null);
        }
        pendingPreviewScriptId = null;
        renderWavelet(content);
        exitEditor();
    }

    private void updateLineWrap() {
        if (editorScrollViewWrap == null || editorScrollViewNoWrap == null) {
            return;
        }
        if (lineWrapEnabled) {
            // Enable line wrap - show ScrollView with wrapping EditText
            editorScrollViewWrap.setVisibility(View.VISIBLE);
            editorScrollViewNoWrap.setVisibility(View.GONE);
            // Sync content to wrap version
            if (scriptEditorContentWrap != null && scriptEditorContent != null) {
                String content = scriptEditorContent.getText() != null ? scriptEditorContent.getText().toString() : "";
                scriptEditorContentWrap.setText(content);
            }
        } else {
            // Disable line wrap - show HorizontalScrollView with non-wrapping EditText
            editorScrollViewWrap.setVisibility(View.GONE);
            editorScrollViewNoWrap.setVisibility(View.VISIBLE);
            // Sync content to no-wrap version
            if (scriptEditorContent != null && scriptEditorContentWrap != null) {
                String content = scriptEditorContentWrap.getText() != null ? scriptEditorContentWrap.getText().toString() : "";
                scriptEditorContent.setText(content);
            }
        }
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

    private void restoreFromViewModel() {
        if (viewModel == null || binding == null) {
            return;
        }
        String cachedName = viewModel.getLastScriptName();
        String cachedContent = viewModel.getLastScriptContent();
        if (cachedContent != null) {
            setEditorText(cachedContent);
            currentScriptName = cachedName;
            updateDraftState(cachedContent, true);
        }
        if (viewModel.isPreviewActive() && cachedContent != null && !cachedContent.trim().isEmpty()) {
            binding.waveletContainer.post(() -> {
                if (viewModel != null && viewModel.isPreviewActive()) {
                    renderWavelet(cachedContent);
                }
            });
        }
    }

    private void persistStateToViewModel() {
        if (viewModel == null) {
            return;
        }
        String scriptContent = binding != null ? getEditorText() : viewModel.getLastScriptContent();
        viewModel.setLastScriptContent(scriptContent);
        viewModel.setLastScriptName(currentScriptName);
        viewModel.setLastScriptId(currentScriptMetadata != null ? currentScriptMetadata.getId() : null);
        viewModel.setPreviewActive(showingPreview);
    }

    private void showNameInputDialog(String title, String message, ScriptNameCallback callback) {
        showNameInputDialog(title, message, null, callback);
    }

    private void showNameInputDialog(String title, String message, @Nullable String defaultValue, ScriptNameCallback callback) {
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle(title);
        builder.setMessage(message);
        final EditText input = new EditText(requireContext());
        if (!TextUtils.isEmpty(defaultValue)) {
            input.setText(defaultValue);
            input.setSelection(defaultValue.length());
        }
        builder.setView(input);
        builder.setPositiveButton("OK", (dialog, which) -> {
            String name = input.getText().toString().trim();
            if (!name.isEmpty()) {
                callback.onNameEntered(name);
            }
        });
        builder.setNegativeButton("Cancel", null);
        builder.show();
    }

    private void openFile() {
        if (openFileLauncher != null) {
            openFileLauncher.launch(new String[]{"text/javascript", "application/javascript", "*/*"});
        }
    }



    private void importScriptFromUri(Uri uri) {
        try (InputStream inputStream = requireContext().getContentResolver().openInputStream(uri)) {
            if (inputStream == null) {
                showToast("Unable to open file");
                return;
            }
            String content = readTextFromInputStream(inputStream);
            String defaultName = getFileNameFromUri(requireContext(), uri);
            showNameInputDialog(
                "Import Script",
                "Enter a name for the imported script:",
                defaultName,
                enteredName -> createScriptWithContent(enteredName, content, "Imported script: ")
            );
        } catch (IOException e) {
            Log.e(TAG, "Error importing script", e);
            showToast("Failed to import script");
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
        // Get text from the currently visible EditText, but fall back to currentDraftContent if EditText is empty
        String editorText = "";
        if (lineWrapEnabled && scriptEditorContentWrap != null) {
            editorText = scriptEditorContentWrap.getText() != null ? scriptEditorContentWrap.getText().toString() : "";
        } else if (!lineWrapEnabled && scriptEditorContent != null) {
            editorText = scriptEditorContent.getText() != null ? scriptEditorContent.getText().toString() : "";
        }
        // If EditText is empty or null, use currentDraftContent
        if (editorText == null || editorText.trim().isEmpty()) {
            editorText = currentDraftContent != null ? currentDraftContent : "";
        }
        return editorText;
    }

    private void setEditorText(String text) {
        currentDraftContent = text != null ? text : "";
    }

    private void completePendingPreview(String scriptId) {
        if (TextUtils.isEmpty(pendingPreviewScriptId) || !TextUtils.equals(pendingPreviewScriptId, scriptId)) {
            return;
        }
        String script = getEditorText();
        // Also check currentDraftContent directly as fallback
        if ((script == null || script.trim().isEmpty()) && (currentDraftContent == null || currentDraftContent.trim().isEmpty())) {
            Log.w(TAG, "completePendingPreview: No script content available for " + scriptId);
            showToast("No script to preview.");
            pendingPreviewScriptId = null;
            return;
        }
        // Use currentDraftContent if script is empty
        if (script == null || script.trim().isEmpty()) {
            script = currentDraftContent != null ? currentDraftContent : "";
        }
        if (script.trim().isEmpty()) {
            Log.w(TAG, "completePendingPreview: Script content is empty for " + scriptId);
            showToast("No script to preview.");
            pendingPreviewScriptId = null;
            return;
        }
        renderWavelet(script);
        pendingPreviewScriptId = null;
    }

    private void runOnUiThreadSafe(Runnable task) {
        if (task == null || !isAdded()) {
            return;
        }
        requireActivity().runOnUiThread(task);
    }

    private void showLoadingDialog(String message) {
        if (!isAdded()) {
            return;
        }
        hideLoadingDialog();
        View view = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_loading, null);
        TextView textView = view.findViewById(R.id.loading_message);
        textView.setText(message != null ? message : "Loading...");
        loadingDialog = new AlertDialog.Builder(requireContext())
            .setView(view)
            .setCancelable(false)
            .create();
        loadingDialog.show();
    }

    private void hideLoadingDialog() {
        if (loadingDialog != null) {
            if (loadingDialog.isShowing()) {
                loadingDialog.dismiss();
            }
            loadingDialog = null;
        }
    }

    private void startSync() {
        if (!isAdded() || fileRepository == null) {
            return;
        }
        showToast("Syncing scripts...");
        fileRepository.listFiles(SCRIPT_EXTENSION, new RepositoryCallback<List<UserFileMetadata>>() {
            @Override
            public void onSuccess(List<UserFileMetadata> value) {
                if (!isAdded()) {
                    return;
                }
                List<UserFileMetadata> list = value != null ? value : Collections.emptyList();
                collectRemoteData(list);
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) {
                    return;
                }
                showToast(message != null ? message : "Failed to list scripts");
            }
        });
    }

    private void collectRemoteData(List<UserFileMetadata> metadataList) {
        if (!isAdded()) {
            return;
        }
        final List<UserFileMetadata> list = metadataList != null ? metadataList : Collections.emptyList();
        final Map<String, UserFileMetadata> metadataMap = new HashMap<>();
        for (UserFileMetadata metadata : list) {
            metadataMap.put(metadata.getId(), metadata);
        }
        if (list.isEmpty()) {
            onRemoteDataCollected(metadataMap, Collections.emptyMap());
            return;
        }
        final Map<String, UserFileData> dataMap = new HashMap<>();
        final AtomicInteger remaining = new AtomicInteger(list.size());
        final AtomicBoolean failed = new AtomicBoolean(false);
        for (UserFileMetadata metadata : list) {
            final String scriptId = metadata.getId();
            fileRepository.getFile(scriptId, new RepositoryCallback<UserFileData>() {
                @Override
                public void onSuccess(UserFileData data) {
                    if (failed.get()) {
                        return;
                    }
                    synchronized (dataMap) {
                        dataMap.put(scriptId, data);
                    }
                    if (remaining.decrementAndGet() == 0 && !failed.get()) {
                        Map<String, UserFileData> snapshot;
                        synchronized (dataMap) {
                            snapshot = new HashMap<>(dataMap);
                        }
                        if (isAdded()) {
                            requireActivity().runOnUiThread(() -> onRemoteDataCollected(metadataMap, snapshot));
                        }
                    }
                }

                @Override
                public void onError(String message) {
                    if (failed.compareAndSet(false, true) && isAdded()) {
                        showToast(message != null ? message : "Failed to fetch script content");
                    }
                }
            });
        }
    }

    private void onRemoteDataCollected(Map<String, UserFileMetadata> metadataMap, Map<String, UserFileData> dataMap) {
        if (!isAdded() || viewModel == null) {
            return;
        }
        Map<String, WaveletsViewModel.ScriptRecord> snapshot = viewModel.snapshotRecords();
        List<ScriptChange> changes = new ArrayList<>();
        for (Map.Entry<String, UserFileMetadata> entry : metadataMap.entrySet()) {
            String scriptId = entry.getKey();
            UserFileMetadata metadata = entry.getValue();
            UserFileData data = dataMap.get(scriptId);
            String remoteContent = data != null && data.hasTextContent() ? data.getTextContent() : "";
            WaveletsViewModel.ScriptRecord record = snapshot.get(scriptId);
            String name = metadata.getName();
            String previousRemote = record != null && record.remoteContent != null ? record.remoteContent : "";
            if (record == null || TextUtils.isEmpty(record.remoteEtag)) {
                changes.add(ScriptChange.remoteAdded(scriptId, name, remoteContent, metadata));
                continue;
            }
            boolean remoteChanged = !TextUtils.equals(record.remoteEtag, metadata.getEtag()) || !TextUtils.equals(previousRemote, remoteContent);
            boolean localDirty = record.dirty;
            if (!remoteChanged && !localDirty) {
                continue;
            }
            String resolvedName = record.name != null ? record.name : name;
            if (localDirty && remoteChanged) {
                changes.add(ScriptChange.conflict(scriptId, resolvedName, previousRemote, remoteContent, record.draftContent, metadata));
            } else if (localDirty) {
                String draftContent = record.draftContent != null ? record.draftContent : previousRemote;
                changes.add(ScriptChange.localModified(scriptId, resolvedName, previousRemote, draftContent));
            } else if (remoteChanged) {
                changes.add(ScriptChange.remoteModified(scriptId, resolvedName, previousRemote, remoteContent, metadata));
            }
        }

        for (Map.Entry<String, WaveletsViewModel.ScriptRecord> entry : snapshot.entrySet()) {
            String scriptId = entry.getKey();
            if (WaveletsViewModel.UNSAVED_KEY.equals(scriptId)) {
                continue;
            }
            if (!metadataMap.containsKey(scriptId) && !TextUtils.isEmpty(entry.getValue().remoteEtag)) {
                WaveletsViewModel.ScriptRecord record = entry.getValue();
                String name = record.name != null ? record.name : (currentScriptName != null ? currentScriptName : "Script");
                String previousRemote = record.remoteContent != null ? record.remoteContent : "";
                changes.add(ScriptChange.remoteDeleted(scriptId, name, previousRemote));
            }
        }

        WaveletsViewModel.ScriptRecord unsaved = snapshot.get(WaveletsViewModel.UNSAVED_KEY);
        if (unsaved != null && unsaved.dirty && unsaved.draftContent != null && unsaved.draftContent.trim().length() > 0) {
            changes.add(ScriptChange.unsavedLocal(unsaved.draftContent));
        }

        if (changes.isEmpty()) {
            showToast("Scripts already in sync");
            return;
        }

        showSyncDialog(changes, metadataMap, dataMap);
    }

    private void showSyncDialog(List<ScriptChange> changes, Map<String, UserFileMetadata> metadataMap, Map<String, UserFileData> dataMap) {
        if (!isAdded()) {
            return;
        }
        View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_sync_changes, null);
        TextView summaryView = dialogView.findViewById(R.id.sync_summary);
        summaryView.setText(buildSyncSummary(changes));

        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext())
            .setTitle("Script Sync")
            .setView(dialogView)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Apply", (dialog, which) -> applySyncChanges(changes, dataMap));

        if (!isAdded()) {
            return;
        }
        builder.show();
    }

    private String buildSyncSummary(List<ScriptChange> changes) {
        StringBuilder summary = new StringBuilder();
        for (int i = 0; i < changes.size(); i++) {
            ScriptChange change = changes.get(i);
            summary.append(labelForChange(change.type)).append(" — ");
            String name = change.name != null ? change.name : (change.scriptId != null ? change.scriptId : "Unsaved Script");
            summary.append(name).append('\n');
            switch (change.type) {
                case LOCAL_MODIFIED:
                    summary.append("Diff (local vs remote):\n");
                    summary.append(generateUnifiedDiff(safe(change.before), safe(change.after)));
                    break;
                case REMOTE_MODIFIED:
                    summary.append("Diff (remote update):\n");
                    summary.append(generateUnifiedDiff(safe(change.before), safe(change.after)));
                    break;
                case REMOTE_ADDED:
                    summary.append("New remote script content:\n");
                    summary.append(generateUnifiedDiff("", safe(change.after)));
                    break;
                case REMOTE_DELETED:
                    summary.append("Remote script removed. Local snapshot:\n");
                    summary.append(generateUnifiedDiff(safe(change.before), ""));
                    break;
                case CONFLICT:
                    summary.append("Conflict detected. Remote update:\n");
                    summary.append(generateUnifiedDiff(safe(change.before), safe(change.after)));
                    if (change.localDraft != null) {
                        summary.append("\nLocal draft:\n");
                        summary.append(generateUnifiedDiff(safe(change.before), safe(change.localDraft)));
                    }
                    break;
                case LOCAL_UNTRACKED:
                    summary.append("Unsaved local draft must be saved before syncing.\n");
                    break;
            }
            if (i < changes.size() - 1) {
                summary.append("\n-----------------------------\n");
            }
        }
        return summary.toString();
    }

    private void applySyncChanges(List<ScriptChange> changes, Map<String, UserFileData> dataMap) {
        if (!isAdded() || fileRepository == null || viewModel == null) {
            return;
        }
        List<ScriptChange> localChanges = new ArrayList<>();
        List<ScriptChange> remoteAdds = new ArrayList<>();
        List<ScriptChange> remoteMods = new ArrayList<>();
        List<ScriptChange> remoteDeletes = new ArrayList<>();
        boolean hasConflict = false;
        boolean hasUnsaved = false;

        for (ScriptChange change : changes) {
            switch (change.type) {
                case LOCAL_MODIFIED:
                    localChanges.add(change);
                    break;
                case REMOTE_MODIFIED:
                    remoteMods.add(change);
                    break;
                case REMOTE_ADDED:
                    remoteAdds.add(change);
                    break;
                case REMOTE_DELETED:
                    remoteDeletes.add(change);
                    break;
                case CONFLICT:
                    hasConflict = true;
                    break;
                case LOCAL_UNTRACKED:
                    hasUnsaved = true;
                    break;
            }
        }

        if (hasConflict) {
            showToast("Conflicts detected. Resolve manually before syncing.");
        }
        if (hasUnsaved) {
            showToast("Unsaved drafts found. Save them before syncing.");
        }

        processLocalUpdates(localChanges, 0, () -> {
            applyRemoteAdditions(remoteAdds, dataMap);
            applyRemoteModifications(remoteMods, dataMap);
            applyRemoteDeletions(remoteDeletes);
            showToast("Sync complete");
        });
    }

    private void processLocalUpdates(List<ScriptChange> localChanges, int index, Runnable completion) {
        if (index >= localChanges.size()) {
            completion.run();
            return;
        }
        ScriptChange change = localChanges.get(index);
        if (viewModel == null) {
            completion.run();
            return;
        }
        String etag = viewModel.getRemoteEtag(change.scriptId);
        if (TextUtils.isEmpty(etag)) {
            processLocalUpdates(localChanges, index + 1, completion);
            return;
        }
        fileRepository.updateTextFile(change.scriptId, etag, change.after, new RepositoryCallback<UserFileMetadata>() {
            @Override
            public void onSuccess(UserFileMetadata metadata) {
                if (!isAdded()) {
                    return;
                }
                addOrReplaceMetadata(metadata);
                viewModel.updateRemoteSnapshot(metadata.getId(), metadata.getName(), metadata.getEtag(), change.after);
                viewModel.markClean(metadata.getId(), change.after, metadata.getEtag());
                viewModel.updateDraft(metadata.getId(), metadata.getName(), change.after, false);
                if (currentScriptMetadata != null && currentScriptMetadata.getId().equals(metadata.getId())) {
                    currentScriptMetadata = metadata;
                    currentScriptName = metadata.getName();
                    currentScriptEtag = metadata.getEtag();
                    setEditorText(change.after);
                    updateDraftState(change.after, false);
                }
                processLocalUpdates(localChanges, index + 1, completion);
            }

            @Override
            public void onError(String message) {
                if (isAdded()) {
                    showToast(message != null ? message : ("Failed to push changes for " + change.name));
                }
                processLocalUpdates(localChanges, index + 1, completion);
            }
        });
    }

    private void applyRemoteAdditions(List<ScriptChange> remoteAdds, Map<String, UserFileData> dataMap) {
        if (viewModel == null) {
            return;
        }
        for (ScriptChange change : remoteAdds) {
            UserFileMetadata metadata = change.metadata;
            if (metadata == null) {
                continue;
            }
            UserFileData data = dataMap.get(metadata.getId());
            String content = data != null && data.hasTextContent() ? data.getTextContent() : "";
            addOrReplaceMetadata(metadata);
            viewModel.updateRemoteSnapshot(metadata.getId(), metadata.getName(), metadata.getEtag(), content);
            viewModel.markClean(metadata.getId(), content, metadata.getEtag());
        }
    }

    private void applyRemoteModifications(List<ScriptChange> remoteMods, Map<String, UserFileData> dataMap) {
        if (viewModel == null) {
            return;
        }
        for (ScriptChange change : remoteMods) {
            UserFileMetadata metadata = change.metadata;
            if (metadata == null) {
                continue;
            }
            UserFileData data = dataMap.get(metadata.getId());
            String content = data != null && data.hasTextContent() ? data.getTextContent() : safe(change.after);
            addOrReplaceMetadata(metadata);
            viewModel.updateRemoteSnapshot(metadata.getId(), metadata.getName(), metadata.getEtag(), content);
            viewModel.markClean(metadata.getId(), content, metadata.getEtag());
            if (currentScriptMetadata != null && currentScriptMetadata.getId().equals(metadata.getId())) {
                currentScriptMetadata = metadata;
                currentScriptName = metadata.getName();
                currentScriptEtag = metadata.getEtag();
                setEditorText(content);
                updateDraftState(content, false);
            }
        }
    }

    private void applyRemoteDeletions(List<ScriptChange> remoteDeletes) {
        if (viewModel == null) {
            return;
        }
        for (ScriptChange change : remoteDeletes) {
            viewModel.removeRecord(change.scriptId);
            removeMetadataById(change.scriptId);
            refreshScriptList();
            if (currentScriptMetadata != null && currentScriptMetadata.getId().equals(change.scriptId)) {
                currentScriptMetadata = null;
                currentScriptName = null;
                currentScriptEtag = null;
                setEditorText("");
                updateDraftState("", false);
                if (!scriptFiles.isEmpty()) {
                    loadScript(scriptFiles.get(0));
                }
            }
        }
    }

    private String generateUnifiedDiff(String before, String after) {
        String[] original = before != null ? before.split("\n", -1) : new String[0];
        String[] revised = after != null ? after.split("\n", -1) : new String[0];
        int[][] lcs = new int[original.length + 1][revised.length + 1];
        for (int i = original.length - 1; i >= 0; i--) {
            for (int j = revised.length - 1; j >= 0; j--) {
                if (original[i].equals(revised[j])) {
                    lcs[i][j] = lcs[i + 1][j + 1] + 1;
                } else {
                    lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
                }
            }
        }
        List<String> lines = new ArrayList<>();
        int i = 0;
        int j = 0;
        while (i < original.length && j < revised.length) {
            if (original[i].equals(revised[j])) {
                lines.add("  " + original[i]);
                i++;
                j++;
            } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
                lines.add("- " + original[i]);
                i++;
            } else {
                lines.add("+ " + revised[j]);
                j++;
            }
        }
        while (i < original.length) {
            lines.add("- " + original[i]);
            i++;
        }
        while (j < revised.length) {
            lines.add("+ " + revised[j]);
            j++;
        }
        StringBuilder builder = new StringBuilder();
        for (String line : lines) {
            builder.append(line).append('\n');
        }
        return builder.toString();
    }

    private String labelForChange(SyncChangeType type) {
        switch (type) {
            case LOCAL_MODIFIED:
                return "Local changes";
            case REMOTE_MODIFIED:
                return "Remote updates";
            case REMOTE_ADDED:
                return "Remote additions";
            case REMOTE_DELETED:
                return "Remote deletions";
            case CONFLICT:
                return "Conflicts";
            case LOCAL_UNTRACKED:
                return "Unsaved drafts";
            default:
                return "Changes";
        }
    }

    private static String safe(String value) {
        return value != null ? value : "";
    }

    private enum SyncChangeType {
        LOCAL_MODIFIED,
        REMOTE_MODIFIED,
        REMOTE_ADDED,
        REMOTE_DELETED,
        CONFLICT,
        LOCAL_UNTRACKED
    }

    private static final class ScriptChange {
        final SyncChangeType type;
        final String scriptId;
        final String name;
        final String before;
        final String after;
        final String localDraft;
        final UserFileMetadata metadata;

        private ScriptChange(SyncChangeType type, String scriptId, String name, String before, String after, String localDraft, UserFileMetadata metadata) {
            this.type = type;
            this.scriptId = scriptId;
            this.name = name;
            this.before = before;
            this.after = after;
            this.localDraft = localDraft;
            this.metadata = metadata;
        }

        static ScriptChange localModified(String scriptId, String name, String before, String draft) {
            return new ScriptChange(SyncChangeType.LOCAL_MODIFIED, scriptId, name, before, draft, null, null);
        }

        static ScriptChange remoteModified(String scriptId, String name, String before, String after, UserFileMetadata metadata) {
            return new ScriptChange(SyncChangeType.REMOTE_MODIFIED, scriptId, name, before, after, null, metadata);
        }

        static ScriptChange remoteAdded(String scriptId, String name, String content, UserFileMetadata metadata) {
            return new ScriptChange(SyncChangeType.REMOTE_ADDED, scriptId, name, "", content, null, metadata);
        }

        static ScriptChange remoteDeleted(String scriptId, String name, String content) {
            return new ScriptChange(SyncChangeType.REMOTE_DELETED, scriptId, name, content, "", null, null);
        }

        static ScriptChange conflict(String scriptId, String name, String before, String remoteAfter, String localDraft, UserFileMetadata metadata) {
            return new ScriptChange(SyncChangeType.CONFLICT, scriptId, name, before, remoteAfter, localDraft, metadata);
        }

        static ScriptChange unsavedLocal(String draft) {
            return new ScriptChange(SyncChangeType.LOCAL_UNTRACKED, null, null, "", draft, draft, null);
        }
    }

    private void showDialog(String title, String message) {
        if (!isAdded()) {
            return;
        }
        requireActivity().runOnUiThread(() -> {
            if (isAdded()) {
                new AlertDialog.Builder(requireContext())
                    .setTitle(title)
                    .setMessage(message)
                    .setPositiveButton("OK", null)
                    .show();
            }
        });
    }

    private void showToast(String message) {
        if (!isAdded()) {
            return;
        }
        requireActivity().runOnUiThread(() -> Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show());
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

    private Map<String, String> moduleSources() {
        if (viewModel == null) {
            return Collections.emptyMap();
        }
        return viewModel.getModuleSources();
    }

    private String normalizeScriptName(String rawName) {
        String name = rawName != null ? rawName.trim() : "";
        if (name.isEmpty()) {
            name = "wavelet_script";
        }
        if (!name.toLowerCase(Locale.US).endsWith(SCRIPT_EXTENSION)) {
            name = name + SCRIPT_EXTENSION;
        }
        return name;
    }

    private interface ScriptNameCallback {
        void onNameEntered(String name);
    }
}