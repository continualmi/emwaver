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

import android.util.Log;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;

public class GitHubApiClient {
    private static final String TAG = "GitHubApiClient";
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    
    private final OkHttpClient httpClient;
    private final Gson gson;
    private final String accessToken;
    
    public GitHubApiClient(String accessToken) {
        this.accessToken = accessToken;
        this.httpClient = new OkHttpClient();
        this.gson = new GsonBuilder().create();
    }
    
    public interface ApiCallback<T> {
        void onSuccess(T result);
        void onError(String message);
    }
    
    // Get authenticated user info
    public void getUser(ApiCallback<GitHubUser> callback) {
        Request request = new Request.Builder()
            .url(GitHubConfig.GITHUB_API_BASE + "/user")
            .addHeader("Authorization", "Bearer " + accessToken)
            .addHeader("Accept", "application/vnd.github.v3+json")
            .build();
        
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                callback.onError("Failed to get user: " + e.getMessage());
            }
            
            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (!response.isSuccessful()) {
                    callback.onError("Failed to get user: " + response.code());
                    return;
                }
                
                ResponseBody body = response.body();
                if (body == null) {
                    callback.onError("Empty response");
                    return;
                }
                
                try {
                    JsonObject json = gson.fromJson(body.string(), JsonObject.class);
                    GitHubUser user = new GitHubUser();
                    user.login = json.has("login") ? json.get("login").getAsString() : null;
                    user.name = json.has("name") ? json.get("name").getAsString() : null;
                    user.avatarUrl = json.has("avatar_url") ? json.get("avatar_url").getAsString() : null;
                    callback.onSuccess(user);
                } catch (Exception e) {
                    callback.onError("Failed to parse user: " + e.getMessage());
                }
            }
        });
    }
    
    // List user repositories
    public void listRepositories(ApiCallback<List<GitHubRepository>> callback) {
        Request request = new Request.Builder()
            .url(GitHubConfig.GITHUB_API_BASE + "/user/repos?sort=updated&per_page=100")
            .addHeader("Authorization", "Bearer " + accessToken)
            .addHeader("Accept", "application/vnd.github.v3+json")
            .build();
        
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                callback.onError("Failed to list repositories: " + e.getMessage());
            }
            
            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (!response.isSuccessful()) {
                    callback.onError("Failed to list repositories: " + response.code());
                    return;
                }
                
                ResponseBody body = response.body();
                if (body == null) {
                    callback.onError("Empty response");
                    return;
                }
                
                try {
                    JsonArray jsonArray = gson.fromJson(body.string(), JsonArray.class);
                    List<GitHubRepository> repos = new ArrayList<>();
                    for (JsonElement element : jsonArray) {
                        JsonObject repoJson = element.getAsJsonObject();
                        GitHubRepository repo = new GitHubRepository();
                        repo.id = repoJson.has("id") ? repoJson.get("id").getAsLong() : 0;
                        repo.name = repoJson.has("name") ? repoJson.get("name").getAsString() : null;
                        repo.fullName = repoJson.has("full_name") ? repoJson.get("full_name").getAsString() : null;
                        repo.owner = repoJson.has("owner") ? repoJson.getAsJsonObject("owner").get("login").getAsString() : null;
                        repo.description = repoJson.has("description") && !repoJson.get("description").isJsonNull() 
                            ? repoJson.get("description").getAsString() : null;
                        repo.isPrivate = repoJson.has("private") ? repoJson.get("private").getAsBoolean() : false;
                        repos.add(repo);
                    }
                    callback.onSuccess(repos);
                } catch (Exception e) {
                    callback.onError("Failed to parse repositories: " + e.getMessage());
                }
            }
        });
    }
    
    // Get repository contents (file tree)
    public void getContents(String owner, String repo, String path, ApiCallback<List<GitHubContent>> callback) {
        String url = GitHubConfig.GITHUB_API_BASE + "/repos/" + owner + "/" + repo + "/contents";
        if (path != null && !path.isEmpty()) {
            url += "/" + path;
        }
        
        Request request = new Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer " + accessToken)
            .addHeader("Accept", "application/vnd.github.v3+json")
            .build();
        
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                callback.onError("Failed to get contents: " + e.getMessage());
            }
            
            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (!response.isSuccessful()) {
                    callback.onError("Failed to get contents: " + response.code());
                    return;
                }
                
                ResponseBody body = response.body();
                if (body == null) {
                    callback.onError("Empty response");
                    return;
                }
                
                try {
                    String bodyString = body.string();
                    JsonElement element = gson.fromJson(bodyString, JsonElement.class);
                    
                    List<GitHubContent> contents = new ArrayList<>();
                    if (element.isJsonArray()) {
                        // Directory listing
                        JsonArray jsonArray = element.getAsJsonArray();
                        for (JsonElement item : jsonArray) {
                            contents.add(parseContent(item.getAsJsonObject()));
                        }
                    } else if (element.isJsonObject()) {
                        // Single file
                        contents.add(parseContent(element.getAsJsonObject()));
                    }
                    
                    callback.onSuccess(contents);
                } catch (Exception e) {
                    callback.onError("Failed to parse contents: " + e.getMessage());
                }
            }
        });
    }
    
    // Get file content (decoded)
    public void getFileContent(String owner, String repo, String path, ApiCallback<String> callback) {
        getContents(owner, repo, path, new ApiCallback<List<GitHubContent>>() {
            @Override
            public void onSuccess(List<GitHubContent> result) {
                if (result.isEmpty()) {
                    callback.onError("File not found");
                    return;
                }
                GitHubContent content = result.get(0);
                if (!"file".equals(content.type)) {
                    callback.onError("Path is not a file");
                    return;
                }
                callback.onSuccess(content.content);
            }
            
            @Override
            public void onError(String message) {
                callback.onError(message);
            }
        });
    }
    
    // Create a new repository
    public void createRepository(String name, String description, boolean isPrivate, ApiCallback<GitHubRepository> callback) {
        JsonObject bodyJson = new JsonObject();
        bodyJson.addProperty("name", name);
        if (description != null && !description.isEmpty()) {
            bodyJson.addProperty("description", description);
        }
        bodyJson.addProperty("private", isPrivate);
        bodyJson.addProperty("auto_init", false); // We'll commit files ourselves
        
        RequestBody body = RequestBody.create(bodyJson.toString(), JSON);
        Request request = new Request.Builder()
            .url(GitHubConfig.GITHUB_API_BASE + "/user/repos")
            .post(body)
            .addHeader("Authorization", "Bearer " + accessToken)
            .addHeader("Accept", "application/vnd.github.v3+json")
            .addHeader("Content-Type", "application/json")
            .build();
        
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                callback.onError("Failed to create repository: " + e.getMessage());
            }
            
            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (!response.isSuccessful()) {
                    ResponseBody errorBody = response.body();
                    String errorMsg = "Failed to create repository: " + response.code();
                    if (errorBody != null) {
                        try {
                            JsonObject errorJson = gson.fromJson(errorBody.string(), JsonObject.class);
                            if (errorJson.has("message")) {
                                errorMsg = errorJson.get("message").getAsString();
                            }
                        } catch (Exception ignored) {}
                    }
                    callback.onError(errorMsg);
                    return;
                }
                
                ResponseBody body = response.body();
                if (body == null) {
                    callback.onError("Empty response");
                    return;
                }
                
                try {
                    JsonObject json = gson.fromJson(body.string(), JsonObject.class);
                    GitHubRepository repo = new GitHubRepository();
                    repo.id = json.has("id") ? json.get("id").getAsLong() : 0;
                    repo.name = json.has("name") ? json.get("name").getAsString() : null;
                    repo.fullName = json.has("full_name") ? json.get("full_name").getAsString() : null;
                    repo.owner = json.has("owner") ? json.getAsJsonObject("owner").get("login").getAsString() : null;
                    repo.description = json.has("description") && !json.get("description").isJsonNull() 
                        ? json.get("description").getAsString() : null;
                    repo.isPrivate = json.has("private") ? json.get("private").getAsBoolean() : false;
                    callback.onSuccess(repo);
                } catch (Exception e) {
                    callback.onError("Failed to parse response: " + e.getMessage());
                }
            }
        });
    }
    
    // Create a new file in repository
    public void createFile(String owner, String repo, String path, String message, String content, ApiCallback<GitHubCommit> callback) {
        JsonObject bodyJson = new JsonObject();
        bodyJson.addProperty("message", message);
        bodyJson.addProperty("content", content);
        
        RequestBody body = RequestBody.create(bodyJson.toString(), JSON);
        Request request = new Request.Builder()
            .url(GitHubConfig.GITHUB_API_BASE + "/repos/" + owner + "/" + repo + "/contents/" + path)
            .put(body)
            .addHeader("Authorization", "Bearer " + accessToken)
            .addHeader("Accept", "application/vnd.github.v3+json")
            .addHeader("Content-Type", "application/json")
            .build();
        
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                callback.onError("Failed to create file: " + e.getMessage());
            }
            
            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (!response.isSuccessful()) {
                    ResponseBody errorBody = response.body();
                    String errorMsg = "Failed to create file: " + response.code();
                    if (errorBody != null) {
                        try {
                            JsonObject errorJson = gson.fromJson(errorBody.string(), JsonObject.class);
                            if (errorJson.has("message")) {
                                errorMsg = errorJson.get("message").getAsString();
                            }
                        } catch (Exception ignored) {}
                    }
                    callback.onError(errorMsg);
                    return;
                }
                
                ResponseBody body = response.body();
                if (body == null) {
                    callback.onError("Empty response");
                    return;
                }
                
                try {
                    JsonObject json = gson.fromJson(body.string(), JsonObject.class);
                    GitHubCommit commit = new GitHubCommit();
                    if (json.has("commit")) {
                        JsonObject commitJson = json.getAsJsonObject("commit");
                        commit.sha = commitJson.has("sha") ? commitJson.get("sha").getAsString() : null;
                        commit.message = commitJson.has("message") ? commitJson.get("message").getAsString() : null;
                    }
                    callback.onSuccess(commit);
                } catch (Exception e) {
                    callback.onError("Failed to parse response: " + e.getMessage());
                }
            }
        });
    }
    
    // Update file content
    public void updateFile(String owner, String repo, String path, String message, String content, String sha, ApiCallback<GitHubCommit> callback) {
        JsonObject bodyJson = new JsonObject();
        bodyJson.addProperty("message", message);
        bodyJson.addProperty("content", content);
        if (sha != null && !sha.isEmpty()) {
            bodyJson.addProperty("sha", sha);
        }
        
        RequestBody body = RequestBody.create(bodyJson.toString(), JSON);
        Request request = new Request.Builder()
            .url(GitHubConfig.GITHUB_API_BASE + "/repos/" + owner + "/" + repo + "/contents/" + path)
            .put(body)
            .addHeader("Authorization", "Bearer " + accessToken)
            .addHeader("Accept", "application/vnd.github.v3+json")
            .addHeader("Content-Type", "application/json")
            .build();
        
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                callback.onError("Failed to update file: " + e.getMessage());
            }
            
            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (!response.isSuccessful()) {
                    ResponseBody errorBody = response.body();
                    String errorMsg = "Failed to update file: " + response.code();
                    if (errorBody != null) {
                        try {
                            JsonObject errorJson = gson.fromJson(errorBody.string(), JsonObject.class);
                            if (errorJson.has("message")) {
                                errorMsg = errorJson.get("message").getAsString();
                            }
                        } catch (Exception ignored) {}
                    }
                    callback.onError(errorMsg);
                    return;
                }
                
                ResponseBody body = response.body();
                if (body == null) {
                    callback.onError("Empty response");
                    return;
                }
                
                try {
                    JsonObject json = gson.fromJson(body.string(), JsonObject.class);
                    GitHubCommit commit = new GitHubCommit();
                    if (json.has("commit")) {
                        JsonObject commitJson = json.getAsJsonObject("commit");
                        commit.sha = commitJson.has("sha") ? commitJson.get("sha").getAsString() : null;
                        commit.message = commitJson.has("message") ? commitJson.get("message").getAsString() : null;
                    }
                    callback.onSuccess(commit);
                } catch (Exception e) {
                    callback.onError("Failed to parse response: " + e.getMessage());
                }
            }
        });
    }
    
    private GitHubContent parseContent(JsonObject json) {
        GitHubContent content = new GitHubContent();
        content.name = json.has("name") ? json.get("name").getAsString() : null;
        content.path = json.has("path") ? json.get("path").getAsString() : null;
        content.type = json.has("type") ? json.get("type").getAsString() : null;
        content.sha = json.has("sha") ? json.get("sha").getAsString() : null;
        content.size = json.has("size") ? json.get("size").getAsLong() : 0;
        
        if (json.has("content") && !json.get("content").isJsonNull()) {
            // Base64 encoded content
            String encoded = json.get("content").getAsString();
            try {
                content.content = new String(android.util.Base64.decode(encoded, android.util.Base64.DEFAULT));
            } catch (Exception e) {
                Log.e(TAG, "Failed to decode content", e);
                content.content = null;
            }
        }
        
        return content;
    }
    
    public static class GitHubUser {
        public String login;
        public String name;
        public String avatarUrl;
    }
    
    public static class GitHubRepository {
        public long id;
        public String name;
        public String fullName;
        public String owner;
        public String description;
        public boolean isPrivate;
    }
    
    public static class GitHubContent {
        public String name;
        public String path;
        public String type; // "file" or "dir"
        public String sha;
        public long size;
        public String content; // Decoded content for files
    }
    
    public static class GitHubCommit {
        public String sha;
        public String message;
    }
}
