/*
 * EMWaver Desktop App
 * Copyright (C) 2025 Luís Marnoto
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
import RfidFragment from "./components/RfidFragment";
import PacketModeFragment from "./components/PacketModeFragment";
import SettingsFragment from "./components/SettingsFragment";
import HomePage from "./components/HomePage";
import FlashFragment from "./components/FlashFragment";
import DevToolsFragment from "./components/DevToolsFragment";

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
export type FragmentType =
  | "wavelets"
  | "ism"
  | "sampler"
  | "emwaver"
  | "rfid"
  | "packetMode"
  | "flash"
  | "settings"
  | "devtools";

type RecentProject = {
  path: string;
  name: string;
  lastOpenedAt: number;
};

type ThemeMode = "dark" | "light";

const RECENT_PROJECTS_STORAGE_KEY = "emwaver.recentProjects";
const RECENT_PROJECTS_LIMIT = 10;
const THEME_STORAGE_KEY = "emwaver.theme";
const DEFAULT_THEME: ThemeMode = "dark";

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

function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return DEFAULT_THEME;
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : DEFAULT_THEME;
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
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());
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
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    const root = window.document.documentElement;
    root.classList.remove("theme-dark", "theme-light");
    root.classList.add(`theme-${theme}`);
  }, [theme]);

  const handleToggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

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
        setActivePane("wavelets");
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
        setActivePane("wavelets");
        return;
      }
      await commitPendingSave();
      const existing = openFiles.find((file) => file.id === node.id);
      if (existing) {
        setSelectedFileId(node.id);
        setActiveFileId(existing.id);
        setActivePane("wavelets");
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
        setActivePane("wavelets");
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
    setActivePane("wavelets");
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
          await safeListen("menu-show-devtools", () => {
            handleFragmentClick("devtools");
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
  const isRfidActive = activePane === "rfid";
  const isPacketModeActive = activePane === "packetMode";
  const isFlashActive = activePane === "flash";
  const isSettingsActive = activePane === "settings";
  const isDevToolsActive = activePane === "devtools";

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      <ActivityBar
        activePane={activePane}
        onFragmentClick={handleFragmentClick}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />
      <div className="relative flex flex-1 min-h-0">
        <Pane active={isEMWaverActive}>
          <HomePage onNavigateToFragment={handleFragmentClick} />
        </Pane>
        <Pane active={isWaveletsActive}><WaveletsFragment theme={theme} /></Pane>
        <Pane active={isISMActive}><ISMFragment /></Pane>
        <Pane active={isSamplerActive}><SamplerFragment /></Pane>
        <Pane active={isRfidActive}><RfidFragment /></Pane>
        <Pane active={isPacketModeActive}><PacketModeFragment /></Pane>
        <Pane active={isFlashActive}><FlashFragment /></Pane>
        <Pane active={isSettingsActive}><SettingsFragment /></Pane>
        <Pane active={isDevToolsActive}><DevToolsFragment theme={theme} /></Pane>
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
      className={`flex h-full shrink-0 flex-col border-r border-slate-900 bg-slate-950 transition-[width] duration-150 ${isVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
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
  theme: ThemeMode;
  onToggleTheme: () => void;
};

function ActivityBar({ activePane, onFragmentClick, theme, onToggleTheme }: ActivityBarProps) {
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
      <ActivityButton
        label="RFID"
        isActive={activePane === "rfid"}
        onClick={() => onFragmentClick("rfid")}
        icon={<RfidIcon />}
      />
      <ActivityButton
        label="Packet Mode"
        isActive={activePane === "packetMode"}
        onClick={() => onFragmentClick("packetMode")}
        icon={<PacketModeIcon />}
      />
      <ActivityButton
        label="Flash"
        isActive={activePane === "flash"}
        onClick={() => onFragmentClick("flash")}
        icon={<FlashIcon />}
      />
      <ActivityButton
        label="Dev Tools"
        isActive={activePane === "devtools"}
        onClick={() => onFragmentClick("devtools")}
        icon={<DevToolsIcon />}
      />
      <ActivityButton
        label="Settings"
        isActive={activePane === "settings"}
        onClick={() => onFragmentClick("settings")}
        icon={<SettingsIcon />}
      />
      <div className="mt-auto flex flex-col gap-3">
        <ThemeToggleButton theme={theme} onToggle={onToggleTheme} />
      </div>
    </aside>
  );
}

function FlashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-full w-full" aria-hidden="true">
      <path
        d="M13 2L3 14h7l-1 8 12-14h-7l1-6z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DevToolsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-full w-full" aria-hidden="true">
      <path
        d="M7 8l-3 4 3 4M17 8l3 4-3 4M14 6l-4 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ThemeToggleButton({ theme, onToggle }: { theme: ThemeMode; onToggle: () => void }) {
  const isLight = theme === "light";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={isLight ? "Switch to dark mode" : "Switch to light mode"}
      aria-label="Toggle theme"
      aria-pressed={isLight}
      className={`theme-toggle-button flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg transition-transform transition-colors duration-150 hover:-translate-y-0.5 ${
        isLight
          ? "theme-toggle-button--active bg-slate-900 text-sky-200 shadow-lg shadow-sky-500/10"
          : "text-slate-400 hover:bg-slate-900 hover:text-sky-200"
      }`}
    >
      <span className="h-5 w-5" aria-hidden="true">
        {isLight ? <SunIcon /> : <MoonIcon />}
      </span>
    </button>
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
      className={`activity-button flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg transition-transform transition-colors duration-150 hover:-translate-y-0.5 ${
        isActive
          ? "activity-button--active bg-slate-900 text-sky-200 shadow-lg shadow-sky-500/10"
          : "text-slate-400 hover:bg-slate-900 hover:text-sky-200"
      }`}
    >
      <span className="h-5 w-5" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-full w-full">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <line x1="4.2" y1="4.2" x2="6.3" y2="6.3" />
      <line x1="17.7" y1="17.7" x2="19.8" y2="19.8" />
      <line x1="17.7" y1="6.3" x2="19.8" y2="4.2" />
      <line x1="4.2" y1="19.8" x2="6.3" y2="17.7" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-full w-full">
      <path d="M21 12.8a8.5 8.5 0 1 1-9.8-9.8 7 7 0 0 0 9.8 9.8z" />
    </svg>
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
      className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] leading-tight transition-colors ${isSelected ? "bg-slate-800 text-sky-100" : "text-slate-300 hover:bg-slate-800/60"}`}
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
  // Converted from Android chip_svgrepo_com.xml
  return (
    <svg viewBox="0 0 206.74 206.74" fill="currentColor" className="h-full w-full">
      <path d="M135.33,63.91H71.41c-4.14,0 -7.5,3.36 -7.5,7.5v63.91c0,4.14 3.36,7.5 7.5,7.5h63.91c4.14,0 7.5,-3.36 7.5,-7.5V71.41C142.83,67.27 139.47,63.91 135.33,63.91zM127.83,127.83H78.91V78.91h48.91V127.83z" />
      <path d="M199.24,110.87c4.14,0 7.5,-3.36 7.5,-7.5s-3.36,-7.5 -7.5,-7.5h-24.45V78.91h24.45c4.14,0 7.5,-3.36 7.5,-7.5c0,-4.14 -3.36,-7.5 -7.5,-7.5h-24.45V39.46c0,-4.14 -3.36,-7.5 -7.5,-7.5h-24.46V7.5c0,-4.14 -3.36,-7.5 -7.5,-7.5c-4.14,0 -7.5,3.36 -7.5,7.5v24.45h-16.96V7.5c0,-4.14 -3.36,-7.5 -7.5,-7.5s-7.5,3.36 -7.5,7.5v24.45H78.91V7.5c0,-4.14 -3.36,-7.5 -7.5,-7.5c-4.14,0 -7.5,3.36 -7.5,7.5v24.45H39.46c-4.14,0 -7.5,3.36 -7.5,7.5v24.46H7.5c-4.14,0 -7.5,3.36 -7.5,7.5c0,4.14 3.36,7.5 7.5,7.5h24.46v16.96H7.5c-4.14,0 -7.5,3.36 -7.5,7.5s3.36,7.5 7.5,7.5h24.46v16.96H7.5c-4.14,0 -7.5,3.36 -7.5,7.5c0,4.14 3.36,7.5 7.5,7.5h24.46v24.46c0,4.14 3.36,7.5 7.5,7.5h24.46v24.45c0,4.14 3.36,7.5 7.5,7.5c4.14,0 7.5,-3.36 7.5,-7.5v-24.45h16.96v24.45c0,4.14 3.36,7.5 7.5,7.5s7.5,-3.36 7.5,-7.5v-24.45h16.96v24.45c0,4.14 3.36,7.5 7.5,7.5c4.14,0 7.5,-3.36 7.5,-7.5v-24.45h24.46c4.14,0 7.5,-3.36 7.5,-7.5v-24.46h24.45c4.14,0 7.5,-3.36 7.5,-7.5c0,-4.14 -3.36,-7.5 -7.5,-7.5h-24.45v-16.96H199.24zM159.78,159.78H46.96V46.96h112.83V159.78z" />
    </svg>
  );
}

function SamplerIcon() {
  // Converted from Android ic_rawmode_black_24dp.xml (waveform icon)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-full w-full">
      <path d="M 0.00 12.00 L 0.24 12.63 L 0.48 13.27 L 0.73 13.89 L 0.97 14.51 L 1.21 15.12 L 1.45 15.72 L 1.70 16.30 L 1.94 16.86 L 2.18 17.41 L 2.42 17.93 L 2.67 18.43 L 2.91 18.90 L 3.15 19.35 L 3.39 19.76 L 3.64 20.15 L 3.88 20.50 L 4.12 20.82 L 4.36 21.10 L 4.61 21.34 L 4.85 21.55 L 5.09 21.72 L 5.33 21.85 L 5.58 21.94 L 5.82 21.99 L 6.06 22.00 L 6.30 21.97 L 6.55 21.90 L 6.79 21.79 L 7.03 21.64 L 7.27 21.45 L 7.52 21.22 L 7.76 20.96 L 8.00 20.66 L 8.24 20.33 L 8.48 19.96 L 8.73 19.56 L 8.97 19.13 L 9.21 18.67 L 9.45 18.18 L 9.70 17.67 L 9.94 17.14 L 10.18 16.58 L 10.42 16.01 L 10.67 15.42 L 10.91 14.82 L 11.15 14.20 L 11.39 13.58 L 11.64 12.95 L 11.88 12.32 L 12.12 11.68 L 12.36 11.05 L 12.61 10.42 L 12.85 9.80 L 13.09 9.18 L 13.33 8.58 L 13.58 7.99 L 13.82 7.42 L 14.06 6.86 L 14.30 6.33 L 14.55 5.82 L 14.79 5.33 L 15.03 4.87 L 15.27 4.44 L 15.52 4.04 L 15.76 3.67 L 16.00 3.34 L 16.24 3.04 L 16.48 2.78 L 16.73 2.55 L 16.97 2.36 L 17.21 2.21 L 17.45 2.10 L 17.70 2.03 L 17.94 2.00 L 18.18 2.01 L 18.42 2.06 L 18.67 2.15 L 18.91 2.28 L 19.15 2.45 L 19.39 2.66 L 19.64 2.90 L 19.88 3.18 L 20.12 3.50 L 20.36 3.85 L 20.61 4.24 L 20.85 4.65 L 21.09 5.10 L 21.33 5.57 L 21.58 6.07 L 21.82 6.59 L 22.06 7.14 L 22.30 7.70 L 22.55 8.28 L 22.79 8.88 L 23.03 9.49 L 23.27 10.11 L 23.52 10.73 L 23.76 11.37 L 24.00 12.00" />
    </svg>
  );
}

function EMWaverIcon() {
  // Converted from Android emwaver_vector.xml (EMWaver text logo)
  return (
    <svg viewBox="0 0 300 300" fill="currentColor" className="h-full w-full">
      <path d="M48,37c-6.4,1.1 -11.1,3.2 -15.4,7 -8.9,7.9 -10.1,15 -9.2,57.5 0.6,30.6 0.7,32.1 3,37 4.2,9 10.5,13.6 21.7,15.5 4,0.7 15.8,1 30.6,0.8 22.7,-0.3 24.3,-0.4 27,-2.4 3.2,-2.4 5.5,-9.5 5.1,-15.9l-0.3,-4 -27.7,-0.5c-35,-0.6 -33.2,0.2 -33.6,-15.4l-0.3,-10.6 26,-0 26,-0 2,-2.6c1.7,-2.2 2.1,-4.1 2.1,-10.3 0,-4.7 -0.5,-8.2 -1.2,-8.9 -0.9,-0.9 -8.5,-1.2 -28,-1.2l-26.8,-0 0,-9.3c0,-5 0.4,-9.7 0.8,-10.4 1.7,-2.7 7,-3.3 30.5,-3.4 27.1,-0 29.9,-0.5 33.5,-5.9 1.9,-2.9 2.2,-4.5 2,-10.5l-0.3,-7 -31.5,-0.1c-17.3,-0.1 -33.5,0.2 -36,0.6z" />
      <path d="M149.3,38c-3.2,1.4 -4.8,3 -6.3,6.2 -2.2,4.7 -23.4,108.3 -22.4,109.9 0.3,0.5 5.4,0.9 11.4,0.9 8.5,-0 11.2,-0.3 12.4,-1.6 0.9,-0.8 1.6,-1.9 1.6,-2.3 0,-0.4 3.4,-18.6 7.5,-40.5 4.1,-21.9 7.5,-40.3 7.5,-40.9 0,-2.6 1.3,0.9 3.9,10.4 7.5,27.6 19.6,66.7 21.4,69.3 2.7,3.8 7.4,5.6 14.6,5.6 7.7,-0 13.5,-2.3 16,-6.4 1.9,-3.2 10.2,-30.4 18.7,-61.4 2.6,-9.5 5.1,-16.9 5.4,-16.5 0.4,0.5 4.2,18.8 8.5,40.8 4.9,25.4 8.3,40.6 9.3,41.7 1.2,1.5 3.3,1.8 11.7,1.8 7.1,-0 10.6,-0.4 11.3,-1.3 0.8,-0.9 -1.8,-15.6 -9.3,-52.2 -5.6,-28.1 -10.8,-52.9 -11.4,-55.2 -2.1,-7.7 -9.6,-11.3 -20.8,-10 -4.8,0.5 -8.5,2.7 -11.5,6.8 -1.1,1.4 -7.5,21.8 -14.4,45.5 -6.9,23.6 -12.7,43.1 -12.9,43.3 -0.4,0.4 -0.1,1.4 -14.3,-48.5 -5.9,-21 -11.6,-39.4 -12.6,-40.9 -4,-6.1 -16.8,-8.4 -25.3,-4.5z" />
      <path d="M107.6,182c-4.9,0.9 -6.5,3 -5.7,7.2 0.7,3.2 0.8,3.2 5.1,2.8 8.5,-0.9 17.7,-0.5 19.4,0.9 1,0.8 1.6,2.9 1.6,5.2l0,3.9 -6.8,-0c-7.8,-0 -17.8,2.3 -20.5,4.8 -3,2.7 -4.7,6.8 -4.7,11.4 0,6.3 2.7,10.9 8,13.6 4.1,2.1 5.6,2.3 16.5,2 13.1,-0.4 17.1,-1.6 19.2,-5.8 1.9,-3.8 1.8,-33.2 -0.2,-36.9 -4.3,-8.4 -17,-12 -31.9,-9.1zM129,217c0,4.8 -0.4,6.1 -1.9,7 -2.4,1.3 -12.1,1.3 -15.4,0.1 -3,-1.2 -4.4,-5.9 -2.7,-9.1 1.6,-3 4.4,-3.9 12.8,-3.9l7.2,-0.1 0,6z" />
      <path d="M219.3,182c-14.5,3 -20.7,12.8 -18.6,29.6 2.1,17.4 9.5,23.1 28.4,22.2 10.1,-0.5 13.9,-2.3 13.9,-6.6 0,-4.4 -1,-5.2 -5.5,-4.2 -6.2,1.5 -16.2,1.2 -19.5,-0.5 -3.3,-1.7 -5,-4.3 -5,-7.4 0,-2 0.5,-2.1 14.9,-2.1 14.4,-0 15.1,-0.1 16.5,-2.2 1.8,-2.6 2.1,-10.5 0.6,-16 -2.8,-9.9 -13.6,-15.3 -25.7,-12.8zM231.1,192.3c2.4,1.8 3.9,5.2 3.9,8.6l0,3.1 -11.1,-0 -11.2,-0 0.6,-3.8c0.9,-5.6 5.4,-9.2 11.5,-9.2 2.6,-0 5.4,0.6 6.3,1.3z" />
      <path d="M270.3,182.1c-6.4,1.2 -11.2,3.8 -12.8,7 -1.7,3.1 -1.9,11.1 -0.8,31.1l0.6,12.8 5.4,-0 5.3,-0 0,-19.5c0,-22 -0.2,-21.5 8.3,-21.5 5,-0 6.4,-1.1 7.3,-5.9 0.5,-2.3 0.3,-3.6 -0.7,-4.2 -1.7,-1 -6.8,-1 -12.6,0.2z" />
      <path d="M17.4,183.5c-0.3,0.8 2.5,12.1 6.3,25.2l6.8,23.7 3.5,0.9c2.2,0.6 4.8,0.5 7.2,-0.2 3.7,-1.1 3.8,-1.4 6.7,-10.9 1.7,-5.3 3.8,-12.5 4.7,-16 1,-3.4 2,-6.2 2.4,-6.2 0.4,-0 2.5,6.8 4.6,15.1 2.1,8.4 4.4,15.8 5,16.6 1.2,1.8 11.7,2.4 13.3,0.8 1.9,-1.9 14.8,-48.4 13.7,-49.5 -1.4,-1.4 -7.9,-1.3 -9.9,0.2 -1.1,0.9 -3,7.4 -5.7,18.7 -2.2,9.6 -4.2,17.6 -4.3,17.8 -0.2,0.2 -2.6,-7.8 -5.2,-17.8 -4.1,-15.2 -5.2,-18.3 -7.1,-19.1 -2.6,-1.2 -8.8,-0.3 -10.1,1.5 -0.6,0.6 -3.2,9 -5.8,18.4 -2.7,9.5 -5.1,17.3 -5.4,17.3 -0.3,-0 -2.3,-7.8 -4.5,-17.3 -2.1,-9.4 -4.2,-18 -4.7,-19 -1.3,-2.2 -10.7,-2.5 -11.5,-0.2z" />
      <path d="M148.1,182.9c-1.1,0.7 0.1,5.3 6.4,24 4.2,12.7 8.3,23.8 9.2,24.6 2.5,2.6 12.9,2.4 15.6,-0.3 2,-2.1 18,-46.9 17.2,-48.3 -0.9,-1.3 -8.9,-1.1 -10.7,0.3 -0.9,0.7 -4.4,10 -7.8,20.7 -3.3,10.6 -6.3,19.1 -6.5,19 -0.2,-0.2 -2.9,-9 -6,-19.4 -3.1,-10.5 -6.4,-19.6 -7.3,-20.3 -1.8,-1.4 -8,-1.6 -10.1,-0.3z" />
    </svg>
  );
}

function RfidIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full">
      <path d="M12.5,11a1.5,1.5 0,1 0,1.5 1.5,1.502 1.502,0 0,0 -1.5,-1.5zM7.916,17.219a6.769,6.769 0,0 1,0 -9.438l0.718,0.697a5.769,5.769 0,0 0,0 8.044zM5.071,19.914a10.497,10.497 0,0 1,0 -14.828l0.707,0.707a9.497,9.497 0,0 0,0 13.414zM17.084,17.219l-0.718,-0.697a5.769,5.769 0,0 0,0 -8.044l0.718,-0.697a6.769,6.769 0,0 1,0 9.438zM19.929,19.914l-0.707,-0.707a9.497,9.497 0,0 0,0 -13.414l0.707,-0.707a10.497,10.497 0,0 1,0 14.828z" />
    </svg>
  );
}

function PacketModeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full">
      <path d="M10.5911 2.51301C11.4947 2.14671 12.5053 2.14671 13.4089 2.51301L20.9075 5.55298C21.5679 5.82071 22 6.46216 22 7.17477V16.8275C22 17.5401 21.5679 18.1815 20.9075 18.4493L13.4089 21.4892C12.5053 21.8555 11.4947 21.8555 10.5911 21.4892L3.09252 18.4493C2.43211 18.1815 2 17.5401 2 16.8275V7.17477C2 6.46216 2.43211 5.82071 3.09252 5.55298L10.5911 2.51301ZM12.8453 3.90312C12.3032 3.68334 11.6968 3.68334 11.1547 3.90312L9.24097 4.67894L16.7678 7.60604L19.437 6.57542L12.8453 3.90312ZM14.6911 8.40787L7.21472 5.50039L4.59029 6.56435L12.0013 9.44642L14.6911 8.40787ZM3.5 16.8275C3.5 16.9293 3.56173 17.0209 3.65607 17.0592L11.1547 20.0991C11.1863 20.112 11.2183 20.1241 11.2503 20.1354V10.7638L3.5 7.74979V16.8275ZM12.8453 20.0991L20.3439 17.0592C20.4383 17.0209 20.5 16.9293 20.5 16.8275V7.77292L12.7503 10.7651V20.1352C12.7822 20.1239 12.8139 20.1119 12.8453 20.0991Z" />
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
      className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:shadow-lg ${isActive ? "border-sky-500 bg-slate-800 text-sky-300 shadow-sky-500/20" : "border-slate-700 bg-slate-900 text-slate-300 hover:border-sky-500/70 hover:bg-slate-800 hover:text-sky-200"} disabled:translate-y-0 disabled:shadow-none disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span className="h-4 w-4" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}


function WaveletIcon() {
  // Converted from Android ic_console_black_24dp.xml (terminal/console icon)
  // Adjusted viewBox to zoom in and center the icon for better visibility
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full">
      <g transform="translate(12, 12) scale(1.3) translate(-10.5, -12)">
        <path d="M5.64645 9.14645C5.84171 8.95118 6.15829 8.95118 6.35355 9.14645L8.35355 11.1464C8.44732 11.2402 8.5 11.3674 8.5 11.5C8.5 11.6326 8.44732 11.7598 8.35355 11.8536L6.35355 13.8536C6.15829 14.0488 5.84171 14.0488 5.64645 13.8536C5.45118 13.6583 5.45118 13.3417 5.64645 13.1464L7.29289 11.5L5.64645 9.85355C5.45118 9.65829 5.45118 9.34171 5.64645 9.14645ZM14.5 13H9.5C9.22386 13 9 13.2239 9 13.5C9 13.7761 9.22386 14 9.5 14H14.5C14.7761 14 15 13.7761 15 13.5C15 13.2239 14.7761 13 14.5 13ZM2.99609 5.5C2.99609 4.11929 4.11538 3 5.49609 3H14.4961C15.8768 3 16.9961 4.11929 16.9961 5.5V6H16.999V7H16.9961V14.5C16.9961 15.8807 15.8768 17 14.4961 17H5.49609C4.11538 17 2.99609 15.8807 2.99609 14.5V5.5ZM15.9961 6V5.5C15.9961 4.67157 15.3245 4 14.4961 4H5.49609C4.66767 4 3.99609 4.67157 3.99609 5.5V6H15.9961ZM3.99609 7V14.5C3.99609 15.3284 4.66767 16 5.49609 16H14.4961C15.3245 16 15.9961 15.3284 15.9961 14.5V7H3.99609Z" />
      </g>
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-full w-full">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7.1 3.2l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
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
