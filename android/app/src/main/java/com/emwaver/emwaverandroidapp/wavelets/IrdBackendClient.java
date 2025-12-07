package com.emwaver.emwaverandroidapp.wavelets;

import android.net.Uri;
import android.text.TextUtils;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.emwaver.emwaverandroidapp.BuildConfig;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class IrdBackendClient {

    public interface BrandsCallback {
        void onSuccess(List<String> brands);

        void onFailure(String message);
    }

    public interface RemotesCallback {
        void onSuccess(List<RemoteSummary> remotes);

        void onFailure(String message);
    }

    public interface VariantsCallback {
        void onSuccess(List<String> variants);

        void onFailure(String message);
    }

    public interface ImportCallback {
        void onProgress(int processed, int total);

        void onSuccess(ImportedWavelet wavelet);

        void onFailure(String message);
    }

    public static final class RemoteSummary {
        private final String name;
        private final int variantCount;

        public RemoteSummary(String name, int variantCount) {
            this.name = name;
            this.variantCount = variantCount;
        }

        public String getName() {
            return name;
        }

        public int getVariantCount() {
            return variantCount;
        }
    }

    public static final class ImportedWavelet {
        private final String name;
        private final String content;
        @Nullable
        private final String metadataJson;

        public ImportedWavelet(String name, String content, @Nullable String metadataJson) {
            this.name = name;
            this.content = content;
            this.metadataJson = metadataJson;
        }

        public String getName() {
            return name;
        }

        public String getContent() {
            return content;
        }

        @Nullable
        public String getMetadataJson() {
            return metadataJson;
        }
    }

    private static final String TAG = "IrdBackendClient";
    private static final MediaType JSON_MEDIA_TYPE = MediaType.get("application/json; charset=utf-8");
    private static final OkHttpClient HTTP_CLIENT = new OkHttpClient();
    private static final ScheduledExecutorService JOB_POLLER = Executors.newSingleThreadScheduledExecutor();
    private static final int POLL_INTERVAL_MS = 400;

    private final String baseUrl;

    public IrdBackendClient() {
        String configuredBaseUrl = BuildConfig.BACKEND_BASE_URL;
        if (TextUtils.isEmpty(configuredBaseUrl)) {
            configuredBaseUrl = "http://10.0.2.2:8000";
        }
        if (configuredBaseUrl.endsWith("/")) {
            configuredBaseUrl = configuredBaseUrl.substring(0, configuredBaseUrl.length() - 1);
        }
        this.baseUrl = configuredBaseUrl;
    }

    public void fetchBrands(String accessToken, BrandsCallback callback) {
        Request request = authorizedRequest(accessToken, baseUrl + "/wavelets/irdb/brands").get().build();
        HTTP_CLIENT.newCall(request).enqueue(buildCallback(callback, responseBody -> {
            try {
                JSONObject json = new JSONObject(responseBody);
                JSONArray array = json.optJSONArray("brands");
                List<String> brands = new ArrayList<>();
                if (array != null) {
                    for (int i = 0; i < array.length(); i++) {
                        brands.add(array.optString(i));
                    }
                }
                callback.onSuccess(brands);
            } catch (JSONException e) {
                Log.e(TAG, "Failed to parse brands", e);
                callback.onFailure("Invalid response format");
            }
        }));
    }

    public void fetchRemotes(String accessToken, String brand, RemotesCallback callback) {
        String url = baseUrl + "/wavelets/irdb/remotes?brand=" + encode(brand);
        Request request = authorizedRequest(accessToken, url).get().build();
        HTTP_CLIENT.newCall(request).enqueue(buildCallback(callback, responseBody -> {
            try {
                JSONObject json = new JSONObject(responseBody);
                JSONArray array = json.optJSONArray("remotes");
                List<RemoteSummary> remotes = new ArrayList<>();
                if (array != null) {
                    for (int i = 0; i < array.length(); i++) {
                        JSONObject item = array.optJSONObject(i);
                        if (item == null) {
                            continue;
                        }
                        String name = item.optString("name");
                        int count = item.optInt("variant_count", 0);
                        remotes.add(new RemoteSummary(name, count));
                    }
                }
                callback.onSuccess(remotes);
            } catch (JSONException e) {
                Log.e(TAG, "Failed to parse remotes", e);
                callback.onFailure("Invalid response format");
            }
        }));
    }

    public void fetchVariants(String accessToken, String brand, String remote, VariantsCallback callback) {
        String url = baseUrl + "/wavelets/irdb/variants?brand=" + encode(brand) + "&remote=" + encode(remote);
        Request request = authorizedRequest(accessToken, url).get().build();
        HTTP_CLIENT.newCall(request).enqueue(buildCallback(callback, responseBody -> {
            try {
                JSONObject json = new JSONObject(responseBody);
                JSONArray array = json.optJSONArray("variants");
                List<String> variants = new ArrayList<>();
                if (array != null) {
                    for (int i = 0; i < array.length(); i++) {
                        variants.add(array.optString(i));
                    }
                }
                callback.onSuccess(variants);
            } catch (JSONException e) {
                Log.e(TAG, "Failed to parse variants", e);
                callback.onFailure("Invalid response format");
            }
        }));
    }

    public void importRemote(String accessToken, String brand, String remote, String fileName, ImportCallback callback) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("brand", brand);
            payload.put("remote", remote);
            payload.put("file", fileName);
            payload.put("async", true);
        } catch (JSONException e) {
            callback.onFailure("Failed to build request");
            return;
        }

        RequestBody body = RequestBody.create(payload.toString(), JSON_MEDIA_TYPE);
        Request request = authorizedRequest(accessToken, baseUrl + "/wavelets/irdb/import").post(body).build();
        HTTP_CLIENT.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                callback.onFailure(e.getMessage());
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) throws IOException {
                try (Response res = response) {
                    String bodyString = res.body() != null ? res.body().string() : "";
                    int status = res.code();
                    if (status == 202) {
                        handleAsyncImportStart(accessToken, bodyString, callback);
                        return;
                    }
                    if (!res.isSuccessful()) {
                        callback.onFailure("HTTP " + status);
                        return;
                    }
                    try {
                        JSONObject json = new JSONObject(bodyString);
                        JSONObject wavelet = json.optJSONObject("wavelet");
                        if (wavelet == null) {
                            callback.onFailure("Invalid response format");
                            return;
                        }
                        callback.onSuccess(parseWavelet(wavelet));
                    } catch (JSONException e) {
                        Log.e(TAG, "Failed to parse import response", e);
                        callback.onFailure("Invalid response format");
                    }
                }
            }
        });
    }

    private void handleAsyncImportStart(String accessToken, String responseBody, ImportCallback callback) {
        try {
            JSONObject json = new JSONObject(responseBody);
            String jobId = json.optString("jobId");
            if (TextUtils.isEmpty(jobId)) {
                callback.onFailure("Missing import job identifier");
                return;
            }
            JSONObject jobJson = json.optJSONObject("job");
            int total = jobJson != null ? jobJson.optInt("total", 0) : 0;
            int processed = jobJson != null ? jobJson.optInt("processed", 0) : 0;
            callback.onProgress(processed, total);
            scheduleJobPoll(accessToken, jobId, total, callback);
        } catch (JSONException e) {
            Log.e(TAG, "Failed to parse async import response", e);
            callback.onFailure("Invalid response format");
        }
    }

    private void scheduleJobPoll(String accessToken, String jobId, int knownTotal, ImportCallback callback) {
        JOB_POLLER.schedule(
            () -> pollImportJob(accessToken, jobId, knownTotal, callback),
            POLL_INTERVAL_MS,
            TimeUnit.MILLISECONDS
        );
    }

    private void pollImportJob(String accessToken, String jobId, int knownTotal, ImportCallback callback) {
        Request request = authorizedRequest(accessToken, baseUrl + "/wavelets/irdb/import/" + jobId).get().build();
        try (Response response = HTTP_CLIENT.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                callback.onFailure("HTTP " + response.code());
                return;
            }
            String bodyString = response.body() != null ? response.body().string() : "";
            JSONObject json = new JSONObject(bodyString);
            JSONObject jobJson = json.optJSONObject("job");
            if (jobJson == null) {
                callback.onFailure("Invalid job status response");
                return;
            }
            int total = jobJson.optInt("total", knownTotal);
            int processed = jobJson.optInt("processed", 0);
            callback.onProgress(processed, total);
            if (jobJson.optBoolean("done")) {
                if (jobJson.has("wavelet") && !jobJson.isNull("wavelet")) {
                    JSONObject waveletJson = jobJson.optJSONObject("wavelet");
                    if (waveletJson == null) {
                        callback.onFailure("Invalid job result");
                    } else {
                        callback.onSuccess(parseWavelet(waveletJson));
                    }
                } else {
                    String error = jobJson.optString("error", "Import failed");
                    callback.onFailure(error);
                }
            } else {
                scheduleJobPoll(accessToken, jobId, total, callback);
            }
        } catch (IOException | JSONException e) {
            Log.e(TAG, "Failed to poll import job", e);
            callback.onFailure(e.getMessage() != null ? e.getMessage() : "Failed to poll import job");
        }
    }

    private ImportedWavelet parseWavelet(JSONObject wavelet) {
        String name = wavelet.optString("name");
        String content = wavelet.optString("content");
        JSONObject metadata = wavelet.optJSONObject("metadata");
        return new ImportedWavelet(name, content, metadata != null ? metadata.toString() : null);
    }

    private Request.Builder authorizedRequest(String accessToken, String url) {
        return new Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer " + accessToken)
            .addHeader("Content-Type", "application/json");
    }

    private static Callback buildCallback(Object delegate, ResponseHandler handler) {
        return new Callback() {
            @Override
            public void onFailure(@NonNull Call call, @NonNull IOException e) {
                if (delegate instanceof BrandsCallback) {
                    ((BrandsCallback) delegate).onFailure(e.getMessage());
                } else if (delegate instanceof RemotesCallback) {
                    ((RemotesCallback) delegate).onFailure(e.getMessage());
                } else if (delegate instanceof VariantsCallback) {
                    ((VariantsCallback) delegate).onFailure(e.getMessage());
                } else if (delegate instanceof ImportCallback) {
                    ((ImportCallback) delegate).onFailure(e.getMessage());
                }
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) throws IOException {
                try (Response res = response) {
                    if (!res.isSuccessful()) {
                        String message = "HTTP " + res.code();
                        if (delegate instanceof BrandsCallback) {
                            ((BrandsCallback) delegate).onFailure(message);
                        } else if (delegate instanceof RemotesCallback) {
                            ((RemotesCallback) delegate).onFailure(message);
                        } else if (delegate instanceof VariantsCallback) {
                            ((VariantsCallback) delegate).onFailure(message);
                        } else if (delegate instanceof ImportCallback) {
                            ((ImportCallback) delegate).onFailure(message);
                        }
                        return;
                    }
                    String body = res.body() != null ? res.body().string() : "";
                    handler.handle(body);
                }
            }
        };
    }

    private interface ResponseHandler {
        void handle(String responseBody) throws IOException;
    }

    private static String encode(String value) {
        return value == null ? "" : Uri.encode(value, null);
    }
}
