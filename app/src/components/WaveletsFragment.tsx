import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Editor as MonacoEditor, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { appDataDir } from "@tauri-apps/api/path";
import { WaveletEngine, type WaveletTree } from "../utils/WaveletEngine";
import { createBLEServiceWrapper } from "../utils/BLEServiceWrapper";
import { useDevice } from "../utils/DeviceContext";
import { ensureEmwaverMonacoThemes, getEmwaverMonacoTheme } from "../utils/monacoTheme";
import { isTauriAvailable, safeInvoke, safeJoin } from "../utils/tauri";

const ASSET_SCRIPT_FILES = [
  "cc1101.js",
  "rfm69.js",
  "usb.js",
  "wavelet_demo.js",
  "gpio.js",
  "ir_send_saved_signal.js",
];

const WAVELET_ASSET_ROOT = "/wavelet-assets";
const WAVELETS_DIR_NAME = "wavelets";
const MIGRATION_CLEAR_KEY = "emwaver.wavelets.clearLegacy";

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

type ScriptSource = "asset" | "custom";

type ScriptEntry = {
  id: string;
  name: string;
  filename: string;
  source: ScriptSource;
  absolutePath?: string;
};

type DirectoryEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: DirectoryEntry[];
};

function normalizeScriptName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const safe = trimmed.replace(/\s+/g, "_");
  return safe.endsWith(".js") ? safe : `${safe}.js`;
}

function stripExtension(filename: string): string {
  if (!filename.endsWith(".js")) {
    return filename;
  }
  return filename.slice(0, -3);
}

