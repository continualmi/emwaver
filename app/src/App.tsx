import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { Editor as MonacoEditor, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Tree, type NodeRendererProps, type TreeApi } from "react-arborist";
import { safeInvoke, safeListen, safeJoin, isTauriAvailable } from "./utils/tauri";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import WaveletsFragment from "./components/WaveletsFragment";
import ISMFragment from "./components/ISMFragment";
import SamplerFragment from "./components/SamplerFragment";
import EMWaverFragment from "./components/EMWaverFragment";
import HomePage from "./components/HomePage";

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

type NewProjectPayload = {
  name: string;
  location: string;
};

type CreateProjectResponse = {
  path: string;
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
export type FragmentType = "wavelets" | "ism" | "sampler" | "emwaver";

type RecentProject = {
  path: string;
  name: string;
  lastOpenedAt: number;
};

const RECENT_PROJECTS_STORAGE_KEY = "emwaver.recentProjects";
const RECENT_PROJECTS_LIMIT = 10;

const DEFAULT_SIDEBAR_WIDTH = 288;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 520;
const SIDEBAR_STORAGE_KEY = "emwaver.sidebarWidth";
const ZOOM_STORAGE_KEY = "emwaver.zoom";
const DEFAULT_ZOOM_LEVEL = 1;
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 1.4;
const ZOOM_STEP = 0.1;

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

// ESP-IDF functionality removed

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Shell escape removed - no ESP-IDF commands

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

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [activePane, setActivePane] = useState<FragmentType>("emwaver");
  const sidebarResizeActive = useRef(false);
  const sidebarStartX = useRef(0);
  const sidebarStartWidth = useRef(0);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    readStoredNumber(SIDEBAR_STORAGE_KEY, DEFAULT_SIDEBAR_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH),
  );
  const [zoomLevel, setZoomLevel] = useState<number>(() =>
    readStoredNumber(ZOOM_STORAGE_KEY, DEFAULT_ZOOM_LEVEL, ZOOM_MIN, ZOOM_MAX),
  );
  const saveTimeoutRef = useRef<number | null>(null);
  const openFileRef = useRef<OpenFile | null>(null);
  const treeOpenStateRef = useRef<Map<string, Record<string, boolean>>>(new Map());
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [shouldRestoreProject, setShouldRestoreProject] = useState(false);
  const monaco = useMonaco();

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
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ZOOM_STORAGE_KEY, zoomLevel.toFixed(2));
  }, [zoomLevel]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    const body = document.body;
    const fontSize = `${16 * zoomLevel}px`;
    root.style.fontSize = fontSize;
    body.style.fontSize = fontSize;
    return () => {
      root.style.fontSize = "";
      body.style.fontSize = "";
    };
  }, [zoomLevel]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleResize = () => {
      const sidebarMax = Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth * 0.6);
      setSidebarWidth((prev) => clamp(prev, SIDEBAR_MIN_WIDTH, sidebarMax));
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const activeFile = useMemo(
    () => (activeFileId ? openFiles.find((file) => file.id === activeFileId) ?? null : null),
    [openFiles, activeFileId],
  );

  const windowTitle = useMemo(
    () => (selectedProject ? `EMWaver - ${selectedProject.name}` : "EMWaver"),
    [selectedProject],
  );

  const updateRecentProjects = useCallback((updater: (prev: RecentProject[]) => RecentProject[]) => {
    setRecentProjects((prev) => {
      const next = updater(prev);
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(next));
        }
      } catch (error) {
        console.error(error);
      }
      return next;
    });
  }, []);

  // ESP-IDF toolchain status removed

  useEffect(() => {
    if (typeof window === "undefined") {
      setShouldRestoreProject(false);
      return;
    }

    try {
      const stored = window.localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY);
      if (!stored) {
        setShouldRestoreProject(false);
        return;
      }

      const parsed = JSON.parse(stored) as unknown;
      if (!Array.isArray(parsed)) {
        setShouldRestoreProject(false);
        return;
      }

      const sanitised = parsed
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const record = entry as Partial<RecentProject> & { path?: unknown; name?: unknown; lastOpenedAt?: unknown };
          if (typeof record.path !== "string" || record.path.length === 0) {
            return null;
          }
          const name = typeof record.name === "string" && record.name.length > 0
            ? record.name
            : deriveProjectName(record.path);
          const timestamp = typeof record.lastOpenedAt === "number" && Number.isFinite(record.lastOpenedAt)
            ? record.lastOpenedAt
            : 0;
          return {
            path: record.path,
            name,
            lastOpenedAt: timestamp,
          } satisfies RecentProject;
        })
        .filter((entry): entry is RecentProject => Boolean(entry));

      sanitised.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
      const limited = sanitised.slice(0, RECENT_PROJECTS_LIMIT);
      setRecentProjects(limited);
      window.localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(limited));
      setShouldRestoreProject(limited.length > 0);
    } catch (error) {
      console.error(error);
      setRecentProjects([]);
      setShouldRestoreProject(false);
    }
  }, []);

  // Serial port refresh removed

  // Shell session management removed - no ESP-IDF terminal needed

  const openProjectAtPath = useCallback(
    async (
      directory: string,
      options: { silent?: boolean; initialName?: string; removeOnFailure?: boolean } = {},
    ) => {
      const { silent = false, initialName, removeOnFailure = true } = options;

      try {
        const entries = await safeInvoke<DirectoryEntry[]>("read_directory", {
          payload: { path: directory },
        });
        if (entries === null) {
          throw new Error("Tauri not available - cannot read directory");
        }
        const tree = normaliseTree(entries);
        const projectName = initialName ?? deriveProjectName(directory);

        let resolvedProjectId = "";
        setProjects((prev) => {
          const existing = prev.find((project) => project.path === directory);
          if (existing) {
            resolvedProjectId = existing.id;
            return prev.map((project) =>
              project.id === existing.id
                ? { ...project, name: projectName, tree }
                : project,
            );
          }
          const project: Project = {
            id: createId(),
            name: projectName,
            path: directory,
            tree,
          };
          resolvedProjectId = project.id;
          return [...prev, project];
        });

        if (resolvedProjectId && !treeOpenStateRef.current.has(resolvedProjectId)) {
          treeOpenStateRef.current.set(resolvedProjectId, {});
        }

        setSelectedProjectId((prev) => (prev === resolvedProjectId ? prev : resolvedProjectId));
        setSelectedFileId(null);
        setOpenFiles([]);
        setActiveFileId(null);
        setShouldRestoreProject(false);
        setActivePane("explorer");
        updateRecentProjects((prev) => {
          const filtered = prev.filter((entry) => entry.path !== directory);
          return [
            { path: directory, name: projectName, lastOpenedAt: Date.now() },
            ...filtered,
          ].slice(0, RECENT_PROJECTS_LIMIT);
        });
        return true;
      } catch (error) {
        console.error(error);
        if (!silent && typeof window !== "undefined") {
          window.alert(String(error));
        }
        if (removeOnFailure) {
          updateRecentProjects((prev) => prev.filter((entry) => entry.path !== directory));
        }
        return false;
      } finally {
      }
    },
    [updateRecentProjects],
  );

  useEffect(() => {
    if (!shouldRestoreProject) {
      return;
    }
    if (recentProjects.length === 0) {
      setShouldRestoreProject(false);
      return;
    }

    const [latest] = recentProjects;
    void (async () => {
      const opened = await openProjectAtPath(latest.path, {
        silent: true,
        initialName: latest.name,
      });
      if (!opened) {
        if (recentProjects.length <= 1) {
          setShouldRestoreProject(false);
        }
        return;
      }
      setShouldRestoreProject(false);
    })();
  }, [shouldRestoreProject, recentProjects, openProjectAtPath]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = windowTitle;
    }

    if (typeof window === "undefined") {
      return;
    }

    try {
      const tauriWindow = getCurrentWindow();
      void tauriWindow.setTitle(windowTitle).catch((error: unknown) => {
        console.error(error);
      });
    } catch (error) {
      // getCurrentWindow throws outside Tauri; ignore in web preview.
    }
  }, [windowTitle]);

  // ESP-IDF and serial port refresh removed

  // ESP-IDF event listeners removed

  useEffect(() => {
    setOpenFiles([]);
    setActiveFileId(null);
    setSelectedFileId(null);
  }, [selectedProjectId]);

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
          throw new Error("Tauri not available - cannot write file");
        }
        setOpenFiles((prev) =>
          prev.map((file) =>
            file.id === fileId ? { ...file, content, isDirty: false, isSaving: false } : file,
          ),
        );
      } catch (error) {
        console.error(error);
        window.alert(String(error));
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

  useEffect(
    () => () => {
      void commitPendingSave();
    },
    [commitPendingSave],
  );

  const handleSelectFile = useCallback(
    async (node: TreeNode) => {
      if (!selectedProject || node.kind !== "file") {
        return;
      }
      if (activeFileId === node.id) {
        setActivePane("explorer");
        return;
      }
      await commitPendingSave();
      const existing = openFiles.find((file) => file.id === node.id);
      if (existing) {
        setSelectedFileId(node.id);
        setActiveFileId(existing.id);
        setActivePane("explorer");
        return;
      }
      setIsLoadingFile(true);
      try {
        const absolutePath = await safeJoin(selectedProject.path, node.path);
        const content = await safeInvoke<string>("read_file", {
          payload: { path: absolutePath },
        });
        if (content === null) {
          throw new Error("Tauri not available - cannot read file");
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
        setActivePane("explorer");
      } catch (error) {
        console.error(error);
        window.alert(String(error));
      } finally {
        setIsLoadingFile(false);
      }
    },
    [activeFileId, commitPendingSave, openFiles, selectedProject],
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

  const handleCreateProject = useCallback(
    async ({ name, location }: NewProjectPayload) => {
      if (!name.trim()) {
        return;
      }
      setIsCreatingProject(true);
      try {
        await commitPendingSave();
        const response = await safeInvoke<CreateProjectResponse>("create_project", {
          payload: {
            name: name.trim(),
            location: location.trim(),
          },
        });
        if (response === null) {
          throw new Error("Tauri not available - cannot create project");
        }

        const projectPath = response.path;
        setIsModalOpen(false);
        await openProjectAtPath(projectPath, { initialName: name.trim() });
      } catch (error) {
        console.error(error);
        window.alert(String(error));
      } finally {
        setIsCreatingProject(false);
      }
    },
    [commitPendingSave, openProjectAtPath],
  );

  const handleOpenProject = useCallback(async () => {
    if (!isTauriAvailable()) {
      alert("Tauri not available - file dialogs require Tauri environment");
      return;
    }
    try {
      const directory = await openDialog({ directory: true });
      if (typeof directory !== "string") {
        return;
      }

      await commitPendingSave();
      await openProjectAtPath(directory);
    } catch (error) {
      console.error(error);
      if (typeof window !== "undefined") {
        window.alert(String(error));
      }
    }
  }, [commitPendingSave, openProjectAtPath]);

  const handleOpenRecentProject = useCallback(
    async (project: RecentProject) => {
      try {
        await commitPendingSave();
        await openProjectAtPath(project.path, { initialName: project.name });
      } catch (error) {
        console.error(error);
        if (typeof window !== "undefined") {
          window.alert(String(error));
        }
      }
    },
    [commitPendingSave, openProjectAtPath],
  );

  // ESP-IDF task handlers removed

  const handleCloseProject = useCallback(async () => {
    await commitPendingSave();
    const closingProjectId = selectedProjectId;
    if (closingProjectId) {
      treeOpenStateRef.current.delete(closingProjectId);
    }
    setSelectedProjectId(null);
    setSelectedFileId(null);
    setOpenFiles([]);
    setActiveFileId(null);
    // Don't switch panes - stay on current fragment
    // setActivePane("emwaver");
  }, [commitPendingSave, selectedProjectId]);

  const handleFragmentClick = useCallback((fragment: FragmentType) => {
    setActivePane(fragment);
  }, []);


  const adjustZoomLevel = useCallback((delta: number) => {
    setZoomLevel((prev) => {
      const next = clamp(Number((prev + delta).toFixed(2)), ZOOM_MIN, ZOOM_MAX);
      return next;
    });
  }, []);

  const increaseLayoutSize = useCallback(() => {
    adjustZoomLevel(ZOOM_STEP);
  }, [adjustZoomLevel]);

  const decreaseLayoutSize = useCallback(() => {
    adjustZoomLevel(-ZOOM_STEP);
  }, [adjustZoomLevel]);

  const resetLayoutSizes = useCallback(() => {
    setZoomLevel(DEFAULT_ZOOM_LEVEL);
    setSidebarWidth(() => {
      const max = typeof window !== "undefined" ? Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth * 0.6) : SIDEBAR_MAX_WIDTH;
      return clamp(DEFAULT_SIDEBAR_WIDTH, SIDEBAR_MIN_WIDTH, max);
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      const key = event.key;
      if (key === "=" || key === "+") {
        event.preventDefault();
        increaseLayoutSize();
      } else if (key === "-" || key === "_") {
        event.preventDefault();
        decreaseLayoutSize();
      } else if (key === "0") {
        event.preventDefault();
        resetLayoutSizes();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [decreaseLayoutSize, increaseLayoutSize, resetLayoutSizes]);

  const handleSelectTab = useCallback((fileId: string) => {
    setActiveFileId(fileId);
    setSelectedFileId(fileId);
    setActivePane("explorer");
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

  useEffect(() => {
    if (!isTauriAvailable()) {
      // Skip event listener registration if Tauri is not available
      return;
    }

    const disposers: (() => void)[] = [];

    const register = async () => {
      try {
        // menu-close-folder is handled by WaveletsFragment now

        disposers.push(
          await safeListen("menu-new-project", () => {
            setIsModalOpen(true);
          }),
        );

        disposers.push(
          await safeListen("menu-open-project", () => {
            void handleOpenProject();
          }),
        );

        disposers.push(
          await safeListen("menu-show-wavelets", () => {
            handleFragmentClick("wavelets");
          }),
        );

        disposers.push(
          await safeListen("menu-show-ism", () => {
            handleFragmentClick("ism");
          }),
        );

        disposers.push(
          await safeListen("menu-show-sampler", () => {
            handleFragmentClick("sampler");
          }),
        );

        disposers.push(
          await safeListen("menu-show-emwaver", () => {
            handleFragmentClick("emwaver");
          }),
        );

        disposers.push(
          await safeListen("menu-increase-layout", () => {
            increaseLayoutSize();
          }),
        );

        disposers.push(
          await safeListen("menu-decrease-layout", () => {
            decreaseLayoutSize();
          }),
        );

        disposers.push(
          await safeListen("menu-reset-layout", () => {
            resetLayoutSizes();
          }),
        );
      } catch (error) {
        console.error(error);
      }
    };

    void register();

    return () => {
      disposers.forEach((dispose) => {
        try {
          dispose();
        } catch (error) {
          console.error(error);
        }
      });
    };
  }, [decreaseLayoutSize, handleOpenProject, handleFragmentClick, increaseLayoutSize, resetLayoutSizes]);

  const isWaveletsActive = activePane === "wavelets";
  const isISMActive = activePane === "ism";
  const isSamplerActive = activePane === "sampler";
  const isEMWaverActive = activePane === "emwaver";

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      <ActivityBar
        activePane={activePane}
        onFragmentClick={handleFragmentClick}
      />
      <div className="relative flex flex-1 min-h-0">
        <Pane active={isEMWaverActive}>
          <HomePage onNavigateToFragment={handleFragmentClick} />
        </Pane>
        <Pane active={isWaveletsActive}><WaveletsFragment /></Pane>
        <Pane active={isISMActive}><ISMFragment /></Pane>
        <Pane active={isSamplerActive}><SamplerFragment /></Pane>
      </div>
      {isModalOpen && (
        <NewProjectModal
          onClose={() => setIsModalOpen(false)}
          onCreate={handleCreateProject}
          isSubmitting={isCreatingProject}
        />
      )}
    </div>
  );
}

type PaneProps = {
  active: boolean;
  children: ReactNode;
};

function Pane({ active, children }: PaneProps) {
  return (
    <div
      className="absolute inset-0 flex min-h-0 flex-1 flex-col"
      style={{
        visibility: active ? "visible" : "hidden",
        pointerEvents: active ? "auto" : "none",
        zIndex: active ? 2 : 1,
      }}
      aria-hidden={active ? undefined : true}
    >
      {children}
    </div>
  );
}

function Sidebar({
  width,
  project,
  selectedFileId,
  onSelectNode,
  isVisible,
  getInitialOpenState,
  onToggleNode,
}: {
  width: number;
  project: Project | null;
  selectedFileId: string | null;
  onSelectNode: (node: TreeNode) => void;
  isVisible: boolean;
  getInitialOpenState: (projectId: string) => Record<string, boolean>;
  onToggleNode: (projectId: string, nodeId: string, isOpen: boolean) => void;
}) {
  const treeRef = useRef<TreeApi<TreeNode> | null>(null);
  const treeContainerRef = useRef<HTMLDivElement | null>(null);
  const [treeSize, setTreeSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    if (!project || !isVisible) {
      setTreeSize({ width: 0, height: 0 });
      treeRef.current = null;
    }
  }, [project, isVisible]);

  useEffect(() => {
    const container = treeContainerRef.current;
    if (!project || !isVisible || !container || typeof ResizeObserver === "undefined") {
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
  }, [project, isVisible]);

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
      style={{ width: isVisible ? width : 0 }}
      className={`flex h-full shrink-0 flex-col border-r border-slate-900 bg-slate-950 transition-[width] duration-150 ${
        isVisible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-hidden={isVisible ? undefined : true}
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

type ActivityBarProps = {
  activePane: FragmentType;
  onFragmentClick: (fragment: FragmentType) => void;
};

function ActivityBar({ activePane, onFragmentClick }: ActivityBarProps) {
  return (
    <aside className="flex w-14 shrink-0 flex-col items-center gap-3 border-r border-slate-900 bg-slate-950 py-4 overflow-y-auto">
      <ActivityButton
        label="EMWaver"
        isActive={activePane === "emwaver"}
        onClick={() => onFragmentClick("emwaver")}
        icon={<EMWaverIcon />}
      />
      <ActivityButton
        label="Wavelets"
        isActive={activePane === "wavelets"}
        onClick={() => onFragmentClick("wavelets")}
        icon={<WaveletIcon />}
      />
      <ActivityButton
        label="ISM"
        isActive={activePane === "ism"}
        onClick={() => onFragmentClick("ism")}
        icon={<ISMIcon />}
      />
      <ActivityButton
        label="Sampler"
        isActive={activePane === "sampler"}
        onClick={() => onFragmentClick("sampler")}
        icon={<SamplerIcon />}
      />
    </aside>
  );
}

type ActivityButtonProps = {
  label: string;
  isActive: boolean;
  onClick: () => void;
  icon: ReactNode;
};

function ActivityButton({ label, isActive, onClick, icon }: ActivityButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg transition-transform transition-colors duration-150 hover:-translate-y-0.5 ${
        isActive
          ? "bg-slate-900 text-sky-200 shadow-lg shadow-sky-500/10"
          : "text-slate-400 hover:bg-slate-900 hover:text-sky-200"
      }`}
    >
      <span className="h-5 w-5" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}

// WaveletsPanel removed - using WaveletsFragment component instead

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

// TerminalPanel removed - ESP-IDF functionality removed

function ISMIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <circle cx="7" cy="10" r="1.5" />
      <circle cx="13" cy="10" r="1.5" />
      <line x1="10" y1="4" x2="10" y2="16" />
    </svg>
  );
}

function SamplerIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <path d="M3 10h14M5 6l2 4-2 4M15 6l-2 4 2 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EMWaverIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <circle cx="10" cy="10" r="3" />
    </svg>
  );
}



// TerminalPanel component removed - ESP-IDF functionality removed

type IconButtonProps = {
  onClick: () => void;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  isActive?: boolean;
};

function IconButton({ onClick, label, icon, disabled = false, isActive = false }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:shadow-lg ${
        isActive
          ? "border-sky-500 bg-slate-800 text-sky-300 shadow-sky-500/20"
          : "border-slate-700 bg-slate-900 text-slate-300 hover:border-sky-500/70 hover:bg-slate-800 hover:text-sky-200"
      } disabled:translate-y-0 disabled:shadow-none disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span className="h-4 w-4" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}


function WaveletIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <path
        d="M3 12c1.5-3 3.5-3 5 0s3.5 3 5 0 3.5-3 5 0"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 5c1 2 2.5 2 4 0s3-2 4 0 3 2 4 0"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="opacity-70"
      />
    </svg>
  );
}

