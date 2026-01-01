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

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Base64;
import android.util.Base64;
import android.util.Log;

import com.emwaver.emwaverandroidapp.BuildConfig;
import com.emwaver.emwaverandroidapp.auth.AuthenticationManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.logging.HttpLoggingInterceptor;

public final class FileRepository {

    private static final String TAG = "FileRepository";

    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");

    private static FileRepository instance;

    private final Context appContext;
    private final OkHttpClient httpClient;
    private final String baseUrl;
    private final ExecutorService executor;
    private final Handler mainHandler;

    private FileRepository(Context context) {
        this.appContext = context.getApplicationContext();
        HttpLoggingInterceptor loggingInterceptor = new HttpLoggingInterceptor(message -> Log.d(TAG, message));
        loggingInterceptor.redactHeader("Authorization");
        loggingInterceptor.setLevel(HttpLoggingInterceptor.Level.BODY);
        this.httpClient = new OkHttpClient.Builder()
            .addInterceptor(loggingInterceptor)
            .build();
        this.executor = Executors.newSingleThreadExecutor();
        this.mainHandler = new Handler(Looper.getMainLooper());
        String configuredBaseUrl = BuildConfig.BACKEND_BASE_URL;
        if (TextUtils.isEmpty(configuredBaseUrl)) {
            configuredBaseUrl = "http://10.0.2.2:8000";
        }
        if (configuredBaseUrl.endsWith("/")) {
            configuredBaseUrl = configuredBaseUrl.substring(0, configuredBaseUrl.length() - 1);
        }
        this.baseUrl = configuredBaseUrl;
        Log.d(TAG, "Initialized with baseUrl=" + this.baseUrl);
    }

    public static synchronized FileRepository getInstance(Context context) {
        if (instance == null) {
            instance = new FileRepository(context);
        }
        return instance;
    }

    private AuthenticationManager authManager() {
        return AuthenticationManager.getInstance(appContext);
    }

    private Request.Builder authorizedRequestBuilder(String url) throws FileRepositoryException {
        String accessToken = authManager().getAccessToken();
        if (TextUtils.isEmpty(accessToken)) {
            throw new FileRepositoryException("Not authenticated");
        }
        return new Request.Builder()
            .url(url)
            .header("Authorization", "Bearer " + accessToken);
    }

    private HttpUrl.Builder baseUrlBuilder(String path) throws FileRepositoryException {
        HttpUrl url = HttpUrl.parse(baseUrl + path);
        if (url == null) {
            throw new FileRepositoryException("Invalid backend URL");
        }
        return url.newBuilder();
    }

    private <T> void executeAsync(Callable<T> callable, RepositoryCallback<T> callback) {
        executor.execute(() -> {
            try {
                T result = callable.call();
                mainHandler.post(() -> {
                    Log.d(TAG, "Repository operation succeeded");
                    callback.onSuccess(result);
                });
            } catch (FileRepositoryException e) {
                Log.e(TAG, "Repository operation failed", e);
                postError(callback, e.getMessage());
            } catch (Exception e) {
                String message = e.getMessage();
                if (TextUtils.isEmpty(message)) {
                    message = "Request failed";
                }
                Log.e(TAG, "Unexpected repository failure", e);
                postError(callback, message);
            }
        });
    }

    private <T> void postError(RepositoryCallback<T> callback, String message) {
        final String safeMessage = TextUtils.isEmpty(message) ? "Unknown error" : message;
        Log.e(TAG, "Delivering error to callback: " + safeMessage);
        mainHandler.post(() -> callback.onError(safeMessage));
    }

    private FileRepositoryException errorFromResponse(Response response) throws IOException {
        String body = response.body() != null ? response.body().string() : null;
        String message = "Request failed with status " + response.code();
        Log.e(TAG, "Backend error status=" + response.code() + " body=" + truncate(body));
        if (!TextUtils.isEmpty(body)) {
            try {
                JSONObject json = new JSONObject(body);
                if (json.has("message")) {
                    message = json.optString("message", message);
                } else if (json.has("error")) {
                    message = json.optString("error", message);
                }
            } catch (JSONException ignore) {
                message = body;
            }
        }
        return new FileRepositoryException(message);
    }

