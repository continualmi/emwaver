use anyhow::{anyhow, bail, Context, Result};
use std::{
    path::{Path, PathBuf},
    process::{Command, Output},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffView {
    Staged,
    Unstaged,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitStatusEntry {
    pub path: String,
    pub orig_path: Option<String>,
    pub index_status: char,
    pub worktree_status: char,
    pub is_untracked: bool,
    pub is_ignored: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitRepoStatus {
    pub repo_root: PathBuf,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub entries: Vec<GitStatusEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitDiffContents {
    pub original: String,
    pub modified: String,
    pub is_binary: bool,
}

fn run_git(repo_root: &Path, args: &[&str]) -> Result<Output> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output()
        .with_context(|| format!("failed to run git {}", args.join(" ")))?;
    Ok(output)
}

fn git_stdout_utf8(output: Output) -> Result<String> {
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("git failed: {stderr}");
    }
    Ok(String::from_utf8(output.stdout).context("git output was not valid utf-8")?)
}

fn git_stdout_bytes(output: Output) -> Result<Vec<u8>> {
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("git failed: {stderr}");
    }
    Ok(output.stdout)
}

pub fn is_git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub fn resolve_repo_root(path: impl AsRef<Path>) -> Result<PathBuf> {
    let path = path.as_ref();
    let candidate = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent().unwrap_or(path).to_path_buf()
    };

    let output = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(&candidate)
        .output()
        .context("failed to run git rev-parse --show-toplevel")?;

    let stdout = git_stdout_utf8(output)?;
    let root = stdout.trim();
    if root.is_empty() {
        bail!("git rev-parse returned empty repo root");
    }
    Ok(PathBuf::from(root))
}

fn current_branch(repo_root: &Path) -> Result<Option<String>> {
    let output = run_git(repo_root, &["branch", "--show-current"])?;
    if !output.status.success() {
        return Ok(None);
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        Ok(None)
    } else {
        Ok(Some(stdout))
    }
}

fn upstream_ref(repo_root: &Path) -> Result<Option<String>> {
    let output = run_git(
        repo_root,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    )?;
    if !output.status.success() {
        return Ok(None);
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        Ok(None)
    } else {
        Ok(Some(stdout))
    }
}

fn ahead_behind(repo_root: &Path) -> Result<(u32, u32)> {
    let upstream = match upstream_ref(repo_root)? {
        Some(value) => value,
        None => return Ok((0, 0)),
    };

    let output = run_git(
        repo_root,
        &["rev-list", "--left-right", "--count", &format!("{upstream}...HEAD")],
    )?;
    let stdout = git_stdout_utf8(output)?;
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok((0, 0));
    }

    let mut parts = trimmed.split_whitespace();
    let behind: u32 = parts
        .next()
        .ok_or_else(|| anyhow!("unexpected rev-list output"))?
        .parse()
        .context("failed to parse behind count")?;
    let ahead: u32 = parts
        .next()
        .ok_or_else(|| anyhow!("unexpected rev-list output"))?
        .parse()
        .context("failed to parse ahead count")?;
    Ok((ahead, behind))
}

fn parse_porcelain_status_z(bytes: &[u8]) -> Result<Vec<GitStatusEntry>> {
    let mut entries = Vec::new();
    let mut idx = 0;

    while idx < bytes.len() {
        if idx + 3 > bytes.len() {
            break;
        }

        let x = bytes[idx] as char;
        let y = bytes[idx + 1] as char;
        idx += 2;

        let has_space = bytes.get(idx).copied() == Some(b' ');
        if !has_space {
            break;
        }
        idx += 1;

        let start = idx;
        while idx < bytes.len() && bytes[idx] != 0 {
            idx += 1;
        }
        if idx >= bytes.len() {
            break;
        }
        let first_path = std::str::from_utf8(&bytes[start..idx])
            .context("status path was not valid utf-8")?
            .to_string();
        idx += 1;

        let is_untracked = x == '?' && y == '?';
        let is_ignored = x == '!' && y == '!';

        if x == 'R' || x == 'C' {
            let start2 = idx;
            while idx < bytes.len() && bytes[idx] != 0 {
                idx += 1;
            }
            if idx >= bytes.len() {
                break;
            }
            let second_path = std::str::from_utf8(&bytes[start2..idx])
                .context("status rename path was not valid utf-8")?
                .to_string();
            idx += 1;

            entries.push(GitStatusEntry {
                path: second_path,
                orig_path: Some(first_path),
                index_status: x,
                worktree_status: y,
                is_untracked,
                is_ignored,
            });
        } else {
            entries.push(GitStatusEntry {
                path: first_path,
                orig_path: None,
                index_status: x,
                worktree_status: y,
                is_untracked,
                is_ignored,
            });
        }
    }

    Ok(entries)
}

