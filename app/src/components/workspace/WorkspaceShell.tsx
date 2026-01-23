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
import { ScriptEngine, type ScriptTree } from "../../utils/ScriptEngine";
import { useBackendScript } from "../../utils/useBackendScript";
import { readScriptsTabState, writeScriptsTabState } from "../scriptsTabState";
import { useWorkspaceGit } from "./hooks/useWorkspaceGit";
import ExplorerTree from "./sidebar/ExplorerTree";
import GitSidebarPanel from "./sidebar/GitSidebarPanel";
import ScriptAssetsPanel from "./sidebar/ScriptAssetsPanel";
import WorkspaceTopBar from "./top/WorkspaceTopBar";
import GitDiffPanel from "./main/GitDiffPanel";
import ScriptPreviewPanel from "./main/ScriptPreviewPanel";
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
  SCRIPT_EXAMPLE_SCRIPTS,
  SCRIPT_ASSET_ROOT,
  SCRIPT_BOOTSTRAP_FILENAME,
  basename,
  defaultIgnoredName,
  formatConsoleArgs,
  iconLabelForPath,
  isScriptAssetPath,
  isScriptScriptPath,
  languageForPath,
  nextTerminalTitle,
  readScriptAssetScript,
  timestampLabel,
  scriptAssetPath,
} from "./workspaceUtils";

