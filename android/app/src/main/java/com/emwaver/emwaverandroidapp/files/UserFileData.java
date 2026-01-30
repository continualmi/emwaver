/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.files;

public final class UserFileData {

    private final UserFileMetadata metadata;
    private final String textContent;
    private final byte[] binaryContent;

    public UserFileData(UserFileMetadata metadata, String textContent, byte[] binaryContent) {
        this.metadata = metadata;
        this.textContent = textContent;
        this.binaryContent = binaryContent;
    }

    public UserFileMetadata getMetadata() {
        return metadata;
    }

    public boolean hasTextContent() {
        return textContent != null;
    }

    public String getTextContent() {
        return textContent;
    }

    public boolean hasBinaryContent() {
        return binaryContent != null;
    }

    public byte[] getBinaryContent() {
        return binaryContent;
    }
}
