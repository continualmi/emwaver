import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { Editor as MonacoEditor, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Tree, type NodeRendererProps, type TreeApi } from "react-arborist";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";

type DirectoryEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: DirectoryEntry[];
};

type TreeNode = {
  id: string;
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: TreeNode[];
};

type Project = {
  id: string;
  name: string;
  path: string;
  tree: TreeNode[];
};

type OpenFile = {
  id: string;
  name: string;
  relativePath: string;
  absolutePath: string;
  language: string;
  content: string;
  isDirty: boolean;
  isSaving: boolean;
};

const DEFAULT_SIDEBAR_WIDTH = 288;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 520;
const SIDEBAR_STORAGE_KEY = "emwaver.sidebarWidth";

const MONACO_EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  fontFamily: '"Fira Code", "Courier New", monospace',
  fontSize: 14,
  minimap: { enabled: false },
  automaticLayout: true,
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  wordWrap: "on",
  padding: { top: 16, bottom: 16 },
  renderWhitespace: "selection",
  scrollbar: {
    vertical: "auto",
    horizontal: "auto",
  },
};

const DEFAULT_SCRIPTS = [
  "cc1101.js",
  "cc1101_radio_console.js",
  "cc1101_radio_module.js",
  "hello_world_usb.js",
  "wavelet_console_demo.js",
  "wavelet_demo.js",
  "wavelet_gpio.js",
  "wavelet_rfid.js",
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readStoredNumber(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") {
    return fallback;
  }
  const stored = window.localStorage.getItem(key);
  if (!stored) {
    return fallback;
  }
  const parsed = Number.parseFloat(stored);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(parsed, min, max);
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normaliseTree(entries: DirectoryEntry[]): TreeNode[] {
  return entries.map((entry) => ({
    id: entry.path.length > 0 ? entry.path : entry.name,
    name: entry.name,
    path: entry.path,
    kind: entry.kind,
    children: entry.children ? normaliseTree(entry.children) : undefined,
  }));
}

function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
    case "tsx":
      return "typescript";
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "less":
      return "less";
    case "md":
    case "markdown":
      return "markdown";
    case "yaml":
    case "yml":
      return "yaml";
    case "xml":
    case "svg":
      return "xml";
    case "py":
      return "python";
    case "c":
    case "h":
      return "c";
    case "cpp":
    case "cc":
    case "hpp":
    case "hh":
    case "hxx":
      return "cpp";
    case "java":
      return "java";
    case "cs":
      return "csharp";
    case "sql":
      return "sql";
    case "ini":
      return "ini";
    case "sh":
    case "bash":
      return "shell";
    case "rs":
    case "toml":
    case "txt":
      return "plaintext";
    default:
      return "plaintext";
  }
}

