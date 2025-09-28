package com.emwaver.emwaverandroidapp.ui.agent;

import android.content.Context;
import android.content.DialogInterface;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.KeyEvent;
import android.view.LayoutInflater;
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

import com.emwaver.emwaverandroidapp.BuildConfig;
import com.emwaver.emwaverandroidapp.databinding.FragmentAgentBinding;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

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
    private String selectedConversationId;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        httpClient = new OkHttpClient();
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
        return binding.getRoot();
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null;
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
                    loadConversationItems(summary.id);
                }
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
                selectedConversationId = null;
                messages.clear();
                messageAdapter.notifyDataSetChanged();
            }
        });

        binding.createConversationButton.setOnClickListener(v -> promptForConversationTopic());
    }

    private void setupRecycler() {
        messageAdapter = new AgentMessageAdapter(messages);
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

    private void createConversation(String topic) {
        JSONObject body = new JSONObject();
        try {
            JSONObject metadata = new JSONObject();
            metadata.put("topic", TextUtils.isEmpty(topic) ? "Agent Chat" : topic);
            body.put("metadata", metadata);
        } catch (JSONException e) {
            showToast("Failed to build request");
            return;
        }

        sendConversationCreateRequest(body, null);
    }

    private void createConversationWithInitialMessage(String message) {
        JSONObject body = new JSONObject();
        try {
            JSONObject metadata = new JSONObject();
            metadata.put("topic", "Agent Chat");
            body.put("metadata", metadata);

            JSONArray items = new JSONArray();
            JSONObject item = new JSONObject();
            item.put("type", "message");
            item.put("role", "user");
            item.put("content", message);
            items.put(item);
            body.put("items", items);
        } catch (JSONException e) {
            showToast("Failed to build request");
            return;
        }

        sendConversationCreateRequest(body, message);
    }

    private void sendConversationCreateRequest(JSONObject body, @Nullable String initialMessage) {
        String apiKey = resolveApiKey();
        if (TextUtils.isEmpty(apiKey)) {
            showToast("OpenAI API key not configured");
            return;
        }

        Request request = new Request.Builder()
                .url("https://api.openai.com/v1/conversations")
                .addHeader("Authorization", "Bearer " + apiKey)
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
                        showToast("Conversation request failed: " + response.code());
                    });
                    return;
                }

                try {
                    JSONObject json = new JSONObject(responseBody);
                    String conversationId = json.optString("id");
                    if (TextUtils.isEmpty(conversationId)) {
                        runOnUiThread(() -> {
                            toggleLoading(false);
                            showToast("Conversation id missing");
                        });
                        return;
                    }

                    String topic = "Agent Chat";
                    JSONObject metadata = json.optJSONObject("metadata");
                    if (metadata != null) {
                        topic = metadata.optString("topic", topic);
                    }

                    ConversationSummary summary = new ConversationSummary(conversationId, topic);
                    persistConversation(summary);

                    String finalTopic = topic;
                    runOnUiThread(() -> {
                        toggleLoading(false);
                        addConversationToSpinner(summary, true);
                        if (!TextUtils.isEmpty(initialMessage)) {
                            appendLocalMessage(new MessageItem("user", initialMessage));
                            sendMessageToConversation(conversationId, initialMessage);
                        }
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
        String apiKey = resolveApiKey();
        if (TextUtils.isEmpty(apiKey)) {
            showToast("OpenAI API key not configured");
            return;
        }

        JSONObject body = new JSONObject();
        try {
            body.put("model", "gpt-4.1");
            body.put("input", message);
            body.put("conversation", conversationId);
        } catch (JSONException e) {
            showToast("Failed to build request");
            return;
        }

        Request request = new Request.Builder()
                .url("https://api.openai.com/v1/responses")
                .addHeader("Authorization", "Bearer " + apiKey)
                .addHeader("Content-Type", "application/json")
                .post(RequestBody.create(body.toString(), JSON_MEDIA_TYPE))
                .build();

        toggleLoading(true);
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                runOnUiThread(() -> {
                    toggleLoading(false);
                    showToast("Failed to send message");
                });
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) throws IOException {
                String responseBody = response.body() != null ? response.body().string() : "";
                if (!response.isSuccessful()) {
                    runOnUiThread(() -> {
                        toggleLoading(false);
                        showToast("Message request failed: " + response.code());
                    });
                    return;
                }

                try {
                    JSONObject json = new JSONObject(responseBody);
                    JSONArray output = json.optJSONArray("output");
                    if (output != null) {
                        for (int i = 0; i < output.length(); i++) {
                            JSONObject item = output.getJSONObject(i);
                            if (!"message".equals(item.optString("type"))) {
                                continue;
                            }
                            String role = item.optString("role", "assistant");
                            JSONArray contentArray = item.optJSONArray("content");
                            if (contentArray == null) {
                                continue;
                            }
                            StringBuilder builder = new StringBuilder();
                            for (int j = 0; j < contentArray.length(); j++) {
                                JSONObject contentItem = contentArray.getJSONObject(j);
                                if ("output_text".equals(contentItem.optString("type"))) {
                                    builder.append(contentItem.optString("text"));
                                }
                            }
                            String text = builder.toString().trim();
                            if (!text.isEmpty()) {
                                MessageItem messageItem = new MessageItem(role, text);
                                runOnUiThread(() -> appendLocalMessage(messageItem));
                            }
                        }
                    }
                    runOnUiThread(() -> toggleLoading(false));
                } catch (JSONException e) {
                    runOnUiThread(() -> {
                        toggleLoading(false);
                        showToast("Invalid response payload");
                    });
                }
            }
        });
    }

    private void loadConversationItems(String conversationId) {
        String apiKey = resolveApiKey();
        if (TextUtils.isEmpty(apiKey)) {
            showToast("OpenAI API key not configured");
            return;
        }

        Request request = new Request.Builder()
                .url("https://api.openai.com/v1/conversations/" + conversationId + "/items?limit=50")
                .addHeader("Authorization", "Bearer " + apiKey)
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
                        showToast("Conversation load failed: " + response.code());
                    });
                    return;
                }

                try {
                    JSONObject json = new JSONObject(responseBody);
                    JSONArray data = json.optJSONArray("data");
                    List<MessageItem> loaded = new ArrayList<>();
                    if (data != null) {
                        for (int i = 0; i < data.length(); i++) {
                            JSONObject item = data.getJSONObject(i);
                            if (!"message".equals(item.optString("type"))) {
                                continue;
                            }
                            String role = item.optString("role", "assistant");
                            JSONArray contentArray = item.optJSONArray("content");
                            if (contentArray == null) {
                                continue;
                            }
                            StringBuilder builder = new StringBuilder();
                            for (int j = 0; j < contentArray.length(); j++) {
                                JSONObject contentItem = contentArray.getJSONObject(j);
                                if ("input_text".equals(contentItem.optString("type")) ||
                                        "output_text".equals(contentItem.optString("type"))) {
                                    builder.append(contentItem.optString("text"));
                                }
                            }
                            String text = builder.toString().trim();
                            if (!text.isEmpty()) {
                                long created = item.optLong("created_at", System.currentTimeMillis());
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

    private void appendLocalMessage(MessageItem item) {
        messages.add(item);
        if (binding != null) {
            messageAdapter.notifyItemInserted(messages.size() - 1);
            binding.messageList.scrollToPosition(messages.size() - 1);
        }
    }

    private void toggleLoading(boolean loading) {
        if (binding == null) {
            return;
        }
        binding.loadingIndicator.setVisibility(loading ? View.VISIBLE : View.GONE);
        binding.sendButton.setEnabled(!loading);
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

        List<String> labels = new ArrayList<>();
        for (ConversationSummary conversation : conversations) {
            labels.add(conversation.label);
        }
        conversationAdapter.clear();
        conversationAdapter.addAll(labels);
        conversationAdapter.notifyDataSetChanged();

        if (select) {
            binding.conversationSpinner.setSelection(conversations.indexOf(summary));
        }
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
                String label = item.optString("label");
                if (!TextUtils.isEmpty(id) && !TextUtils.isEmpty(label)) {
                    conversations.add(new ConversationSummary(id, label));
                }
            }
            addConversationToSpinnerListOnly();
        } catch (JSONException ignored) {
        }
    }

    private void addConversationToSpinnerListOnly() {
        List<String> labels = new ArrayList<>();
        for (ConversationSummary conversation : conversations) {
            labels.add(conversation.label);
        }
        conversationAdapter.clear();
        conversationAdapter.addAll(labels);
        conversationAdapter.notifyDataSetChanged();
    }

    private void persistConversation(ConversationSummary summary) {
        if (!isAdded()) {
            return;
        }
        Context context = requireContext();
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

        JSONArray array = new JSONArray();
        for (ConversationSummary item : copy) {
            JSONObject obj = new JSONObject();
            try {
                obj.put("id", item.id);
                obj.put("label", item.label);
                array.put(obj);
            } catch (JSONException ignored) {
            }
        }

        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(PREF_CONVERSATIONS, array.toString())
                .apply();
    }

    private String resolveApiKey() {
        String key = BuildConfig.OPENAI_API_KEY;
        if (!TextUtils.isEmpty(key)) {
            return key;
        }
        String envKey = System.getenv("OPENAI_API_KEY");
        return TextUtils.isEmpty(envKey) ? "" : envKey;
    }

    private static class ConversationSummary {
        final String id;
        final String label;

        ConversationSummary(String id, String topic) {
            this.id = id;
            String sanitized = TextUtils.isEmpty(topic) ? "Agent Chat" : topic;
            if (sanitized.length() > 40) {
                sanitized = sanitized.substring(0, 40) + "…";
            }
            this.label = sanitized;
        }
    }

    private static class MessageItem {
        final String role;
        final String content;
        final long createdAt;

        MessageItem(String role, String content) {
            this(role, content, System.currentTimeMillis());
        }

        MessageItem(String role, String content, long createdAt) {
            this.role = role;
            this.content = content;
            this.createdAt = createdAt;
        }
    }

    private static class AgentMessageAdapter extends androidx.recyclerview.widget.RecyclerView.Adapter<AgentMessageAdapter.MessageViewHolder> {

        private final List<MessageItem> items;

        AgentMessageAdapter(List<MessageItem> items) {
            this.items = items;
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
            holder.binding.messageRole.setText(capitalize(item.role));
            holder.binding.messageContent.setText(item.content);
        }

        @Override
        public int getItemCount() {
            return items.size();
        }

        private static String capitalize(String input) {
            if (TextUtils.isEmpty(input)) {
                return "Assistant";
            }
            return Character.toUpperCase(input.charAt(0)) + input.substring(1);
        }

        static class MessageViewHolder extends androidx.recyclerview.widget.RecyclerView.ViewHolder {
            final com.emwaver.emwaverandroidapp.databinding.ItemAgentMessageBinding binding;

            MessageViewHolder(com.emwaver.emwaverandroidapp.databinding.ItemAgentMessageBinding binding) {
                super(binding.getRoot());
                this.binding = binding;
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

        void show() {
            builder.show();
        }

        interface DialogCallback {
            void onClick(DialogInterface dialog, int which, String text);
        }
    }
}
