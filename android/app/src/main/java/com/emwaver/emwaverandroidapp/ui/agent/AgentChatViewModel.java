/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.ui.agent;

import androidx.annotation.NonNull;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class AgentChatViewModel extends ViewModel {

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

    private final MutableLiveData<List<Message>> messagesLiveData = new MutableLiveData<>(new ArrayList<>());

    public LiveData<List<Message>> getMessages() {
        return messagesLiveData;
    }

    public void clear() {
        messagesLiveData.setValue(new ArrayList<>());
    }

    public void sendUserMessage(@NonNull String text) {
        String trimmed = text.trim();
        if (trimmed.isEmpty()) {
            return;
        }

        List<Message> updated = new ArrayList<>(getCurrent());
        updated.add(new Message(Role.USER, trimmed));
        updated.add(new Message(Role.AGENT, buildStubResponse(trimmed)));
        messagesLiveData.setValue(updated);
    }

    @NonNull
    private List<Message> getCurrent() {
        List<Message> current = messagesLiveData.getValue();
        if (current == null) {
            return Collections.emptyList();
        }
        return current;
    }

    @NonNull
    private String buildStubResponse(@NonNull String userText) {
        return "Agent UI is wired up on Android. Next step: connect this panel to script actions (create/edit/run) and a model backend.\n\n" +
               "You said: " + userText;
    }
}
