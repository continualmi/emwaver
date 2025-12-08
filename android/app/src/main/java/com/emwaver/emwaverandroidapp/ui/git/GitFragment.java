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
import com.emwaver.emwaverandroidapp.github.GitHubConfig;
import com.emwaver.emwaverandroidapp.github.GitHubOAuth;
import com.emwaver.emwaverandroidapp.github.GitHubTokenStorage;

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
    private boolean isEditing = false;
    
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
                if (isEditing) {
                    cancelEdit();
                } else if (!currentPath.isEmpty()) {
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
                    refreshRepositories();
                    return true;
                } else if (itemId == R.id.action_manage_pat) {
                    showPatDialog();
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
            android.R.layout.simple_list_item_1,
            new ArrayList<>()
        ) {
            @NonNull
            @Override
            public View getView(int position, @Nullable View convertView, @NonNull ViewGroup parent) {
                View view = super.getView(position, convertView, parent);
                TextView textView = (TextView) view.findViewById(android.R.id.text1);
                FileTreeItem item = getItem(position);
                if (item != null) {
                    textView.setText(item.displayName);
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
                } else {
                    openFile(item.content);
                }
            }
        });
        
        // Editor
        binding.fileEditorContent.addTextChangedListener(new android.text.TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            
            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                currentFileContent = s != null ? s.toString() : "";
            }
            
            @Override
            public void afterTextChanged(android.text.Editable s) {}
        });
        
        // Commit button
        binding.commitButton.setOnClickListener(v -> commitChanges());
        binding.cancelEditButton.setOnClickListener(v -> cancelEdit());
    }
    
    private void checkAuthState() {
        if (tokenStorage.isAuthenticated()) {
            showAuthenticatedState();
            // Use active token (PAT if available, otherwise OAuth token)
            String token = tokenStorage.getActiveToken();
            apiClient = new GitHubApiClient(token);
            loadUserInfo();
            refreshRepositories();
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
                        backPressedCallback.setEnabled(!path.isEmpty() || isEditing);
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
    
    private void openFile(GitHubApiClient.GitHubContent content) {
        if (apiClient == null || selectedRepo == null) return;
        
        currentFile = content;
        showToast("Loading file...");
        
        apiClient.getFileContent(selectedRepo.owner, selectedRepo.name, content.path,
            new GitHubApiClient.ApiCallback<String>() {
                @Override
                public void onSuccess(String result) {
                    requireActivity().runOnUiThread(() -> {
                        currentFileContent = result != null ? result : "";
                        currentFileSha = content.sha;
                        showEditor();
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
    
    private void showEditor() {
        isEditing = true;
        binding.fileEditorContainer.setVisibility(View.VISIBLE);
        binding.commitButtonContainer.setVisibility(View.VISIBLE);
        binding.fileEditorContent.setText(currentFileContent);
        backPressedCallback.setEnabled(true);
    }
    
    private void cancelEdit() {
        isEditing = false;
        binding.fileEditorContainer.setVisibility(View.GONE);
        binding.commitButtonContainer.setVisibility(View.GONE);
        currentFile = null;
        currentFileContent = null;
        currentFileSha = null;
        backPressedCallback.setEnabled(!currentPath.isEmpty());
    }
    
    private void commitChanges() {
        if (apiClient == null || selectedRepo == null || currentFile == null) {
            return;
        }
        
        // Show commit message dialog
        View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_commit_message, null);
        EditText messageInput = dialogView.findViewById(R.id.commit_message_input);
        messageInput.setText("Update " + currentFile.name);
        
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
    
    private void performCommit(String message) {
        if (apiClient == null || selectedRepo == null || currentFile == null) {
            return;
        }
        
        // Encode content to base64
        String encodedContent = android.util.Base64.encodeToString(
            currentFileContent.getBytes(),
            android.util.Base64.NO_WRAP
        );
        
        showToast("Committing changes...");
        apiClient.updateFile(selectedRepo.owner, selectedRepo.name, currentFile.path,
            message, encodedContent, currentFileSha,
            new GitHubApiClient.ApiCallback<GitHubApiClient.GitHubCommit>() {
                @Override
                public void onSuccess(GitHubApiClient.GitHubCommit result) {
                    requireActivity().runOnUiThread(() -> {
                        showToast("Changes committed successfully");
                        cancelEdit();
                        // Refresh file tree to get updated SHA
                        navigateToPath(currentPath);
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
        if (!TextUtils.isEmpty(username)) {
            Utils.updateActionBarStatus(this, username);
        } else {
            Utils.updateActionBarStatus(this, "");
        }
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
