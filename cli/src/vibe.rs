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

use anyhow::{bail, Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

const AGENTS_FILENAME: &str = "AGENTS.md";
const EMWAVER_DIR: &str = ".emwaver";

const VIBE_SNIPPET_START: &str = "<!-- EMWAVER_VIBE_HACKING_START -->";
const VIBE_SNIPPET_END: &str = "<!-- EMWAVER_VIBE_HACKING_END -->";

const AGENTS_BASE: &str = include_str!("../resources/vibe/AGENTS_BASE.md");
const AGENTS_VIBE_SNIPPET: &str = include_str!("../resources/vibe/AGENTS_VIBE_SNIPPET.md");

const EMWAVER_README: &str = include_str!("../resources/vibe/emwaver_README.md");
const EMWAVER_SPI: &str = include_str!("../resources/vibe/emwaver_SPI.md");
const EMWAVER_WAVELETS: &str = include_str!("../resources/vibe/emwaver_WAVELETS.md");
const SKILL_VIBE_HACKING: &str = include_str!("../resources/vibe/skills/vibe-hacking/SKILL.md");
const SKILL_WAVELET_AUTHORING: &str =
    include_str!("../resources/vibe/skills/wavelet-authoring/SKILL.md");

pub fn init_repo(destination: PathBuf, force: bool, update_agents: bool) -> Result<()> {
    if destination.exists() && !destination.is_dir() {
        bail!("destination exists and is not a directory: {}", destination.display());
    }
    fs::create_dir_all(&destination)
        .with_context(|| format!("failed to create {}", destination.display()))?;

    let emwaver_dir = destination.join(EMWAVER_DIR);
    fs::create_dir_all(&emwaver_dir).with_context(|| format!("failed to create {}", emwaver_dir.display()))?;

    write_md(&emwaver_dir.join("README.md"), EMWAVER_README, force)?;
    write_md(&emwaver_dir.join("SPI.md"), EMWAVER_SPI, force)?;
    write_md(&emwaver_dir.join("WAVELETS.md"), EMWAVER_WAVELETS, force)?;

    let skills_dir = emwaver_dir.join("skills");
    write_md(
        &skills_dir.join("vibe-hacking").join("SKILL.md"),
        SKILL_VIBE_HACKING,
        force,
    )?;
    write_md(
        &skills_dir.join("wavelet-authoring").join("SKILL.md"),
        SKILL_WAVELET_AUTHORING,
        force,
    )?;

    if update_agents {
        upsert_agents_md(&destination.join(AGENTS_FILENAME))?;
    }

    println!("Initialized vibe hacking docs at {}", emwaver_dir.display());
    if update_agents {
        println!("Updated {}", destination.join(AGENTS_FILENAME).display());
    }
    println!("Next: open `{}/SPI.md` and tweak pinmaps for your board.", EMWAVER_DIR);

    Ok(())
}

fn write_md(path: &Path, contents: &str, force: bool) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("failed to create {}", parent.display()))?;
    }

    if path.exists() {
        let existing = fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
        if normalize_newlines(&existing) == normalize_newlines(contents) {
            return Ok(());
        }
        if !force {
            bail!(
                "refusing to overwrite {}; re-run with --force",
                path.display()
            );
        }
    }

    fs::write(path, contents).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn upsert_agents_md(path: &Path) -> Result<()> {
    let updated = if path.exists() {
        let existing =
            fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
        upsert_marked_section(&existing, AGENTS_VIBE_SNIPPET)
    } else {
        let mut base = String::new();
        base.push_str(AGENTS_BASE.trim_end());
        base.push('\n');
        base.push('\n');
        base.push_str(AGENTS_VIBE_SNIPPET.trim_end());
        base.push('\n');
        base
    };

    fs::write(path, updated).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn upsert_marked_section(existing: &str, snippet: &str) -> String {
    let snippet = snippet.trim_end_matches(['\n', '\r']);
    let mut out = String::new();

    let start = existing.find(VIBE_SNIPPET_START);
    let end = existing.find(VIBE_SNIPPET_END);

    if let (Some(start_idx), Some(end_idx)) = (start, end) {
        let end_idx = end_idx + VIBE_SNIPPET_END.len();
        out.push_str(existing[..start_idx].trim_end_matches(['\n', '\r']));
        out.push('\n');
        out.push('\n');
        out.push_str(snippet);
        out.push('\n');
        out.push('\n');
        out.push_str(existing[end_idx..].trim_start_matches(['\n', '\r']));
        if !out.ends_with('\n') {
            out.push('\n');
        }
        return out;
    }

    out.push_str(existing.trim_end_matches(['\n', '\r']));
    out.push('\n');
    out.push('\n');
    out.push_str(snippet);
    out.push('\n');
    out
}

fn normalize_newlines(s: &str) -> String {
    s.replace("\r\n", "\n")
}
