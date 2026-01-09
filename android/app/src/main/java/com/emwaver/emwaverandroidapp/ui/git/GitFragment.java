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

package com.emwaver.emwaverandroidapp.ui.git;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.view.MenuHost;
import androidx.core.view.MenuProvider;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.Lifecycle;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.Utils;
import com.emwaver.emwaverandroidapp.databinding.FragmentGitBinding;
import com.emwaver.emwaverandroidapp.github.GitHubApiClient;
import com.emwaver.emwaverandroidapp.github.GitHubCacheManager;
import com.emwaver.emwaverandroidapp.github.GitHubConfig;
import com.emwaver.emwaverandroidapp.github.GitHubDiffUtil;
import com.emwaver.emwaverandroidapp.github.GitHubOAuth;
import com.emwaver.emwaverandroidapp.github.GitHubTokenStorage;
import com.emwaver.emwaverandroidapp.files.FileRepositoryLocal;
import com.emwaver.emwaverandroidapp.files.UserFileData;
import com.emwaver.emwaverandroidapp.files.RepositoryCallback;

import java.util.ArrayList;
import java.util.List;

public class GitFragment extends Fragment {
    private static final String TAG = "GitFragment";
    
    private FragmentGitBinding binding;
    private GitHubTokenStorage tokenStorage;
    private GitHubApiClient apiClient;
    private GitHubOAuth oAuth;
    
    private List<GitHubApiClient.GitHubRepository> repositories = new ArrayList<>();
    private List<GitHubApiClient.GitHubContent> fileTree = new ArrayList<>();
    private ArrayAdapter<GitHubApiClient.GitHubRepository> repoAdapter;
    private ArrayAdapter<FileTreeItem> fileTreeAdapter;
    
    private GitHubApiClient.GitHubRepository selectedRepo;
    private String currentPath = "";
    private GitHubApiClient.GitHubContent currentFile;
    private String currentFileSha;
    private String currentFileContent;
    
    private OnBackPressedCallback backPressedCallback;
    
    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        tokenStorage = new GitHubTokenStorage(requireContext());
        oAuth = new GitHubOAuth();
        setHasOptionsMenu(true);
        
