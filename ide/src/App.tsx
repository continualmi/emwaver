import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { Editor as MonacoEditor, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Tree, type NodeRendererProps, type TreeApi } from "react-arborist";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Terminal, type IDisposable } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";

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
type ToolchainStatusResponse = {
  installed: boolean;
  version: string | null;
  installing: boolean;
};

type ToolchainProgressEvent = {
  step: number;
  total_steps: number;
  message: string;
};

type ToolchainCompletionEvent = {
  success: boolean;
  error?: string | null;
};

type ToolchainLogEvent = {
  stream: "stdout" | "stderr";
  chunk: string;
};

type ShellOutputEvent = {
  sessionId: string;
  sequence: number;
  data: string;
};

type ShellExitEvent = {
  sessionId: string;
  reason?: string | null;
};

type FirmwareTaskKind = "build" | "flash" | "flash_monitor";

type TerminalSessionDescriptor = {
  id: string;
  label: string;
  kind: "build" | "monitor";
};

type TerminalHandle = {
  registerSession: (session: TerminalSessionDescriptor) => void;
  unregisterSession: (sessionId: string) => void;
  write: (sessionId: string, chunk: string) => void;
  clear: (sessionId: string) => void;
  focus: (sessionId: string) => void;
};

type SerialPortInfo = {
  port: string;
  description: string;
  details: string[];
};

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

const PROJECT_SETUP_COMMAND =
  'if [ -f ./setup.sh ]; then EMWAVER_IDE_ORIG_HOME="${EMWAVER_REAL_HOME:-$HOME}"; if [ -n "$EMWAVER_IDE_HOME" ]; then HOME="$EMWAVER_IDE_HOME"; fi; . ./setup.sh; HOME="${EMWAVER_IDE_ORIG_HOME:-$HOME}"; unset EMWAVER_IDE_ORIG_HOME; elif [ -f ./setup.bash ]; then EMWAVER_IDE_ORIG_HOME="${EMWAVER_REAL_HOME:-$HOME}"; if [ -n "$EMWAVER_IDE_HOME" ]; then HOME="$EMWAVER_IDE_HOME"; fi; . ./setup.bash; HOME="${EMWAVER_IDE_ORIG_HOME:-$HOME}"; unset EMWAVER_IDE_ORIG_HOME; fi';



const TASK_LABELS: Record<FirmwareTaskKind, string> = {
  build: "Build",
  flash: "Flash",
  flash_monitor: "Flash & Monitor",
};