const DEFAULT_TERMINAL_TITLE = "zsh";
const CONSOLE_INPUT_TOKEN = "__emw_console_input";

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
  const tabStateFileName = "scripts-tabs.json";
  const readTabState = readScriptsTabState;
  const writeTabState = writeScriptsTabState;

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
  const [terminalActiveTab, setTerminalActiveTab] = useState<"terminal" | "console">("terminal");
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

  const [terminalConsoleLines, setTerminalConsoleLines] = useState<string[]>([]);
  const terminalConsoleAnchorRef = useRef<HTMLDivElement | null>(null);
  const appendTerminalConsoleLine = useCallback((message: string) => {
    setTerminalConsoleLines((prev) => [...prev.slice(-499), String(message)]);
  }, []);
  const clearTerminalConsole = useCallback(() => {
    setTerminalConsoleLines([]);
  }, []);


  const monaco = useMonaco();
  const device = useDevice();

  useEffect(() => {
    if (!monaco) {
      return;
    }
    ensureEmwaverMonacoThemes(monaco);
    monaco.editor.setTheme(getEmwaverMonacoTheme());
  }, [monaco, theme]);

  const [activeMainTabKind, setActiveMainTabKind] = useState<"file" | "preview">("file");
  const [activePreviewPath, setActivePreviewPath] = useState<string | null>(null);
  const [scriptPreviewTabs, setScriptPreviewTabs] = useState<string[]>([]);
  const [scriptPreviewState, setScriptPreviewState] = useState<
    Record<
      string,
      {
        tree: ScriptTree | null;
        console: string[];
        isRunning: boolean;
      }
    >
  >({});
  const scriptEngineByPathRef = useRef<Map<string, ScriptEngine>>(new Map());
  const scriptBootstrapRef = useRef<string | null>(null);
  
  // Backend script execution (fast mode - ~2ms per command instead of ~6-8ms)
  const [useBackendEngine, setUseBackendEngine] = useState(true);
  const backendScript = useBackendScript();
  const activeBackendPathRef = useRef<string | null>(null);

  const submitTerminalConsoleInput = useCallback(
    (line: string) => {
      const trimmed = String(line ?? "").trimEnd();
      if (!trimmed) {
        return;
      }

      appendTerminalConsoleLine(`> ${trimmed}`);

      const targetPath = activePreviewPath ?? activeBackendPathRef.current;
      if (!targetPath) {
        appendTerminalConsoleLine("(no active script)");
        return;
      }

      if (useBackendEngine && activeBackendPathRef.current === targetPath) {
        void backendScript.invokeCallback(CONSOLE_INPUT_TOKEN, [trimmed]);
        return;
      }

      const engine = scriptEngineByPathRef.current.get(targetPath);
      if (!engine) {
        appendTerminalConsoleLine("(no frontend engine for active script)");
        return;
      }
      engine.invoke(CONSOLE_INPUT_TOKEN, [trimmed]);
    },
    [activePreviewPath, appendTerminalConsoleLine, backendScript, useBackendEngine],
  );
  
  // Sync backend script state to preview state
  useEffect(() => {
    const path = activeBackendPathRef.current;
    if (!path || !useBackendEngine) return;
    
    setScriptPreviewState((prev) => ({
      ...prev,
      [path]: {
        tree: backendScript.state.tree,
        console: backendScript.state.logs,
        isRunning: backendScript.state.isRunning,
      },
    }));
  }, [backendScript.state, useBackendEngine]);
  const scriptDeviceRef = useRef(device);
  const scriptCommandQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    scriptDeviceRef.current = device;
  }, [device]);

  const scriptDeviceConnection = useMemo(
    () => ({
      sendCommandString: (command: string, timeoutMs: number = 1500) => {
        const queued = scriptCommandQueueRef.current
          .then(async () => {
            const { status, send } = scriptDeviceRef.current;
            if (!status.connected) {
              return null;
            }
            return await send(command, timeoutMs, 1);
          })
          .catch(async () => null);

        scriptCommandQueueRef.current = queued.then(
          () => undefined,
          () => undefined,
        );
        return queued as Promise<Uint8Array | null>;
      },
      sendPacket: (data: Uint8Array, timeoutMs: number = 1500) => {
        const queued = scriptCommandQueueRef.current
          .then(async () => {
            const { status, sendPacket } = scriptDeviceRef.current;
            if (!status.connected) {
              return null;
            }
            return await sendPacket(data, timeoutMs, 1);
          })
          .catch(async () => null);

        scriptCommandQueueRef.current = queued.then(
          () => undefined,
          () => undefined,
        );
        return queued as Promise<Uint8Array | null>;
      },
      write: (data: Uint8Array) => {
        const { status, sendPacket } = scriptDeviceRef.current;
        if (!status.connected) {
          return;
        }
        const queued = scriptCommandQueueRef.current
          .then(async () => {
            await sendPacket(data, 1500, 1);
            await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
          })
          .catch(async () => undefined);
        scriptCommandQueueRef.current = queued.then(
          () => undefined,
          () => undefined,
        );
      },
      connectionStatus: () => {
        const { status } = scriptDeviceRef.current;
        if (!status.connected) {
          return "disconnected";
        }
        return `${status.transport ?? "unknown"} connected`;
      },
    }),
    [],
  );

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

  const scriptTargetPath = useMemo(() => activeFilePath ?? selectedPath ?? null, [activeFilePath, selectedPath]);

  const scriptTargetWantsPreview = useMemo(() => {
    if (!scriptTargetPath) {
      return true;
    }
    const normalizedPath = scriptTargetPath.replace(/\\/g, "/");
    const file = openFiles.find((entry) => entry.path.replace(/\\/g, "/") === normalizedPath);
    if (!file) {
      return true;
    }

    // Minimal heuristic: if the script calls UI.render, a preview panel is useful.
    // If it doesn't render UI, treat it like a terminal/console script.
    return /\bUI\.render\s*\(/.test(file.content);
  }, [openFiles, scriptTargetPath]);
  const canRunScript = useMemo(() => {
    const candidatePath = (activeMainTabKind === "preview" ? activePreviewPath : scriptTargetPath) ?? null;
    if (!candidatePath) {
      return false;
    }
    const normalizedPath = candidatePath.replace(/\\/g, "/");
    if (!isScriptScriptPath(normalizedPath)) {
      return false;
    }
    if (isScriptAssetPath(normalizedPath)) {
      return true;
    }
    return Boolean(rootDir);
  }, [activeMainTabKind, activePreviewPath, rootDir, scriptTargetPath]);


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

  useEffect(() => {
    if (!isTauriAvailable()) {
      return;
    }

    const unlistenPromise = safeListen<string>("script:print", (event) => {
      appendTerminalConsoleLine(event.payload);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [appendTerminalConsoleLine]);

  useEffect(() => {
    const anchor = terminalConsoleAnchorRef.current;
    if (!anchor) {
      return;
    }
    anchor.scrollIntoView({ block: "end" });
  }, [terminalConsoleLines.length]);

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

      const terminal = new Terminal({
        cursorBlink: true,
        fontFamily: '"Fira Code", "SF Mono", Menlo, Monaco, "Courier New", monospace',
        fontSize: 13,
        theme: {
          background: "#111c32",
          foreground: "#f1f5f9",
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
    setScriptPreviewTabs([]);
    setScriptPreviewState({});
    scriptEngineByPathRef.current.forEach((engine) => engine.shutdown());
    scriptEngineByPathRef.current.clear();
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
    const isAssetPath = normalizedPath.startsWith(`${SCRIPT_ASSET_ROOT}/`);
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
        const content = await readScriptAssetScript(filename);
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

  const openScriptPreviewTab = useCallback(
    async (path: string, { activate }: { activate: boolean }) => {
      await handleOpenFile(path);
      setScriptPreviewTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
      if (activate) {
        setActiveMainTabKind("preview");
        setActivePreviewPath(path);
      }
    },
    [handleOpenFile],
  );

  const closeScriptPreviewTab = useCallback(
    (path: string) => {
      setScriptPreviewTabs((prev) => prev.filter((entry) => entry !== path));
      setScriptPreviewState((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
      const engine = scriptEngineByPathRef.current.get(path);
      if (engine) {
        engine.shutdown();
        scriptEngineByPathRef.current.delete(path);
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
    closeScriptPreviewTab(path);
  }, [closeScriptPreviewTab]);

  const runScriptForPath = useCallback(
    async (path: string) => {

      const normalizedPath = path.replace(/\\/g, "/");
      const isAssetPath = isScriptAssetPath(normalizedPath);
      if (!isScriptScriptPath(normalizedPath)) {
        return;
      }
      if (!rootDir && !isAssetPath) {
        return;
      }

      setScriptPreviewState((prev) => ({
        ...prev,
        [normalizedPath]: {
          tree: prev[normalizedPath]?.tree ?? null,
          console: [],
          isRunning: true,
        },
      }));

      if (!scriptBootstrapRef.current) {
        scriptBootstrapRef.current = await readScriptAssetScript(SCRIPT_BOOTSTRAP_FILENAME);
      }
      
      // Get the script source
      const openFileSnapshot = openFilesRef.current;
      const openFileByPath = new Map(openFileSnapshot.map((file) => [file.path, file] as const));
      const entryFile = openFileByPath.get(normalizedPath);
      const entrySource =
        entryFile?.content ??
        (isAssetPath
          ? await readScriptAssetScript(basename(normalizedPath))
          : !isTauriAvailable()
            ? ""
            : (await safeInvoke<string>("read_file", { payload: { path: normalizedPath } })) ?? "");
      
      // Use backend engine for fast execution (direct USB access, ~2ms per command)
      if (useBackendEngine && isTauriAvailable()) {
        activeBackendPathRef.current = normalizedPath;
        backendScript.clearLogs();
        await backendScript.execute(entrySource, scriptBootstrapRef.current ?? "");
        return;
      }
      
      // Fallback to frontend engine (slower, ~6-8ms per command via Tauri IPC)
      let engine = scriptEngineByPathRef.current.get(normalizedPath);
      if (!engine) {
        engine = new ScriptEngine();
        const bootstrap = scriptBootstrapRef.current ?? "";
        engine.setBootstrapSource(bootstrap);
        engine.setup(
          (message: string) => {
            appendTerminalConsoleLine(message);
            setScriptPreviewState((prev) => ({
              ...prev,
              [normalizedPath]: {
                tree: prev[normalizedPath]?.tree ?? null,
                console: [...(prev[normalizedPath]?.console ?? []), String(message)],
                isRunning: prev[normalizedPath]?.isRunning ?? false,
              },
            }));
          },
          (tree: ScriptTree) => {
            setScriptPreviewState((prev) => ({
              ...prev,
              [normalizedPath]: {
                tree,
                console: prev[normalizedPath]?.console ?? [],
                isRunning: prev[normalizedPath]?.isRunning ?? false,
              },
            }));
          },
          {
            _scriptSendCommandString: scriptDeviceConnection.sendCommandString,
            _scriptSleep: async (ms: number) => {
              const durationMs = Math.max(0, Number(ms) || 0);
              await new Promise<void>((resolve) => window.setTimeout(resolve, durationMs));
            },
            _scriptSamplerBufferGetPacketCount: async () => (await safeInvoke<number>("buffer_get_packet_count")) ?? 0,
            _scriptSamplerBufferGetLenBytes: async () => (await safeInvoke<number>("buffer_get_len_bytes")) ?? 0,
            _scriptSamplerBufferGetBytes: async () => {
              const bytes = (await safeInvoke<number[]>("buffer_get_bytes")) ?? [];
              return new Uint8Array(bytes);
            },
            _scriptSamplerBufferClear: async () => {
              await safeInvoke<void>("sampler_buffer_clear");
            },
            _scriptSamplerBufferSetInvertRx: async (enabled: boolean) => {
              await safeInvoke<void>("buffer_set_invert_rx", { enabled: !!enabled }).catch(() => {});
            },
            _scriptSamplerBufferReadPacketsSince: async (packetIndex: number, maxPackets: number) => {
              const packet_index = Math.max(0, Math.floor(Number(packetIndex) || 0));
              const max_packets = Math.max(1, Math.floor(Number(maxPackets) || 256));
              const resp = await safeInvoke<any>("buffer_read_packets_since", { packet_index, max_packets });
              const data = new Uint8Array((resp && Array.isArray(resp.data) ? resp.data : []) as number[]);
              return {
                data,
                nextPacketIndex: Number(resp?.next_packet_index ?? 0),
                availablePackets: Number(resp?.available_packets ?? 0),
              };
            },
            _scriptSamplerBufferCompressViewport: async (startBit: number, endBit: number, bins: number) => {
              const range_start = Math.max(0, Math.floor(Number(startBit) || 0));
              const range_end = Math.max(0, Math.floor(Number(endBit) || 0));
              const number_bins = Math.max(0, Math.floor(Number(bins) || 0));
              const resp = await safeInvoke<any>("buffer_compress_viewport", { range_start, range_end, number_bins });
              return {
                bufferLenBytes: Number(resp?.buffer_len_bytes ?? 0),
                timeValues: (resp?.time_values ?? []) as number[],
                dataValues: (resp?.data_values ?? []) as number[],
              };
            },
          },
        );
        scriptEngineByPathRef.current.set(normalizedPath, engine);
      }

      engine.execute(entrySource, () => {
        setScriptPreviewState((prev) => ({
          ...prev,
          [normalizedPath]: {
            tree: prev[normalizedPath]?.tree ?? null,
            console: [...(prev[normalizedPath]?.console ?? []), "Script execution completed."],
            isRunning: false,
          },
        }));
      });

      setScriptPreviewState((prev) => ({
        ...prev,
        [normalizedPath]: {
          tree: prev[normalizedPath]?.tree ?? null,
          console: prev[normalizedPath]?.console ?? [],
          isRunning: false,
        },
      }));
    },
    [rootDir, scriptDeviceConnection],
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
            Open a script project
          </h2>
          <p className="mt-2 max-w-lg text-sm text-slate-400">Scripts needs a folder to browse, edit, run, and preview scripts.</p>
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
                              ? rootDir ?? "Scripts"
                              : "Source Control"
                          }
                        >
                          {sidebarPanel === "explorer"
                            ? rootDir
                              ? basename(rootDir)
                              : "SCRIPTS"
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
                      <ScriptAssetsPanel
                        isCollapsed={isAssetScriptsCollapsed}
                        onToggleCollapsed={() => setIsAssetScriptsCollapsed((prev) => !prev)}
                        onOpenAsset={(filename) => handleOpenFile(scriptAssetPath(filename))}
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
            scriptPreviewTabs={scriptPreviewTabs}
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
            onClosePreview={closeScriptPreviewTab}
            rightActions={
              <>
                {activeMainTabKind !== "preview" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const target = scriptTargetPath;
                        if (!target) return;

                        if (!scriptTargetWantsPreview) {
                          setIsTerminalVisible(true);
                          setTerminalActiveTab("console");
                        }

                        void (async () => {
                          if (scriptTargetWantsPreview) {
                            await openScriptPreviewTab(target, { activate: true });
                          }
                          await runScriptForPath(target);
                        })();
                      }}
                      disabled={!canRunScript || !scriptTargetPath}
                      className="rounded border border-emerald-300/70 bg-emerald-500 px-2 py-1.5 text-white shadow-sm hover:bg-emerald-400 hover:shadow disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-400 disabled:opacity-60"
                      title={scriptTargetWantsPreview ? "Preview script" : "Run script"}
                    >
                      <span className="flex items-center gap-1.5">
                        <PlayIcon className="h-4 w-4" />
                        <span className="text-[11px] font-semibold">{scriptTargetWantsPreview ? "Preview" : "Run"}</span>
                      </span>
                    </button>
                    {scriptTargetPath && scriptPreviewState[scriptTargetPath]?.isRunning ? (
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
                <ScriptPreviewPanel
                  theme={theme}
                  path={activePreviewPath}
                  state={scriptPreviewState[activePreviewPath]}
                  deviceStatus={scriptDeviceConnection.connectionStatus()}
                  onInvokeCallback={(token, args) => {
                    if (useBackendEngine && activeBackendPathRef.current === activePreviewPath) {
                      backendScript.invokeCallback(token, args);
                    } else {
                      scriptEngineByPathRef.current.get(activePreviewPath)?.invoke(token, args);
                    }
                  }}
                />
              ) : activeFile ? (
                <div className="h-full select-text">
                  <MonacoEditor
                    theme={getEmwaverMonacoTheme()}
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
              terminalActiveTab={terminalActiveTab}
              onSetTerminalActiveTab={setTerminalActiveTab}
              terminalConsoleLines={terminalConsoleLines}
              terminalConsoleAnchorRef={terminalConsoleAnchorRef}
              onClearTerminalConsole={clearTerminalConsole}
              onSubmitConsoleInput={submitTerminalConsoleInput}
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