        backPressedCallback = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                if (!currentPath.isEmpty()) {
                    navigateUp();
                }
            }
        };
        requireActivity().getOnBackPressedDispatcher().addCallback(this, backPressedCallback);
    }
    
    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        binding = FragmentGitBinding.inflate(inflater, container, false);
        setupMenu();
        setupViews();
        checkAuthState();
        return binding.getRoot();
    }
    
    @Override
    public void onResume() {
        super.onResume();
        if (getActivity() != null) {
            handleIntent(getActivity().getIntent());
        }
        updateStatusBar();
    }
    
    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null;
    }
    
    private void setupMenu() {
        MenuHost menuHost = requireActivity();
        menuHost.addMenuProvider(new MenuProvider() {
            @Override
            public void onCreateMenu(@NonNull Menu menu, @NonNull MenuInflater menuInflater) {
                menuInflater.inflate(R.menu.git_fragment_menu, menu);
            }
            
            @Override
            public boolean onMenuItemSelected(@NonNull MenuItem menuItem) {
                int itemId = menuItem.getItemId();
                if (itemId == R.id.action_logout) {
                    logout();
                    return true;
                } else if (itemId == R.id.action_refresh) {
                    if (selectedRepo != null) {
                        syncRepository();
                    } else {
                        refreshRepositories();
                    }
                    return true;
                } else if (itemId == R.id.action_manage_pat) {
                    showPatDialog();
                    return true;
                } else if (itemId == R.id.action_change_repo) {
                    showRepositorySelectionDialog();
                    return true;
                }
                return false;
            }
        }, getViewLifecycleOwner(), Lifecycle.State.RESUMED);
    }
    
    private void setupViews() {
        // Login button
        binding.loginButton.setOnClickListener(v -> startOAuthFlow());
        
        // Repository list
        repoAdapter = new ArrayAdapter<GitHubApiClient.GitHubRepository>(
            requireContext(),
            android.R.layout.simple_list_item_1,
            repositories
        ) {
            @NonNull
            @Override
            public View getView(int position, @Nullable View convertView, @NonNull ViewGroup parent) {
                View view = super.getView(position, convertView, parent);
                TextView textView = (TextView) view.findViewById(android.R.id.text1);
                GitHubApiClient.GitHubRepository repo = getItem(position);
                if (repo != null) {
                    textView.setText(repo.name);
                }
                return view;
            }
        };
        binding.repoListView.setAdapter(repoAdapter);
        binding.repoListView.setOnItemClickListener((parent, view, position, id) -> {
            if (position >= 0 && position < repositories.size()) {
                selectRepository(repositories.get(position));
            }
        });
        
        // File tree
        fileTreeAdapter = new ArrayAdapter<FileTreeItem>(
            requireContext(),
            R.layout.item_file_tree,
            new ArrayList<>()
        ) {
            @NonNull
            @Override
            public View getView(int position, @Nullable View convertView, @NonNull ViewGroup parent) {
                View view = convertView;
                if (view == null) {
                    view = LayoutInflater.from(getContext()).inflate(R.layout.item_file_tree, parent, false);
                }
                
                TextView fileNameView = view.findViewById(R.id.file_name);
                android.widget.ImageButton editButton = view.findViewById(R.id.edit_button);
                
                FileTreeItem item = getItem(position);
                if (item != null && item.content != null) {
                    String displayName = item.content.name;
                    if ("dir".equals(item.content.type)) {
                        displayName = "📁 " + displayName;
                        editButton.setVisibility(View.GONE);
                    } else {
                        displayName = "📄 " + displayName;
                        editButton.setVisibility(View.VISIBLE);
                        editButton.setOnClickListener(v -> {
                            // Add click animation
                            v.animate()
                                .scaleX(0.8f)
                                .scaleY(0.8f)
                                .setDuration(100)
                                .withEndAction(() -> {
                                    v.animate()
                                        .scaleX(1.0f)
                                        .scaleY(1.0f)
                                        .setDuration(100)
                                        .start();
                                    editFile(item.content);
                                })
                                .start();
                        });
                    }
                    fileNameView.setText(displayName);
                    
                    // Make file name clickable to show options dialog
                    if (!"dir".equals(item.content.type)) {
                        fileNameView.setOnClickListener(v -> {
                            // Add click animation
                            v.animate()
                                .scaleX(0.95f)
                                .scaleY(0.95f)
                                .setDuration(100)
                                .withEndAction(() -> {
                                    v.animate()
                                        .scaleX(1.0f)
                                        .scaleY(1.0f)
                                        .setDuration(100)
                                        .start();
                                })
                                .start();
                            
                            showFileOptionsDialog(item.content);
                        });
                        fileNameView.setClickable(true);
                    }
                    
                    // Store content in view tag for click handler
                    view.setTag(item.content);
                }
                
                return view;
            }
        };
        binding.fileTreeView.setAdapter(fileTreeAdapter);
        binding.fileTreeView.setOnItemClickListener((parent, view, position, id) -> {
            FileTreeItem item = fileTreeAdapter.getItem(position);
            if (item != null && item.content != null) {
                if ("dir".equals(item.content.type)) {
                    navigateToPath(item.content.path);
                }
                // For files, clicking is handled by the TextView onClickListener
                // This handler only processes directory clicks
            }
        });
        
        // Editor removed - using dialogs now
    }
    
    private void checkAuthState() {
        if (tokenStorage.isAuthenticated()) {
            showAuthenticatedState();
            // Use active token (PAT if available, otherwise OAuth token)
            String token = tokenStorage.getActiveToken();
            apiClient = new GitHubApiClient(token);
            loadUserInfo();
            
            // Check if repo is selected
            if (tokenStorage.hasSelectedRepo()) {
                String owner = tokenStorage.getSelectedRepoOwner();
                String repoName = tokenStorage.getSelectedRepoName();
                selectedRepo = new GitHubApiClient.GitHubRepository();
                selectedRepo.owner = owner;
                selectedRepo.name = repoName;
                selectedRepo.fullName = owner + "/" + repoName;
                loadRepositoryContents();
            } else {
                // Show repo selection dialog
                showRepositorySelectionDialog();
            }
        } else {
            showLoginState();
        }
    }
    
    private void showLoginState() {
        binding.loginState.setVisibility(View.VISIBLE);
        binding.authenticatedState.setVisibility(View.GONE);
    }
    
    private void showAuthenticatedState() {
        binding.loginState.setVisibility(View.GONE);
        binding.authenticatedState.setVisibility(View.VISIBLE);
    }
    
    private void startOAuthFlow() {
        String authUrl = GitHubConfig.getAuthorizationUrl();
        CustomTabsIntent.Builder builder = new CustomTabsIntent.Builder();
        CustomTabsIntent customTabsIntent = builder.build();
        customTabsIntent.launchUrl(requireContext(), Uri.parse(authUrl));
    }
    
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        
        Uri data = intent.getData();
        if (data != null) {
            String scheme = data.getScheme();
            String host = data.getHost();
            String path = data.getPath();
            
            // Check if this is our OAuth callback: emwaver://oauth/callback
            if ("emwaver".equals(scheme) && "oauth".equals(host) && "/callback".equals(path)) {
                String code = data.getQueryParameter("code");
                String error = data.getQueryParameter("error");
                
                if (!TextUtils.isEmpty(error)) {
                    String errorDescription = data.getQueryParameter("error_description");
                    showToast("OAuth error: " + (errorDescription != null ? errorDescription : error));
                    return;
                }
                
                if (!TextUtils.isEmpty(code)) {
                    exchangeCodeForToken(code);
                    // Clear the intent data to prevent reprocessing
                    if (getActivity() != null) {
                        getActivity().setIntent(new Intent());
                    }
                }
            }
        }
    }
    
    private void exchangeCodeForToken(String code) {
        oAuth.exchangeCodeForToken(code, new GitHubOAuth.TokenCallback() {
            @Override
            public void onSuccess(String accessToken) {
                requireActivity().runOnUiThread(() -> {
                    tokenStorage.saveToken(accessToken);
                    // Use active token (PAT if available, otherwise the OAuth token we just saved)
                    String activeToken = tokenStorage.getActiveToken();
                    apiClient = new GitHubApiClient(activeToken);
                    checkAuthState();
                });
            }
            
            @Override
            public void onError(String message) {
                requireActivity().runOnUiThread(() -> {
                    showToast("Failed to authenticate: " + message);
                });
            }
        });
    }
    
    private void loadUserInfo() {
        if (apiClient == null) return;
        
        apiClient.getUser(new GitHubApiClient.ApiCallback<GitHubApiClient.GitHubUser>() {
            @Override
            public void onSuccess(GitHubApiClient.GitHubUser result) {
                requireActivity().runOnUiThread(() -> {
                    if (result != null && result.login != null) {
                        tokenStorage.saveUsername(result.login);
                        updateStatusBar();
                    }
                });
            }
            
            @Override
            public void onError(String message) {
                Log.e(TAG, "Failed to load user: " + message);
            }
        });
    }
    
    private void refreshRepositories() {
        if (apiClient == null) return;
        
        showToast("Loading repositories...");
        apiClient.listRepositories(new GitHubApiClient.ApiCallback<List<GitHubApiClient.GitHubRepository>>() {
            @Override
            public void onSuccess(List<GitHubApiClient.GitHubRepository> result) {
                requireActivity().runOnUiThread(() -> {
                    repositories.clear();
                    if (result != null) {
                        repositories.addAll(result);
                    }
                    repoAdapter.notifyDataSetChanged();
                    showToast("Loaded " + repositories.size() + " repositories");
                });
            }
            
            @Override
            public void onError(String message) {
                requireActivity().runOnUiThread(() -> {
                    showToast("Failed to load repositories: " + message);
                });
            }
        });
    }
    
    private void selectRepository(GitHubApiClient.GitHubRepository repo) {
        selectedRepo = repo;
        currentPath = "";
        navigateToPath("");
    }
    
    private void navigateToPath(String path) {
        if (apiClient == null || selectedRepo == null) return;
        
        currentPath = path;
        showToast("Loading " + (path.isEmpty() ? "root" : path) + "...");
        
        apiClient.getContents(selectedRepo.owner, selectedRepo.name, path, 
            new GitHubApiClient.ApiCallback<List<GitHubApiClient.GitHubContent>>() {
                @Override
                public void onSuccess(List<GitHubApiClient.GitHubContent> result) {
                    requireActivity().runOnUiThread(() -> {
                        fileTree.clear();
                        if (result != null) {
                            fileTree.addAll(result);
                        }
                        updateFileTree();
                        backPressedCallback.setEnabled(!path.isEmpty());
                    });
                }
                
                @Override
                public void onError(String message) {
                    requireActivity().runOnUiThread(() -> {
                        showToast("Failed to load contents: " + message);
                    });
                }
            });
    }
    
    private void updateFileTree() {
        List<FileTreeItem> items = new ArrayList<>();
        for (GitHubApiClient.GitHubContent content : fileTree) {
            String displayName = content.name;
            if ("dir".equals(content.type)) {
                displayName = "📁 " + displayName;
            } else {
                displayName = "📄 " + displayName;
            }
            items.add(new FileTreeItem(displayName, content));
        }
        fileTreeAdapter.clear();
        fileTreeAdapter.addAll(items);
        fileTreeAdapter.notifyDataSetChanged();
    }
    
    private void navigateUp() {
        if (currentPath.isEmpty()) return;
        
        int lastSlash = currentPath.lastIndexOf('/');
        String parentPath = lastSlash >= 0 ? currentPath.substring(0, lastSlash) : "";
        navigateToPath(parentPath);
    }
    
    private void showFileOptionsDialog(GitHubApiClient.GitHubContent content) {
        String fileName = content.name;
        boolean localFileExists = checkLocalFileExists(fileName);
        
        // Create options with icons
        class DialogOption {
            String text;
            int iconRes;
            int iconColor;
            
            DialogOption(String text, int iconRes, int iconColor) {
                this.text = text;
                this.iconRes = iconRes;
                this.iconColor = iconColor;
            }
        }
        
        List<DialogOption> options = new ArrayList<>();
        options.add(new DialogOption("Edit File", R.drawable.ic_edit, 0xFF2196F3)); // Blue
        options.add(new DialogOption("GitHub → Local", R.drawable.ic_arrow_down_black, 0xFF4CAF50)); // Green for download
        if (localFileExists) {
            options.add(new DialogOption("Local → GitHub", R.drawable.ic_arrow_up_black, 0xFFFF9800)); // Orange for upload
        }
        
        // Create custom adapter
        ArrayAdapter<DialogOption> adapter = new ArrayAdapter<DialogOption>(requireContext(), R.layout.item_file_option, options) {
            @NonNull
            @Override
            public View getView(int position, @Nullable View convertView, @NonNull ViewGroup parent) {
                if (convertView == null) {
                    convertView = LayoutInflater.from(getContext()).inflate(R.layout.item_file_option, parent, false);
                }
                
                DialogOption option = getItem(position);
                if (option != null) {
                    ImageView iconView = convertView.findViewById(R.id.option_icon);
                    TextView textView = convertView.findViewById(R.id.option_text);
                    
                    iconView.setImageResource(option.iconRes);
                    iconView.setColorFilter(option.iconColor, android.graphics.PorterDuff.Mode.SRC_ATOP);
                    textView.setText(option.text);
                }
                
                return convertView;
            }
        };
        
        new AlertDialog.Builder(requireContext())
            .setTitle(fileName)
            .setAdapter(adapter, (dialog, which) -> {
                if (which == 0) {
                    editFile(content);
                } else if (which == 1) {
                    syncGitHubToLocal(content);
                } else if (which == 2 && localFileExists) {
                    syncLocalToGitHub(content);
                }
            })
            .setNegativeButton("Cancel", null)
            .show();
    }
    
    private boolean checkLocalFileExists(String fileName) {
        // Check if file exists in local scripts storage
        FileRepositoryLocal localRepo = FileRepositoryLocal.getInstance(requireContext());
        java.io.File storageDir = new java.io.File(requireContext().getFilesDir(), "scripts");
        java.io.File file = new java.io.File(storageDir, fileName);
        return file.exists();
    }
    
    private void syncGitHubToLocal(GitHubApiClient.GitHubContent content) {
        if (apiClient == null || selectedRepo == null) return;
        
        showToast("Loading from GitHub...");
        
        // Get file from cache or API
        GitHubCacheManager cacheManager = GitHubCacheManager.getInstance(requireContext());
        String owner = selectedRepo.owner;
        String repoName = selectedRepo.name;
        
        GitHubCacheManager.CacheCallback<String> onContentLoaded = new GitHubCacheManager.CacheCallback<String>() {
            @Override
            public void onSuccess(String githubContent) {
                requireActivity().runOnUiThread(() -> {
                    // Get local content for diff
                    String localContent = "";
                    FileRepositoryLocal localRepo = FileRepositoryLocal.getInstance(requireContext());
                    java.io.File storageDir = new java.io.File(requireContext().getFilesDir(), "scripts");
                    java.io.File localFile = new java.io.File(storageDir, content.name);
                    if (localFile.exists()) {
                        try {
                            java.io.FileInputStream fis = new java.io.FileInputStream(localFile);
                            byte[] buffer = new byte[(int) localFile.length()];
                            fis.read(buffer);
                            fis.close();
                            localContent = new String(buffer, java.nio.charset.StandardCharsets.UTF_8);
                        } catch (Exception e) {
                            Log.w(TAG, "Failed to read local file for diff", e);
                        }
                    }
                    
                    // Show diff preview dialog
                    showSyncPreviewDialog(
                        "GitHub →",
                        "Local",
                        githubContent,
                        localContent,
                        true, // GitHub to Local
                        () -> performSyncGitHubToLocal(content, githubContent),
                        content.name
                    );
                });
            }
            
            @Override
            public void onError(String message) {
                requireActivity().runOnUiThread(() -> {
                    showToast("Failed to load file: " + message);
                });
            }
        };
        
        if (cacheManager.fileExists(owner, repoName, content.path)) {
            cacheManager.getFile(owner, repoName, content.path, onContentLoaded);
        } else {
            loadFileFromApiForSync(content, onContentLoaded);
        }
    }
    
    private void performSyncGitHubToLocal(GitHubApiClient.GitHubContent content, String githubContent) {
        FileRepositoryLocal localRepo = FileRepositoryLocal.getInstance(requireContext());
        localRepo.createTextFile(content.name, githubContent, new RepositoryCallback<com.emwaver.emwaverandroidapp.files.UserFileMetadata>() {
            @Override
            public void onSuccess(com.emwaver.emwaverandroidapp.files.UserFileMetadata metadata) {
                requireActivity().runOnUiThread(() -> {
                    showToast("File copied to local scripts");
                });
            }
            
            @Override
            public void onError(String message) {
                requireActivity().runOnUiThread(() -> {
                    showToast("Failed to copy to local: " + message);
                });
            }
        });
    }
    
    private void syncLocalToGitHub(GitHubApiClient.GitHubContent content) {
        if (apiClient == null || selectedRepo == null) return;
        
        showToast("Loading from local...");
        
        // Get file from local scripts
        FileRepositoryLocal localRepo = FileRepositoryLocal.getInstance(requireContext());
        localRepo.getFile(content.name, new RepositoryCallback<com.emwaver.emwaverandroidapp.files.UserFileData>() {
            @Override
            public void onSuccess(com.emwaver.emwaverandroidapp.files.UserFileData fileData) {
                requireActivity().runOnUiThread(() -> {
                    String localContentTemp = fileData.hasTextContent() ? fileData.getTextContent() : "";
                    if (localContentTemp.isEmpty() && fileData.hasBinaryContent()) {
                        // For binary files, encode to base64
                        localContentTemp = android.util.Base64.encodeToString(
                            fileData.getBinaryContent(), 
                            android.util.Base64.NO_WRAP
                        );
                    }
                    final String localContent = localContentTemp; // Make final for lambda
                    
                    // Get GitHub content for diff
                    GitHubCacheManager cacheManager = GitHubCacheManager.getInstance(requireContext());
                    String owner = selectedRepo.owner;
                    String repoName = selectedRepo.name;
                    
                    if (cacheManager.fileExists(owner, repoName, content.path)) {
                        cacheManager.getFile(owner, repoName, content.path, new GitHubCacheManager.CacheCallback<String>() {
                            @Override
                            public void onSuccess(String githubContentStr) {
                                requireActivity().runOnUiThread(() -> {
                                    showSyncPreviewDialog(
                                        "Local →",
                                        "GitHub",
                                        localContent,
                                        githubContentStr,
                                        false, // Local to GitHub
                                        () -> showCommitDialogForSync(content, localContent),
                                        content.name
                                    );
                                });
                            }
                            
                            @Override
                            public void onError(String message) {
                                // If can't load GitHub content, still show dialog with empty diff
                                requireActivity().runOnUiThread(() -> {
                                    showSyncPreviewDialog(
                                        "Local →",
                                        "GitHub",
                                        localContent,
                                        "",
                                        false,
                                        () -> showCommitDialogForSync(content, localContent),
                                        content.name
                                    );
                                });
                            }
                        });
                    } else {
                        // No GitHub content, show dialog with empty diff
                        showSyncPreviewDialog(
                            "Local →",
                            "GitHub",
                            localContent,
                            "",
                            false,
                            () -> showCommitDialogForSync(content, localContent),
                            content.name
                        );
                    }
                });
            }
            
            @Override
            public void onError(String message) {
                requireActivity().runOnUiThread(() -> {
                    showToast("Failed to load local file: " + message);
                });
            }
        });
    }
    
    private void showSyncPreviewDialog(String sourceLabel, String destLabel, String sourceContent, 
                                       String destContent, boolean isGitHubToLocal, Runnable onConfirm, String fileName) {
        GitHubDiffUtil.DiffResult diff = GitHubDiffUtil.calculateDiff(destContent, sourceContent);
        boolean isNewFile = (destContent == null || destContent.isEmpty()) && (sourceContent != null && !sourceContent.isEmpty());
        
        View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_file_sync_preview, null);
        TextView sourceLabelView = dialogView.findViewById(R.id.source_label);
        TextView destLabelView = dialogView.findViewById(R.id.destination_label);
        TextView sourceFilenameView = dialogView.findViewById(R.id.source_filename);
        TextView destFilenameView = dialogView.findViewById(R.id.destination_filename);
        TextView arrowIcon = dialogView.findViewById(R.id.arrow_icon);
        TextView diffSummary = dialogView.findViewById(R.id.diff_summary);
        TextView diffPreview = dialogView.findViewById(R.id.diff_preview);
        
        sourceLabelView.setText(sourceLabel);
        destLabelView.setText(destLabel);
        sourceFilenameView.setText(fileName);
        destFilenameView.setText(fileName);
        
        // Hide the separate arrow icon since arrow is now in the source label
        arrowIcon.setVisibility(android.view.View.GONE);
        
        // Set diff summary
        String summary;
        if (isNewFile) {
            summary = "Adding new file (" + diff.linesAdded + " lines)";
        } else {
            summary = GitHubDiffUtil.getDiffSummary(diff);
        }
        diffSummary.setText(summary);
        
        // Set diff preview
        if (diff.previewLines.isEmpty() && !isNewFile) {
            diffPreview.setText("(No changes - files are identical)");
        } else {
            StringBuilder preview = new StringBuilder();
            if (isNewFile) {
                preview.append("New file will be created:\n\n");
            }
            for (String line : diff.previewLines) {
                preview.append(line).append("\n");
            }
            String previewText = preview.toString();
            
            // Color code the diff preview with line numbers
            android.text.SpannableString spannable = new android.text.SpannableString(previewText);
            String[] lines = previewText.split("\n", -1);
            int offset = 0;
            for (String line : lines) {
                if (line.trim().isEmpty()) {
                    offset += line.length() + 1;
                    continue;
                }
                
                // Format: "   4 + content" or "   5 - content" or "   6   content"
                // Check for line number prefix (4 digits + space + prefix)
                if (line.length() > 5) {
                    char prefixChar = line.charAt(5); // Character after "   4 " (position 5)
                    int lineStart = offset;
                    int lineEnd = offset + line.length();
                    
                    if (prefixChar == '+') {
                        // Added line - green
                        spannable.setSpan(new android.text.style.ForegroundColorSpan(0xFF4CAF50), 
                            lineStart, lineEnd, android.text.Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
                    } else if (prefixChar == '-') {
                        // Removed line - red
                        spannable.setSpan(new android.text.style.ForegroundColorSpan(0xFFF44336), 
                            lineStart, lineEnd, android.text.Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
                    } else if (prefixChar == ' ') {
                        // Context line - white
                        spannable.setSpan(new android.text.style.ForegroundColorSpan(0xFFFFFFFF), 
                            lineStart, lineEnd, android.text.Spannable.SPAN_EXCLUSIVE_EXCLUSIVE);
                    }
                }
                offset += line.length() + 1; // +1 for newline
            }
            diffPreview.setText(spannable);
        }
        
        new AlertDialog.Builder(requireContext())
            .setTitle("Sync Preview")
            .setView(dialogView)
            .setPositiveButton("Confirm", (dialog, which) -> {
                onConfirm.run();
            })
            .setNegativeButton("Cancel", null)
            .show();
    }
    
    private void showCommitDialogForSync(GitHubApiClient.GitHubContent content, String localContent) {
        View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_commit_message, null);
        EditText messageInput = dialogView.findViewById(R.id.commit_message_input);
        messageInput.setText("Update " + content.name + " from local scripts");
        
        new AlertDialog.Builder(requireContext())
            .setTitle("Commit Changes")
            .setView(dialogView)
            .setPositiveButton("Commit", (dialog, which) -> {
                String message = messageInput.getText().toString().trim();
                if (message.isEmpty()) {
                    showToast("Commit message cannot be empty");
                    return;
                }
                commitLocalToGitHub(content, localContent, message);
            })
            .setNegativeButton("Cancel", null)
            .show();
    }
    
    private void commitLocalToGitHub(GitHubApiClient.GitHubContent content, String localContent, String commitMessage) {
        // Encode content to base64
        String encodedContent = android.util.Base64.encodeToString(
            localContent.getBytes(java.nio.charset.StandardCharsets.UTF_8),
            android.util.Base64.NO_WRAP
        );
        
        showToast("Committing to GitHub...");
        apiClient.updateFile(selectedRepo.owner, selectedRepo.name, content.path,
            commitMessage, encodedContent, content.sha,
            new GitHubApiClient.ApiCallback<GitHubApiClient.GitHubCommit>() {
                @Override
                public void onSuccess(GitHubApiClient.GitHubCommit result) {
                    requireActivity().runOnUiThread(() -> {
                        // Update cache
                        GitHubCacheManager cacheManager = GitHubCacheManager.getInstance(requireContext());
                        cacheManager.saveFile(selectedRepo.owner, selectedRepo.name, content.path,
                            localContent, new GitHubCacheManager.CacheCallback<Void>() {
                                @Override
                                public void onSuccess(Void v) {
                                    requireActivity().runOnUiThread(() -> {
                                        showToast("File updated on GitHub");
                                        navigateToPath(currentPath);
                                    });
                                }
                                
                                @Override
                                public void onError(String message) {
                                    Log.w(TAG, "Failed to update cache: " + message);
                                    requireActivity().runOnUiThread(() -> {
                                        showToast("File updated on GitHub (cache update failed)");
                                        navigateToPath(currentPath);
                                    });
                                }
                            });
                    });
                }
                
                @Override
                public void onError(String error) {
                    requireActivity().runOnUiThread(() -> {
                        showToast("Failed to commit: " + error);
                    });
                }
            });
    }
    
    private void loadFileFromApiForSync(GitHubApiClient.GitHubContent content, GitHubCacheManager.CacheCallback<String> callback) {
        apiClient.getFileContent(selectedRepo.owner, selectedRepo.name, content.path,
            new GitHubApiClient.ApiCallback<String>() {
                @Override
                public void onSuccess(String result) {
                    // Cache the file
                    GitHubCacheManager cacheManager = GitHubCacheManager.getInstance(requireContext());
                    cacheManager.saveFile(selectedRepo.owner, selectedRepo.name, content.path, 
                        result, new GitHubCacheManager.CacheCallback<Void>() {
                            @Override
                            public void onSuccess(Void v) {
                                callback.onSuccess(result);
                            }
                            
                            @Override
                            public void onError(String message) {
                                Log.w(TAG, "Failed to cache file: " + message);
                                callback.onSuccess(result);
                            }
                        });
                }
                
                @Override
                public void onError(String message) {
                    callback.onError(message);
                }
            });
    }
    
    private void editFile(GitHubApiClient.GitHubContent content) {
        if (apiClient == null || selectedRepo == null) return;
        
        currentFile = content;
        showToast("Loading file...");
        
        // Try to get from cache first
        GitHubCacheManager cacheManager = GitHubCacheManager.getInstance(requireContext());
        String owner = selectedRepo.owner;
        String repoName = selectedRepo.name;
        
        GitHubCacheManager.CacheCallback<String> onContentLoaded = new GitHubCacheManager.CacheCallback<String>() {
            @Override
            public void onSuccess(String result) {
                requireActivity().runOnUiThread(() -> {
                    currentFileContent = result != null ? result : "";
                    currentFileSha = content.sha;
                    showEditDialog();
                });
            }
            
            @Override
            public void onError(String message) {
                // Fallback to API
                loadFileFromApiForEdit(content);
            }
        };
        
        if (cacheManager.fileExists(owner, repoName, content.path)) {
            cacheManager.getFile(owner, repoName, content.path, onContentLoaded);
        } else {
            // Load from API and cache it
            loadFileFromApiForEdit(content);
        }
    }
    
    private void loadFileFromApiForEdit(GitHubApiClient.GitHubContent content) {
        apiClient.getFileContent(selectedRepo.owner, selectedRepo.name, content.path,
            new GitHubApiClient.ApiCallback<String>() {
                @Override
                public void onSuccess(String result) {
                    requireActivity().runOnUiThread(() -> {
                        currentFileContent = result != null ? result : "";
                        currentFileSha = content.sha;
                        
                        // Cache the file
                        GitHubCacheManager cacheManager = GitHubCacheManager.getInstance(requireContext());
                        cacheManager.saveFile(selectedRepo.owner, selectedRepo.name, content.path, 
                            currentFileContent, new GitHubCacheManager.CacheCallback<Void>() {
                                @Override
                                public void onSuccess(Void v) {}
                                @Override
                                public void onError(String message) {
                                    Log.w(TAG, "Failed to cache file: " + message);
                                }
                            });
                        
                        showEditDialog();
                    });
                }
                
                @Override
                public void onError(String message) {
                    requireActivity().runOnUiThread(() -> {
                        showToast("Failed to load file: " + message);
                    });
                }
            });
    }
    
    private void showEditDialog() {
        View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_edit_file, null);
        EditText contentInput = dialogView.findViewById(R.id.file_content_input);
        contentInput.setText(currentFileContent);
        
        // Select all text for easy editing
        contentInput.selectAll();
        
        new AlertDialog.Builder(requireContext())
            .setTitle("Edit: " + currentFile.name)
            .setView(dialogView)
            .setPositiveButton("Save", (dialog, which) -> {
                String newContent = contentInput.getText().toString();
                currentFileContent = newContent;
                commitChanges("Update " + currentFile.name);
            })
            .setNegativeButton("Cancel", null)
            .show();
    }
    
    private void commitChanges(String defaultMessage) {
        if (apiClient == null || selectedRepo == null || currentFile == null) {
            return;
        }
        
        // Show commit message dialog
        View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_commit_message, null);
        EditText messageInput = dialogView.findViewById(R.id.commit_message_input);
        messageInput.setText(defaultMessage);
        
        new AlertDialog.Builder(requireContext())
            .setTitle("Commit Changes")
            .setView(dialogView)
            .setPositiveButton("Commit", (dialog, which) -> {
                String message = messageInput.getText().toString().trim();
                if (message.isEmpty()) {
                    showToast("Commit message cannot be empty");
                    return;
                }
                performCommit(message);
            })
            .setNegativeButton("Cancel", null)
            .show();
    }
    
    private void loadFileFromApi(GitHubApiClient.GitHubContent content) {
        apiClient.getFileContent(selectedRepo.owner, selectedRepo.name, content.path,
            new GitHubApiClient.ApiCallback<String>() {
                @Override
                public void onSuccess(String result) {
                    requireActivity().runOnUiThread(() -> {
                        currentFileContent = result != null ? result : "";
                        currentFileSha = content.sha;
                        
                        // Cache the file
                        GitHubCacheManager cacheManager = GitHubCacheManager.getInstance(requireContext());
                        cacheManager.saveFile(selectedRepo.owner, selectedRepo.name, content.path, 
                            currentFileContent, new GitHubCacheManager.CacheCallback<Void>() {
                                @Override
                                public void onSuccess(Void v) {}
                                @Override
                                public void onError(String message) {
                                    Log.w(TAG, "Failed to cache file: " + message);
                                }
                            });
                        
                        showEditDialog();
                    });
                }
                
                @Override
                public void onError(String message) {
                    requireActivity().runOnUiThread(() -> {
                        showToast("Failed to load file: " + message);
                    });
                }
            });
    }
    
    private void openFile(GitHubApiClient.GitHubContent content) {
        // Deprecated - use editFile instead
        editFile(content);
    }
    
    
    private void performCommit(String message) {
        if (apiClient == null || selectedRepo == null || currentFile == null) {
            return;
        }
        
        // Encode content to base64
        String encodedContent = android.util.Base64.encodeToString(
            currentFileContent.getBytes(java.nio.charset.StandardCharsets.UTF_8),
            android.util.Base64.NO_WRAP
        );
        
        showToast("Committing changes...");
        apiClient.updateFile(selectedRepo.owner, selectedRepo.name, currentFile.path,
            message, encodedContent, currentFileSha,
            new GitHubApiClient.ApiCallback<GitHubApiClient.GitHubCommit>() {
                @Override
                public void onSuccess(GitHubApiClient.GitHubCommit result) {
                    requireActivity().runOnUiThread(() -> {
                        // Update cache
                        GitHubCacheManager cacheManager = GitHubCacheManager.getInstance(requireContext());
                        cacheManager.saveFile(selectedRepo.owner, selectedRepo.name, currentFile.path,
                            currentFileContent, new GitHubCacheManager.CacheCallback<Void>() {
                                @Override
                                public void onSuccess(Void v) {
                                    requireActivity().runOnUiThread(() -> {
                                        showToast("Changes committed successfully");
                                        // Refresh file tree to get updated SHA
                                        navigateToPath(currentPath);
                                    });
                                }
                                
                                @Override
                                public void onError(String message) {
                                    Log.w(TAG, "Failed to update cache: " + message);
                                    requireActivity().runOnUiThread(() -> {
                                        showToast("Changes committed (cache update failed)");
                                        navigateToPath(currentPath);
                                    });
                                }
                            });
                    });
                }
                
                @Override
                public void onError(String error) {
                    requireActivity().runOnUiThread(() -> {
                        showToast("Failed to commit: " + error);
                    });
                }
            });
    }
    
    private void syncRepository() {
        if (apiClient == null || selectedRepo == null) return;
        
        showToast("Syncing repository...");
        GitHubCacheManager cacheManager = GitHubCacheManager.getInstance(requireContext());
        
        // Clear cache first
        cacheManager.clearCache(selectedRepo.owner, selectedRepo.name, new GitHubCacheManager.CacheCallback<Void>() {
            @Override
            public void onSuccess(Void v) {
                // Recursively download all files
                syncRepositoryRecursive(selectedRepo.owner, selectedRepo.name, "");
            }
            
            @Override
            public void onError(String message) {
                requireActivity().runOnUiThread(() -> {
                    showToast("Failed to clear cache: " + message);
                });
            }
        });
    }
    
    private void syncRepositoryRecursive(String owner, String repoName, String path) {
        apiClient.getContents(owner, repoName, path, new GitHubApiClient.ApiCallback<List<GitHubApiClient.GitHubContent>>() {
            @Override
            public void onSuccess(List<GitHubApiClient.GitHubContent> contents) {
                if (contents == null || contents.isEmpty()) {
                    // Check if this is the root sync completion
                    if (path.isEmpty()) {
                        requireActivity().runOnUiThread(() -> {
                            showToast("Repository synced");
                            navigateToPath(currentPath);
                        });
                    }
                    return;
                }
                
                syncContentsRecursive(owner, repoName, contents, 0, path.isEmpty());
            }
            
            @Override
            public void onError(String message) {
                requireActivity().runOnUiThread(() -> {
                    showToast("Failed to sync: " + message);
                });
            }
        });
    }
    
    private void syncContentsRecursive(String owner, String repoName, List<GitHubApiClient.GitHubContent> contents, int index, boolean isRoot) {
        if (index >= contents.size()) {
            if (isRoot) {
                requireActivity().runOnUiThread(() -> {
                    showToast("Repository synced");
                    navigateToPath(currentPath);
                });
            }
            return;
        }
        
        GitHubApiClient.GitHubContent content = contents.get(index);
        GitHubCacheManager cacheManager = GitHubCacheManager.getInstance(requireContext());
        
        if ("dir".equals(content.type)) {
            // Recursively sync directory first, then continue with next item
            syncRepositoryRecursive(owner, repoName, content.path);
            syncContentsRecursive(owner, repoName, contents, index + 1, isRoot);
        } else {
            // Download file
            apiClient.getFileContent(owner, repoName, content.path, new GitHubApiClient.ApiCallback<String>() {
                @Override
                public void onSuccess(String fileContent) {
                    cacheManager.saveFile(owner, repoName, content.path, fileContent, 
                        new GitHubCacheManager.CacheCallback<Void>() {
                            @Override
                            public void onSuccess(Void v) {
                                syncContentsRecursive(owner, repoName, contents, index + 1, isRoot);
                            }
                            
                            @Override
                            public void onError(String message) {
                                Log.w(TAG, "Failed to cache file " + content.path + ": " + message);
                                syncContentsRecursive(owner, repoName, contents, index + 1, isRoot);
                            }
                        });
                }
                
                @Override
                public void onError(String message) {
                    Log.w(TAG, "Failed to download file " + content.path + ": " + message);
                    syncContentsRecursive(owner, repoName, contents, index + 1, isRoot);
                }
            });
        }
    }
    
    private void logout() {
        tokenStorage.clear();
        selectedRepo = null;
        currentPath = "";
        currentFile = null;
        repositories.clear();
        fileTree.clear();
        repoAdapter.notifyDataSetChanged();
        fileTreeAdapter.notifyDataSetChanged();
        checkAuthState();
        showToast("Logged out");
    }
    
    private void updateStatusBar() {
        String username = tokenStorage.getUsername();
        String statusText = "";
        
        if (!TextUtils.isEmpty(username)) {
            if (tokenStorage.hasSelectedRepo()) {
                String repoName = tokenStorage.getSelectedRepoName();
                statusText = username + "/" + repoName;
            } else {
                statusText = username;
            }
        }
        
        Utils.updateActionBarStatus(this, statusText);
    }
    
    private void showPatDialog() {
        EditText patInput = new EditText(requireContext());
        patInput.setHint("Enter Personal Access Token");
        patInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        patInput.setPadding(50, 20, 50, 20);
        
        // Pre-fill if PAT exists (show masked)
        String existingPat = tokenStorage.getPat();
        boolean hasExistingPat = !TextUtils.isEmpty(existingPat);
        if (hasExistingPat) {
            patInput.setHint("PAT is set (enter new one to replace)");
        }
        
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext())
            .setTitle("Personal Access Token")
            .setMessage("For private repository access, enter a GitHub Personal Access Token.\n\n" +
                       "OAuth grants access to public repos only. PATs can be scoped to specific repos.\n\n" +
                       "Create one at: https://github.com/settings/tokens")
            .setView(patInput)
            .setPositiveButton("Save", (dialog, which) -> {
                String pat = patInput.getText().toString().trim();
                if (!pat.isEmpty()) {
                    savePat(pat);
                }
            });
        
        if (hasExistingPat) {
            builder.setNeutralButton("Clear", (dialog, which) -> {
                clearPat();
            });
        }
        
        builder.setNegativeButton("Cancel", null);
        builder.show();
    }
    
    private void savePat(String pat) {
        tokenStorage.savePat(pat);
        // Reinitialize API client with new token
        String activeToken = tokenStorage.getActiveToken();
        apiClient = new GitHubApiClient(activeToken);
        showToast("PAT saved. Using PAT for API calls.");
        // Refresh to verify token works
        refreshRepositories();
    }
    
    private void clearPat() {
        tokenStorage.clearPat();
        // Reinitialize API client with OAuth token
        String activeToken = tokenStorage.getActiveToken();
        if (!TextUtils.isEmpty(activeToken)) {
            apiClient = new GitHubApiClient(activeToken);
            showToast("PAT cleared. Using OAuth token.");
            refreshRepositories();
        } else {
            showToast("PAT cleared.");
        }
    }
    
    private void showRepositorySelectionDialog() {
        if (apiClient == null) return;
        
        // Fetch repositories first
        apiClient.listRepositories(new GitHubApiClient.ApiCallback<List<GitHubApiClient.GitHubRepository>>() {
            @Override
            public void onSuccess(List<GitHubApiClient.GitHubRepository> result) {
                requireActivity().runOnUiThread(() -> {
                    repositories.clear();
                    if (result != null) {
                        repositories.addAll(result);
                    }
                    showRepositorySelectionDialogInternal();
                });
            }
            
            @Override
            public void onError(String message) {
                requireActivity().runOnUiThread(() -> {
                    showToast("Failed to load repositories: " + message);
                });
            }
        });
    }
    
    private void showRepositorySelectionDialogInternal() {
        View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_repo_selection, null);
        ListView repoListView = dialogView.findViewById(R.id.repo_list_view);
        View createButton = dialogView.findViewById(R.id.create_repo_button);
        
        ArrayAdapter<GitHubApiClient.GitHubRepository> adapter = new ArrayAdapter<GitHubApiClient.GitHubRepository>(
            requireContext(),
            android.R.layout.simple_list_item_1,
            repositories
        ) {
            @NonNull
            @Override
            public View getView(int position, @Nullable View convertView, @NonNull ViewGroup parent) {
                View view = super.getView(position, convertView, parent);
                TextView textView = (TextView) view.findViewById(android.R.id.text1);
                GitHubApiClient.GitHubRepository repo = getItem(position);
                if (repo != null) {
                    textView.setText(repo.name + (repo.isPrivate ? " (private)" : ""));
                }
                return view;
            }
        };
        repoListView.setAdapter(adapter);
        
        AlertDialog dialog = new AlertDialog.Builder(requireContext())
            .setTitle("Select Repository")
            .setView(dialogView)
            .setCancelable(false)
            .create();
        
        repoListView.setOnItemClickListener((parent, view, position, id) -> {
            if (position >= 0 && position < repositories.size()) {
                GitHubApiClient.GitHubRepository repo = repositories.get(position);
                selectRepositoryForUse(repo);
                dialog.dismiss();
            }
        });
        
        createButton.setOnClickListener(v -> {
            dialog.dismiss();
            showCreateRepositoryDialog();
        });
        
        dialog.show();
    }
    
    private void showCreateRepositoryDialog() {
        View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_create_repo, null);
        EditText nameInput = dialogView.findViewById(R.id.repo_name_input);
        EditText descriptionInput = dialogView.findViewById(R.id.repo_description_input);
        android.widget.CheckBox privateCheckbox = dialogView.findViewById(R.id.repo_private_checkbox);
        
        new AlertDialog.Builder(requireContext())
            .setTitle("Create Repository")
            .setView(dialogView)
            .setPositiveButton("Create", (dialog, which) -> {
                String name = nameInput.getText().toString().trim();
                String description = descriptionInput.getText().toString().trim();
                boolean isPrivate = privateCheckbox.isChecked();
                
                if (name.isEmpty()) {
                    showToast("Repository name cannot be empty");
                    return;
                }
                
                createRepository(name, description, isPrivate);
            })
            .setNegativeButton("Cancel", null)
            .show();
    }
    
    private void createRepository(String name, String description, boolean isPrivate) {
        if (apiClient == null) return;
        
        showToast("Creating repository...");
        apiClient.createRepository(name, description, isPrivate, new GitHubApiClient.ApiCallback<GitHubApiClient.GitHubRepository>() {
            @Override
            public void onSuccess(GitHubApiClient.GitHubRepository result) {
                requireActivity().runOnUiThread(() -> {
                    showToast("Repository created! Committing files...");
                    commitAllLocalFiles(result);
                });
            }
            
            @Override
            public void onError(String message) {
                requireActivity().runOnUiThread(() -> {
                    showToast("Failed to create repository: " + message);
                });
            }
        });
    }
    
    private void commitAllLocalFiles(GitHubApiClient.GitHubRepository repo) {
        FileRepositoryLocal localRepo = FileRepositoryLocal.getInstance(requireContext());
        String username = tokenStorage.getUsername();
        if (username == null) {
            showToast("Username not available");
            return;
        }
        
        // Get all local files
        localRepo.listFilesWithContent(null, new RepositoryCallback<List<UserFileData>>() {
            @Override
            public void onSuccess(List<UserFileData> files) {
                if (files == null || files.isEmpty()) {
                    requireActivity().runOnUiThread(() -> {
                        selectRepositoryForUse(repo);
                        showToast("Repository created (no files to commit)");
                    });
                    return;
                }
                
                commitFilesSequentially(repo, username, files, 0);
            }
            
            @Override
            public void onError(String message) {
                requireActivity().runOnUiThread(() -> {
                    showToast("Failed to load local files: " + message);
                    selectRepositoryForUse(repo);
                });
            }
        });
    }
    
    private void commitFilesSequentially(GitHubApiClient.GitHubRepository repo, String owner, 
                                         List<UserFileData> files, int index) {
        if (index >= files.size()) {
            requireActivity().runOnUiThread(() -> {
                selectRepositoryForUse(repo);
                showToast("Repository created with " + files.size() + " files");
            });
            return;
        }
        
        UserFileData fileData = files.get(index);
        String fileName = fileData.getMetadata().getName();
        String content;
        
        if (fileData.hasTextContent()) {
            content = fileData.getTextContent();
        } else if (fileData.hasBinaryContent()) {
            // Encode binary content to base64
            content = android.util.Base64.encodeToString(fileData.getBinaryContent(), android.util.Base64.NO_WRAP);
        } else {
            content = "";
        }
        
        // Encode content for GitHub API
        String encodedContent = android.util.Base64.encodeToString(
            content.getBytes(java.nio.charset.StandardCharsets.UTF_8),
            android.util.Base64.NO_WRAP
        );
        
        String commitMessage = index == 0 
            ? "Initial commit: EMWaver scripts and signals" 
            : "Add " + fileName;
        
        apiClient.createFile(owner, repo.name, fileName, commitMessage, encodedContent, 
            new GitHubApiClient.ApiCallback<GitHubApiClient.GitHubCommit>() {
                @Override
                public void onSuccess(GitHubApiClient.GitHubCommit result) {
                    commitFilesSequentially(repo, owner, files, index + 1);
                }
                
                @Override
                public void onError(String message) {
                    requireActivity().runOnUiThread(() -> {
                        showToast("Failed to commit " + fileName + ": " + message);
                        // Continue with next file anyway
                        commitFilesSequentially(repo, owner, files, index + 1);
                    });
                }
            });
    }
    
    private void selectRepositoryForUse(GitHubApiClient.GitHubRepository repo) {
        selectedRepo = repo;
        tokenStorage.saveSelectedRepo(repo.owner, repo.name);
        currentPath = "";
        updateStatusBar(); // Update status bar to show username/repo_name
        // Sync repository on selection
        syncRepository();
    }
    
    private void loadRepositoryContents() {
        if (selectedRepo == null || apiClient == null) return;
        navigateToPath("");
    }
    
    private void showToast(String message) {
        if (!isAdded()) return;
        Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show();
    }
    
    private static class FileTreeItem {
        final String displayName;
        final GitHubApiClient.GitHubContent content;
        
        FileTreeItem(String displayName, GitHubApiClient.GitHubContent content) {
            this.displayName = displayName;
            this.content = content;
        }
    }
}
