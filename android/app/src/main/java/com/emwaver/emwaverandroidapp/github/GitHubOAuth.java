package com.emwaver.emwaverandroidapp.github;

import android.util.Log;
import com.google.gson.JsonObject;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.FormBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

import java.io.IOException;

public class GitHubOAuth {
    private static final String TAG = "GitHubOAuth";
    private final OkHttpClient httpClient;
    
    public GitHubOAuth() {
        this.httpClient = new OkHttpClient();
    }
    
    public interface TokenCallback {
        void onSuccess(String accessToken);
        void onError(String message);
    }
    
    public void exchangeCodeForToken(String code, TokenCallback callback) {
        RequestBody formBody = new FormBody.Builder()
            .add("client_id", GitHubConfig.CLIENT_ID)
            .add("client_secret", GitHubConfig.CLIENT_SECRET)
            .add("code", code)
            .add("redirect_uri", GitHubConfig.REDIRECT_URI)
            .build();
        
        Request request = new Request.Builder()
            .url(GitHubConfig.GITHUB_TOKEN_URL)
            .post(formBody)
            .addHeader("Accept", "application/json")
            .build();
        
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                callback.onError("Failed to exchange code: " + e.getMessage());
            }
            
            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (!response.isSuccessful()) {
                    callback.onError("Failed to exchange code: " + response.code());
                    return;
                }
                
                ResponseBody body = response.body();
                if (body == null) {
                    callback.onError("Empty response");
                    return;
                }
                
                try {
                    String bodyString = body.string();
                    Log.d(TAG, "Token response: " + bodyString);
                    
                    // Parse JSON response
                    com.google.gson.Gson gson = new com.google.gson.Gson();
                    JsonObject json = gson.fromJson(bodyString, JsonObject.class);
                    
                    if (json.has("access_token")) {
                        String accessToken = json.get("access_token").getAsString();
                        callback.onSuccess(accessToken);
                    } else if (json.has("error")) {
                        String error = json.get("error").getAsString();
                        String errorDescription = json.has("error_description") 
                            ? json.get("error_description").getAsString() 
                            : error;
                        callback.onError(errorDescription);
                    } else {
                        callback.onError("No access token in response");
                    }
                } catch (Exception e) {
                    callback.onError("Failed to parse token response: " + e.getMessage());
                }
            }
        });
    }
}
