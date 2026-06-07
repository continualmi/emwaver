use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs, io,
    path::{Path, PathBuf},
};

use thiserror::Error;

const SCRIPT_EXTENSION: &str = ".emw";
const LEGACY_SCRIPT_EXTENSION: &str = ".js";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptKind {
    Script,
    Library,
    Kernel,
}

impl ScriptKind {
    pub fn is_runnable(self) -> bool {
        matches!(self, Self::Script)
    }

    fn sort_rank(self) -> u8 {
        match self {
            Self::Script => 0,
            Self::Library => 1,
            Self::Kernel => 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptListItem {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub is_bundled: bool,
    pub shadows_bundled: bool,
    pub kind: ScriptKind,
}

impl ScriptListItem {
    pub fn kind_label(&self) -> &'static str {
        if self.is_bundled {
            match self.kind {
                ScriptKind::Script => "Example",
                ScriptKind::Library => "Library",
                ScriptKind::Kernel => "Kernel",
            }
        } else if self.shadows_bundled {
            "Override"
        } else {
            "Custom"
        }
    }

    pub fn section_title(&self) -> &'static str {
        match self.kind_label() {
            "Example" => "Examples",
            "Library" => "Libraries",
            "Kernel" => "Kernel",
            _ => "Custom Scripts",
        }
    }

    pub fn kind_detail(&self) -> &'static str {
        if self.is_bundled {
            "Bundled · read-only"
        } else if self.shadows_bundled {
            "Local editable override"
        } else {
            "Local editable script"
        }
    }

    pub fn is_editable(&self) -> bool {
        !self.is_bundled
    }

    pub fn is_runnable(&self) -> bool {
        self.kind.is_runnable()
    }

    fn sort_rank(&self) -> u8 {
        if self.is_bundled {
            self.kind.sort_rank()
        } else {
            3
        }
    }
}

#[derive(Debug, Error)]
pub enum ScriptLibraryError {
    #[error("script directory unavailable: {0}")]
    DirectoryUnavailable(String),
    #[error("script not found: {0}")]
    NotFound(String),
    #[error("script is read-only: {0}")]
    ReadOnly(String),
    #[error("invalid script name")]
    InvalidName,
    #[error("script I/O failed: {0}")]
    Io(#[from] io::Error),
}

#[derive(Debug, Clone)]
pub struct ScriptRepository {
    bundled_dir: PathBuf,
    local_dir: PathBuf,
}

impl Default for ScriptRepository {
    fn default() -> Self {
        Self {
            bundled_dir: default_bundled_dir(),
            local_dir: default_local_dir(),
        }
    }
}

impl ScriptRepository {
    pub fn new(bundled_dir: impl Into<PathBuf>, local_dir: impl Into<PathBuf>) -> Self {
        Self {
            bundled_dir: bundled_dir.into(),
            local_dir: local_dir.into(),
        }
    }

    pub fn bundled_dir(&self) -> &Path {
        &self.bundled_dir
    }

    pub fn local_dir(&self) -> &Path {
        &self.local_dir
    }

