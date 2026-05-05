/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.cloud;

public final class CloudUserFile {
    public final String name;
    public final String etag;
    public final long mtimeMs;
    public final long sizeBytes;
    public final String contentType;

    public CloudUserFile(String name, String etag, long mtimeMs, long sizeBytes, String contentType) {
        this.name = name;
        this.etag = etag;
        this.mtimeMs = mtimeMs;
        this.sizeBytes = sizeBytes;
        this.contentType = contentType;
    }
}
