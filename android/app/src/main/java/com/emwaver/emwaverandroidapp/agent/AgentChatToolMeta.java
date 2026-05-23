package com.emwaver.emwaverandroidapp.agent;

import androidx.annotation.Nullable;
import java.util.Map;

public class AgentChatToolMeta {
    @Nullable public final Map<String, AgentToolJSON> arguments;
    @Nullable public final AgentToolJSON output;
    @Nullable public final Boolean ok;

    public AgentChatToolMeta(@Nullable Map<String, AgentToolJSON> arguments,
                             @Nullable AgentToolJSON output,
                             @Nullable Boolean ok) {
        this.arguments = arguments;
        this.output = output;
        this.ok = ok;
    }
}
