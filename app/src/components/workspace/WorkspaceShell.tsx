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

import { type FormEvent, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor as MonacoEditor, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { ensureEmwaverMonacoThemes, getEmwaverMonacoTheme } from "../../utils/monacoTheme";
import { isTauriAvailable, safeInvoke, safeListen } from "../../utils/tauri";
import { useDevice } from "../../utils/DeviceContext";
import { WaveletEngine, type WaveletTree } from "../../utils/WaveletEngine";
import { readWaveletsTabState, writeWaveletsTabState } from "../waveletsTabState";
import { useWorkspaceGit } from "./hooks/useWorkspaceGit";
import ExplorerTree from "./sidebar/ExplorerTree";
import GitSidebarPanel from "./sidebar/GitSidebarPanel";
import WaveletAssetsPanel from "./sidebar/WaveletAssetsPanel";
import WorkspaceTopBar from "./top/WorkspaceTopBar";
import GitDiffPanel from "./main/GitDiffPanel";
import WaveletPreviewPanel from "./main/WaveletPreviewPanel";
import WorkspaceBottomPanel from "./terminal/WorkspaceBottomPanel";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  FolderIcon,
  GitIcon,
  MinusIcon,
  PanelLeftIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  TerminalIcon,
  TrashIcon,
} from "./WorkspaceIcons";
import type {
  DirectoryChildEntry,
  GitDiffContents,
  GitRepoStatus,
  OpenFile,
  TerminalSession,
  ThemeMode,
} from "./workspaceTypes";
import {
  DEFAULT_TERMINAL_HEIGHT,
  DEFAULT_TERMINAL_LIST_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_COLLAPSE_THRESHOLD,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  TERMINAL_LIST_COLLAPSE_THRESHOLD,
  TERMINAL_LIST_MAX_WIDTH,
  TERMINAL_LIST_MIN_WIDTH,
  TERMINAL_MAX_HEIGHT,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_VIEW_MIN_WIDTH,
  clamp,
  storageKeys,
  readStoredRoot,
  readStoredSidebarCollapsed,
  readStoredSidebarWidth,
  readStoredTerminalHeight,
  readStoredTerminalListCollapsed,
  readStoredTerminalListWidth,
  readStoredAssetScriptsCollapsed,
} from "./workspaceStorage";
import {
  WAVELET_ASSET_SCRIPTS,
  WAVELET_ASSET_ROOT,
  WAVELET_BOOTSTRAP_FILENAME,
  basename,
  defaultIgnoredName,
  formatConsoleArgs,
  iconLabelForPath,
  isWaveletAssetPath,
  isWaveletScriptPath,
  languageForPath,
  nextTerminalTitle,
  readWaveletAssetScript,
  timestampLabel,
  waveletAssetPath,
} from "./workspaceUtils";

const DEFAULT_TERMINAL_TITLE = "zsh";

const FILE_AUTO_RELOAD_INTERVAL_MS = 2000;

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

let cachedTerminalSessionId: string | null = null;