    pub fn list_scripts(&self) -> Result<Vec<ScriptListItem>, ScriptLibraryError> {
        if !self.bundled_dir.is_dir() {
            return Err(ScriptLibraryError::DirectoryUnavailable(
                self.bundled_dir.display().to_string(),
            ));
        }

        let bundled = self.read_script_map(&self.bundled_dir)?;
        let local = if self.local_dir.is_dir() {
            self.read_script_map(&self.local_dir)?
        } else {
            BTreeMap::new()
        };

        let mut items = Vec::new();
        let bundled_names: BTreeSet<String> = bundled.keys().cloned().collect();

        for (name, path) in bundled.iter() {
            items.push(ScriptListItem {
                id: format!("asset:{name}"),
                name: name.clone(),
                path: path.clone(),
                is_bundled: true,
                shadows_bundled: false,
                kind: asset_kind(name),
            });
        }

        for (name, path) in local.iter() {
            let shadows_bundled = bundled_names.contains(name);
            if shadows_bundled
                && files_match(path, bundled.get(name).expect("bundled path exists"))?
            {
                continue;
            }
            items.push(ScriptListItem {
                id: format!("local:{name}"),
                name: name.clone(),
                path: path.clone(),
                is_bundled: false,
                shadows_bundled,
                kind: ScriptKind::Script,
            });
        }

        items.sort_by(|a, b| {
            a.sort_rank()
                .cmp(&b.sort_rank())
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(items)
    }

    pub fn read_script(&self, item: &ScriptListItem) -> Result<String, ScriptLibraryError> {
        fs::read_to_string(&item.path).map_err(ScriptLibraryError::from)
    }

    pub fn module_sources(&self) -> Result<BTreeMap<String, String>, ScriptLibraryError> {
        let mut modules = BTreeMap::new();
        for item in self.list_scripts()? {
            if item.kind == ScriptKind::Script {
                continue;
            }
            modules.insert(item.name.clone(), self.read_script(&item)?);
        }
        Ok(modules)
    }

    pub fn save_script(
        &self,
        item: &ScriptListItem,
        content: &str,
    ) -> Result<(), ScriptLibraryError> {
        if item.is_bundled {
            return Err(ScriptLibraryError::ReadOnly(item.name.clone()));
        }
        fs::create_dir_all(&self.local_dir)?;
        fs::write(&item.path, content)?;
        Ok(())
    }

    pub fn create_script(
        &self,
        requested_name: &str,
        content: &str,
    ) -> Result<ScriptListItem, ScriptLibraryError> {
        let name = self.unique_script_name(&normalize_script_name(requested_name)?);
        fs::create_dir_all(&self.local_dir)?;
        let path = self.local_dir.join(&name);
        fs::write(&path, content)?;
        Ok(ScriptListItem {
            id: format!("local:{name}"),
            name,
            path,
            is_bundled: false,
            shadows_bundled: false,
            kind: ScriptKind::Script,
        })
    }

    pub fn copy_to_local(
        &self,
        item: &ScriptListItem,
    ) -> Result<ScriptListItem, ScriptLibraryError> {
        let source = self.read_script(item)?;
        let requested = copy_name_for(&item.name);
        self.create_script(&requested, &source)
    }

    fn unique_script_name(&self, proposed: &str) -> String {
        let existing = self.existing_names();
        if !existing.contains(&proposed.to_lowercase()) {
            return proposed.to_string();
        }

        let stem = proposed
            .strip_suffix(SCRIPT_EXTENSION)
            .or_else(|| proposed.strip_suffix(LEGACY_SCRIPT_EXTENSION))
            .unwrap_or(proposed);
        let mut counter = 1;
        loop {
            let candidate = format!("{stem}_{counter}{SCRIPT_EXTENSION}");
            if !existing.contains(&candidate.to_lowercase()) {
                return candidate;
            }
            counter += 1;
        }
    }

    fn existing_names(&self) -> BTreeSet<String> {
        let mut names = BTreeSet::new();
        for dir in [&self.bundled_dir, &self.local_dir] {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    if let Some(name) = script_file_name(&entry.path()) {
                        names.insert(name.to_lowercase());
                    }
                }
            }
        }
        names
    }

    fn read_script_map(
        &self,
        directory: &Path,
    ) -> Result<BTreeMap<String, PathBuf>, ScriptLibraryError> {
        let mut scripts = BTreeMap::new();
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            if let Some(name) = script_file_name(&path) {
                scripts.insert(name, path);
            }
        }
        Ok(scripts)
    }
}

pub fn default_script_template() -> &'static str {
    "// EMWaver script\n\
import { JSX, render } from \"emw-jsx\";\n\
import { Column, Text, LogViewer } from \"emw-ui\";\n\n\
let logLines = [];\n\
function log(message) {\n\
    const text = String(message);\n\
    logLines.push(text);\n\
    if (logLines.length > 200) {\n\
        logLines.splice(0, logLines.length - 200);\n\
    }\n\
    draw();\n\
}\n\n\
draw();\n\n\
function draw() {\n\
    render(<App />);\n\
}\n\n\
function App() {\n\
    return (\n\
        <Column padding={16} spacing={12}>\n\
            <Text font=\"title2\" fontWeight=\"semibold\">Script Title</Text>\n\
            <Text>Customize this script to add controls and logic.</Text>\n\
            <LogViewer text={logLines.join('\\n')} minHeight={160} padding={{ top: 12, bottom: 12, leading: 12, trailing: 12 }} cornerRadius={8} />\n\
        </Column>\n\
    );\n\
}\n"
}

