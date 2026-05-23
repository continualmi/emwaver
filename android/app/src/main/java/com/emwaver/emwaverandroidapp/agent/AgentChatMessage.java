package com.emwaver.emwaverandroidapp.agent;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import java.util.UUID;

public class AgentChatMessage {
    @NonNull public final UUID id;
    @NonNull public final AgentChatRole role;
    @NonNull public final String text;
    public final long createdAtMs;
    @Nullable public final AgentChatToolMeta toolMeta;

    public AgentChatMessage(@NonNull UUID id, @NonNull AgentChatRole role, @NonNull String text,
                            long createdAtMs, @Nullable AgentChatToolMeta toolMeta) {
        this.id = id;
        this.role = role;
        this.text = text;
        this.createdAtMs = createdAtMs;
        this.toolMeta = toolMeta;
    }

    public AgentChatMessage(@NonNull AgentChatRole role, @NonNull String text) {
        this(UUID.randomUUID(), role, text, System.currentTimeMillis(), null);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof AgentChatMessage)) return false;
        return id.equals(((AgentChatMessage) o).id);
    }

    @Override
    public int hashCode() { return id.hashCode(); }
}
