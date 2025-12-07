use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use reqwest::blocking::{Client, Response};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::state::UserProfile;

const DEFAULT_BASE_URL: &str = "https://emwaver-backend.azurewebsites.net";

#[derive(Debug, Clone)]
pub struct BackendClient {
    base_url: String,
    client: Client,
}

impl BackendClient {
    pub fn new(base_url: Option<String>) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .context("failed to build HTTP client")?;
        let url = base_url
            .or_else(|| std::env::var("EMWAVER_BACKEND_URL").ok())
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
        Ok(Self {
            base_url: url.trim_end_matches('/').to_string(),
            client,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    fn endpoint(&self, path: &str) -> String {
        if path.starts_with('/') {
            format!("{}{}", self.base_url, path)
        } else {
            format!("{}/{}", self.base_url, path)
        }
    }

    fn parse_response<T: DeserializeOwned>(&self, response: Response) -> Result<T> {
        let status = response.status();
        let text = response.text().context("failed to read response body")?;
        if !status.is_success() {
            if let Ok(err) = serde_json::from_str::<ApiErrorResponse>(&text) {
                let code = err.error.unwrap_or_else(|| status.as_str().to_string());
                let message = err
                    .message
                    .or_else(|| err.detail)
                    .unwrap_or_else(|| text.clone());
                bail!("API error {}: {}", code, message);
            }
            bail!("API error {}: {}", status.as_str(), text);
        }
        serde_json::from_str::<T>(&text)
            .with_context(|| format!("failed to parse response body: {}", text))
    }

    fn parse_unit(&self, response: Response) -> Result<()> {
        let status = response.status();
        if !status.is_success() {
            let text = response.text().unwrap_or_default();
            if let Ok(err) = serde_json::from_str::<ApiErrorResponse>(&text) {
                let code = err.error.unwrap_or_else(|| status.as_str().to_string());
                let message = err
                    .message
                    .or_else(|| err.detail)
                    .unwrap_or_else(|| text.clone());
                bail!("API error {}: {}", code, message);
            }
            bail!("API error {}: {}", status.as_str(), text);
        }
        Ok(())
    }

    fn with_auth_headers(&self, access_token: &str) -> Result<HeaderMap> {
        let mut headers = HeaderMap::new();
        let value = format!("Bearer {}", access_token);
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&value).map_err(|_| anyhow!("invalid access token"))?,
        );
        Ok(headers)
    }

    pub fn login(&self, email: &str, password: &str) -> Result<LoginSuccess> {
        let url = self.endpoint("/auth/login");
        let payload = serde_json::json!({
            "email": email,
            "password": password,
        });
        let response = self
            .client
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .json(&payload)
            .send()
            .context("failed to send login request")?;
        let body: LoginResponse = self.parse_response(response)?;
        Ok(LoginSuccess {
            access_token: body.access_token,
            refresh_token: body.refresh_token,
            user: body.user.into_user_profile()?,
        })
    }

    pub fn logout(&self, access_token: &str) -> Result<()> {
        let url = self.endpoint("/auth/logout");
        let headers = self.with_auth_headers(access_token)?;
        let response = self
            .client
            .post(url)
            .headers(headers)
            .send()
            .context("failed to send logout request")?;
        self.parse_unit(response)
    }

    pub fn list_files(&self, access_token: &str) -> Result<Vec<FileSummary>> {
        let url = self.endpoint("/files");
        let headers = self.with_auth_headers(access_token)?;
        let response = self
            .client
            .get(url)
            .headers(headers)
            .send()
            .context("failed to send list files request")?;
        let body: FileListResponse = self.parse_response(response)?;
        Ok(body.files.into_iter().map(FileSummary::from).collect())
    }

    pub fn download_file(&self, access_token: &str, file_id: &str) -> Result<FileDownload> {
        let url = self.endpoint(&format!("/files/{}?include=content", file_id));
        let headers = self.with_auth_headers(access_token)?;
        let response = self
            .client
            .get(url)
            .headers(headers)
            .send()
            .context("failed to send get file request")?;
        let body: FileDetailResponse = self.parse_response(response)?;
        let download = FileDownload::try_from(body.file)?;
        Ok(download)
    }

    pub fn create_file(
        &self,
        access_token: &str,
        name: &str,
        data: &[u8],
        content_type: Option<&str>,
    ) -> Result<FileSummary> {
        let url = self.endpoint("/files");
        let headers = self.with_auth_headers(access_token)?;
        let payload = FileUploadPayload::from_bytes(name, data, content_type)?;
        let response = self
            .client
            .post(url)
            .headers(headers)
            .json(&payload)
            .send()
            .context("failed to send create file request")?;
        let body: FileDetailResponse = self.parse_response(response)?;
        Ok(FileSummary::from(body.file))
    }