    public void listFiles(String extension, RepositoryCallback<List<UserFileMetadata>> callback) {
        listFilesInternal(extension, false, new RepositoryCallback<List<UserFileData>>() {
            @Override
            public void onSuccess(List<UserFileData> value) {
                List<UserFileMetadata> metadata = new ArrayList<>();
                if (value != null) {
                    for (UserFileData data : value) {
                        metadata.add(data.getMetadata());
                    }
                }
                callback.onSuccess(metadata);
            }

            @Override
            public void onError(String message) {
                callback.onError(message);
            }
        });
    }

    public void listFilesWithContent(String extension, RepositoryCallback<List<UserFileData>> callback) {
        listFilesInternal(extension, true, callback);
    }

    private void listFilesInternal(String extension, boolean includeContent, RepositoryCallback<List<UserFileData>> callback) {
        executeAsync(() -> {
            HttpUrl.Builder urlBuilder = baseUrlBuilder("/files");
            if (!TextUtils.isEmpty(extension)) {
                urlBuilder.addQueryParameter("extension", extension);
            }
            if (includeContent) {
                urlBuilder.addQueryParameter("include", "content");
            }
            HttpUrl url = urlBuilder.build();
            Log.d(TAG, "listFiles request url=" + url);
            Request request = authorizedRequestBuilder(url.toString())
                .get()
                .build();
            try (Response response = httpClient.newCall(request).execute()) {
                Log.d(TAG, "listFiles response status=" + response.code());
                if (!response.isSuccessful()) {
                    throw errorFromResponse(response);
                }
                String body = response.body() != null ? response.body().string() : "{}";
                JSONObject json = new JSONObject(body);
                JSONArray filesJson = json.optJSONArray("files");
                List<UserFileData> files = new ArrayList<>();
                if (filesJson != null) {
                    for (int i = 0; i < filesJson.length(); i++) {
                        JSONObject item = filesJson.getJSONObject(i);
                        UserFileMetadata metadata = UserFileMetadata.fromJson(item);
                        String textContent = item.has("content") ? item.optString("content", null) : null;
                        byte[] binary = null;
                        if (item.has("content_base64")) {
                            String encoded = item.optString("content_base64", null);
                            if (!TextUtils.isEmpty(encoded)) {
                                binary = Base64.decode(encoded, Base64.DEFAULT);
                            }
                        }
                        files.add(new UserFileData(metadata, textContent, binary));
                    }
                }
                Log.d(TAG, "listFiles succeeded count=" + files.size());
                return files;
            } catch (JSONException e) {
                Log.e(TAG, "Failed to parse listFiles response", e);
                throw new FileRepositoryException("Invalid response", e);
            }
        }, callback);
    }

    public void getFile(String fileId, RepositoryCallback<UserFileData> callback) {
        executeAsync(() -> {
            HttpUrl httpUrl = baseUrlBuilder("/files/" + fileId)
                .addQueryParameter("include", "content")
                .build();
            Log.d(TAG, "getFile request url=" + httpUrl);
            Request request = authorizedRequestBuilder(httpUrl.toString())
                .get()
                .build();
            try (Response response = httpClient.newCall(request).execute()) {
                Log.d(TAG, "getFile response status=" + response.code());
                if (!response.isSuccessful()) {
                    throw errorFromResponse(response);
                }
                String body = response.body() != null ? response.body().string() : "{}";
                JSONObject json = new JSONObject(body).getJSONObject("file");
                UserFileMetadata metadata = UserFileMetadata.fromJson(json);
                String textContent = json.has("content") ? json.optString("content", null) : null;
                byte[] binary = null;
                if (json.has("content_base64")) {
                    String encoded = json.optString("content_base64", null);
                    if (!TextUtils.isEmpty(encoded)) {
                        binary = Base64.decode(encoded, Base64.DEFAULT);
                    }
                }
                Log.d(
                    TAG,
                    "getFile succeeded id=" + fileId
                        + " textLength=" + (textContent != null ? textContent.length() : 0)
                        + " binaryLength=" + (binary != null ? binary.length : 0)
                );
                return new UserFileData(metadata, textContent, binary);
            } catch (JSONException e) {
                Log.e(TAG, "Failed to parse getFile response", e);
                throw new FileRepositoryException("Invalid response", e);
            }
        }, callback);
    }

