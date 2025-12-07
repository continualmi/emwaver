package com.emwaver.emwaverandroidapp.ui.agent;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.TextUtils;
import android.text.method.LinkMovementMethod;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.ArrayAdapter;
import android.widget.ListView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;
import androidx.preference.PreferenceManager;
import androidx.recyclerview.widget.LinearLayoutManager;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.Utils;
import com.emwaver.emwaverandroidapp.databinding.FragmentAgentBinding;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

import io.noties.markwon.Markwon;

public class AgentFragment extends Fragment {

    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");
    private static final String DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
    private static final String DEFAULT_MODEL = "openai/gpt-oss-20b";
    private static final String CONVERSATIONS_DIR = "agent_conversations";
    private static final String CONVERSATIONS_INDEX = "conversations_index.json";
    private static final String PREF_LAST_SELECTED_CONVERSATION = "agent_last_selected_conversation";
    private static final String SYSTEM_PROMPT_TEMPLATE = 
        "You are an AI assistant embedded in the EMWaver application. " +
        "EMWaver is a hardware hacking and security research tool with capabilities for RF analysis, " +
        "infrared control, sub-GHz communication, and signal manipulation. " +
        "Your primary role is to help users create wavelets—modular extensions that add new functionality to EMWaver. " +
        "Wavelets consist of a manifest and JavaScript code that interact with the device's hardware through the EMWaver Script SDK. " +
        "Provide clear, actionable guidance on wavelet development, hardware interaction, and EMWaver features.\n\n";

