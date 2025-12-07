package com.emwaver.emwaverandroidapp.ui.agent;

import android.content.Context;
import android.content.DialogInterface;
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
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;

import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.emwaver.emwaverandroidapp.BuildConfig;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.auth.AuthenticationManager;
import com.emwaver.emwaverandroidapp.databinding.FragmentAgentBinding;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.BufferedSource;

import io.noties.markwon.Markwon;

public class AgentFragment extends Fragment {

    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");
    private static final String PREFS_NAME = "agent_fragment_prefs";
    private static final String PREF_CONVERSATIONS = "conversations";

    private FragmentAgentBinding binding;
    private final List<ConversationSummary> conversations = new ArrayList<>();
    private final List<MessageItem> messages = new ArrayList<>();
    private ArrayAdapter<String> conversationAdapter;
    private AgentMessageAdapter messageAdapter;
    private OkHttpClient httpClient;
    private AuthenticationManager authenticationManager;
    private String backendBaseUrl;
    private String selectedConversationId;
    private Menu optionsMenu;
    private Markwon markwon;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setHasOptionsMenu(true);
        httpClient = new OkHttpClient();
        authenticationManager = AuthenticationManager.getInstance(requireContext());
        backendBaseUrl = BuildConfig.BACKEND_BASE_URL;
        if (TextUtils.isEmpty(backendBaseUrl)) {
            backendBaseUrl = "http://10.0.2.2:8000";
        }
        if (backendBaseUrl.endsWith("/")) {
            backendBaseUrl = backendBaseUrl.substring(0, backendBaseUrl.length() - 1);
        }
        markwon = Markwon.builder(requireContext()).build();
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        binding = FragmentAgentBinding.inflate(inflater, container, false);
        setupConversationSpinner();
        setupRecycler();
        setupSendActions();
        loadStoredConversations();
        fetchConversationsFromBackend();
        return binding.getRoot();
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null;
        optionsMenu = null;
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
		if (itemId == R.id.action_rename_conversation) {
			promptRenameConversation();
			return true;
		} else if (itemId == R.id.action_delete_conversation) {
			confirmDeleteConversation();
			return true;
		}
		return super.onOptionsItemSelected(item);
	}

    private void setupConversationSpinner() {
        Context context = requireContext();
        conversationAdapter = new ArrayAdapter<>(context,
                android.R.layout.simple_spinner_dropdown_item, new ArrayList<>());
        binding.conversationSpinner.setAdapter(conversationAdapter);
        binding.conversationSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (position < conversations.size()) {
                    ConversationSummary summary = conversations.get(position);
                    selectedConversationId = summary.id;
                    messages.clear();
                    if (messageAdapter != null) {
                        messageAdapter.notifyDataSetChanged();
                    }
                    loadConversationItems(summary.id);
                }
                updateConversationActionButtons();
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
                selectedConversationId = null;
                messages.clear();
                messageAdapter.notifyDataSetChanged();
                updateConversationActionButtons();
            }
        });

        binding.createConversationButton.setOnClickListener(v -> promptForConversationTopic());
		updateConversationActionButtons();
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
                .setHint("Topic (optional)");

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
        String accessToken = requireAccessToken();
        if (TextUtils.isEmpty(accessToken)) {
            return;
        }
        final String sanitizedTitle;
        if (TextUtils.isEmpty(newTitle)) {
            sanitizedTitle = "Agent Chat";
        } else {
            String trimmed = newTitle.trim();
            sanitizedTitle = TextUtils.isEmpty(trimmed) ? "Agent Chat" : trimmed;
        }

        JSONObject body = new JSONObject();
        try {
            body.put("title", sanitizedTitle);
        } catch (JSONException e) {
            showToast("Failed to build request");
            return;
        }

        Request request = new Request.Builder()
                .url(backendBaseUrl + "/llm/conversations/" + conversationId)
                .addHeader("Authorization", "Bearer " + accessToken)
                .addHeader("Content-Type", "application/json")
                .patch(RequestBody.create(body.toString(), JSON_MEDIA_TYPE))
                .build();

        toggleLoading(true);
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                runOnUiThread(() -> {
                    toggleLoading(false);
                    showToast("Failed to rename conversation");
                });
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) throws IOException {
                String responseBody = response.body() != null ? response.body().string() : "";
                if (!response.isSuccessful()) {
                    runOnUiThread(() -> {
                        toggleLoading(false);
                        showToast(extractErrorMessage(responseBody, response.code()));
                    });
                    response.close();
                    return;
                }

                try {
                    JSONObject json = new JSONObject(responseBody);
                    JSONObject conversationJson = json.optJSONObject("conversation");
                    if (conversationJson == null) {
                        runOnUiThread(() -> {
                            toggleLoading(false);
                            showToast("Conversation payload missing");
                        });
                        return;
                    }
                    final String id = conversationJson.optString("id", conversationId);
                    final String responseTitle = conversationJson.optString("title", sanitizedTitle);
                    long updatedAt = parseIsoTimestamp(conversationJson.optString("updated_at"));
                    if (updatedAt == 0L) {
                        updatedAt = System.currentTimeMillis();
                    }
                    ConversationSummary summary = new ConversationSummary(id, responseTitle, updatedAt);
                    runOnUiThread(() -> {
                        toggleLoading(false);
                        selectedConversationId = summary.id;
                        addConversationToSpinner(summary, true);
                        persistConversation(summary);
                        showToast("Conversation renamed");
                        fetchConversationsFromBackend();
                    });
                } catch (JSONException e) {
                    runOnUiThread(() -> {
                        toggleLoading(false);
                        showToast("Invalid rename response");
                    });
                } finally {
                    response.close();
                }
            }
        });
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
        String accessToken = requireAccessToken();
        if (TextUtils.isEmpty(accessToken)) {
            return;
        }

        Request request = new Request.Builder()
                .url(backendBaseUrl + "/llm/conversations/" + conversationId)
                .addHeader("Authorization", "Bearer " + accessToken)
                .delete()
                .build();

        toggleLoading(true);
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                runOnUiThread(() -> {
                    toggleLoading(false);
                    showToast("Failed to delete conversation");
                });
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) throws IOException {
                String responseBody = response.body() != null ? response.body().string() : "";
                if (!response.isSuccessful()) {
                    runOnUiThread(() -> {
                        toggleLoading(false);
                        showToast(extractErrorMessage(responseBody, response.code()));
                    });
                    response.close();
                    return;
                }

                runOnUiThread(() -> {
                    toggleLoading(false);
                    handleConversationDeleted(conversationId);
                    showToast("Conversation deleted");
                    fetchConversationsFromBackend();
                });
                response.close();
            }
        });
    }

    private void createConversation(String topic) {
        JSONObject body = new JSONObject();
        try {
            body.put("title", TextUtils.isEmpty(topic) ? "Agent Chat" : topic);
        } catch (JSONException e) {
            showToast("Failed to build request");
            return;
        }

        sendConversationCreateRequest(body, null);
    }

    private void createConversationWithInitialMessage(String message) {
        JSONObject body = new JSONObject();
        try {
            body.put("title", "Agent Chat");
        } catch (JSONException e) {
            showToast("Failed to build request");
            return;
        }

        sendConversationCreateRequest(body, message);
    }

    private void sendConversationCreateRequest(JSONObject body, @Nullable String initialMessage) {
        String accessToken = requireAccessToken();
        if (TextUtils.isEmpty(accessToken)) {
            return;
        }

        Request request = new Request.Builder()
                .url(backendBaseUrl + "/llm/conversations")
                .addHeader("Authorization", "Bearer " + accessToken)
                .addHeader("Content-Type", "application/json")
                .post(RequestBody.create(body.toString(), JSON_MEDIA_TYPE))
                .build();

        toggleLoading(true);
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                runOnUiThread(() -> {
                    toggleLoading(false);
                    showToast("Failed to create conversation");
                });
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) throws IOException {
                String responseBody = response.body() != null ? response.body().string() : "";
                if (!response.isSuccessful()) {
                    runOnUiThread(() -> {
                        toggleLoading(false);
                        String message = extractErrorMessage(responseBody, response.code());
                        showToast(message);
                    });
                    return;
                }

                try {
                    JSONObject json = new JSONObject(responseBody);
                    JSONObject conversationJson = json.optJSONObject("conversation");
                    if (conversationJson == null) {
                        runOnUiThread(() -> {
                            toggleLoading(false);
                            showToast("Conversation payload missing");
                        });
                        return;
                    }
                    String conversationId = conversationJson.optString("id");
                    if (TextUtils.isEmpty(conversationId)) {
                        runOnUiThread(() -> {
                            toggleLoading(false);
                            showToast("Conversation id missing");
                        });
                        return;
                    }

                    String topic = conversationJson.optString("title", "Agent Chat");
                    ConversationSummary summary = new ConversationSummary(conversationId, topic, System.currentTimeMillis());
                    persistConversation(summary);
                    runOnUiThread(() -> {
                        toggleLoading(false);
                        addConversationToSpinner(summary, true);
                        if (!TextUtils.isEmpty(initialMessage)) {
                            appendLocalMessage(new MessageItem("user", initialMessage));
                            sendMessageToConversation(conversationId, initialMessage);
                        }
                        fetchConversationsFromBackend();
                    });
                } catch (JSONException e) {
                    runOnUiThread(() -> {
                        toggleLoading(false);
                        showToast("Invalid conversation response");
                    });
                }
            }
        });
    }

    private void sendMessageToConversation(String conversationId, String message) {
        String accessToken = requireAccessToken();
        if (TextUtils.isEmpty(accessToken)) {
            return;
        }

        JSONObject body = new JSONObject();
        try {
            body.put("message", message);
            body.put("stream", true);
        } catch (JSONException e) {
            showToast("Failed to build request");
            return;
        }

        Request request = new Request.Builder()
                .url(backendBaseUrl + "/llm/conversations/" + conversationId + "/messages")
                .addHeader("Authorization", "Bearer " + accessToken)
                .addHeader("Content-Type", "application/json")
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
                    showToast("Failed to send message");
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
                StringBuilder dataBuilder = new StringBuilder();
                String currentEvent = null;
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
                    BufferedSource source = responseBody.source();
                    while (true) {
                        String line;
                        try {
                            line = source.readUtf8Line();
                        } catch (IOException readError) {
                            runOnUiThread(() -> showToast("Streaming interrupted"));
                            break;
                        }
                        if (line == null) {
                            handleSseChunk(currentEvent, dataBuilder.toString(), assistantMessage, assistantIndex, accumulatedText);
                            break;
                        }
                        if (line.isEmpty()) {
                            handleSseChunk(currentEvent, dataBuilder.toString(), assistantMessage, assistantIndex, accumulatedText);
                            currentEvent = null;
                            dataBuilder.setLength(0);
                            continue;
                        }
                        if (line.startsWith("event:")) {
                            currentEvent = line.substring(6).trim();
                        } else if (line.startsWith("data:")) {
                            if (dataBuilder.length() > 0) {
                                dataBuilder.append('\n');
                            }
                            dataBuilder.append(line.substring(5).trim());
                        }
                    }
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
        String accessToken = requireAccessToken();
        if (TextUtils.isEmpty(accessToken)) {
            return;
        }

        Request request = new Request.Builder()
                .url(backendBaseUrl + "/llm/conversations/" + conversationId + "/messages?limit=50")
                .addHeader("Authorization", "Bearer " + accessToken)
                .get()
                .build();

        toggleLoading(true);
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                runOnUiThread(() -> {
                    toggleLoading(false);
                    showToast("Failed to load conversation");
                });
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) throws IOException {
                String responseBody = response.body() != null ? response.body().string() : "";
                if (!response.isSuccessful()) {
                    runOnUiThread(() -> {
                        toggleLoading(false);
                        String message = extractErrorMessage(responseBody, response.code());
                        showToast(message);
                    });
                    return;
                }

                try {
                    JSONObject json = new JSONObject(responseBody);
                    JSONArray data = json.optJSONArray("messages");
                    List<MessageItem> loaded = new ArrayList<>();
                    if (data != null) {
                        for (int i = 0; i < data.length(); i++) {
                            JSONObject item = data.getJSONObject(i);
                            String role = item.optString("role", "assistant");
                            JSONArray contentArray = item.optJSONArray("content");
                            if (contentArray == null) {
                                continue;
                            }
                            StringBuilder builder = new StringBuilder();
                            for (int j = 0; j < contentArray.length(); j++) {
                                Object contentNode = contentArray.opt(j);
                                if (contentNode instanceof String) {
                                    builder.append((String) contentNode);
                                } else if (contentNode instanceof JSONObject) {
                                    builder.append(((JSONObject) contentNode).optString("text"));
                                }
                            }
                            String text = builder.toString().trim();
                            if (!text.isEmpty()) {
                                long created = parseIsoTimestamp(item.optString("created_at"));
                                if (created == 0L) {
                                    created = System.currentTimeMillis();
                                }
                                loaded.add(new MessageItem(role, text, created));
                            }
                        }
                    }
                    Collections.sort(loaded, Comparator.comparingLong(a -> a.createdAt));
                    runOnUiThread(() -> {
                        messages.clear();
                        messages.addAll(loaded);
                        messageAdapter.notifyDataSetChanged();
                        toggleLoading(false);
                    });
                } catch (JSONException e) {
                    runOnUiThread(() -> {
                        toggleLoading(false);
                        showToast("Invalid conversation history");
                    });
                }
            }
        });
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

    private void handleSseChunk(@Nullable String eventType, String data, MessageItem assistantMessage,
                                AtomicInteger assistantIndex, StringBuilder accumulatedText) {
        if (TextUtils.isEmpty(data) || assistantMessage == null) {
            return;
        }
        try {
            JSONObject payload = new JSONObject(data);
            String resolvedType = !TextUtils.isEmpty(eventType) ? eventType : payload.optString("type");
            if ("response.output_text.delta".equals(resolvedType)) {
                String delta = extractDeltaText(payload);
                if (!TextUtils.isEmpty(delta)) {
                    accumulatedText.append(delta);
                    final String text = accumulatedText.toString();
                    runOnUiThread(() -> updateMessageContent(assistantMessage, assistantIndex.get(), text));
                }
            } else if ("final".equals(resolvedType)) {
                String finalText = payload.optString("output_text");
                if (!TextUtils.isEmpty(finalText)) {
                    accumulatedText.setLength(0);
                    accumulatedText.append(finalText);
                }
                final String text = accumulatedText.toString().trim();
                runOnUiThread(() -> updateMessageContent(assistantMessage, assistantIndex.get(), text));
                runOnUiThread(this::fetchConversationsFromBackend);
            } else if ("response.completed".equals(resolvedType)) {
                if (accumulatedText.length() > 0) {
                    final String text = accumulatedText.toString();
                    runOnUiThread(() -> updateMessageContent(assistantMessage, assistantIndex.get(), text));
                }
            } else if ("error".equals(resolvedType) || "response.error".equals(resolvedType)) {
                String message = payload.optString("message");
                if (TextUtils.isEmpty(message)) {
                    message = payload.optString("error", "Streaming error");
                }
                final String errorMessage = TextUtils.isEmpty(message) ? "Streaming error" : message;
                runOnUiThread(() -> {
                    updateMessageContent(assistantMessage, assistantIndex.get(), errorMessage);
                    showToast(errorMessage);
                });
            }
        } catch (JSONException ignored) {
        }
    }

    private String extractDeltaText(JSONObject payload) {
        Object deltaNode = payload.opt("delta");
        if (deltaNode instanceof String) {
            return (String) deltaNode;
        }
        if (deltaNode instanceof JSONObject) {
            JSONObject deltaObj = (JSONObject) deltaNode;
            String value = deltaObj.optString("text");
            if (!TextUtils.isEmpty(value)) {
                return value;
            }
            return deltaObj.optString("value");
        }
        if (deltaNode instanceof JSONArray) {
            JSONArray array = (JSONArray) deltaNode;
            StringBuilder builder = new StringBuilder();
            for (int i = 0; i < array.length(); i++) {
                Object item = array.opt(i);
                if (item instanceof String) {
                    builder.append((String) item);
                } else if (item instanceof JSONObject) {
                    builder.append(((JSONObject) item).optString("text"));
                }
            }
            return builder.toString();
        }
        JSONArray contentArray = payload.optJSONArray("content");
        if (contentArray != null) {
            StringBuilder builder = new StringBuilder();
            for (int i = 0; i < contentArray.length(); i++) {
                Object item = contentArray.opt(i);
                if (item instanceof String) {
                    builder.append((String) item);
                } else if (item instanceof JSONObject) {
                    builder.append(((JSONObject) item).optString("text"));
                }
            }
            return builder.toString();
        }
        return payload.optString("text");
    }

    private void updateMessageContent(MessageItem item, int index, String content) {
        if (binding == null || item == null || index < 0 || index >= messages.size()) {
            return;
        }
        item.setContent(content);
        messageAdapter.notifyItemChanged(index);
        binding.messageList.scrollToPosition(messages.size() - 1);
    }

    @Nullable
    private String requireAccessToken() {
        if (authenticationManager == null) {
            return null;
        }
        String token = authenticationManager.getAccessToken();
        if (TextUtils.isEmpty(token)) {
            showToast("Please sign in again to use the agent");
            return null;
        }
        return token;
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

    private long parseIsoTimestamp(String value) {
        if (TextUtils.isEmpty(value)) {
            return 0L;
        }
        try {
            return OffsetDateTime.parse(value).toInstant().toEpochMilli();
        } catch (DateTimeParseException ignored) {
            try {
                return Instant.parse(value).toEpochMilli();
            } catch (DateTimeParseException ignoredAgain) {
                return 0L;
            }
        }
    }

    private void fetchConversationsFromBackend() {
        String accessToken = requireAccessToken();
        if (TextUtils.isEmpty(accessToken)) {
            return;
        }

        Request request = new Request.Builder()
                .url(backendBaseUrl + "/llm/conversations")
                .addHeader("Authorization", "Bearer " + accessToken)
                .get()
                .build();

        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                runOnUiThread(() -> showToast("Failed to load conversations"));
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) throws IOException {
                String responseBody = response.body() != null ? response.body().string() : "";
                if (!response.isSuccessful()) {
                    runOnUiThread(() -> showToast(extractErrorMessage(responseBody, response.code())));
                    return;
                }

                try {
                    JSONObject json = new JSONObject(responseBody);
                    JSONArray data = json.optJSONArray("conversations");
                    List<ConversationSummary> fetched = new ArrayList<>();
                    if (data != null) {
                        for (int i = 0; i < data.length(); i++) {
                            JSONObject item = data.getJSONObject(i);
                            String id = item.optString("id");
                            String title = item.optString("title", "Agent Chat");
                            String updatedIso = item.optString("updated_at");
                            long updatedAt = parseIsoTimestamp(updatedIso);
                            if (updatedAt == 0L) {
                                updatedAt = parseIsoTimestamp(item.optString("created_at"));
                            }
                            if (updatedAt == 0L) {
                                updatedAt = System.currentTimeMillis();
                            }
                            if (!TextUtils.isEmpty(id)) {
                                fetched.add(new ConversationSummary(id, title, updatedAt));
                            }
                        }
                    }
                    runOnUiThread(() -> {
                        conversations.clear();
                        conversations.addAll(fetched);
                        sortConversationsByRecency();
                        addConversationToSpinnerListOnly();
                        persistConversationList(conversations);
                    });
                } catch (JSONException e) {
                    runOnUiThread(() -> showToast("Invalid conversation list"));
                }
            }
        });
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

    private void addConversationToSpinner(ConversationSummary summary, boolean select) {
        int existingIndex = -1;
        for (int i = 0; i < conversations.size(); i++) {
            if (conversations.get(i).id.equals(summary.id)) {
                existingIndex = i;
                break;
            }
        }
        if (existingIndex >= 0) {
            conversations.set(existingIndex, summary);
        } else {
            conversations.add(summary);
        }

        sortConversationsByRecency();

        List<String> labels = new ArrayList<>();
        for (ConversationSummary conversation : conversations) {
            labels.add(conversation.label);
        }
        conversationAdapter.clear();
        conversationAdapter.addAll(labels);
        conversationAdapter.notifyDataSetChanged();

        if (select) {
            int index = conversations.indexOf(summary);
            if (index >= 0 && binding != null) {
                binding.conversationSpinner.setSelection(index);
            }
        }
        updateConversationActionButtons();
    }

    private void loadStoredConversations() {
        Context context = requireContext();
        String serialized = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(PREF_CONVERSATIONS, null);
        if (TextUtils.isEmpty(serialized)) {
            return;
        }
        try {
            JSONArray array = new JSONArray(serialized);
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.getJSONObject(i);
                String id = item.optString("id");
                String title = item.optString("title");
                if (TextUtils.isEmpty(title)) {
                    title = item.optString("label");
                }
                long updatedAt = item.optLong("updatedAt", 0);
                if (!TextUtils.isEmpty(id)) {
                    conversations.add(new ConversationSummary(id, title, updatedAt));
                }
            }
            sortConversationsByRecency();
            addConversationToSpinnerListOnly();
        } catch (JSONException ignored) {
        }
    }

    private void addConversationToSpinnerListOnly() {
        sortConversationsByRecency();
        List<String> labels = new ArrayList<>();
        for (ConversationSummary conversation : conversations) {
            labels.add(conversation.label);
        }
        conversationAdapter.clear();
        conversationAdapter.addAll(labels);
        conversationAdapter.notifyDataSetChanged();

        if (binding != null && !TextUtils.isEmpty(selectedConversationId)) {
            int index = findConversationIndex(selectedConversationId);
            if (index >= 0) {
                binding.conversationSpinner.setSelection(index);
            }
        }
        updateConversationActionButtons();
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
                messages.clear();
                if (messageAdapter != null) {
                    messageAdapter.notifyDataSetChanged();
                }
            } else {
                int nextIndex = Math.min(index, conversations.size() - 1);
                if (nextIndex < 0) {
                    nextIndex = 0;
                }
                selectedConversationId = conversations.get(nextIndex).id;
            }
        }

        persistConversationList(conversations);
        addConversationToSpinnerListOnly();
        if (TextUtils.isEmpty(selectedConversationId)) {
            updateConversationActionButtons();
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

    private void persistConversation(ConversationSummary summary) {
        if (!isAdded()) {
            return;
        }
        List<ConversationSummary> copy = new ArrayList<>(conversations);
        boolean updated = false;
        for (int i = 0; i < copy.size(); i++) {
            if (copy.get(i).id.equals(summary.id)) {
                copy.set(i, summary);
                updated = true;
                break;
            }
        }
        if (!updated) {
            copy.add(summary);
        }
        sortSummaries(copy);
        persistConversationList(copy);
    }

    private void persistConversationList(List<ConversationSummary> items) {
        if (!isAdded()) {
            return;
        }
        Context context = requireContext();

        sortSummaries(items);

        JSONArray array = new JSONArray();
        for (ConversationSummary item : items) {
            JSONObject obj = new JSONObject();
            try {
                obj.put("id", item.id);
                obj.put("title", item.title);
                obj.put("label", item.label);
                obj.put("updatedAt", item.updatedAt);
                array.put(obj);
            } catch (JSONException ignored) {
            }
        }

        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(PREF_CONVERSATIONS, array.toString())
                .apply();
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

    private static class ConversationSummary {
        final String id;
        final String title;
        final String label;
        final long updatedAt;

        ConversationSummary(String id, String topic, long updatedAt) {
            this.id = id;
            String baseTitle = TextUtils.isEmpty(topic) ? "Agent Chat" : topic.trim();
            if (TextUtils.isEmpty(baseTitle)) {
                baseTitle = "Agent Chat";
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
				holder.messageContent.setGravity(Gravity.START);
				holder.messageContent.setTextAlignment(View.TEXT_ALIGNMENT_VIEW_START);
				holder.messageContent.setMovementMethod(LinkMovementMethod.getInstance());
				if (markwon != null) {
					markwon.setMarkdown(holder.messageContent, item.getContent());
				} else {
					holder.messageContent.setText(item.getContent());
				}
			} else {
				holder.messageIcon.setVisibility(View.GONE);
				holder.messageRow.setGravity(Gravity.END);
				holder.messageContent.setGravity(Gravity.END);
				holder.messageContent.setTextAlignment(View.TEXT_ALIGNMENT_VIEW_END);
				holder.messageContent.setMovementMethod(null);
				holder.messageContent.setText(item.getContent());
			}
		}

        @Override
        public int getItemCount() {
            return items.size();
        }

		static class MessageViewHolder extends androidx.recyclerview.widget.RecyclerView.ViewHolder {
			final com.emwaver.emwaverandroidapp.databinding.ItemAgentMessageBinding binding;
			final LinearLayout messageRow;
			final ImageView messageIcon;
			final TextView messageContent;

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
