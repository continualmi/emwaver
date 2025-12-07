use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use rpassword::prompt_password;
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::backend::{BackendClient, FileDownload};
use crate::cli::{Cli, Commands};
use crate::shell;
use crate::state::{RemoteFileState, StateStore, WorkspaceState};

const CACHE_DIR_NAME: &str = ".emwaver";

pub fn dispatch(cli: Cli) -> Result<()> {
    let mut state = StateStore::load()?;
    let base_url = state.backend_base_url().map(|s| s.to_string());
    let client = BackendClient::new(base_url)?;

    let result = match cli.command {
        Commands::Login { email, password } => handle_login(&client, &mut state, email, password),
        Commands::Clone {
            workspace,
            destination,
        } => handle_clone(&client, &mut state, workspace, destination),
        Commands::Status => handle_status(&state),
        Commands::Diff { paths } => handle_diff(&state, paths),
        Commands::Add { files } => handle_add(&mut state, files),
        Commands::Pull => handle_pull(&client, &mut state),
        Commands::Push => handle_push(&client, &mut state),
        Commands::Logout => handle_logout(&client, &mut state),
        Commands::Shell { verbose } => handle_shell(&mut state, verbose),
    };

    if result.is_ok() {
        state.save()?;
    }

    result
}

fn handle_login(
    client: &BackendClient,
    state: &mut StateStore,
    email: Option<String>,
    password: Option<String>,
) -> Result<()> {
    let email = match email {
        Some(value) => value,
        None => prompt("Email: ")?,
    };
    let password = match password {
        Some(value) => value,
        None => prompt_password("Password: ").context("failed to read password")?,
    };

    let login = client.login(&email, &password)?;
    state.set_tokens(login.access_token.clone(), login.refresh_token.clone());
    state.set_user(login.user.clone());
    state.set_backend_base_url(client.base_url().to_string());

    let display_email = login
        .user
        .email
        .as_deref()
        .unwrap_or_else(|| email.as_str());
    println!("Logged in as {display_email}.");
    Ok(())
}

fn handle_clone(
    client: &BackendClient,
    state: &mut StateStore,
    workspace: String,
    destination: Option<PathBuf>,
) -> Result<()> {
    ensure_logged_in(state)?;
    let access_token = state
        .access_token()
        .ok_or_else(|| anyhow!("access token missing"))?
        .to_string();

    let dest = destination.unwrap_or_else(|| PathBuf::from(&workspace));
    if dest.exists() {
        if dest.is_file() {
            bail!("destination already exists as a file: {}", dest.display());
        }
        if dest.read_dir()?.next().is_some() {
            bail!("destination directory is not empty: {}", dest.display());
        }
    } else {
        fs::create_dir_all(&dest)
            .with_context(|| format!("failed to create destination: {}", dest.display()))?;
    }

    let canonical = dest
        .canonicalize()
        .with_context(|| format!("failed to canonicalize destination: {}", dest.display()))?;

    let cache_root = state.ensure_workspace_cache(&workspace)?;
    let workspace_entry = state.upsert_workspace(workspace.clone(), canonical.clone());
    workspace_entry.tracked_hashes.clear();
    workspace_entry.clear_staging();
    workspace_entry.clear_remote();

    let remote_files = client.list_files(&access_token)?;
    let mut applied = 0usize;
    for summary in remote_files {
        let download = client.download_file(&access_token, &summary.id)?;
        if apply_remote_file(workspace_entry, &canonical, &cache_root, download)? {
            applied += 1;
        }
    }

    state.set_default_workspace(workspace.clone());
    println!(
        "Workspace '{}' initialized at {} ({} file(s) synced)",
        workspace,
        canonical.display(),
        applied
    );
    Ok(())
}

fn handle_status(state: &StateStore) -> Result<()> {
    let (name, workspace) = resolve_workspace(state)?;
    let status = collect_status(workspace)?;

    println!("On workspace '{}':", name);
    if status.staged.is_empty()
        && status.modified.is_empty()
        && status.deleted.is_empty()
        && status.untracked.is_empty()
    {
        println!("  No changes");
        return Ok(());
    }

    if !status.staged.is_empty() {
        println!("  Staged:");
        for path in status.staged {
            println!("    {path}");
        }
    }

    if !status.modified.is_empty() {
        println!("  Modified:");
        for path in status.modified {
            println!("    {path}");
        }
    }

    if !status.deleted.is_empty() {
        println!("  Deleted:");
        for path in status.deleted {
            println!("    {path}");
        }
    }

    if !status.untracked.is_empty() {
        println!("  Untracked:");
        for path in status.untracked {
            println!("    {path}");
        }
    }

    Ok(())
}

