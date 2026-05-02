/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
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

import com.emwaver.emwaverandroidapp.cloud.CloudAuthManager;
import com.emwaver.emwaverandroidapp.cloud.CloudConfig;
import com.emwaver.emwaverandroidapp.cloud.agent.AgentBackendApi;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import okhttp3.OkHttpClient;

public class AgentChatViewModel extends AndroidViewModel {

    public enum Role {
        USER,
        AGENT
    }

    public static final class Message {
        @NonNull public final Role role;
        @NonNull public final String text;

        public Message(@NonNull Role role, @NonNull String text) {
            this.role = role;
            this.text = text;
        }
    }

    private static final String PREFS = "emwaver";
    private static final String KEY_CONVERSATION_ID = "emwaver.agent.conversationId";

    private final MutableLiveData<List<Message>> messagesLiveData = new MutableLiveData<>(new ArrayList<>());
    private final MutableLiveData<List<AgentBackendApi.Conversation>> conversationsLiveData = new MutableLiveData<>(new ArrayList<>());
    private final MutableLiveData<Boolean> isSendingLiveData = new MutableLiveData<>(false);
    private final MutableLiveData<String> lastErrorLiveData = new MutableLiveData<>(null);

    private final OkHttpClient http = new OkHttpClient();
    private final AgentBackendApi api = new AgentBackendApi(http);

    private String conversationId;

    public AgentChatViewModel(@NonNull Application application) {
        super(application);
        conversationId = loadConversationId(application);
    }

    public LiveData<List<Message>> getMessages() { return messagesLiveData; }
    public LiveData<List<AgentBackendApi.Conversation>> getConversations() { return conversationsLiveData; }
    public LiveData<Boolean> getIsSending() { return isSendingLiveData; }
    public LiveData<String> getLastError() { return lastErrorLiveData; }

    @Nullable
    public String getConversationId() { return conversationId; }

    public void bootstrap() {
        refreshConversations();
        if (conversationId != null && !conversationId.trim().isEmpty()) {
            loadConversation(conversationId);
        }
    }

    public void refreshConversations() {
        new Thread(() -> {
            try {
                Context ctx = getApplication();
                CloudAuthManager auth = CloudAuthManager.getInstance();
                auth.ensureInitialized(ctx);

                String token = auth.getIdTokenBlocking();
                if (token.trim().isEmpty()) {
                    postError("Configure an Agent API key to enable Agent replies. Local scripts continue to run without it.");
                    return;
                }

                String base = CloudConfig.getBackendBaseUrl(ctx);
                List<AgentBackendApi.Conversation> list = api.listConversations(base, token);
                conversationsLiveData.postValue(list);
            } catch (Exception e) {
                postError(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }).start();
    }

    public void newChat() {
        conversationId = null;
        persistConversationId(getApplication(), null);
        clear();
    }

    public void selectConversation(@NonNull String id) {
        conversationId = id;
        persistConversationId(getApplication(), id);
        clear();
        loadConversation(id);
    }

    public void clear() {
        messagesLiveData.postValue(new ArrayList<>());
        lastErrorLiveData.postValue(null);
    }

    public void loadConversation(@NonNull String id) {
        new Thread(() -> {
            try {
                Context ctx = getApplication();
                CloudAuthManager auth = CloudAuthManager.getInstance();
                auth.ensureInitialized(ctx);

                String token = auth.getIdTokenBlocking();
                if (token.trim().isEmpty()) {
                    postError("Configure an Agent API key to enable Agent replies. Local scripts continue to run without it.");
                    return;
                }

                String base = CloudConfig.getBackendBaseUrl(ctx);
                List<AgentBackendApi.Message> remote = api.listMessages(base, token, id);

                List<Message> mapped = new ArrayList<>();
                for (AgentBackendApi.Message m : remote) {
                    Role r = "user".equalsIgnoreCase(m.role) ? Role.USER : Role.AGENT;
                    mapped.add(new Message(r, m.content));
                }
                messagesLiveData.postValue(mapped);
            } catch (Exception e) {
                postError(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }).start();
    }

    public void sendUserMessage(@NonNull String text) {
        String trimmed = text.trim();
        if (trimmed.isEmpty()) return;
        if (Boolean.TRUE.equals(isSendingLiveData.getValue())) return;

        lastErrorLiveData.postValue(null);

        // optimistic append
        List<Message> updated = new ArrayList<>(getCurrent());
        updated.add(new Message(Role.USER, trimmed));

        // placeholder agent message (will be updated by deltas)
        Message placeholder = new Message(Role.AGENT, "");
        updated.add(placeholder);
        messagesLiveData.postValue(updated);

        isSendingLiveData.postValue(true);

        new Thread(() -> {
            try {
                Context ctx = getApplication();
                CloudAuthManager auth = CloudAuthManager.getInstance();
                auth.ensureInitialized(ctx);

                String token = auth.getIdTokenBlocking();
                if (token.trim().isEmpty()) {
                    postError("Configure an Agent API key to enable Agent replies. Local scripts continue to run without it.");
                    isSendingLiveData.postValue(false);
                    return;
                }

                String base = CloudConfig.getBackendBaseUrl(ctx);

                String convoId = conversationId;
                if (convoId == null || convoId.trim().isEmpty()) {
                    String title = trimmed.split("\\n")[0];
                    AgentBackendApi.Conversation convo = api.createConversation(base, token, title);
                    convoId = convo.id;
                    conversationId = convoId;
                    persistConversationId(ctx, convoId);
                    refreshConversations();
                }

                final StringBuilder accum = new StringBuilder();
                final String finalConvoId = convoId;

                api.chatStream(base, token, finalConvoId, trimmed, new AgentBackendApi.StreamListener() {
                    @Override
                    public void onDelta(@NonNull String t) {
                        if (t.isEmpty()) return;
                        accum.append(t);
                        updateLastAgentMessage(accum.toString());
                    }

                    @Override
                    public void onDone(@NonNull AgentBackendApi.Message message, @Nullable String model) {
                        updateLastAgentMessage(message.content);
                        isSendingLiveData.postValue(false);
                    }

                    @Override
                    public void onError(@NonNull String error) {
                        postError(error);
                        isSendingLiveData.postValue(false);
                    }
                });
            } catch (Exception e) {
                postError(e.getMessage() != null ? e.getMessage() : e.toString());
                isSendingLiveData.postValue(false);
            }
        }).start();
    }

    private void updateLastAgentMessage(@NonNull String newText) {
        List<Message> current = new ArrayList<>(getCurrent());
        for (int i = current.size() - 1; i >= 0; i--) {
            if (current.get(i).role == Role.AGENT) {
                current.set(i, new Message(Role.AGENT, newText));
                messagesLiveData.postValue(current);
                return;
            }
        }
    }

    @NonNull
    private List<Message> getCurrent() {
        List<Message> current = messagesLiveData.getValue();
        if (current == null) return Collections.emptyList();
        return current;
    }

    private void postError(@NonNull String msg) {
        lastErrorLiveData.postValue(msg);
    }

    @Nullable
    private static String loadConversationId(@NonNull Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String v = prefs.getString(KEY_CONVERSATION_ID, "");
        if (v == null) return null;
        v = v.trim();
        return v.isEmpty() ? null : v;
    }

    private static void persistConversationId(@NonNull Context ctx, @Nullable String id) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor e = prefs.edit();
        if (id == null || id.trim().isEmpty()) {
            e.remove(KEY_CONVERSATION_ID);
        } else {
            e.putString(KEY_CONVERSATION_ID, id.trim());
        }
        e.apply();
    }
}