    public void createTextFile(String name, String content, RepositoryCallback<UserFileMetadata> callback) {
        executeAsync(() -> {
            JSONObject payload = new JSONObject();
            try {
                payload.put("name", name);
                payload.put("content", content);
            } catch (JSONException e) {
                throw new FileRepositoryException("Failed to build request", e);
            }
            Log.d(TAG, "createTextFile name=" + name + " length=" + (content != null ? content.length() : 0));
            Request request = authorizedRequestBuilder(baseUrl + "/files")
                .post(RequestBody.create(payload.toString(), JSON_MEDIA_TYPE))
                .build();
            try (Response response = httpClient.newCall(request).execute()) {
                Log.d(TAG, "createTextFile response status=" + response.code());
                if (!response.isSuccessful()) {
                    throw errorFromResponse(response);
                }
                String body = response.body() != null ? response.body().string() : "{}";
                JSONObject json = new JSONObject(body).getJSONObject("file");
                Log.d(TAG, "createTextFile succeeded id=" + json.optString("id"));
                return UserFileMetadata.fromJson(json);
            } catch (JSONException e) {
                Log.e(TAG, "Failed to parse createTextFile response", e);
                throw new FileRepositoryException("Invalid response", e);
            }
        }, callback);
    }

    public void createBinaryFile(String name, byte[] data, RepositoryCallback<UserFileMetadata> callback) {
        executeAsync(() -> {
            JSONObject payload = new JSONObject();
            try {
                payload.put("name", name);
                payload.put("content_base64", Base64.encodeToString(data, Base64.NO_WRAP));
            } catch (JSONException e) {
                throw new FileRepositoryException("Failed to build request", e);
            }
            Log.d(TAG, "createBinaryFile name=" + name + " size=" + (data != null ? data.length : 0));
            Request request = authorizedRequestBuilder(baseUrl + "/files")
                .post(RequestBody.create(payload.toString(), JSON_MEDIA_TYPE))
                .build();
            try (Response response = httpClient.newCall(request).execute()) {
                Log.d(TAG, "createBinaryFile response status=" + response.code());
                if (!response.isSuccessful()) {
                    throw errorFromResponse(response);
                }
                String body = response.body() != null ? response.body().string() : "{}";
                JSONObject json = new JSONObject(body).getJSONObject("file");
                Log.d(TAG, "createBinaryFile succeeded id=" + json.optString("id"));
                return UserFileMetadata.fromJson(json);
            } catch (JSONException e) {
                Log.e(TAG, "Failed to parse createBinaryFile response", e);
                throw new FileRepositoryException("Invalid response", e);
            }
        }, callback);
    }

    public void copyFile(String sourceId, String name, RepositoryCallback<UserFileMetadata> callback) {
        executeAsync(() -> {
            JSONObject payload = new JSONObject();
            try {
                payload.put("source_id", sourceId);
                payload.put("name", name);
            } catch (JSONException e) {
                throw new FileRepositoryException("Failed to build request", e);
            }
            Log.d(TAG, "copyFile sourceId=" + sourceId + " name=" + name);
            Request request = authorizedRequestBuilder(baseUrl + "/files")
                .post(RequestBody.create(payload.toString(), JSON_MEDIA_TYPE))
                .build();
            try (Response response = httpClient.newCall(request).execute()) {
                Log.d(TAG, "copyFile response status=" + response.code());
                if (!response.isSuccessful()) {
                    throw errorFromResponse(response);
                }
                String body = response.body() != null ? response.body().string() : "{}";
                JSONObject json = new JSONObject(body).getJSONObject("file");
                Log.d(TAG, "copyFile succeeded id=" + json.optString("id"));
                return UserFileMetadata.fromJson(json);
            } catch (JSONException e) {
                Log.e(TAG, "Failed to parse copyFile response", e);
                throw new FileRepositoryException("Invalid response", e);
            }
        }, callback);
    }

    public void updateTextFile(String fileId, String etag, String content, RepositoryCallback<UserFileMetadata> callback) {
        executeAsync(() -> {
            JSONObject payload = new JSONObject();
            try {
                payload.put("etag", etag);
                payload.put("content", content);
            } catch (JSONException e) {
                throw new FileRepositoryException("Failed to build request", e);
            }
            Log.d(TAG, "updateTextFile id=" + fileId + " etag=" + etag + " length=" + (content != null ? content.length() : 0));
            Request request = authorizedRequestBuilder(baseUrl + "/files/" + fileId)
                .patch(RequestBody.create(payload.toString(), JSON_MEDIA_TYPE))
                .build();
            try (Response response = httpClient.newCall(request).execute()) {
                Log.d(TAG, "updateTextFile response status=" + response.code());
                if (!response.isSuccessful()) {
                    throw errorFromResponse(response);
                }
                String body = response.body() != null ? response.body().string() : "{}";
                JSONObject json = new JSONObject(body).getJSONObject("file");
                Log.d(TAG, "updateTextFile succeeded id=" + json.optString("id"));
                return UserFileMetadata.fromJson(json);
            } catch (JSONException e) {
                Log.e(TAG, "Failed to parse updateTextFile response", e);
                throw new FileRepositoryException("Invalid response", e);
            }
        }, callback);
    }

