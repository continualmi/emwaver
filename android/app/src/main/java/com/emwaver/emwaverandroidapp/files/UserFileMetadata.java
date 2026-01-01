/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.emwaver.emwaverandroidapp.files;

import org.json.JSONException;
import org.json.JSONObject;

public final class UserFileMetadata {

    private final String id;
    private final String name;
    private final String extension;
    private final String kind;
    private final String etag;
    private final long sizeBytes;
    private final String contentType;

    public UserFileMetadata(
        String id,
        String name,
        String extension,
        String kind,
        String etag,
        long sizeBytes,
        String contentType
    ) {
        this.id = id;
        this.name = name;
        this.extension = extension;
        this.kind = kind;
        this.etag = etag;
        this.sizeBytes = sizeBytes;
        this.contentType = contentType;
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getExtension() {
        return extension;
    }

    public String getKind() {
        return kind;
    }

    public String getEtag() {
        return etag;
    }

    public long getSizeBytes() {
        return sizeBytes;
    }

    public String getContentType() {
        return contentType;
    }

    public UserFileMetadata withUpdatedMeta(String name, String etag, long sizeBytes) {
        return new UserFileMetadata(id, name, extension, kind, etag, sizeBytes, contentType);
    }

    public static UserFileMetadata fromJson(JSONObject json) throws JSONException {
        String id = json.optString("id", null);
        String name = json.optString("name", "");
        String extension = json.optString("extension", "");
        String kind = json.optString("kind", "file");
        String etag = json.optString("etag", null);
        long sizeBytes = json.has("size_bytes") ? json.optLong("size_bytes", 0L) : json.optLong("sizeBytes", 0L);
        String contentType = json.optString("content_type", null);
        return new UserFileMetadata(id, name, extension, kind, etag, sizeBytes, contentType);
    }
}
