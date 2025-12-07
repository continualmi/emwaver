package com.emwaver.emwaverandroidapp.infrared;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;

import com.emwaver.emwaverandroidapp.BuildConfig;
import com.emwaver.emwaverandroidapp.auth.AuthenticationManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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

public final class InfraredRepository {

    public interface Callback<T> {
        void onSuccess(T value);

        void onError(String message);
    }

    public static final class DecodeResult {
        private final String protocol;
        private final Map<String, Object> parameters;
        private final String raw;

        private DecodeResult(String protocol, Map<String, Object> parameters, String raw) {
            this.protocol = protocol;
            this.parameters = parameters == null ? Collections.emptyMap() : Collections.unmodifiableMap(parameters);
            this.raw = raw;
        }

        public String getProtocol() {
            return protocol;
        }

        public Map<String, Object> getParameters() {
            return parameters;
        }

        public String getRaw() {
            return raw;
        }

        private static DecodeResult fromJson(JSONObject json) {
            String protocol = json.optString("protocol");
            JSONObject paramsJson = json.optJSONObject("parameters");
            Map<String, Object> params = paramsJson != null ? readParameters(paramsJson) : Collections.emptyMap();
            String raw = json.optString("raw", "");
            return new DecodeResult(protocol, params, raw);
        }
    }

    public static final class RenderResult {
        private final String protocol;
        private final Map<String, Object> parameters;
        private final String format;
        private final String data;

        private RenderResult(String protocol, Map<String, Object> parameters, String format, String data) {
            this.protocol = protocol;
            this.parameters = parameters == null ? Collections.emptyMap() : Collections.unmodifiableMap(parameters);
            this.format = format;
            this.data = data;
        }

        public String getProtocol() {
            return protocol;
        }

        public Map<String, Object> getParameters() {
            return parameters;
        }

        public String getFormat() {
            return format;
        }

        public String getData() {
            return data;
        }

        private static RenderResult fromJson(JSONObject json) {
            String protocol = json.optString("protocol");
            String format = json.optString("format");
            String data = json.optString("data");
            JSONObject paramsJson = json.optJSONObject("parameters");
            Map<String, Object> params = paramsJson != null ? readParameters(paramsJson) : Collections.emptyMap();
            return new RenderResult(protocol, params, format, data);
        }
    }

    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");

    private static InfraredRepository instance;

    private final Context appContext;
    private final OkHttpClient httpClient;
    private final String baseUrl;
    private final ExecutorService executor;
    private final Handler mainHandler;

    private InfraredRepository(Context context) {
        this.appContext = context.getApplicationContext();
        HttpLoggingInterceptor loggingInterceptor = new HttpLoggingInterceptor();
        loggingInterceptor.setLevel(HttpLoggingInterceptor.Level.BASIC);
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
    }

    public static synchronized InfraredRepository getInstance(Context context) {
        if (instance == null) {
            instance = new InfraredRepository(context);
        }
        return instance;
    }

    public void decodeSignedRaw(String timings, boolean strict, Callback<List<DecodeResult>> callback) {
        if (TextUtils.isEmpty(timings)) {
            postError(callback, "Signal is empty");
            return;
        }
        executeAsync(() -> decodeInternal(timings, strict), callback);
    }

    public void renderSignedRaw(String protocol, Map<String, Object> parameters, Callback<RenderResult> callback) {
        if (TextUtils.isEmpty(protocol)) {
            postError(callback, "Protocol is required");
            return;
        }
        executeAsync(() -> renderInternal(protocol, parameters), callback);
    }

    private List<DecodeResult> decodeInternal(String timings, boolean strict) throws InfraredRepositoryException {
        try {
            JSONObject payload = new JSONObject();
            JSONObject input = new JSONObject();
            input.put("format", "signed-raw");
            input.put("data", timings.trim());
            payload.put("input", input);
            payload.put("strict", strict);

            Request request = authorizedRequestBuilder(buildUrl("/infrared/decode").toString())
                    .post(RequestBody.create(payload.toString(), JSON_MEDIA_TYPE))
                    .build();

            try (Response response = httpClient.newCall(request).execute()) {
                if (!response.isSuccessful()) {
                    throw errorFromResponse(response);
                }
                String body = response.body() != null ? response.body().string() : "{}";
                JSONObject json = new JSONObject(body);
                JSONArray resultsJson = json.optJSONArray("results");
                List<DecodeResult> results = new ArrayList<>();
                if (resultsJson != null) {
                    for (int i = 0; i < resultsJson.length(); i++) {
                        JSONObject item = resultsJson.optJSONObject(i);
                        if (item != null) {
                            results.add(DecodeResult.fromJson(item));
                        }
                    }
                }
                return results;
            }
        } catch (JSONException e) {
            throw new InfraredRepositoryException("Invalid response", e);
        } catch (IOException e) {
            throw new InfraredRepositoryException("Unable to reach backend", e);
        }
    }

