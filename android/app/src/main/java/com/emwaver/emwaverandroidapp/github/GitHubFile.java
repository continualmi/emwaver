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

package com.emwaver.emwaverandroidapp.github;

public class GitHubFile {
    public final String name;
    public final String type; // "file" or "dir"
    public final String path;
    public final String sha;
    public final String downloadUrl;
    public final long size;
    
    public GitHubFile(String name, String type, String path, String sha, String downloadUrl, long size) {
        this.name = name;
        this.type = type;
        this.path = path;
        this.sha = sha;
        this.downloadUrl = downloadUrl;
        this.size = size;
    }
    
    public boolean isDirectory() {
        return "dir".equals(type);
    }
    
    public boolean isFile() {
        return "file".equals(type);
    }
}
