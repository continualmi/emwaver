import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor as MonacoEditor, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { isTauriAvailable, safeInvoke, safeListen } from "../utils/tauri";

type ThemeMode = "dark" | "light";

type TerminalSession = {
  id: string;
  title: string;
  createdAt: number;
};

type DirectoryChildEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
};

type OpenFile = {
  path: string;
  name: string;
  content: string;
  language: string;
  isDirty: boolean;
};

const ROOT_STORAGE_KEY = "emwaver.devtools.root";
const SIDEBAR_WIDTH_STORAGE_KEY = "emwaver.devtools.sidebarWidth";
const TERMINAL_HEIGHT_STORAGE_KEY = "emwaver.devtools.terminalHeight";
const TERMINAL_LIST_WIDTH_STORAGE_KEY = "emwaver.devtools.terminalListWidth";

const DEFAULT_SIDEBAR_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 560;

const DEFAULT_TERMINAL_HEIGHT = 260;
const TERMINAL_MIN_HEIGHT = 180;
const TERMINAL_MAX_HEIGHT = 560;

const DEFAULT_TERMINAL_LIST_WIDTH = 224;
const TERMINAL_LIST_MIN_WIDTH = 180;
const TERMINAL_LIST_MAX_WIDTH = 420;

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

function readStoredRoot(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const stored = window.localStorage.getItem(ROOT_STORAGE_KEY);
  return stored ? stored : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readStoredSidebarWidth(): number {
  if (typeof window === "undefined") {
    return DEFAULT_SIDEBAR_WIDTH;
  }
  const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (!stored) {
    return DEFAULT_SIDEBAR_WIDTH;
  }
  const parsed = Number.parseFloat(stored);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }
  return clamp(parsed, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
}

function readStoredTerminalHeight(): number {
  if (typeof window === "undefined") {
    return DEFAULT_TERMINAL_HEIGHT;
  }
  const stored = window.localStorage.getItem(TERMINAL_HEIGHT_STORAGE_KEY);
  if (!stored) {
    return DEFAULT_TERMINAL_HEIGHT;
  }
  const parsed = Number.parseFloat(stored);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TERMINAL_HEIGHT;
  }
  return clamp(parsed, TERMINAL_MIN_HEIGHT, TERMINAL_MAX_HEIGHT);
}

function readStoredTerminalListWidth(): number {
  if (typeof window === "undefined") {
    return DEFAULT_TERMINAL_LIST_WIDTH;
  }
  const stored = window.localStorage.getItem(TERMINAL_LIST_WIDTH_STORAGE_KEY);
  if (!stored) {
    return DEFAULT_TERMINAL_LIST_WIDTH;
  }
  const parsed = Number.parseFloat(stored);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TERMINAL_LIST_WIDTH;
  }
  return clamp(parsed, TERMINAL_LIST_MIN_WIDTH, TERMINAL_LIST_MAX_WIDTH);
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function extension(path: string): string {
  const name = basename(path);
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function languageForPath(path: string): string {
  const ext = extension(path);
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "js" || ext === "jsx") return "javascript";
  if (ext === "json") return "json";
  if (ext === "md") return "markdown";
  if (ext === "rs") return "rust";
  if (ext === "c" || ext === "h") return "c";
  if (ext === "cpp" || ext === "hpp" || ext === "cc") return "cpp";
  if (ext === "py") return "python";
  if (ext === "toml") return "toml";
  if (ext === "yml" || ext === "yaml") return "yaml";
  if (ext === "sh") return "shell";
  return "plaintext";
}

function defaultIgnoredName(name: string): boolean {
  return (
    name === ".git" ||
    name === "node_modules" ||
    name === "dist" ||
    name === "build" ||
    name === "target" ||
    name === ".next"
  );
}