function formatTaskLabel(task: FirmwareTaskKind): string {
  return TASK_LABELS[task] ?? task;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeForShell(value: string): string {
  return value.replace(/'/g, () => `"'"'"'`);
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

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [toolchainStatus, setToolchainStatus] = useState<ToolchainStatusResponse | null>(null);
  const [installProgress, setInstallProgress] = useState<ToolchainProgressEvent | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<FirmwareTaskKind | null>(null);
  const [lastTaskError, setLastTaskError] = useState<string | null>(null);
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [activePane, setActivePane] = useState<"explorer" | "wavelets" | "terminal">("explorer");
  const [isExplorerVisible, setIsExplorerVisible] = useState(true);
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
  const terminalRef = useRef<TerminalHandle | null>(null);
  const taskResetTimeoutRef = useRef<number | null>(null);
  const [buildSessionId, setBuildSessionId] = useState<string | null>(null);
  const [monitorSessionId, setMonitorSessionId] = useState<string | null>(null);
  const buildSessionPromiseRef = useRef<Promise<string> | null>(null);
  const monitorSessionPromiseRef = useRef<Promise<string> | null>(null);
  const shellSequencesRef = useRef<Map<string, number>>(new Map());
  const treeOpenStateRef = useRef<Map<string, Record<string, boolean>>>(new Map());
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [selectedSerialPort, setSelectedSerialPort] = useState<string | null>(null);
  const [autoDetectedSerialPort, setAutoDetectedSerialPort] = useState<string | null>(null);
  const [isLoadingSerialPorts, setIsLoadingSerialPorts] = useState(false);
  const [serialPortsError, setSerialPortsError] = useState<string | null>(null);
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
    () => (selectedProject ? `EMWaver IDE - ${selectedProject.name}` : "EMWaver IDE"),
    [selectedProject],
  );

  const toolchainReady = toolchainStatus?.installed ?? false;
  const toolchainInstalling = toolchainStatus?.installing ?? false;
  const shouldShowToolchainModal = toolchainStatus !== null && !toolchainReady;

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

  const refreshToolchainStatus = useCallback(async () => {
    try {
      const status = await invoke<ToolchainStatusResponse>("toolchain_status");
      setToolchainStatus(status);
      if (!status.installing) {
        setInstallProgress(null);
      }
    } catch (error) {
      console.error(error);
      window.alert(`Failed to determine ESP-IDF status: ${String(error)}`);
    }
  }, []);

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

  const refreshSerialPorts = useCallback(async () => {
    setIsLoadingSerialPorts(true);
    setSerialPortsError(null);
    try {
      const ports = await invoke<SerialPortInfo[]>("list_serial_ports");
      setSerialPorts(ports);

      let preferred = selectedSerialPort;
      if (preferred && !ports.some((port) => port.port === preferred)) {
        preferred = null;
      }
      setSelectedSerialPort(preferred);

      const resolved = await invoke<string | null>("resolve_serial_port", {
        preferred: preferred ?? null,
      });
      setAutoDetectedSerialPort(resolved);
    } catch (error) {
      console.error(error);
      setSerialPortsError(String(error));
      setAutoDetectedSerialPort(null);
    } finally {
      setIsLoadingSerialPorts(false);
    }
  }, [selectedSerialPort]);

  const ensureBuildShell = useCallback(async (): Promise<string> => {
    if (buildSessionId) {
      if (terminalRef.current) {
        terminalRef.current.registerSession({ id: buildSessionId, label: "Build", kind: "build" });
      }
      return buildSessionId;
    }
    if (buildSessionPromiseRef.current) {
      return buildSessionPromiseRef.current;
    }

    const promise = (async () => {
      const sessionId = await invoke<string>("spawn_shell_session");
      setBuildSessionId(sessionId);
      if (terminalRef.current) {
        terminalRef.current.registerSession({ id: sessionId, label: "Build", kind: "build" });
      }
      return sessionId;
    })();

    buildSessionPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      buildSessionPromiseRef.current = null;
    }
  }, [buildSessionId]);

  const ensureMonitorShell = useCallback(async (): Promise<string> => {
    if (monitorSessionId) {
      if (terminalRef.current) {
        terminalRef.current.registerSession({ id: monitorSessionId, label: "Monitor", kind: "monitor" });
      }
      return monitorSessionId;
    }
    if (monitorSessionPromiseRef.current) {
      return monitorSessionPromiseRef.current;
    }

    const promise = (async () => {
      const sessionId = await invoke<string>("spawn_shell_session");
      setMonitorSessionId(sessionId);
      if (terminalRef.current) {
        terminalRef.current.registerSession({ id: sessionId, label: "Monitor", kind: "monitor" });
      }
      return sessionId;
    })();

    monitorSessionPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      monitorSessionPromiseRef.current = null;
    }
  }, [monitorSessionId]);

  useEffect(() => {
    void ensureBuildShell().catch((error) => {
      console.error(error);
      setLastTaskError((prev) => prev ?? String(error));
    });
  }, [ensureBuildShell]);

  useEffect(() => {
    void ensureMonitorShell().catch((error) => console.error(error));
  }, [ensureMonitorShell]);

  const sendShellCommands = useCallback(async (sessionId: string, commands: string[]) => {
    if (commands.length === 0) {
      return;
    }
    const payload = `${commands.join("\n")}\n`;
    await invoke<void>("write_shell", { sessionId, data: payload });
  }, []);

  const interruptShell = useCallback(async (sessionId: string) => {
    await invoke<void>("write_shell", { sessionId, data: "\u0003" });
  }, []);

  useEffect(() => {
    return () => {
      if (buildSessionId) {
        void invoke("close_shell_session", { sessionId: buildSessionId }).catch((error) => {
          console.error(error);
        });
        shellSequencesRef.current.delete(buildSessionId);
      }
      if (monitorSessionId) {
        void invoke("close_shell_session", { sessionId: monitorSessionId }).catch((error) => {
          console.error(error);
        });
        shellSequencesRef.current.delete(monitorSessionId);
      }
    };
  }, [buildSessionId, monitorSessionId]);

  const openProjectAtPath = useCallback(
    async (
      directory: string,
      options: { silent?: boolean; initialName?: string; removeOnFailure?: boolean } = {},
    ) => {
      const { silent = false, initialName, removeOnFailure = true } = options;

      try {
        const entries = await invoke<DirectoryEntry[]>("read_directory", {
          payload: { path: directory },
        });
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
        setIsExplorerVisible(true);
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

  useEffect(() => {
    void refreshToolchainStatus();
  }, [refreshToolchainStatus]);

  useEffect(() => {
    void refreshSerialPorts();
  }, [refreshSerialPorts]);

  useEffect(() => {
    const unlisten: UnlistenFn[] = [];

    const register = async () => {
      try {
        unlisten.push(
          await listen<ToolchainProgressEvent>("toolchain-progress", (event) => {
            setInstallProgress(event.payload);
            setToolchainStatus((prev) =>
              prev ? { ...prev, installing: true } : { installed: false, installing: true, version: null },
            );
          }),
        );

        unlisten.push(
          await listen<ToolchainCompletionEvent>("toolchain-complete", (event) => {
            setInstallProgress(null);
            if (event.payload.success) {
              setInstallError(null);
              setInstallLogs([]);
              void refreshToolchainStatus();
            } else {
              setInstallError(event.payload.error ?? "ESP-IDF installation failed");
              setToolchainStatus((prev) =>
                prev
                  ? { ...prev, installing: false, installed: false }
                  : { installed: false, installing: false, version: null },
              );
            }
          }),
        );

        unlisten.push(
          await listen<ToolchainLogEvent>("toolchain-log", (event) => {
            setInstallLogs((prev) => [...prev, event.payload.chunk]);
          }),
        );

        unlisten.push(
          await listen<ShellOutputEvent>("shell-output", (event) => {
            const { sessionId, sequence, data } = event.payload;
            if (Number.isFinite(sequence)) {
              const last = shellSequencesRef.current.get(sessionId);
              if (last !== undefined && sequence <= last) {
                return;
              }
              shellSequencesRef.current.set(sessionId, sequence);
            }
            terminalRef.current?.write(sessionId, data);
          }),
        );

        unlisten.push(
          await listen<ShellExitEvent>("shell-exit", (event) => {
            const sessionId = event.payload.sessionId;
            const reason = event.payload.reason ?? null;
            if (reason) {
              terminalRef.current?.write(
                sessionId,
                `\r\n[emwaver] Shell exited: ${reason}\r\n`,
              );
              setLastTaskError(reason);
            } else {
              terminalRef.current?.write(sessionId, "\r\n[emwaver] Shell exited.\r\n");
            }
            shellSequencesRef.current.delete(sessionId);
            terminalRef.current?.unregisterSession(sessionId);
            setBuildSessionId((prev) => (prev === sessionId ? null : prev));
            setMonitorSessionId((prev) => (prev === sessionId ? null : prev));
          }),
        );
      } catch (error) {
        console.error(error);
      }
    };

    void register();

    return () => {
      unlisten.forEach((dispose) => {
        try {
          dispose();
        } catch (error) {
          console.error(error);
        }
      });
    };
  }, [refreshToolchainStatus]);

  useEffect(() => {
    setOpenFiles([]);
    setActiveFileId(null);
    setSelectedFileId(null);
  }, [selectedProjectId]);

  useEffect(() => {
    openFileRef.current = activeFile;
  }, [activeFile]);


  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (sidebarResizeActive.current && isExplorerVisible) {
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
  }, [isExplorerVisible]);

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
        setIsExplorerVisible(true);
        setActivePane("explorer");
        return;
      }
      await commitPendingSave();
      const existing = openFiles.find((file) => file.id === node.id);
      if (existing) {
        setSelectedFileId(node.id);
        setActiveFileId(existing.id);
        setActivePane("explorer");
        setIsExplorerVisible(true);
        return;
      }
      setIsLoadingFile(true);
      try {
        const absolutePath = await join(selectedProject.path, node.path);
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
        setActivePane("explorer");
        setIsExplorerVisible(true);
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
        const response = await invoke<CreateProjectResponse>("create_project", {
          payload: {
            name: name.trim(),
            location: location.trim(),
          },
        });

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

  const handleRunTask = useCallback(
    async (task: FirmwareTaskKind) => {
      if (!selectedProject) {
        window.alert("Select a project before running tasks.");
        return;
      }

      if (!toolchainStatus?.installed) {
        window.alert("ESP-IDF is not installed yet.");
        return;
      }
      try {
        setActivePane("terminal");
        setIsExplorerVisible(false);
        setLastTaskError(null);

        const projectPath = escapeForShell(selectedProject.path);
        const buildSession = await ensureBuildShell();
        terminalRef.current?.focus(buildSession);

        if (taskResetTimeoutRef.current !== null) {
          window.clearTimeout(taskResetTimeoutRef.current);
          taskResetTimeoutRef.current = null;
        }

        const baseCommands = [
          `cd '${projectPath}'`,
          PROJECT_SETUP_COMMAND,
        ];

        setActiveTask(task);

        if (task === "build") {
          await sendShellCommands(buildSession, [...baseCommands, "idf.py build"]);
        } else {
          const resolvedPort = await invoke<string | null>("resolve_serial_port", {
            preferred: selectedSerialPort ?? null,
          });
          setAutoDetectedSerialPort(resolvedPort);

          if (!resolvedPort) {
            const message = "Unable to detect a connected ESP32 device.";
            terminalRef.current?.write(buildSession, `${message}\r\n`);
            setLastTaskError(message);
            setActiveTask((prev) => (prev === task ? null : prev));
            return;
          }

          const escapedPort = escapeForShell(resolvedPort);
          await sendShellCommands(buildSession, [
            ...baseCommands,
            `idf.py -p '${escapedPort}' flash`,
          ]);

          if (task === "flash_monitor") {
            const monitorSession = await ensureMonitorShell();
            await interruptShell(monitorSession);
            terminalRef.current?.focus(monitorSession);
            await sendShellCommands(monitorSession, [
              `cd '${projectPath}'`,
              PROJECT_SETUP_COMMAND,
              `idf.py -p '${escapedPort}' monitor`,
            ]);
          }
        }

        taskResetTimeoutRef.current = window.setTimeout(() => {
          taskResetTimeoutRef.current = null;
          setActiveTask((prev) => (prev === task ? null : prev));
        }, 1500);
      } catch (error) {
        console.error(error);
        setLastTaskError(String(error));
        setActiveTask(null);
        window.alert(String(error));
      }
    },
    [
      ensureBuildShell,
      ensureMonitorShell,
      interruptShell,
      selectedProject,
      selectedSerialPort,
      sendShellCommands,
      toolchainStatus,
    ],
  );

  const handleSelectSerialPort = useCallback((port: string | null) => {
    setSelectedSerialPort(port);
  }, []);

  const handleSync = useCallback(async () => {
    try {
      const sessionId = await ensureBuildShell();
      terminalRef.current?.focus(sessionId);
      terminalRef.current?.write(sessionId, "[sync] Sync is not implemented yet.\r\n");
    } catch (error) {
      console.error(error);
      window.alert(String(error));
    }
  }, [ensureBuildShell]);

  const handleClone = useCallback(async () => {
    try {
      const sessionId = await ensureBuildShell();
      terminalRef.current?.focus(sessionId);
      terminalRef.current?.write(sessionId, "[clone] Clone wavelet scripts is not implemented yet.\r\n");
    } catch (error) {
      console.error(error);
      window.alert(String(error));
    }
  }, [ensureBuildShell]);

  const handleInstallToolchain = useCallback(async () => {
    setInstallError(null);
    setInstallProgress({ step: 0, total_steps: 1, message: "Preparing installation" });
    setInstallLogs([]);
    setToolchainStatus((prev) =>
      prev ? { ...prev, installing: true } : { installed: false, installing: true, version: null },
    );

    try {
      await invoke<void>("install_toolchain");
    } catch (error) {
      console.error(error);
      setInstallError(String(error));
      setToolchainStatus((prev) =>
        prev ? { ...prev, installing: false } : { installed: false, installing: false, version: null },
      );
    }
  }, []);

  const handleCloseProject = useCallback(async () => {
    await commitPendingSave();
    if (taskResetTimeoutRef.current !== null) {
      window.clearTimeout(taskResetTimeoutRef.current);
      taskResetTimeoutRef.current = null;
    }

    const closingProjectId = selectedProjectId;

    if (buildSessionId) {
      terminalRef.current?.clear(buildSessionId);
      terminalRef.current?.unregisterSession(buildSessionId);
      void invoke("close_shell_session", { sessionId: buildSessionId }).catch((error) => {
        console.error(error);
      });
      shellSequencesRef.current.delete(buildSessionId);
    }

    if (monitorSessionId) {
      terminalRef.current?.clear(monitorSessionId);
      terminalRef.current?.unregisterSession(monitorSessionId);
      void invoke("close_shell_session", { sessionId: monitorSessionId }).catch((error) => {
        console.error(error);
      });
      shellSequencesRef.current.delete(monitorSessionId);
    }

    setBuildSessionId(null);
    setMonitorSessionId(null);
    if (closingProjectId) {
      treeOpenStateRef.current.delete(closingProjectId);
    }

    setSelectedProjectId(null);
    setSelectedFileId(null);
    setOpenFiles([]);
    setActiveFileId(null);
    setActiveTask(null);
    setLastTaskError(null);
    setActivePane("explorer");
    setIsExplorerVisible(true);
  }, [buildSessionId, monitorSessionId, commitPendingSave, selectedProjectId]);

  const handleExplorerButtonClick = useCallback(() => {
    if (activePane === "explorer") {
      setIsExplorerVisible((prev) => !prev);
    } else {
      setActivePane("explorer");
      setIsExplorerVisible(true);
    }
  }, [activePane]);

  const handleWaveletsButtonClick = useCallback(() => {
    setActivePane("wavelets");
    setIsExplorerVisible(false);
  }, []);

  const handleTerminalButtonClick = useCallback(() => {
    setActivePane("terminal");
    setIsExplorerVisible(false);
  }, []);

  const toggleExplorerVisibility = useCallback(() => {
    setIsExplorerVisible((prev) => {
      const next = !prev;
      if (next) {
        setActivePane("explorer");
      }
      return next;
    });
  }, []);

  const showExplorer = useCallback(() => {
    setActivePane("explorer");
    setIsExplorerVisible(true);
  }, []);

  const showWavelets = useCallback(() => {
    setActivePane("wavelets");
    setIsExplorerVisible(false);
  }, []);

  const showTerminal = useCallback(() => {
    setActivePane("terminal");
    setIsExplorerVisible(false);
  }, []);

  const hideTerminal = useCallback(() => {
    if (activePane === "terminal") {
      setActivePane("explorer");
      setIsExplorerVisible(true);
    }
  }, [activePane]);

  const handleSidebarMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!isExplorerVisible) {
        return;
      }
      event.preventDefault();
      sidebarResizeActive.current = true;
      sidebarStartX.current = event.clientX;
      sidebarStartWidth.current = sidebarWidth;
      document.body.style.cursor = "col-resize";
    },
    [isExplorerVisible, sidebarWidth],
  );

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
    setIsExplorerVisible(true);
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
    const disposers: UnlistenFn[] = [];

    const register = async () => {
      try {
        disposers.push(
          await listen("menu-close-folder", () => {
            void handleCloseProject();
          }),
        );

        disposers.push(
          await listen("menu-new-project", () => {
            showExplorer();
            setIsModalOpen(true);
          }),
        );

        disposers.push(
          await listen("menu-open-project", () => {
            showExplorer();
            void handleOpenProject();
          }),
        );

        disposers.push(
          await listen("menu-toggle-explorer", () => {
            toggleExplorerVisibility();
          }),
        );

        disposers.push(
          await listen("menu-show-explorer", () => {
            showExplorer();
          }),
        );

        disposers.push(
          await listen("menu-show-wavelets", () => {
            showWavelets();
          }),
        );

        disposers.push(
          await listen("menu-sync-wavelets", () => {
            handleSync();
          }),
        );

        disposers.push(
          await listen("menu-clone-wavelets", () => {
            handleClone();
          }),
        );

        disposers.push(
          await listen("menu-toggle-terminal", () => {
            if (activePane === "terminal") {
              hideTerminal();
            } else {
              showTerminal();
            }
          }),
        );

        disposers.push(
          await listen("menu-show-terminal", () => {
            showTerminal();
          }),
        );

        disposers.push(
          await listen("menu-hide-terminal", () => {
            hideTerminal();
          }),
        );

        disposers.push(
          await listen("menu-increase-layout", () => {
            increaseLayoutSize();
          }),
        );

        disposers.push(
          await listen("menu-decrease-layout", () => {
            decreaseLayoutSize();
          }),
        );

        disposers.push(
          await listen("menu-reset-layout", () => {
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
  }, [activePane, decreaseLayoutSize, handleClone, handleCloseProject, handleOpenProject, handleSync, hideTerminal, increaseLayoutSize, resetLayoutSizes, showExplorer, showTerminal, showWavelets, toggleExplorerVisibility]);

  const isWaveletsActive = activePane === "wavelets";
  const isTerminalActive = activePane === "terminal";
  const isExplorerActive = !isWaveletsActive && !isTerminalActive;

  useEffect(() => {
    if (!isTerminalActive) {
      return;
    }

    if (terminalRef.current) {
      if (buildSessionId) {
        terminalRef.current.registerSession({ id: buildSessionId, label: "Build", kind: "build" });
      }
      if (monitorSessionId) {
        terminalRef.current.registerSession({ id: monitorSessionId, label: "Monitor", kind: "monitor" });
      }
    }

    if (selectedProject) {
      void ensureBuildShell().catch((error) => {
        console.error(error);
        setLastTaskError(String(error));
      });
      void ensureMonitorShell().catch((error) => console.error(error));
    }
  }, [
    buildSessionId,
    ensureBuildShell,
    ensureMonitorShell,
    isTerminalActive,
    monitorSessionId,
    selectedProject,
  ]);

  const explorerPane = selectedProject ? (
    <div className="flex flex-1 min-h-0">
      <Sidebar
        width={sidebarWidth}
        project={selectedProject}
        selectedFileId={selectedFileId}
        onSelectNode={handleTreeSelection}
        isVisible={isExplorerVisible}
        getInitialOpenState={getTreeOpenState}
        onToggleNode={updateTreeOpenState}
      />
      {isExplorerVisible && (
        <div
          onMouseDown={handleSidebarMouseDown}
          className="flex w-1 cursor-col-resize items-stretch bg-slate-900"
        >
          <span className="mx-auto h-full w-px bg-slate-800" />
        </div>
      )}
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
  ) : (
    <WelcomePage
      onStartNewProject={() => {
        showExplorer();
        setIsModalOpen(true);
      }}
      onOpenProject={() => {
        showExplorer();
        void handleOpenProject();
      }}
      onOpenRecent={handleOpenRecentProject}
      recentProjects={recentProjects}
    />
  );

  const waveletsPane = (
    <WaveletsPanel
      onSync={handleSync}
      onClone={handleClone}
      isLoggedIn={isLoggedIn}
      onToggleLogin={() => setIsLoggedIn((prev) => !prev)}
      selectedProject={selectedProject}
    />
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      <ActivityBar
        activePane={activePane}
        isExplorerVisible={isExplorerVisible}
        onExplorerClick={handleExplorerButtonClick}
        onWaveletsClick={handleWaveletsButtonClick}
        onTerminalClick={handleTerminalButtonClick}
      />
      <div className="relative flex flex-1 min-h-0">
        <Pane active={isWaveletsActive}>{waveletsPane}</Pane>
        <Pane active={isTerminalActive}>
          <TerminalPanel
            ref={terminalRef}
            fullHeight
            isActive={isTerminalActive}
            onRunTask={handleRunTask}
            activeTask={activeTask}
            toolchain={toolchainStatus}
            lastTaskError={lastTaskError}
            serialPorts={serialPorts}
            selectedSerialPort={selectedSerialPort}
            autoDetectedSerialPort={autoDetectedSerialPort}
            onSelectSerialPort={handleSelectSerialPort}
            onRefreshSerialPorts={refreshSerialPorts}
            refreshingSerialPorts={isLoadingSerialPorts}
            serialPortsError={serialPortsError}
            onHide={hideTerminal}
          />
        </Pane>
        <Pane active={isExplorerActive}>{explorerPane}</Pane>
      </div>
      {isModalOpen && (
        <NewProjectModal
          onClose={() => setIsModalOpen(false)}
          onCreate={handleCreateProject}
          isSubmitting={isCreatingProject}
        />
      )}
      {shouldShowToolchainModal && (
        <ToolchainModal
          status={toolchainStatus}
          progress={installProgress}
          error={installError}
          installing={toolchainInstalling}
          onInstall={handleInstallToolchain}
          logs={installLogs}
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
  activePane: "explorer" | "wavelets" | "terminal";
  isExplorerVisible: boolean;
  onExplorerClick: () => void;
  onWaveletsClick: () => void;
  onTerminalClick: () => void;
};

function ActivityBar({ activePane, isExplorerVisible, onExplorerClick, onWaveletsClick, onTerminalClick }: ActivityBarProps) {
  const explorerActive = activePane === "explorer" && isExplorerVisible;
  return (
    <aside className="flex w-14 shrink-0 flex-col items-center gap-3 border-r border-slate-900 bg-slate-950 py-4">
      <ActivityButton
        label="Explorer"
        isActive={explorerActive}
        onClick={onExplorerClick}
        icon={<ExplorerIcon />}
      />
      <ActivityButton
        label="Wavelets"
        isActive={activePane === "wavelets"}
        onClick={onWaveletsClick}
        icon={<WaveletIcon />}
      />
      <ActivityButton
        label="Terminal"
        isActive={activePane === "terminal"}
        onClick={onTerminalClick}
        icon={<TerminalIcon />}
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

type WaveletsPanelProps = {
  onSync: () => void;
  onClone: () => void;
  isLoggedIn: boolean;
  onToggleLogin: () => void;
  selectedProject: Project | null;
};

function WaveletsPanel({
  onSync,
  onClone,
  isLoggedIn,
  onToggleLogin,
  selectedProject,
}: WaveletsPanelProps) {
  return (
    <section className="flex flex-1 flex-col bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-900 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Wavelets</h2>
          <p className="text-sm text-slate-400">
            {selectedProject
              ? `Manage cloud sync for ${selectedProject.name}`
              : "Open a project to manage its wavelets."}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleLogin}
          className={`rounded-md px-3 py-2 text-xs font-semibold transition-transform transition-colors duration-150 hover:-translate-y-0.5 ${
            isLoggedIn
              ? "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
              : "bg-slate-100 text-slate-900 hover:bg-slate-200"
          }`}
        >
          {isLoggedIn ? "Signed In" : "Sign In"}
        </button>
      </header>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-6">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
          <h3 className="text-sm font-semibold text-slate-100">Cloud Sync</h3>
          <p className="mt-2 text-xs text-slate-400">
            Push the latest firmware builds and wavelet assets to your Continuous account.
          </p>
          <button
            type="button"
            onClick={onSync}
            className="mt-4 rounded-md border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-900 hover:text-sky-200"
          >
            Sync with Cloud
          </button>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
          <h3 className="text-sm font-semibold text-slate-100">Wavelet Library</h3>
          <p className="mt-2 text-xs text-slate-400">
            Clone starter wavelets and examples into your project workspace.
          </p>
          <button
            type="button"
            onClick={onClone}
            className="mt-4 rounded-md border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-900 hover:text-sky-200"
          >
            Clone Wavelet Scripts
          </button>
        </div>
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-5 text-sm text-slate-400">
          {selectedProject ? (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">Active Project</p>
              <p className="text-sm text-slate-200">{selectedProject.path}</p>
              <p className="text-xs text-slate-500">
                Wavelet synchronisation and sharing features will surface here as they are implemented.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-slate-300">No project is currently open.</p>
              <p className="text-xs text-slate-500">
                Use the Projects menu to open an existing workspace and manage its wavelets from here.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
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

type TerminalPanelProps = {
  height?: number;
  fullHeight?: boolean;
  isActive: boolean;
  onHide: () => void;
  onRunTask: (task: FirmwareTaskKind) => void;
  activeTask: FirmwareTaskKind | null;
  toolchain: ToolchainStatusResponse | null;
  lastTaskError: string | null;
  serialPorts: SerialPortInfo[];
  selectedSerialPort: string | null;
  autoDetectedSerialPort: string | null;
  onSelectSerialPort: (port: string | null) => void;
  onRefreshSerialPorts: () => void;
  refreshingSerialPorts: boolean;
  serialPortsError: string | null;
};

const TerminalPanel = forwardRef<TerminalHandle, TerminalPanelProps>(
  ({
    height,
    fullHeight = false,
    isActive,
    onHide,
    onRunTask,
    activeTask,
    toolchain,
    lastTaskError,
    serialPorts,
    selectedSerialPort,
    autoDetectedSerialPort,
    onSelectSerialPort,
    onRefreshSerialPorts,
    refreshingSerialPorts,
    serialPortsError,
  }, ref) => {
    const [sessions, setSessions] = useState<TerminalSessionDescriptor[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const containersRef = useRef<Map<string, HTMLDivElement | null>>(new Map());
    const terminalsRef = useRef<Map<string, Terminal>>(new Map());
    const fitAddonsRef = useRef<Map<string, FitAddon>>(new Map());
    const resizeObserversRef = useRef<Map<string, ResizeObserver>>(new Map());
    const dataDisposablesRef = useRef<Map<string, IDisposable>>(new Map());
    const buffersRef = useRef<Map<string, string[]>>(new Map());
    const activeSessionIdRef = useRef<string | null>(null);

    const selectedPortInfo = useMemo(
      () =>
        selectedSerialPort
          ? serialPorts.find((port) => port.port === selectedSerialPort) ?? null
          : null,
      [serialPorts, selectedSerialPort],
    );

    const autoDetectedPortInfo = useMemo(
      () =>
        autoDetectedSerialPort
          ? serialPorts.find((port) => port.port === autoDetectedSerialPort) ?? null
          : null,
      [autoDetectedSerialPort, serialPorts],
    );

    const formatPortLabel = useCallback((info: SerialPortInfo | null, fallback: string | null = null) => {
      if (info) {
        return info.description ? `${info.port} · ${info.description}` : info.port;
      }
      return fallback;
    }, []);
    const autoDetectOptionLabel = autoDetectedPortInfo
      ? `Auto-detect (${formatPortLabel(autoDetectedPortInfo)})`
      : autoDetectedSerialPort
        ? `Auto-detect (${autoDetectedSerialPort})`
        : "Auto-detect";

    const autoDetectStatusLabel = autoDetectedPortInfo
      ? `Auto-detected ${formatPortLabel(autoDetectedPortInfo)}`
      : autoDetectedSerialPort
        ? `Auto-detected ${autoDetectedSerialPort}`
        : "Auto-detect enabled";

    const selectedPortLabel = formatPortLabel(selectedPortInfo);
    const visiblePortInfo = selectedPortInfo ?? autoDetectedPortInfo;

    const handlePortChange = useCallback(
      (event: ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value;
        onSelectSerialPort(value.length === 0 ? null : value);
      },
      [onSelectSerialPort],
    );

    const panelStyle = fullHeight
      ? { flex: 1 }
      : height !== undefined
        ? { height: `${height}px` }
        : undefined;

    const panelClassName = fullHeight ? "flex flex-1 flex-col bg-slate-950" : "flex shrink-0 flex-col bg-slate-950";

    const fitSession = useCallback((sessionId: string) => {
      const terminal = terminalsRef.current.get(sessionId);
      const addon = fitAddonsRef.current.get(sessionId);
      if (!terminal || !addon) {
        return;
      }
      addon.fit();
      const cols = terminal.cols;
      const rows = terminal.rows;
      if (Number.isFinite(cols) && Number.isFinite(rows)) {
        void invoke("resize_shell", {
          sessionId,
          cols,
          rows,
        }).catch((error) => {
          console.error(error);
        });
      }
    }, []);

    const disposeTerminal = useCallback((sessionId: string) => {
      const terminal = terminalsRef.current.get(sessionId);
      if (terminal) {
        terminal.dispose();
        terminalsRef.current.delete(sessionId);
      }
      const addon = fitAddonsRef.current.get(sessionId);
      if (addon) {
        addon.dispose();
        fitAddonsRef.current.delete(sessionId);
      }
      const dataDisposable = dataDisposablesRef.current.get(sessionId);
      if (dataDisposable) {
        dataDisposable.dispose();
        dataDisposablesRef.current.delete(sessionId);
      }
      const resizeObserver = resizeObserversRef.current.get(sessionId);
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserversRef.current.delete(sessionId);
      }
    }, []);

    const openTerminal = useCallback(
      (sessionId: string) => {
        if (terminalsRef.current.has(sessionId)) {
          return;
        }

        const container = containersRef.current.get(sessionId);
        if (!container) {
          return;
        }

        const terminal = new Terminal({
          convertEol: true,
          cursorBlink: true,
          fontSize: 13,
          scrollback: 4000,
          fontFamily:
            "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          theme: {
            background: "#020617",
            foreground: "#e2e8f0",
            cursor: "#38bdf8",
          },
        });
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(container);
        terminalsRef.current.set(sessionId, terminal);
        fitAddonsRef.current.set(sessionId, fitAddon);

        const dataDisposable = terminal.onData((data) => {
          void invoke("write_shell", { sessionId, data }).catch((error) => {
            console.error(error);
          });
        });
        dataDisposablesRef.current.set(sessionId, dataDisposable);

        terminal.onResize(({ cols, rows }) => {
          void invoke("resize_shell", { sessionId, cols, rows }).catch((error) => {
            console.error(error);
          });
        });

        if (typeof ResizeObserver !== "undefined") {
          const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => fitSession(sessionId));
          });
          resizeObserver.observe(container);
          resizeObserversRef.current.set(sessionId, resizeObserver);
        }

        const queued = buffersRef.current.get(sessionId);
        if (queued && queued.length > 0) {
          queued.forEach((chunk) => terminal.write(chunk));
          buffersRef.current.delete(sessionId);
        }

        requestAnimationFrame(() => {
          fitSession(sessionId);
          if (activeSessionIdRef.current === sessionId) {
            terminal.focus();
          }
        });
      },
      [fitSession],
    );

    const makeContainerRef = useCallback(
      (sessionId: string) => (node: HTMLDivElement | null) => {
        if (node) {
          containersRef.current.set(sessionId, node);
          openTerminal(sessionId);
        } else {
          containersRef.current.delete(sessionId);
          disposeTerminal(sessionId);
        }
      },
      [disposeTerminal, openTerminal],
    );

    const registerSession = useCallback(
      (session: TerminalSessionDescriptor) => {
        setSessions((prev) => {
          const index = prev.findIndex((item) => item.id === session.id);
          if (index === -1) {
            const next = [...prev, session];
            setActiveSessionId((current) => current ?? session.id);
            if (containersRef.current.get(session.id)) {
              openTerminal(session.id);
            }
            return next;
          }

          const existing = prev[index];
          if (existing.label === session.label && existing.kind === session.kind) {
            return prev;
          }

          const next = prev.slice();
          next[index] = session;
          return next;
        });
      },
      [openTerminal],
    );

    const unregisterSession = useCallback(
      (sessionId: string) => {
        disposeTerminal(sessionId);
        buffersRef.current.delete(sessionId);
        containersRef.current.delete(sessionId);
        setSessions((prev) => {
          const filtered = prev.filter((session) => session.id !== sessionId);
          setActiveSessionId((current) => {
            if (filtered.length === 0) {
              return null;
            }
            if (current && filtered.some((session) => session.id === current)) {
              return current;
            }
            return filtered[0].id;
          });
          return filtered;
        });
      },
      [disposeTerminal],
    );

    const writeToSession = useCallback((sessionId: string, chunk: string) => {
      const terminal = terminalsRef.current.get(sessionId);
      if (terminal) {
        terminal.write(chunk);
        return;
      }
      const queue = buffersRef.current.get(sessionId) ?? [];
      queue.push(chunk);
      buffersRef.current.set(sessionId, queue);
    }, []);

    const clearSession = useCallback((sessionId: string) => {
      const terminal = terminalsRef.current.get(sessionId);
      if (terminal) {
        terminal.reset();
        terminal.clear();
        return;
      }
      buffersRef.current.delete(sessionId);
    }, []);

    const focusSession = useCallback((sessionId: string) => {
      setActiveSessionId(sessionId);
      requestAnimationFrame(() => {
        const terminal = terminalsRef.current.get(sessionId);
        if (terminal) {
          terminal.focus();
        }
        fitSession(sessionId);
      });
    }, [fitSession]);

    useImperativeHandle(
      ref,
      () => ({
        registerSession,
        unregisterSession,
        write: writeToSession,
        clear: clearSession,
        focus: focusSession,
      }),
      [clearSession, focusSession, registerSession, unregisterSession, writeToSession],
    );

    useEffect(() => {
      activeSessionIdRef.current = activeSessionId;
      if (activeSessionId && isActive) {
        requestAnimationFrame(() => {
          fitSession(activeSessionId);
          const terminal = terminalsRef.current.get(activeSessionId);
          terminal?.focus();
        });
      }
    }, [activeSessionId, fitSession, isActive]);

    useEffect(() => {
      if (!activeSessionId || !isActive) {
        return;
      }
      requestAnimationFrame(() => {
        fitSession(activeSessionId);
      });
    }, [activeSessionId, fitSession, height, isActive]);

    useEffect(() => {
      const handleResize = () => {
        if (!isActive || !activeSessionIdRef.current) {
          return;
        }
        fitSession(activeSessionIdRef.current);
      };

      window.addEventListener("resize", handleResize);
      return () => {
        window.removeEventListener("resize", handleResize);
      };
    }, [fitSession, isActive]);

    useEffect(() => {
      return () => {
        terminalsRef.current.forEach((terminal) => terminal.dispose());
        fitAddonsRef.current.forEach((addon) => addon.dispose());
        dataDisposablesRef.current.forEach((disposable) => disposable.dispose());
        resizeObserversRef.current.forEach((observer) => observer.disconnect());
        terminalsRef.current.clear();
        fitAddonsRef.current.clear();
        dataDisposablesRef.current.clear();
        resizeObserversRef.current.clear();
        containersRef.current.clear();
        buffersRef.current.clear();
      };
    }, []);

    const canRunTasks = Boolean(toolchain?.installed) && !toolchain?.installing;
    const disableActions = !canRunTasks || activeTask !== null;

    const statusText = (() => {
      if (activeTask) {
        return `${formatTaskLabel(activeTask)} in progress`;
      }
      if (toolchain?.installing) {
        return "Installing ESP-IDF";
      }
      if (toolchain?.installed) {
        return toolchain.version ? `ESP-IDF ${toolchain.version}` : "ESP-IDF ready";
      }
      return "ESP-IDF missing";
    })();

    return (
      <section style={panelStyle} className={panelClassName}>
        <header className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Terminal</p>
              <p className={`text-xs ${lastTaskError ? "text-rose-400" : "text-slate-500"}`}>
                {lastTaskError ?? statusText}
              </p>
            </div>
            <div className="flex gap-2">
              <IconButton
                onClick={onHide}
                label="Hide terminal"
                icon={<ChevronDownIcon />}
              />
              <button
                onClick={() => onRunTask("build")}
                disabled={disableActions}
                className="rounded-md border border-slate-700 px-3 py-1 text-xs font-medium text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-200 cursor-pointer disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {activeTask === "build" ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-flex h-3 w-3 animate-spin rounded-full border-[1.5px] border-sky-400 border-t-transparent" />
                    Building...
                  </span>
                ) : (
                  "Build"
                )}
              </button>
              <button
                onClick={() => onRunTask("flash")}
                disabled={disableActions}
                className="rounded-md border border-slate-700 px-3 py-1 text-xs font-medium text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-200 cursor-pointer disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {activeTask === "flash" ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-flex h-3 w-3 animate-spin rounded-full border-[1.5px] border-sky-400 border-t-transparent" />
                    Flashing...
                  </span>
                ) : (
                  "Flash"
                )}
              </button>
              <button
                onClick={() => onRunTask("flash_monitor")}
                disabled={disableActions}
                className="rounded-md border border-slate-700 px-3 py-1 text-xs font-medium text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-200 cursor-pointer disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {activeTask === "flash_monitor" ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-flex h-3 w-3 animate-spin rounded-full border-[1.5px] border-sky-400 border-t-transparent" />
                    Flashing & Monitoring...
                  </span>
                ) : (
                  "Flash + Monitor"
                )}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">Device</span>
              <select
                value={selectedSerialPort ?? ""}
                onChange={handlePortChange}
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                <option value="">{autoDetectOptionLabel}</option>
                {serialPorts.map((port) => (
                  <option key={port.port} value={port.port}>
                    {port.description ? `${port.port} · ${port.description}` : port.port}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onRefreshSerialPorts}
                disabled={refreshingSerialPorts}
                className="rounded-md border border-slate-700 px-2 py-1 text-xs font-medium text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-200 cursor-pointer disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {refreshingSerialPorts ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="flex-1 text-right">
              {serialPortsError ? (
                <span className="text-[11px] text-rose-400">{serialPortsError}</span>
              ) : serialPorts.length === 0 && !refreshingSerialPorts ? (
                <span className="text-[11px] text-slate-500">No serial devices detected</span>
              ) : selectedSerialPort ? (
                <span className="text-[11px] text-slate-500">
                  Using {selectedPortLabel ?? selectedSerialPort}
                </span>
              ) : autoDetectedSerialPort ? (
                <span className="text-[11px] text-slate-500">{autoDetectStatusLabel}</span>
              ) : (
                <span className="text-[11px] text-slate-500">Waiting for device · Auto-detect enabled</span>
              )}
            </div>
          </div>
        </header>

        {sessions.length > 0 && (
          <div className="flex items-center gap-2 border-b border-slate-900 px-4 py-2 text-xs">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => focusSession(session.id)}
                className={`rounded-md px-3 py-1 transition-colors ${
                  session.id === activeSessionId
                    ? "bg-slate-800 text-sky-300"
                    : "bg-slate-900 text-slate-400 hover:text-sky-200"
                }`}
              >
                {session.label}
              </button>
            ))}
          </div>
        )}

        {visiblePortInfo && visiblePortInfo.details.length > 0 && (
          <div className="border-b border-slate-900 px-4 py-2">
            <ul className="space-y-1 text-[11px] text-slate-400">
              {visiblePortInfo.details.map((detail, index) => (
                <li key={`${detail}-${index}`}>{detail}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex-1 overflow-hidden bg-slate-950 px-3 py-4">
          {sessions.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[11px] text-slate-600">
              Shell session will appear once a task starts.
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                style={{ display: session.id === activeSessionId ? "block" : "none" }}
                className="h-full w-full"
              >
                <div className="flex h-full w-full flex-col gap-3">
                  <div className="flex-1 overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950 shadow-inner">
                    <div
                      ref={makeContainerRef(session.id)}
                      className="h-full w-full"
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    );
  },
);

TerminalPanel.displayName = "TerminalPanel";

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

function ExplorerIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <line x1="7" y1="4" x2="7" y2="16" />
      <line x1="9" y1="8" x2="16" y2="8" />
      <line x1="9" y1="12" x2="16" y2="12" />
    </svg>
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

function TerminalIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <rect x="2.5" y="4" width="15" height="12" rx="2" />
      <path d="M6 8.5 8.5 11 6 13.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="10.5" y1="13" x2="14" y2="13" strokeLinecap="round" />
    </svg>
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

function ToolchainModal({
  status,
  progress,
  error,
  installing,
  onInstall,
  logs,
}: {
  status: ToolchainStatusResponse | null;
  progress: ToolchainProgressEvent | null;
  error: string | null;
  installing: boolean;
  onInstall: () => void;
  logs: string[];
}) {
  const stepLabel = progress ? `Step ${progress.step} of ${progress.total_steps}` : null;
  const message = progress?.message ?? "ESP-IDF is required to build and flash firmware.";

  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const writtenLogsRef = useRef(0);

  useEffect(() => {
    return () => {
      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.dispose();
        terminalInstanceRef.current = null;
      }
      if (fitAddonRef.current) {
        fitAddonRef.current.dispose();
        fitAddonRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!installing) {
      writtenLogsRef.current = 0;
      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.dispose();
        terminalInstanceRef.current = null;
      }
      if (fitAddonRef.current) {
        fitAddonRef.current.dispose();
        fitAddonRef.current = null;
      }
      return;
    }

    if (!terminalContainerRef.current) {
      return;
    }

    if (!terminalInstanceRef.current) {
      const terminal = new Terminal({
        convertEol: false,
        disableStdin: true,
        fontSize: 12,
        theme: {
          background: "#0f172a",
          foreground: "#e2e8f0",
          cursor: "#38bdf8",
        },
        scrollback: 1000,
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminalInstanceRef.current = terminal;
      fitAddonRef.current = fitAddon;
      terminal.open(terminalContainerRef.current);
      requestAnimationFrame(() => {
        fitAddon.fit();
      });
    } else {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
      });
    }
  }, [installing]);

  useEffect(() => {
    if (!installing) {
      return;
    }

    const terminal = terminalInstanceRef.current;
    if (!terminal) {
      return;
    }

    if (logs.length === 0) {
      writtenLogsRef.current = 0;
      terminal.reset();
      return;
    }

    for (let index = writtenLogsRef.current; index < logs.length; index += 1) {
      terminal.write(logs[index]);
    }
    writtenLogsRef.current = logs.length;
  }, [installing, logs]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-100">Install ESP-IDF</h2>
          <p className="text-sm text-slate-400">
            {status?.installed
              ? "ESP-IDF is installed and ready."
              : "We need to install the Espressif toolchain before building firmware."}
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-rose-500 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}

        {installing ? (
          <div className="space-y-2 rounded-md border border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-200">
            {stepLabel && <p className="text-xs uppercase tracking-wide text-slate-500">{stepLabel}</p>}
            <p>{message}</p>
            <div className="h-1 w-full overflow-hidden rounded bg-slate-800">
              <div
                className="h-full bg-sky-500 transition-all"
                style={{
                  width: progress?.total_steps
                    ? `${Math.min(100, Math.max(0, (progress.step / progress.total_steps) * 100))}%`
                    : "20%",
                }}
              />
            </div>
            <div className="h-44 overflow-hidden rounded-md border border-slate-800 bg-slate-950/80">
              <div ref={terminalContainerRef} className="h-full w-full" />
            </div>
          </div>
        ) : (
          <button
            onClick={onInstall}
            className="w-full rounded-md bg-sky-500 py-2 text-sm font-semibold text-slate-900 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:bg-sky-400 cursor-pointer"
          >
            Install ESP-IDF
          </button>
        )}
      </div>
    </div>
  );
}

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
        <h2 className="text-2xl font-semibold text-slate-100">Welcome to EMWaver IDE</h2>
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
