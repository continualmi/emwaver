use rand::{distributions::Alphanumeric, Rng};
use reqwest::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{net::TcpListener, time::Duration};
use tiny_http::{Response, Server};
use url::Url;

#[derive(Debug, Clone, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    id_token: String,
    expires_in: Option<i64>,
    refresh_token: Option<String>,
    scope: Option<String>,
    token_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct FirebaseSessionResponse {
    #[serde(rename = "idToken")]
    id_token: String,
    #[serde(rename = "refreshToken")]
    refresh_token: String,
    #[serde(rename = "expiresIn")]
    expires_in: Option<String>,
    email: Option<String>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "localId")]
    local_id: Option<String>,
}

fn rand_urlsafe(len: usize) -> String {
    let mut rng = rand::thread_rng();
    let s: String = (0..len)
        .map(|_| rng.sample(Alphanumeric) as char)
        .collect();
    // Already urlsafe enough.
    s
}

fn pkce_challenge(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hash)
}

pub async fn sign_in_google_pkce_firebase(
    google_client_id: String,
    google_client_secret: String,
    firebase_web_api_key: String,
) -> Result<FirebaseSessionResponse, String> {
    if google_client_id.trim().is_empty() {
        return Err("Missing EMWAVER_GOOGLE_CLIENT_ID".to_string());
    }
    if firebase_web_api_key.trim().is_empty() {
        return Err("Missing EMWAVER_FIREBASE_WEB_API_KEY".to_string());
    }

    // Loopback redirect.
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Failed to bind loopback: {e}"))?;
    let addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to get loopback addr: {e}"))?;
    let redirect_uri = format!("http://127.0.0.1:{}/oauth2redirect", addr.port());

    // tiny_http server from existing listener
    let server = Server::from_tcp(listener).map_err(|e| format!("Failed to start local server: {e}"))?;

    let state = rand_urlsafe(24);
    let nonce = rand_urlsafe(24);
    let code_verifier = rand_urlsafe(64);
    let code_challenge = pkce_challenge(&code_verifier);

    let mut auth_url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", google_client_id.trim())
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email profile")
        .append_pair("state", &state)
        .append_pair("nonce", &nonce)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("prompt", "select_account");

    open::that(auth_url.as_str()).map_err(|e| format!("Failed to open browser: {e}"))?;

    // Wait for callback.
    let deadline = std::time::Instant::now() + Duration::from_secs(180);
    let mut code: Option<String> = None;
    let mut err: Option<String> = None;

    while std::time::Instant::now() < deadline {
        if let Ok(Some(req)) = server.recv_timeout(Duration::from_millis(250)) {
            let url = format!("http://localhost{}", req.url());
            let parsed = Url::parse(&url).map_err(|e| format!("Invalid callback URL: {e}"))?;
            let qs: std::collections::HashMap<String, String> = parsed
                .query_pairs()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();

            if let Some(e) = qs.get("error") {
                err = Some(e.to_string());
            }

            if qs.get("state").map(|s| s.as_str()) != Some(state.as_str()) {
                err = Some("state mismatch".to_string());
            }

            if let Some(c) = qs.get("code") {
                code = Some(c.to_string());
            }

            let html = if code.is_some() {
                "<html><body><h3>SecureWaver</h3><p>Sign-in complete. You can close this window.</p></body></html>"
            } else {
                "<html><body><h3>SecureWaver</h3><p>Sign-in failed. You can close this window.</p></body></html>"
            };
            let _ = req.respond(Response::from_string(html).with_header(
                tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..]).unwrap(),
            ));

            break;
        }
    }

    if let Some(e) = err {
        return Err(format!("Google sign-in failed: {e}"));
    }
    let code = code.ok_or_else(|| "Google sign-in failed: missing code".to_string())?;

    let http = Client::new();

    // Exchange code for tokens.
    let mut form: Vec<(String, String)> = vec![
        ("code".into(), code),
        ("client_id".into(), google_client_id.trim().to_string()),
        ("redirect_uri".into(), redirect_uri),
        ("grant_type".into(), "authorization_code".into()),
        ("code_verifier".into(), code_verifier),
    ];
    if !google_client_secret.trim().is_empty() {
        form.push(("client_secret".into(), google_client_secret.trim().to_string()));
    }

    let tokens: GoogleTokenResponse = http
        .post("https://oauth2.googleapis.com/token")
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Google token exchange failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Google token exchange failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Google token decode failed: {e}"))?;

    // Exchange Google tokens to Firebase.
    let fb_url = format!(
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key={}",
        urlencoding::encode(firebase_web_api_key.trim())
    );

    let post_body = format!(
        "id_token={}&access_token={}&providerId=google.com",
        urlencoding::encode(&tokens.id_token),
        urlencoding::encode(&tokens.access_token)
    );

    let payload = serde_json::json!({
        "postBody": post_body,
        "requestUri": "http://localhost",
        "returnIdpCredential": true,
        "returnSecureToken": true
    });

    let fb: FirebaseSessionResponse = http
        .post(fb_url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Firebase signInWithIdp failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Firebase signInWithIdp failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Firebase response decode failed: {e}"))?;

    if fb.id_token.trim().is_empty() {
        return Err("Firebase response missing idToken".to_string());
    }

    Ok(fb)
}
