import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor as MonacoEditor, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { isTauriAvailable, safeInvoke, safeListen } from "../utils/tauri";

type ThemeMode = "dark" | "light";

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
const DEFAULT_SIDEBAR_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 560;

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
  const [showIgnored, setShowIgnored] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readStoredSidebarWidth());
  const resizeActiveRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);
  const [shellStatus, setShellStatus] = useState<"stopped" | "starting" | "running">("stopped");
  const [ptySessionId, setPtySessionId] = useState<string | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const pendingTerminalLinesRef = useRef<string[]>([]);
  const outputDecoderRef = useRef(new TextDecoder());
  const invokeRef = useRef<null | (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>)>(null);
  const monaco = useMonaco();

  const explorerRoot = useMemo(() => (rootDir ? rootDir.replace(/\\/g, "/") : null), [rootDir]);

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

  const terminalWriteLine = useCallback((line: string) => {
    const terminal = terminalRef.current;
    if (!terminal) {
      pendingTerminalLinesRef.current.push(line);
      return;
    }
    terminal.writeln(line);
  }, []);

  const ensureTerminal = useCallback(() => {
    if (terminalRef.current) {
      return terminalRef.current;
    }
    const container = terminalContainerRef.current;
    if (!container) {
      return null;
    }

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: '"Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12,
      theme: terminalTheme,
      scrollback: 5000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    const queued = pendingTerminalLinesRef.current.splice(0);
    queued.forEach((line) => term.writeln(line));

    return term;
  }, [terminalTheme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    terminal.options.theme = terminalTheme;
  }, [terminalTheme]);

  useEffect(() => {
    if (!isTauriAvailable()) {
      return;
    }
    let canceled = false;
    void import("@tauri-apps/api/core").then(({ invoke }) => {
      if (canceled) {
        return;
      }
      invokeRef.current = invoke;
    });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const terminal = ensureTerminal();
    if (!terminal) {
      return;
    }

    const onDataDisposable = terminal.onData((data) => {
      if (!ptySessionId) {
        return;
      }
      const invoke = invokeRef.current;
      if (invoke) {
        void invoke<void>("pty_write", { payload: { session_id: ptySessionId, data } });
      } else {
        void safeInvoke<void>("pty_write", { payload: { session_id: ptySessionId, data } });
      }
    });

    return () => {
      onDataDisposable.dispose();
    };
  }, [ensureTerminal, ptySessionId]);

  useEffect(() => {
    const container = terminalContainerRef.current;
    const fitAddon = fitAddonRef.current;
    if (!container || !fitAddon || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const loadDirectoryChildren = useCallback(
    async (dir: string) => {
      if (!isTauriAvailable()) {
        return;
      }

      const entries = await safeInvoke<DirectoryChildEntry[]>("read_directory_children", {
        payload: { path: dir },
      });

      const normalized = (entries || []).filter((entry) => (showIgnored ? true : !defaultIgnoredName(entry.name)));
      normalized.sort((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === "directory" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      setDirChildren((prev) => ({ ...prev, [dir]: normalized }));
    },
    [showIgnored],
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
    terminalWriteLine(`\u001b[90m[devtools]\u001b[0m Opened folder: ${selected}`);
    const terminal = ensureTerminal();
    if (terminal && shellStatus === "running" && ptySessionId) {
      const escaped = selected.replace(/'/g, "'\\''");
      const invoke = invokeRef.current;
      if (invoke) {
        void invoke<void>("pty_write", { payload: { session_id: ptySessionId, data: `cd '${escaped}'\n` } });
      }
    }
  }, [ensureTerminal, ptySessionId, shellStatus, terminalWriteLine]);

  const stopShell = useCallback(async () => {
    if (!ptySessionId) {
      setShellStatus("stopped");
      return;
    }
    try {
      await safeInvoke<void>("pty_stop", { payload: { session_id: ptySessionId } });
    } catch (error) {
      terminalWriteLine(`\u001b[31m[err]\u001b[0m Failed to stop shell: ${String(error)}`);
    } finally {
      setPtySessionId(null);
      setShellStatus("stopped");
    }
  }, [ptySessionId, terminalWriteLine]);

  const startShell = useCallback(async () => {
    if (!isTauriAvailable()) {
      terminalWriteLine("\u001b[33m[warn]\u001b[0m Shell requires the Tauri runtime.");
      return;
    }
    if (shellStatus === "starting" || shellStatus === "running") {
      return;
    }

    ensureTerminal();
    setShellStatus("starting");
    terminalWriteLine("\u001b[90m[devtools]\u001b[0m Starting zsh…");

    try {
      const term = terminalRef.current;
      const cols = Math.max(1, term?.cols ?? 80);
      const rows = Math.max(1, term?.rows ?? 24);

      const response = await safeInvoke<{ session_id: string }>("pty_start", {
        payload: {
          cwd: rootDir,
          cols,
          rows,
        },
      });
      const sessionId = response?.session_id;
      if (!sessionId) {
        throw new Error("PTY start returned no session id");
      }
      setPtySessionId(sessionId);
      setShellStatus("running");

      const fitAddon = fitAddonRef.current;
      if (fitAddon) {
        try {
          fitAddon.fit();
        } catch {
          // ignore
        }
      }
    } catch (error) {
      terminalWriteLine(`\u001b[31m[err]\u001b[0m Failed to start shell: ${String(error)}`);
      setPtySessionId(null);
      setShellStatus("stopped");
    }
  }, [ensureTerminal, rootDir, shellStatus, terminalWriteLine]);

  useEffect(() => {
    if (!ptySessionId) {
      return;
    }

    const decoder = outputDecoderRef.current;
    const unlistenPromise = safeListen<{ session_id: string; data: number[] }>("pty-output", (event) => {
      const payload = event.payload;
      if (!payload || payload.session_id !== ptySessionId) {
        return;
      }
      const terminal = terminalRef.current;
      if (!terminal) {
        return;
      }
      const bytes = new Uint8Array(payload.data);
      terminal.write(decoder.decode(bytes, { stream: true }));
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [ptySessionId]);

  useEffect(() => {
    if (!ptySessionId) {
      return;
    }
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    const disposable = terminal.onResize((size) => {
      const invoke = invokeRef.current;
      if (invoke) {
        void invoke<void>("pty_resize", { payload: { session_id: ptySessionId, cols: size.cols, rows: size.rows } });
      } else {
        void safeInvoke<void>("pty_resize", { payload: { session_id: ptySessionId, cols: size.cols, rows: size.rows } });
      }
    });
    return () => disposable.dispose();
  }, [ptySessionId]);

  useEffect(() => {
    return () => {
      const sessionId = ptySessionId;
      const invoke = invokeRef.current;
      if (sessionId && invoke) {
        void invoke<void>("pty_stop", { payload: { session_id: sessionId } });
      }
    };
  }, [ptySessionId]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!resizeActiveRef.current) {
        return;
      }
      const delta = event.clientX - resizeStartXRef.current;
      setSidebarWidth(clamp(resizeStartWidthRef.current + delta, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
    };

    const handleUp = () => {
      if (!resizeActiveRef.current) {
        return;
      }
      resizeActiveRef.current = false;
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
      terminalWriteLine(`\u001b[90m[devtools]\u001b[0m Saved: ${openFile.path}`);
    } finally {
      setIsSaving(false);
    }
  }, [openFile, terminalWriteLine]);

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
          <label className="ml-2 flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={showIgnored}
              onChange={(event) => setShowIgnored(event.target.checked)}
            />
            Show ignored
          </label>
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
            {explorerRoot ? renderDirectory(explorerRoot, 0) : <p className="px-2 text-xs text-slate-500">No folder open.</p>}
          </div>
        </aside>
        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize explorer"
          onMouseDown={(event) => {
            resizeActiveRef.current = true;
            resizeStartXRef.current = event.clientX;
            resizeStartWidthRef.current = sidebarWidth;
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
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  Open a file from the explorer.
                </div>
              )}
            </div>
            <div className="border-t border-slate-900 bg-slate-950">
              <div className="flex items-center justify-between px-4 py-2">
                <p className="text-xs font-semibold text-slate-200">Terminal</p>
                <div className="flex items-center gap-3">
                  <p className="text-xs text-slate-500">{rootDir ? `root: ${rootDir}` : "Open a folder to start"}</p>
                  {shellStatus !== "running" ? (
                    <button
                      type="button"
                      onClick={() => void startShell()}
                      disabled={!rootDir || shellStatus === "starting"}
                      className="rounded-md bg-sky-600 px-2 py-1 text-xs font-semibold text-slate-950 hover:bg-sky-500 disabled:opacity-50"
                    >
                      {shellStatus === "starting" ? "Starting…" : "Start Shell"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void stopShell()}
                      className="rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-800"
                    >
                      Stop
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const terminal = ensureTerminal();
                      terminal?.clear();
                    }}
                    className="rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-800"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className={`h-56 overflow-hidden ${theme === "light" ? "bg-slate-50" : "bg-slate-950"}`}>
                <div ref={terminalContainerRef} className="h-full w-full px-2 py-2" />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
