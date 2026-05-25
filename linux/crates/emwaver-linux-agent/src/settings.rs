use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use thiserror::Error;

const APP_DIR: &str = "emwaver";
const CONFIG_FILE: &str = "agent.json";
const SECRET_LABEL: &str = "EMWaver Agent API Key";
const SECRET_ATTRIBUTES: &[&str] = &["application", "emwaver", "credential", "agent-api-key"];

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AgentConfiguration {
    pub endpoint: Option<String>,
    pub api_key: Option<String>,
    pub api_key_source: AgentCredentialSource,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub enum AgentCredentialSource {
    Env,
    SecretService,
    #[default]
    Missing,
}

#[derive(Debug, Error)]
pub enum AgentConfigError {
    #[error("Agent endpoint must use public /api/mgpt routes")]
    InvalidEndpoint,
    #[error("failed to write Agent config: {0}")]
    Write(String),
    #[error("Secret Service command failed: {0}")]
    SecretService(String),
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
struct AgentConfigFile {
    endpoint: Option<String>,
}

pub fn load_agent_configuration() -> AgentConfiguration {
    let endpoint = env_public_endpoint().or_else(|| {
        read_agent_config_file()
            .endpoint
            .filter(|endpoint| endpoint_is_public_mgpt(endpoint))
    });
    let (api_key, api_key_source) = env_agent_key()
        .map(|key| (Some(key), AgentCredentialSource::Env))
        .unwrap_or_else(|| match lookup_agent_api_key_secret_tool() {
            Ok(Some(key)) => (Some(key), AgentCredentialSource::SecretService),
            _ => (None, AgentCredentialSource::Missing),
        });

    AgentConfiguration {
        endpoint,
        api_key,
        api_key_source,
    }
}

pub fn save_agent_endpoint(endpoint: Option<&str>) -> Result<(), AgentConfigError> {
    let endpoint = endpoint
        .map(str::trim)
        .filter(|endpoint| !endpoint.is_empty())
        .map(validate_public_endpoint)
        .transpose()?;
    let config = AgentConfigFile { endpoint };
    let path = agent_config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| AgentConfigError::Write(err.to_string()))?;
    }
    let body = serde_json::to_string_pretty(&config)
        .map_err(|err| AgentConfigError::Write(err.to_string()))?;
    fs::write(path, body).map_err(|err| AgentConfigError::Write(err.to_string()))
}

pub fn store_agent_api_key_secret_tool(api_key: &str) -> Result<(), AgentConfigError> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return clear_agent_api_key_secret_tool();
    }
    run_secret_tool_store(api_key)
}

pub fn clear_agent_api_key_secret_tool() -> Result<(), AgentConfigError> {
    let output = Command::new("secret-tool")
        .args(secret_tool_clear_args())
        .output()
        .map_err(|err| AgentConfigError::SecretService(err.to_string()))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AgentConfigError::SecretService(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ))
    }
}

fn env_public_endpoint() -> Option<String> {
    ["EMWAVER_AGENT_ENDPOINT", "CONTINUAL_AGENT_ENDPOINT"]
        .iter()
        .find_map(|name| {
            env::var(name)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| endpoint_is_public_mgpt(value))
        })
}

fn env_agent_key() -> Option<String> {
    ["EMWAVER_AGENT_API_KEY", "CONTINUAL_AGENT_API_KEY"]
        .iter()
        .find_map(|name| {
            env::var(name)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
}

fn read_agent_config_file() -> AgentConfigFile {
    let path = agent_config_path();
    let Ok(body) = fs::read_to_string(path) else {
        return AgentConfigFile::default();
    };
    serde_json::from_str(&body).unwrap_or_default()
}

fn agent_config_path() -> PathBuf {
    if let Some(config_home) = env::var_os("XDG_CONFIG_HOME").filter(|value| !value.is_empty()) {
        return PathBuf::from(config_home).join(APP_DIR).join(CONFIG_FILE);
    }
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config")
        .join(APP_DIR)
        .join(CONFIG_FILE)
}

fn lookup_agent_api_key_secret_tool() -> Result<Option<String>, AgentConfigError> {
    let output = Command::new("secret-tool")
        .args(secret_tool_lookup_args())
        .output()
        .map_err(|err| AgentConfigError::SecretService(err.to_string()))?;
    if !output.status.success() {
        return Ok(None);
    }
    let key = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!key.is_empty()).then_some(key))
}

fn run_secret_tool_store(api_key: &str) -> Result<(), AgentConfigError> {
    let mut child = Command::new("secret-tool")
        .args(secret_tool_store_args())
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| AgentConfigError::SecretService(err.to_string()))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(api_key.as_bytes())
            .map_err(|err| AgentConfigError::SecretService(err.to_string()))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|err| AgentConfigError::SecretService(err.to_string()))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AgentConfigError::SecretService(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ))
    }
}

fn validate_public_endpoint(endpoint: &str) -> Result<String, AgentConfigError> {
    if endpoint_is_public_mgpt(endpoint) {
        Ok(endpoint.to_string())
    } else {
        Err(AgentConfigError::InvalidEndpoint)
    }
}

fn endpoint_is_public_mgpt(endpoint: &str) -> bool {
    endpoint.contains("/api/mgpt/") && !endpoint.contains("/backend-api/")
}

fn secret_tool_lookup_args() -> Vec<&'static str> {
    let mut args = vec!["lookup"];
    args.extend_from_slice(SECRET_ATTRIBUTES);
    args
}

fn secret_tool_store_args() -> Vec<&'static str> {
    let mut args = vec!["store", "--label", SECRET_LABEL];
    args.extend_from_slice(SECRET_ATTRIBUTES);
    args
}

fn secret_tool_clear_args() -> Vec<&'static str> {
    let mut args = vec!["clear"];
    args.extend_from_slice(SECRET_ATTRIBUTES);
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_public_mgpt_endpoint_only() {
        assert!(validate_public_endpoint("https://mdl.continualmi.com/api/mgpt/respond").is_ok());
        assert!(
            validate_public_endpoint("https://mdl.continualmi.com/backend-api/mgpt/respond")
                .is_err()
        );
        assert!(validate_public_endpoint("https://mdl.continualmi.com/mgpt-api").is_err());
    }

    #[test]
    fn secret_tool_args_use_stable_local_attributes() {
        assert_eq!(
            secret_tool_lookup_args(),
            vec![
                "lookup",
                "application",
                "emwaver",
                "credential",
                "agent-api-key"
            ]
        );
        assert_eq!(
            secret_tool_store_args(),
            vec![
                "store",
                "--label",
                "EMWaver Agent API Key",
                "application",
                "emwaver",
                "credential",
                "agent-api-key"
            ]
        );
    }
}
