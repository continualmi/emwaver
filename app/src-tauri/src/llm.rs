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

use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{OnceLock, Once},
};

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL: &str = "x-ai/grok-4.1-fast";

static ENV_INIT: Once = Once::new();
static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LlmChatPayload {
    pub messages: Vec<LlmMessage>,
    pub model: Option<String>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LlmChatResponse {
    pub content: String,
    pub model: String,
}

#[derive(Debug, Serialize)]
struct OpenRouterChatRequest {
    model: String,
    messages: Vec<LlmMessage>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterChatResponse {
    model: Option<String>,
    choices: Option<Vec<OpenRouterChoice>>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterChoice {
    message: Option<OpenRouterChoiceMessage>,
}

#[derive(Debug, Deserialize)]
struct OpenRouterChoiceMessage {
    content: Option<String>,
}

fn init_env_from_repo_root_once() {
    ENV_INIT.call_once(|| {
        // Load repo-root .env if present.
        // app/src-tauri -> repo root is ../../
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_dotenv = manifest_dir.join("../../.env");
        let _ = dotenvy::from_path(repo_dotenv);

        // Also try default lookup in the current working directory.
        let _ = dotenvy::dotenv();
    });
}

fn http_client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("EMWaver/desktop")
            .build()
            .expect("failed to build http client")
    })
}

#[tauri::command]
pub async fn llm_chat(payload: LlmChatPayload) -> Result<LlmChatResponse, String> {
    init_env_from_repo_root_once();

    let api_key = std::env::var("OPENROUTER_API_KEY")
        .map_err(|_| "Missing OPENROUTER_API_KEY (expected in repo root .env or environment)".to_string())?;

    let model = payload
        .model
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());

    let req_body = OpenRouterChatRequest {
        model: model.clone(),
        messages: payload.messages,
        max_tokens: payload.max_tokens.or(Some(512)),
        temperature: payload.temperature.or(Some(0.2)),
    };

    let resp = http_client()
        .post(OPENROUTER_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("X-Title", "EMWaver")
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("OpenRouter request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("OpenRouter error ({status}): {body}"));
    }

    let data: OpenRouterChatResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to decode OpenRouter response: {e}"))?;

    let content = data
        .choices
        .as_ref()
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.message.as_ref())
        .and_then(|message| message.content.as_ref())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "OpenRouter response missing message content".to_string())?;

    Ok(LlmChatResponse {
        content,
        model: data.model.unwrap_or(model),
    })
}
