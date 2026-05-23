package com.emwaver.emwaverandroidapp.agent;

import androidx.annotation.NonNull;

public enum AgentChatRole {
    USER("user"),
    ASSISTANT("assistant"),
    SYSTEM("system");

    @NonNull public final String apiName;
    AgentChatRole(@NonNull String apiName) { this.apiName = apiName; }

    @NonNull
    public static AgentChatRole fromApi(@NonNull String role) {
        switch (role.toLowerCase()) {
            case "user": return USER;
            case "assistant": return ASSISTANT;
            case "system": return SYSTEM;
            default: return USER;
        }
    }
}
