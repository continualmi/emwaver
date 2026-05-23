package com.emwaver.emwaverandroidapp.agent;

import androidx.annotation.NonNull;
import java.util.Map;

public class AgentToolDefinition {
    @NonNull public final String name;
    @NonNull public final String description;
    @NonNull public final Map<String, AgentToolJSON> parameters;

    public AgentToolDefinition(@NonNull String name, @NonNull String description,
                               @NonNull Map<String, AgentToolJSON> parameters) {
        this.name = name;
        this.description = description;
        this.parameters = parameters;
    }
}