function deriveProjectName(path: string): string {
  const segments = path
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

export default function WaveletsFragment() {
  const [project, setProject] = useState<Project | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    readStoredNumber(SIDEBAR_STORAGE_KEY, DEFAULT_SIDEBAR_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH),
  );
  const sidebarResizeActive = useRef(false);
  const sidebarStartX = useRef(0);
  const sidebarStartWidth = useRef(0);
  const saveTimeoutRef = useRef<number | null>(null);
  const openFileRef = useRef<OpenFile | null>(null);
  const treeOpenStateRef = useRef<Map<string, Record<string, boolean>>>(new Map());
  const monaco = useMonaco();

  const activeFile = useMemo(
    () => (activeFileId ? openFiles.find((file) => file.id === activeFileId) ?? null : null),
    [openFiles, activeFileId],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

  useEffect(() => {
    if (!monaco) {
      return;
    }

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      jsx: monaco.languages.typescript.JsxEmit.Preserve,
      allowNonTsExtensions: true,
      allowJs: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
    });
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });
    monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
  }, [monaco]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (sidebarResizeActive.current) {
        const delta = event.clientX - sidebarStartX.current;
        const max = Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth * 0.6);
        const width = clamp(sidebarStartWidth.current + delta, SIDEBAR_MIN_WIDTH, max);
        setSidebarWidth(width);
      }
    };

    const handleMouseUp = () => {
      if (sidebarResizeActive.current) {
        sidebarResizeActive.current = false;
      }
      document.body.style.removeProperty("cursor");
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  useEffect(() => {
    openFileRef.current = activeFile;
  }, [activeFile]);

  useEffect(
    () => () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    },
    [],
  );

  const getTreeOpenState = useCallback((projectId: string) => {
    let state = treeOpenStateRef.current.get(projectId);
    if (!state) {
      state = {};
      treeOpenStateRef.current.set(projectId, state);
    }
    return state;
  }, []);

  const updateTreeOpenState = useCallback(
    (projectId: string, nodeId: string, isOpen: boolean) => {
      const state = treeOpenStateRef.current.get(projectId);
      if (state) {
        if (state[nodeId] !== isOpen) {
          state[nodeId] = isOpen;
        }
      } else {
        treeOpenStateRef.current.set(projectId, { [nodeId]: isOpen });
      }
    },
    [],
  );

  const ensureDefaultScripts = useCallback(async (projectPath: string) => {
    try {
      const waveletsDir = await join(projectPath, "wavelets");
      let entries: DirectoryEntry[];
      try {
        entries = await invoke<DirectoryEntry[]>("read_directory", {
          payload: { path: waveletsDir },
        });
      } catch {
        // Directory doesn't exist, will be created when writing files
        entries = [];
      }

      const jsFiles = entries.filter((e) => e.kind === "file" && e.name.endsWith(".js"));
      
      if (jsFiles.length === 0) {
        // Load default scripts
        for (const scriptName of DEFAULT_SCRIPTS) {
          try {
            const response = await fetch(`/default-scripts/${scriptName}`);
            if (response.ok) {
              const content = await response.text();
              const filePath = await join(waveletsDir, scriptName);
              await invoke<void>("write_file", {
                payload: { path: filePath, content },
              });
            }
          } catch (error) {
            console.warn(`Failed to load default script ${scriptName}:`, error);
          }
        }
      }
    } catch (error) {
      console.error("Failed to ensure default scripts:", error);
    }
  }, []);

  const openProjectAtPath = useCallback(async (directory: string, options: { initialName?: string; isNewProject?: boolean } = {}) => {
    const { initialName, isNewProject = false } = options;

    try {
      // Load default scripts first if it's a new project or if wavelets directory is empty
      if (isNewProject) {
        await ensureDefaultScripts(directory);
      } else {
        // Check if wavelets directory exists and has files
        const waveletsDir = await join(directory, "wavelets");
        try {
          const entries = await invoke<DirectoryEntry[]>("read_directory", {
            payload: { path: waveletsDir },
          });
          const jsFiles = entries.filter((e) => e.kind === "file" && e.name.endsWith(".js"));
          if (jsFiles.length === 0) {
            // Empty, load defaults
            await ensureDefaultScripts(directory);
          }
        } catch {
          // Directory doesn't exist, load defaults
          await ensureDefaultScripts(directory);
        }
      }

      // Now read the directory structure
      const entries = await invoke<DirectoryEntry[]>("read_directory", {
        payload: { path: directory },
      });
      const tree = normaliseTree(entries);
      const projectName = initialName ?? deriveProjectName(directory);

      const project: Project = {
        id: createId(),
        name: projectName,
        path: directory,
        tree,
      };

      setProject(project);
      setSelectedFileId(null);
      setOpenFiles([]);
      setActiveFileId(null);

      if (!treeOpenStateRef.current.has(project.id)) {
        treeOpenStateRef.current.set(project.id, {});
      }
    } catch (error) {
      console.error(error);
      alert(String(error));
    }
  }, [ensureDefaultScripts]);

  const handleOpenProject = useCallback(async () => {
    try {
      const directory = await openDialog({ directory: true });
      if (typeof directory !== "string") {
        return;
      }
      await openProjectAtPath(directory);
    } catch (error) {
      console.error("Failed to open project:", error);
      alert(String(error));
    }
  }, [openProjectAtPath]);

  const handleCreateProjectClick = useCallback(() => {
    setIsCreateProjectModalOpen(true);
  }, []);

  const handleCreateProject = useCallback(
    async ({ name, location }: { name: string; location: string }) => {
      if (!name.trim() || !location.trim()) {
        return;
      }
      setIsCreatingProject(true);
      try {
        const projectPath = await join(location.trim(), name.trim());
        
        // Check if directory exists
        try {
          const entries = await invoke<DirectoryEntry[]>("read_directory", {
            payload: { path: projectPath },
          });
          if (entries.length > 0) {
            alert("Project directory already exists and is not empty");
            return;
          }
        } catch {
          // Directory doesn't exist, create it by writing a file
          // write_file creates parent directories automatically
          const waveletsDir = await join(projectPath, "wavelets");
          const initFile = await join(waveletsDir, ".gitkeep");
          await invoke<void>("write_file", {
            payload: { path: initFile, content: "" },
          });
        }
        
        setIsCreateProjectModalOpen(false);
        await openProjectAtPath(projectPath, { initialName: name.trim(), isNewProject: true });
      } catch (error) {
        console.error("Failed to create project:", error);
        alert(String(error));
      } finally {
        setIsCreatingProject(false);
      }
    },
    [openProjectAtPath],
  );

  const writeContent = useCallback(
    async (fileId: string, path: string, content: string) => {
      setOpenFiles((prev) =>
        prev.map((file) => (file.id === fileId ? { ...file, isSaving: true } : file)),
      );

      try {
        await invoke<void>("write_file", {
          payload: { path, content },
        });
        setOpenFiles((prev) =>
          prev.map((file) =>
            file.id === fileId ? { ...file, content, isDirty: false, isSaving: false } : file,
          ),
        );
      } catch (error) {
        console.error(error);
        alert(String(error));
        setOpenFiles((prev) =>
          prev.map((file) => (file.id === fileId ? { ...file, isSaving: false } : file)),
        );
        throw error;
      }
    },
    [],
  );

  const commitPendingSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const file = openFileRef.current;
    if (file && file.isDirty) {
      try {
        await writeContent(file.id, file.absolutePath, file.content);
      } catch {
        // error already surfaced in writeContent
      }
    }
  }, [writeContent]);

  const handleSelectFile = useCallback(
    async (node: TreeNode) => {
      if (!project || node.kind !== "file") {
        return;
      }
      if (activeFileId === node.id) {
        return;
      }
      await commitPendingSave();
      const existing = openFiles.find((file) => file.id === node.id);
      if (existing) {
        setSelectedFileId(node.id);
        setActiveFileId(existing.id);
        return;
      }
      setIsLoadingFile(true);
      try {
        const absolutePath = await join(project.path, node.path);
        const content = await invoke<string>("read_file", {
          payload: { path: absolutePath },
        });
        const language = detectLanguage(node.name);
        setSelectedFileId(node.id);
        const file: OpenFile = {
          id: node.id,
          name: node.name,
          relativePath: node.path,
          absolutePath,
          language,
          content,
          isDirty: false,
          isSaving: false,
        };
        setOpenFiles((prev) => {
          if (prev.some((entry) => entry.id === file.id)) {
            return prev;
          }
          return [...prev, file];
        });
        setActiveFileId(file.id);
      } catch (error) {
        console.error(error);
        alert(String(error));
      } finally {
        setIsLoadingFile(false);
      }
    },
    [activeFileId, commitPendingSave, openFiles, project],
  );

  const handleTreeSelection = useCallback(
    (node: TreeNode) => {
      if (node.kind === "file") {
        void handleSelectFile(node);
      } else {
        void commitPendingSave().finally(() => {
          setSelectedFileId(null);
          setActiveFileId(null);
        });
      }
    },
    [commitPendingSave, handleSelectFile],
  );

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      const file = openFileRef.current;
      if (!file) {
        return;
      }

      const nextContent = value ?? "";

      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      setOpenFiles((prev) =>
        prev.map((entry) =>
          entry.id === file.id ? { ...entry, content: nextContent, isDirty: true } : entry,
        ),
      );

      saveTimeoutRef.current = window.setTimeout(() => {
        saveTimeoutRef.current = null;
        void writeContent(file.id, file.absolutePath, nextContent);
      }, 600);
    },
    [writeContent],
  );

  const handleSelectTab = useCallback((fileId: string) => {
    setActiveFileId(fileId);
    setSelectedFileId(fileId);
  }, []);

  const handleCloseTab = useCallback(
    (fileId: string) => {
      setOpenFiles((prev) => {
        const index = prev.findIndex((file) => file.id === fileId);
        if (index === -1) {
          return prev;
        }
        const next = [...prev];
        next.splice(index, 1);
        const fallback = next[index - 1] ?? next[index] ?? null;
        if (activeFileId === fileId) {
          setActiveFileId(fallback ? fallback.id : null);
          setSelectedFileId(fallback ? fallback.id : null);
        } else if (selectedFileId === fileId) {
          setSelectedFileId(fallback ? fallback.id : null);
        }
        return next;
      });
    },
    [activeFileId, selectedFileId],
  );

  const handleSidebarMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      sidebarResizeActive.current = true;
      sidebarStartX.current = event.clientX;
      sidebarStartWidth.current = sidebarWidth;
      document.body.style.cursor = "col-resize";
    },
    [sidebarWidth],
  );

  if (!project) {
    return (
      <section className="flex flex-1 flex-col bg-slate-950">
        <header className="flex items-center justify-between border-b border-slate-900 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Wavelets</h2>
            <p className="text-sm text-slate-400">Manage and run wavelet scripts</p>
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-slate-400">No project folder selected</p>
            <div className="flex gap-3">
              <button
                onClick={handleOpenProject}
                className="rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-400"
              >
                Open Project Folder
              </button>
              <button
                onClick={handleCreateProjectClick}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-200"
              >
                Create New Project
              </button>
            </div>
          </div>
        </div>
        {isCreateProjectModalOpen && (
          <NewProjectModal
            onClose={() => setIsCreateProjectModalOpen(false)}
            onCreate={handleCreateProject}
            isSubmitting={isCreatingProject}
          />
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-1 flex-col bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-900 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Wavelets</h2>
          <p className="text-sm text-slate-400">{project.name}</p>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <Sidebar
          width={sidebarWidth}
          project={project}
          selectedFileId={selectedFileId}
          onSelectNode={handleTreeSelection}
          getInitialOpenState={getTreeOpenState}
          onToggleNode={updateTreeOpenState}
        />
        <div
          onMouseDown={handleSidebarMouseDown}
          className="flex w-1 cursor-col-resize items-stretch bg-slate-900"
        >
          <span className="mx-auto h-full w-px bg-slate-800" />
        </div>
        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex items-center justify-between border-b border-slate-900 bg-slate-950 px-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
              {openFiles.map((file) => {
                const isActive = file.id === activeFileId;
                const isSaving = file.isSaving;
                const isDirty = !file.isSaving && file.isDirty;
                return (
                  <div
                    key={file.id}
                    className={`group flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors ${
                      isActive
                        ? "bg-slate-800 text-slate-100"
                        : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectTab(file.id)}
                      className="flex max-w-[200px] items-center gap-2 truncate text-left"
                    >
                      {(isSaving || isDirty) && (
                        <span
                          className={
                            isSaving
                              ? "inline-flex h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-sky-400 border-t-transparent"
                              : "inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400"
                          }
                          aria-label={isSaving ? "Saving" : "Unsaved changes"}
                        />
                      )}
                      <span className="truncate">{file.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCloseTab(file.id)}
                      className="rounded px-1 text-slate-500 transition-colors hover:text-rose-400"
                      aria-label={`Close ${file.name}`}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {openFiles.length === 0 && (
                <span className="shrink-0 px-3 py-2 text-xs text-slate-500">No files open</span>
              )}
            </div>
          </div>
          <div className="flex-1 min-h-0 bg-slate-950">
            {activeFile ? (
              <div className="flex h-full w-full min-h-0">
                <MonacoEditor
                  key={activeFile.id}
                  path={activeFile.relativePath}
                  value={activeFile.content}
                  language={activeFile.language}
                  onChange={handleEditorChange}
                  options={MONACO_EDITOR_OPTIONS}
                  theme="vs-dark"
                  height="100%"
                  loading={
                    <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
                      Loading editor...
                    </div>
                  }
                />
              </div>
            ) : isLoadingFile ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
                Loading file...
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
                Choose a file from the explorer to open it.
              </div>
            )}
          </div>
        </div>
      </div>
      {isCreateProjectModalOpen && (
        <NewProjectModal
          onClose={() => setIsCreateProjectModalOpen(false)}
          onCreate={handleCreateProject}
          isSubmitting={isCreatingProject}
        />
      )}
    </section>
  );
}

type NewProjectPayload = {
  name: string;
  location: string;
};

function NewProjectModal({
  onClose,
  onCreate,
  isSubmitting,
}: {
  onClose: () => void;
  onCreate: (payload: NewProjectPayload) => Promise<void> | void;
  isSubmitting: boolean;
}) {
  const [name, setName] = useState("My Wavelet Project");
  const [location, setLocation] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !location.trim()) {
      return;
    }
    await onCreate({
      name: name.trim(),
      location: location.trim(),
    });
  };

  const handleBrowse = async () => {
    try {
      const directory = await openDialog({ directory: true });
      if (typeof directory === "string") {
        setLocation(directory);
      }
    } catch (error) {
      console.error(error);
      alert(String(error));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-100">Create New Project</h2>
          <p className="text-sm text-slate-400">
            Choose a location and name for your new wavelet project.
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Project name
            </label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              placeholder="My Wavelet Project"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Location
            </label>
            <div className="flex gap-2">
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                placeholder="/Users/me/Projects"
              />
              <button
                type="button"
                onClick={handleBrowse}
                className="rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-200"
              >
                Browse
              </button>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-colors hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim() || !location.trim()}
              className="rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Sidebar({
  width,
  project,
  selectedFileId,
  onSelectNode,
  getInitialOpenState,
  onToggleNode,
}: {
  width: number;
  project: Project | null;
  selectedFileId: string | null;
  onSelectNode: (node: TreeNode) => void;
  getInitialOpenState: (projectId: string) => Record<string, boolean>;
  onToggleNode: (projectId: string, nodeId: string, isOpen: boolean) => void;
}) {
  const treeRef = useRef<TreeApi<TreeNode> | null>(null);
  const treeContainerRef = useRef<HTMLDivElement | null>(null);
  const [treeSize, setTreeSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    if (!project) {
      setTreeSize({ width: 0, height: 0 });
      treeRef.current = null;
    }
  }, [project]);

  useEffect(() => {
    const container = treeContainerRef.current;
    if (!project || !container || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width: observedWidth, height: observedHeight } = entry.contentRect;
      setTreeSize((prev) => {
        const width = Math.floor(observedWidth);
        const height = Math.floor(observedHeight);
        if (prev.width === width && prev.height === height) {
          return prev;
        }
        return { width, height };
      });
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [project]);

  const handleToggle = useCallback(
    (projectId: string, nodeId: string) => {
      const api = treeRef.current;
      const node = api?.get(nodeId);
      if (!node) {
        return;
      }
      onToggleNode(projectId, nodeId, node.isOpen);
    },
    [onToggleNode],
  );

  return (
    <aside
      style={{ width }}
      className="flex h-full shrink-0 flex-col border-r border-slate-900 bg-slate-950"
    >
      <div className="border-b border-slate-900 px-4 py-3">
        <h2
          className="truncate text-sm font-semibold text-slate-200"
          title={project ? project.name : "Explorer"}
        >
          {project ? project.name : "Explorer"}
        </h2>
      </div>
      <nav className="flex-1 min-h-0 p-3 text-[13px]">
        {project ? (
          <div ref={treeContainerRef} className="flex h-full min-h-0">
            {treeSize.height > 0 && treeSize.width > 0 ? (
              <Tree
                ref={(api) => {
                  treeRef.current = api ?? null;
                }}
                data={project.tree}
                selection={selectedFileId ?? undefined}
                onSelect={(nodes) => {
                  const [node] = nodes;
                  if (node) {
                    onSelectNode(node.data);
                  }
                }}
                onToggle={(id) => handleToggle(project.id, id)}
                disableDrag
                paddingTop={2}
                paddingBottom={2}
                rowHeight={24}
                indent={18}
                overscanCount={5}
                initialOpenState={getInitialOpenState(project.id)}
                openByDefault={false}
                height={treeSize.height}
                width={treeSize.width}
                className="w-full"
              >
                {(props) => <FileTreeNode {...props} />}
              </Tree>
            ) : null}
          </div>
        ) : (
          <p className="px-2 text-xs text-slate-500">
            Use the Projects menu to open or create a project.
          </p>
        )}
      </nav>
    </aside>
  );
}

function FileTreeNode({ node, style }: NodeRendererProps<TreeNode>) {
  const isSelected = node.isSelected;
  const isFolder = node.data.kind === "directory";

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    node.handleClick(event);
    if (isFolder && event.button === 0 && event.detail === 1) {
      node.toggle();
    }
  };

  const handleToggle = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    node.toggle();
  };

  return (
    <div
      style={style}
      className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] leading-tight transition-colors ${
        isSelected ? "bg-slate-800 text-sky-100" : "text-slate-300 hover:bg-slate-800/60"
      }`}
      onClick={handleClick}
    >
      {isFolder ? (
        <button
          type="button"
          onClick={handleToggle}
          className="flex h-5 w-5 items-center justify-center rounded text-slate-400 transition-colors hover:text-sky-300"
          aria-label={node.isOpen ? "Collapse folder" : "Expand folder"}
        >
          {node.isOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </button>
      ) : (
        <span className="h-5 w-5" aria-hidden="true">
          <FileIcon />
        </span>
      )}
      <span className={`truncate text-left ${isSelected ? "text-slate-100" : "text-slate-200"}`}>
        {node.data.name}
      </span>
    </div>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <polyline points="5 8 10 13 15 8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <polyline points="8 5 13 10 8 15" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <path d="M6 3h5l4 4v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 3v4h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
