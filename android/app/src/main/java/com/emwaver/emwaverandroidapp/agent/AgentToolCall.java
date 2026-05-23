package com.emwaver.emwaverandroidapp.agent;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import java.util.Map;

public class AgentToolCall {
    @Nullable public final String id;
    @Nullable public final String callId;
    @NonNull public final String name;
    @Nullable public final Map<String, AgentToolJSON> arguments;

    public AgentToolCall(@Nullable String id, @Nullable String callId, @NonNull String name,
                         @Nullable Map<String, AgentToolJSON> arguments) {
        this.id = id;
        this.callId = callId;
        this.name = name;
        this.arguments = arguments;
    }
}
