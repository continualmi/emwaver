package com.emwaver.emwaverandroidapp.agent;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import java.util.Map;

public class AgentToolResultData {
    @Nullable public final String id;
    @Nullable public final String callId;
    @NonNull public final String name;
    @Nullable public final Map<String, AgentToolJSON> arguments;
    @Nullable public final AgentToolJSON output;
    public final boolean ok;
    @Nullable public final AgentToolJSON result;
    @Nullable public final String error;

    public AgentToolResultData(@Nullable String id, @Nullable String callId, @NonNull String name,
                               @Nullable Map<String, AgentToolJSON> arguments,
                               @Nullable AgentToolJSON output, boolean ok,
                               @Nullable AgentToolJSON result, @Nullable String error) {
        this.id = id;
        this.callId = callId;
        this.name = name;
        this.arguments = arguments;
        this.output = output;
        this.ok = ok;
        this.result = result;
        this.error = error;
    }
}