pub fn repo_status(path: impl AsRef<Path>) -> Result<GitRepoStatus> {
    if !is_git_available() {
        bail!("git is not installed (install Git and retry)");
    }

    let repo_root = resolve_repo_root(path)?;
    let branch = current_branch(&repo_root)?;
    let upstream = upstream_ref(&repo_root)?;
    let (ahead, behind) = ahead_behind(&repo_root)?;

    let output = run_git(
        &repo_root,
        &["status", "--porcelain", "-z", "--untracked-files=all"],
    )?;
    let stdout = git_stdout_bytes(output)?;
    let entries = parse_porcelain_status_z(&stdout)?;

    Ok(GitRepoStatus {
        repo_root,
        branch,
        upstream,
        ahead,
        behind,
        entries,
    })
}

pub fn stage_paths(repo_root: impl AsRef<Path>, paths: &[String]) -> Result<()> {
    let repo_root = repo_root.as_ref();
    if paths.is_empty() {
        return Ok(());
    }
    let mut cmd = Command::new("git");
    cmd.current_dir(repo_root).arg("add").arg("--");
    for path in paths {
        cmd.arg(path);
    }
    let output = cmd.output().context("failed to run git add")?;
    git_stdout_utf8(output)?;
    Ok(())
}

pub fn unstage_paths(repo_root: impl AsRef<Path>, paths: &[String]) -> Result<()> {
    let repo_root = repo_root.as_ref();
    if paths.is_empty() {
        return Ok(());
    }

    let mut restore = Command::new("git");
    restore.current_dir(repo_root).arg("restore").arg("--staged").arg("--");
    for path in paths {
        restore.arg(path);
    }

    let output = restore.output().context("failed to run git restore --staged")?;
    if output.status.success() {
        return Ok(());
    }

    let mut reset = Command::new("git");
    reset.current_dir(repo_root).arg("reset").arg("-q").arg("HEAD").arg("--");
    for path in paths {
        reset.arg(path);
    }
    let output = reset.output().context("failed to run git reset")?;
    git_stdout_utf8(output)?;
    Ok(())
}

pub fn discard_worktree_changes(repo_root: impl AsRef<Path>, paths: &[String]) -> Result<()> {
    let repo_root = repo_root.as_ref();
    if paths.is_empty() {
        return Ok(());
    }
    let mut cmd = Command::new("git");
    cmd.current_dir(repo_root).arg("restore").arg("--worktree").arg("--");
    for path in paths {
        cmd.arg(path);
    }
    let output = cmd.output().context("failed to run git restore --worktree")?;
    git_stdout_utf8(output)?;
    Ok(())
}

pub fn commit(repo_root: impl AsRef<Path>, message: &str) -> Result<()> {
    let repo_root = repo_root.as_ref();
    let message = message.trim();
    if message.is_empty() {
        bail!("commit message is empty");
    }
    let output = Command::new("git")
        .current_dir(repo_root)
        .args(["commit", "-m", message])
        .output()
        .context("failed to run git commit")?;
    git_stdout_utf8(output)?;
    Ok(())
}

pub fn push(repo_root: impl AsRef<Path>) -> Result<()> {
    let repo_root = repo_root.as_ref();
    let output = Command::new("git")
        .current_dir(repo_root)
        .args(["push"])
        .output()
        .context("failed to run git push")?;
    git_stdout_utf8(output)?;
    Ok(())
}

