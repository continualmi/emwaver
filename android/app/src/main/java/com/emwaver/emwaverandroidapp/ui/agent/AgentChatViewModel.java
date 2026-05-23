/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.ui.agent;

import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.lifecycle.AndroidViewModel;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;

import com.emwaver.emwaverandroidapp.agent.AgentApiKeyStore;
import com.emwaver.emwaverandroidapp.agent.AgentChatMessage;
import com.emwaver.emwaverandroidapp.agent.AgentChatRole;
import com.emwaver.emwaverandroidapp.agent.AgentChatToolMeta;
import com.emwaver.emwaverandroidapp.agent.AgentConfig;
import com.emwaver.emwaverandroidapp.agent.AgentConversationInfo;
import com.emwaver.emwaverandroidapp.agent.AgentEndpointApi;
import com.emwaver.emwaverandroidapp.agent.AgentToolCall;
import com.emwaver.emwaverandroidapp.agent.AgentToolDefinition;
import com.emwaver.emwaverandroidapp.agent.AgentToolResultData;
import com.emwaver.emwaverandroidapp.agent.AgentToolRuntime;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import okhttp3.OkHttpClient;

public class AgentChatViewModel extends AndroidViewModel {

    // ── Observable state ────────────────────────────────────────────

    private final MutableLiveData<List<AgentChatMessage>> messagesLiveData = new MutableLiveData<>(new ArrayList<>());
    private final MutableLiveData<List<AgentConversationInfo>> conversationsLiveData = new MutableLiveData<>(new ArrayList<>());
    private final MutableLiveData<Boolean> isSendingLiveData = new MutableLiveData<>(false);
    private final MutableLiveData<Boolean> isLoadingConversationLiveData = new MutableLiveData<>(false);
    private final MutableLiveData<String> lastErrorLiveData = new MutableLiveData<>(null);

    public LiveData<List<AgentChatMessage>> getMessages() { return messagesLiveData; }
    public LiveData<List<AgentConversationInfo>> getConversations() { return conversationsLiveData; }
    public LiveData<Boolean> getIsSending() { return isSendingLiveData; }
    public LiveData<Boolean> getIsLoadingConversation() { return isLoadingConversationLiveData; }
    public LiveData<String> getLastError() { return lastErrorLiveData; }

    // ── Internal state ──────────────────────────────────────────────

    private static final String PREFS = "emwaver";
    private static final String KEY_CONVERSATION_ID = "emwaver.agent.conversationId";
    private static final String KEY_UNIVERSE_ID = "emwaver.agent.universeId";
    private static final String PUBLIC_MODEL_ALIAS = "emw-1-lite-frozen";
    private static final String STORED_PROMPT_NAME = "emwaver-prompt";

    private final OkHttpClient http = new OkHttpClient();
    private final AgentEndpointApi api;
    private final String localPrompt;

    @Nullable private String conversationIdStr;
    @Nullable private String universeId;
    @Nullable private AgentToolRuntime toolRuntime;
    @Nullable private String scriptName;
    @Nullable private String scriptSource;
    private volatile boolean stopRequested;

    public AgentChatViewModel(@NonNull Application application) {
        super(application);
        api = new AgentEndpointApi(application, http);
        localPrompt = loadPromptAsset(application);
    }

    // ── Public API ──────────────────────────────────────────────────

    public void configureToolRuntime(@Nullable AgentToolRuntime runtime) {
        this.toolRuntime = runtime;
    }

    public void setScriptContext(@Nullable String name, @Nullable String source) {
        this.scriptName = name;
        this.scriptSource = source;
    }

    @Nullable
    public UUID getSelectedConversationId() {
        if (conversationIdStr == null) return null;
        try { return UUID.fromString(conversationIdStr); } catch (Exception e) { return null; }
    }

    public boolean isAgentConfigured() {
        Context ctx = getApplication();
        AgentApiKeyStore keyStore = AgentApiKeyStore.getInstance();
        keyStore.ensureInitialized(ctx);
        String token = keyStore.getAgentApiKey();
        if (token == null || token.trim().isEmpty()) return false;
        String endpoint = AgentConfig.getAgentEndpoint();
        return !endpoint.trim().isEmpty();
    }

    public void bootstrap() {
        loadStoredConversations();
    }