fn handle_diff(state: &StateStore, paths: Vec<PathBuf>) -> Result<()> {
    let (name, workspace) = resolve_workspace(state)?;
    let mut targets = Vec::new();

    if paths.is_empty() {
        let status = collect_status(workspace)?;
        targets.extend(status.modified);
        targets.extend(status.staged);
    } else {
        for path in paths {
            let rel = relative_to_workspace(workspace, &path)?;
            targets.push(rel);
        }
    }

    if targets.is_empty() {
        println!("No changes to diff.");
        return Ok(());
    }

    for rel in targets {
        let cached_path = state.cached_file_path(name, &rel);
        let current_path = workspace.root_path().join(&rel);
        if current_path.exists() {
            let baseline = if cached_path.exists() {
                Some(cached_path.as_path())
            } else {
                None
            };
            print_diff(baseline, Some(&current_path))?;
        } else if cached_path.exists() {
            println!("diff -- {rel} (deleted)");
            print_diff(Some(cached_path.as_path()), None)?;
        } else {
            println!("Skipping {rel} (no baseline available yet)");
        }
    }

    Ok(())
}

fn handle_add(state: &mut StateStore, files: Vec<PathBuf>) -> Result<()> {
    if files.is_empty() {
        bail!("no files provided to add");
    }
    let name = resolve_workspace_name(state)?;
    let workspace = state
        .workspace_mut(&name)
        .ok_or_else(|| anyhow!("workspace not found"))?;
    let mut staged_set = HashSet::new();

    for file in files {
        let rel = relative_to_workspace(workspace, &file)?;
        let abs = workspace.root_path().join(&rel);
        if !abs.exists() {
            bail!("file does not exist: {}", abs.display());
        }
        if abs.is_dir() {
            bail!("adding directories is not supported yet: {}", abs.display());
        }

        let digest = digest_for_file(&abs)?;
        workspace.stage(&rel, digest);
        staged_set.insert(rel);
    }

    let staged_count = staged_set.len();
    if staged_count == 0 {
        println!("Nothing to add.");
    } else {
        println!("Staged {staged_count} item(s).");
    }

    Ok(())
}

fn handle_pull(client: &BackendClient, state: &mut StateStore) -> Result<()> {
    ensure_logged_in(state)?;
    let workspace_name = resolve_workspace_name(state)?;
    let access_token = state
        .access_token()
        .ok_or_else(|| anyhow!("access token missing"))?
        .to_string();
    let cache_root = state.ensure_workspace_cache(&workspace_name)?;

    let (workspace_root, staged_paths) = {
        let workspace = state
            .workspace(&workspace_name)
            .ok_or_else(|| anyhow!("workspace not found"))?;
        let staged: Vec<String> = workspace.staged_paths().cloned().collect();
        (workspace.root_path().to_path_buf(), staged)
    };

    let downloads = client.list_files(&access_token)?;
    let workspace = state
        .workspace_mut(&workspace_name)
        .ok_or_else(|| anyhow!("workspace not found"))?;

    let staged_set: HashSet<String> = staged_paths.into_iter().collect();
    let mut applied = 0usize;
    for summary in downloads {
        let download = client.download_file(&access_token, &summary.id)?;
        if apply_remote_file_with_conflict_check(
            workspace,
            &workspace_root,
            &cache_root,
            download,
            &staged_set,
        )? {
            applied += 1;
        }
    }

    println!("Pulled {applied} file(s).");
    Ok(())
}