export default function DevToolsFragment({ theme = "dark" }: { theme?: ThemeMode }) {
  const [rootDir, setRootDir] = useState<string | null>(() => readStoredRoot());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [dirChildren, setDirChildren] = useState<Record<string, DirectoryChildEntry[]>>({});
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set());
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readStoredSidebarWidth());

  const explorerResizeActiveRef = useRef(false);
  const explorerResizeStartXRef = useRef(0);
  const explorerResizeStartWidthRef = useRef(0);

  const [isTerminalVisible, setIsTerminalVisible] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState<number>(() => readStoredTerminalHeight());
  const terminalResizeActiveRef = useRef(false);
  const terminalResizeStartYRef = useRef(0);
  const terminalResizeStartHeightRef = useRef(0);

  const [terminalListWidth, setTerminalListWidth] = useState<number>(() => readStoredTerminalListWidth());
  const terminalListResizeActiveRef = useRef(false);
  const terminalListResizeStartXRef = useRef(0);
  const terminalListResizeStartWidthRef = useRef(0);

  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([]);
  const [activeTerminalSessionId, setActiveTerminalSessionId] = useState<string | null>(null);

  const sessionsRef = useRef<TerminalSession[]>([]);
  const sessionCounterRef = useRef(1);

  const terminalPanelRef = useRef<HTMLDivElement | null>(null);
  const terminalContainerBySessionRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const terminalBySessionRef = useRef<Map<string, Terminal>>(new Map());
  const fitAddonBySessionRef = useRef<Map<string, FitAddon>>(new Map());
  const pendingTerminalOutputRef = useRef<Map<string, Uint8Array[]>>(new Map());
  const outputDecoderRef = useRef(new TextDecoder());

  const monaco = useMonaco();

  const explorerRoot = useMemo(() => (rootDir ? rootDir.replace(/\\/g, "/") : null), [rootDir]);

  useEffect(() => {
    sessionsRef.current = terminalSessions;
  }, [terminalSessions]);

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
    if (!rootDir) {
      window.localStorage.removeItem(ROOT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ROOT_STORAGE_KEY, rootDir);
  }, [rootDir]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(TERMINAL_HEIGHT_STORAGE_KEY, String(Math.round(terminalHeight)));
  }, [terminalHeight]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(TERMINAL_LIST_WIDTH_STORAGE_KEY, String(Math.round(terminalListWidth)));
  }, [terminalListWidth]);

  const terminalTheme = useMemo(() => {
    if (theme === "light") {
      return {
        background: "#f8fafc",
        foreground: "#0f172a",
        cursor: "#0ea5e9",
        selectionBackground: "rgba(14, 165, 233, 0.22)",
      };
    }
    return {
      background: "#020617",
      foreground: "#e2e8f0",
      cursor: "#38bdf8",
      selectionBackground: "rgba(56, 189, 248, 0.22)",
    };
  }, [theme]);

  useEffect(() => {
    terminalBySessionRef.current.forEach((terminal) => {
      terminal.options.theme = terminalTheme;
    });
  }, [terminalTheme]);

  const ensureSessionTerminal = useCallback(
    (sessionId: string) => {
      if (terminalBySessionRef.current.has(sessionId)) {
        return;
      }
      const container = terminalContainerBySessionRef.current.get(sessionId);
      if (!container) {
        return;
      }

      const term = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontFamily:
          '"Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        fontSize: 12,
        theme: terminalTheme,
        scrollback: 8000,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);

      term.onData((data) => {
        void safeInvoke<void>("pty_write", { payload: { session_id: sessionId, data } });
      });
      term.onResize((size) => {
        void safeInvoke<void>("pty_resize", { payload: { session_id: sessionId, cols: size.cols, rows: size.rows } });
      });

      terminalBySessionRef.current.set(sessionId, term);
      fitAddonBySessionRef.current.set(sessionId, fitAddon);

      const buffered = pendingTerminalOutputRef.current.get(sessionId);
      if (buffered && buffered.length > 0) {
        const decoder = outputDecoderRef.current;
        buffered.forEach((chunk) => term.write(decoder.decode(chunk, { stream: true })));
        pendingTerminalOutputRef.current.delete(sessionId);
      }

      if (activeTerminalSessionId === sessionId) {
        requestAnimationFrame(() => {
          try {
            fitAddon.fit();
          } catch {
            // ignore
          }
        });
      }
    },
    [activeTerminalSessionId, terminalTheme],
  );

  const focusActiveTerminal = useCallback(() => {
    const sessionId = activeTerminalSessionId;
    if (!sessionId) {
      return;
    }
    const fitAddon = fitAddonBySessionRef.current.get(sessionId);
    if (fitAddon) {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    }
    const term = terminalBySessionRef.current.get(sessionId);
    if (!term) {
      return;
    }
    try {
      term.focus();
    } catch {
      // ignore
    }
  }, [activeTerminalSessionId]);

  const startTerminalSession = useCallback(
    async (options?: { makeActive?: boolean }) => {
      if (!isTauriAvailable()) {
        return;
      }
      const makeActive = options?.makeActive ?? true;

      let cols = 80;
      let rows = 24;
      const activeSession = activeTerminalSessionId;
      if (activeSession) {
        const terminal = terminalBySessionRef.current.get(activeSession);
        cols = Math.max(1, terminal?.cols ?? cols);
        rows = Math.max(1, terminal?.rows ?? rows);
      }

      const response = await safeInvoke<{ session_id: string }>("pty_start", {
        payload: { cwd: rootDir, cols, rows },
      });
      const sessionId = response?.session_id;
      if (!sessionId) {
        throw new Error("PTY start returned no session id");
      }

      const session: TerminalSession = {
        id: sessionId,
        title: `Terminal ${sessionCounterRef.current++}`,
        createdAt: Date.now(),
      };
      setTerminalSessions((prev) => [...prev, session]);
      if (makeActive) {
        setActiveTerminalSessionId(sessionId);
      }
    },
    [activeTerminalSessionId, rootDir],
  );

  const closeTerminalSession = useCallback(async (sessionId: string) => {
    try {
      await safeInvoke<void>("pty_stop", { payload: { session_id: sessionId } });
    } catch {
      // ignore
    }

    const terminal = terminalBySessionRef.current.get(sessionId);
    if (terminal) {
      terminal.dispose();
      terminalBySessionRef.current.delete(sessionId);
    }
    const fitAddon = fitAddonBySessionRef.current.get(sessionId);
    if (fitAddon) {
      fitAddon.dispose();
      fitAddonBySessionRef.current.delete(sessionId);
    }
    pendingTerminalOutputRef.current.delete(sessionId);
    terminalContainerBySessionRef.current.delete(sessionId);

    setTerminalSessions((prev) => prev.filter((session) => session.id !== sessionId));
    setActiveTerminalSessionId((prev) => {
      if (prev !== sessionId) {
        return prev;
      }
      const remaining = sessionsRef.current.filter((session) => session.id !== sessionId);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
  }, []);

  const ensureInitialTerminalSession = useCallback(async () => {
    if (terminalSessions.length > 0) {
      return;
    }
    try {
      await startTerminalSession({ makeActive: true });
    } catch {
      // ignore
    }
  }, [startTerminalSession, terminalSessions.length]);

  useEffect(() => {
    void ensureInitialTerminalSession();
  }, [ensureInitialTerminalSession]);

  useEffect(() => {
    if (!activeTerminalSessionId && terminalSessions.length > 0) {
      setActiveTerminalSessionId(terminalSessions[terminalSessions.length - 1].id);
    }
  }, [activeTerminalSessionId, terminalSessions]);

  useEffect(() => {
    if (!isTerminalVisible) {
      return;
    }
    if (!activeTerminalSessionId) {
      return;
    }
    ensureSessionTerminal(activeTerminalSessionId);
    requestAnimationFrame(() => focusActiveTerminal());
  }, [activeTerminalSessionId, ensureSessionTerminal, focusActiveTerminal, isTerminalVisible]);

  useEffect(() => {
    if (!isTerminalVisible) {
      return;
    }
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const panel = terminalPanelRef.current;
    if (!panel) {
      return;
    }
    const observer = new ResizeObserver(() => focusActiveTerminal());
    observer.observe(panel);
    return () => observer.disconnect();
  }, [focusActiveTerminal, isTerminalVisible]);

  useEffect(() => {
    const unlistenPromise = safeListen<{ session_id: string; data: number[] }>("pty-output", (event) => {
      const payload = event.payload;
      if (!payload) {
        return;
      }
      const bytes = new Uint8Array(payload.data);
      const terminal = terminalBySessionRef.current.get(payload.session_id);
      if (terminal) {
        const decoder = outputDecoderRef.current;
        terminal.write(decoder.decode(bytes, { stream: true }));
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
    const handler = (event: KeyboardEvent) => {
      const isToggle = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "j";
      if (!isToggle) {
        return;
      }
      event.preventDefault();
      setIsTerminalVisible((prev) => {
        const next = !prev;
        if (next && terminalSessions.length === 0) {
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
      sessionsRef.current.forEach((session) => {
        void safeInvoke<void>("pty_stop", { payload: { session_id: session.id } });
      });
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

  const handlePickFolder = useCallback(async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Open Folder",
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    setRootDir(selected);
    setSelectedPath(null);
    setOpenFile(null);
    setDirChildren({});
    setOpenDirs(new Set());
  }, []);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!explorerResizeActiveRef.current) {
        return;
      }
      const delta = event.clientX - explorerResizeStartXRef.current;
      setSidebarWidth(clamp(explorerResizeStartWidthRef.current + delta, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
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
      setTerminalListWidth(
        clamp(terminalListResizeStartWidthRef.current + delta, TERMINAL_LIST_MIN_WIDTH, TERMINAL_LIST_MAX_WIDTH),
      );
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
    if (!isTauriAvailable()) {
      return;
    }
    setIsLoadingFile(true);
    try {
      const content = await safeInvoke<string>("read_file", { payload: { path } });
      setOpenFile({
        path,
        name: basename(path),
        content: content ?? "",
        language: languageForPath(path),
        isDirty: false,
      });
      setSelectedPath(path);
    } finally {
      setIsLoadingFile(false);
    }
  }, []);

  const handleSaveFile = useCallback(async () => {
    if (!openFile || !isTauriAvailable()) {
      return;
    }
    if (!openFile.isDirty) {
      return;
    }

    setIsSaving(true);
    try {
      await safeInvoke<void>("write_file", { payload: { path: openFile.path, content: openFile.content } });
      setOpenFile((prev) => (prev ? { ...prev, isDirty: false } : prev));
    } finally {
      setIsSaving(false);
    }
  }, [openFile]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!openFile) {
        return;
      }
      const isSave = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
      if (!isSave) {
        return;
      }
      event.preventDefault();
      void handleSaveFile();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSaveFile, openFile]);

  const renderDirectory = useCallback(
    (dir: string, depth: number) => {
      const children = dirChildren[dir] ?? [];
      return (
        <div>
          {children.map((entry) => {
            const paddingLeft = 10 + depth * 14;
            const isDir = entry.kind === "directory";
            const isOpen = isDir ? openDirs.has(entry.path) : false;
            const isSelected = selectedPath === entry.path;
            return (
              <div key={entry.path}>
                <button
                  type="button"
                  onClick={() => {
                    if (isDir) {
                      void handleToggleDir(entry.path);
                    } else {
                      void handleOpenFile(entry.path);
                    }
                  }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                    isSelected ? "bg-slate-900 text-sky-200" : "text-slate-300 hover:bg-slate-900/70"
                  }`}
                  style={{ paddingLeft }}
                  title={entry.path}
                >
                  <span className="w-4 text-slate-500" aria-hidden="true">
                    {isDir ? (isOpen ? "▾" : "▸") : " "}
                  </span>
                  <span className={`truncate ${isDir ? "text-slate-200" : ""}`}>{entry.name}</span>
                </button>
                {isDir && isOpen ? <div>{renderDirectory(entry.path, depth + 1)}</div> : null}
              </div>
            );
          })}
        </div>
      );
    },
    [dirChildren, handleOpenFile, handleToggleDir, openDirs, selectedPath],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-950 text-slate-100">
      <div className="flex items-center gap-3 border-b border-slate-900 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handlePickFolder()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-800"
          >
            Open Folder
          </button>
          <button
            type="button"
            onClick={() => void handleSaveFile()}
            disabled={!openFile?.isDirty || isSaving}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-100 enabled:hover:bg-slate-800 disabled:opacity-50"
            title="Save (Cmd/Ctrl+S)"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="shrink-0 border-r border-slate-900" style={{ width: sidebarWidth }}>
          <div className="border-b border-slate-900 px-4 py-3">
            <h2 className="truncate text-sm font-semibold text-slate-200" title={rootDir ?? "Dev Tools"}>
              {rootDir ? basename(rootDir) : "Dev Tools"}
            </h2>
            <p className="truncate text-xs text-slate-500" title={rootDir ?? undefined}>
              {rootDir ?? "Pick a folder to start"}
            </p>
          </div>
          <div className="h-full min-h-0 overflow-auto p-2">
            {explorerRoot ? renderDirectory(explorerRoot, 0) : (
              <p className="px-2 text-xs text-slate-500">No folder open.</p>
            )}
          </div>
        </aside>

        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize explorer"
          onMouseDown={(event) => {
            explorerResizeActiveRef.current = true;
            explorerResizeStartXRef.current = event.clientX;
            explorerResizeStartWidthRef.current = sidebarWidth;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
          className="w-1 cursor-col-resize bg-slate-900/60 hover:bg-slate-700/80"
        />

        <main className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-slate-900 px-4 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs text-slate-300">{openFile ? openFile.path : "Select a file to edit"}</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              {isLoadingFile ? <span>Loading…</span> : null}
              {openFile?.isDirty ? <span className="text-amber-300">Unsaved</span> : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              {openFile ? (
                <MonacoEditor
                  theme={theme === "light" ? "vs-light" : "vs-dark"}
                  language={openFile.language}
                  value={openFile.content}
                  options={MONACO_EDITOR_OPTIONS}
                  onChange={(value) => {
                    setOpenFile((prev) => (prev ? { ...prev, content: value ?? "", isDirty: true } : prev));
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">Open a file from the explorer.</div>
              )}
            </div>

            <div className="border-t border-slate-900 bg-slate-950">
              {!isTerminalVisible ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsTerminalVisible((prev) => {
                      const next = !prev;
                      if (next && terminalSessions.length === 0) {
                        void startTerminalSession({ makeActive: true });
                      }
                      return next;
                    });
                  }}
                  className="flex w-full items-center justify-between px-4 py-2 text-left"
                  title="Toggle terminal (Cmd/Ctrl+J)"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-200">Terminal</span>
                    <span className="text-xs text-slate-600">▸</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{rootDir ? `root: ${rootDir}` : "No folder"}</span>
                    <span className="text-slate-600">Cmd/Ctrl+J</span>
                  </div>
                </button>
              ) : (
                <>
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    title="Drag to resize terminal"
                    onMouseDown={(event) => {
                      terminalResizeActiveRef.current = true;
                      terminalResizeStartYRef.current = event.clientY;
                      terminalResizeStartHeightRef.current = terminalHeight;
                      document.body.style.cursor = "row-resize";
                      document.body.style.userSelect = "none";
                    }}
                    className="h-2 cursor-row-resize bg-slate-900/50 hover:bg-slate-700/80"
                  />

                  <div
                    ref={terminalPanelRef}
                    className={`flex overflow-hidden ${theme === "light" ? "bg-slate-50" : "bg-slate-950"}`}
                    style={{ height: terminalHeight }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-center justify-between border-b border-slate-900/70 px-4 py-2">
                        <button
                          type="button"
                          onClick={() => setIsTerminalVisible(false)}
                          className="flex min-w-0 items-center gap-2 rounded px-2 py-1 text-left text-xs font-semibold text-slate-200 hover:bg-slate-900/70"
                          title="Hide terminal (Cmd/Ctrl+J)"
                        >
                          <span className="text-slate-500" aria-hidden="true">
                            ▾
                          </span>
                          <span className="truncate">
                            {terminalSessions.find((session) => session.id === activeTerminalSessionId)?.title ?? "Terminal"}
                          </span>
                          <span className="ml-2 text-xs font-normal text-slate-500">{rootDir ? `root: ${rootDir}` : "No folder"}</span>
                          <span className="ml-2 text-xs font-normal text-slate-600">Cmd/Ctrl+J</span>
                        </button>
                        <div className="text-xs text-slate-600" aria-hidden="true">
                          {/* Actions live in the terminals list to mirror VS Code */}
                        </div>
                      </div>

                      <div className="relative min-h-0 flex-1">
                        {terminalSessions.map((session) => (
                          <div
                            key={session.id}
                            ref={(node) => {
                              if (!node) {
                                terminalContainerBySessionRef.current.delete(session.id);
                                return;
                              }
                              terminalContainerBySessionRef.current.set(session.id, node);
                              ensureSessionTerminal(session.id);
                            }}
                            className={`absolute inset-0 px-2 py-2 ${session.id === activeTerminalSessionId ? "block" : "hidden"}`}
                          />
                        ))}
                        {terminalSessions.length === 0 ? (
                          <div className="flex h-full items-center justify-center text-sm text-slate-500">Starting shell…</div>
                        ) : null}
                      </div>
                    </div>

                    <div
                      role="separator"
                      aria-orientation="vertical"
                      title="Drag to resize terminals list"
                      onMouseDown={(event) => {
                        terminalListResizeActiveRef.current = true;
                        terminalListResizeStartXRef.current = event.clientX;
                        terminalListResizeStartWidthRef.current = terminalListWidth;
                        document.body.style.cursor = "col-resize";
                        document.body.style.userSelect = "none";
                      }}
                      className="w-2 cursor-col-resize bg-slate-900/40 hover:bg-slate-700/80"
                    />

                    <aside
                      className="shrink-0 bg-slate-900/15 shadow-[-10px_0_20px_-20px_rgba(0,0,0,0.9)]"
                      style={{ width: terminalListWidth }}
                    >
                      <div className="group flex items-center justify-between border-b border-slate-800 bg-slate-950/40 px-3 py-2 text-xs font-semibold text-slate-200">
                        <span>Terminals</span>
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => void startTerminalSession({ makeActive: true })}
                            className="rounded p-1 text-slate-400 hover:bg-slate-900/70 hover:text-slate-100"
                            title="New terminal"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const sessionId = activeTerminalSessionId;
                              if (!sessionId) {
                                return;
                              }
                              void closeTerminalSession(sessionId);
                            }}
                            disabled={!activeTerminalSessionId}
                            className="rounded p-1 text-slate-400 enabled:hover:bg-slate-900/70 enabled:hover:text-slate-100 disabled:opacity-40"
                            title="Kill active terminal"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <div className="h-full min-h-0 overflow-auto p-2">
                        {terminalSessions.map((session) => {
                          const isActive = session.id === activeTerminalSessionId;
                          return (
                            <div
                              key={session.id}
                              className={`group mb-1 flex items-center gap-2 rounded ${
                                isActive ? "bg-slate-900/60" : "hover:bg-slate-900/30"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveTerminalSessionId(session.id);
                                  requestAnimationFrame(() => {
                                    ensureSessionTerminal(session.id);
                                    focusActiveTerminal();
                                  });
                                }}
                                className={`min-w-0 flex-1 truncate px-2 py-1 text-left text-xs transition-colors ${
                                  isActive ? "text-sky-200" : "text-slate-300"
                                }`}
                                title={session.title}
                              >
                                {session.title}
                              </button>
                              <button
                                type="button"
                                onClick={() => void closeTerminalSession(session.id)}
                                className={`rounded px-2 py-1 text-xs text-slate-400 transition-opacity hover:bg-slate-900/70 hover:text-slate-200 ${
                                  isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                                }`}
                                title="Close terminal"
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </aside>
                  </div>
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
