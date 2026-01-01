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
use std::{path::PathBuf, time::SystemTime};

#[derive(Deserialize)]
pub struct GitStatusPayload {
    pub path: String,
}

#[derive(Deserialize)]
pub struct GitPathsPayload {
    pub path: String,
    pub paths: Vec<String>,
}

#[derive(Deserialize)]
pub struct GitCommitPayload {
    pub path: String,
    pub message: String,
}

#[derive(Deserialize)]
pub struct GitDiffPayload {
    pub path: String,
    pub file_path: String,
    pub view: String, // "staged" | "unstaged"
    pub orig_path: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct GitStatusEntry {
    pub path: String,
    pub orig_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub is_untracked: bool,
    pub is_ignored: bool,
}

#[derive(Serialize, Clone)]
pub struct GitRepoStatus {
    pub repo_root: String,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged: Vec<GitStatusEntry>,
    pub changes: Vec<GitStatusEntry>,
    pub timestamp_ms: u64,
}

#[derive(Serialize)]
pub struct GitDiffContents {
    pub original: String,
    pub modified: String,
    pub is_binary: bool,
}

fn expand_path(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(stripped);
        }
    } else if path == "~" {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home);
        }
    }
    PathBuf::from(path)
}

fn to_entry(entry: emw::git::GitStatusEntry) -> GitStatusEntry {
    GitStatusEntry {
        path: entry.path,
        orig_path: entry.orig_path,
        index_status: entry.index_status.to_string(),
        worktree_status: entry.worktree_status.to_string(),
        is_untracked: entry.is_untracked,
        is_ignored: entry.is_ignored,
    }
}

fn status_bucket(entry: &emw::git::GitStatusEntry) -> (bool, bool) {
    let staged = entry.index_status != ' ' && entry.index_status != '?' && entry.index_status != '!';
    let changed = entry.worktree_status != ' ' && !entry.is_ignored;
    (staged, changed)
}

fn parse_view(view: &str) -> Result<emw::git::DiffView, String> {
    match view {
        "staged" => Ok(emw::git::DiffView::Staged),
        "unstaged" => Ok(emw::git::DiffView::Unstaged),
        other => Err(format!("Unknown diff view `{other}` (expected staged|unstaged)")),
    }
}

#[tauri::command]
pub async fn git_status(payload: GitStatusPayload) -> Result<GitRepoStatus, String> {
    let start = expand_path(&payload.path);
    tauri::async_runtime::spawn_blocking(move || {
        let status = emw::git::repo_status(start).map_err(|error| error.to_string())?;

        let mut staged = Vec::new();
        let mut changes = Vec::new();

        for entry in status.entries {
            let (is_staged, is_changed) = status_bucket(&entry);
            if is_staged {
                staged.push(to_entry(entry.clone()));
            }
            if is_changed || entry.is_untracked {
                changes.push(to_entry(entry));
            }
        }

        Ok(GitRepoStatus {
            repo_root: status.repo_root.to_string_lossy().to_string(),
            branch: status.branch,
            upstream: status.upstream,
            ahead: status.ahead,
            behind: status.behind,
            staged,
            changes,
            timestamp_ms: SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        })
    })
    .await
    .map_err(|error| format!("Task failed: {error}"))?
}

#[tauri::command]
pub async fn git_stage(payload: GitPathsPayload) -> Result<(), String> {
    let start = expand_path(&payload.path);
    let paths = payload.paths;
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = emw::git::resolve_repo_root(start).map_err(|error| error.to_string())?;
        emw::git::stage_paths(repo_root, &paths).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Task failed: {error}"))?
}

#[tauri::command]
pub async fn git_stage_all(payload: GitStatusPayload) -> Result<(), String> {
    let start = expand_path(&payload.path);
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = emw::git::resolve_repo_root(start).map_err(|error| error.to_string())?;
        emw::git::stage_all(repo_root).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Task failed: {error}"))?
}

#[tauri::command]
pub async fn git_unstage(payload: GitPathsPayload) -> Result<(), String> {
    let start = expand_path(&payload.path);
    let paths = payload.paths;
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = emw::git::resolve_repo_root(start).map_err(|error| error.to_string())?;
        emw::git::unstage_paths(repo_root, &paths).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Task failed: {error}"))?
}

#[tauri::command]
pub async fn git_unstage_all(payload: GitStatusPayload) -> Result<(), String> {
    let start = expand_path(&payload.path);
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = emw::git::resolve_repo_root(start).map_err(|error| error.to_string())?;
        emw::git::unstage_all(repo_root).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Task failed: {error}"))?
}

#[tauri::command]
pub async fn git_discard(payload: GitPathsPayload) -> Result<(), String> {
    let start = expand_path(&payload.path);
    let paths = payload.paths;
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = emw::git::resolve_repo_root(start).map_err(|error| error.to_string())?;
        emw::git::discard_worktree_changes(repo_root, &paths).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Task failed: {error}"))?
}

#[tauri::command]
pub async fn git_commit(payload: GitCommitPayload) -> Result<(), String> {
    let start = expand_path(&payload.path);
    let message = payload.message;
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = emw::git::resolve_repo_root(start).map_err(|error| error.to_string())?;
        emw::git::commit(repo_root, &message).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Task failed: {error}"))?
}

#[tauri::command]
pub async fn git_push(payload: GitStatusPayload) -> Result<(), String> {
    let start = expand_path(&payload.path);
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = emw::git::resolve_repo_root(start).map_err(|error| error.to_string())?;
        emw::git::push(repo_root).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Task failed: {error}"))?
}

#[tauri::command]
pub async fn git_diff_contents(payload: GitDiffPayload) -> Result<GitDiffContents, String> {
    let start = expand_path(&payload.path);
    let view = parse_view(&payload.view)?;
    let file_path = payload.file_path;
    let orig_path = payload.orig_path;
    tauri::async_runtime::spawn_blocking(move || {
        let repo_root = emw::git::resolve_repo_root(start).map_err(|error| error.to_string())?;
        let contents = emw::git::diff_contents(
            repo_root,
            view,
            &file_path,
            orig_path.as_deref(),
        )
        .map_err(|error| error.to_string())?;
        Ok(GitDiffContents {
            original: contents.original,
            modified: contents.modified,
            is_binary: contents.is_binary,
        })
    })
    .await
    .map_err(|error| format!("Task failed: {error}"))?
}

