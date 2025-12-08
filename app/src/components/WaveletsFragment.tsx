import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { Editor as MonacoEditor, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Tree, type NodeRendererProps, type TreeApi } from "react-arborist";
import { safeInvoke, safeListen, safeJoin } from "../utils/tauri";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WaveletEngine, type WaveletTree } from "../utils/WaveletEngine";
import { createBLEServiceWrapper } from "../utils/BLEServiceWrapper";

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
const LAST_PROJECT_PATH_STORAGE_KEY = "emwaver.lastProjectPath";

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
  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    readStoredNumber(SIDEBAR_STORAGE_KEY, DEFAULT_SIDEBAR_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH),
  );
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [renderedTree, setRenderedTree] = useState<WaveletTree | null>(null);
  
  // Debug: log when renderedTree changes
  useEffect(() => {
    console.log('[WaveletsFragment] renderedTree changed:', renderedTree);
    console.log('[WaveletsFragment] renderedTree is truthy:', !!renderedTree);
  }, [renderedTree]);
  const sidebarResizeActive = useRef(false);
  const sidebarStartX = useRef(0);
  const sidebarStartWidth = useRef(0);
  const saveTimeoutRef = useRef<number | null>(null);
  const openFileRef = useRef<OpenFile | null>(null);
  const treeOpenStateRef = useRef<Map<string, Record<string, boolean>>>(new Map());
  const waveletEngineRef = useRef<WaveletEngine | null>(null);
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

  // Initialize WaveletEngine
  useEffect(() => {
    const engine = new WaveletEngine();
    
    const printCallback = (message: string) => {
      setConsoleOutput((prev) => [...prev, message]);
    };

    const renderCallback = (tree: WaveletTree) => {
      console.log('[renderCallback] Called with tree:', tree);
      setConsoleOutput((prev) => [...prev, `[Render] Received tree: ${tree.type}`]);
      console.log('[renderCallback] About to call setRenderedTree');
      setRenderedTree(tree);
      console.log('[renderCallback] setRenderedTree called');
      setConsoleOutput((prev) => [...prev, `[Render] State updated`]);
    };

    const dialogCallback = (title: string, message: string) => {
      alert(`${title}\n\n${message}`);
    };

    // Create BLE bindings
    const bleService = createBLEServiceWrapper();

    engine.setup(
      printCallback,
      renderCallback,
      dialogCallback,
      {
        BLEService: bleService,
      }
    );

    waveletEngineRef.current = engine;

    return () => {
      engine.shutdown();
      waveletEngineRef.current = null;
    };
  }, []);

  // Update module sources when project changes
  useEffect(() => {
    if (!project || !waveletEngineRef.current) return;

        const updateModules = async () => {
      try {
        const result = await safeInvoke<DirectoryEntry[]>("read_directory", {
          payload: { path: project.path },
        });
        
        if (result === null) return;
        
        const entries = result;

        const moduleSources: Record<string, string> = {};
        
        const loadModules = async (dirEntries: DirectoryEntry[], basePath: string = "") => {
          for (const entry of dirEntries) {
            if (entry.kind === "file" && entry.name.endsWith(".js")) {
              const filePath = basePath ? `${basePath}/${entry.name}` : entry.name;
              try {
                const fullPath = await safeJoin(project.path, entry.path);
                const content = await safeInvoke<string>("read_file", {
                  payload: { path: fullPath },
                });
                if (content !== null) {
                  moduleSources[entry.name] = content;
                }
              } catch (error) {
                console.error(`Failed to load module ${entry.name}:`, error);
              }
            } else if (entry.kind === "directory" && entry.children) {
              await loadModules(entry.children, entry.name);
            }
          }
        };

        await loadModules(entries);
        waveletEngineRef.current?.updateModuleSources(moduleSources);
      } catch (error) {
        console.error("Failed to update module sources:", error);
      }
    };

    void updateModules();
  }, [project]);

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
      let entries: DirectoryEntry[];
      try {
        const result = await safeInvoke<DirectoryEntry[]>("read_directory", {
          payload: { path: projectPath },
        });
        entries = result || [];
      } catch {
        // Directory doesn't exist, will be created when writing files
        entries = [];
      }

      const jsFiles = entries.filter((e) => e.kind === "file" && e.name.endsWith(".js"));
      
      if (jsFiles.length === 0) {
        // Load default scripts directly into project folder
        for (const scriptName of DEFAULT_SCRIPTS) {
          try {
            const response = await fetch(`/default-scripts/${scriptName}`);
            if (response.ok) {
              const content = await response.text();
              const filePath = await safeJoin(projectPath, scriptName);
              await safeInvoke<void>("write_file", {
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
      // Load default scripts first if it's a new project or if project directory is empty
      if (isNewProject) {
        await ensureDefaultScripts(directory);
      } else {
        // Check if project directory has JS files
        try {
          const result = await safeInvoke<DirectoryEntry[]>("read_directory", {
            payload: { path: directory },
          });
          const jsFiles = (result || []).filter((e) => e.kind === "file" && e.name.endsWith(".js"));
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
      const entries = await safeInvoke<DirectoryEntry[]>("read_directory", {
        payload: { path: directory },
      });
      if (entries === null) {
        throw new Error("Failed to read directory");
      }
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

      // Store the project path for restoration on next app launch
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_PROJECT_PATH_STORAGE_KEY, directory);
      }
    } catch (error) {
      console.error(error);
      alert(String(error));
    }
  }, [ensureDefaultScripts]);

  // Restore last opened project on mount (only once)
  const hasRestoredRef = useRef(false);
  const openProjectAtPathRef = useRef<typeof openProjectAtPath | null>(null);
  
  // Keep ref updated with latest function
  useEffect(() => {
    openProjectAtPathRef.current = openProjectAtPath;
  }, [openProjectAtPath]);

  useEffect(() => {
    if (hasRestoredRef.current) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    // Wait for openProjectAtPath to be available
    if (!openProjectAtPathRef.current) {
      return;
    }

    const restoreLastProject = async () => {
      // Mark as restored before attempting, so we don't try multiple times
      hasRestoredRef.current = true;
      
      try {
        const lastProjectPath = window.localStorage.getItem(LAST_PROJECT_PATH_STORAGE_KEY);
        if (!lastProjectPath) {
          return;
        }

        // Verify the directory still exists before trying to open it
        try {
          const result = await safeInvoke<DirectoryEntry[]>("read_directory", {
            payload: { path: lastProjectPath },
          });
          if (result === null) {
            throw new Error("Directory not found");
          }
          // Directory exists, restore it using the ref to avoid dependency issues
          const openFn = openProjectAtPathRef.current;
          if (openFn) {
            await openFn(lastProjectPath);
          }
        } catch {
          // Directory doesn't exist anymore, clear the stored path
          window.localStorage.removeItem(LAST_PROJECT_PATH_STORAGE_KEY);
        }
      } catch (error) {
        console.error("Failed to restore last project:", error);
        // Clear invalid stored path
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(LAST_PROJECT_PATH_STORAGE_KEY);
        }
      }
    };

    void restoreLastProject();
  }, [openProjectAtPath]); // Re-run when openProjectAtPath is available

  const handleOpenProject = useCallback(async () => {
    try {
      const directory = await openDialog({ directory: true });
      if (typeof directory !== "string") {
        return;
      }
      await openProjectAtPath(directory);
    } catch (error) {
      console.error("Failed to open project:", error);
      // If it's a Tauri API error, show helpful message
      if (error instanceof Error && error.message.includes("Tauri")) {
        alert("Tauri API error. Make sure you're running with: npm run tauri dev");
      } else {
        alert(String(error));
      }
    }
  }, [openProjectAtPath]);

  const handleCreateProjectClick = useCallback(async () => {
    try {
      // Use save dialog (Save As style) to get location and folder name in one dialog
      const selectedPath = await saveDialog({
        title: "Create New Project",
        defaultPath: "My Wavelet Project",
        filters: [],
      });
      
      if (typeof selectedPath !== "string") {
        return;
      }

      setIsCreatingProject(true);
      
      // The selectedPath is the full path to the folder we want to create
      const projectPath = selectedPath;
      const folderName = projectPath.split(/[/\\]/).pop() || "My Wavelet Project";
      
        // Check if directory exists
        try {
          const entries = await safeInvoke<DirectoryEntry[]>("read_directory", {
            payload: { path: projectPath },
          });
          if (entries && entries.length > 0) {
            alert("Project directory already exists and is not empty");
            return;
          }
        } catch {
          // Directory doesn't exist, create it by writing a file
          // write_file creates parent directories automatically
          const initFile = await safeJoin(projectPath, ".gitkeep");
          await safeInvoke<void>("write_file", {
            payload: { path: initFile, content: "" },
          });
        }
      
      await openProjectAtPath(projectPath, { initialName: folderName, isNewProject: true });
    } catch (error) {
      console.error("Failed to create project:", error);
      alert(String(error));
    } finally {
      setIsCreatingProject(false);
    }
  }, [openProjectAtPath]);

  const writeContent = useCallback(
    async (fileId: string, path: string, content: string) => {
      setOpenFiles((prev) =>
        prev.map((file) => (file.id === fileId ? { ...file, isSaving: true } : file)),
      );

      try {
        const result = await safeInvoke<void>("write_file", {
          payload: { path, content },
        });
        if (result === null) {
          throw new Error("Failed to write file");
        }
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

  const handleCloseProject = useCallback(async () => {
    await commitPendingSave();
    if (project) {
      treeOpenStateRef.current.delete(project.id);
    }
    setProject(null);
    setSelectedFileId(null);
    setOpenFiles([]);
    setActiveFileId(null);
  }, [commitPendingSave, project]);

  // Listen for menu-close-folder event
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlisten = await safeListen("menu-close-folder", () => {
          void handleCloseProject();
        });
      } catch (error) {
        console.error("Failed to listen for menu-close-folder event:", error);
      }
    };

    void setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [handleCloseProject]);

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
        const absolutePath = await safeJoin(project.path, node.path);
        const content = await safeInvoke<string>("read_file", {
          payload: { path: absolutePath },
        });
        if (content === null) {
          throw new Error("Failed to read file");
        }
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

  const handleRunWavelet = useCallback(() => {
    console.log('[handleRunWavelet] Button clicked');
    console.log('[handleRunWavelet] activeFile:', activeFile?.name);
    console.log('[handleRunWavelet] waveletEngineRef.current:', waveletEngineRef.current);
    
    if (!activeFile || !waveletEngineRef.current) {
      console.log('[handleRunWavelet] Early return - missing activeFile or engine');
      return;
    }

    // Clear previous output
    setConsoleOutput([]);
    setRenderedTree(null);
    
    console.log('[handleRunWavelet] About to execute script');
    console.log('[handleRunWavelet] Script content:', activeFile.content.substring(0, 100));

    // Execute the wavelet
    try {
      waveletEngineRef.current.execute(activeFile.content, () => {
        console.log('[handleRunWavelet] Execution completion callback called');
        setConsoleOutput((prev) => [...prev, "Wavelet execution completed."]);
      });
    } catch (error) {
      console.error('[handleRunWavelet] Error:', error);
    }
  }, [activeFile]);

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
                disabled={isCreatingProject}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreatingProject ? "Creating..." : "Create New Project"}
              </button>
            </div>
          </div>
        </div>
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
        <button
          onClick={() => {
            // Placeholder for Git connection
            alert("Git connection coming soon");
          }}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:border-indigo-500/60 hover:bg-slate-800 hover:text-indigo-300"
        >
          Connect to Git
        </button>
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
            <div className="flex items-center gap-2">
              <button
                onClick={handleRunWavelet}
                disabled={!activeFile || !waveletEngineRef.current}
                className="px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded transition-colors"
                title="Run wavelet"
              >
                ▶ Run
              </button>
              <button
                onClick={() => {
                  setConsoleOutput([]);
                  setRenderedTree(null);
                }}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 rounded hover:border-slate-700 transition-colors"
                title="Clear output and return to editor"
              >
                Clear
              </button>
              {renderedTree && (
                <button
                  onClick={() => {
                    setRenderedTree(null);
                  }}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 rounded hover:border-slate-700 transition-colors"
                  title="Return to editor"
                >
                  ← Editor
                </button>
              )}
            </div>
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
          <div className="flex-1 min-h-0 bg-slate-950 flex flex-col">
            {(() => {
              console.log('[Render] activeFile:', !!activeFile, 'renderedTree:', !!renderedTree);
              return null;
            })()}
            {activeFile ? (
              renderedTree ? (
                // Show preview when wavelet has rendered UI
                <div className="flex h-full w-full min-h-0 flex-col">
                  <div className="flex-1 min-h-0 overflow-y-auto p-6">
                    <WaveletUIRenderer 
                      tree={renderedTree} 
                      consoleOutput={consoleOutput}
                      onInvokeCallback={(token, args) => {
                        waveletEngineRef.current?.invoke(token, args);
                      }}
                    />
                  </div>
                  {consoleOutput.length > 0 && (
                    <div className="h-48 border-t border-slate-800 overflow-y-auto p-4 bg-slate-900">
                      <div className="text-xs font-semibold text-slate-400 mb-2">Console</div>
                      <div className="font-mono text-xs text-slate-300 space-y-1">
                        {consoleOutput.map((line, index) => (
                          <div key={index}>{line}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                // Show editor when no preview is rendered
                <div className="flex h-full w-full min-h-0">
                  <div className="flex-1 min-h-0">
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
                  {consoleOutput.length > 0 && (
                    <div className="w-96 border-l border-slate-800 overflow-y-auto p-4 bg-slate-900">
                      <div className="text-xs font-semibold text-slate-400 mb-2">Console</div>
                      <div className="font-mono text-xs text-slate-300 space-y-1">
                        {consoleOutput.map((line, index) => (
                          <div key={index}>{line}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
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
    </section>
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleProjectContextMenu = async (event: ReactMouseEvent<HTMLHeadingElement>) => {
    if (!project) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

  const handleShowProjectInFinder = async () => {
    if (!project) {
      return;
    }
    setContextMenu(null);
    try {
      await safeInvoke<void>("reveal_in_finder", {
        payload: { path: project.path },
      });
    } catch (error) {
      console.error("Failed to reveal in Finder:", error);
      alert(String(error));
    }
  };

  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu(null);
    };
    if (contextMenu) {
      document.addEventListener("click", handleClickOutside);
      return () => {
        document.removeEventListener("click", handleClickOutside);
      };
    }
  }, [contextMenu]);
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
          className="truncate text-sm font-semibold text-slate-200 cursor-pointer"
          title={project ? project.name : "Explorer"}
          onContextMenu={handleProjectContextMenu}
        >
          {project ? project.name : "Explorer"}
        </h2>
      </div>
      {contextMenu && project && (
        <div
          className="fixed z-50 rounded-md border border-slate-700 bg-slate-900 py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleShowProjectInFinder}
            className="w-full px-4 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-slate-800 hover:text-sky-200"
          >
            Show in Finder
          </button>
        </div>
      )}
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
                {(props) => <FileTreeNode {...props} projectPath={project.path} />}
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

function FileTreeNode({ node, style, projectPath }: NodeRendererProps<TreeNode> & { projectPath: string }) {
  const isSelected = node.isSelected;
  const isFolder = node.data.kind === "directory";
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

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

  const handleContextMenu = async (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!isFolder) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

  const handleShowInFinder = async () => {
    if (!isFolder) {
      return;
    }
    setContextMenu(null);
    try {
        // If path is empty or just the folder name, it's the root project folder
        const absolutePath = node.data.path === "" || node.data.path === node.data.name
          ? projectPath
          : await safeJoin(projectPath, node.data.path);
      await safeInvoke<void>("reveal_in_finder", {
        payload: { path: absolutePath },
      });
    } catch (error) {
      console.error("Failed to reveal in Finder:", error);
      alert(String(error));
    }
  };

  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu(null);
    };
    if (contextMenu) {
      document.addEventListener("click", handleClickOutside);
      return () => {
        document.removeEventListener("click", handleClickOutside);
      };
    }
  }, [contextMenu]);

  return (
    <>
      <div
        style={style}
        className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] leading-tight transition-colors ${
          isSelected ? "bg-slate-800 text-sky-100" : "text-slate-300 hover:bg-slate-800/60"
        }`}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
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
      {contextMenu && isFolder && (
        <div
          className="fixed z-50 rounded-md border border-slate-700 bg-slate-900 py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleShowInFinder}
            className="w-full px-4 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-slate-800 hover:text-sky-200"
          >
            Show in Finder
          </button>
        </div>
      )}
    </>
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

function WaveletUIRenderer({ 
  tree, 
  consoleOutput = [], 
  onInvokeCallback 
}: { 
  tree: WaveletTree; 
  consoleOutput?: string[]; 
  onInvokeCallback?: (token: string, args: unknown[]) => void;
}) {

  const [inputValues, setInputValues] = useState<Record<string, any>>({});

  const handleEvent = (nodeId: string, eventType: string, value?: any) => {
    const handlers = (tree as any).handlers || {};
    const token = handlers[eventType];
    if (token && onInvokeCallback) {
      onInvokeCallback(token, value !== undefined ? [value] : []);
    }
  };

  const renderNode = (node: WaveletTree): ReactNode => {
    const props = node.props || {};
    const children = node.children || [];
    const handlers = (node as any).handlers || {};
    const nodeId = (props.id as string) || 'node';

    switch (node.type) {
      case 'column': {
        const spacing = (props.spacing as number) || 12;
        const padding = (props.padding as number) || 0;
        return (
          <div 
            className="flex flex-col" 
            style={{ 
              gap: `${spacing}px`,
              padding: `${padding}px`
            }}
          >
            {children.map((child, index) => (
              <div key={index}>{renderNode(child)}</div>
            ))}
          </div>
        );
      }

      case 'row': {
        const spacing = (props.spacing as number) || 8;
        return (
          <div 
            className="flex"
            style={{ gap: `${spacing}px` }}
          >
            {children.map((child, index) => (
              <div key={index}>{renderNode(child)}</div>
            ))}
          </div>
        );
      }

      case 'button': {
        const handleClick = () => {
          if (handlers.tap && onInvokeCallback) {
            onInvokeCallback(handlers.tap, []);
          }
        };
        return (
          <button
            onClick={handleClick}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
          >
            {(props.label as string) || 'Button'}
          </button>
        );
      }

      case 'text':
        return (
          <div className="text-slate-200 text-sm">
            {(props.text as string) || ''}
          </div>
        );

      case 'slider': {
        const min = (props.min as number) || 0;
        const max = (props.max as number) || 100;
        const value = inputValues[nodeId] !== undefined ? inputValues[nodeId] : ((props.value as number) || 0);
        const step = (props.step as number) || 1;
        
        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
          const newValue = parseFloat(e.target.value);
          setInputValues(prev => ({ ...prev, [nodeId]: newValue }));
          if (handlers.change && onInvokeCallback) {
            onInvokeCallback(handlers.change, [newValue]);
          }
        };

        return (
          <div className="flex flex-col gap-2">
            {props.label && <label className="text-slate-300 text-sm">{props.label as string}</label>}
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={handleChange}
              className="w-full accent-blue-600"
            />
            <div className="text-slate-400 text-xs">{value}</div>
          </div>
        );
      }

      case 'textField': {
        const value = inputValues[nodeId] !== undefined ? inputValues[nodeId] : ((props.value as string) || '');
        const placeholder = (props.placeholder as string) || '';
        
        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
          const newValue = e.target.value;
          setInputValues(prev => ({ ...prev, [nodeId]: newValue }));
          if (handlers.change && onInvokeCallback) {
            onInvokeCallback(handlers.change, [newValue]);
          }
        };

        const handleSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && handlers.submit && onInvokeCallback) {
            onInvokeCallback(handlers.submit, [value]);
          }
        };

        return (
          <div className="flex flex-col gap-2">
            {props.label && <label className="text-slate-300 text-sm">{props.label as string}</label>}
            <input
              type="text"
              value={value}
              placeholder={placeholder}
              onChange={handleChange}
              onKeyDown={handleSubmit}
              className="px-3 py-2 bg-slate-800 text-slate-200 border border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
        );
      }

      case 'textEditor': {
        const value = inputValues[nodeId] !== undefined ? inputValues[nodeId] : ((props.value as string) || '');
        const placeholder = (props.placeholder as string) || '';
        const rows = (props.rows as number) || 4;
        
        const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
          const newValue = e.target.value;
          setInputValues(prev => ({ ...prev, [nodeId]: newValue }));
          if (handlers.change && onInvokeCallback) {
            onInvokeCallback(handlers.change, [newValue]);
          }
        };

        return (
          <div className="flex flex-col gap-2">
            {props.label && <label className="text-slate-300 text-sm">{props.label as string}</label>}
            <textarea
              value={value}
              placeholder={placeholder}
              onChange={handleChange}
              rows={rows}
              className="px-3 py-2 bg-slate-800 text-slate-200 border border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
            />
          </div>
        );
      }

      case 'picker': {
        const options = (props.options as string[]) || [];
        const value = inputValues[nodeId] !== undefined ? inputValues[nodeId] : ((props.value as string) || options[0] || '');
        
        const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
          const newValue = e.target.value;
          setInputValues(prev => ({ ...prev, [nodeId]: newValue }));
          if (handlers.change && onInvokeCallback) {
            onInvokeCallback(handlers.change, [newValue]);
          }
        };

        return (
          <div className="flex flex-col gap-2">
            {props.label && <label className="text-slate-300 text-sm">{props.label as string}</label>}
            <select
              value={value}
              onChange={handleChange}
              className="px-3 py-2 bg-slate-800 text-slate-200 border border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              {options.map((option, index) => (
                <option key={index} value={option}>{option}</option>
              ))}
            </select>
          </div>
        );
      }

      case 'scroll': {
        const maxHeight = (props.maxHeight as number) || 400;
        return (
          <div 
            className="overflow-y-auto"
            style={{ maxHeight: `${maxHeight}px` }}
          >
            {children.map((child, index) => (
              <div key={index}>{renderNode(child)}</div>
            ))}
          </div>
        );
      }

      case 'grid': {
        const columns = (props.columns as number) || 2;
        const spacing = (props.spacing as number) || 8;
        return (
          <div 
            className="grid"
            style={{ 
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gap: `${spacing}px`
            }}
          >
            {children.map((child, index) => (
              <div key={index}>{renderNode(child)}</div>
            ))}
          </div>
        );
      }

      case 'spacer': {
        const height = (props.height as number) || 16;
        return <div style={{ height: `${height}px` }} />;
      }

      case 'divider': {
        return <hr className="border-slate-700 my-2" />;
      }

      case 'progress': {
        const value = (props.value as number) || 0;
        const max = (props.max as number) || 100;
        const percentage = (value / max) * 100;
        
        return (
          <div className="flex flex-col gap-2">
            {props.label && <label className="text-slate-300 text-sm">{props.label as string}</label>}
            <div className="w-full bg-slate-800 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        );
      }

      case 'logViewer': {
        // Show console output if available, otherwise show placeholder text
        const hasOutput = consoleOutput.length > 0;
        return (
          <div className="bg-slate-900 rounded p-3 font-mono text-xs text-slate-300 min-h-[100px] max-h-[300px] overflow-y-auto">
            {hasOutput ? (
              <div className="space-y-1">
                {consoleOutput.map((line, index) => (
                  <div key={index}>{line}</div>
                ))}
              </div>
            ) : (
              <div className="text-slate-500">
                {(props.text as string) || 'Console messages will appear here...'}
              </div>
            )}
          </div>
        );
      }

      default:
        return <div className="text-slate-500 text-xs">Unknown UI type: {node.type}</div>;
    }
  };

  return <div>{renderNode(tree)}</div>;
}
