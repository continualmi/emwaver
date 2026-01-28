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
import { ensureEmwaverMonacoThemes, getEmwaverMonacoTheme } from "../../utils/monacoTheme";
import { isTauriAvailable, safeInvoke, safeListen } from "../../utils/tauri";
import { useDevice } from "../../utils/DeviceContext";
import { ScriptEngine, type ScriptTree } from "../../utils/ScriptEngine";
import { useBackendScript } from "../../utils/useBackendScript";
import ExplorerTree from "./sidebar/ExplorerTree";
import ScriptAssetsPanel from "./sidebar/ScriptAssetsPanel";
import WorkspaceTopBar from "./top/WorkspaceTopBar";
import ScriptPreviewPanel from "./main/ScriptPreviewPanel";
import {
  FolderIcon,
  PanelLeftIcon,
} from "./WorkspaceIcons";
import type {
  DirectoryChildEntry,
  OpenFile,
  ThemeMode,
} from "./workspaceTypes";
import {
  SIDEBAR_COLLAPSE_THRESHOLD,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clamp,
  storageKeys,
  readStoredRoot,
  readStoredSidebarCollapsed,
  readStoredSidebarWidth,
} from "./workspaceStorage";
import {
  SCRIPT_ASSET_ROOT,
  SCRIPT_BOOTSTRAP_FILENAME,
  basename,
  defaultIgnoredName,
  isScriptAssetPath,
  isScriptScriptPath,
  languageForPath,
  readScriptAssetScript,
  scriptAssetPath,
} from "./workspaceUtils";

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

