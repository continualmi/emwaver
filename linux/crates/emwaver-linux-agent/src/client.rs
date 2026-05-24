use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AgentRequest {
    pub user_input: String,
    pub selected_script: Option<String>,
    pub device_summary: Option<String>,
    pub recent_logs: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AgentResponse {
    pub text: String,
}

#[derive(Debug, Error)]
pub enum AgentError {
    #[error("Agent API key is not configured")]
    MissingApiKey,
    #[error("Agent endpoint must use public /api/mgpt routes")]
    InvalidEndpoint,
    #[error("Agent request failed: {0}")]
    Request(String),
}

#[derive(Clone)]
pub struct AgentClient {
    endpoint: String,
    api_key: Option<String>,
    http: reqwest::Client,
}

impl AgentClient {
    pub fn new(endpoint: impl Into<String>, api_key: Option<String>) -> Result<Self, AgentError> {
        let endpoint = endpoint.into();
        if endpoint.contains("/backend-api/") || !endpoint.contains("/api/mgpt/") {
            return Err(AgentError::InvalidEndpoint);
        }
        Ok(Self {
            endpoint,
            api_key,
            http: reqwest::Client::new(),
        })
    }

    pub fn configured(&self) -> bool {
        self.api_key
            .as_ref()
            .is_some_and(|key| !key.trim().is_empty())
    }

    pub async fn send(&self, request: &AgentRequest) -> Result<AgentResponse, AgentError> {
        let Some(key) = self.api_key.as_ref().filter(|key| !key.trim().is_empty()) else {
            return Err(AgentError::MissingApiKey);
        };
        let response = self
            .http
            .post(&self.endpoint)
            .bearer_auth(key)
            .json(request)
            .send()
            .await
            .map_err(|err| AgentError::Request(err.to_string()))?;
        response
            .json::<AgentResponse>()
            .await
            .map_err(|err| AgentError::Request(err.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_internal_backend_routes() {
        assert!(AgentClient::new(
            "https://example.test/backend-api/mgpt/respond",
            Some("key".to_string())
        )
        .is_err());
    }

    #[test]
    fn accepts_public_mgpt_routes() {
        assert!(AgentClient::new("https://example.test/api/mgpt/respond", None).is_ok());
    }
}
