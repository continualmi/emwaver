import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor as MonacoEditor, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { isTauriAvailable, safeInvoke, safeListen } from "../utils/tauri";

type ThemeMode = "dark" | "light";

type BottomPanelTab = "terminal" | "output";

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

const DEFAULT_TERMINAL_TITLE = "zsh";

const ROOT_STORAGE_KEY = "emwaver.devtools.root";
const SIDEBAR_WIDTH_STORAGE_KEY = "emwaver.devtools.sidebarWidth";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "emwaver.devtools.sidebarCollapsed";
const TERMINAL_HEIGHT_STORAGE_KEY = "emwaver.devtools.terminalHeight";
const TERMINAL_LIST_WIDTH_STORAGE_KEY = "emwaver.devtools.terminalListWidth";
const TERMINAL_LIST_COLLAPSED_STORAGE_KEY = "emwaver.devtools.terminalListCollapsed";

const DEFAULT_SIDEBAR_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 140;
const SIDEBAR_MAX_WIDTH = 1400;
const SIDEBAR_COLLAPSE_THRESHOLD = 90;

const DEFAULT_TERMINAL_HEIGHT = 260;
const TERMINAL_MIN_HEIGHT = 180;
const TERMINAL_MAX_HEIGHT = 560;

const DEFAULT_TERMINAL_LIST_WIDTH = 224;
const TERMINAL_LIST_MIN_WIDTH = 140;
const TERMINAL_LIST_MAX_WIDTH = 720;
const TERMINAL_LIST_COLLAPSE_THRESHOLD = 90;

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

function readStoredSidebarCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
  if (!stored) {
    return false;
  }
  return stored === "true";
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

function readStoredTerminalListCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const stored = window.localStorage.getItem(TERMINAL_LIST_COLLAPSED_STORAGE_KEY);
  if (!stored) {
    return false;
  }
  return stored === "true";
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

function nextTerminalTitle(existing: TerminalSession[], baseTitle: string): string {
  const taken = existing
    .map((session) => session.title)
    .filter((title) => title === baseTitle || title.startsWith(`${baseTitle} `)).length;
  return taken === 0 ? baseTitle : `${baseTitle} ${taken + 1}`;
}

function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      className={className ?? "h-4 w-4"}
      aria-hidden="true"
    >
      <path d="M2.5 3.5h11v9h-11z" />
      <path d="M4.6 6.1l2 1.9-2 1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.6 10.1h3.6" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className ?? "h-4 w-4"}>
      <path d="M8 3.3v9.4M3.3 8h9.4" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={className ?? "h-4 w-4"}>
      <path d="M5.4 5.4v7M8 5.4v7M10.6 5.4v7" strokeLinecap="round" />
      <path d="M3.6 4.3h8.8" strokeLinecap="round" />
      <path d="M6.1 4.3l.7-1.4h2.4l.7 1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 4.3l.5 9.2h6l.5-9.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className ?? "h-4 w-4"}>
      <path d="M4.2 6.2l3.8 3.8 3.8-3.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className ?? "h-4 w-4"}>
      <path d="M6.2 4.2l3.8 3.8-3.8 3.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className ?? "h-4 w-4"}>
      <path d="M4.3 4.3l7.4 7.4M11.7 4.3l-7.4 7.4" strokeLinecap="round" />
    </svg>
  );
}

function PanelLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={className ?? "h-4 w-4"}>
      <path d="M2.5 3.5h11v9h-11z" />
      <path d="M6 3.5v9" strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={className ?? "h-4 w-4"}>
      <path
        d="M2.6 4.6c0-.6.4-1 1-1h3l1.1 1.1H12.4c.6 0 1 .4 1 1v6.6c0 .6-.4 1-1 1H3.6c-.6 0-1-.4-1-1z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") {
        return arg;
      }
      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function timestampLabel(date: Date): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function iconLabelForPath(path: string): { label: string; accentClass: string } {
  const ext = extension(path);
  if (ext === "ts" || ext === "tsx") return { label: "TS", accentClass: "text-sky-400" };
  if (ext === "js" || ext === "jsx") return { label: "JS", accentClass: "text-amber-300" };
  if (ext === "json") return { label: "{}", accentClass: "text-yellow-200" };
  if (ext === "md") return { label: "MD", accentClass: "text-slate-300" };
  if (ext === "rs") return { label: "RS", accentClass: "text-orange-300" };
  if (ext === "c") return { label: "C", accentClass: "text-sky-300" };
  if (ext === "h") return { label: "H", accentClass: "text-sky-300" };
  if (ext === "toml") return { label: "T", accentClass: "text-slate-300" };
  if (ext === "yml" || ext === "yaml") return { label: "Y", accentClass: "text-emerald-300" };
  if (ext === "sh") return { label: "$", accentClass: "text-emerald-300" };
  return { label: "•", accentClass: "text-slate-400" };
}