fn handle_push(client: &BackendClient, state: &mut StateStore) -> Result<()> {
    ensure_logged_in(state)?;
    let workspace_name = resolve_workspace_name(state)?;
    let access_token = state
        .access_token()
        .ok_or_else(|| anyhow!("access token missing"))?
        .to_string();
    let cache_root = state.ensure_workspace_cache(&workspace_name)?;

    let workspace = state
        .workspace_mut(&workspace_name)
        .ok_or_else(|| anyhow!("workspace not found"))?;
    let staged: Vec<String> = workspace.staged_paths().cloned().collect();
    if staged.is_empty() {
        println!("Nothing staged to push.");
        return Ok(());
    }

    let mut pushed = 0usize;
    for relative in staged {
        let file_path = workspace.root_path().join(&relative);
        if !file_path.exists() {
            println!("Skipping {} (file missing)", relative);
            workspace.unstage(&relative);
            continue;
        }

        let bytes = fs::read(&file_path)
            .with_context(|| format!("failed to read file: {}", file_path.display()))?;
        let is_text = file_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("js"))
            .unwrap_or(false);

        let response = if let Some(remote) = workspace.remote(&relative).cloned() {
            let etag = remote.etag.as_deref().unwrap_or("");
            client.update_file(&access_token, &remote.file_id, &bytes, etag, is_text)?
        } else {
            client.create_file(&access_token, &relative, &bytes, None)?
        };

        let digest = digest_bytes(&bytes);
        workspace.update_hash(relative.clone(), digest);
        workspace.unstage(&relative);
        workspace.set_remote(
            relative.clone(),
            RemoteFileState {
                file_id: response.id.clone(),
                etag: response.etag.clone(),
                extension: response.extension.clone(),
                kind: response.kind.clone(),
            },
        );

        let cache_path = cache_root.join(&relative);
        if let Some(parent) = cache_path.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!("failed to create cache directory: {}", parent.display())
            })?;
        }
        fs::write(&cache_path, &bytes)
            .with_context(|| format!("failed to write cache file: {}", cache_path.display()))?;

        pushed += 1;
    }

    if pushed == 0 {
        println!("No changes were pushed.");
    } else {
        println!("Pushed {pushed} file(s).");
    }
    Ok(())
}

fn handle_logout(client: &BackendClient, state: &mut StateStore) -> Result<()> {
    if let Some(token) = state.access_token() {
        if let Err(err) = client.logout(token) {
            eprintln!("Warning: failed to log out remotely: {err}");
        }
    }
    state.clear_tokens();
    println!("Logged out.");
    Ok(())
}

fn handle_shell(state: &mut StateStore, verbose: bool) -> Result<()> {
    ensure_logged_in(state)?;
    shell::run_shell(verbose)
}

fn collect_status(workspace: &WorkspaceState) -> Result<StatusReport> {
    let mut actual = Vec::new();
    for entry in WalkDir::new(workspace.root_path())
        .into_iter()
        .filter_entry(|e| !is_cache_entry(e.path()))
    {
        let entry = entry?;
        if entry.file_type().is_file() {
            let path = entry.path();
            let relative = path
                .strip_prefix(workspace.root_path())
                .unwrap()
                .to_string_lossy()
                .to_string();
            let digest = digest_for_file(path)?;
            actual.push((relative, digest));
        }
    }

    let actual_map: std::collections::HashMap<_, _> = actual.into_iter().collect();
    let mut staged = Vec::new();
    let mut modified = Vec::new();
    let mut deleted = Vec::new();
    let mut untracked: Vec<String> = Vec::new();

    for (relative, digest) in actual_map.iter() {
        if let Some(tracked_hash) = workspace.tracked_hash(relative) {
            if tracked_hash != digest {
                if workspace.staged_digest(relative).is_some() {
                    staged.push(relative.clone());
                } else {
                    modified.push(relative.clone());
                }
            } else if workspace.staged_digest(relative).is_some() {
                staged.push(relative.clone());
            }
        } else if workspace.staged_digest(relative).is_some() {
            staged.push(relative.clone());
        } else {
            untracked.push(relative.clone());
        }
    }

    for relative in workspace.tracked().map(|(path, _)| path.clone()) {
        if !actual_map.contains_key(&relative) {
            deleted.push(relative);
        }
    }

    staged.sort();
    staged.dedup();
    modified.sort();
    modified.dedup();
    deleted.sort();
    deleted.dedup();
    untracked.sort();
    untracked.dedup();

    Ok(StatusReport {
        staged,
        modified,
        deleted,
        untracked,
    })
}

fn resolve_workspace<'a>(state: &'a StateStore) -> Result<(&'a str, &'a WorkspaceState)> {
    let cwd = std::env::current_dir()?.canonicalize()?;
    if let Some((name, workspace)) = state
        .workspaces()
        .find(|(_, ws)| cwd.starts_with(ws.root_path()))
    {
        return Ok((name.as_str(), workspace));
    }

    if let Some(default) = state.default_workspace() {
        if let Some(ws) = state.workspace(default) {
            return Ok((default, ws));
        }
    }

    let mut iter = state.workspaces();
    if let Some((name, workspace)) = iter.next() {
        return Ok((name.as_str(), workspace));
    }

    bail!("no workspace has been initialized yet");
}