    private RenderResult renderInternal(String protocol, Map<String, Object> parameters) throws InfraredRepositoryException {
        try {
            JSONObject payload = new JSONObject();
            payload.put("protocol", protocol);
            payload.put("format", "signed-raw");

            JSONObject paramsJson = new JSONObject();
            if (parameters != null) {
                for (Map.Entry<String, Object> entry : parameters.entrySet()) {
                    if (TextUtils.isEmpty(entry.getKey()) || entry.getValue() == null) {
                        continue;
                    }
                    paramsJson.put(entry.getKey(), entry.getValue());
                }
            }
            payload.put("parameters", paramsJson);

            Request request = authorizedRequestBuilder(buildUrl("/infrared/render").toString())
                    .post(RequestBody.create(payload.toString(), JSON_MEDIA_TYPE))
                    .build();

            try (Response response = httpClient.newCall(request).execute()) {
                if (!response.isSuccessful()) {
                    throw errorFromResponse(response);
                }
                String body = response.body() != null ? response.body().string() : "{}";
                JSONObject json = new JSONObject(body).optJSONObject("result");
                if (json == null) {
                    throw new InfraredRepositoryException("Invalid response payload");
                }
                return RenderResult.fromJson(json);
            }
        } catch (JSONException e) {
            throw new InfraredRepositoryException("Invalid response", e);
        } catch (IOException e) {
            throw new InfraredRepositoryException("Unable to reach backend", e);
        }
    }

    private <T> void executeAsync(Callable<T> callable, Callback<T> callback) {
        executor.execute(() -> {
            try {
                T result = callable.call();
                mainHandler.post(() -> callback.onSuccess(result));
            } catch (InfraredRepositoryException e) {
                postError(callback, e.getMessage());
            } catch (Exception e) {
                postError(callback, e.getMessage());
            }
        });
    }

    private Request.Builder authorizedRequestBuilder(String url) throws InfraredRepositoryException {
        String token = AuthenticationManager.getInstance(appContext).getAccessToken();
        if (TextUtils.isEmpty(token)) {
            throw new InfraredRepositoryException("Not authenticated");
        }
        return new Request.Builder()
                .url(url)
                .header("Authorization", "Bearer " + token);
    }

    private HttpUrl buildUrl(String path) throws InfraredRepositoryException {
        HttpUrl httpUrl = HttpUrl.parse(baseUrl + path);
        if (httpUrl == null) {
            throw new InfraredRepositoryException("Invalid backend URL");
        }
        return httpUrl;
    }

    private void postError(Callback<?> callback, String message) {
        final String safeMessage = TextUtils.isEmpty(message) ? "Request failed" : message;
        mainHandler.post(() -> callback.onError(safeMessage));
    }

    private InfraredRepositoryException errorFromResponse(Response response) throws IOException {
        String body = response.body() != null ? response.body().string() : null;
        String message = "Request failed with status " + response.code();
        if (!TextUtils.isEmpty(body)) {
            try {
                JSONObject json = new JSONObject(body);
                if (json.has("message")) {
                    message = json.optString("message", message);
                } else if (json.has("error")) {
                    message = json.optString("error", message);
                }
            } catch (JSONException e) {
                message = body;
            }
        }
        return new InfraredRepositoryException(message);
    }

    private static Map<String, Object> readParameters(JSONObject json) {
        Map<String, Object> parameters = new HashMap<>();
        JSONArray names = json.names();
        if (names == null) {
            return parameters;
        }
        for (int i = 0; i < names.length(); i++) {
            String key = names.optString(i, null);
            if (TextUtils.isEmpty(key)) {
                continue;
            }
            Object value = json.opt(key);
            parameters.put(key, value);
        }
        return parameters;
    }

    public static class InfraredRepositoryException extends Exception {
        InfraredRepositoryException(String message) {
            super(message);
        }

        InfraredRepositoryException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