    pub fn update_file(
        &self,
        access_token: &str,
        file_id: &str,
        data: &[u8],
        etag: &str,
        is_text: bool,
    ) -> Result<FileSummary> {
        let url = self.endpoint(&format!("/files/{}", file_id));
        let headers = self.with_auth_headers(access_token)?;
        let payload = FileUpdatePayload::from_bytes(data, etag, is_text)?;
        let response = self
            .client
            .patch(url)
            .headers(headers)
            .json(&payload)
            .send()
            .context("failed to send update file request")?;
        let body: FileDetailResponse = self.parse_response(response)?;
        Ok(FileSummary::from(body.file))
    }
}

#[derive(Debug, Deserialize)]
struct ApiErrorResponse {
    error: Option<String>,
    message: Option<String>,
    detail: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LoginResponse {
    access_token: String,
    refresh_token: String,
    user: AuthUser,
}

#[derive(Debug, Deserialize)]
struct FileListResponse {
    files: Vec<FileRecord>,
}

#[derive(Debug, Deserialize)]
struct FileDetailResponse {
    file: FileRecord,
}

#[derive(Debug, Deserialize, Clone)]
struct FileRecord {
    id: String,
    name: String,
    #[serde(default)]
    extension: Option<String>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    etag: Option<String>,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    content_base64: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AuthUser {
    id: String,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    first_name: Option<String>,
    #[serde(default)]
    last_name: Option<String>,
    #[serde(default)]
    nickname: Option<String>,
}

impl AuthUser {
    fn into_user_profile(self) -> Result<UserProfile> {
        Ok(UserProfile {
            id: self.id,
            email: self.email,
            username: self.username,
            first_name: self.first_name,
            last_name: self.last_name,
            nickname: self.nickname,
        })
    }
}

#[derive(Debug, Clone)]
pub struct LoginSuccess {
    pub access_token: String,
    pub refresh_token: String,
    pub user: UserProfile,
}

#[derive(Debug, Clone)]
pub struct FileSummary {
    pub id: String,
    pub name: String,
    pub extension: Option<String>,
    pub kind: Option<String>,
    pub etag: Option<String>,
}

impl From<FileRecord> for FileSummary {
    fn from(value: FileRecord) -> Self {
        Self {
            id: value.id,
            name: value.name,
            extension: value.extension,
            kind: value.kind,
            etag: value.etag,
        }
    }
}

#[derive(Debug, Clone)]
pub struct FileDownload {
    pub summary: FileSummary,
    pub bytes: Vec<u8>,
}

impl TryFrom<FileRecord> for FileDownload {
    type Error = anyhow::Error;

    fn try_from(mut record: FileRecord) -> Result<Self> {
        let bytes = if let Some(content) = record.content.take() {
            content.into_bytes()
        } else if let Some(encoded) = record.content_base64.take() {
            STANDARD
                .decode(encoded.as_bytes())
                .context("failed to decode content_base64")?
        } else {
            Vec::new()
        };
        Ok(Self {
            summary: FileSummary::from(record),
            bytes,
        })
    }
}

#[derive(Debug, Serialize)]
struct FileUploadPayload {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_type: Option<String>,
}

impl FileUploadPayload {
    fn from_bytes(name: &str, data: &[u8], content_type: Option<&str>) -> Result<Self> {
        let extension = std::path::Path::new(name)
            .extension()
            .and_then(|os| os.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let (content, content_base64) = if extension == "js" || extension == ".js" {
            let text = std::str::from_utf8(data).context("file content is not valid UTF-8")?;
            (Some(text.to_string()), None)
        } else {
            (None, Some(STANDARD.encode(data)))
        };
        Ok(Self {
            name: name.to_string(),
            content,
            content_base64,
            content_type: content_type.map(|s| s.to_string()),
        })
    }
}

#[derive(Debug, Serialize)]
struct FileUpdatePayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_base64: Option<String>,
    etag: String,
}

impl FileUpdatePayload {
    fn from_bytes(data: &[u8], etag: &str, is_text: bool) -> Result<Self> {
        if is_text {
            let text = std::str::from_utf8(data).context("file content is not valid UTF-8")?;
            Ok(Self {
                content: Some(text.to_string()),
                content_base64: None,
                etag: etag.to_string(),
            })
        } else {
            Ok(Self {
                content: None,
                content_base64: Some(STANDARD.encode(data)),
                etag: etag.to_string(),
            })
        }
    }
}
