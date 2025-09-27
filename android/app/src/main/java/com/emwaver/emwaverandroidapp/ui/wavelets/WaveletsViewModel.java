package com.emwaver.emwaverandroidapp.ui.wavelets;

import androidx.lifecycle.ViewModel;

public final class WaveletsViewModel extends ViewModel {
    private String lastScriptContent;
    private String lastScriptName;
    private boolean previewActive;

    void setLastScriptContent(String content) {
        lastScriptContent = content;
    }

    String getLastScriptContent() {
        return lastScriptContent;
    }

    void setLastScriptName(String name) {
        lastScriptName = name;
    }

    String getLastScriptName() {
        return lastScriptName;
    }

    void setPreviewActive(boolean active) {
        previewActive = active;
    }

    boolean isPreviewActive() {
        return previewActive;
    }
}