export default function WorkspaceShell({
  theme = "dark",
  isActive = false,
}: {
  theme?: ThemeMode;
  isActive?: boolean;
}) {
  const keys = storageKeys();

  const [rootDir, setRootDir] = useState<string | null>(() => readStoredRoot(keys));
  const [scriptLibrary, setScriptLibrary] = useState<"examples" | "local">(() => {
    if (typeof window === "undefined") return "examples";
    const stored = window.localStorage.getItem("emwaver.scriptsWorkspace.library");
    return stored === "local" ? "local" : "examples";
  });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [dirChildren, setDirChildren] = useState<Record<string, DirectoryChildEntry[]>>({});
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set());
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => readStoredSidebarCollapsed(keys));
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readStoredSidebarWidth(keys));
  const sidebarLastExpandedWidthRef = useRef<number>(readStoredSidebarWidth(keys));
  const openingFilePathsRef = useRef<Set<string>>(new Set());

  const explorerResizeActiveRef = useRef(false);
  const explorerResizeStartXRef = useRef(0);
  const explorerResizeStartWidthRef = useRef(0);

  const DEFAULT_SCRIPTS_ROOT = "~/Documents/EMWaver/scripts";

  // Scripts are UI-only; no console/terminal output.
  const handleScriptPrint = useCallback((_message: string) => {}, []);


  const monaco = useMonaco();
  const device = useDevice();

  useEffect(() => {
    if (!monaco) {
      return;
    }
    ensureEmwaverMonacoThemes(monaco);
    monaco.editor.setTheme(getEmwaverMonacoTheme());
  }, [monaco, theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("emwaver.scriptsWorkspace.library", scriptLibrary);
  }, [scriptLibrary]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (rootDir) window.localStorage.setItem(keys.root, rootDir);
  }, [keys.root, rootDir]);

  const [activeMainTabKind, setActiveMainTabKind] = useState<"file" | "preview">("file");
  const [scriptPreviewState, setScriptPreviewState] = useState<
    Record<
      string,
      {
        tree: ScriptTree | null;
        isRunning: boolean;
        error: string | null;
      }
    >
  >({});
  const scriptEngineByPathRef = useRef<Map<string, ScriptEngine>>(new Map());
  const scriptBootstrapRef = useRef<string | null>(null);
  
  // Backend script execution (fast mode - ~2ms per command instead of ~6-8ms)
  const [useBackendEngine, setUseBackendEngine] = useState(true);
  const backendScript = useBackendScript();
  const activeBackendPathRef = useRef<string | null>(null);

  // Sync backend script state to preview state
  useEffect(() => {
    const path = activeBackendPathRef.current;
    if (!path || !useBackendEngine) return;
    
    setScriptPreviewState((prev) => ({
      ...prev,
      [path]: {
        tree: backendScript.state.tree,
        isRunning: backendScript.state.isRunning,
        error: backendScript.state.error,
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
  const activeFile = openFile;

  const editorOptions = useMemo(() => {
    if (!activeFile) {
      return MONACO_EDITOR_OPTIONS;
    }
    if (activeFile.source === "asset") {
      return { ...MONACO_EDITOR_OPTIONS, readOnly: true };
    }
    return MONACO_EDITOR_OPTIONS;
  }, [activeFile]);

  const scriptTargetPath = useMemo(() => activeFile?.path ?? selectedPath ?? null, [activeFile?.path, selectedPath]);

  const canRunScript = useMemo(() => {
    const candidatePath = scriptTargetPath ?? null;
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
  }, [rootDir, scriptTargetPath]);

  useEffect(() => {
    if (scriptLibrary !== "local") return;
    if (rootDir) return;
    if (!isTauriAvailable()) return;

    void (async () => {
      try {
        await safeInvoke<void>("ensure_dir", { payload: { path: DEFAULT_SCRIPTS_ROOT } });
        setRootDir(DEFAULT_SCRIPTS_ROOT);
      } catch {
        // If directory creation fails, keep rootDir null and fall back to examples.
        setScriptLibrary("examples");
      }
    })();
  }, [rootDir, scriptLibrary]);


  const openFileRef = useRef<OpenFile | null>(openFile);
  useEffect(() => {
    openFileRef.current = openFile;
  }, [openFile]);

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

        const candidate = openFileRef.current;
        if (!candidate || candidate.isDirty || candidate.source === "asset") {
          return;
        }

      inFlight = true;
      try {
          const mtime = await safeInvoke<number>("file_modified_ms", { payload: { path: candidate.path } })
            .then((value) => value ?? undefined)
            .catch(() => undefined);

          if (mtime == null) return;

          if (candidate.diskMtimeMs == null) {
            setOpenFile((prev) => (prev && prev.path === candidate.path ? { ...prev, diskMtimeMs: mtime } : prev));
            return;
          }

          if (mtime === candidate.diskMtimeMs) return;

          const content = await safeInvoke<string>("read_file", { payload: { path: candidate.path } }).catch(() => null);
          if (content == null) return;

          setOpenFile((prev) => {
            if (!prev || prev.path !== candidate.path) return prev;
            if (prev.isDirty) return prev;
            return { ...prev, content, isDirty: false, diskMtimeMs: mtime };
          });
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
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(keys.sidebarCollapsed, String(isSidebarCollapsed));
    if (keys.legacy?.sidebarCollapsed) {
      window.localStorage.removeItem(keys.legacy.sidebarCollapsed);
    }
  }, [isSidebarCollapsed]);

  // No terminal/console.


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

  // No terminal resize handling.

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

  const cleanupScriptForPath = useCallback(
    async (path: string) => {
      const normalizedPath = path.replace(/\\/g, "/");
      if (useBackendEngine && activeBackendPathRef.current === normalizedPath) {
        await backendScript.stop();
        activeBackendPathRef.current = null;
      }
      const engine = scriptEngineByPathRef.current.get(normalizedPath);
      if (engine) {
        engine.shutdown();
        scriptEngineByPathRef.current.delete(normalizedPath);
      }
      setScriptPreviewState((prev) => {
        const next = { ...prev };
        delete next[normalizedPath];
        return next;
      });
    },
    [backendScript, useBackendEngine],
  );

  const handleOpenFile = useCallback(async (path: string) => {
    const normalizedPath = path.replace(/\\/g, "/");
    const isAssetPath = normalizedPath.startsWith(`${SCRIPT_ASSET_ROOT}/`);
    const effectivePath = isAssetPath ? normalizedPath : path;
    setActiveMainTabKind("file");
    setSelectedPath(effectivePath);
    if (openFileRef.current?.path === effectivePath) {
      return;
    }

    const previous = openFileRef.current;
    if (previous && previous.path !== effectivePath) {
      await cleanupScriptForPath(previous.path);
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
        setOpenFile(next);
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
      setOpenFile(next);
    } finally {
      openingFilePathsRef.current.delete(effectivePath);
      setIsLoadingFile(false);
    }
  }, [cleanupScriptForPath]);

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
          tree: null,
          isRunning: true,
          error: null,
        },
      }));

      if (!scriptBootstrapRef.current) {
        scriptBootstrapRef.current = await readScriptAssetScript(SCRIPT_BOOTSTRAP_FILENAME);
      }
      
      // Get the script source
      const entryFile = (() => {
        const candidate = openFileRef.current;
        if (!candidate) return null;
        return candidate.path.replace(/\\/g, "/") === normalizedPath ? candidate : null;
      })();
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
          (tree: ScriptTree) => {
            setScriptPreviewState((prev) => ({
              ...prev,
              [normalizedPath]: {
                tree,
                isRunning: prev[normalizedPath]?.isRunning ?? false,
                error: prev[normalizedPath]?.error ?? null,
              },
            }));
          },
          {
            _scriptSendPacket: scriptDeviceConnection.sendPacket,
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
          (message: string) => {
            handleScriptPrint(message);
            setScriptPreviewState((prev) => ({
              ...prev,
              [normalizedPath]: {
                tree: prev[normalizedPath]?.tree ?? null,
                isRunning: false,
                error: message,
              },
            }));
          },
        );
        scriptEngineByPathRef.current.set(normalizedPath, engine);
      }

      engine.execute(entrySource, () => {
        setScriptPreviewState((prev) => ({
          ...prev,
          [normalizedPath]: {
            tree: prev[normalizedPath]?.tree ?? null,
            isRunning: false,
            error: prev[normalizedPath]?.error ?? null,
          },
        }));
      });

      setScriptPreviewState((prev) => ({
        ...prev,
        [normalizedPath]: {
          tree: prev[normalizedPath]?.tree ?? null,
          isRunning: false,
          error: prev[normalizedPath]?.error ?? null,
        },
      }));
    },
    [rootDir, scriptDeviceConnection],
  );

  const stopScriptForPath = useCallback(
    async (path: string, { closePreview }: { closePreview: boolean }) => {
      const normalizedPath = path.replace(/\\/g, "/");

      if (useBackendEngine && activeBackendPathRef.current === normalizedPath) {
        await backendScript.stop();
        activeBackendPathRef.current = null;
      } else {
        const engine = scriptEngineByPathRef.current.get(normalizedPath);
        if (engine) {
          engine.shutdown();
          scriptEngineByPathRef.current.delete(normalizedPath);
        }
      }

      setScriptPreviewState((prev) => ({
        ...prev,
        [normalizedPath]: {
          tree: prev[normalizedPath]?.tree ?? null,
          isRunning: false,
          error: prev[normalizedPath]?.error ?? null,
        },
      }));

      if (closePreview) {
        setActiveMainTabKind("file");
      }
    },
    [backendScript, useBackendEngine],
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
      setOpenFile((prev) => (prev && prev.path === activeFile.path ? { ...prev, isDirty: false, diskMtimeMs } : prev));
    } finally {
      setIsSaving(false);
    }
  }, [activeFile]);

  useEffect(() => {
    const unlistenTogglePromise = safeListen("menu-toggle-explorer", () => {
      setIsSidebarCollapsed((prev) => !prev);
    });
    const unlistenShowPromise = safeListen("menu-show-explorer", () => {
      setIsSidebarCollapsed(false);
    });
    const unlistenSavePromise = safeListen("menu-save-file", () => {
      void handleSaveFile();
    });

    return () => {
      void unlistenTogglePromise.then((unlisten) => unlisten());
      void unlistenShowPromise.then((unlisten) => unlisten());
      void unlistenSavePromise.then((unlisten) => unlisten());
    };
  }, [handleSaveFile]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!activeFile) {
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
  }, [activeFile, handleSaveFile]);

  return (
    <div className="flex h-full min-h-0 select-none flex-col bg-slate-950 text-slate-100">
	      <div className="flex min-h-0 flex-1 overflow-hidden">
		        {isSidebarCollapsed ? (
              <div className="flex w-9 shrink-0 flex-col border-r border-slate-900 bg-slate-950">
                <button
                  type="button"
                  onClick={() => {
                    setSidebarWidth((prev) => (prev > 0 ? prev : sidebarLastExpandedWidthRef.current));
                    setIsSidebarCollapsed(false);
                  }}
                  className={`flex h-9 items-center justify-center text-slate-500 hover:bg-slate-900/30 hover:text-slate-200 ${
						"bg-slate-900/50 text-slate-200"
                  }`}
                  title="Show Explorer (Cmd/Ctrl+B)"
                >
                  <FolderIcon className="h-4 w-4" />
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
                          title={scriptLibrary === "local" ? rootDir ?? "My scripts" : "Example scripts"}
                        >
                          {scriptLibrary === "local" ? "My scripts" : "Example scripts"}
                        </h2>
                        {scriptLibrary === "local" && rootDir ? (
                          <div className="mt-1 truncate text-[11px] text-slate-500" title={rootDir}>
                            {rootDir}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
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

                    <div className="mt-3">
                      <div className="relative flex rounded-full border border-slate-800 bg-slate-950 p-1">
                        <div
                          className={`pointer-events-none absolute inset-y-1 w-1/2 rounded-full bg-slate-900/70 ring-1 ring-inset ring-slate-800 transition-transform ${
                            scriptLibrary === "local" ? "translate-x-full" : "translate-x-0"
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setScriptLibrary("examples");
                            setActiveMainTabKind("file");
                            if (activeFile) {
                              void stopScriptForPath(activeFile.path, { closePreview: true });
                            }
                          }}
                          className={`relative z-10 flex-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                            scriptLibrary === "examples" ? "text-slate-100" : "text-slate-500 hover:text-slate-200"
                          }`}
                        >
                          Examples
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setScriptLibrary("local");
                            setActiveMainTabKind("file");
                            if (activeFile) {
                              void stopScriptForPath(activeFile.path, { closePreview: true });
                            }
                          }}
                          className={`relative z-10 flex-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                            scriptLibrary === "local" ? "text-slate-100" : "text-slate-500 hover:text-slate-200"
                          }`}
                        >
                          My scripts
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto p-2">
                    <div className="space-y-2">
                      {scriptLibrary === "local" ? (
                        explorerRoot ? (
                          <ExplorerTree
                            root={explorerRoot}
                            dirChildren={dirChildren}
                            openDirs={openDirs}
                            selectedPath={selectedPath}
                            onToggleDir={handleToggleDir}
                            onOpenFile={handleOpenFile}
                          />
                        ) : (
                          <div className="rounded border border-slate-900 bg-slate-950 p-3 text-xs text-slate-500">
                            No scripts folder configured.
                          </div>
                        )
                      ) : (
                        <div className="rounded border border-slate-900 bg-slate-950 p-2">
                          <ScriptAssetsPanel onOpenAsset={(filename) => handleOpenFile(scriptAssetPath(filename))} />
                        </div>
                      )}
                    </div>
                  </div>
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
            activeFile={activeFile}
            isLoadingFile={isLoadingFile}
            activeMainTabKind={activeMainTabKind}
            onSetPreview={(next) => {
              if (!activeFile) return;
              if (!canRunScript) return;
              if (next) {
                setActiveMainTabKind("preview");
                void runScriptForPath(activeFile.path);
              } else {
                void stopScriptForPath(activeFile.path, { closePreview: true });
              }
            }}
            canRun={Boolean(activeFile) && canRunScript}
            rightActions={null}
          />

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              {activeMainTabKind === "preview" && activeFile ? (
                <ScriptPreviewPanel
                  theme={theme}
                  state={scriptPreviewState[activeFile.path]}
                  onInvokeCallback={(token, args) => {
                    const path = activeFile.path;
                    if (useBackendEngine && activeBackendPathRef.current === path) {
                      backendScript.invokeCallback(token, args);
                    } else {
                      scriptEngineByPathRef.current.get(path)?.invoke(token, args);
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
                      setOpenFile((prev) =>
                        prev && prev.path === activeFile.path ? { ...prev, content: value ?? "", isDirty: true } : prev,
                      );
                    }}
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">Open a file from the explorer.</div>
              )}
            </div>

          </div>
        </main>
		      </div>
    </div>
  );
}