    private FragmentAgentBinding binding;
    private final List<ConversationSummary> conversations = new ArrayList<>();
    private final List<MessageItem> messages = new ArrayList<>();
    private AgentMessageAdapter messageAdapter;
    private OkHttpClient httpClient;
    private String selectedConversationId;
    private Menu optionsMenu;
    private Markwon markwon;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setHasOptionsMenu(true);
        httpClient = new OkHttpClient();
        markwon = Markwon.builder(requireContext()).build();
        ensureConversationsDirectory();
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        binding = FragmentAgentBinding.inflate(inflater, container, false);
        setupRecycler();
        setupSendActions();
        setupEmptyState();
        loadStoredConversations();
        updateStatusBar();
        updateEmptyStateVisibility();
        return binding.getRoot();
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null;
        optionsMenu = null;
    }

    @Override
    public void onResume() {
        super.onResume();
        updateStatusBar();
        updateEmptyStateVisibility();
    }

    @Override
    public void onPause() {
        super.onPause();
        Utils.updateActionBarStatus(this, "");
    }

	@Override
	public void onCreateOptionsMenu(@NonNull Menu menu, @NonNull MenuInflater inflater) {
		super.onCreateOptionsMenu(menu, inflater);
		inflater.inflate(R.menu.agent_fragment_menu, menu);
		optionsMenu = menu;
		updateConversationActionButtons();
	}

	@Override
	public void onPrepareOptionsMenu(@NonNull Menu menu) {
		super.onPrepareOptionsMenu(menu);
		optionsMenu = menu;
		updateConversationActionButtons();
	}

	@Override
	public boolean onOptionsItemSelected(@NonNull MenuItem item) {
		int itemId = item.getItemId();
		if (itemId == R.id.action_new_chat) {
			promptForConversationTopic();
			return true;
		} else if (itemId == R.id.action_chats) {
			showChatsDialog();
			return true;
		} else if (itemId == R.id.action_agent_settings) {
			showAgentSettingsDialog();
			return true;
		} else if (itemId == R.id.action_rename_conversation) {
			promptRenameConversation();
			return true;
		} else if (itemId == R.id.action_delete_conversation) {
			confirmDeleteConversation();
			return true;
		}
		return super.onOptionsItemSelected(item);
	}

    private void updateStatusBar() {
        if (TextUtils.isEmpty(selectedConversationId)) {
            Utils.updateActionBarStatus(this, "No chat selected");
        } else {
            int index = findConversationIndex(selectedConversationId);
            if (index >= 0 && index < conversations.size()) {
                Utils.updateActionBarStatus(this, conversations.get(index).title);
            } else {
                Utils.updateActionBarStatus(this, "No chat selected");
            }
        }
    }

    private void showChatsDialog() {
        View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_chats, null);
        ListView chatsList = dialogView.findViewById(R.id.chats_list);
        com.google.android.material.button.MaterialButton newChatButton = dialogView.findViewById(R.id.new_chat_button);

        List<String> chatTitles = new ArrayList<>();
        for (ConversationSummary summary : conversations) {
            chatTitles.add(summary.title);
        }

        ArrayAdapter<String> adapter = new ArrayAdapter<>(requireContext(),
                android.R.layout.simple_list_item_1, chatTitles);
        chatsList.setAdapter(adapter);

        AlertDialog dialog = new AlertDialog.Builder(requireContext())
                .setView(dialogView)
                .create();

        chatsList.setOnItemClickListener((parent, view, position, id) -> {
            if (position < conversations.size()) {
                ConversationSummary summary = conversations.get(position);
                selectConversation(summary.id);
                dialog.dismiss();
            }
        });

        newChatButton.setOnClickListener(v -> {
            dialog.dismiss();
            promptForConversationTopic();
        });

        dialog.show();
    }

    private void setupRecycler() {
        messageAdapter = new AgentMessageAdapter(messages, markwon);
        binding.messageList.setLayoutManager(new LinearLayoutManager(requireContext()));
        binding.messageList.setAdapter(messageAdapter);
    }

    private void setupSendActions() {
        binding.messageInput.setOnEditorActionListener((TextView v, int actionId, KeyEvent event) -> {
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                sendCurrentMessage();
                return true;
            }
            return false;
        });

        binding.sendButton.setOnClickListener(v -> sendCurrentMessage());
    }

    private void setupEmptyState() {
        binding.emptyStateNewChatButton.setOnClickListener(v -> promptForConversationTopic());
    }

    private void sendCurrentMessage() {
        final String message = binding.messageInput.getText().toString().trim();
        if (message.isEmpty()) {
            return;
        }
        hideKeyboard();
        binding.messageInput.setText("");

        if (TextUtils.isEmpty(selectedConversationId)) {
            createConversationWithInitialMessage(message);
        } else {
            appendLocalMessage(new MessageItem("user", message));
            sendMessageToConversation(selectedConversationId, message);
        }
    }

    private void hideKeyboard() {
        View view = requireActivity().getCurrentFocus();
        if (view != null) {
            view.clearFocus();
        }
    }

    private void promptForConversationTopic() {
        final EditTextDialogBuilder builder = new EditTextDialogBuilder(requireContext())
                .setTitle("New Conversation")
                .setHint("Topic (optional)")
                .setInitialText("New Chat");

        builder.setPositiveButton("Create", (dialog, which, text) -> createConversation(text));
        builder.setNegativeButton("Cancel", null);
        builder.show();
    }

    private void promptRenameConversation() {
        if (TextUtils.isEmpty(selectedConversationId)) {
            showToast("Select a conversation first");
            return;
        }
        int index = findConversationIndex(selectedConversationId);
        if (index < 0 || index >= conversations.size()) {
            showToast("Conversation not available");
            return;
        }
        ConversationSummary summary = conversations.get(index);
        final EditTextDialogBuilder builder = new EditTextDialogBuilder(requireContext())
                .setTitle("Rename Conversation")
                .setHint("Conversation title")
                .setInitialText(summary.title);
        builder.setPositiveButton("Rename", (dialog, which, text) -> {
            String desiredTitle = TextUtils.isEmpty(text) ? summary.title : text;
            renameConversation(selectedConversationId, desiredTitle);
        });
        builder.setNegativeButton("Cancel", null);
        builder.show();
    }

    private void renameConversation(String conversationId, String newTitle) {
        final String sanitizedTitle;
        if (TextUtils.isEmpty(newTitle)) {
            sanitizedTitle = "Agent Chat";
        } else {
            String trimmed = newTitle.trim();
            sanitizedTitle = TextUtils.isEmpty(trimmed) ? "Agent Chat" : trimmed;
        }

        int index = findConversationIndex(conversationId);
        if (index < 0) {
            showToast("Conversation not found");
            return;
        }

        ConversationSummary oldSummary = conversations.get(index);
        ConversationSummary newSummary = new ConversationSummary(
            conversationId, 
            sanitizedTitle, 
            System.currentTimeMillis()
        );
        
        conversations.set(index, newSummary);
        persistConversationIndex();
        updateStatusBar();
        updateConversationActionButtons();
        updateEmptyStateVisibility();
        showToast("Conversation renamed");
    }

    private void confirmDeleteConversation() {
        if (TextUtils.isEmpty(selectedConversationId)) {
            showToast("Select a conversation first");
            return;
        }
        int index = findConversationIndex(selectedConversationId);
        if (index < 0 || index >= conversations.size()) {
            showToast("Conversation not available");
            return;
        }
        ConversationSummary summary = conversations.get(index);
        new AlertDialog.Builder(requireContext())
                .setTitle("Delete Conversation")
                .setMessage("Delete \"" + summary.title + "\"? This cannot be undone.")
                .setPositiveButton("Delete", (dialog, which) -> deleteConversation(summary.id))
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void deleteConversation(String conversationId) {
        File conversationFile = new File(getConversationsDir(), conversationId + ".json");
        if (conversationFile.exists()) {
            conversationFile.delete();
        }
        
        handleConversationDeleted(conversationId);
        showToast("Conversation deleted");
    }

    private void createConversation(String topic) {
        String conversationId = UUID.randomUUID().toString();
        String title = TextUtils.isEmpty(topic) ? "New Chat" : topic;
        ConversationSummary summary = new ConversationSummary(conversationId, title, System.currentTimeMillis());
        
        conversations.add(summary);
        sortConversationsByRecency();
        persistConversationIndex();
        saveConversationMessages(conversationId, new ArrayList<>());
        
        selectConversation(conversationId);
    }

    private void createConversationWithInitialMessage(String message) {
        String conversationId = UUID.randomUUID().toString();
        String title = "New Chat";
        ConversationSummary summary = new ConversationSummary(conversationId, title, System.currentTimeMillis());
        
        conversations.add(summary);
        sortConversationsByRecency();
        persistConversationIndex();
        saveConversationMessages(conversationId, new ArrayList<>());
        
        selectConversation(conversationId);
        
        appendLocalMessage(new MessageItem("user", message));
        sendMessageToConversation(conversationId, message);
    }

    private void sendMessageToConversation(String conversationId, String message) {
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
        String baseUrl = prefs.getString("agent_base_url", DEFAULT_BASE_URL);
        String apiKey = prefs.getString("agent_api_key", "");
        String model = prefs.getString("agent_model", DEFAULT_MODEL);
        String customInstructions = prefs.getString("agent_instructions", "");

        if (TextUtils.isEmpty(baseUrl)) {
            baseUrl = DEFAULT_BASE_URL;
        }
        if (baseUrl.endsWith("/")) {
            baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        }

        if (TextUtils.isEmpty(apiKey)) {
            showToast("Please set your API key in Agent Settings");
            return;
        }

        String systemPrompt = SYSTEM_PROMPT_TEMPLATE;
        if (!TextUtils.isEmpty(customInstructions)) {
            systemPrompt += "User Instructions:\n" + customInstructions;
        }

        List<MessageItem> conversationHistory = loadConversationMessages(conversationId);
        
        JSONObject body = new JSONObject();
        try {
            body.put("model", model);
            body.put("stream", true);
            
            JSONArray messagesArray = new JSONArray();
            
            JSONObject systemMessage = new JSONObject();
            systemMessage.put("role", "system");
            systemMessage.put("content", systemPrompt);
            messagesArray.put(systemMessage);
            
            for (MessageItem item : conversationHistory) {
                JSONObject msg = new JSONObject();
                msg.put("role", item.role);
                msg.put("content", item.getContent());
                messagesArray.put(msg);
            }
            
            JSONObject userMessage = new JSONObject();
            userMessage.put("role", "user");
            userMessage.put("content", message);
            messagesArray.put(userMessage);
            
            body.put("messages", messagesArray);
        } catch (JSONException e) {
            showToast("Failed to build request");
            return;
        }

        Request request = new Request.Builder()
                .url(baseUrl + "/chat/completions")
                .addHeader("Authorization", "Bearer " + apiKey)
                .addHeader("Content-Type", "application/json")
                .addHeader("HTTP-Referer", "https://emwaver.com")
                .addHeader("X-Title", "EMWaver Agent")
                .post(RequestBody.create(body.toString(), JSON_MEDIA_TYPE))
                .build();

        if (binding != null) {
            binding.sendButton.setEnabled(false);
        }

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                runOnUiThread(() -> {
                    if (binding != null) {
                        binding.sendButton.setEnabled(true);
                    }
                    showToast("Failed to send message: " + e.getMessage());
                });
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) {
                if (!response.isSuccessful()) {
                    String responseBodyText = "";
                    try {
                        ResponseBody body = response.body();
                        if (body != null) {
                            responseBodyText = body.string();
                        }
                    } catch (IOException ignored) {
                    }
                    final String messageText = extractErrorMessage(responseBodyText, response.code());
                    runOnUiThread(() -> {
                        if (binding != null) {
                            binding.sendButton.setEnabled(true);
                        }
                        showToast(messageText);
                    });
                    response.close();
                    return;
                }

                MessageItem assistantMessage = new MessageItem("assistant", "");
                AtomicInteger assistantIndex = new AtomicInteger(-1);
                runOnUiThread(() -> {
                    if (binding != null) {
                        assistantIndex.set(appendLocalMessage(assistantMessage));
                    }
                });

                StringBuilder accumulatedText = new StringBuilder();
                ResponseBody responseBody = response.body();

                try {
                    if (responseBody == null) {
                        runOnUiThread(() -> {
                            if (binding != null) {
                                binding.sendButton.setEnabled(true);
                            }
                            showToast("Empty response body");
                        });
                        return;
                    }
                    
                    BufferedReader reader = new BufferedReader(new InputStreamReader(responseBody.byteStream()));
                    String line;
                    while ((line = reader.readLine()) != null) {
                        if (line.startsWith("data: ")) {
                            String data = line.substring(6);
                            if ("[DONE]".equals(data)) {
                                break;
                            }
                            
                            try {
                                JSONObject json = new JSONObject(data);
                                JSONArray choices = json.optJSONArray("choices");
                                if (choices != null && choices.length() > 0) {
                                    JSONObject choice = choices.getJSONObject(0);
                                    JSONObject delta = choice.optJSONObject("delta");
                                    if (delta != null) {
                                        String content = delta.optString("content", "");
                                        if (!TextUtils.isEmpty(content)) {
                                            accumulatedText.append(content);
                                            final String currentText = accumulatedText.toString();
                                            runOnUiThread(() -> updateMessageContent(assistantMessage, assistantIndex.get(), currentText));
                                        }
                                    }
                                }
                            } catch (JSONException ignored) {
                            }
                        }
                    }
                    
                    List<MessageItem> allMessages = new ArrayList<>(conversationHistory);
                    allMessages.add(new MessageItem("user", message));
                    allMessages.add(new MessageItem("assistant", accumulatedText.toString()));
                    saveConversationMessages(conversationId, allMessages);
                    
                    int convIndex = findConversationIndex(conversationId);
                    if (convIndex >= 0) {
                        ConversationSummary oldSummary = conversations.get(convIndex);
                        ConversationSummary newSummary = new ConversationSummary(
                            conversationId,
                            oldSummary.title,
                            System.currentTimeMillis()
                        );
                        conversations.set(convIndex, newSummary);
                        persistConversationIndex();
                    }
                    
                } catch (IOException e) {
                    runOnUiThread(() -> showToast("Streaming interrupted: " + e.getMessage()));
                } finally {
                    if (responseBody != null) {
                        responseBody.close();
                    }
                    response.close();
                    runOnUiThread(() -> {
                        if (binding != null) {
                            binding.sendButton.setEnabled(true);
                        }
                    });
                }
            }
        });
    }

    private void loadConversationItems(String conversationId) {
        List<MessageItem> loaded = loadConversationMessages(conversationId);
        messages.clear();
        messages.addAll(loaded);
        messageAdapter.notifyDataSetChanged();
        updateStatusBar();
    }

    private int appendLocalMessage(MessageItem item) {
        messages.add(item);
        int index = messages.size() - 1;
        if (binding != null) {
            messageAdapter.notifyItemInserted(index);
            binding.messageList.scrollToPosition(index);
        }
        return index;
    }

    private void toggleLoading(boolean loading) {
        if (binding == null) {
            return;
        }
        binding.loadingIndicator.setVisibility(loading ? View.VISIBLE : View.GONE);
        binding.sendButton.setEnabled(!loading);
    }



    private void updateMessageContent(MessageItem item, int index, String content) {
        if (binding == null || item == null || index < 0 || index >= messages.size()) {
            return;
        }
        item.setContent(content);
        messageAdapter.notifyItemChanged(index);
        binding.messageList.scrollToPosition(messages.size() - 1);
    }



    private String extractErrorMessage(String responseBody, int statusCode) {
        if (!TextUtils.isEmpty(responseBody)) {
            try {
                JSONObject json = new JSONObject(responseBody);
                String message = json.optString("message");
                if (!TextUtils.isEmpty(message)) {
                    return message;
                }
                String error = json.optString("error");
                if (!TextUtils.isEmpty(error)) {
                    return error;
                }
            } catch (JSONException ignored) {
                // fall back to status text
            }
        }
        return "Request failed: " + statusCode;
    }



    private void showToast(String msg) {
        if (!isAdded()) {
            return;
        }
        Toast.makeText(requireContext(), msg, Toast.LENGTH_SHORT).show();
    }

    private void runOnUiThread(Runnable runnable) {
        if (!isAdded()) {
            return;
        }
        requireActivity().runOnUiThread(runnable);
    }


    private void loadStoredConversations() {
        File indexFile = new File(getConversationsDir(), CONVERSATIONS_INDEX);
        if (!indexFile.exists()) {
            return;
        }
        
        try {
            FileInputStream fis = new FileInputStream(indexFile);
            BufferedReader reader = new BufferedReader(new InputStreamReader(fis));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
            reader.close();
            
            JSONArray array = new JSONArray(sb.toString());
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.getJSONObject(i);
                String id = item.optString("id");
                String title = item.optString("title", "New Chat");
                long updatedAt = item.optLong("updatedAt", 0);
                if (!TextUtils.isEmpty(id)) {
                    conversations.add(new ConversationSummary(id, title, updatedAt));
                }
            }
            sortConversationsByRecency();
            
            // Load last selected conversation
            SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
            String lastSelectedId = prefs.getString(PREF_LAST_SELECTED_CONVERSATION, null);
            if (!TextUtils.isEmpty(lastSelectedId) && findConversationIndex(lastSelectedId) >= 0) {
                selectConversation(lastSelectedId);
            } else if (!conversations.isEmpty()) {
                // If last selected doesn't exist, select the most recent
                selectConversation(conversations.get(0).id);
            } else {
                updateStatusBar();
                updateConversationActionButtons();
            }
        } catch (IOException | JSONException ignored) {
        }
    }

    private void selectConversation(String conversationId) {
        selectedConversationId = conversationId;
        saveLastSelectedConversation(conversationId);
        messages.clear();
        if (messageAdapter != null) {
            messageAdapter.notifyDataSetChanged();
        }
        loadConversationItems(conversationId);
        updateStatusBar();
        updateConversationActionButtons();
        updateEmptyStateVisibility();
    }

    private void saveLastSelectedConversation(String conversationId) {
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
        if (TextUtils.isEmpty(conversationId)) {
            prefs.edit().remove(PREF_LAST_SELECTED_CONVERSATION).apply();
        } else {
            prefs.edit().putString(PREF_LAST_SELECTED_CONVERSATION, conversationId).apply();
        }
    }

    private void updateEmptyStateVisibility() {
        if (binding == null) {
            return;
        }
        boolean isEmpty = conversations.isEmpty();
        binding.emptyState.setVisibility(isEmpty ? View.VISIBLE : View.GONE);
        binding.messageList.setVisibility(isEmpty ? View.GONE : View.VISIBLE);
    }

    private int findConversationIndex(String conversationId) {
        for (int i = 0; i < conversations.size(); i++) {
            if (conversationId.equals(conversations.get(i).id)) {
                return i;
            }
        }
        return -1;
    }

    private void handleConversationDeleted(String conversationId) {
        int index = findConversationIndex(conversationId);
        if (index >= 0 && index < conversations.size()) {
            conversations.remove(index);
        }

        if (TextUtils.equals(conversationId, selectedConversationId)) {
            if (conversations.isEmpty()) {
                selectedConversationId = null;
                saveLastSelectedConversation(null);
                messages.clear();
                if (messageAdapter != null) {
                    messageAdapter.notifyDataSetChanged();
                }
                updateStatusBar();
                updateConversationActionButtons();
            } else {
                int nextIndex = Math.min(index, conversations.size() - 1);
                if (nextIndex < 0) {
                    nextIndex = 0;
                }
                selectConversation(conversations.get(nextIndex).id);
            }
        }

        persistConversationIndex();
        updateEmptyStateVisibility();
    }

    private File getConversationsDir() {
        File dir = new File(requireContext().getFilesDir(), CONVERSATIONS_DIR);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private void ensureConversationsDirectory() {
        getConversationsDir();
    }

    private List<MessageItem> loadConversationMessages(String conversationId) {
        List<MessageItem> result = new ArrayList<>();
        File conversationFile = new File(getConversationsDir(), conversationId + ".json");
        if (!conversationFile.exists()) {
            return result;
        }
        
        try {
            FileInputStream fis = new FileInputStream(conversationFile);
            BufferedReader reader = new BufferedReader(new InputStreamReader(fis));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
            reader.close();
            
            JSONArray array = new JSONArray(sb.toString());
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.getJSONObject(i);
                String role = item.optString("role", "user");
                String content = item.optString("content", "");
                long createdAt = item.optLong("createdAt", System.currentTimeMillis());
                result.add(new MessageItem(role, content, createdAt));
            }
        } catch (IOException | JSONException ignored) {
        }
        
        return result;
    }

    private void saveConversationMessages(String conversationId, List<MessageItem> messages) {
        JSONArray array = new JSONArray();
        for (MessageItem item : messages) {
            JSONObject obj = new JSONObject();
            try {
                obj.put("role", item.role);
                obj.put("content", item.getContent());
                obj.put("createdAt", item.createdAt);
                array.put(obj);
            } catch (JSONException ignored) {
            }
        }
        
        File conversationFile = new File(getConversationsDir(), conversationId + ".json");
        try {
            FileOutputStream fos = new FileOutputStream(conversationFile);
            fos.write(array.toString().getBytes());
            fos.close();
        } catch (IOException ignored) {
        }
    }

	private void updateConversationActionButtons() {
		if (!isAdded()) {
			return;
		}
		if (optionsMenu == null) {
			requireActivity().invalidateOptionsMenu();
			return;
		}
		boolean hasSelection = !TextUtils.isEmpty(selectedConversationId)
				&& findConversationIndex(selectedConversationId) >= 0;
		MenuItem renameItem = optionsMenu.findItem(R.id.action_rename_conversation);
		MenuItem deleteItem = optionsMenu.findItem(R.id.action_delete_conversation);
		if (renameItem != null) {
			renameItem.setEnabled(hasSelection);
			renameItem.setVisible(hasSelection);
		}
		if (deleteItem != null) {
			deleteItem.setEnabled(hasSelection);
			deleteItem.setVisible(hasSelection);
		}
	}

    private void persistConversationIndex() {
        if (!isAdded()) {
            return;
        }
        
        sortSummaries(conversations);
        
        JSONArray array = new JSONArray();
        for (ConversationSummary item : conversations) {
            JSONObject obj = new JSONObject();
            try {
                obj.put("id", item.id);
                obj.put("title", item.title);
                obj.put("updatedAt", item.updatedAt);
                array.put(obj);
            } catch (JSONException ignored) {
            }
        }
        
        File indexFile = new File(getConversationsDir(), CONVERSATIONS_INDEX);
        try {
            FileOutputStream fos = new FileOutputStream(indexFile);
            fos.write(array.toString().getBytes());
            fos.close();
        } catch (IOException ignored) {
        }
    }

    private void sortConversationsByRecency() {
        sortSummaries(conversations);
    }

    private void sortSummaries(List<ConversationSummary> items) {
        if (items == null || items.size() < 2) {
            return;
        }
        Collections.sort(items, (a, b) -> Long.compare(b.updatedAt, a.updatedAt));
    }

    private void showAgentSettingsDialog() {
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
        
        View dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_agent_settings, null);
        
        com.google.android.material.textfield.TextInputEditText baseUrlInput = dialogView.findViewById(R.id.base_url_input);
        com.google.android.material.textfield.TextInputEditText apiKeyInput = dialogView.findViewById(R.id.api_key_input);
        com.google.android.material.textfield.TextInputEditText modelInput = dialogView.findViewById(R.id.model_input);
        com.google.android.material.textfield.TextInputEditText instructionsInput = dialogView.findViewById(R.id.instructions_input);
        
        baseUrlInput.setText(prefs.getString("agent_base_url", DEFAULT_BASE_URL));
        apiKeyInput.setText(prefs.getString("agent_api_key", ""));
        modelInput.setText(prefs.getString("agent_model", DEFAULT_MODEL));
        instructionsInput.setText(prefs.getString("agent_instructions", ""));
        
        baseUrlInput.setTextColor(0xFFFFFFFF);
        apiKeyInput.setTextColor(0xFFFFFFFF);
        modelInput.setTextColor(0xFFFFFFFF);
        instructionsInput.setTextColor(0xFFFFFFFF);
        
        baseUrlInput.setHintTextColor(0xFFAAAAAA);
        apiKeyInput.setHintTextColor(0xFFAAAAAA);
        modelInput.setHintTextColor(0xFFAAAAAA);
        instructionsInput.setHintTextColor(0xFFAAAAAA);
        
        new AlertDialog.Builder(requireContext())
            .setTitle("Agent Settings")
            .setView(dialogView)
            .setPositiveButton("Save", (dialog, which) -> {
                String baseUrl = baseUrlInput.getText() != null ? baseUrlInput.getText().toString().trim() : DEFAULT_BASE_URL;
                String apiKey = apiKeyInput.getText() != null ? apiKeyInput.getText().toString().trim() : "";
                String model = modelInput.getText() != null ? modelInput.getText().toString().trim() : DEFAULT_MODEL;
                String instructions = instructionsInput.getText() != null ? instructionsInput.getText().toString().trim() : "";
                
                if (TextUtils.isEmpty(baseUrl)) {
                    baseUrl = DEFAULT_BASE_URL;
                }
                if (TextUtils.isEmpty(model)) {
                    model = DEFAULT_MODEL;
                }
                
                prefs.edit()
                    .putString("agent_base_url", baseUrl)
                    .putString("agent_api_key", apiKey)
                    .putString("agent_model", model)
                    .putString("agent_instructions", instructions)
                    .apply();
                    
                showToast("Settings saved");
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    private static class ConversationSummary {
        final String id;
        final String title;
        final String label;
        final long updatedAt;

        ConversationSummary(String id, String topic, long updatedAt) {
            this.id = id;
            String baseTitle = TextUtils.isEmpty(topic) ? "New Chat" : topic.trim();
            if (TextUtils.isEmpty(baseTitle)) {
                baseTitle = "New Chat";
            }
            this.title = baseTitle;
            String sanitized = baseTitle;
            if (sanitized.length() > 40) {
                sanitized = sanitized.substring(0, 40) + "…";
            }
            this.label = sanitized;
            this.updatedAt = updatedAt;
        }
    }

    private static class MessageItem {
        final String role;
        private String content;
        final long createdAt;

        MessageItem(String role, String content) {
            this(role, content, System.currentTimeMillis());
        }

        MessageItem(String role, String content, long createdAt) {
            this.role = role;
            this.content = content;
            this.createdAt = createdAt;
        }

        String getContent() {
            return content;
        }

        void setContent(String content) {
            this.content = content != null ? content : "";
        }
    }

    private static class AgentMessageAdapter extends androidx.recyclerview.widget.RecyclerView.Adapter<AgentMessageAdapter.MessageViewHolder> {

        private final List<MessageItem> items;
        private final Markwon markwon;

        AgentMessageAdapter(List<MessageItem> items, Markwon markwon) {
            this.items = items;
            this.markwon = markwon;
        }

        @NonNull
        @Override
        public MessageViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            LayoutInflater inflater = LayoutInflater.from(parent.getContext());
            com.emwaver.emwaverandroidapp.databinding.ItemAgentMessageBinding binding =
                    com.emwaver.emwaverandroidapp.databinding.ItemAgentMessageBinding.inflate(inflater, parent, false);
            return new MessageViewHolder(binding);
        }

		@Override
		public void onBindViewHolder(@NonNull MessageViewHolder holder, int position) {
			MessageItem item = items.get(position);
			boolean isAssistant = "assistant".equalsIgnoreCase(item.role);
			if (isAssistant) {
				holder.messageIcon.setVisibility(View.VISIBLE);
				holder.messageRow.setGravity(Gravity.START);
				holder.messageContent.removeAllViews();
				renderMarkdownWithCopyButtons(holder.messageContent, item.getContent());
			} else {
				holder.messageIcon.setVisibility(View.GONE);
				holder.messageRow.setGravity(Gravity.END);
				holder.messageContent.removeAllViews();
				TextView textView = new TextView(holder.messageContent.getContext());
				textView.setText(item.getContent());
				textView.setTextColor(holder.messageContent.getContext().getResources().getColor(R.color.white, null));
				textView.setTextSize(16);
				textView.setGravity(Gravity.END);
				textView.setTextAlignment(View.TEXT_ALIGNMENT_VIEW_END);
				textView.setBackgroundResource(R.drawable.user_message_bubble);
				textView.setPadding(20, 14, 20, 14);
				LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
					LinearLayout.LayoutParams.WRAP_CONTENT,
					LinearLayout.LayoutParams.WRAP_CONTENT
				);
				params.gravity = Gravity.END;
				textView.setLayoutParams(params);
				holder.messageContent.addView(textView);
			}
		}
		
		private void renderMarkdownWithCopyButtons(LinearLayout container, String markdown) {
			Context context = container.getContext();
			String[] parts = markdown.split("```");
			
			for (int i = 0; i < parts.length; i++) {
				if (i % 2 == 0) {
					if (!parts[i].trim().isEmpty()) {
						renderTextWithTables(container, context, parts[i]);
					}
				} else {
					String[] codeLines = parts[i].split("\n", 2);
					String code = codeLines.length > 1 ? codeLines[1] : parts[i];
					
					LinearLayout codeBlock = new LinearLayout(context);
					codeBlock.setOrientation(LinearLayout.VERTICAL);
					codeBlock.setBackgroundColor(0xFF2B2B2B);
					codeBlock.setPadding(20, 20, 20, 20);
					LinearLayout.LayoutParams codeParams = new LinearLayout.LayoutParams(
						LinearLayout.LayoutParams.MATCH_PARENT,
						LinearLayout.LayoutParams.WRAP_CONTENT
					);
					codeParams.setMargins(0, 10, 0, 10);
					codeBlock.setLayoutParams(codeParams);
					
					android.widget.HorizontalScrollView codeScroll = new android.widget.HorizontalScrollView(context);
					
					TextView codeTextView = new TextView(context);
					codeTextView.setText(code);
					codeTextView.setTextColor(0xFFE0E0E0);
					codeTextView.setTextSize(14);
					codeTextView.setTypeface(android.graphics.Typeface.MONOSPACE);
					
					codeScroll.addView(codeTextView);
					codeBlock.addView(codeScroll);
					
					com.google.android.material.button.MaterialButton copyButton = 
						new com.google.android.material.button.MaterialButton(context);
					copyButton.setText("Copy Code");
					copyButton.setTextSize(12);
					LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
						LinearLayout.LayoutParams.WRAP_CONTENT,
						LinearLayout.LayoutParams.WRAP_CONTENT
					);
					params.setMargins(0, 10, 0, 0);
					copyButton.setLayoutParams(params);
					
					final String codeContent = code;
					copyButton.setOnClickListener(v -> {
						ClipboardManager clipboard = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
						ClipData clip = ClipData.newPlainText("code", codeContent);
						clipboard.setPrimaryClip(clip);
						Toast.makeText(context, "Code copied", Toast.LENGTH_SHORT).show();
					});
					
					codeBlock.addView(copyButton);
					container.addView(codeBlock);
				}
			}
		}
		
		private void renderTextWithTables(LinearLayout container, Context context, String text) {
			String[] lines = text.split("\n");
			java.util.ArrayList<String> tableLines = new java.util.ArrayList<>();
			StringBuilder normalText = new StringBuilder();
			boolean inTable = false;
			
			for (String line : lines) {
				if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
					if (!inTable && normalText.length() > 0) {
						addNormalText(container, context, normalText.toString());
						normalText.setLength(0);
					}
					inTable = true;
					tableLines.add(line);
				} else {
					if (inTable) {
						renderTable(container, context, tableLines);
						tableLines.clear();
						inTable = false;
					}
					normalText.append(line).append("\n");
				}
			}
			
			if (normalText.length() > 0) {
				addNormalText(container, context, normalText.toString());
			}
			if (!tableLines.isEmpty()) {
				renderTable(container, context, tableLines);
			}
		}
		
		private void addNormalText(LinearLayout container, Context context, String text) {
			TextView textView = new TextView(context);
			textView.setTextColor(context.getResources().getColor(R.color.agentMessageText, null));
			textView.setTextSize(16);
			textView.setMovementMethod(LinkMovementMethod.getInstance());
			if (markwon != null) {
				markwon.setMarkdown(textView, text);
			} else {
				textView.setText(text);
			}
			container.addView(textView);
		}
		
		private void renderTable(LinearLayout container, Context context, java.util.ArrayList<String> tableLines) {
			if (tableLines.size() < 2) return;
			
			android.widget.HorizontalScrollView scrollView = new android.widget.HorizontalScrollView(context);
			LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(
				LinearLayout.LayoutParams.MATCH_PARENT,
				LinearLayout.LayoutParams.WRAP_CONTENT
			);
			scrollParams.setMargins(0, 10, 0, 10);
			scrollView.setLayoutParams(scrollParams);
			
			android.widget.TableLayout table = new android.widget.TableLayout(context);
			table.setBackgroundColor(0xFF1E1E1E);
			table.setPadding(10, 10, 10, 10);
			
			for (int i = 0; i < tableLines.size(); i++) {
				if (i == 1 && tableLines.get(i).contains("---")) continue;
				
				String[] cells = tableLines.get(i).split("\\|");
				android.widget.TableRow row = new android.widget.TableRow(context);
				
				for (int j = 1; j < cells.length - 1; j++) {
					TextView cell = new TextView(context);
					cell.setText(cells[j].trim());
					cell.setTextColor(0xFFE0E0E0);
					cell.setTextSize(14);
					cell.setPadding(15, 10, 15, 10);
					cell.setMinWidth(150);
					
					if (i == 0) {
						cell.setTypeface(null, android.graphics.Typeface.BOLD);
						cell.setTextColor(0xFFFFFFFF);
					}
					
					row.addView(cell);
				}
				
				table.addView(row);
			}
			
			scrollView.addView(table);
			container.addView(scrollView);
		}

        @Override
        public int getItemCount() {
            return items.size();
        }

		static class MessageViewHolder extends androidx.recyclerview.widget.RecyclerView.ViewHolder {
			final com.emwaver.emwaverandroidapp.databinding.ItemAgentMessageBinding binding;
			final LinearLayout messageRow;
			final ImageView messageIcon;
			final LinearLayout messageContent;

			MessageViewHolder(com.emwaver.emwaverandroidapp.databinding.ItemAgentMessageBinding binding) {
				super(binding.getRoot());
				this.binding = binding;
				messageRow = binding.getRoot().findViewById(R.id.message_row);
				messageIcon = binding.getRoot().findViewById(R.id.message_icon);
				messageContent = binding.getRoot().findViewById(R.id.message_content);
			}
		}
    }

    private static class EditTextDialogBuilder {
        private final AlertDialog.Builder builder;
        private final com.google.android.material.textfield.TextInputLayout inputLayout;
        private final com.google.android.material.textfield.TextInputEditText editText;

        EditTextDialogBuilder(Context context) {
            builder = new AlertDialog.Builder(context);
            inputLayout = new com.google.android.material.textfield.TextInputLayout(context);
            editText = new com.google.android.material.textfield.TextInputEditText(context);
            inputLayout.addView(editText);
            int padding = (int) (16 * context.getResources().getDisplayMetrics().density);
            inputLayout.setPadding(padding, padding, padding, padding);
            builder.setView(inputLayout);
        }

        EditTextDialogBuilder setTitle(String title) {
            builder.setTitle(title);
            return this;
        }

        EditTextDialogBuilder setHint(String hint) {
            editText.setHint(hint);
            return this;
        }

        EditTextDialogBuilder setPositiveButton(String text, final DialogCallback callback) {
            builder.setPositiveButton(text, (dialog, which) -> {
                if (callback != null) {
                    callback.onClick(dialog, which, editText.getText() != null ? editText.getText().toString().trim() : "");
                }
            });
            return this;
        }

        EditTextDialogBuilder setNegativeButton(String text, DialogInterface.OnClickListener listener) {
            builder.setNegativeButton(text, listener);
            return this;
        }

        EditTextDialogBuilder setInitialText(String text) {
            if (!TextUtils.isEmpty(text)) {
                editText.setText(text);
                editText.setSelection(editText.getText() != null ? editText.getText().length() : 0);
            } else {
                editText.setText("");
            }
            return this;
        }

        void show() {
            builder.show();
        }

        interface DialogCallback {
            void onClick(DialogInterface dialog, int which, String text);
        }
    }
}
