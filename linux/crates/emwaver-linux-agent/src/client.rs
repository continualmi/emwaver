use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AgentRequest {
    pub universe: Option<String>,
    pub user_input: String,
    pub selected_script: Option<String>,
    pub device_summary: Option<String>,
    pub recent_logs: Vec<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct AgentResponse {
    pub message: String,
    pub code: Option<String>,
    pub patch: Option<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    pub usage: Option<AgentUsage>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AgentUsage {
    pub metered: bool,
}

#[derive(Debug, Serialize)]
struct MgptRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    universe: Option<String>,
    #[serde(rename = "userInput")]
    user_input: String,
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
        let payload = MgptRequest {
            universe: request.universe.clone(),
            user_input: request.user_input_for_public_api(),
        };
        let response = self
            .http
            .post(&self.endpoint)
            .bearer_auth(key)
            .json(&payload)
            .send()
            .await
            .map_err(|err| AgentError::Request(err.to_string()))?;
        response
            .json::<AgentResponse>()
            .await
            .map_err(|err| AgentError::Request(err.to_string()))
    }
}

impl AgentRequest {
    fn user_input_for_public_api(&self) -> String {
        let mut sections = Vec::new();
        sections.push(self.user_input.clone());

        if let Some(script) = self
            .selected_script
            .as_ref()
            .filter(|script| !script.is_empty())
        {
            sections.push(format!("Selected script:\n```javascript\n{script}\n```"));
        }
        if let Some(device) = self
            .device_summary
            .as_ref()
            .filter(|device| !device.is_empty())
        {
            sections.push(format!("Device context:\n{device}"));
        }
        if !self.recent_logs.is_empty() {
            sections.push(format!("Recent logs:\n{}", self.recent_logs.join("\n")));
        }

        sections.join("\n\n")
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

    #[test]
    fn folds_local_context_into_public_user_input() {
        let request = AgentRequest {
            universe: Some("workspace-1".to_string()),
            user_input: "Fix this blink script.".to_string(),
            selected_script: Some("gpio.high(13);".to_string()),
            device_summary: Some("STM32F042 over USB".to_string()),
            recent_logs: vec!["Script failed: Device returned ERR".to_string()],
        };

        let user_input = request.user_input_for_public_api();
        assert!(user_input.contains("Fix this blink script."));
        assert!(user_input.contains("Selected script:"));
        assert!(user_input.contains("STM32F042 over USB"));
        assert!(user_input.contains("Device returned ERR"));
    }

    #[test]
    fn serializes_public_mgpt_payload_shape() {
        let payload = MgptRequest {
            universe: Some("u1".to_string()),
            user_input: "hello".to_string(),
        };
        let json = serde_json::to_value(payload).unwrap();
        assert_eq!(json["universe"], "u1");
        assert_eq!(json["userInput"], "hello");
        assert!(json.get("user_input").is_none());
    }

    #[test]
    fn decodes_public_agent_response_shape() {
        let response: AgentResponse = serde_json::from_str(
            r#"{"message":"ok","code":"gpio.low(13);","warnings":["check pin"],"usage":{"metered":true}}"#,
        )
        .unwrap();
        assert_eq!(response.message, "ok");
        assert_eq!(response.code.as_deref(), Some("gpio.low(13);"));
        assert_eq!(response.warnings, vec!["check pin"]);
        assert_eq!(response.usage.unwrap().metered, true);
    }
}
