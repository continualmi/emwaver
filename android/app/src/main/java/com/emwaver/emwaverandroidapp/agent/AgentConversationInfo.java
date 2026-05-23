package com.emwaver.emwaverandroidapp.agent;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import java.util.UUID;

public class AgentConversationInfo {
    @NonNull public final UUID id;
    @Nullable public final String universeId;
    @NonNull public final String title;
    public final long createdAtMs;
    public final long updatedAtMs;

    public AgentConversationInfo(@NonNull UUID id, @Nullable String universeId, @NonNull String title,
                                 long createdAtMs, long updatedAtMs) {
        this.id = id;
        this.universeId = universeId;
        this.title = title;
        this.createdAtMs = createdAtMs;
        this.updatedAtMs = updatedAtMs;
    }

    @NonNull
    public String displayTitle() {
        String t = title != null ? title.trim() : "";
        return !t.isEmpty() ? t : id.toString();
    }
}