// TerminalIcon removed - terminal functionality removed

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

// ToolchainModal removed - ESP-IDF functionality removed

function NewProjectModal({
  onClose,
  onCreate,
  isSubmitting,
}: {
  onClose: () => void;
  onCreate: (payload: NewProjectPayload) => Promise<void> | void;
  isSubmitting: boolean;
}) {
  const [name, setName] = useState("New Wavelet");
  const [location, setLocation] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
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
    if (!isTauriAvailable()) {
      alert("Tauri not available - file dialogs require Tauri environment");
      return;
    }
    try {
      const directory = await openDialog({ directory: true });
      if (typeof directory === "string") {
        setLocation(directory);
      }
    } catch (error) {
      console.error(error);
      window.alert(String(error));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-100">Create project</h2>
          <p className="text-sm text-slate-400">
            Configure a local workspace; flashing and syncing hooks will be added later.
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
              placeholder="My Wavelet"
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
                className="rounded-md border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-200 cursor-pointer"
              >
                Browse
              </button>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-200 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim() || !location.trim()}
              className="rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:bg-sky-400 cursor-pointer disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;

function WelcomePage({
  onStartNewProject,
  onOpenProject,
  onOpenRecent,
  recentProjects,
}: {
  onStartNewProject: () => void;
  onOpenProject: () => void;
  onOpenRecent: (project: RecentProject) => void;
  recentProjects: RecentProject[];
}) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center bg-slate-950 px-6 py-12">
      <div className="w-full max-w-3xl text-center">
        <div className="mx-auto mb-8 h-28 w-28 overflow-hidden rounded-full bg-slate-900/60 shadow-2xl shadow-sky-500/20 ring-2 ring-sky-500/40">
          <img src="/emwaver-logo.png" alt="EMWaver" className="h-full w-full object-contain p-4" />
        </div>
        <h2 className="text-2xl font-semibold text-slate-100">Welcome to EMWaver</h2>
        <p className="mt-2 text-sm text-slate-400">
          Use the Projects menu or the shortcuts below to create or open an EMWaver workspace.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={onStartNewProject}
            className="min-w-[160px] rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:bg-sky-400 cursor-pointer"
          >
            New Project…
          </button>
          <button
            type="button"
            onClick={onOpenProject}
            className="min-w-[160px] rounded-md border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-900 hover:text-sky-200 cursor-pointer"
          >
            Open Project…
          </button>
        </div>

        <div className="mt-12 text-left">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Recent Projects
          </h3>
          {recentProjects.length > 0 ? (
            <div className="mt-3 space-y-2">
              {recentProjects.map((project) => (
                <button
                  key={project.path}
                  type="button"
                  onClick={() => onOpenRecent(project)}
                  className="group flex w-full cursor-pointer items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-left transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-900"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-slate-100">{project.name}</span>
                    <span className="text-xs text-slate-500">{project.path}</span>
                  </div>
                  <span className="text-[11px] uppercase tracking-wide text-slate-500 transition group-hover:text-sky-400">
                    Open
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-slate-800 px-4 py-6 text-sm text-slate-500">
              Projects you open will appear here for quick access.
            </div>
          )}
        </div>
      </div>
    </section>
  );
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