export default function WorkspaceShell({
  theme = "dark",
  isActive = false,
}: {
  theme?: ThemeMode;
  isActive?: boolean;
}) {
  const keys = storageKeys();
  const tabStateFileName = "wavelets-tabs.json";
  const readTabState = readWaveletsTabState;
  const writeTabState = writeWaveletsTabState;

  const [rootDir, setRootDir] = useState<string | null>(() => readStoredRoot(keys));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [dirChildren, setDirChildren] = useState<Record<string, DirectoryChildEntry[]>>({});
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set());
  const [sidebarPanel, setSidebarPanel] = useState<"explorer" | "git">("explorer");
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const restoringTabsRef = useRef(false);
  const restoredTabsRootRef = useRef<string | null>(null);
  const tabsHydratedRef = useRef(false);
  const tabsRestoreSucceededRef = useRef(false);
  const tabsUserTouchedRef = useRef(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => readStoredSidebarCollapsed(keys));
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readStoredSidebarWidth(keys));
  const sidebarLastExpandedWidthRef = useRef<number>(readStoredSidebarWidth(keys));
  const openingFilePathsRef = useRef<Set<string>>(new Set());

  const {
    gitStatus,
    gitError,
    gitHasChecked,
    isGitLoading,
    isGitBusy,
    gitCommitMessage,
    setGitCommitMessage,
    gitSelectedDiff,
    setGitSelectedDiff,
    gitDiffContents,
    isGitDiffLoading,
    showGitNeedsInitIndicator,
    refreshGit,
    handleGitStage,
    handleGitUnstage,
    handleGitDiscard,
    handleGitCommit,
    handleGitPush,
    handleGitStageAll,
    handleGitUnstageAll,
  } = useWorkspaceGit(rootDir);

  const explorerResizeActiveRef = useRef(false);
  const explorerResizeStartXRef = useRef(0);
  const explorerResizeStartWidthRef = useRef(0);

  const [isTerminalVisible, setIsTerminalVisible] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState<number>(() => readStoredTerminalHeight(keys));
  const terminalResizeActiveRef = useRef(false);
  const terminalResizeStartYRef = useRef(0);
  const terminalResizeStartHeightRef = useRef(0);

  const [terminalListWidth, setTerminalListWidth] = useState<number>(() => readStoredTerminalListWidth(keys));
  const [isTerminalListCollapsed, setIsTerminalListCollapsed] = useState<boolean>(() =>
    readStoredTerminalListCollapsed(keys),
  );
  const terminalListLastExpandedWidthRef = useRef<number>(readStoredTerminalListWidth(keys));
  const terminalListResizeActiveRef = useRef(false);
  const terminalListResizeStartXRef = useRef(0);
  const terminalListResizeStartWidthRef = useRef(0);

  const [isAssetScriptsCollapsed, setIsAssetScriptsCollapsed] = useState<boolean>(() => readStoredAssetScriptsCollapsed(keys));

  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([]);
  const [activeTerminalSessionId, setActiveTerminalSessionId] = useState<string | null>(null);
  const [isTerminalPickerOpen, setIsTerminalPickerOpen] = useState(false);
  const terminalPickerAnchorRef = useRef<HTMLDivElement | null>(null);


  const sessionsRef = useRef<TerminalSession[]>([]);
  const didAutoStartTerminalRef = useRef(false);
  const terminalStartInFlightRef = useRef(false);
  const closingTerminalSessionsRef = useRef<Set<string>>(new Set());

  const terminalPanelRef = useRef<HTMLDivElement | null>(null);
  const terminalContainerBySessionRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const terminalBySessionRef = useRef<Map<string, Terminal>>(new Map());
  const fitAddonBySessionRef = useRef<Map<string, FitAddon>>(new Map());
  const pendingTerminalOutputRef = useRef<Map<string, Uint8Array[]>>(new Map());
  const outputDecoderRef = useRef(new TextDecoder());


  const monaco = useMonaco();
  const device = useDevice();

  useEffect(() => {
    if (!monaco) {
      return;
    }
    ensureEmwaverMonacoThemes(monaco);
    monaco.editor.setTheme(getEmwaverMonacoTheme(theme));
  }, [monaco, theme]);

  const [activeMainTabKind, setActiveMainTabKind] = useState<"file" | "preview">("file");
  const [activePreviewPath, setActivePreviewPath] = useState<string | null>(null);
  const [waveletPreviewTabs, setWaveletPreviewTabs] = useState<string[]>([]);
  const [waveletPreviewState, setWaveletPreviewState] = useState<
    Record<
      string,
      {
        tree: WaveletTree | null;
        console: string[];
        isRunning: boolean;
      }
    >
  >({});
  const waveletEngineByPathRef = useRef<Map<string, WaveletEngine>>(new Map());
  const waveletBootstrapRef = useRef<string | null>(null);
  const waveletDeviceRef = useRef(device);
  const waveletCommandQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    waveletDeviceRef.current = device;
  }, [device]);

  const waveletDeviceConnection = useMemo(
    () => ({
      sendCommandString: (command: string, timeoutMs: number = 1500) => {
        const queued = waveletCommandQueueRef.current
          .then(async () => {
            const { status, send } = waveletDeviceRef.current;
            if (!status.connected) {
              return null;
            }
            const response = await send(command, timeoutMs, 1);
            await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
            return response;
          })
          .catch(async () => null);

        waveletCommandQueueRef.current = queued.then(
          () => undefined,
          () => undefined,
        );
        return queued as Promise<Uint8Array | null>;
      },
      sendPacket: (data: Uint8Array, timeoutMs: number = 1500) => {
        const queued = waveletCommandQueueRef.current
          .then(async () => {
            const { status, sendPacket } = waveletDeviceRef.current;
            if (!status.connected) {
              return null;
            }
            const response = await sendPacket(data, timeoutMs, 1);
            await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
            return response;
          })
          .catch(async () => null);

        waveletCommandQueueRef.current = queued.then(
          () => undefined,
          () => undefined,
        );
        return queued as Promise<Uint8Array | null>;
      },
      write: (data: Uint8Array) => {
        const { status, sendPacket } = waveletDeviceRef.current;
        if (!status.connected) {
          return;
        }
        const queued = waveletCommandQueueRef.current
          .then(async () => {
            await sendPacket(data, 1500, 1);
            await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
          })
          .catch(async () => undefined);
        waveletCommandQueueRef.current = queued.then(
          () => undefined,
          () => undefined,
        );
      },
      connectionStatus: () => {
        const { status } = waveletDeviceRef.current;
        if (!status.connected) {
          return "disconnected";
        }
        return `${status.transport ?? "unknown"} connected`;
      },
    }),
    [],
  );

  const waveletUtilsBinding = useMemo(
    () => ({
      delay: (ms: number) => {
        const durationMs = Math.max(0, Number(ms) || 0);
        const start = Date.now();
        while (Date.now() - start < durationMs) {
          // busy-wait (matches current mobile wavelet semantics)
        }
      },
    }),
    [],
  );

  const waveletCreateByteArray = useMemo(() => (bytes: number[]) => new Uint8Array(bytes), []);

  const explorerRoot = useMemo(() => (rootDir ? rootDir.replace(/\\/g, "/") : null), [rootDir]);
  const activeTerminalTitle = useMemo(
    () => terminalSessions.find((session) => session.id === activeTerminalSessionId)?.title ?? DEFAULT_TERMINAL_TITLE,
    [activeTerminalSessionId, terminalSessions],
  );
  const activeFile = useMemo(() => {
    if (!activeFilePath) {
      return null;
    }
    return openFiles.find((file) => file.path === activeFilePath) ?? null;
  }, [activeFilePath, openFiles]);

  const editorOptions = useMemo(() => {
    if (!activeFile) {
      return MONACO_EDITOR_OPTIONS;
    }
    if (activeFile.source === "asset") {
      return { ...MONACO_EDITOR_OPTIONS, readOnly: true };
    }
    return MONACO_EDITOR_OPTIONS;
  }, [activeFile]);

  const waveletTargetPath = useMemo(() => activeFilePath ?? selectedPath ?? null, [activeFilePath, selectedPath]);
  const canRunWavelet = useMemo(() => {
    const candidatePath = (activeMainTabKind === "preview" ? activePreviewPath : waveletTargetPath) ?? null;
    if (!candidatePath) {
      return false;
    }
    const normalizedPath = candidatePath.replace(/\\/g, "/");
    if (!isWaveletScriptPath(normalizedPath)) {
      return false;
    }
    if (isWaveletAssetPath(normalizedPath)) {
      return true;
    }
    return Boolean(rootDir);
  }, [activeMainTabKind, activePreviewPath, rootDir, waveletTargetPath]);


  const openFilesRef = useRef<OpenFile[]>(openFiles);
  useEffect(() => {
    openFilesRef.current = openFiles;
  }, [openFiles]);

  useEffect(() => {
    if (!isTauriAvailable() || typeof window === "undefined") {
      return;
    }

    let canceled = false;
    let inFlight = false;

    const tick = async () => {
      if (canceled || inFlight) {
        return;
      }

      const snapshot = openFilesRef.current;
      const candidates = snapshot.filter((file) => !file.isDirty && file.source !== "asset");
      if (candidates.length === 0) {
        return;
      }

      inFlight = true;
      try {
        const mtimes = await Promise.all(
          candidates.map((file) =>
            safeInvoke<number>("file_modified_ms", { payload: { path: file.path } })
              .then((value) => value ?? undefined)
              .catch(() => undefined),
          ),
        );

        const initMtimes = new Map<string, number>();
        const reloads: Array<{ path: string; mtime: number }> = [];

        candidates.forEach((file, idx) => {
          const mtime = mtimes[idx];
          if (mtime == null) {
            return;
          }
          if (file.diskMtimeMs == null) {
            initMtimes.set(file.path, mtime);
            return;
          }
          if (mtime !== file.diskMtimeMs) {
            reloads.push({ path: file.path, mtime });
          }
        });

        const contents = await Promise.all(
          reloads.map((entry) => safeInvoke<string>("read_file", { payload: { path: entry.path } }).catch(() => null)),
        );

        if (reloads.length === 0 && initMtimes.size === 0) {
          return;
        }

        setOpenFiles((prev) =>
          prev.map((file) => {
            const initMtime = initMtimes.get(file.path);
            if (initMtime != null && file.diskMtimeMs == null) {
              return { ...file, diskMtimeMs: initMtime };
            }

            const reloadIndex = reloads.findIndex((entry) => entry.path === file.path);
            if (reloadIndex === -1) {
              return file;
            }

            if (file.isDirty) {
              return file;
            }

            const content = contents[reloadIndex];
            if (content == null) {
              return file;
            }

            return { ...file, content, isDirty: false, diskMtimeMs: reloads[reloadIndex].mtime };
          }),
        );
      } finally {
        inFlight = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void tick();
    }, FILE_AUTO_RELOAD_INTERVAL_MS);

    void tick();

    return () => {
      canceled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    sessionsRef.current = terminalSessions;
  }, [terminalSessions]);



  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(keys.sidebarCollapsed, String(isSidebarCollapsed));
    if (keys.legacy?.sidebarCollapsed) {
      window.localStorage.removeItem(keys.legacy.sidebarCollapsed);
    }
  }, [isSidebarCollapsed]);

  useEffect(() => {
    if (!isTerminalPickerOpen) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      const anchor = terminalPickerAnchorRef.current;
      if (!anchor) {
        setIsTerminalPickerOpen(false);
        return;
      }
      if (event.target instanceof Node && anchor.contains(event.target)) {
        return;
      }
      setIsTerminalPickerOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsTerminalPickerOpen(false);
      }
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isTerminalPickerOpen]);



  useEffect(() => {
    const unlistenPromise = safeListen<{ session_id: string; data: number[] }>("pty-output", (event) => {
      const payload = event.payload;
      if (!payload) {
        return;
      }
      if (closingTerminalSessionsRef.current.has(payload.session_id)) {
        pendingTerminalOutputRef.current.delete(payload.session_id);
        return;
      }
      const bytes = new Uint8Array(payload.data);
      const decoder = outputDecoderRef.current;

      const terminal = terminalBySessionRef.current.get(payload.session_id);
      if (terminal) {
        terminal.write(decoder.decode(bytes, { stream: true }));
        return;
      }
      if (!sessionsRef.current.some((session) => session.id === payload.session_id)) {
        return;
      }
      const buffers = pendingTerminalOutputRef.current.get(payload.session_id) ?? [];
      buffers.push(bytes);
      pendingTerminalOutputRef.current.set(payload.session_id, buffers);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const ensureSessionTerminal = useCallback(
    (sessionId: string) => {
      if (!isTauriAvailable()) {
        return;
      }

      const container = terminalContainerBySessionRef.current.get(sessionId);
      if (!container) {
        return;
      }

      if (terminalBySessionRef.current.has(sessionId)) {
        return;
      }

      const isLight = theme === "light";
      const terminal = new Terminal({
        cursorBlink: true,
        fontFamily: '"Fira Code", "SF Mono", Menlo, Monaco, "Courier New", monospace',
        fontSize: 13,
        theme: isLight
          ? {
              background: "#f8fafc",
              foreground: "#0f172a",
              cursor: "#0ea5e9",
            }
          : {
              background: "#020617",
              foreground: "#e2e8f0",
              cursor: "#38bdf8",
            },
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);

      terminal.onData((data) => {
        void safeInvoke<void>("pty_write", {
          payload: {
            session_id: sessionId,
            data,
          },
        });
      });

      terminalBySessionRef.current.set(sessionId, terminal);
      fitAddonBySessionRef.current.set(sessionId, fitAddon);

      const pending = pendingTerminalOutputRef.current.get(sessionId);
      if (pending && pending.length > 0) {
        pendingTerminalOutputRef.current.delete(sessionId);
        for (const chunk of pending) {
          terminal.write(outputDecoderRef.current.decode(chunk, { stream: true }));
        }
      }

      requestAnimationFrame(() => {
        fitAddon.fit();
        void safeInvoke<void>("pty_resize", {
          payload: {
            session_id: sessionId,
            cols: terminal.cols,
            rows: terminal.rows,
          },
        });
      });
    },
    [theme],
  );

  const focusActiveTerminal = useCallback(() => {
    if (!activeTerminalSessionId) {
      return;
    }
    terminalBySessionRef.current.get(activeTerminalSessionId)?.focus();
  }, [activeTerminalSessionId]);

  const closeTerminalSession = useCallback(
    async (sessionId: string) => {
      if (!isTauriAvailable()) {
        return;
      }

      closingTerminalSessionsRef.current.add(sessionId);
      try {
        await safeInvoke<void>("pty_stop", {
          payload: {
            session_id: sessionId,
          },
        });
      } finally {
        terminalBySessionRef.current.get(sessionId)?.dispose();
        fitAddonBySessionRef.current.get(sessionId)?.dispose();
        terminalBySessionRef.current.delete(sessionId);
        fitAddonBySessionRef.current.delete(sessionId);
        pendingTerminalOutputRef.current.delete(sessionId);
        terminalContainerBySessionRef.current.delete(sessionId);
        closingTerminalSessionsRef.current.delete(sessionId);

        setTerminalSessions((prev) => {
          const next = prev.filter((session) => session.id !== sessionId);
          setActiveTerminalSessionId((current) => {
            if (current !== sessionId) {
              return current;
            }
            return next.length > 0 ? next[next.length - 1].id : null;
          });
          return next;
        });
      }
    },
    [],
  );

  const startTerminalSession = useCallback(
    async ({ makeActive }: { makeActive: boolean }) => {
      if (!isTauriAvailable()) {
        return null;
      }
      if (terminalStartInFlightRef.current) {
        return null;
      }

      terminalStartInFlightRef.current = true;
      try {
        const response = await safeInvoke<{ session_id: string }>("pty_start", {
          payload: {
            cwd: rootDir,
            cols: 120,
            rows: 30,
          },
        });
        if (!response?.session_id) {
          return null;
        }

        const sessionId = response.session_id;
        const title = nextTerminalTitle(terminalSessions, DEFAULT_TERMINAL_TITLE);

        setTerminalSessions((prev) => [...prev, { id: sessionId, title, createdAt: Date.now() }]);
        if (makeActive) {
          setActiveTerminalSessionId(sessionId);
          setIsTerminalVisible(true);
          setIsTerminalPickerOpen(false);
          requestAnimationFrame(() => {
            ensureSessionTerminal(sessionId);
            terminalBySessionRef.current.get(sessionId)?.focus();
          });
        }

        return sessionId;
      } finally {
        terminalStartInFlightRef.current = false;
      }
    },
    [ensureSessionTerminal, rootDir, terminalSessions],
  );

  useEffect(() => {
    if (!isTerminalVisible) {
      return;
    }
    const sessionId = activeTerminalSessionId;
    if (!sessionId) {
      return;
    }
    ensureSessionTerminal(sessionId);

    const terminal = terminalBySessionRef.current.get(sessionId);
    const fitAddon = fitAddonBySessionRef.current.get(sessionId);
    if (!terminal || !fitAddon) {
      return;
    }

    requestAnimationFrame(() => {
      fitAddon.fit();
      void safeInvoke<void>("pty_resize", {
        payload: {
          session_id: sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        },
      });
    });
  }, [activeTerminalSessionId, ensureSessionTerminal, isTerminalVisible, terminalHeight, terminalListWidth]);

	  useEffect(() => {
	    const handler = (event: KeyboardEvent) => {
	      const isToggle = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "j";
	      if (!isToggle) {
	        return;
	      }
	      event.preventDefault();
	      setIsTerminalVisible((prev) => {
	        const next = !prev;
	        if (next && terminalSessions.length === 0 && !terminalStartInFlightRef.current) {
	          void startTerminalSession({ makeActive: true });
	        }
	        return next;
	      });
	    };
	    window.addEventListener("keydown", handler);
	    return () => window.removeEventListener("keydown", handler);
	  }, [startTerminalSession, terminalSessions.length]);

  useEffect(() => {
    return () => {
      // Intentionally keep PTYs alive across IDE fragment remounts so sourced env stays warm.
      terminalBySessionRef.current.forEach((terminal) => terminal.dispose());
      fitAddonBySessionRef.current.forEach((addon) => addon.dispose());
      terminalBySessionRef.current.clear();
      fitAddonBySessionRef.current.clear();
      terminalContainerBySessionRef.current.clear();
      pendingTerminalOutputRef.current.clear();
    };
  }, []);

  const loadDirectoryChildren = useCallback(
    async (dir: string) => {
      if (!isTauriAvailable()) {
        return;
      }

      const entries = await safeInvoke<DirectoryChildEntry[]>("read_directory_children", {
        payload: { path: dir },
      });

      const normalized = (entries || []).filter((entry) => !defaultIgnoredName(entry.name));
      normalized.sort((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === "directory" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      setDirChildren((prev) => ({ ...prev, [dir]: normalized }));
    },
    [],
  );

  const ensureRootLoaded = useCallback(async () => {
    if (!explorerRoot) {
      return;
    }
    if (dirChildren[explorerRoot]) {
      return;
    }
    await loadDirectoryChildren(explorerRoot);
    setOpenDirs((prev) => {
      const next = new Set(prev);
      next.add(explorerRoot);
      return next;
    });
  }, [dirChildren, explorerRoot, loadDirectoryChildren]);

  useEffect(() => {
    void ensureRootLoaded();
  }, [ensureRootLoaded]);

  const openRoot = useCallback((nextRoot: string | null) => {
    setRootDir(nextRoot);
    setSelectedPath(null);
    setOpenFiles([]);
    setActiveFilePath(null);
    setActiveMainTabKind("file");
    setActivePreviewPath(null);
    setWaveletPreviewTabs([]);
    setWaveletPreviewState({});
    waveletEngineByPathRef.current.forEach((engine) => engine.shutdown());
    waveletEngineByPathRef.current.clear();
    setDirChildren({});
    setOpenDirs(new Set());
    setSidebarPanel("explorer");
    setGitSelectedDiff(null);
    setGitCommitMessage("");
  }, []);

  const handlePickFolder = useCallback(async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Open Folder",
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    openRoot(selected);
  }, [openRoot]);

  const handleCloseFolder = useCallback(() => {
    openRoot(null);
  }, [openRoot]);


  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
		      if (!explorerResizeActiveRef.current) {
		        return;
		      }
		      const delta = event.clientX - explorerResizeStartXRef.current;
		      const rawWidth = explorerResizeStartWidthRef.current + delta;
		      if (rawWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
		        explorerResizeActiveRef.current = false;
		        document.body.style.cursor = "";
		        document.body.style.userSelect = "";
		        setIsSidebarCollapsed(true);
		        return;
		      }
	      setIsSidebarCollapsed(false);
	      setSidebarWidth(clamp(rawWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
	    };

    const handleUp = () => {
      if (!explorerResizeActiveRef.current) {
        return;
      }
      explorerResizeActiveRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!terminalResizeActiveRef.current) {
        return;
      }
      const delta = terminalResizeStartYRef.current - event.clientY;
      setTerminalHeight(clamp(terminalResizeStartHeightRef.current + delta, TERMINAL_MIN_HEIGHT, TERMINAL_MAX_HEIGHT));
    };

    const handleUp = () => {
      if (!terminalResizeActiveRef.current) {
        return;
      }
      terminalResizeActiveRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!terminalListResizeActiveRef.current) {
        return;
      }
      const delta = terminalListResizeStartXRef.current - event.clientX;
      const rawWidth = terminalListResizeStartWidthRef.current + delta;
      if (rawWidth < TERMINAL_LIST_COLLAPSE_THRESHOLD) {
        terminalListResizeActiveRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setIsTerminalListCollapsed(true);
        return;
      }
      setIsTerminalListCollapsed(false);
      setTerminalListWidth(clamp(rawWidth, TERMINAL_LIST_MIN_WIDTH, TERMINAL_LIST_MAX_WIDTH));
    };

    const handleUp = () => {
      if (!terminalListResizeActiveRef.current) {
        return;
      }
      terminalListResizeActiveRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  const handleToggleDir = useCallback(
    async (dir: string) => {
      setOpenDirs((prev) => {
        const next = new Set(prev);
        if (next.has(dir)) {
          next.delete(dir);
        } else {
          next.add(dir);
        }
        return next;
      });

      if (!dirChildren[dir]) {
        await loadDirectoryChildren(dir);
      }
    },
    [dirChildren, loadDirectoryChildren],
  );

  const handleOpenFile = useCallback(async (path: string) => {
    tabsUserTouchedRef.current = true;
    const normalizedPath = path.replace(/\\/g, "/");
    const isAssetPath = normalizedPath.startsWith(`${WAVELET_ASSET_ROOT}/`);
    const effectivePath = isAssetPath ? normalizedPath : path;
    setActiveMainTabKind("file");
    setActivePreviewPath(null);
    setSelectedPath(effectivePath);
    setActiveFilePath(effectivePath);
    setGitSelectedDiff(null);
    if (openFiles.some((file) => file.path === effectivePath)) {
      return;
    }
    if (openingFilePathsRef.current.has(effectivePath)) {
      return;
    }
    openingFilePathsRef.current.add(effectivePath);
    setIsLoadingFile(true);
    try {
      if (isAssetPath) {
        const filename = basename(effectivePath);
        const content = await readWaveletAssetScript(filename);
        const next: OpenFile = {
          path: effectivePath,
          name: filename,
          content: content ?? "",
          language: languageForPath(filename),
          isDirty: false,
          source: "asset",
        };
        setOpenFiles((prev) => (prev.some((file) => file.path === effectivePath) ? prev : [...prev, next]));
        return;
      }

      if (!isTauriAvailable()) {
        return;
      }

      const [content, diskMtimeMs] = await Promise.all([
        safeInvoke<string>("read_file", { payload: { path } }),
        safeInvoke<number>("file_modified_ms", { payload: { path } })
          .then((value) => value ?? undefined)
          .catch(() => undefined),
      ]);
      const next: OpenFile = {
        path,
        name: basename(path),
        content: content ?? "",
        language: languageForPath(path),
        isDirty: false,
        diskMtimeMs,
        source: "disk",
      };
      setOpenFiles((prev) => (prev.some((file) => file.path === path) ? prev : [...prev, next]));
    } finally {
      openingFilePathsRef.current.delete(effectivePath);
      setIsLoadingFile(false);
    }
  }, [openFiles]);

  const openWaveletPreviewTab = useCallback(
    async (path: string, { activate }: { activate: boolean }) => {
      await handleOpenFile(path);
      setWaveletPreviewTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
      if (activate) {
        setActiveMainTabKind("preview");
        setActivePreviewPath(path);
      }
    },
    [handleOpenFile],
  );

  const closeWaveletPreviewTab = useCallback(
    (path: string) => {
      setWaveletPreviewTabs((prev) => prev.filter((entry) => entry !== path));
      setWaveletPreviewState((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
      const engine = waveletEngineByPathRef.current.get(path);
      if (engine) {
        engine.shutdown();
        waveletEngineByPathRef.current.delete(path);
      }
      setActivePreviewPath((prev) => (prev === path ? null : prev));
      setActiveMainTabKind((prev) => {
        if (prev !== "preview") {
          return prev;
        }
        if (activePreviewPath !== path) {
          return prev;
        }
        return "file";
      });
    },
    [activePreviewPath],
  );

  const closeFile = useCallback((path: string) => {
    tabsUserTouchedRef.current = true;
    setOpenFiles((prev) => {
      const next = prev.filter((file) => file.path !== path);
      setActiveFilePath((prevActive) => {
        if (prevActive !== path) {
          return prevActive;
        }
        return next.length > 0 ? next[next.length - 1].path : null;
      });
      setSelectedPath((prevSelected) => {
        if (prevSelected !== path) {
          return prevSelected;
        }
        return next.length > 0 ? next[next.length - 1].path : null;
      });
      return next;
    });
    closeWaveletPreviewTab(path);
  }, [closeWaveletPreviewTab]);

  const runWaveletForPath = useCallback(
    async (path: string) => {

      const normalizedPath = path.replace(/\\/g, "/");
      const isAssetPath = isWaveletAssetPath(normalizedPath);
      if (!isWaveletScriptPath(normalizedPath)) {
        return;
      }
      if (!rootDir && !isAssetPath) {
        return;
      }

      const normalizedRoot = rootDir ? rootDir.replace(/\\/g, "/").replace(/\/$/, "") : null;

      setWaveletPreviewState((prev) => ({
        ...prev,
        [normalizedPath]: {
          tree: prev[normalizedPath]?.tree ?? null,
          console: [],
          isRunning: true,
        },
      }));

      if (!waveletBootstrapRef.current) {
        waveletBootstrapRef.current = await readWaveletAssetScript(WAVELET_BOOTSTRAP_FILENAME);
      }

      let engine = waveletEngineByPathRef.current.get(normalizedPath);
      if (!engine) {
        engine = new WaveletEngine();
        const bootstrap = waveletBootstrapRef.current ?? "";
        engine.setBootstrapSource(bootstrap);
        engine.setup(
          (message: string) => {
            setWaveletPreviewState((prev) => ({
              ...prev,
              [normalizedPath]: {
                tree: prev[normalizedPath]?.tree ?? null,
                console: [...(prev[normalizedPath]?.console ?? []), String(message)],
                isRunning: prev[normalizedPath]?.isRunning ?? false,
              },
            }));
          },
          (tree: WaveletTree) => {
            setWaveletPreviewState((prev) => ({
              ...prev,
              [normalizedPath]: {
                tree,
                console: prev[normalizedPath]?.console ?? [],
                isRunning: prev[normalizedPath]?.isRunning ?? false,
              },
            }));
          },
          (title: string, message: string) => {
            alert(`${title}\n\n${message}`);
          },
          {
            DeviceConnection: waveletDeviceConnection,
            Utils: waveletUtilsBinding,
            createByteArray: waveletCreateByteArray,
          },
        );
        waveletEngineByPathRef.current.set(normalizedPath, engine);
      }

      const moduleSources: Record<string, string> = {};
      const assetScripts = await Promise.all(WAVELET_ASSET_SCRIPTS.map(async (name) => [name, await readWaveletAssetScript(name)] as const));
      assetScripts.forEach(([name, content]) => {
        if (content) {
          moduleSources[name] = content;
        }
      });

      const openFileSnapshot = openFilesRef.current;
      const openFileByPath = new Map(openFileSnapshot.map((file) => [file.path, file] as const));

      const maxFiles = 200;
      const filePaths: string[] = [];

      if (rootDir && isTauriAvailable()) {
        const queue: string[] = [rootDir];
        const visited = new Set<string>();

        while (queue.length > 0 && filePaths.length < maxFiles) {
          const current = queue.shift();
          if (!current || visited.has(current)) {
            continue;
          }
          visited.add(current);
          const entries = await safeInvoke<DirectoryChildEntry[]>("read_directory_children", {
            payload: { path: current },
          });
          for (const entry of (entries ?? []).filter((child) => !defaultIgnoredName(child.name))) {
            const entryPath = entry.path;
            if (entry.kind === "directory") {
              queue.push(entryPath);
              continue;
            }
            if (!isWaveletScriptPath(entryPath)) {
              continue;
            }
            filePaths.push(entryPath);
            if (filePaths.length >= maxFiles) {
              break;
            }
          }
        }
      }

      for (const filePath of filePaths) {
        const normalizedFilePath = filePath.replace(/\\/g, "/");
        const relative = normalizedRoot && normalizedFilePath.startsWith(`${normalizedRoot}/`)
          ? normalizedFilePath.slice(`${normalizedRoot}/`.length)
          : basename(filePath);

        const openFile = openFileByPath.get(filePath);
        const content =
          openFile?.content ??
          (!isTauriAvailable() ? "" : (await safeInvoke<string>("read_file", { payload: { path: filePath } })) ?? "");
        if (!content) {
          continue;
        }
        moduleSources[relative] = content;
        const shortName = basename(relative);
        if (!moduleSources[shortName]) {
          moduleSources[shortName] = content;
        }
      }

      engine.updateModuleSources(moduleSources);

      const entryFile = openFileByPath.get(normalizedPath);
      const entrySource =
        entryFile?.content ??
        (isAssetPath
          ? await readWaveletAssetScript(basename(normalizedPath))
          : !isTauriAvailable()
            ? ""
            : (await safeInvoke<string>("read_file", { payload: { path: normalizedPath } })) ?? "");
      engine.execute(entrySource, () => {
        setWaveletPreviewState((prev) => ({
          ...prev,
          [normalizedPath]: {
            tree: prev[normalizedPath]?.tree ?? null,
            console: [...(prev[normalizedPath]?.console ?? []), "Wavelet execution completed."],
            isRunning: false,
          },
        }));
      });

      setWaveletPreviewState((prev) => ({
        ...prev,
        [normalizedPath]: {
          tree: prev[normalizedPath]?.tree ?? null,
          console: prev[normalizedPath]?.console ?? [],
          isRunning: false,
        },
      }));
    },
    [rootDir, waveletCreateByteArray, waveletDeviceConnection, waveletUtilsBinding],
  );

  const handleSaveFile = useCallback(async () => {
    if (!activeFile || !isTauriAvailable()) {
      return;
    }
    if (activeFile.source === "asset") {
      return;
    }
    if (!activeFile.isDirty) {
      return;
    }

    setIsSaving(true);
    try {
      await safeInvoke<void>("write_file", { payload: { path: activeFile.path, content: activeFile.content } });
      const diskMtimeMs = await safeInvoke<number>("file_modified_ms", { payload: { path: activeFile.path } })
        .then((value) => value ?? undefined)
        .catch(() => undefined);
      setOpenFiles((prev) =>
        prev.map((file) => (file.path === activeFile.path ? { ...file, isDirty: false, diskMtimeMs } : file)),
      );
      void refreshGit();
    } finally {
      setIsSaving(false);
    }
  }, [activeFile, refreshGit]);

  useEffect(() => {
    const unlistenTogglePromise = safeListen("menu-toggle-explorer", () => {
      setIsSidebarCollapsed((prev) => !prev);
    });
    const unlistenShowPromise = safeListen("menu-show-explorer", () => {
      setIsSidebarCollapsed(false);
    });
    const unlistenCloseFolderPromise = safeListen("menu-close-folder", () => {
      handleCloseFolder();
    });
    const unlistenOpenFolderPromise = safeListen("menu-open-folder", () => {
      void handlePickFolder();
    });
    const unlistenSavePromise = safeListen("menu-save-file", () => {
      void handleSaveFile();
    });

    return () => {
      void unlistenTogglePromise.then((unlisten) => unlisten());
      void unlistenShowPromise.then((unlisten) => unlisten());
      void unlistenCloseFolderPromise.then((unlisten) => unlisten());
      void unlistenOpenFolderPromise.then((unlisten) => unlisten());
      void unlistenSavePromise.then((unlisten) => unlisten());
    };
  }, [handleCloseFolder, handlePickFolder, handleSaveFile]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!activeFile) {
        return;
      }
      const isClose = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w";
      const isSave = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
      if (isClose) {
        event.preventDefault();
        closeFile(activeFile.path);
        return;
      }
      if (!isSave) {
        return;
      }
      event.preventDefault();
      void handleSaveFile();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeFile, closeFile, handleSaveFile]);

  const handleToggleTerminalVisible = useCallback(() => {
    setIsTerminalVisible((prev) => {
      const next = !prev;
      if (next && terminalSessions.length === 0 && !terminalStartInFlightRef.current) {
        void startTerminalSession({ makeActive: true });
      }
      return next;
    });
  }, [startTerminalSession, terminalSessions.length]);

  const handleTerminalResizeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      terminalResizeActiveRef.current = true;
      terminalResizeStartYRef.current = event.clientY;
      terminalResizeStartHeightRef.current = terminalHeight;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [terminalHeight],
  );

  const handleTerminalListResizeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      setIsTerminalListCollapsed(false);
      terminalListResizeActiveRef.current = true;
      terminalListResizeStartXRef.current = event.clientX;
      terminalListResizeStartWidthRef.current = terminalListWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [terminalListWidth],
  );

  const handleExpandTerminalList = useCallback(() => {
    setIsTerminalListCollapsed(false);
    setTerminalListWidth(clamp(terminalListLastExpandedWidthRef.current, TERMINAL_LIST_MIN_WIDTH, TERMINAL_LIST_MAX_WIDTH));
  }, []);


  return (
    <div className="flex h-full min-h-0 select-none flex-col bg-slate-950 text-slate-100">
      {false ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <div className="mx-auto mb-6 h-24 w-24 overflow-hidden rounded-full bg-slate-900/60 shadow-2xl shadow-sky-500/20 ring-2 ring-sky-500/40">
            <img src="/emwaver-logo.png" alt="EMWaver" className="h-full w-full object-contain p-4" />
          </div>
          <h2 className="text-2xl font-semibold text-slate-100">
            Open a wavelet project
          </h2>
          <p className="mt-2 max-w-lg text-sm text-slate-400">Wavelets needs a folder to browse, edit, run, and preview wavelets.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => void handlePickFolder()}
              className="min-w-[160px] rounded-md border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-900 hover:text-sky-200 cursor-pointer"
            >
              Open Folder…
            </button>
          </div>
        </div>
      ) : (

	      <div className="flex min-h-0 flex-1 overflow-hidden">
		        {isSidebarCollapsed ? (
              <div className="flex w-9 shrink-0 flex-col border-r border-slate-900 bg-slate-950">
                <button
                  type="button"
                  onClick={() => {
                    setSidebarPanel("explorer");
                    setSidebarWidth((prev) => (prev > 0 ? prev : sidebarLastExpandedWidthRef.current));
                    setIsSidebarCollapsed(false);
                  }}
                  className={`flex h-9 items-center justify-center text-slate-500 hover:bg-slate-900/30 hover:text-slate-200 ${
                    sidebarPanel === "explorer" ? "bg-slate-900/50 text-slate-200" : ""
                  }`}
                  title="Show Explorer (Cmd/Ctrl+B)"
                >
                  <FolderIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSidebarPanel("git");
                    setSidebarWidth((prev) => (prev > 0 ? prev : sidebarLastExpandedWidthRef.current));
                    setIsSidebarCollapsed(false);
                  }}
                  className={`relative flex h-9 items-center justify-center text-slate-500 hover:bg-slate-900/30 hover:text-slate-200 ${
                    sidebarPanel === "git" ? "bg-slate-900/50 text-slate-200" : ""
                  }`}
                  title="Show Source Control"
                >
                  <GitIcon className="h-4 w-4" />
                </button>
              </div>
	        ) : (
	          <>
	            <aside className="shrink-0 border-r border-slate-900" style={{ width: sidebarWidth }}>
	              <div className="flex h-full min-h-0 flex-col">
                  <div className="border-b border-slate-900 px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 cursor-default">
                        <h2
                          className="truncate text-sm font-semibold text-slate-200"
                          title={
                            sidebarPanel === "explorer"
                              ? rootDir ?? "Wavelets"
                              : "Source Control"
                          }
                        >
                          {sidebarPanel === "explorer"
                            ? rootDir
                              ? basename(rootDir)
                              : "WAVELETS"
                            : "SOURCE CONTROL"}
                        </h2>
                        {sidebarPanel === "git" ? <p className="mt-1 text-[11px] text-slate-500">Git</p> : null}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setSidebarPanel("explorer")}
                          className={`rounded p-1.5 ${
                            sidebarPanel === "explorer"
                              ? "bg-slate-900/60 text-slate-200"
                              : "text-slate-500 hover:bg-slate-900/60 hover:text-slate-200"
                          }`}
                          title="Explorer"
                        >
                          <FolderIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setSidebarPanel("git")}
                          className={`rounded p-1.5 ${
                            sidebarPanel === "git"
                              ? "bg-slate-900/60 text-slate-200"
                              : "text-slate-500 hover:bg-slate-900/60 hover:text-slate-200"
                          }`}
                          title="Source Control"
                        >
                          <GitIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsSidebarCollapsed(true)}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-900/60 hover:text-slate-200"
                          title="Hide Sidebar (Cmd/Ctrl+B)"
                        >
                          <PanelLeftIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto p-2">
                    {sidebarPanel === "explorer" ? (
                      <div className="space-y-2">
                        {!rootDir ? (
                          <button
                            type="button"
                            onClick={() => void handlePickFolder()}
                            className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900"
                            title="Open Folder"
                          >
                            Open Folder…
                          </button>
                        ) : null}
                        <ExplorerTree
                          root={explorerRoot}
                          dirChildren={dirChildren}
                          openDirs={openDirs}
                          selectedPath={selectedPath}
                          onToggleDir={handleToggleDir}
                          onOpenFile={handleOpenFile}
                        />
                      </div>
                    ) : (
                      <GitSidebarPanel
                        rootDir={rootDir}
                        gitStatus={gitStatus}
                        gitError={gitError}
                        gitHasChecked={gitHasChecked}
                        isGitLoading={isGitLoading}
                        isGitBusy={isGitBusy}
                        showGitNeedsInitIndicator={showGitNeedsInitIndicator}
                        gitCommitMessage={gitCommitMessage}
                        onCommitMessageChange={setGitCommitMessage}
                        gitSelectedDiff={gitSelectedDiff}
                        onSelectDiff={setGitSelectedDiff}
                        onRefresh={refreshGit}
                        onStage={handleGitStage}
                        onUnstage={handleGitUnstage}
                        onDiscard={handleGitDiscard}
                        onCommit={handleGitCommit}
                        onPush={handleGitPush}
                        onStageAll={handleGitStageAll}
                        onUnstageAll={handleGitUnstageAll}
                      />
                    )}
                  </div>

                  {
                    <div className="border-t border-slate-900 bg-slate-950 p-2">
                      <WaveletAssetsPanel
                        isCollapsed={isAssetScriptsCollapsed}
                        onToggleCollapsed={() => setIsAssetScriptsCollapsed((prev) => !prev)}
                        onOpenAsset={(filename) => handleOpenFile(waveletAssetPath(filename))}
                      />
                    </div>
                  }
                </div>
	            </aside>

	            <div
	              role="separator"
	              aria-orientation="vertical"
	              title="Drag to resize explorer"
	              onDoubleClick={() => setIsSidebarCollapsed(true)}
	              onMouseDown={(event) => {
	                setIsSidebarCollapsed(false);
	                explorerResizeActiveRef.current = true;
	                explorerResizeStartXRef.current = event.clientX;
	                explorerResizeStartWidthRef.current = sidebarWidth;
	                document.body.style.cursor = "col-resize";
	                document.body.style.userSelect = "none";
	              }}
	              className="group relative w-2 shrink-0 cursor-col-resize bg-transparent hover:bg-slate-800/20"
	            >
	              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-900/60 group-hover:bg-slate-700/80" />
	            </div>
	          </>
	        )}

	        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <WorkspaceTopBar
            theme={theme}
            openFiles={openFiles}
            activeFilePath={activeFilePath}
            activeFileIsDirty={activeFile?.isDirty ?? false}
            isLoadingFile={isLoadingFile}
            activeMainTabKind={activeMainTabKind}
            activePreviewPath={activePreviewPath}
            waveletPreviewTabs={waveletPreviewTabs}
            onSelectFile={(path) => {
              setActiveMainTabKind("file");
              setActivePreviewPath(null);
              setActiveFilePath(path);
              setSelectedPath(path);
            }}
            onCloseFile={closeFile}
            onSelectPreview={(path) => {
              setActiveMainTabKind("preview");
              setActivePreviewPath(path);
              setGitSelectedDiff(null);
            }}
            onClosePreview={closeWaveletPreviewTab}
            rightActions={
              <>
                {activeMainTabKind !== "preview" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const target = waveletTargetPath;
                        if (!target) return;
                        void (async () => {
                          await openWaveletPreviewTab(target, { activate: true });
                          await runWaveletForPath(target);
                        })();
                      }}
                      disabled={!canRunWavelet || !waveletTargetPath}
                      className="rounded border border-emerald-300/70 bg-emerald-500 px-2 py-1.5 text-white shadow-sm hover:bg-emerald-400 hover:shadow disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-400 disabled:opacity-60"
                      title="Preview wavelet"
                    >
                      <span className="flex items-center gap-1.5">
                        <PlayIcon className="h-4 w-4" />
                        <span className="text-[11px] font-semibold">Preview</span>
                      </span>
                    </button>
                    {waveletTargetPath && waveletPreviewState[waveletTargetPath]?.isRunning ? (
                      <div className="h-1.5 w-14 overflow-hidden rounded bg-slate-800" title="Running…">
                        <div className="h-full w-full animate-pulse bg-emerald-400/80" />
                      </div>
                    ) : null}
                  </>
                ) : null}
              </>
            }
          />

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              {gitSelectedDiff ? (
                <GitDiffPanel
                  theme={theme}
                  filePath={gitSelectedDiff.path}
                  onClose={() => setGitSelectedDiff(null)}
                  isLoading={isGitDiffLoading}
                  diffContents={gitDiffContents}
                  editorOptions={MONACO_EDITOR_OPTIONS as unknown as Record<string, unknown>}
                />
              ) : activeMainTabKind === "preview" && activePreviewPath ? (
                <WaveletPreviewPanel
                  theme={theme}
                  path={activePreviewPath}
                  state={waveletPreviewState[activePreviewPath]}
                  deviceStatus={waveletDeviceConnection.connectionStatus()}
                  onInvokeCallback={(token, args) => {
                    waveletEngineByPathRef.current.get(activePreviewPath)?.invoke(token, args);
                  }}
                />
              ) : activeFile ? (
                <div className="h-full select-text">
                  <MonacoEditor
                    theme={getEmwaverMonacoTheme(theme)}
                    path={activeFile.path}
                    language={activeFile.language}
                    value={activeFile.content}
                    options={editorOptions}
                    onChange={(value) => {
                      if (activeFile.source === "asset") {
                        return;
                      }
                      setOpenFiles((prev) =>
                        prev.map((file) =>
                          file.path === activeFile.path ? { ...file, content: value ?? "", isDirty: true } : file,
                        ),
                      );
                    }}
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">Open a file from the explorer.</div>
              )}
            </div>

            <WorkspaceBottomPanel
              theme={theme}
              rootDir={rootDir}
              isTerminalVisible={isTerminalVisible}
              onToggleTerminalVisible={handleToggleTerminalVisible}
              onClosePanel={() => setIsTerminalVisible(false)}
              terminalPanelRef={terminalPanelRef}
              terminalHeight={terminalHeight}
              onTerminalResizeMouseDown={handleTerminalResizeMouseDown}
              terminalPickerAnchorRef={terminalPickerAnchorRef}
              activeTerminalTitle={activeTerminalTitle}
              isTerminalPickerOpen={isTerminalPickerOpen}
              setIsTerminalPickerOpen={setIsTerminalPickerOpen}
              terminalSessions={terminalSessions}
              activeTerminalSessionId={activeTerminalSessionId}
              setActiveTerminalSessionId={setActiveTerminalSessionId}
              ensureSessionTerminal={ensureSessionTerminal}
              focusActiveTerminal={focusActiveTerminal}
              startTerminalSession={startTerminalSession}
              closeTerminalSession={closeTerminalSession}
              terminalContainerBySessionRef={terminalContainerBySessionRef}
              isTerminalListCollapsed={isTerminalListCollapsed}
              onExpandTerminalList={handleExpandTerminalList}
              onCollapseTerminalList={() => setIsTerminalListCollapsed(true)}
              onTerminalListResizeMouseDown={handleTerminalListResizeMouseDown}
              terminalListWidth={terminalListWidth}
            />
          </div>
        </main>
	      </div>
      )}
    </div>
  );
}
