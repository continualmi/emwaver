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

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public class GitHubConfig {
    // ============================================
    // REPLACE THESE WITH YOUR GITHUB OAUTH CREDENTIALS
    // ============================================
    // 1. Go to: https://github.com/settings/developers
    // 2. Click "New OAuth App"
    // 3. Fill in:
    //    - Application name: EMWaver (or any name)
    //    - Homepage URL: https://emwaver.com (or any URL)
    //    - Authorization callback URL: emwaver://oauth/callback
    // 4. Click "Register application"
    // 5. Copy the "Client ID" and "Client Secret" below:
    // ============================================
    
    public static final String CLIENT_ID = "Ov23lijxrW2l5TUQ5Bin";
    public static final String CLIENT_SECRET = "5bec1297e8d460752d7ad0929cb9fb6642cc72b3";
    
    // ============================================
    // END OF CONFIGURATION
    // ============================================
    
    public static final String REDIRECT_URI = "emwaver://oauth/callback";
    public static final String GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
    public static final String GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
    public static final String GITHUB_API_BASE = "https://api.github.com";
    
    // Use public_repo scope for OAuth - only grants access to public repositories
    // Users who need private repo access can use a Personal Access Token (PAT) instead
    public static final String[] SCOPES = {"public_repo", "read:user"};
    
    public static String getAuthorizationUrl() {
        try {
            StringBuilder url = new StringBuilder(GITHUB_AUTH_URL);
            url.append("?client_id=").append(URLEncoder.encode(CLIENT_ID, StandardCharsets.UTF_8.name()));
            url.append("&redirect_uri=").append(URLEncoder.encode(REDIRECT_URI, StandardCharsets.UTF_8.name()));
            url.append("&scope=").append(URLEncoder.encode(String.join(" ", SCOPES), StandardCharsets.UTF_8.name()));
            return url.toString();
        } catch (Exception e) {
            // Fallback without encoding if there's an issue
            StringBuilder url = new StringBuilder(GITHUB_AUTH_URL);
            url.append("?client_id=").append(CLIENT_ID);
            url.append("&redirect_uri=").append(REDIRECT_URI);
            url.append("&scope=").append(String.join(" ", SCOPES));
            return url.toString();
        }
    }
}