fn default_bundled_dir() -> PathBuf {
    if let Ok(path) = env::var("EMWAVER_DEFAULT_SCRIPTS_DIR") {
        return PathBuf::from(path);
    }

    let system_dir = PathBuf::from("/usr/share/emwaver/default-scripts");
    if system_dir.is_dir() {
        return system_dir;
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .ancestors()
        .nth(3)
        .map(|root| root.join("assets/default-scripts"))
        .unwrap_or_else(|| PathBuf::from("assets/default-scripts"))
}

fn default_local_dir() -> PathBuf {
    if let Ok(path) = env::var("EMWAVER_SCRIPTS_DIR") {
        return PathBuf::from(path);
    }
    if let Ok(path) = env::var("XDG_DATA_HOME") {
        return PathBuf::from(path).join("emwaver/scripts");
    }
    if let Ok(path) = env::var("HOME") {
        return PathBuf::from(path).join(".local/share/emwaver/scripts");
    }
    PathBuf::from(".emwaver/scripts")
}

fn asset_kind(name: &str) -> ScriptKind {
    let lowered = name.to_lowercase();
    if lowered == "emw-kernel.emw" || lowered == "emw-protocol.emw" {
        ScriptKind::Kernel
    } else if lowered.starts_with("emw-") {
        ScriptKind::Library
    } else {
        ScriptKind::Script
    }
}

fn script_file_name(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_string_lossy().to_string();
    let lowered = name.to_lowercase();
    if lowered.ends_with(SCRIPT_EXTENSION) || lowered.ends_with(LEGACY_SCRIPT_EXTENSION) {
        Some(name)
    } else {
        None
    }
}

fn normalize_script_name(raw: &str) -> Result<String, ScriptLibraryError> {
    let mut candidate = raw.trim().to_string();
    if candidate.is_empty()
        || candidate.contains('/')
        || candidate.contains('\\')
        || candidate == "."
        || candidate == ".."
    {
        return Err(ScriptLibraryError::InvalidName);
    }
    let lowered = candidate.to_lowercase();
    if !lowered.ends_with(SCRIPT_EXTENSION) && !lowered.ends_with(LEGACY_SCRIPT_EXTENSION) {
        candidate.push_str(SCRIPT_EXTENSION);
    }
    Ok(candidate)
}

fn copy_name_for(name: &str) -> String {
    let stem = name
        .strip_suffix(SCRIPT_EXTENSION)
        .or_else(|| name.strip_suffix(LEGACY_SCRIPT_EXTENSION))
        .unwrap_or(name);
    format!("{stem}_copy{SCRIPT_EXTENSION}")
}

fn files_match(left: &Path, right: &Path) -> Result<bool, ScriptLibraryError> {
    Ok(fs::read(left)? == fs::read(right)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let path = env::temp_dir().join(format!(
            "emwaver-script-library-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn classifies_and_sorts_bundled_scripts_like_reference_apps() {
        let bundled = temp_dir("bundled-sort");
        let local = temp_dir("local-sort");
        fs::write(bundled.join("emw-ui.emw"), "library").unwrap();
        fs::write(bundled.join("emw-kernel.emw"), "kernel").unwrap();
        fs::write(bundled.join("blink.emw"), "example").unwrap();
        fs::write(local.join("custom.emw"), "custom").unwrap();

        let scripts = ScriptRepository::new(&bundled, &local)
            .list_scripts()
            .unwrap();
        let labels: Vec<_> = scripts
            .iter()
            .map(|script| (script.name.as_str(), script.kind_label()))
            .collect();

        assert_eq!(
            labels,
            vec![
                ("blink.emw", "Example"),
                ("emw-ui.emw", "Library"),
                ("emw-kernel.emw", "Kernel"),
                ("custom.emw", "Custom")
            ]
        );
    }

    #[test]
    fn hides_identical_local_copy_but_keeps_override() {
        let bundled = temp_dir("bundled-shadow");
        let local = temp_dir("local-shadow");
        fs::write(bundled.join("blink.emw"), "same").unwrap();
        fs::write(bundled.join("hello.emw"), "bundled").unwrap();
        fs::write(local.join("blink.emw"), "same").unwrap();
        fs::write(local.join("hello.emw"), "local").unwrap();

        let scripts = ScriptRepository::new(&bundled, &local)
            .list_scripts()
            .unwrap();
        let local_scripts: Vec<_> = scripts
            .iter()
            .filter(|script| !script.is_bundled)
            .map(|script| (script.name.as_str(), script.kind_label()))
            .collect();

        assert_eq!(local_scripts, vec![("hello.emw", "Override")]);
    }

    #[test]
    fn copies_bundled_script_to_unique_editable_local_script() {
        let bundled = temp_dir("bundled-copy");
        let local = temp_dir("local-copy");
        fs::write(bundled.join("blink.emw"), "source").unwrap();
        fs::write(local.join("blink_copy.emw"), "existing").unwrap();

        let repository = ScriptRepository::new(&bundled, &local);
        let bundled_item = repository
            .list_scripts()
            .unwrap()
            .into_iter()
            .find(|script| script.name == "blink.emw")
            .unwrap();
        let copy = repository.copy_to_local(&bundled_item).unwrap();

        assert_eq!(copy.name, "blink_copy_1.emw");
        assert!(!copy.is_bundled);
        assert_eq!(fs::read_to_string(copy.path).unwrap(), "source");
    }

    #[test]
    fn returns_library_and_kernel_module_sources() {
        let bundled = temp_dir("module-sources-bundled");
        let local = temp_dir("module-sources-local");
        fs::write(bundled.join("blink.emw"), "script").unwrap();
        fs::write(bundled.join("emw-ui.emw"), "ui").unwrap();
        fs::write(bundled.join("emw-kernel.emw"), "kernel").unwrap();
        fs::write(local.join("custom.emw"), "custom").unwrap();

        let modules = ScriptRepository::new(&bundled, &local)
            .module_sources()
            .unwrap();

        assert_eq!(modules.get("emw-ui.emw").map(String::as_str), Some("ui"));
        assert_eq!(
            modules.get("emw-kernel.emw").map(String::as_str),
            Some("kernel")
        );
        assert!(!modules.contains_key("blink.emw"));
        assert!(!modules.contains_key("custom.emw"));
    }
}