    public void updateBinaryFile(String fileId, String etag, byte[] data, RepositoryCallback<UserFileMetadata> callback) {
        executeAsync(() -> {
            JSONObject payload = new JSONObject();
            try {
                payload.put("etag", etag);
                payload.put("content_base64", Base64.encodeToString(data, Base64.NO_WRAP));
            } catch (JSONException e) {
                throw new FileRepositoryException("Failed to build request", e);
            }
            Log.d(TAG, "updateBinaryFile id=" + fileId + " etag=" + etag + " size=" + (data != null ? data.length : 0));
            Request request = authorizedRequestBuilder(baseUrl + "/files/" + fileId)
                .patch(RequestBody.create(payload.toString(), JSON_MEDIA_TYPE))
                .build();
            try (Response response = httpClient.newCall(request).execute()) {
                Log.d(TAG, "updateBinaryFile response status=" + response.code());
                if (!response.isSuccessful()) {
                    throw errorFromResponse(response);
                }
                String body = response.body() != null ? response.body().string() : "{}";
                JSONObject json = new JSONObject(body).getJSONObject("file");
                Log.d(TAG, "updateBinaryFile succeeded id=" + json.optString("id"));
                return UserFileMetadata.fromJson(json);
            } catch (JSONException e) {
                Log.e(TAG, "Failed to parse updateBinaryFile response", e);
                throw new FileRepositoryException("Invalid response", e);
            }
        }, callback);
    }

    public void renameFile(String fileId, String name, RepositoryCallback<UserFileMetadata> callback) {
        executeAsync(() -> {
            JSONObject payload = new JSONObject();
            try {
                payload.put("name", name);
            } catch (JSONException e) {
                throw new FileRepositoryException("Failed to build request", e);
            }
            Log.d(TAG, "renameFile id=" + fileId + " name=" + name);
            Request request = authorizedRequestBuilder(baseUrl + "/files/" + fileId)
                .patch(RequestBody.create(payload.toString(), JSON_MEDIA_TYPE))
                .build();
            try (Response response = httpClient.newCall(request).execute()) {
                Log.d(TAG, "renameFile response status=" + response.code());
                if (!response.isSuccessful()) {
                    throw errorFromResponse(response);
                }
                String body = response.body() != null ? response.body().string() : "{}";
                JSONObject json = new JSONObject(body).getJSONObject("file");
                Log.d(TAG, "renameFile succeeded id=" + json.optString("id"));
                return UserFileMetadata.fromJson(json);
            } catch (JSONException e) {
                Log.e(TAG, "Failed to parse renameFile response", e);
                throw new FileRepositoryException("Invalid response", e);
            }
        }, callback);
    }

    public void deleteFile(String fileId, String etag, RepositoryCallback<Void> callback) {
        executeAsync(() -> {
            JSONObject payload = new JSONObject();
            try {
                if (!TextUtils.isEmpty(etag)) {
                    payload.put("etag", etag);
                }
            } catch (JSONException e) {
                throw new FileRepositoryException("Failed to build request", e);
            }
            Log.d(TAG, "deleteFile request id=" + fileId + " etag=" + (TextUtils.isEmpty(etag) ? "<none>" : etag));
            RequestBody body = payload.length() > 0
                ? RequestBody.create(payload.toString(), JSON_MEDIA_TYPE)
                : null;
            Request.Builder builder = authorizedRequestBuilder(baseUrl + "/files/" + fileId);
            if (body != null) {
                builder.method("DELETE", body);
            } else {
                builder.delete();
            }
            try (Response response = httpClient.newCall(builder.build()).execute()) {
                Log.d(TAG, "deleteFile response status=" + response.code());
                if (!response.isSuccessful()) {
                    throw errorFromResponse(response);
                }
                Log.d(TAG, "deleteFile succeeded id=" + fileId);
                return null;
            }
        }, callback);
    }

    private static String truncate(String value) {
        if (TextUtils.isEmpty(value)) {
            return "";
        }
        if (value.length() > 512) {
            return value.substring(0, 512) + "...";
        }
        return value;
    }
}
