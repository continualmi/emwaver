use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use directories::ProjectDirs;

const QUALIFIER: &str = "com";
const ORGANIZATION: &str = "Continuous";
const APPLICATION: &str = "emwaver";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct WorkspaceState {
    pub root: PathBuf,
    #[serde(default)]
    pub tracked_hashes: HashMap<String, String>,
    #[serde(default)]
    pub staged: HashMap<String, String>,
    #[serde(default)]
    pub remote: HashMap<String, RemoteFileState>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct StateData {
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub user: Option<UserProfile>,
    #[serde(default)]
    pub default_workspace: Option<String>,
    #[serde(default)]
    pub workspaces: HashMap<String, WorkspaceState>,
    #[serde(default)]
    pub backend_base_url: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct RemoteFileState {
    pub file_id: String,
    #[serde(default)]
    pub etag: Option<String>,
    #[serde(default)]
    pub extension: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct UserProfile {
    pub id: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub nickname: Option<String>,
}

#[derive(Debug)]
pub struct StateStore {
    path: PathBuf,
    data_dir: PathBuf,
    pub data: StateData,
}

impl StateStore {
    pub fn load() -> Result<Self> {
        let dirs = ProjectDirs::from(QUALIFIER, ORGANIZATION, APPLICATION)
            .context("unable to determine configuration directory")?;
        let state_dir = dirs.data_dir();
        fs::create_dir_all(state_dir).with_context(|| {
            format!("failed to create state directory: {}", state_dir.display())
        })?;
        let path = state_dir.join("state.json");

        let data = if path.exists() {
            let raw = fs::read(&path)
                .with_context(|| format!("failed to read state file: {}", path.display()))?;
            serde_json::from_slice(&raw)
                .with_context(|| format!("failed to parse state file: {}", path.display()))?
        } else {
            StateData::default()
        };

        Ok(Self {
            path,
            data_dir: state_dir.to_path_buf(),
            data,
        })
    }

    pub fn save(&self) -> Result<()> {
        let raw = serde_json::to_vec_pretty(&self.data)?;
        fs::write(&self.path, raw)
            .with_context(|| format!("failed to write state file: {}", self.path.display()))
    }

    pub fn access_token(&self) -> Option<&str> {
        self.data.access_token.as_deref()
    }

    pub fn set_tokens(&mut self, access: String, refresh: String) {
        self.data.access_token = Some(access);
        self.data.refresh_token = Some(refresh);
    }

    pub fn set_user(&mut self, user: UserProfile) {
        self.data.user = Some(user);
    }

    pub fn clear_tokens(&mut self) {
        self.data.access_token = None;
        self.data.refresh_token = None;
        self.data.user = None;
    }

    pub fn default_workspace(&self) -> Option<&str> {
        self.data.default_workspace.as_deref()
    }

    pub fn set_default_workspace(&mut self, workspace: String) {
        self.data.default_workspace = Some(workspace);
    }

    pub fn workspaces(&self) -> impl Iterator<Item = (&String, &WorkspaceState)> {
        self.data.workspaces.iter()
    }

    pub fn workspace(&self, name: &str) -> Option<&WorkspaceState> {
        self.data.workspaces.get(name)
    }

    pub fn workspace_mut(&mut self, name: &str) -> Option<&mut WorkspaceState> {
        self.data.workspaces.get_mut(name)
    }

    pub fn upsert_workspace(&mut self, name: String, root: PathBuf) -> &mut WorkspaceState {
        self.data
            .workspaces
            .entry(name)
            .or_insert_with(|| WorkspaceState {
                root,
                ..Default::default()
            })
    }

    pub fn workspace_cache_root(&self, name: &str) -> PathBuf {
        self.data_dir.join("workspaces").join(name)
    }

    pub fn ensure_workspace_cache(&self, name: &str) -> Result<PathBuf> {
        let root = self.workspace_cache_root(name);
        fs::create_dir_all(&root)
            .with_context(|| format!("failed to create cache directory: {}", root.display()))?;
        Ok(root)
    }

    pub fn cached_file_path(&self, name: &str, relative_path: &str) -> PathBuf {
        self.workspace_cache_root(name).join(relative_path)
    }

    pub fn backend_base_url(&self) -> Option<&str> {
        self.data.backend_base_url.as_deref()
    }

    pub fn set_backend_base_url(&mut self, url: String) {
        self.data.backend_base_url = Some(url);
    }
}

impl WorkspaceState {
    pub fn stage(&mut self, relative_path: &str, digest: String) {
        self.staged.insert(relative_path.to_string(), digest);
    }

    pub fn clear_staging(&mut self) {
        self.staged.clear();
    }

    pub fn unstage(&mut self, relative_path: &str) {
        self.staged.remove(relative_path);
    }

    pub fn staged_digest(&self, relative_path: &str) -> Option<&String> {
        self.staged.get(relative_path)
    }

    pub fn staged_paths(&self) -> impl Iterator<Item = &String> {
        self.staged.keys()
    }

    pub fn update_hash(&mut self, relative_path: String, digest: String) {
        self.tracked_hashes.insert(relative_path, digest);
    }

    pub fn tracked_hash(&self, relative_path: &str) -> Option<&String> {
        self.tracked_hashes.get(relative_path)
    }

    pub fn tracked(&self) -> impl Iterator<Item = (&String, &String)> {
        self.tracked_hashes.iter()
    }

    pub fn root_path(&self) -> &Path {
        &self.root
    }

    pub fn set_remote(&mut self, relative_path: String, remote: RemoteFileState) {
        self.remote.insert(relative_path, remote);
    }

    pub fn remote(&self, relative_path: &str) -> Option<&RemoteFileState> {
        self.remote.get(relative_path)
    }

    pub fn clear_remote(&mut self) {
        self.remote.clear();
    }
}
