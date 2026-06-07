/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.ui.scripts;

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
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.IBinder;
import android.provider.OpenableColumns;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.util.Log;
import android.os.Handler;
import android.os.Looper;
import android.text.method.KeyListener;
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
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.core.view.MenuHost;
import androidx.core.view.MenuProvider;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.ViewModelProvider;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.databinding.FragmentScriptsBinding;
import com.emwaver.emwaverandroidapp.files.FileRepositoryLocal;
import com.emwaver.emwaverandroidapp.files.RepositoryCallback;
import com.emwaver.emwaverandroidapp.files.UserFileData;
import com.emwaver.emwaverandroidapp.files.UserFileMetadata;
import com.emwaver.emwaverandroidapp.ui.scripts.ScriptMetadata;
import com.emwaver.emwaverandroidapp.scripts.ScriptEngine;
import com.emwaver.emwaverandroidapp.scripts.ScriptDeviceConnection;
import com.emwaver.emwaverandroidapp.scripts.ScriptRenderView;
import com.emwaver.emwaverandroidapp.scripts.ScriptSignalStore;
import com.emwaver.emwaverandroidapp.scripts.ScriptTree;
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
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;


public class ScriptsFragment extends Fragment {

    private static final String TAG = "ScriptsFragment";
    private static final String SCRIPT_EXTENSION = ".emw";
    private static final String SCRIPT_DISPLAY_EXTENSION = ".emw";
    private static final String ASSET_SCRIPT_EXTENSION = ".emw";
    private static final String ASSET_SCRIPTS_DIR = "DefaultScripts";

    // User files live in a single flat namespace locally.
    // UI decides what to show based on extension (.emw scripts vs .raw/.txt signals).
    private static final String SIGNALS_DIR_NAME = "scripts";
    private static final String SIGNAL_RAW_EXTENSION = ".raw";
    private static final String SIGNAL_TEXT_EXTENSION = ".txt";

    private FragmentScriptsBinding binding;
    private final List<ScriptMetadata> assetScripts = new ArrayList<>();
    private final List<ScriptMetadata> customScripts = new ArrayList<>();
    private final List<SignalMetadata> signalFiles = new ArrayList<>();

    private final List<ListEntry> scripts = new ArrayList<>();
    private ScriptListAdapter scriptAdapter;
    private ScriptMetadata currentScriptMetadata;
    private String currentScriptName;
    private String currentScriptEtag;
    private String currentDraftContent;
    private String pendingPreviewScriptId;

    private String displayScriptName(@Nullable String name, boolean includeExtension) {
        if (name == null) {
            return "";
        }
        if (!includeExtension) {
            return name;
        }
        String lower = name.toLowerCase(Locale.US);
        if (lower.endsWith(SCRIPT_DISPLAY_EXTENSION)) {
            return name;
        }
        return name + SCRIPT_DISPLAY_EXTENSION;
    }

    private ScriptsViewModel viewModel;
    private FileRepositoryLocal fileRepository;

    private ScriptDeviceConnection scriptDeviceConnection;
    private ScriptSignalStore scriptSignalStore;

    private ScriptEngine scriptEngine;
    private ScriptRenderView scriptRenderView;
    private ScriptTree activeScriptTree;
    private final AndroidScriptSessionRegistry scriptSessions = new AndroidScriptSessionRegistry();
    private boolean isRenderingScript;
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

    private View scriptsCard;
    private ScrollView editorScrollViewWrap;
    private HorizontalScrollView editorScrollViewNoWrap;
    private EditText scriptEditorContentWrap;
    private boolean lineWrapEnabled = false;
    private AlertDialog loadingDialog;

    private final Handler syntaxHandler = new Handler(Looper.getMainLooper());
    private Runnable syntaxRunnable;
    private boolean suppressEditorSync;
    private ScriptSyntaxHighlighter syntaxHighlighter;
    private KeyListener originalEditorKeyListener;
    private KeyListener originalEditorWrapKeyListener;