async function readAssetScript(filename: string): Promise<string | null> {
  try {
    const response = await fetch(`${WAVELET_ASSET_ROOT}/${filename}`);
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch (error) {
    console.warn("Failed to load asset script:", filename, error);
    return null;
  }
}

type ThemeMode = "dark" | "light";

export default function WaveletsFragment({ theme = "dark" }: { theme?: ThemeMode }) {
  const device = useDevice();
  const [waveletsDir, setWaveletsDir] = useState<string | null>(null);
  const [customScripts, setCustomScripts] = useState<ScriptEntry[]>([]);
  const [activeScript, setActiveScript] = useState<ScriptEntry | null>(null);
  const [activeContent, setActiveContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingScript, setIsLoadingScript] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [renderedTree, setRenderedTree] = useState<WaveletTree | null>(null);

  const saveTimeoutRef = useRef<number | null>(null);
  const activeScriptRef = useRef<ScriptEntry | null>(null);
  const waveletEngineRef = useRef<WaveletEngine | null>(null);
  const monaco = useMonaco();
  const deviceRef = useRef(device);
  const commandQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    deviceRef.current = device;
  }, [device]);

  const deviceConnection = useMemo(
    () => ({
      sendCommandString: (command: string, timeoutMs: number = 1500) => {
        // The Android/iOS wavelet scripts expect `sendCommandString()` to behave synchronously
        // (commands execute in-order). Desktop scripts often don't `await`, so we enforce ordering
        // via an internal queue.
        const queued = commandQueueRef.current
          .then(async () => {
            const { status, send } = deviceRef.current;
            if (!status.connected) {
              return null;
            }
            const response = await send(command, timeoutMs, 1);
            await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
            return response;
          })
          .catch(async () => {
            // Keep the queue alive even if a command fails.
            return null;
          });

        commandQueueRef.current = queued.then(
          () => undefined,
          () => undefined,
        );
        return queued as Promise<Uint8Array | null>;
      },
      write: (data: Uint8Array) => {
        const { status, sendPacket } = deviceRef.current;
        if (!status.connected) {
          return;
        }
        const queued = commandQueueRef.current
          .then(async () => {
            await sendPacket(data, 1500, 1);
            await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
          })
          .catch(async () => {
            // keep queue alive
          });
        commandQueueRef.current = queued.then(
          () => undefined,
          () => undefined,
        );
      },
      connectionStatus: () => {
        const { status } = deviceRef.current;
        if (!status.connected) {
          return "disconnected";
        }
        return `${status.transport ?? "unknown"} connected`;
      },
    }),
    [],
  );

  const utilsBinding = useMemo(
    () => ({
      delay: (ms: number) => {
        // Match Android semantics: scripts call `Utils.delay(ms)` without `await`.
        // Use a blocking sleep so wavelet scripts behave consistently across platforms.
        const durationMs = Math.max(0, Number(ms) || 0);
        const start = Date.now();
        while (Date.now() - start < durationMs) {
          // busy-wait
        }
      },
    }),
    [],
  );

  const createByteArray = useMemo(() => (bytes: number[]) => new Uint8Array(bytes), []);

  const assetScripts = useMemo<ScriptEntry[]>(
    () =>
      ASSET_SCRIPT_FILES.map((filename) => ({
        id: `asset:${filename}`,
        name: stripExtension(filename),
        filename,
        source: "asset",
      })),
    [],
  );

  useEffect(() => {
    if (!monaco) {
      return;
    }

    ensureEmwaverMonacoThemes(monaco);

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
    activeScriptRef.current = activeScript;
  }, [activeScript]);

  useEffect(() => {
    if (!isTauriAvailable()) {
      return;
    }

    const resolveDir = async () => {
      const root = await appDataDir();
      const dir = await safeJoin(root, WAVELETS_DIR_NAME);
      await safeInvoke<void>("ensure_dir", { payload: { path: dir } });
      setWaveletsDir(dir);
    };

    void resolveDir();
  }, []);

  const loadCustomScripts = useCallback(
    async (dir: string): Promise<ScriptEntry[]> => {
      const entries = await safeInvoke<DirectoryEntry[]>("read_directory", {
        payload: { path: dir },
      });

      const scripts = (entries || [])
        .filter((entry) => entry.kind === "file" && entry.name.endsWith(".js"))
        .map((entry) => ({
          id: `custom:${entry.path}`,
          name: stripExtension(entry.name),
          filename: entry.name,
          source: "custom" as const,
          absolutePath: entry.path,
        }));

      const normalized = await Promise.all(
        scripts.map(async (entry) => ({
          ...entry,
          absolutePath: await safeJoin(dir, entry.absolutePath || entry.filename),
        })),
      );

      normalized.sort((a, b) => a.name.localeCompare(b.name));
      return normalized;
    },
    [],
  );

  const refreshCustomScripts = useCallback(async () => {
    if (!waveletsDir) {
      return;
    }
    const scripts = await loadCustomScripts(waveletsDir);
    setCustomScripts(scripts);
  }, [loadCustomScripts, waveletsDir]);

  useEffect(() => {
    if (!waveletsDir) {
      return;
    }
    void refreshCustomScripts();
  }, [refreshCustomScripts, waveletsDir]);

  useEffect(() => {
    if (!waveletsDir || typeof window === "undefined") {
      return;
    }
    const cleared = window.localStorage.getItem(MIGRATION_CLEAR_KEY);
    if (cleared) {
      return;
    }
    const clearLegacy = async () => {
      const scripts = await loadCustomScripts(waveletsDir);
      for (const script of scripts) {
        if (script.absolutePath) {
          await safeInvoke<void>("remove_path", {
            payload: { path: script.absolutePath },
          });
        }
      }
      await refreshCustomScripts();
      window.localStorage.setItem(MIGRATION_CLEAR_KEY, "true");
    };
    void clearLegacy();
  }, [loadCustomScripts, refreshCustomScripts, waveletsDir]);

  useEffect(() => {
    const engine = new WaveletEngine();

    const printCallback = (message: string) => {
      setConsoleOutput((prev) => [...prev, message]);
    };

    const renderCallback = (tree: WaveletTree) => {
      setRenderedTree(tree);
    };

    const dialogCallback = (title: string, message: string) => {
      alert(`${title}\n\n${message}`);
    };

    const bleService = createBLEServiceWrapper();

    engine.setup(printCallback, renderCallback, dialogCallback, {
      BLEService: bleService,
      DeviceConnection: deviceConnection,
      Utils: utilsBinding,
      createByteArray,
    });

    waveletEngineRef.current = engine;

    return () => {
      engine.shutdown();
      waveletEngineRef.current = null;
    };
  }, []);

  useEffect(
    () => () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    },
    [],
  );

  const readScriptContent = useCallback(async (script: ScriptEntry): Promise<string> => {
    if (script.source === "asset") {
      return (await readAssetScript(script.filename)) ?? "";
    }

    if (!script.absolutePath) {
      return "";
    }
    const content = await safeInvoke<string>("read_file", {
      payload: { path: script.absolutePath },
    });
    return content ?? "";
  }, []);

  const buildModuleSources = useCallback(async () => {
    const sources: Record<string, string> = {};
    const allScripts = [...assetScripts, ...customScripts];

    await Promise.all(
      allScripts.map(async (script) => {
        const content = await readScriptContent(script);
        if (content) {
          sources[script.filename] = content;
        }
      }),
    );

    return sources;
  }, [assetScripts, customScripts, readScriptContent]);

  const commitPendingSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const script = activeScriptRef.current;
    if (script && script.source === "custom" && script.absolutePath && isDirty) {
      setIsSaving(true);
      await safeInvoke<void>("write_file", {
        payload: { path: script.absolutePath, content: activeContent },
      });
      setIsSaving(false);
      setIsDirty(false);
    }
  }, [activeContent, isDirty]);

  const handleSelectScript = useCallback(
    async (script: ScriptEntry) => {
      await commitPendingSave();
      setIsLoadingScript(true);
      const content = await readScriptContent(script);
      setActiveScript(script);
      setActiveContent(content);
      setIsDirty(false);
      setRenderedTree(null);
      setConsoleOutput([]);
      setIsLoadingScript(false);
    },
    [commitPendingSave, readScriptContent],
  );

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!activeScript || activeScript.source !== "custom") {
        return;
      }

      const nextContent = value ?? "";
      setActiveContent(nextContent);
      setIsDirty(true);

      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = window.setTimeout(() => {
        saveTimeoutRef.current = null;
        void commitPendingSave();
      }, 600);
    },
    [activeScript, commitPendingSave],
  );

  const handleRunWavelet = useCallback(async () => {
    if (!activeScript || !waveletEngineRef.current) {
      return;
    }

    setConsoleOutput([]);
    setRenderedTree(null);

    const moduleSources = await buildModuleSources();
    waveletEngineRef.current.updateModuleSources(moduleSources);

    try {
      waveletEngineRef.current.execute(activeContent, () => {
        setConsoleOutput((prev) => [...prev, "Wavelet execution completed."]);
      });
    } catch (error) {
      console.error("Wavelet execution error:", error);
    }
  }, [activeContent, activeScript, buildModuleSources]);

  const handleCreateScript = useCallback(async () => {
    if (!waveletsDir) {
      return;
    }
    const name = window.prompt("Script name", "new_wavelet");
    if (!name) {
      return;
    }
    const filename = normalizeScriptName(name);
    if (!filename) {
      return;
    }

    const assetNames = new Set(assetScripts.map((script) => script.filename.toLowerCase()));
    const customNames = new Set(customScripts.map((script) => script.filename.toLowerCase()));

    if (assetNames.has(filename.toLowerCase()) || customNames.has(filename.toLowerCase())) {
      alert("A script with that name already exists.");
      return;
    }

    const filePath = await safeJoin(waveletsDir, filename);
    const template = "// New wavelet\n\nUI.render(UI.column({\n  children: [\n    UI.text({ text: 'Hello from wavelets!' })\n  ]\n}));\n";

    await safeInvoke<void>("write_file", {
      payload: { path: filePath, content: template },
    });

    await refreshCustomScripts();
    await handleSelectScript({
      id: `custom:${filename}`,
      name: stripExtension(filename),
      filename,
      source: "custom",
      absolutePath: filePath,
    });
  }, [assetScripts, customScripts, handleSelectScript, refreshCustomScripts, waveletsDir]);

  const handleDeleteScript = useCallback(async () => {
    if (!activeScript || activeScript.source !== "custom" || !activeScript.absolutePath) {
      return;
    }

    const confirmed = window.confirm(`Delete ${activeScript.name}?`);
    if (!confirmed) {
      return;
    }

    await safeInvoke<void>("remove_path", {
      payload: { path: activeScript.absolutePath },
    });

    setActiveScript(null);
    setActiveContent("");
    setIsDirty(false);
    setRenderedTree(null);
    setConsoleOutput([]);
    await refreshCustomScripts();
  }, [activeScript, refreshCustomScripts]);

  const handleCopyAssetToCustom = useCallback(async () => {
    if (!activeScript || activeScript.source !== "asset" || !waveletsDir) {
      return;
    }

    const defaultName = `${activeScript.name}_copy`;
    const name = window.prompt("Copy to custom script as", defaultName);
    if (!name) {
      return;
    }

    const filename = normalizeScriptName(name);
    if (!filename) {
      return;
    }

    const assetNames = new Set(assetScripts.map((script) => script.filename.toLowerCase()));
    const customNames = new Set(customScripts.map((script) => script.filename.toLowerCase()));

    if (assetNames.has(filename.toLowerCase()) || customNames.has(filename.toLowerCase())) {
      alert("A script with that name already exists.");
      return;
    }

    const content = await readScriptContent(activeScript);
    const filePath = await safeJoin(waveletsDir, filename);
    await safeInvoke<void>("write_file", {
      payload: { path: filePath, content },
    });
    await refreshCustomScripts();
    await handleSelectScript({
      id: `custom:${filename}`,
      name: stripExtension(filename),
      filename,
      source: "custom",
      absolutePath: filePath,
    });
  }, [activeScript, assetScripts, customScripts, handleSelectScript, readScriptContent, refreshCustomScripts, waveletsDir]);

  const editorOptions = useMemo(
    () => ({
      ...MONACO_EDITOR_OPTIONS,
      readOnly: activeScript?.source === "asset",
    }),
    [activeScript],
  );

  return (
    <section className="flex flex-1 flex-col bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-900 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Wavelets</h2>
          <p className="text-sm text-slate-400">Manage and run wavelet scripts</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCreateScript}
            className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-900 transition-colors hover:bg-sky-400"
          >
            New Script
          </button>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <aside className="w-72 border-r border-slate-900 bg-slate-950 p-4">
          <ScriptSection
            title="Asset Scripts"
            scripts={assetScripts}
            activeId={activeScript?.id ?? null}
            onSelect={handleSelectScript}
            emptyLabel="No asset scripts found."
          />
          <div className="mt-6">
            <ScriptSection
              title="Custom Scripts"
              scripts={customScripts}
              activeId={activeScript?.id ?? null}
              onSelect={handleSelectScript}
              emptyLabel="No custom scripts yet."
            />
          </div>
        </aside>
        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex items-center justify-between border-b border-slate-900 bg-slate-950 px-4 py-2">
            <div className="flex items-center gap-2">
              <button
                onClick={handleRunWavelet}
                disabled={!activeScript || !waveletEngineRef.current}
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
                title="Clear output"
              >
                Clear
              </button>
              {renderedTree && (
                <button
                  onClick={() => setRenderedTree(null)}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 rounded hover:border-slate-700 transition-colors"
                  title="Return to editor"
                >
                  ← Editor
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {activeScript?.source === "asset" && (
                <button
                  onClick={handleCopyAssetToCustom}
                  className="px-3 py-1.5 text-xs text-slate-200 border border-slate-700 rounded hover:border-sky-500 hover:text-sky-200 transition-colors"
                >
                  Copy to Custom
                </button>
              )}
              {activeScript?.source === "custom" && (
                <button
                  onClick={handleDeleteScript}
                  className="px-3 py-1.5 text-xs text-rose-200 border border-rose-800 rounded hover:border-rose-500 transition-colors"
                >
                  Delete
                </button>
              )}
              {isSaving && (
                <span className="text-xs text-slate-500">Saving…</span>
              )}
              {!isSaving && isDirty && (
                <span className="text-xs text-amber-300">Unsaved</span>
              )}
            </div>
          </div>
          <div className="flex-1 min-h-0 bg-slate-950 flex flex-col">
            {activeScript ? (
              renderedTree ? (
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
                </div>
              ) : (
                <div className="flex h-full w-full min-h-0">
                  <div className="flex-1 min-h-0">
                    <MonacoEditor
                      key={activeScript.id}
                      path={activeScript.filename}
                      value={activeContent}
                      language="javascript"
                      onChange={handleEditorChange}
                      options={editorOptions}
                      theme={getEmwaverMonacoTheme(theme)}
                      height="100%"
                      loading={
                        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
                          Loading editor...
                        </div>
                      }
                    />
                  </div>
                </div>
              )
            ) : isLoadingScript ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
                Loading script...
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
                Select a script to view or run it.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ScriptSection({
  title,
  scripts,
  activeId,
  onSelect,
  emptyLabel,
}: {
  title: string;
  scripts: ScriptEntry[];
  activeId: string | null;
  onSelect: (script: ScriptEntry) => void;
  emptyLabel: string;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
        {title}
      </h3>
      {scripts.length === 0 ? (
        <p className="text-xs text-slate-600">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {scripts.map((script) => {
            const isActive = script.id === activeId;
            return (
              <button
                key={script.id}
                onClick={() => onSelect(script)}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  isActive
                    ? "bg-slate-800 text-slate-100"
                    : "text-slate-300 hover:bg-slate-900 hover:text-slate-100"
                }`}
              >
                <span className="truncate">{script.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-slate-500">
                  {script.source === "asset" ? "Asset" : "Custom"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WaveletUIRenderer({
  tree,
  consoleOutput = [],
  onInvokeCallback,
}: {
  tree: WaveletTree;
  consoleOutput?: string[];
  onInvokeCallback?: (token: string, args: unknown[]) => void;
}) {
  const [inputValues, setInputValues] = useState<Record<string, any>>({});

  const resolvePadding = (value: unknown): React.CSSProperties | undefined => {
    if (typeof value === "number") {
      return { padding: `${value}px` };
    }
    if (value && typeof value === "object") {
      const raw = value as {
        top?: number;
        bottom?: number;
        leading?: number;
        trailing?: number;
        left?: number;
        right?: number;
      };
      const top = raw.top ?? 0;
      const bottom = raw.bottom ?? 0;
      const left = raw.left ?? raw.leading ?? 0;
      const right = raw.right ?? raw.trailing ?? 0;
      return {
        paddingTop: `${top}px`,
        paddingBottom: `${bottom}px`,
        paddingLeft: `${left}px`,
        paddingRight: `${right}px`,
      };
    }
    return undefined;
  };

  const renderNode = (node: WaveletTree): ReactNode => {
    const props = node.props || {};
    const children = node.children || [];
    const handlers = (node as any).handlers || {};
    const nodeId = (props.id as string) || "node";
    const paddingStyle = resolvePadding((props as any).padding);

    switch (node.type) {
      case "column": {
        const spacing = (props.spacing as number) || 12;
        const padding = (props.padding as number) || 0;
        return (
          <div
            className="flex flex-col"
            style={{
              gap: `${spacing}px`,
              padding: `${padding}px`,
              width: "100%",
            }}
          >
            {children.map((child, index) => (
              <div key={index}>{renderNode(child)}</div>
            ))}
          </div>
        );
      }

      case "row": {
        const spacing = (props.spacing as number) || 8;
        return (
          <div className="flex w-full" style={{ gap: `${spacing}px` }}>
            {children.map((child, index) => (
              <div key={index}>{renderNode(child)}</div>
            ))}
          </div>
        );
      }

      case "button": {
        const handleClick = () => {
          if (handlers.tap && onInvokeCallback) {
            onInvokeCallback(handlers.tap, []);
          }
        };
        const backgroundColor = props.backgroundColor as string | undefined;
        const foregroundColor = props.foregroundColor as string | undefined;
        const cornerRadius = props.cornerRadius as number | undefined;
        const width = props.width as string | number | undefined;
        return (
          <button
            onClick={handleClick}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
            style={{
              backgroundColor,
              color: foregroundColor,
              borderRadius: cornerRadius ? `${cornerRadius}px` : undefined,
              ...(width ? { width } : null),
              ...paddingStyle,
            }}
          >
            {(props.label as string) || "Button"}
          </button>
        );
      }

      case "text":
        return (
          <div
            className="text-slate-200 text-sm"
            style={{
              color: (props.foregroundColor as string | undefined) ?? undefined,
              backgroundColor: props.backgroundColor as string | undefined,
              borderRadius:
                typeof props.cornerRadius === "number"
                  ? `${props.cornerRadius}px`
                  : undefined,
              ...paddingStyle,
            }}
          >
            {(props.text as string) || ""}
          </div>
        );

      case "slider": {
        const min = (props.min as number) || 0;
        const max = (props.max as number) || 100;
        const value =
          inputValues[nodeId] !== undefined
            ? inputValues[nodeId]
            : ((props.value as number) || 0);
        const step = (props.step as number) || 1;

        const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
          const newValue = parseFloat(event.target.value);
          setInputValues((prev) => ({ ...prev, [nodeId]: newValue }));
          if (handlers.change && onInvokeCallback) {
            onInvokeCallback(handlers.change, [newValue]);
          }
        };

        return (
          <div className="flex flex-col gap-2">
            {Boolean(props.label) && (
              <label className="text-slate-300 text-sm">{props.label as string}</label>
            )}
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

      case "textField": {
        const value =
          inputValues[nodeId] !== undefined
            ? inputValues[nodeId]
            : ((props.value as string) || "");
        const placeholder = (props.placeholder as string) || "";

        const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
          const newValue = event.target.value;
          setInputValues((prev) => ({ ...prev, [nodeId]: newValue }));
          if (handlers.change && onInvokeCallback) {
            onInvokeCallback(handlers.change, [newValue]);
          }
        };

        const handleSubmit = (event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter" && handlers.submit && onInvokeCallback) {
            onInvokeCallback(handlers.submit, [value]);
          }
        };

        return (
          <div className="flex flex-col gap-2">
            {Boolean(props.label) && (
              <label className="text-slate-300 text-sm">{props.label as string}</label>
            )}
            <input
              type="text"
              value={value}
              placeholder={placeholder}
              onChange={handleChange}
              onKeyDown={handleSubmit}
              className="w-full px-3 py-2 bg-slate-800 text-slate-200 border border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
        );
      }

      case "textEditor": {
        const value =
          inputValues[nodeId] !== undefined
            ? inputValues[nodeId]
            : ((props.value as string) || "");
        const placeholder = (props.placeholder as string) || "";
        const rows = (props.rows as number) || 4;

        const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
          const newValue = event.target.value;
          setInputValues((prev) => ({ ...prev, [nodeId]: newValue }));
          if (handlers.change && onInvokeCallback) {
            onInvokeCallback(handlers.change, [newValue]);
          }
        };

        return (
          <div className="flex flex-col gap-2">
            {Boolean(props.label) && (
              <label className="text-slate-300 text-sm">{props.label as string}</label>
            )}
            <textarea
              value={value}
              placeholder={placeholder}
              onChange={handleChange}
              rows={rows}
              className="w-full px-3 py-2 bg-slate-800 text-slate-200 border border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
            />
          </div>
        );
      }

      case "picker": {
        const options = Array.isArray(props.options) ? (props.options as unknown[]) : [];
        const normalizedOptions = options
          .map((option) => {
            if (typeof option === "string") {
              return { label: option, value: option };
            }
            if (option && typeof option === "object") {
              const raw = option as { label?: unknown; value?: unknown };
              const label = raw.label ?? raw.value ?? "";
              const value = raw.value ?? raw.label ?? "";
              return { label: String(label), value: String(value) };
            }
            return { label: "", value: "" };
          })
          .filter((option) => option.value !== "");
        const initialValue =
          (props.selected as string | undefined) ??
          (props.value as string | undefined) ??
          normalizedOptions[0]?.value ??
          "";
        const value =
          inputValues[nodeId] !== undefined ? inputValues[nodeId] : initialValue;

        const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
          const newValue = event.target.value;
          setInputValues((prev) => ({ ...prev, [nodeId]: newValue }));
          if (handlers.change && onInvokeCallback) {
            onInvokeCallback(handlers.change, [newValue]);
          }
        };

        return (
          <div className="flex flex-col gap-2">
            {Boolean(props.label) && (
              <label className="text-slate-300 text-sm">{props.label as string}</label>
            )}
            <select
              value={value}
              onChange={handleChange}
              className="w-full px-3 py-2 bg-slate-800 text-slate-200 border border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              {normalizedOptions.map((option, index) => (
                <option key={index} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        );
      }

      case "scroll": {
        const maxHeight = props.maxHeight as number | undefined;
        return (
          <div
            className="w-full overflow-y-auto"
            style={maxHeight ? { maxHeight: `${maxHeight}px` } : { height: "100%" }}
          >
            {children.map((child, index) => (
              <div key={index}>{renderNode(child)}</div>
            ))}
          </div>
        );
      }

      case "grid": {
        const columns = (props.columns as number) || 2;
        const spacing = (props.spacing as number) || 8;
        return (
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gap: `${spacing}px`,
            }}
          >
            {children.map((child, index) => (
              <div key={index}>{renderNode(child)}</div>
            ))}
          </div>
        );
      }

      case "spacer": {
        const height = (props.height as number) || 16;
        return <div style={{ height: `${height}px` }} />;
      }

      case "divider": {
        return (
          <hr
            className="border-slate-700 my-2"
            style={{
              borderColor: props.backgroundColor as string | undefined,
            }}
          />
        );
      }

      case "progress": {
        const value = (props.value as number) || 0;
        const max = (props.max as number) || 100;
        const percentage = (value / max) * 100;

        return (
          <div className="flex flex-col gap-2">
            {Boolean(props.label) && (
              <label className="text-slate-300 text-sm">{props.label as string}</label>
            )}
            <div className="w-full bg-slate-800 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        );
      }

      case "logViewer": {
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
                {(props.text as string) || "Console messages will appear here..."}
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