fn resolve_workspace_name(state: &StateStore) -> Result<String> {
    let (name, _) = resolve_workspace(state)?;
    Ok(name.to_string())
}

fn ensure_logged_in(state: &StateStore) -> Result<()> {
    if state.access_token().is_none() {
        bail!("please log in first");
    }
    Ok(())
}

fn apply_remote_file(
    workspace: &mut WorkspaceState,
    workspace_root: &Path,
    cache_root: &Path,
    download: FileDownload,
) -> Result<bool> {
    apply_remote_file_with_conflict_check(
        workspace,
        workspace_root,
        cache_root,
        download,
        &HashSet::new(),
    )
}

fn apply_remote_file_with_conflict_check(
    workspace: &mut WorkspaceState,
    workspace_root: &Path,
    cache_root: &Path,
    download: FileDownload,
    staged_paths: &HashSet<String>,
) -> Result<bool> {
    let FileDownload { summary, bytes, .. } = download;
    let relative = summary.name.clone();
    let target_path = workspace_root.join(&relative);

    if target_path.exists() {
        let current_digest = digest_for_file(&target_path)?;
        if let Some(tracked) = workspace.tracked_hash(&relative) {
            if tracked != &current_digest {
                if staged_paths.contains(&relative) || workspace.staged_digest(&relative).is_some()
                {
                    println!(
                        "Skipping {} (staged locally; pull will not override)",
                        relative
                    );
                    return Ok(false);
                }
                println!(
                    "Skipping {} (local modifications detected; pull will not override)",
                    relative
                );
                return Ok(false);
            }
        } else if staged_paths.contains(&relative) {
            println!(
                "Skipping {} (staged locally; pull will not override)",
                relative
            );
            return Ok(false);
        }
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory: {}", parent.display()))?;
    }
    fs::write(&target_path, &bytes)
        .with_context(|| format!("failed to write file: {}", target_path.display()))?;

    let digest = digest_bytes(&bytes);
    workspace.update_hash(relative.clone(), digest);
    workspace.unstage(&relative);
    workspace.set_remote(
        relative.clone(),
        RemoteFileState {
            file_id: summary.id.clone(),
            etag: summary.etag.clone(),
            extension: summary.extension.clone(),
            kind: summary.kind.clone(),
        },
    );

    let cache_path = cache_root.join(&relative);
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create cache directory: {}", parent.display()))?;
    }
    fs::write(&cache_path, &bytes)
        .with_context(|| format!("failed to write cache file: {}", cache_path.display()))?;

    Ok(true)
}

fn digest_for_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)
        .with_context(|| format!("failed to open file for hashing: {}", path.display()))?;
    let mut hasher = Sha256::new();
    io::copy(&mut file, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

fn digest_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn prompt(message: &str) -> Result<String> {
    print!("{message}");
    io::stdout().flush()?;
    let mut buf = String::new();
    io::stdin()
        .read_line(&mut buf)
        .context("failed to read from stdin")?;
    Ok(buf.trim().to_owned())
}

fn relative_to_workspace(workspace: &WorkspaceState, path: &Path) -> Result<String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let absolute = absolute.canonicalize()?;
    let root = workspace.root_path().canonicalize()?;
    let relative = absolute
        .strip_prefix(&root)
        .map_err(|_| anyhow!("path is outside the workspace: {}", absolute.display()))?;
    Ok(relative.to_string_lossy().to_string())
}

#[derive(Debug)]
struct StatusReport {
    staged: Vec<String>,
    modified: Vec<String>,
    deleted: Vec<String>,
    untracked: Vec<String>,
}

fn is_cache_entry(path: &Path) -> bool {
    path.components()
        .any(|component| component.as_os_str() == CACHE_DIR_NAME)
}

fn print_diff(baseline: Option<&Path>, current: Option<&Path>) -> Result<()> {
    #[cfg(target_os = "windows")]
    bail!("diff command is not available on Windows yet");

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = std::process::Command::new("diff");
        cmd.arg("-u");
        match baseline {
            Some(path) => cmd.arg(path),
            None => cmd.arg("/dev/null"),
        };
        match current {
            Some(path) => cmd.arg(path),
            None => cmd.arg("/dev/null"),
        };
        let output = cmd.output().with_context(|| "failed to run diff command")?;
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.trim().is_empty() {
                println!("No differences.");
            } else {
                print!("{}", stdout);
            }
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.trim().is_empty() {
                eprintln!("{stderr}");
            }
        }
        Ok(())
    }
}