export default function DevToolsFragment({ theme = "dark" }: { theme?: ThemeMode }) {
  const [rootDir, setRootDir] = useState<string | null>(() => readStoredRoot());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [dirChildren, setDirChildren] = useState<Record<string, DirectoryChildEntry[]>>({});
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set());
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => readStoredSidebarCollapsed());
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readStoredSidebarWidth());
  const openingFilePathsRef = useRef<Set<string>>(new Set());

  const explorerResizeActiveRef = useRef(false);
  const explorerResizeStartXRef = useRef(0);
  const explorerResizeStartWidthRef = useRef(0);

  const [isTerminalVisible, setIsTerminalVisible] = useState(false);
  const [bottomPanelTab, setBottomPanelTab] = useState<BottomPanelTab>("terminal");
  const [terminalHeight, setTerminalHeight] = useState<number>(() => readStoredTerminalHeight());
  const terminalResizeActiveRef = useRef(false);
  const terminalResizeStartYRef = useRef(0);
  const terminalResizeStartHeightRef = useRef(0);

  const [terminalListWidth, setTerminalListWidth] = useState<number>(() => readStoredTerminalListWidth());
  const [isTerminalListCollapsed, setIsTerminalListCollapsed] = useState<boolean>(() => readStoredTerminalListCollapsed());
  const terminalListLastExpandedWidthRef = useRef<number>(readStoredTerminalListWidth());
  const terminalListResizeActiveRef = useRef(false);
  const terminalListResizeStartXRef = useRef(0);
  const terminalListResizeStartWidthRef = useRef(0);

  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([]);
  const [activeTerminalSessionId, setActiveTerminalSessionId] = useState<string | null>(null);
  const [isTerminalPickerOpen, setIsTerminalPickerOpen] = useState(false);
  const terminalPickerAnchorRef = useRef<HTMLDivElement | null>(null);

  const [outputLines, setOutputLines] = useState<string[]>([]);
  const outputScrollRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    sessionsRef.current = terminalSessions;
  }, [terminalSessions]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    const unlistenTogglePromise = safeListen("menu-toggle-explorer", () => {
      setIsSidebarCollapsed((prev) => !prev);
    });
    const unlistenShowPromise = safeListen("menu-show-explorer", () => {
      setIsSidebarCollapsed(false);
    });
    return () => {
      void unlistenTogglePromise.then((unlisten) => unlisten());
      void unlistenShowPromise.then((unlisten) => unlisten());
    };
  }, []);

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
    setIsTerminalPickerOpen(false);
  }, [bottomPanelTab]);

  useEffect(() => {
    if (!isTerminalVisible) {
      setIsTerminalPickerOpen(false);
    }
  }, [isTerminalVisible]);

  useEffect(() => {
    if (bottomPanelTab !== "output") {
      return;
    }
    const node = outputScrollRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [bottomPanelTab, outputLines.length]);

  useEffect(() => {
    const MAX_LINES = 2000;
    const pushLine = (line: string) => {
      setOutputLines((prev) => {
        const next = [...prev, line];
        if (next.length <= MAX_LINES) {
          return next;
        }
        return next.slice(next.length - MAX_LINES);
      });
    };

    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };

    const wrap =
      (level: "log" | "info" | "warn" | "error") =>
      (...args: unknown[]) => {
        original[level](...args);
        const label = timestampLabel(new Date());
        pushLine(`[${label}] ${level.toUpperCase()} ${formatConsoleArgs(args)}`);
      };

    console.log = wrap("log");
    console.info = wrap("info");
    console.warn = wrap("warn");
    console.error = wrap("error");

    const onWindowError = (event: ErrorEvent) => {
      const label = timestampLabel(new Date());
      pushLine(`[${label}] ERROR ${event.message}`);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const label = timestampLabel(new Date());
      pushLine(`[${label}] ERROR Unhandled rejection: ${formatConsoleArgs([event.reason])}`);
    };
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(TERMINAL_LIST_COLLAPSED_STORAGE_KEY, String(isTerminalListCollapsed));
  }, [isTerminalListCollapsed]);

  useEffect(() => {
    if (isTerminalListCollapsed) {
      return;
    }
    terminalListLastExpandedWidthRef.current = terminalListWidth;
  }, [isTerminalListCollapsed, terminalListWidth]);

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
      if (terminalStartInFlightRef.current) {
        return;
      }
      terminalStartInFlightRef.current = true;
      const makeActive = options?.makeActive ?? true;

      let cols = 80;
      let rows = 24;
      const activeSession = activeTerminalSessionId;
      if (activeSession) {
        const terminal = terminalBySessionRef.current.get(activeSession);
        cols = Math.max(1, terminal?.cols ?? cols);
        rows = Math.max(1, terminal?.rows ?? rows);
      }

      try {
        const response = await safeInvoke<{ session_id: string }>("pty_start", {
          payload: { cwd: rootDir, cols, rows },
        });
        const sessionId = response?.session_id;
        if (!sessionId) {
          throw new Error("PTY start returned no session id");
        }

        const title = nextTerminalTitle(sessionsRef.current, DEFAULT_TERMINAL_TITLE);
        const session: TerminalSession = {
          id: sessionId,
          title,
          createdAt: Date.now(),
        };
        setTerminalSessions((prev) => [...prev, session]);
        if (makeActive) {
          setActiveTerminalSessionId(sessionId);
        }
      } finally {
        terminalStartInFlightRef.current = false;
      }
    },
    [activeTerminalSessionId, rootDir],
  );

  const closeTerminalSession = useCallback(async (sessionId: string) => {
    closingTerminalSessionsRef.current.add(sessionId);

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

    const remaining = sessionsRef.current.filter((session) => session.id !== sessionId);
    if (remaining.length === 0) {
      setIsTerminalVisible(false);
      setBottomPanelTab("terminal");
    }

    setTerminalSessions((prev) => prev.filter((session) => session.id !== sessionId));
    setActiveTerminalSessionId((prev) => {
      if (prev !== sessionId) {
        return prev;
      }
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });

    try {
      await safeInvoke<void>("pty_stop", { payload: { session_id: sessionId } });
    } catch {
      // ignore
    } finally {
      window.setTimeout(() => closingTerminalSessionsRef.current.delete(sessionId), 750);
    }
  }, []);

  const ensureInitialTerminalSession = useCallback(async () => {
    if (didAutoStartTerminalRef.current) {
      return;
    }
    didAutoStartTerminalRef.current = true;
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
    const observer = new ResizeObserver(() => {
      focusActiveTerminal();
      const panelWidth = panel.getBoundingClientRect().width;
      const computedMax = Math.floor(panelWidth * 0.45);
      const effectiveMax = Math.max(TERMINAL_LIST_MIN_WIDTH, Math.min(TERMINAL_LIST_MAX_WIDTH, computedMax));
      setTerminalListWidth((prev) => clamp(prev, TERMINAL_LIST_MIN_WIDTH, effectiveMax));
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [focusActiveTerminal, isTerminalVisible]);

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
      const terminal = terminalBySessionRef.current.get(payload.session_id);
      if (terminal) {
        const decoder = outputDecoderRef.current;
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
    setOpenFiles([]);
    setActiveFilePath(null);
    setDirChildren({});
    setOpenDirs(new Set());
  }, []);

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
    if (!isTauriAvailable()) {
      return;
    }
    setSelectedPath(path);
    setActiveFilePath(path);
    if (openFiles.some((file) => file.path === path)) {
      return;
    }
    if (openingFilePathsRef.current.has(path)) {
      return;
    }
    openingFilePathsRef.current.add(path);
    setIsLoadingFile(true);
    try {
      const content = await safeInvoke<string>("read_file", { payload: { path } });
      const next: OpenFile = {
        path,
        name: basename(path),
        content: content ?? "",
        language: languageForPath(path),
        isDirty: false,
      };
      setOpenFiles((prev) => (prev.some((file) => file.path === path) ? prev : [...prev, next]));
    } finally {
      openingFilePathsRef.current.delete(path);
      setIsLoadingFile(false);
    }
  }, [openFiles]);

  const closeFile = useCallback((path: string) => {
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
  }, []);

  const handleSaveFile = useCallback(async () => {
    if (!activeFile || !isTauriAvailable()) {
      return;
    }
    if (!activeFile.isDirty) {
      return;
    }

    setIsSaving(true);
    try {
      await safeInvoke<void>("write_file", { payload: { path: activeFile.path, content: activeFile.content } });
      setOpenFiles((prev) => prev.map((file) => (file.path === activeFile.path ? { ...file, isDirty: false } : file)));
    } finally {
      setIsSaving(false);
    }
  }, [activeFile]);

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

  const renderDirectory = useCallback(
    (dir: string, depth: number) => {
      const children = dirChildren[dir] ?? [];
      return (
        <div>
          {children.map((entry) => {
            const paddingLeft = 6 + depth * 10;
            const isDir = entry.kind === "directory";
            const isOpen = isDir ? openDirs.has(entry.path) : false;
            const isSelected = selectedPath === entry.path;
            const iconLabel = !isDir ? iconLabelForPath(entry.path) : null;
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
	                  className={`group grid w-full items-center rounded px-2 py-[3px] text-left text-xs transition-colors ${
	                    isDir ? "grid-cols-[16px_22px_1fr]" : "grid-cols-[16px_1fr]"
	                  } ${
	                    isSelected ? "bg-slate-900 text-sky-200" : "text-slate-300 hover:bg-slate-900/70"
	                  }`}
	                  style={{ paddingLeft }}
	                  title={entry.path}
	                >
                  <span className="flex h-4 w-4 items-center justify-center text-slate-500" aria-hidden="true">
                    {isDir ? (
                      isOpen ? (
                        <ChevronDownIcon className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRightIcon className="h-3.5 w-3.5" />
                      )
                    ) : (
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded bg-slate-900/50 text-[9px] font-semibold leading-none ${iconLabel?.accentClass ?? ""}`}
                      >
                        {iconLabel?.label}
                      </span>
                    )}
                  </span>
	                  {isDir ? (
	                    <span className="flex h-4 w-[22px] items-center justify-center text-slate-500" aria-hidden="true">
	                      <FolderIcon className="h-4 w-4" />
	                    </span>
	                  ) : null}
	                  <span className={`min-w-0 truncate ${isDir ? "text-slate-200" : ""}`}>{entry.name}</span>
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
    <div className="flex h-full min-h-0 select-none flex-col bg-slate-950 text-slate-100">
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
            disabled={!activeFile?.isDirty || isSaving}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-100 enabled:hover:bg-slate-800 disabled:opacity-50"
            title="Save (Cmd/Ctrl+S)"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

	      <div className="flex min-h-0 flex-1">
	        {isSidebarCollapsed ? (
	          <button
	            type="button"
            onClick={() => setIsSidebarCollapsed(false)}
            className="flex w-9 shrink-0 items-center justify-center border-r border-slate-900 bg-slate-950 text-slate-500 hover:bg-slate-900/30 hover:text-slate-200"
            title="Show Explorer (Cmd/Ctrl+B)"
          >
            <PanelLeftIcon className="h-4 w-4" />
          </button>
	        ) : (
	          <>
	            <aside className="shrink-0 border-r border-slate-900" style={{ width: sidebarWidth }}>
	              <div className="border-b border-slate-900 px-4 py-3">
	                <div className="flex items-start justify-between gap-2">
	                  <div className="min-w-0 cursor-default">
	                    <h2 className="truncate text-sm font-semibold text-slate-200" title={rootDir ?? "Dev Tools"}>
	                      {rootDir ? basename(rootDir) : "Dev Tools"}
	                    </h2>
	                  </div>
	                  <button
	                    type="button"
	                    onClick={() => setIsSidebarCollapsed(true)}
                    className="rounded p-1 text-slate-500 hover:bg-slate-900/60 hover:text-slate-200"
                    title="Hide Explorer (Cmd/Ctrl+B)"
                  >
                    <PanelLeftIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="h-full min-h-0 overflow-auto p-2">
                {explorerRoot ? renderDirectory(explorerRoot, 0) : <p className="px-2 text-xs text-slate-500">No folder open.</p>}
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
              className="w-1 cursor-col-resize bg-slate-900/60 hover:bg-slate-700/80"
            />
          </>
        )}

        <main className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-slate-900 bg-slate-950">
	            <div className="flex min-w-0 flex-1 items-center overflow-hidden">
	              <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
	                {openFiles.length === 0 ? (
	                  <div className="px-4 py-2 text-xs text-slate-500">Select a file to edit</div>
	                ) : (
	                  openFiles.map((file) => {
	                    const isActive = file.path === activeFilePath;
	                    const icon = iconLabelForPath(file.path);
	                    return (
	                      <div
	                        key={file.path}
	                        className={`group relative flex shrink-0 items-center border-r border-slate-900 ${
	                          isActive ? "bg-slate-900" : "bg-slate-950 hover:bg-slate-900/60"
	                        }`}
	                        title={file.path}
	                      >
	                        <button
	                          type="button"
	                          onClick={() => {
	                            setActiveFilePath(file.path);
	                            setSelectedPath(file.path);
	                          }}
	                          className={`flex items-center gap-2 px-3 py-2 pr-9 text-left text-xs ${
	                            isActive ? "text-slate-100" : "text-slate-400 group-hover:text-slate-200"
	                          }`}
	                        >
	                          <span
	                            className={`flex h-4 w-6 items-center justify-center rounded bg-slate-950/40 text-[10px] font-semibold ${icon.accentClass}`}
                            aria-hidden="true"
                          >
                            {icon.label}
                          </span>
	                          <span className="max-w-[12rem] truncate">{file.name}</span>
	                          {file.isDirty ? <span className="text-amber-300">●</span> : null}
	                        </button>
	
	                        <button
	                          type="button"
	                          onClick={() => closeFile(file.path)}
	                          className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200 group-hover:block"
	                          title="Close (Cmd/Ctrl+W)"
	                        >
	                          <CloseIcon className="h-3.5 w-3.5" />
	                        </button>
	                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3 px-4 py-2 text-xs text-slate-500">
              {isLoadingFile ? <span>Loading…</span> : null}
              {activeFile?.isDirty ? <span className="text-amber-300">Unsaved</span> : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              {activeFile ? (
                <div className="h-full select-text">
                  <MonacoEditor
                    theme={theme === "light" ? "vs-light" : "vs-dark"}
                    path={activeFile.path}
                    language={activeFile.language}
                    value={activeFile.content}
                    options={MONACO_EDITOR_OPTIONS}
                    onChange={(value) => {
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

            <div className="border-t border-slate-900 bg-slate-950">
              <button
                type="button"
	                onClick={() => {
	                  setIsTerminalVisible((prev) => {
	                    const next = !prev;
	                    if (next && terminalSessions.length === 0 && !terminalStartInFlightRef.current) {
	                      void startTerminalSession({ makeActive: true });
	                    }
	                    return next;
	                  });
	                }}
                className={`flex w-full items-center justify-between px-4 py-2 text-left ${isTerminalVisible ? "hidden" : ""}`}
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

              <div className={isTerminalVisible ? "" : "hidden"}>
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
                      className={`flex flex-col overflow-hidden ${theme === "light" ? "bg-slate-50" : "bg-slate-950"}`}
                      style={{ height: terminalHeight }}
                    >
                      <div className="flex items-center justify-between border-b border-slate-900/70 px-2 py-1 text-xs">
                        <div className="flex items-end gap-1">
                          <button
                            type="button"
                            onClick={() => setBottomPanelTab("terminal")}
                            className={`select-none px-3 py-2 font-semibold tracking-wide ${
                              bottomPanelTab === "terminal"
                                ? "border-b-2 border-sky-400 text-slate-100"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            TERMINAL
                          </button>
                          <button
                            type="button"
                            onClick={() => setBottomPanelTab("output")}
                            className={`select-none px-3 py-2 font-semibold tracking-wide ${
                              bottomPanelTab === "output"
                                ? "border-b-2 border-sky-400 text-slate-100"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            OUTPUT
                          </button>
                        </div>

                        <div ref={terminalPickerAnchorRef} className="relative flex items-center gap-1">
                          {bottomPanelTab === "terminal" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setIsTerminalPickerOpen((prev) => !prev)}
                                className="inline-flex select-none items-center gap-2 rounded px-2 py-1 text-slate-300 hover:bg-slate-900/70 hover:text-slate-100"
                                title="Select terminal"
                              >
                                <TerminalIcon className="h-4 w-4 text-slate-500" />
                                <span className="max-w-[12rem] truncate">{activeTerminalTitle}</span>
                                <ChevronDownIcon className="h-4 w-4 text-slate-500" />
                              </button>

                              {isTerminalPickerOpen ? (
                                <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded border border-slate-800 bg-slate-950 shadow-xl">
                                  <div className="max-h-64 overflow-auto p-1">
                                    {terminalSessions.map((session) => {
                                      const isActive = session.id === activeTerminalSessionId;
                                      return (
                                        <button
                                          key={session.id}
                                          type="button"
                                          onClick={() => {
                                            setIsTerminalPickerOpen(false);
                                            setActiveTerminalSessionId(session.id);
                                            requestAnimationFrame(() => {
                                              ensureSessionTerminal(session.id);
                                              focusActiveTerminal();
                                            });
                                          }}
                                          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
                                            isActive ? "bg-slate-900/70 text-sky-200" : "text-slate-200 hover:bg-slate-900/50"
                                          }`}
                                        >
                                          <TerminalIcon className={`h-4 w-4 ${isActive ? "text-sky-300" : "text-slate-500"}`} />
                                          <span className="min-w-0 flex-1 truncate">{session.title}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}

                              <button
                                type="button"
                                onClick={() => void startTerminalSession({ makeActive: true })}
                                className="rounded p-1 text-slate-400 hover:bg-slate-900/70 hover:text-slate-100"
                                title="New terminal"
                              >
                                <PlusIcon />
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
                                <TrashIcon />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setOutputLines([])}
                              className="rounded px-2 py-1 text-slate-400 hover:bg-slate-900/70 hover:text-slate-100"
                              title="Clear output"
                            >
                              Clear
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setIsTerminalVisible(false)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-900/70 hover:text-slate-100"
                            title="Close panel (Cmd/Ctrl+J)"
                          >
                            <CloseIcon />
                          </button>
                        </div>
                      </div>

	                      <div className="flex min-h-0 flex-1">
	                        <div className="flex min-w-0 flex-1 flex-col">
		                          {bottomPanelTab === "terminal" ? (
		                            <div className="relative min-h-0 flex-1 overflow-hidden">
	                              {terminalSessions.map((session) => (
	                                <div
	                                  key={session.id}
	                                  ref={(node) => {
                                    if (!node) {
                                      terminalContainerBySessionRef.current.delete(session.id);
                                      return;
                                    }
                                    terminalContainerBySessionRef.current.set(session.id, node);
                                    if (isTerminalVisible) {
                                      ensureSessionTerminal(session.id);
                                    }
                                  }}
                                  className={`absolute inset-0 select-text px-2 py-2 ${
                                    session.id === activeTerminalSessionId ? "block" : "hidden"
                                  }`}
                                />
                              ))}
                              {terminalSessions.length === 0 ? (
                                <div className="flex h-full items-center justify-center text-sm text-slate-500">Starting shell…</div>
                              ) : null}
                            </div>
                          ) : (
                            <div
                              ref={outputScrollRef}
                              className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-slate-200 selection:bg-sky-500/30"
                            >
                              {outputLines.length === 0 ? (
                                <div className="text-slate-500">No output yet.</div>
                              ) : (
                                <pre className="whitespace-pre-wrap">
                                  {outputLines.join("\n")}
                                  {"\n"}
                                </pre>
                              )}
                            </div>
	                          )}
	                        </div>
	
	                        {isTerminalListCollapsed ? (
	                          <button
	                            type="button"
	                            onClick={() => {
	                              setIsTerminalListCollapsed(false);
	                              setTerminalListWidth(
	                                clamp(
	                                  terminalListLastExpandedWidthRef.current,
	                                  TERMINAL_LIST_MIN_WIDTH,
	                                  TERMINAL_LIST_MAX_WIDTH,
	                                ),
	                              );
	                            }}
	                            className="flex w-9 shrink-0 items-center justify-center border-l border-slate-900 bg-slate-950 text-slate-500 hover:bg-slate-900/30 hover:text-slate-200"
	                            title="Show terminals"
	                          >
	                            <TerminalIcon className="h-4 w-4" />
	                          </button>
	                        ) : (
	                          <>
	                            <div
	                              role="separator"
	                              aria-orientation="vertical"
	                              title="Drag to resize right panel"
	                              onDoubleClick={() => setIsTerminalListCollapsed(true)}
	                              onMouseDown={(event) => {
	                                setIsTerminalListCollapsed(false);
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
	                              {bottomPanelTab === "terminal" ? (
	                                <div className="h-full min-h-0 overflow-auto p-2 pt-3">
	                                  {terminalSessions.length === 0 ? (
	                                    <div className="px-2 py-1 text-xs text-slate-500">
	                                      No terminals yet. Use the + button.
	                                    </div>
	                                  ) : (
	                                    terminalSessions.map((session) => {
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
	                                            className={`flex min-w-0 flex-1 items-center gap-2 truncate px-2 py-1 text-left text-xs transition-colors ${
	                                              isActive ? "text-sky-200" : "text-slate-300"
	                                            }`}
	                                            title={session.title}
	                                          >
	                                            <TerminalIcon
	                                              className={`h-4 w-4 ${isActive ? "text-sky-300" : "text-slate-500"}`}
	                                            />
	                                            <span className="min-w-0 flex-1 truncate">{session.title}</span>
	                                          </button>
	                                          <button
	                                            type="button"
	                                            onClick={() => void closeTerminalSession(session.id)}
	                                            className={`rounded px-2 py-1 text-xs text-slate-400 transition-opacity hover:bg-slate-900/70 hover:text-slate-200 ${
	                                              isActive
	                                                ? "opacity-100"
	                                                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
	                                            }`}
	                                            title="Close terminal"
	                                          >
	                                            <CloseIcon className="h-4 w-4" />
	                                          </button>
	                                        </div>
	                                      );
	                                    })
	                                  )}
	                                </div>
	                              ) : (
	                                <div className="h-full min-h-0 overflow-auto p-2 pt-3 text-xs text-slate-300">
	                                  <div className="mb-2 px-2 text-[11px] font-semibold tracking-wide text-slate-500">
	                                    OUTPUT
	                                  </div>
	                                  <div className="rounded bg-slate-900/60 px-2 py-1 text-sky-200">DevTools</div>
	                                </div>
	                              )}
	                            </aside>
	                          </>
	                        )}
	                      </div>
	                    </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