    public void refreshConversations() {
        Context ctx = getApplication();
        AgentApiKeyStore keyStore = AgentApiKeyStore.getInstance();
        keyStore.ensureInitialized(ctx);

        String token = keyStore.getAgentApiKey();
        if (token.trim().isEmpty()) {
            postError("Configure an Agent API key to enable Agent replies. Local scripts continue to run without it.");
            return;
        }
        String endpoint = AgentConfig.getAgentEndpoint();

        new Thread(() -> {
            try {
                List<AgentConversationInfo> list = api.listConversations(endpoint, token);
                conversationsLiveData.postValue(list);
            } catch (Exception e) {
                postError(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }).start();
    }

    public void newChat() {
        conversationIdStr = null;
        universeId = null;
        persistState(getApplication());
        clear();
        // Create a fresh local conversation entry
        AgentConversationInfo info = api.createConversation(
                AgentConfig.getAgentEndpoint(), "", "Chat");
        conversationIdStr = info.id.toString();
        persistState(getApplication());
        List<AgentConversationInfo> current = new ArrayList<>(getCurrentConversations());
        current.add(0, info);
        conversationsLiveData.postValue(current);
    }

    public void selectConversation(@NonNull UUID id) {
        conversationIdStr = id.toString();
        universeId = null;
        persistState(getApplication());
        loadConversation(id);
    }

    public void deleteConversation(@NonNull UUID id) {
        Context ctx = getApplication();
        AgentApiKeyStore keyStore = AgentApiKeyStore.getInstance();
        keyStore.ensureInitialized(ctx);

        String token = keyStore.getAgentApiKey();
        if (token.trim().isEmpty()) {
            postError("Configure an Agent API key to enable Agent replies.");
            return;
        }
        String endpoint = AgentConfig.getAgentEndpoint();
        api.deleteConversation(endpoint, token, id.toString());

        List<AgentConversationInfo> current = new ArrayList<>(getCurrentConversations());
        current.removeIf(c -> c.id.equals(id));
        conversationsLiveData.postValue(current);

        if (id.toString().equals(conversationIdStr)) {
            newChat();
        }
    }

    public void clear() {
        messagesLiveData.postValue(new ArrayList<>());
        lastErrorLiveData.postValue(null);
    }

    public void send(@NonNull String text) {
        String trimmed = text.trim();
        if (trimmed.isEmpty()) return;
        if (Boolean.TRUE.equals(isSendingLiveData.getValue())) return;

        lastErrorLiveData.postValue(null);
        stopRequested = false;

        // Optimistic user message
        AgentChatMessage userMsg = new AgentChatMessage(AgentChatRole.USER, trimmed);
        appendMessage(userMsg);

        // Placeholder agent message
        AgentChatMessage placeholder = new AgentChatMessage(AgentChatRole.ASSISTANT, "");
        UUID placeholderId = placeholder.id;
        appendMessage(placeholder);

        isSendingLiveData.postValue(true);

        new Thread(() -> {
            try {
                Context ctx = getApplication();
                AgentApiKeyStore keyStore = AgentApiKeyStore.getInstance();
                keyStore.ensureInitialized(ctx);

                String token = keyStore.getAgentApiKey();
                if (token.trim().isEmpty()) {
                    postError("Configure an Agent API key to enable Agent replies. Local scripts continue to run without it.");
                    isSendingLiveData.postValue(false);
                    return;
                }

                String endpoint = AgentConfig.getAgentEndpoint();

                // Ensure universe
                String univ = ensureUniverse(endpoint, token);
                if (univ == null) {
                    isSendingLiveData.postValue(false);
                    return;
                }

                // Ensure conversation
                String convoId = ensureConversationId(endpoint, token, trimmed);

                // Persist user message
                persistMessage(userMsg, convoId);

                // Build tool prompt
                String userInput = buildFullUserInput(trimmed);

                // Send with tool loop
                sendWithToolLoop(endpoint, token, univ, convoId, userInput, placeholderId);

            } catch (Exception e) {
                postError(e.getMessage() != null ? e.getMessage() : e.toString());
                isSendingLiveData.postValue(false);
            }
        }).start();
    }

    public void stop() {
        stopRequested = true;
    }

    // ── Internal ────────────────────────────────────────────────────

    private void sendWithToolLoop(@NonNull String endpoint, @NonNull String token,
                                  @NonNull String universe, @NonNull String convoId,
                                  @NonNull String userInput, @NonNull UUID placeholderId) throws Exception {
        List<AgentToolDefinition> tools = toolRuntime != null ? toolRuntime.tools() : null;
        boolean hasTools = tools != null && !tools.isEmpty();
        String toolChoice = hasTools ? "auto" : null;

        AgentEndpointApi.SendRequest request = new AgentEndpointApi.SendRequest(
                PUBLIC_MODEL_ALIAS, universe, userInput,
                tools, toolChoice, null, localPrompt);

        final Object lock = new Object();
        final boolean[] done = {false};
        final String[] error = {null};
        final List<AgentToolResultData>[] accumulatedResults = new List[]{new ArrayList<>()};

        while (!done[0] && !stopRequested) {
            done[0] = false;
            error[0] = null;

            // Build request with accumulated tool results
            AgentEndpointApi.SendRequest currentRequest;
            if (accumulatedResults[0].isEmpty()) {
                currentRequest = request;
            } else {
                currentRequest = new AgentEndpointApi.SendRequest(
                        PUBLIC_MODEL_ALIAS, universe, userInput,
                        tools, "auto", accumulatedResults[0], localPrompt);
            }

            api.send(endpoint, token, currentRequest, new AgentEndpointApi.StreamListener() {
                @Override
                public void onDelta(@NonNull String text) {
                    if (!text.isEmpty()) {
                        updateLastAgentMessage(text, placeholderId);
                    }
                }

                @Override
                public void onDone(@NonNull AgentChatMessage message, @Nullable String model) {
                    synchronized (lock) {
                        replaceMessage(placeholderId, message, convoId);
                        done[0] = true;
                        lock.notify();
                    }
                }

                @Override
                public void onToolCalls(@NonNull List<AgentToolCall> toolCalls) {
                    if (toolRuntime == null) {
                        synchronized (lock) {
                            error[0] = "Agent requested a tool, but local tools are not available.";
                            done[0] = true;
                            lock.notify();
                        }
                        return;
                    }
                    // Remove placeholder, then process tools
                    removeLastAgentPlaceholder(placeholderId);

                    for (AgentToolCall call : toolCalls) {
                        if (stopRequested) break;
                        AgentChatToolMeta bubbleMeta = new AgentChatToolMeta(
                                call.arguments, null, null);
                        String bubbleText = makeToolBubbleText(call.name, call.arguments);
                        AgentChatMessage toolBubble = new AgentChatMessage(
                                UUID.randomUUID(), AgentChatRole.SYSTEM, bubbleText,
                                System.currentTimeMillis(), bubbleMeta);
                        appendMessage(toolBubble);
                        persistMessage(toolBubble, convoId);

                        Map<String, com.emwaver.emwaverandroidapp.agent.AgentToolJSON> args =
                                call.arguments != null ? call.arguments : new HashMap<>();
                        AgentToolResultData result = toolRuntime.execute(call.name, args);

                        // Update bubble with result
                        AgentChatToolMeta updatedMeta = new AgentChatToolMeta(
                                call.arguments, result.output, result.ok);
                        AgentChatMessage updatedBubble = new AgentChatMessage(
                                toolBubble.id, AgentChatRole.SYSTEM, bubbleText,
                                toolBubble.createdAtMs, updatedMeta);
                        replaceMessageInList(toolBubble.id, updatedBubble);
                        persistMessage(updatedBubble, convoId);

                        accumulatedResults[0].add(result);
                    }

                    // Add a fresh placeholder for the next assistant response
                    AgentChatMessage newPlaceholder = new AgentChatMessage(AgentChatRole.ASSISTANT, "");
                    appendMessage(newPlaceholder);

                    // Re-sync placeholderId for potential next update
                    // (Tool loop will be handled by re-issuing the request)
                    synchronized (lock) {
                        done[0] = false;
                        lock.notify();
                    }
                }

                @Override
                public void onError(@NonNull String err) {
                    synchronized (lock) {
                        error[0] = err;
                        done[0] = true;
                        lock.notify();
                    }
                }
            });

            // Wait for response
            synchronized (lock) {
                try { lock.wait(120_000); } catch (InterruptedException e) { break; }
            }

            if (error[0] != null) {
                postError(error[0]);
                break;
            }

            if (stopRequested) break;

            // If we got tool calls, the listener already handled it and we loop again
        }

        isSendingLiveData.postValue(false);
        refreshConversations();
    }

    @NonNull
    private String ensureUniverse(@NonNull String endpoint, @NonNull String token) throws Exception {
        // Load from saved state
        if (universeId == null) {
            String saved = loadUniverseId(getApplication());
            if (saved != null) universeId = saved;
        }
        if (universeId != null && !universeId.trim().isEmpty()) return universeId;

        // Create a new universe
        String created = api.createUniverse(endpoint, token, STORED_PROMPT_NAME, "EMWaver Agent");
        if (created.trim().isEmpty()) throw new Exception("Failed to create universe");
        universeId = created;
        persistUniverseId(getApplication(), created);
        return created;
    }

    @NonNull
    private String ensureConversationId(@NonNull String endpoint, @NonNull String token,
                                        @NonNull String firstMessage) {
        if (conversationIdStr != null && !conversationIdStr.trim().isEmpty())
            return conversationIdStr;

        String title = firstMessage.split("\\n")[0];
        AgentConversationInfo convo = api.createConversation(endpoint, token, title);
        conversationIdStr = convo.id.toString();
        persistState(getApplication());

        List<AgentConversationInfo> current = new ArrayList<>(getCurrentConversations());
        current.add(0, convo);
        conversationsLiveData.postValue(current);
        return conversationIdStr;
    }

    @NonNull
    private String buildFullUserInput(@NonNull String message) {
        String baseInput = AgentEndpointApi.buildUserInput(message, scriptName, scriptSource);
        if (toolRuntime != null) {
            String context = toolRuntime.context().trim();
            if (!context.isEmpty()) {
                baseInput += "\n\nEMWaver local tool context:\n" + context;
            }
        }
        return baseInput;
    }

    @NonNull
    private String makeToolBubbleText(@NonNull String name,
                                      @Nullable Map<String, com.emwaver.emwaverandroidapp.agent.AgentToolJSON> args) {
        String detail = null;
        if (args != null) {
            com.emwaver.emwaverandroidapp.agent.AgentToolJSON scriptId = args.get("scriptId");
            if (scriptId != null && scriptId.asString() != null) detail = scriptId.asString();
        }
        if (detail != null && !detail.isEmpty()) {
            return "[tool] " + name + " " + detail;
        }
        return "[tool] " + name;
    }

    // ── Message list management ─────────────────────────────────────

    private void appendMessage(@NonNull AgentChatMessage msg) {
        List<AgentChatMessage> current = new ArrayList<>(getCurrentMessages());
        current.add(msg);
        messagesLiveData.postValue(current);
    }

    private void updateLastAgentMessage(@NonNull String newText, @NonNull UUID placeholderId) {
        List<AgentChatMessage> current = new ArrayList<>(getCurrentMessages());
        for (int i = current.size() - 1; i >= 0; i--) {
            if (current.get(i).role == AgentChatRole.ASSISTANT && current.get(i).id.equals(placeholderId)) {
                AgentChatMessage updated = new AgentChatMessage(
                        current.get(i).id, AgentChatRole.ASSISTANT, newText,
                        current.get(i).createdAtMs, current.get(i).toolMeta);
                current.set(i, updated);
                messagesLiveData.postValue(current);
                return;
            }
        }
    }

    private void removeLastAgentPlaceholder(@NonNull UUID placeholderId) {
        List<AgentChatMessage> current = new ArrayList<>(getCurrentMessages());
        for (int i = current.size() - 1; i >= 0; i--) {
            AgentChatMessage msg = current.get(i);
            if (msg.role == AgentChatRole.ASSISTANT && msg.id.equals(placeholderId)) {
                current.remove(i);
                messagesLiveData.postValue(current);
                return;
            }
        }
    }

    private void replaceMessage(@NonNull UUID id, @NonNull AgentChatMessage newMsg,
                                @NonNull String convoId) {
        replaceMessageInList(id, newMsg);
        persistMessage(newMsg, convoId);
    }

    private void replaceMessageInList(@NonNull UUID id, @NonNull AgentChatMessage newMsg) {
        List<AgentChatMessage> current = new ArrayList<>(getCurrentMessages());
        for (int i = current.size() - 1; i >= 0; i--) {
            if (current.get(i).id.equals(id)) {
                current.set(i, newMsg);
                messagesLiveData.postValue(current);
                return;
            }
        }
    }

    private void persistMessage(@NonNull AgentChatMessage msg, @NonNull String convoId) {
        com.emwaver.emwaverandroidapp.agent.AgentChatStore store =
                com.emwaver.emwaverandroidapp.agent.AgentChatStore.getInstance(getApplication());
        store.upsertMessage(convoId, msg);
    }

    @NonNull
    private List<AgentChatMessage> getCurrentMessages() {
        List<AgentChatMessage> c = messagesLiveData.getValue();
        return c != null ? c : Collections.emptyList();
    }

    @NonNull
    private List<AgentConversationInfo> getCurrentConversations() {
        List<AgentConversationInfo> c = conversationsLiveData.getValue();
        return c != null ? c : Collections.emptyList();
    }

    // ── Persistence ─────────────────────────────────────────────────

    private void loadStoredConversations() {
        new Thread(() -> {
            try {
                com.emwaver.emwaverandroidapp.agent.AgentChatStore store =
                        com.emwaver.emwaverandroidapp.agent.AgentChatStore.getInstance(getApplication());
                List<AgentConversationInfo> stored = store.listConversations();

                // Load selected conversation
                String savedId = loadConversationId(getApplication());
                if (savedId != null) {
                    conversationIdStr = savedId;
                    universeId = loadUniverseId(getApplication());
                }

                conversationsLiveData.postValue(stored);

                // Load messages if we have a selected conversation
                if (conversationIdStr != null) {
                    List<AgentChatMessage> msgs = store.listMessages(conversationIdStr);
                    messagesLiveData.postValue(msgs);
                }
            } catch (Exception e) {
                // ignore
            }
        }).start();
    }

    private void loadConversation(@NonNull UUID id) {
        isLoadingConversationLiveData.postValue(true);
        messagesLiveData.postValue(new ArrayList<>());

        new Thread(() -> {
            try {
                com.emwaver.emwaverandroidapp.agent.AgentChatStore store =
                        com.emwaver.emwaverandroidapp.agent.AgentChatStore.getInstance(getApplication());
                List<AgentChatMessage> msgs = store.listMessages(id.toString());
                messagesLiveData.postValue(msgs);
            } catch (Exception e) {
                // ignore
            }
            isLoadingConversationLiveData.postValue(false);
        }).start();
    }

    private void persistState(@NonNull Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        if (conversationIdStr != null && !conversationIdStr.trim().isEmpty()) {
            editor.putString(KEY_CONVERSATION_ID, conversationIdStr);
        } else {
            editor.remove(KEY_CONVERSATION_ID);
        }
        if (universeId != null && !universeId.trim().isEmpty()) {
            editor.putString(KEY_UNIVERSE_ID, universeId);
        } else {
            editor.remove(KEY_UNIVERSE_ID);
        }
        editor.apply();
    }

    private void persistUniverseId(@NonNull Context ctx, @NonNull String univ) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY_UNIVERSE_ID, univ).apply();
    }

    @Nullable
    private static String loadConversationId(@NonNull Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String v = prefs.getString(KEY_CONVERSATION_ID, "");
        if (v == null) return null;
        v = v.trim();
        return v.isEmpty() ? null : v;
    }

    @Nullable
    private static String loadUniverseId(@NonNull Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String v = prefs.getString(KEY_UNIVERSE_ID, null);
        if (v == null) return null;
        v = v.trim();
        return v.isEmpty() ? null : v;
    }

    @Nullable
    private static String loadPromptAsset(@NonNull Context ctx) {
        // Prompt is optional — app ships without it and server uses stored prompt by name.
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(ctx.getAssets().open("emwaver-prompt.txt"),
                        StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append('\n');
            }
            String text = sb.toString().trim();
            return text.isEmpty() ? null : text;
        } catch (Exception e) {
            // Prompt asset is not bundled — that's fine; server resolves via stored prompt name.
            return null;
        }
    }

    private void postError(@NonNull String msg) {
        lastErrorLiveData.postValue(msg);
    }
}