fn read_file_utf8(path: &Path) -> Result<String> {
    const MAX_BYTES: usize = 2 * 1024 * 1024;
    let data = std::fs::read(path).with_context(|| format!("failed to read {}", path.display()))?;
    if data.len() > MAX_BYTES {
        bail!("file too large to diff");
    }
    Ok(String::from_utf8(data).context("file is not valid utf-8")?)
}

fn git_show(repo_root: &Path, spec: &str) -> Result<Vec<u8>> {
    let output = run_git(repo_root, &["show", "--no-color", spec])?;
    git_stdout_bytes(output)
}

fn is_binary_diff(repo_root: &Path, view: DiffView, path: &str) -> bool {
    let mut cmd = Command::new("git");
    cmd.current_dir(repo_root).arg("diff");
    if view == DiffView::Staged {
        cmd.arg("--cached");
    }
    cmd.args(["--numstat", "--", path]);

    let output = cmd.output();

    let Ok(output) = output else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().next().unwrap_or("");
    line.starts_with("-\t-") || line.starts_with("- -")
}

pub fn diff_contents(
    repo_root: impl AsRef<Path>,
    view: DiffView,
    path: &str,
    orig_path: Option<&str>,
) -> Result<GitDiffContents> {
    let repo_root = repo_root.as_ref();
    let is_binary = is_binary_diff(repo_root, view, path);
    if is_binary {
        return Ok(GitDiffContents {
            original: String::new(),
            modified: String::new(),
            is_binary: true,
        });
    }

    let status_bytes = git_stdout_bytes(run_git(
        repo_root,
        &["status", "--porcelain", "-z", "--", path],
    )?)?;
    let status_entries = parse_porcelain_status_z(&status_bytes)?;
    let entry = status_entries.first();

    let mut original = String::new();
    let mut modified = String::new();

    let is_untracked = entry.map(|e| e.is_untracked).unwrap_or(false);
    let index_status = entry.map(|e| e.index_status).unwrap_or(' ');
    let worktree_status = entry.map(|e| e.worktree_status).unwrap_or(' ');

    match view {
        DiffView::Unstaged => {
            if is_untracked {
                modified = read_file_utf8(&repo_root.join(path))?;
            } else {
                if worktree_status != 'D' {
                    modified = read_file_utf8(&repo_root.join(path))?;
                }
                let spec = format!(":{path}");
                let data = git_show(repo_root, &spec).unwrap_or_default();
                original = String::from_utf8(data).unwrap_or_default();
            }
        }
        DiffView::Staged => {
            let head_path = orig_path.unwrap_or(path);
            if index_status != 'A' {
                let spec = format!("HEAD:{head_path}");
                let data = git_show(repo_root, &spec).unwrap_or_default();
                original = String::from_utf8(data).unwrap_or_default();
            }
            if index_status != 'D' {
                let spec = format!(":{path}");
                let data = git_show(repo_root, &spec).unwrap_or_default();
                modified = String::from_utf8(data).unwrap_or_default();
            }
        }
    }

    Ok(GitDiffContents {
        original,
        modified,
        is_binary: false,
    })
}

pub fn stage_all(repo_root: impl AsRef<Path>) -> Result<()> {
    let repo_root = repo_root.as_ref();
    let output = run_git(repo_root, &["add", "-A"])?;
    git_stdout_utf8(output)?;
    Ok(())
}

pub fn unstage_all(repo_root: impl AsRef<Path>) -> Result<()> {
    let repo_root = repo_root.as_ref();
    let output = run_git(repo_root, &["reset"])?;
    git_stdout_utf8(output)?;
    Ok(())
}

pub fn discard_all(repo_root: impl AsRef<Path>) -> Result<()> {
    let repo_root = repo_root.as_ref();
    let output = run_git(repo_root, &["restore", "--worktree", "."])?;
    git_stdout_utf8(output)?;
    Ok(())
}

pub fn has_staged_changes(repo_root: impl AsRef<Path>) -> Result<bool> {
    let repo_root = repo_root.as_ref();
    let output = run_git(repo_root, &["diff", "--cached", "--name-only"])?;
    let stdout = git_stdout_utf8(output)?;
    Ok(!stdout.trim().is_empty())
}