    private String getCurrentRecordId() {
        if (currentScriptMetadata != null && currentScriptMetadata.getId() != null) {
            return currentScriptMetadata.getId();
        }
        return ScriptsViewModel.UNSAVED_KEY;
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


    private OnBackPressedCallback backPressedCallback;

    @Override
    public void onStart() {
        super.onStart();
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        viewModel = new ViewModelProvider(requireActivity()).get(ScriptsViewModel.class);
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
        binding = FragmentScriptsBinding.inflate(inflater, container, false);
        View root = binding.getRoot();

        // Remote control indicator (best-effort)
        if (binding.remoteControlBanner != null) {
            binding.remoteControlBanner.setVisibility(View.GONE);
        }

        setupMenu();
        setupFileLaunchers();
        setupScriptList();
        setupEditorSection();
        showingPreview = false;
        updateViewMode();
        updateScriptPlaceholder();
        restoreFromViewModel();
        loadScripts();

        return root;
    }


    @Override
    public void onDestroyView() {
        persistStateToViewModel();
        if (scriptEngine != null) {
            scriptEngine.shutdown();
            scriptEngine = null;
        }
        scriptSessions.clear();
        scriptRenderView = null;
        showingPreview = false;
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
                
                boolean showEditorItems = showingEditor;
                boolean isAssetScript = currentScriptMetadata != null && currentScriptMetadata.isAssetScript();
                if (copyItem != null) copyItem.setVisible(showEditorItems);
                if (pasteItem != null) pasteItem.setVisible(showEditorItems && !isAssetScript);
                if (previewItem != null) previewItem.setVisible(showEditorItems);
                if (renameItem != null) renameItem.setVisible(showEditorItems && currentScriptMetadata != null && !isAssetScript);
                if (deleteItem != null) deleteItem.setVisible(showEditorItems && currentScriptMetadata != null && !isAssetScript);
                if (lineWrapItem != null) {
                    lineWrapItem.setVisible(showEditorItems);
                    lineWrapItem.setChecked(lineWrapEnabled);
                }
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
                    showNameInputDialog("Copy Script", "Enter a name for the copy:", ScriptsFragment.this::copyCurrentScript);
                    return true;
                } else if (itemId == R.id.new_script) {
                    showNameInputDialog("New Script", "Enter a name for the new script:", ScriptsFragment.this::createNewScript);
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
                    if (currentScriptMetadata != null && currentScriptMetadata.isCustomScript()) {
                        showNameInputDialog(
                            "Rename Script",
                            "Enter a new name for the script:",
                            currentScriptMetadata.getName(),
                            newName -> renameScript(currentScriptMetadata, newName)
                        );
                    } else {
                        showToast("Asset scripts cannot be renamed");
                    }
                    return true;
                } else if (itemId == R.id.editor_delete) {
                    if (currentScriptMetadata != null && currentScriptMetadata.isCustomScript()) {
                        showDeleteConfirmationDialog(currentScriptMetadata);
                    } else {
                        showToast("Asset scripts cannot be deleted");
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
        scriptsCard = binding.scriptsCard;
        scriptAdapter = new ScriptListAdapter(scripts);
        binding.scriptsListView.setAdapter(scriptAdapter);

        binding.scriptsListView.setOnItemClickListener((parent, view, position, id) -> {
            if (position < 0 || position >= scripts.size()) {
                return;
            }
            ListEntry entry = scripts.get(position);
            if (entry == null || entry.type == ListEntry.Type.HEADER) {
                return;
            }
            if (entry.type == ListEntry.Type.SCRIPT) {
                previewScript(entry.script);
            } else if (entry.type == ListEntry.Type.SESSION) {
                if (activeScriptTree != null) {
                    showingPreview = true;
                    updateViewMode();
                }
            } else if (entry.type == ListEntry.Type.SIGNAL) {
                openSignal(entry.signal);
            }
        });

        binding.scriptsListView.setOnItemLongClickListener((parent, view, position, id) -> {
            if (position < 0 || position >= scripts.size()) {
                return true;
            }
            ListEntry entry = scripts.get(position);
            if (entry == null || entry.type == ListEntry.Type.HEADER) {
                return true;
            }
            if (entry.type == ListEntry.Type.SCRIPT) {
                ScriptMetadata meta = entry.script;
                if (meta != null && meta.isCustomScript()) {
                    showScriptOptionsDialog(meta);
                    return true;
                }
                showToast("Asset scripts are read-only. Create a copy to edit.");
                return true;
            }
            if (entry.type == ListEntry.Type.SIGNAL) {
                SignalMetadata sig = entry.signal;
                if (sig != null) {
                    showDeleteSignalConfirmationDialog(sig);
                }
                return true;
            }
            return true;
        });
    }

    private void setupEditorSection() {
        scriptEditorContainer = binding.scriptEditorContainer;
        scriptEditorContent = binding.scriptEditorContent;
        editorScrollViewWrap = binding.editorScrollViewWrap;
        editorScrollViewNoWrap = binding.editorScrollViewNowrap;
        scriptEditorContentWrap = binding.scriptEditorContentWrap;

        if (scriptEditorContent != null) {
            originalEditorKeyListener = scriptEditorContent.getKeyListener();
        }
        if (scriptEditorContentWrap != null) {
            originalEditorWrapKeyListener = scriptEditorContentWrap.getKeyListener();
        }

        syntaxHighlighter = new ScriptSyntaxHighlighter(
                ContextCompat.getColor(requireContext(), R.color.codeKeyword),
                ContextCompat.getColor(requireContext(), R.color.codeString),
                ContextCompat.getColor(requireContext(), R.color.codeNumber),
                ContextCompat.getColor(requireContext(), R.color.codeComment)
        );
        
        // Set up text watcher for both EditTexts
        scriptEditorContent.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            
            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                if (suppressEditorSync) {
                    return;
                }
                String updated = s != null ? s.toString() : "";
                setEditorText(updated);
                updateDraftState(updated, true);
                // Sync to wrap version
                if (scriptEditorContentWrap != null && !TextUtils.equals(scriptEditorContentWrap.getText(), updated)) {
                    suppressEditorSync = true;
                    scriptEditorContentWrap.setText(updated);
                    suppressEditorSync = false;
                }
                scheduleSyntaxHighlight();
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
                    if (suppressEditorSync) {
                        return;
                    }
                    String updated = s != null ? s.toString() : "";
                    setEditorText(updated);
                    updateDraftState(updated, true);
                    // Sync to no-wrap version
                    if (scriptEditorContent != null && !TextUtils.equals(scriptEditorContent.getText(), updated)) {
                        suppressEditorSync = true;
                        scriptEditorContent.setText(updated);
                        suppressEditorSync = false;
                    }
                    scheduleSyntaxHighlight();
                }
                
                @Override
                public void afterTextChanged(Editable s) {}
            });
        }
        
        updateLineWrap();
    }

    private void scheduleSyntaxHighlight() {
        if (syntaxHighlighter == null) {
            return;
        }
        if (syntaxRunnable != null) {
            syntaxHandler.removeCallbacks(syntaxRunnable);
        }
        syntaxRunnable = () -> {
            if (!isAdded()) {
                return;
            }
            applySyntaxHighlightNow();
        };
        syntaxHandler.postDelayed(syntaxRunnable, 90);
    }

    private void applySyntaxHighlightNow() {
        if (syntaxHighlighter == null) {
            return;
        }
        EditText active = lineWrapEnabled ? scriptEditorContentWrap : scriptEditorContent;
        if (active == null || active.getText() == null) {
            return;
        }
        int selStart = active.getSelectionStart();
        int selEnd = active.getSelectionEnd();
        try {
            syntaxHighlighter.applyTo(active.getText());
        } finally {
            int len = active.getText().length();
            if (selStart >= 0 && selEnd >= 0) {
                active.setSelection(Math.min(selStart, len), Math.min(selEnd, len));
            }
        }
    }

    private void refreshScriptList() {
        if (scriptAdapter != null) {
            Log.d(TAG, "refreshScriptList: notifying adapter with " + scripts.size() + " items");
            scriptAdapter.notifyDataSetChanged();
        }
    }

    private void previewScript(ScriptMetadata scriptMetadata) {
        if (!isAdded() || scriptMetadata == null || TextUtils.isEmpty(scriptMetadata.getId())) {
            Log.w(TAG, "previewScript: invalid state or metadata");
            return;
        }
        Log.d(TAG, "previewScript: " + scriptMetadata.getName() + " (id=" + scriptMetadata.getId() + ")");
        pendingPreviewScriptId = scriptMetadata.getId();
        loadScript(scriptMetadata);
    }

    private static final class SignalMetadata {
        final String name;
        final java.io.File file;
        final String extension;

        SignalMetadata(String name, java.io.File file, String extension) {
            this.name = name;
            this.file = file;
            this.extension = extension;
        }

        String displayName() {
            return name + extension;
        }
    }

    private static final class ListEntry {
        enum Type { HEADER, SESSION, SCRIPT, SIGNAL }
        final Type type;
        final String headerTitle;
        final AndroidScriptSession session;
        final ScriptMetadata script;
        final SignalMetadata signal;

        private ListEntry(Type type, String headerTitle, AndroidScriptSession session, ScriptMetadata script, SignalMetadata signal) {
            this.type = type;
            this.headerTitle = headerTitle;
            this.session = session;
            this.script = script;
            this.signal = signal;
        }

        static ListEntry header(String title) { return new ListEntry(Type.HEADER, title, null, null, null); }
        static ListEntry session(AndroidScriptSession s) { return new ListEntry(Type.SESSION, null, s, null, null); }
        static ListEntry script(ScriptMetadata s) { return new ListEntry(Type.SCRIPT, null, null, s, null); }
        static ListEntry signal(SignalMetadata s) { return new ListEntry(Type.SIGNAL, null, null, null, s); }
    }

    private class ScriptListAdapter extends ArrayAdapter<ListEntry> {
        ScriptListAdapter(List<ListEntry> scripts) {
            super(requireContext(), 0, scripts);
        }

        @Override
        public int getItemViewType(int position) {
            ListEntry e = getItem(position);
            if (e == null) return 0;
            if (e.type == ListEntry.Type.HEADER) return 0;
            return 1;
        }

        @Override
        public int getViewTypeCount() {
            return 2;
        }

        @Override
        public boolean isEnabled(int position) {
            ListEntry e = getItem(position);
            return e != null && e.type != ListEntry.Type.HEADER;
        }

        @NonNull
        @Override
        public View getView(int position, @Nullable View convertView, @NonNull ViewGroup parent) {
            ListEntry entry = getItem(position);
            if (entry == null) {
                View v = convertView;
                if (v == null) v = LayoutInflater.from(getContext()).inflate(R.layout.item_script_entry, parent, false);
                TextView nameView = v.findViewById(R.id.script_name);
                TextView statusView = v.findViewById(R.id.script_status);
                ImageButton stopButton = v.findViewById(R.id.script_stop_button);
                ImageButton editButton = v.findViewById(R.id.script_edit_button);
                nameView.setText("-");
                statusView.setVisibility(View.GONE);
                stopButton.setVisibility(View.GONE);
                editButton.setVisibility(View.GONE);
                return v;
            }

            if (entry.type == ListEntry.Type.HEADER) {
                View v = convertView;
                if (v == null) {
                    v = LayoutInflater.from(getContext()).inflate(R.layout.item_script_header, parent, false);
                }
                TextView title = v.findViewById(R.id.header_title);
                title.setText(entry.headerTitle);
                return v;
            }

            View view = convertView;
            if (view == null) {
                view = LayoutInflater.from(getContext()).inflate(R.layout.item_script_entry, parent, false);
            }
            TextView nameView = view.findViewById(R.id.script_name);
            TextView statusView = view.findViewById(R.id.script_status);
            TextView kindBadgeView = view.findViewById(R.id.script_kind_badge);
            ImageButton stopButton = view.findViewById(R.id.script_stop_button);
            ImageButton editButton = view.findViewById(R.id.script_edit_button);
            statusView.setVisibility(View.GONE);
            kindBadgeView.setVisibility(View.GONE);
            stopButton.setVisibility(View.GONE);

            if (entry.type == ListEntry.Type.SESSION) {
                AndroidScriptSession session = entry.session;
                nameView.setText(session != null ? session.fileName() : "-");
                statusView.setText(session != null ? session.statusLabel() : "Running");
                statusView.setVisibility(View.VISIBLE);
                boolean isRunningSession = session != null && session.isRunning();
                stopButton.setVisibility(isRunningSession ? View.VISIBLE : View.GONE);
                stopButton.setEnabled(isRunningSession);
                stopButton.setAlpha(isRunningSession ? 1.0f : 0.0f);
                stopButton.setOnClickListener(isRunningSession
                        ? v -> {
                            v.setPressed(false);
                            stopRunningScript(session.instanceId);
                        }
                        : null);
                editButton.setVisibility(View.GONE);
                return view;
            }

            if (entry.type == ListEntry.Type.SCRIPT) {
                ScriptMetadata scriptMetadata = entry.script;
                nameView.setText(displayScriptName(scriptMetadata.getName(), true));
                kindBadgeView.setText(kindBadgeLabel(scriptMetadata));
                applyKindBadgeStyle(kindBadgeView, scriptMetadata);
                kindBadgeView.setVisibility(View.VISIBLE);
                List<AndroidScriptSession> matchingSessions = sessionsForScript(scriptMetadata.getId());
                AndroidScriptSession runningSession = firstRunningSession(matchingSessions);
                if (!matchingSessions.isEmpty()) {
                    statusView.setText(sessionStatusSummary(matchingSessions));
                    statusView.setVisibility(View.VISIBLE);
                }
                if (runningSession != null) {
                    stopButton.setVisibility(View.VISIBLE);
                    stopButton.setEnabled(true);
                    stopButton.setAlpha(1.0f);
                    stopButton.setOnClickListener(v -> {
                        v.setPressed(false);
                        stopRunningScript(runningSession.instanceId);
                    });
                }
                if (scriptMetadata.isAssetScript()) {
                    editButton.setVisibility(View.VISIBLE);
                    editButton.setEnabled(true);
                    editButton.setAlpha(1.0f);
                    editButton.setImageResource(R.drawable.ic_visibility);
                    editButton.setContentDescription(getString(R.string.view));
                    editButton.setOnClickListener(v -> {
                        v.setPressed(false);
                        showScriptEditorDialog(scriptMetadata);
                    });
                } else {
                    editButton.setVisibility(View.VISIBLE);
                    editButton.setEnabled(true);
                    editButton.setAlpha(1.0f);
                    editButton.setImageResource(R.drawable.ic_edit);
                    editButton.setContentDescription(getString(R.string.edit));
                    editButton.setOnClickListener(v -> {
                        v.setPressed(false);
                        showScriptEditorDialog(scriptMetadata);
                    });
                }
                return view;
            }

            // SIGNAL
            SignalMetadata sig = entry.signal;
            nameView.setText(sig.displayName());
            kindBadgeView.setText("Signal");
            applySignalBadgeStyle(kindBadgeView);
            kindBadgeView.setVisibility(View.VISIBLE);
            statusView.setVisibility(View.GONE);
            stopButton.setVisibility(View.GONE);
            editButton.setVisibility(View.VISIBLE);
            editButton.setEnabled(true);
            editButton.setAlpha(1.0f);
            editButton.setImageResource(R.drawable.ic_visibility);
            editButton.setContentDescription(getString(R.string.view));
            editButton.setOnClickListener(v -> {
                v.setPressed(false);
                openSignal(sig);
            });
            return view;
        }
    }

    private List<AndroidScriptSession> sessionsForScript(@Nullable String scriptId) {
        if (TextUtils.isEmpty(scriptId)) {
            return Collections.emptyList();
        }
        List<AndroidScriptSession> matches = new ArrayList<>();
        for (AndroidScriptSession session : scriptSessions.sessions()) {
            if (session != null && TextUtils.equals(session.scriptId, scriptId)) {
                matches.add(session);
            }
        }
        return matches;
    }

    @Nullable
    private AndroidScriptSession firstRunningSession(@NonNull List<AndroidScriptSession> sessions) {
        for (AndroidScriptSession session : sessions) {
            if (session != null && session.isRunning()) {
                return session;
            }
        }
        return null;
    }

    private String sessionStatusSummary(@NonNull List<AndroidScriptSession> sessions) {
        List<String> parts = new ArrayList<>();
        for (AndroidScriptSession session : sessions) {
            if (session == null) {
                continue;
            }
            parts.add(session.statusLabel());
        }
        if (parts.isEmpty()) {
            return "";
        }
        return TextUtils.join(", ", parts);
    }

    private String kindBadgeLabel(@NonNull ScriptMetadata scriptMetadata) {
        if (scriptMetadata.isCustomScript()) {
            return "User";
        }
        switch (scriptMetadata.getFileKind()) {
            case LIBRARY:
                return "Library";
            case KERNEL:
                return "Kernel";
            case SCRIPT:
            default:
                return "Example";
        }
    }

    private void applyKindBadgeStyle(@NonNull TextView view, @NonNull ScriptMetadata scriptMetadata) {
        if (scriptMetadata.isCustomScript()) {
            applyBadgeStyle(view, Color.rgb(15, 118, 110), Color.argb(31, 15, 118, 110));
            return;
        }
        switch (scriptMetadata.getFileKind()) {
            case LIBRARY:
                applyBadgeStyle(view, Color.rgb(126, 34, 206), Color.argb(31, 126, 34, 206));
                break;
            case KERNEL:
                applyBadgeStyle(view, Color.rgb(194, 65, 12), Color.argb(31, 194, 65, 12));
                break;
            case SCRIPT:
            default:
                applyBadgeStyle(view, Color.rgb(1, 87, 155), Color.argb(31, 1, 87, 155));
                break;
        }
    }

    private void applySignalBadgeStyle(@NonNull TextView view) {
        applyBadgeStyle(view, Color.rgb(79, 79, 79), Color.argb(31, 79, 79, 79));
    }

    private void applyBadgeStyle(@NonNull TextView view, int foreground, int background) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.RECTANGLE);
        drawable.setCornerRadius(999f);
        drawable.setColor(background);
        view.setTextColor(foreground);
        view.setBackground(drawable);
    }

    private void showAssetScriptViewDialog(@NonNull ScriptMetadata scriptMetadata) {
        // Deprecated: asset scripts now open in the full-screen editor (read-only).
        showScriptEditorDialog(scriptMetadata);
    }

    private String assetScriptAssetPath(@NonNull UserFileMetadata metadata) {
        String name = metadata != null ? metadata.getName() : "";
        return ASSET_SCRIPTS_DIR + "/" + name + ASSET_SCRIPT_EXTENSION;
    }

    private String readAssetText(@NonNull String filename) {
        try (InputStream is = requireContext().getAssets().open(filename)) {
            return readTextFromInputStream(is);
        } catch (IOException e) {
            Log.e(TAG, "Failed to read asset: " + filename, e);
            return "";
        }
    }

    private java.io.File getSignalsDir() {
        return new java.io.File(requireContext().getFilesDir(), SIGNALS_DIR_NAME);
    }

    private List<java.io.File> getLegacySignalDirs() {
        List<java.io.File> dirs = new ArrayList<>();

        try {
            java.io.File root = Environment.getExternalStorageDirectory();
            if (root != null) {
                dirs.add(new java.io.File(root, "emwaver"));
            }
        } catch (Exception ignored) {
        }

        try {
            java.io.File appExternal = requireContext().getExternalFilesDir(null);
            if (appExternal != null) {
                dirs.add(new java.io.File(appExternal, "emwaver"));
            }
        } catch (Exception ignored) {
        }

        try {
            dirs.add(new java.io.File(requireContext().getFilesDir(), "emwaver"));
        } catch (Exception ignored) {
        }

        return dirs;
    }

    private void loadSignalFiles() {
        signalFiles.clear();
        java.io.File dir = getSignalsDir();
        if (!dir.exists()) {
            return;
        }
        java.io.File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        for (java.io.File f : files) {
            if (!f.isFile()) continue;
            String n = f.getName();
            String lower = n.toLowerCase(Locale.US);
            if (!(lower.endsWith(SIGNAL_RAW_EXTENSION) || lower.endsWith(SIGNAL_TEXT_EXTENSION))) {
                continue;
            }
            String ext = lower.endsWith(SIGNAL_RAW_EXTENSION) ? SIGNAL_RAW_EXTENSION : SIGNAL_TEXT_EXTENSION;
            String base = n.substring(0, n.length() - ext.length());
            signalFiles.add(new SignalMetadata(base, f, ext));
        }
        Collections.sort(signalFiles, (a, b) -> a.displayName().compareToIgnoreCase(b.displayName()));
    }

    private void openSignal(@NonNull SignalMetadata sig) {
        if (!isAdded() || sig == null) {
            return;
        }
        showLoadingDialog("Loading signal...");
        new Thread(() -> {
            String content;
            try {
                if (SIGNAL_RAW_EXTENSION.equalsIgnoreCase(sig.extension)) {
                    content = "(Binary signal .raw)";
                } else {
                    byte[] bytes = java.nio.file.Files.readAllBytes(sig.file.toPath());
                    content = new String(bytes, StandardCharsets.UTF_8);
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to open signal", e);
                String msg = e.getMessage();
                runOnUiThreadSafe(() -> {
                    hideLoadingDialog();
                    showToast(msg != null ? msg : "Failed to open signal");
                });
                return;
            }

            runOnUiThreadSafe(() -> {
                hideLoadingDialog();
                currentScriptMetadata = null;
                currentScriptName = sig.displayName();
                currentScriptEtag = null;
                currentDraftContent = content;
                setEditorText(content);
                applyEditorReadOnly(true);
                showingEditor = true;
                showingPreview = false;
                updateViewMode();
                applySyntaxHighlightNow();
            });
        }).start();
    }

    private void loadScripts() {
        if (fileRepository == null) {
            return;
        }
        // Always load asset scripts first
        loadAssetScripts();
        
        // Then load custom scripts from storage
        fileRepository.listFiles(SCRIPT_EXTENSION, new RepositoryCallback<List<UserFileMetadata>>() {
            @Override
            public void onSuccess(List<UserFileMetadata> value) {
                if (!isAdded()) {
                    return;
                }
                
                // Clear and populate custom scripts list
                customScripts.clear();
                
                // Add custom scripts (exclude any that match asset script names)
                List<String> assetNames = getAssetScriptNames();
                if (value != null) {
                    for (UserFileMetadata metadata : value) {
                        String name = metadata.getName().toLowerCase();
                        // Skip if this is an asset script name (shouldn't be in storage, but check anyway)
                        boolean isAssetName = false;
                        for (String assetName : assetNames) {
                            if (name.equals(assetName.toLowerCase())) {
                                isAssetName = true;
                                break;
                            }
                        }
                        if (!isAssetName) {
                            customScripts.add(new ScriptMetadata(metadata, ScriptMetadata.SourceType.CUSTOM));
                        }
                    }
                }
                
                // Sort custom scripts alphabetically
                Collections.sort(customScripts, (a, b) -> a.getName().compareToIgnoreCase(b.getName()));

                loadSignalFiles();
                rebuildCombinedScripts();

                // Prime cache for scripts only (skip headers/signals)
                List<ScriptMetadata> toPrime = new ArrayList<>();
                toPrime.addAll(assetScripts);
                toPrime.addAll(customScripts);
                primeScriptCache(toPrime, ScriptsFragment.this::handlePostListLoad);
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

    private void rebuildCombinedScripts() {
        scripts.clear();

        for (ScriptMetadata s : assetScripts) {
            scripts.add(ListEntry.script(s));
        }

        for (ScriptMetadata s : customScripts) {
            scripts.add(ListEntry.script(s));
        }

        for (SignalMetadata s : signalFiles) {
            scripts.add(ListEntry.signal(s));
        }

        refreshScriptList();
    }
    
    private List<String> getAssetScriptNames() {
        List<String> names = new ArrayList<>();
        for (String filename : listAssetScriptFiles()) {
            if (filename == null) {
                continue;
            }
            String lower = filename.toLowerCase(Locale.US);
            if (!lower.endsWith(ASSET_SCRIPT_EXTENSION)) {
                continue;
            }
            names.add(filename.substring(0, filename.length() - ASSET_SCRIPT_EXTENSION.length()));
        }
        Collections.sort(names, String::compareToIgnoreCase);
        return names;
    }

    private List<String> listAssetScriptFiles() {
        List<String> filesOut = new ArrayList<>();
        if (!isAdded()) {
            return filesOut;
        }
        try {
            String[] files = requireContext().getAssets().list(ASSET_SCRIPTS_DIR);
            if (files == null) {
                return filesOut;
            }
            for (String filename : files) {
                if (filename == null) {
                    continue;
                }
                String lower = filename.toLowerCase(Locale.US);
                if (lower.endsWith(ASSET_SCRIPT_EXTENSION)) {
                    filesOut.add(filename);
                }
            }
            Collections.sort(filesOut, String::compareToIgnoreCase);
        } catch (IOException e) {
            Log.w(TAG, "Failed to list asset scripts", e);
        }
        return filesOut;
    }
    
    private void loadAssetScripts() {
        if (!isAdded()) {
            return;
        }
        
        assetScripts.clear(); // Clear existing asset scripts

        List<String> assetScriptFiles = listAssetScriptFiles();
        for (String filename : assetScriptFiles) {
            try {
                String assetPath = ASSET_SCRIPTS_DIR + "/" + filename;
                InputStream is = requireContext().getAssets().open(assetPath);
                String content = readTextFromInputStream(is);
                is.close();

                String name = filename.substring(0, filename.length() - ASSET_SCRIPT_EXTENSION.length());
                String id = "__asset__" + assetPath; // Special ID prefix for asset scripts
                if (viewModel != null) {
                    viewModel.updateDraft(id, name, content, false);
                }
                UserFileMetadata metadata = new UserFileMetadata(
                    id,
                    name,
                    ASSET_SCRIPT_EXTENSION,
                    "file",
                    "asset", // Special etag for assets
                    0,
                    "text/plain"
                );
                assetScripts.add(new ScriptMetadata(
                    metadata,
                    ScriptMetadata.SourceType.ASSET,
                    assetFileKind(filename)
                ));
            } catch (IOException e) {
                Log.w(TAG, "Asset script not found: " + filename, e);
            }
        }
        
        Collections.sort(assetScripts, (a, b) -> {
            int kindCompare = Integer.compare(assetSortRank(a.getFileKind()), assetSortRank(b.getFileKind()));
            if (kindCompare != 0) {
                return kindCompare;
            }
            return a.getName().compareToIgnoreCase(b.getName());
        });
    }

    private ScriptMetadata.FileKind assetFileKind(@NonNull String filename) {
        String lower = filename.toLowerCase(Locale.US);
        if ("emw-kernel.emw".equals(lower) || "emw-protocol.emw".equals(lower)) {
            return ScriptMetadata.FileKind.KERNEL;
        }
        if (lower.startsWith("emw-")) {
            return ScriptMetadata.FileKind.LIBRARY;
        }
        return ScriptMetadata.FileKind.SCRIPT;
    }

    private int assetSortRank(@NonNull ScriptMetadata.FileKind kind) {
        switch (kind) {
            case SCRIPT:
                return 0;
            case LIBRARY:
                return 1;
            case KERNEL:
                return 2;
            default:
                return 3;
        }
    }
    
    private void renameScript(ScriptMetadata scriptMetadata, String newName) {
        renameScript(scriptMetadata, newName, null);
    }

    private void renameScript(ScriptMetadata scriptMetadata, String newName, @Nullable Consumer<ScriptMetadata> onSuccess) {
        if (scriptMetadata.isAssetScript()) {
            showToast("Asset scripts cannot be renamed");
            return;
        }
        UserFileMetadata metadata = scriptMetadata.getMetadata();
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
                ScriptMetadata updatedScriptMetadata = new ScriptMetadata(updated, ScriptMetadata.SourceType.CUSTOM);
                addOrReplaceMetadata(updatedScriptMetadata);
                if (currentScriptMetadata != null && currentScriptMetadata.getId().equals(updated.getId())) {
                    currentScriptMetadata = updatedScriptMetadata;
                    currentScriptName = updated.getName();
                    currentScriptEtag = updated.getEtag();
                }
                if (viewModel != null) {
                    String draft = viewModel.getDraftContent(updated.getId());
                    boolean dirty = viewModel.isDirty(updated.getId());
                    String reference = draft != null ? draft : viewModel.getStoredContent(updated.getId());
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
                    onSuccess.accept(updatedScriptMetadata);
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

        if (assetScripts.isEmpty() && customScripts.isEmpty()) {
            if (binding != null) {
                String content = null;
                boolean dirty = false;
                if (viewModel != null) {
                    content = viewModel.getDraftContent(ScriptsViewModel.UNSAVED_KEY);
                    dirty = viewModel.isDirty(ScriptsViewModel.UNSAVED_KEY);
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

        ScriptMetadata target = null;
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
            if (!assetScripts.isEmpty()) {
                target = assetScripts.get(0);
            } else if (!customScripts.isEmpty()) {
                target = customScripts.get(0);
            }
        }
        if (target != null) {
            loadScript(target);
        }
    }

    private ScriptMetadata findScriptById(String id) {
        if (id == null) {
            return null;
        }
        for (ScriptMetadata scriptMetadata : assetScripts) {
            if (scriptMetadata != null && TextUtils.equals(id, scriptMetadata.getId())) {
                return scriptMetadata;
            }
        }
        for (ScriptMetadata scriptMetadata : customScripts) {
            if (scriptMetadata != null && TextUtils.equals(id, scriptMetadata.getId())) {
                return scriptMetadata;
            }
        }
        return null;
    }

    private void addOrReplaceMetadata(ScriptMetadata scriptMetadata) {
        if (scriptMetadata == null) {
            return;
        }
        List<ScriptMetadata> targetList = scriptMetadata.isAssetScript() ? assetScripts : customScripts;
        boolean replaced = false;
        for (int i = 0; i < targetList.size(); i++) {
            ScriptMetadata existing = targetList.get(i);
            if (existing != null && TextUtils.equals(existing.getId(), scriptMetadata.getId())) {
                targetList.set(i, scriptMetadata);
                replaced = true;
                break;
            }
        }
        if (!replaced) {
            targetList.add(scriptMetadata);
            // Sort the target list
            Collections.sort(targetList, (a, b) -> a.getName().compareToIgnoreCase(b.getName()));
        }
        rebuildCombinedScripts();
    }

    private void removeMetadataById(String id) {
        // Try to remove from custom scripts first (asset scripts shouldn't be removed)
        for (int i = 0; i < customScripts.size(); i++) {
            if (customScripts.get(i).getId().equals(id)) {
                customScripts.remove(i);
                rebuildCombinedScripts();
                return;
            }
        }
        // Also check asset scripts (shouldn't happen, but be safe)
        for (int i = 0; i < assetScripts.size(); i++) {
            if (assetScripts.get(i).getId().equals(id)) {
                assetScripts.remove(i);
                rebuildCombinedScripts();
                return;
            }
        }
    }

    private void onScriptCreated(UserFileMetadata metadata, String content) {
        if (binding == null) {
            return;
        }
        ScriptMetadata scriptMetadata = new ScriptMetadata(metadata, ScriptMetadata.SourceType.CUSTOM);
        addOrReplaceMetadata(scriptMetadata);
        currentScriptMetadata = scriptMetadata;
        currentScriptName = metadata.getName();
        currentScriptEtag = metadata.getEtag();
        setEditorText(content);
        updateDraftState(content, false);
        if (viewModel != null) {
            viewModel.removeRecord(ScriptsViewModel.UNSAVED_KEY);
            viewModel.markClean(metadata.getId(), content, metadata.getEtag());
            viewModel.setLastScriptId(metadata.getId());
            viewModel.setLastScriptName(metadata.getName());
            viewModel.setLastScriptContent(content);
        }
        showScriptEditorDialog(scriptMetadata);
    }

    private void loadScript(ScriptMetadata scriptMetadata) {
        if (!isAdded() || scriptMetadata == null) {
            return;
        }

        currentScriptMetadata = scriptMetadata;
        UserFileMetadata metadata = scriptMetadata.getMetadata();
        currentScriptName = metadata.getName();
        currentScriptEtag = metadata.getEtag();

        final String scriptId = metadata.getId();
        
        // Handle asset scripts differently - load directly from assets
        if (scriptMetadata.isAssetScript()) {
            loadAssetScriptContent(scriptMetadata);
            return;
        }

        // Custom scripts load from storage
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
            String cachedEtag = viewModel.getStoredEtag(scriptId);
            String cachedStored = viewModel.getStoredContent(scriptId);
            if (!TextUtils.isEmpty(cachedEtag) && cachedStored != null && TextUtils.equals(cachedEtag, metadata.getEtag())) {
                needsFetch = false;
                if (!dirty) {
                    setEditorText(cachedStored);
                    updateDraftState(cachedStored, false);
                }
                String contentToUse = getEditorText();
                if (contentToUse == null || contentToUse.trim().isEmpty()) {
                    contentToUse = cachedStored;
                    setEditorText(cachedStored);
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
                    viewModel.updateStoredSnapshot(scriptId, metadata.getName(), metadata.getEtag(), content);
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
    
    private void loadAssetScriptContent(ScriptMetadata scriptMetadata) {
        if (!isAdded() || scriptMetadata == null || !scriptMetadata.isAssetScript()) {
            return;
        }
        
        UserFileMetadata metadata = scriptMetadata.getMetadata();
        String scriptId = metadata.getId();
        String assetPath = assetScriptAssetPath(metadata);
        
        try {
            InputStream is = requireContext().getAssets().open(assetPath);
            String content = readTextFromInputStream(is);
            is.close();
            
            // Asset scripts are always clean (not dirty)
            if (viewModel != null) {
                viewModel.updateDraft(scriptId, metadata.getName(), content, false);
                viewModel.setLastScriptId(scriptId);
                viewModel.setLastScriptName(metadata.getName());
                viewModel.setLastScriptContent(content);
            }
            setEditorText(content);
            updateDraftState(content, false);
            completePendingPreview(scriptId);
        } catch (IOException e) {
            Log.e(TAG, "Failed to load asset script: " + assetPath, e);
            if (TextUtils.equals(pendingPreviewScriptId, scriptId)) {
                pendingPreviewScriptId = null;
            }
            showToast("Failed to load asset script: " + assetPath);
        }
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
        
        // For asset scripts, copy content to a new custom script
        if (currentScriptMetadata.isAssetScript()) {
            String content = getEditorText();
            if (content == null || content.trim().isEmpty()) {
                // Load asset content
                try {
                    String assetPath = ASSET_SCRIPTS_DIR + "/" + currentScriptMetadata.getName() + ASSET_SCRIPT_EXTENSION;
                    InputStream is = requireContext().getAssets().open(assetPath);
                    content = readTextFromInputStream(is);
                    is.close();
                } catch (IOException e) {
                    showToast("Failed to read asset script content");
                    return;
                }
            }
            createScriptWithContent(name, content, "Script copied: ");
            return;
        }
        
        // For custom scripts, use file repository copy
        final String normalizedName = normalizeScriptName(name);
        fileRepository.copyFile(currentScriptMetadata.getId(), normalizedName, new RepositoryCallback<UserFileMetadata>() {
            @Override
            public void onSuccess(UserFileMetadata metadata) {
                if (!isAdded()) {
                    return;
                }
                ScriptMetadata scriptMetadata = new ScriptMetadata(metadata, ScriptMetadata.SourceType.CUSTOM);
                addOrReplaceMetadata(scriptMetadata);
                showScriptEditorDialog(scriptMetadata);
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
                currentScriptName != null ? currentScriptName : "script_script.emw",
                name -> createScriptWithContent(name, getEditorText(), "Script saved: ")
            );
            return;
        }
        
        // Asset scripts cannot be saved (they're read-only)
        if (currentScriptMetadata.isAssetScript()) {
            showToast("Asset scripts cannot be modified. Create a copy to edit.");
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
                ScriptMetadata scriptMetadata = new ScriptMetadata(metadata, ScriptMetadata.SourceType.CUSTOM);
                addOrReplaceMetadata(scriptMetadata);
                currentScriptMetadata = scriptMetadata;
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

    private void showScriptOptionsDialog(ScriptMetadata scriptMetadata) {
        if (scriptMetadata.isAssetScript()) {
            showToast("Asset scripts cannot be modified");
            return;
        }
        
        UserFileMetadata metadata = scriptMetadata.getMetadata();
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
            renameScript(scriptMetadata, newName);
            dialog.dismiss();
        });

        dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> {
            showDeleteConfirmationDialog(scriptMetadata);
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

    private void showScriptEditorDialog(@Nullable ScriptMetadata scriptMetadata) {
        if (!isAdded()) {
            return;
        }
        
        showingEditor = true;
        pendingPreviewScriptId = null;
        
        UserFileMetadata metadata = scriptMetadata != null ? scriptMetadata.getMetadata() : null;
        final String scriptId = metadata != null ? metadata.getId() : ScriptsViewModel.UNSAVED_KEY;
        final String scriptName = metadata != null ? metadata.getName() : (currentScriptName != null ? currentScriptName : "Unsaved Script");

        if (scriptMetadata != null) {
            currentScriptMetadata = scriptMetadata;
            currentScriptName = metadata.getName();
            currentScriptEtag = metadata.getEtag();
        } else {
            currentScriptMetadata = null;
            currentScriptName = scriptName;
            currentScriptEtag = null;
        }

        String content = null;
        boolean dirty = false;
        
        // For asset scripts, load directly from assets
        if (scriptMetadata != null && scriptMetadata.isAssetScript()) {
            String filename = assetScriptAssetPath(metadata);
            try {
                InputStream is = requireContext().getAssets().open(filename);
                content = readTextFromInputStream(is);
                is.close();
                dirty = false; // Asset scripts are never dirty
            } catch (IOException e) {
                Log.e(TAG, "Failed to load asset script for editor: " + filename, e);
                content = "";
            }
        } else if (viewModel != null) {
            content = viewModel.getDraftContent(scriptId);
            dirty = viewModel.isDirty(scriptId);
            if (content == null) {
                content = viewModel.getStoredContent(scriptId);
            }
        }
        if (content == null) {
            content = metadata != null ? "" : buildNewScriptTemplate();
        }

        // For custom scripts, load from storage if needed
        if (scriptMetadata != null && scriptMetadata.isCustomScript() && viewModel != null && TextUtils.isEmpty(viewModel.getStoredEtag(scriptId)) && fileRepository != null) {
            showLoadingDialog("Loading script...");
            fileRepository.getFile(scriptId, new RepositoryCallback<UserFileData>() {
                @Override
                public void onSuccess(UserFileData data) {
                    hideLoadingDialog();
                    if (!isAdded()) {
                        return;
                    }
                    String storedContent = data != null && data.hasTextContent() ? data.getTextContent() : "";
                    viewModel.updateStoredSnapshot(scriptId, scriptName, metadata.getEtag(), storedContent);
                    if (!viewModel.isDirty(scriptId)) {
                        viewModel.updateDraft(scriptId, scriptName, storedContent, false);
                    }
                    setEditorText(storedContent);
                    showScriptEditorDialog(scriptMetadata);
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

        boolean readOnly = scriptMetadata != null && scriptMetadata.isAssetScript();
        applyEditorReadOnly(readOnly);

        updateLineWrap();
        updateViewMode();
        applySyntaxHighlightNow();
    }

    private void applyEditorReadOnly(boolean readOnly) {
        applyEditorReadOnly(scriptEditorContent, readOnly);
        applyEditorReadOnly(scriptEditorContentWrap, readOnly);
    }

    private void applyEditorReadOnly(@Nullable EditText editText, boolean readOnly) {
        if (editText == null) {
            return;
        }
        if (readOnly) {
            editText.setKeyListener(null);
            editText.setTextIsSelectable(true);
        } else {
            // Restore editable behavior.
            if (editText == scriptEditorContent) {
                editText.setKeyListener(originalEditorKeyListener);
            } else if (editText == scriptEditorContentWrap) {
                editText.setKeyListener(originalEditorWrapKeyListener);
            }
            editText.setTextIsSelectable(true);
        }
    }

    private void showDeleteConfirmationDialog(ScriptMetadata scriptMetadata) {
        if (!isAdded() || scriptMetadata == null) {
            return;
        }
        if (scriptMetadata.isAssetScript()) {
            showToast("Asset scripts cannot be deleted");
            return;
        }
        UserFileMetadata metadata = scriptMetadata.getMetadata();

        new AlertDialog.Builder(requireContext())
            .setTitle("Delete Script")
            .setMessage("Are you sure you want to delete " + metadata.getName() + "?")
            .setPositiveButton("Delete", (dialog, which) -> deleteScript(scriptMetadata))
            .setNegativeButton("Cancel", null)
            .show();
    }
    
    private void showDeleteSignalConfirmationDialog(@NonNull SignalMetadata signalMetadata) {
        if (!isAdded() || signalMetadata == null) {
            return;
        }

        new AlertDialog.Builder(requireContext())
            .setTitle("Delete Signal")
            .setMessage("Are you sure you want to delete " + signalMetadata.displayName() + "?")
            .setPositiveButton("Delete", (dialog, which) -> deleteSignal(signalMetadata))
            .setNegativeButton("Cancel", null)
            .show();
    }

    private void deleteSignal(@NonNull SignalMetadata signalMetadata) {
        if (!isAdded() || signalMetadata == null) {
            return;
        }

        java.io.File f = signalMetadata.file;
        if (f == null || !f.exists()) {
            showToast("Signal not found");
            return;
        }

        showLoadingDialog("Deleting signal...");

        new Thread(() -> {
            boolean ok = false;
            try {
                ok = f.delete();
            } catch (Exception ignored) {
                ok = false;
            }

            final boolean deleted = ok;
            runOnUiThreadSafe(() -> {
                hideLoadingDialog();
                if (!deleted) {
                    showToast("Failed to delete signal");
                    return;
                }

                // If currently viewing this signal, clear editor.
                if (TextUtils.equals(currentScriptName, signalMetadata.displayName())) {
                    currentScriptMetadata = null;
                    currentScriptName = null;
                    currentScriptEtag = null;
                    setEditorText("");
                    updateDraftState("", false);
                    showingEditor = false;
                    showingPreview = true;
                    updateViewMode();
                }

                loadSignalFiles();
                rebuildCombinedScripts();
                showToast("Signal deleted: " + signalMetadata.displayName());
            });
        }).start();
    }

    private void showResetDefaultsConfirmationDialog() {
        if (!isAdded()) {
            return;
        }
        new AlertDialog.Builder(requireContext())
            .setTitle("Delete Custom Scripts")
            .setMessage("This will delete ALL custom scripts from internal storage. Asset scripts (hard-coded defaults) will remain unchanged. This action cannot be undone.\n\nAre you sure you want to continue?")
            .setPositiveButton("Delete", (dialog, which) -> resetToDefaults())
            .setNegativeButton("Cancel", null)
            .show();
    }
    
    private void resetToDefaults() {
        if (fileRepository == null) {
            showToast("File repository unavailable");
            return;
        }
        
        if (customScripts.isEmpty()) {
            // No custom scripts to delete
            showToast("No custom scripts to delete");
            return;
        }
        
        showLoadingDialog("Deleting custom scripts...");
        
        // Delete all custom scripts
        List<ScriptMetadata> scriptsToDelete = new ArrayList<>(customScripts);
        AtomicInteger remaining = new AtomicInteger(scriptsToDelete.size());
        AtomicInteger successCount = new AtomicInteger(0);
        
        for (ScriptMetadata script : scriptsToDelete) {
            fileRepository.deleteFile(script.getId(), script.getEtag(), new RepositoryCallback<Void>() {
                @Override
                public void onSuccess(Void value) {
                    customScripts.remove(script);
                    if (viewModel != null) {
                        viewModel.removeRecord(script.getId());
                    }
                    successCount.incrementAndGet();
                    if (remaining.decrementAndGet() == 0) {
                        // All custom scripts deleted
                        hideLoadingDialog();
                        rebuildCombinedScripts();
                        if (viewModel != null) {
                            viewModel.clearAll();
                        }
                        currentScriptMetadata = null;
                        currentScriptName = null;
                        currentScriptEtag = null;
                        setEditorText("");
                        showToast("Deleted " + successCount.get() + " custom script(s)");
                    }
                }
                
                @Override
                public void onError(String message) {
                    Log.w(TAG, "Failed to delete script during reset: " + script.getName());
                    if (remaining.decrementAndGet() == 0) {
                        hideLoadingDialog();
                        refreshScriptList();
                        if (viewModel != null) {
                            viewModel.clearAll();
                        }
                        currentScriptMetadata = null;
                        currentScriptName = null;
                        currentScriptEtag = null;
                        setEditorText("");
                        showToast("Deleted " + successCount.get() + " custom script(s)");
                    }
                }
            });
        }
    }

    private void deleteScript(ScriptMetadata scriptMetadata) {
        if (fileRepository == null || scriptMetadata == null) {
            return;
        }
        if (scriptMetadata.isAssetScript()) {
            showToast("Asset scripts cannot be deleted");
            return;
        }
        UserFileMetadata metadata = scriptMetadata.getMetadata();
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

    private void primeScriptCache(List<ScriptMetadata> metadataList, @Nullable Runnable completion) {
        if (!isAdded() || viewModel == null || fileRepository == null || metadataList == null || metadataList.isEmpty()) {
            if (completion != null) {
                runOnUiThreadSafe(completion);
            }
            return;
        }
        
        // Load asset scripts into cache
        for (ScriptMetadata scriptMetadata : metadataList) {
            if (scriptMetadata != null && scriptMetadata.isAssetScript()) {
                try {
                    UserFileMetadata assetMeta = scriptMetadata.getMetadata();
                    String baseName = assetMeta != null && assetMeta.getName() != null ? assetMeta.getName() : scriptMetadata.getName();
                    String filename = ASSET_SCRIPTS_DIR + "/" + baseName + ASSET_SCRIPT_EXTENSION;
                    InputStream is = requireContext().getAssets().open(filename);
                    String content = readTextFromInputStream(is);
                    is.close();
                    String scriptId = scriptMetadata.getId();
                    viewModel.updateDraft(scriptId, scriptMetadata.getName(), content, false);
                } catch (IOException e) {
                    Log.w(TAG, "Failed to cache asset script: " + scriptMetadata.getName(), e);
                }
            }
        }
        
        // Check if custom scripts need refresh
        boolean needsRefresh = false;
        for (ScriptMetadata scriptMetadata : metadataList) {
            if (scriptMetadata == null || scriptMetadata.isAssetScript() || TextUtils.isEmpty(scriptMetadata.getId())) {
                continue;
            }
            UserFileMetadata metadata = scriptMetadata.getMetadata();
            String cachedEtag = viewModel.getStoredEtag(metadata.getId());
            String cachedContent = viewModel.getStoredContent(metadata.getId());
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
                        String storedContent = data.hasTextContent() ? data.getTextContent() : "";
                        viewModel.updateStoredSnapshot(scriptId, metadata.getName(), metadata.getEtag(), storedContent);
                        if (!viewModel.isDirty(scriptId)) {
                            viewModel.updateDraft(scriptId, metadata.getName(), storedContent, false);
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
        // Collapsible sections removed: asset/custom scripts share a single list.
    }

    private void renderScript(String script) {
        Log.d(TAG, "renderScript called with script length: " + (script != null ? script.length() : 0));
        if (viewModel != null) {
            viewModel.setLastScriptContent(script);
            viewModel.setLastScriptName(currentScriptName);
            viewModel.setLastScriptId(currentScriptMetadata != null ? currentScriptMetadata.getId() : null);
            viewModel.setPreviewActive(true);
        }
        final ScriptDeviceConnection capturedConnection;
        if (isAdded()) {
            String deviceLabel = currentDeviceLabel();
            capturedConnection = ScriptDeviceConnection.captureActive(requireContext(), deviceLabel);
            scriptDeviceConnection = capturedConnection;
        } else {
            capturedConnection = null;
            scriptDeviceConnection = null;
        }

        if (capturedConnection != null && capturedConnection.isConnected()) {
            boolean sessionOk = capturedConnection.beginTransportSession();
            if (!sessionOk) {
                showToast("Cannot run script: transport claim failed");
                return;
            }
        }

        setupScriptEngineIfNeeded();
        if (scriptEngine == null) {
            Log.e(TAG, "Script engine is null!");
            showToast("Script engine not ready.");
            return;
        }
        if (capturedConnection != null) {
            scriptEngine.setDeviceConnection(capturedConnection);
        }

        String deviceLabel = currentDeviceLabel();
        scriptSessions.stopSelectedRuntime();
        scriptSessions.start(
                () -> {
                    if (capturedConnection != null && capturedConnection.isConnected()) {
                        capturedConnection.endTransportSession();
                    }
                    if (scriptEngine != null) {
                        scriptEngine.shutdown();
                        scriptEngine = null;
                    }
                },
                currentScriptMetadata != null ? currentScriptMetadata.getId() : null,
                currentScriptName,
                runningSessionLabel(deviceLabel),
                capturedConnection != null ? capturedConnection.capturedDeviceId() : "active"
        );
        isRenderingScript = true;
        activeScriptTree = null;
        showingPreview = true;
        updateViewMode();
        rebuildCombinedScripts();
        ensureScriptRenderView();
        if (scriptRenderView != null) {
            scriptRenderView.clear();
        }
        updateScriptPlaceholder();
        scriptEngine.execute(script, moduleSources(), () -> {
            isRenderingScript = false;
            updateScriptPlaceholder();
        });
    }

    private void setupScriptEngineIfNeeded() {
        ensureScriptEngineBindings();
        if (scriptEngine == null) {
            scriptEngine = new ScriptEngine();
            scriptEngine.setBootstrapSource(readAssetUtf8(ASSET_SCRIPTS_DIR + "/emw-kernel.emw"));
            scriptEngine.setAppDataDir(getSignalsDir());
            scriptEngine.setLegacySignalDirs(getLegacySignalDirs());
            if (scriptDeviceConnection == null && isAdded()) {
                scriptDeviceConnection = new ScriptDeviceConnection(requireContext());
            }
            scriptEngine.setDeviceConnection(scriptDeviceConnection);
            scriptEngine.setup(this::handleScriptTree, buildBindings(), this::handleScriptError);
        }
    }

    private void ensureScriptEngineBindings() {
        if (scriptEngine != null) {
            scriptEngine.registerGlobalBindings(buildBindings());
        }
    }

    private Map<String, Object> buildBindings() {
        Map<String, Object> bindings = new HashMap<>();
        if (scriptSignalStore == null && isAdded()) {
            scriptSignalStore = new ScriptSignalStore(requireContext());
        }
        if (scriptSignalStore != null) {
            bindings.put("SamplerSignals", scriptSignalStore);
        }
        return bindings;
    }

    private String readAssetUtf8(String name) {
        if (!isAdded() || name == null || name.isEmpty()) {
            return "";
        }
        try (InputStream inputStream = requireContext().getAssets().open(name);
             ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = inputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, read);
            }
            return outputStream.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            Log.w(TAG, "Failed to read asset " + name, e);
            return "";
        }
    }

    private com.emwaver.emwaverandroidapp.scripts.ScriptNode findNodeById(com.emwaver.emwaverandroidapp.scripts.ScriptNode node, String id) {
        if (node == null || id == null) return null;
        if (id.equals(node.getId())) return node;
        java.util.List<com.emwaver.emwaverandroidapp.scripts.ScriptNode> kids = node.getChildren();
        if (kids != null) {
            for (com.emwaver.emwaverandroidapp.scripts.ScriptNode c : kids) {
                com.emwaver.emwaverandroidapp.scripts.ScriptNode found = findNodeById(c, id);
                if (found != null) return found;
            }
        }
        return null;
    }

    private void handleScriptTree(ScriptTree tree) {
        if (!isAdded() || binding == null) {
            return;
        }
        if (tree == null || tree.getRoot() == null) {
            Log.w(TAG, "Received empty script tree");
            activeScriptTree = null;
            isRenderingScript = false;
            updateScriptPlaceholder();
            return;
        }
        activeScriptTree = tree;
        isRenderingScript = false;
        renderScriptTree(tree);    }

    private void ensureScriptRenderView() {
        if (scriptRenderView != null) {
            return;
        }
        Context context = requireContext();
        scriptRenderView = new ScriptRenderView(context);
        scriptRenderView.setEventListener((token, arguments) -> {
            if (scriptEngine != null) {
                scriptEngine.invoke(token, arguments);
            }
        });
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        binding.scriptContainer.addView(scriptRenderView, 0, params);
    }

    private void renderScriptTree(ScriptTree tree) {
        ensureScriptRenderView();
        if (scriptRenderView != null) {
            scriptRenderView.render(tree);
        }
        updateScriptPlaceholder();
    }

    private void exitPreview() {
        showingPreview = false;
        isRenderingScript = false;
        activeScriptTree = null;
        pendingPreviewScriptId = null;
        if (viewModel != null) {
            viewModel.setPreviewActive(false);
        }
        if (scriptRenderView != null) {
            scriptRenderView.clear();
        }
        updateViewMode();
    }

    private void stopRunningScript(@Nullable String sessionId) {
        if (sessionId == null) {
            scriptSessions.stopSelected();
        } else {
            scriptSessions.stop(sessionId);
        }
        exitPreview();
        rebuildCombinedScripts();
    }

    private String currentDeviceLabel() {
        if (scriptDeviceConnection != null) {
            String status = scriptDeviceConnection.connectionStatus();
            if (!TextUtils.isEmpty(status) && !"Not connected".equalsIgnoreCase(status)) {
                return status;
            }
        }
        return "active device";
    }

    private static String runningSessionLabel(String label) {
        return TextUtils.isEmpty(label) ? "active device" : label;
    }

    private void updateViewMode() {
        if (binding == null) {
            return;
        }
        boolean hideMainView = showingPreview || showingEditor;
        
        if (backPressedCallback != null) {
            backPressedCallback.setEnabled(hideMainView);
        }
        
        if (scriptsCard != null) {
            scriptsCard.setVisibility(hideMainView ? View.GONE : View.VISIBLE);
        }
        binding.scriptContainer.setVisibility(showingPreview ? View.VISIBLE : View.GONE);
        scriptEditorContainer.setVisibility(showingEditor ? View.VISIBLE : View.GONE);
        
        if (getActivity() != null) {
            androidx.appcompat.app.AppCompatActivity activity = (androidx.appcompat.app.AppCompatActivity) getActivity();
            if (activity.getSupportActionBar() != null) {
                if (hideMainView) {
                    // Show back button when previewing or editing
                    String title;
                    if (currentScriptMetadata != null && currentScriptName != null) {
                        title = displayScriptName(currentScriptName, true);
                    } else if (currentScriptName != null) {
                        title = currentScriptName;
                    } else {
                        title = "Script Preview";
                    }
                    activity.getSupportActionBar().setTitle(title);
                    activity.getSupportActionBar().setDisplayHomeAsUpEnabled(true);
                    activity.getSupportActionBar().setHomeButtonEnabled(true);
                } else {
                    activity.getSupportActionBar().setTitle("EMWaver");
                    activity.getSupportActionBar().setDisplayHomeAsUpEnabled(false);
                    activity.getSupportActionBar().setHomeButtonEnabled(false);
                }
            }
        }
        
        updateScriptPlaceholder();
        
        // Invalidate menu to update visibility of editor items
        if (getActivity() != null) {
            getActivity().invalidateOptionsMenu();
        }
    }

    private void copyEditorContent() {
        String code = getEditorText();
        ClipboardManager clipboard = (ClipboardManager) requireContext().getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData clip = ClipData.newPlainText("script", code);
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
        renderScript(content);
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

    private void updateScriptPlaceholder() {
        if (binding == null) {
            return;
        }
        if (!showingPreview) {
            binding.scriptProgress.setVisibility(View.GONE);
            binding.scriptEmptyState.setVisibility(View.GONE);
            return;
        }
        binding.scriptProgress.setVisibility(isRenderingScript ? View.VISIBLE : View.GONE);
        boolean showEmpty = !isRenderingScript && activeScriptTree == null;
        binding.scriptEmptyState.setVisibility(showEmpty ? View.VISIBLE : View.GONE);
        if (scriptRenderView != null) {
            scriptRenderView.setVisibility(showEmpty ? View.GONE : View.VISIBLE);
            if (showEmpty) {
                scriptRenderView.clear();
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
            binding.scriptContainer.post(() -> {
                if (viewModel != null && viewModel.isPreviewActive()) {
                    renderScript(cachedContent);
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

    private void handleScriptError(String message) {
        if (message == null || message.trim().isEmpty()) {
            return;
        }
        Log.e(TAG, message);
        showToast(message);
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
        renderScript(script);
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
        return fileName != null ? fileName : "script.emw";
    }

    private String buildNewScriptTemplate() {
        return "// Script script\n" +
            "render();\n\n" +
            "function render() {\n" +
            "    UI.render(UI.column({\n" +
            "        padding: 16,\n" +
            "        spacing: 12,\n" +
            "        children: [\n" +
            "            UI.text({ text: 'Script Title', font: 'title2', fontWeight: 'semibold' }),\n" +
            "            UI.text({ text: 'Tap a button and use console.log(...) to log output.', foregroundColor: '#6B7280' }),\n" +
            "            UI.button({ label: 'Example', onTap: function () { console.log('hello from script'); } })\n" +
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
            name = "script_script";
        }
        String lower = name.toLowerCase(Locale.US);
        if (!lower.endsWith(SCRIPT_EXTENSION) && !lower.endsWith(".js")) {
            name = name + SCRIPT_EXTENSION;
        }
        return name;
    }

    private interface ScriptNameCallback {
        void onNameEntered(String name);
    }
}
