import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiffEditor, Editor as MonacoEditor, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { ensureEmwaverMonacoThemes, getEmwaverMonacoTheme } from "../../utils/monacoTheme";
import { isTauriAvailable, safeInvoke, safeListen } from "../../utils/tauri";
import { createBLEServiceWrapper } from "../../utils/BLEServiceWrapper";
import { useDevice } from "../../utils/DeviceContext";
import { WaveletEngine, type WaveletTree } from "../../utils/WaveletEngine";
import { readIdeTabState, writeIdeTabState } from "../ideTabState";
import { readWaveletsTabState, writeWaveletsTabState } from "../waveletsTabState";
import WaveletUIRenderer from "../wavelets/WaveletUIRenderer";

type ThemeMode = "dark" | "light";

export type WorkspaceVariant = "ide" | "wavelets";

type BottomPanelTab = "terminal" | "firmware";

type FirmwareProgressPayload = {
  message: string;
  stream?: "info" | "stdout" | "stderr" | string;
  timestamp_ms?: number;
};

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

type FirmwareProjectKind = "esp32" | "stm32" | "unknown";

type OpenFile = {
  path: string;
  name: string;
  content: string;
  language: string;
  isDirty: boolean;
  diskMtimeMs?: number;
};

type GitStatusEntry = {
  path: string;
  orig_path?: string | null;
  index_status: string;
  worktree_status: string;
  is_untracked: boolean;
  is_ignored: boolean;
};

type GitRepoStatus = {
  repo_root: string;
  branch?: string | null;
  upstream?: string | null;
  ahead: number;
  behind: number;
  staged: GitStatusEntry[];
  changes: GitStatusEntry[];
  timestamp_ms: number;
};

type GitDiffContents = {
  original: string;
  modified: string;
  is_binary: boolean;
};

type NewProjectPayload = {
  name: string;
  location: string;
  target: "esp32s3" | "stm32f042";
  components: Array<"ble" | "command_registry" | "ota" | "gpio" | "sampler" | "cc1101" | "rfm69" | "mfrc522">;
  stm32_firmware?: "gpio" | "ir" | "ism" | "rfid" | null;
};

type CreateProjectResponse = {
  path: string;
};

const DEFAULT_TERMINAL_TITLE = "zsh";

const FILE_AUTO_RELOAD_INTERVAL_MS = 2000;

const WAVELET_ASSET_ROOT = "/wavelet-assets";
const WAVELET_BOOTSTRAP_FILENAME = "wavelet_bootstrap.js";
const WAVELET_ASSET_SCRIPTS = ["cc1101.js", "rfm69.js", "usb.js", "wavelet_demo.js", "gpio.js", "ir_send_saved_signal.js"];

type WorkspaceStorageKeys = {
  root: string;
  sidebarWidth: string;
  sidebarCollapsed: string;
  terminalHeight: string;
  terminalListWidth: string;
  terminalListCollapsed: string;
  legacy?: Partial<WorkspaceStorageKeys>;
};

function storageKeys(variant: WorkspaceVariant): WorkspaceStorageKeys {
  if (variant === "wavelets") {
    return {
      root: "emwaver.waveletsWorkspace.root",
      sidebarWidth: "emwaver.waveletsWorkspace.sidebarWidth",
      sidebarCollapsed: "emwaver.waveletsWorkspace.sidebarCollapsed",
      terminalHeight: "emwaver.waveletsWorkspace.terminalHeight",
      terminalListWidth: "emwaver.waveletsWorkspace.terminalListWidth",
      terminalListCollapsed: "emwaver.waveletsWorkspace.terminalListCollapsed",
    };
  }

  return {
    root: "emwaver.ide.root",
    sidebarWidth: "emwaver.ide.sidebarWidth",
    sidebarCollapsed: "emwaver.ide.sidebarCollapsed",
    terminalHeight: "emwaver.ide.terminalHeight",
    terminalListWidth: "emwaver.ide.terminalListWidth",
    terminalListCollapsed: "emwaver.ide.terminalListCollapsed",
    legacy: {
      root: "emwaver.devtools.root",
      sidebarWidth: "emwaver.devtools.sidebarWidth",
      sidebarCollapsed: "emwaver.devtools.sidebarCollapsed",
      terminalHeight: "emwaver.devtools.terminalHeight",
      terminalListWidth: "emwaver.devtools.terminalListWidth",
      terminalListCollapsed: "emwaver.devtools.terminalListCollapsed",
    },
  };
}

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
const TERMINAL_VIEW_MIN_WIDTH = 320;

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

function readStoredRoot(keys: WorkspaceStorageKeys): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const stored = window.localStorage.getItem(keys.root);
  if (stored) {
    return stored;
  }
  const legacyKey = keys.legacy?.root;
  if (!legacyKey) {
    return null;
  }
  const legacy = window.localStorage.getItem(legacyKey);
  if (!legacy) {
    return null;
  }
  window.localStorage.setItem(keys.root, legacy);
  window.localStorage.removeItem(legacyKey);
  return legacy;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readStoredSidebarWidth(keys: WorkspaceStorageKeys): number {
  if (typeof window === "undefined") {
    return DEFAULT_SIDEBAR_WIDTH;
  }
  const stored = window.localStorage.getItem(keys.sidebarWidth);
  const selected = stored ?? (keys.legacy?.sidebarWidth ? window.localStorage.getItem(keys.legacy.sidebarWidth) : null);
  if (!selected) {
    return DEFAULT_SIDEBAR_WIDTH;
  }
  if (!stored) {
    window.localStorage.setItem(keys.sidebarWidth, selected);
    if (keys.legacy?.sidebarWidth) {
      window.localStorage.removeItem(keys.legacy.sidebarWidth);
    }
  }
  const parsed = Number.parseFloat(selected);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }
  return clamp(parsed, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
}

function readStoredSidebarCollapsed(keys: WorkspaceStorageKeys): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const stored = window.localStorage.getItem(keys.sidebarCollapsed);
  const selected =
    stored ?? (keys.legacy?.sidebarCollapsed ? window.localStorage.getItem(keys.legacy.sidebarCollapsed) : null);
  if (!selected) {
    return false;
  }
  if (!stored) {
    window.localStorage.setItem(keys.sidebarCollapsed, selected);
    if (keys.legacy?.sidebarCollapsed) {
      window.localStorage.removeItem(keys.legacy.sidebarCollapsed);
    }
  }
  return selected === "true";
}

function readStoredTerminalHeight(keys: WorkspaceStorageKeys): number {
  if (typeof window === "undefined") {
    return DEFAULT_TERMINAL_HEIGHT;
  }
  const stored = window.localStorage.getItem(keys.terminalHeight);
  const selected = stored ?? (keys.legacy?.terminalHeight ? window.localStorage.getItem(keys.legacy.terminalHeight) : null);
  if (!selected) {
    return DEFAULT_TERMINAL_HEIGHT;
  }
  if (!stored) {
    window.localStorage.setItem(keys.terminalHeight, selected);
    if (keys.legacy?.terminalHeight) {
      window.localStorage.removeItem(keys.legacy.terminalHeight);
    }
  }
  const parsed = Number.parseFloat(selected);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TERMINAL_HEIGHT;
  }
  return clamp(parsed, TERMINAL_MIN_HEIGHT, TERMINAL_MAX_HEIGHT);
}

function readStoredTerminalListWidth(keys: WorkspaceStorageKeys): number {
  if (typeof window === "undefined") {
    return DEFAULT_TERMINAL_LIST_WIDTH;
  }
  const stored = window.localStorage.getItem(keys.terminalListWidth);
  const selected =
    stored ?? (keys.legacy?.terminalListWidth ? window.localStorage.getItem(keys.legacy.terminalListWidth) : null);
  if (!selected) {
    return DEFAULT_TERMINAL_LIST_WIDTH;
  }
  if (!stored) {
    window.localStorage.setItem(keys.terminalListWidth, selected);
    if (keys.legacy?.terminalListWidth) {
      window.localStorage.removeItem(keys.legacy.terminalListWidth);
    }
  }
  const parsed = Number.parseFloat(selected);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TERMINAL_LIST_WIDTH;
  }
  return clamp(parsed, TERMINAL_LIST_MIN_WIDTH, TERMINAL_LIST_MAX_WIDTH);
}

function readStoredTerminalListCollapsed(keys: WorkspaceStorageKeys): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const stored = window.localStorage.getItem(keys.terminalListCollapsed);
  const selected =
    stored ?? (keys.legacy?.terminalListCollapsed ? window.localStorage.getItem(keys.legacy.terminalListCollapsed) : null);
  if (!selected) {
    return false;
  }
  if (!stored) {
    window.localStorage.setItem(keys.terminalListCollapsed, selected);
    if (keys.legacy?.terminalListCollapsed) {
      window.localStorage.removeItem(keys.legacy.terminalListCollapsed);
    }
  }
  return selected === "true";
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

function isWaveletScriptPath(path: string): boolean {
  const ext = extension(path);
  return ext === "js" || ext === "jsx" || ext === "ts" || ext === "tsx";
}

function defaultIgnoredName(name: string): boolean {
  return (
    name === ".git" ||
    name === "node_modules" ||
    name === "dist" ||
    name === "build" ||
    name === "target" ||
    name === ".next" ||
    name === ".emwaver"
  );
}

async function readWaveletAssetScript(filename: string): Promise<string> {
  try {
    const response = await fetch(`${WAVELET_ASSET_ROOT}/${filename}`);
    if (!response.ok) {
      return "";
    }
    return await response.text();
  } catch {
    return "";
  }
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

function MinusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className ?? "h-4 w-4"}>
      <path d="M3.3 8h9.4" strokeLinecap="round" />
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

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className ?? "h-4 w-4"} aria-hidden="true">
      <path d="M5.2 3.6a.8.8 0 011.2-.7l6.2 3.6a.8.8 0 010 1.4l-6.2 3.6a.8.8 0 01-1.2-.7V3.6z" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={className ?? "h-4 w-4"}>
      <path d="M8 9.2V3.6" strokeLinecap="round" />
      <path d="M5.4 6.2L8 3.6l2.6 2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 9.6v2.2c0 .6.4 1 1 1h7c.6 0 1-.4 1-1V9.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HammerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={className ?? "h-4 w-4"} aria-hidden="true">
      <path d="M9.6 2.6l3.8 3.8-1.3 1.3-3.8-3.8z" strokeLinejoin="round" />
      <path d="M7.6 4.6l3.8 3.8" strokeLinecap="round" />
      <path d="M6.8 6.3L3 10.1c-.5.5-.5 1.3 0 1.8l1.1 1.1c.5.5 1.3.5 1.8 0l3.8-3.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.2 3.9l1.7-1.7 2.2 2.2-1.7 1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={className ?? "h-4 w-4"} aria-hidden="true">
      <path d="M3 3.5h10c.6 0 1 .4 1 1v6.2c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V4.5c0-.6.4-1 1-1z" strokeLinejoin="round" />
      <path d="M6.2 13.5h3.6" strokeLinecap="round" />
      <path d="M8 11.7v1.8" strokeLinecap="round" />
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

function GitIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      className={className ?? "h-4 w-4"}
      aria-hidden="true"
    >
      <path d="M5.2 4.2a2 2 0 104 0 2 2 0 00-4 0z" />
      <path d="M6.2 6.1v3.8a2 2 0 101.6 0V6.1" strokeLinecap="round" />
      <path d="M8 10.9h2.6a2 2 0 101.4-3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={className ?? "h-4 w-4"}>
      <path
        d="M13.2 7.1A5.4 5.4 0 103 12.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12.8 3.4v3.8H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowUpIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className={className ?? "h-4 w-4"}>
      <path d="M8 12.7V3.7" strokeLinecap="round" />
      <path d="M4.7 6.9L8 3.6l3.3 3.3" strokeLinecap="round" strokeLinejoin="round" />
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
  if (ext === "md") return { label: "M", accentClass: "text-slate-300" };
  if (ext === "rs") return { label: "RS", accentClass: "text-orange-300" };
  if (ext === "c") return { label: "C", accentClass: "text-sky-300" };
  if (ext === "h") return { label: "H", accentClass: "text-pink-300" };
  if (ext === "toml") return { label: "T", accentClass: "text-slate-300" };
  if (ext === "yml" || ext === "yaml") return { label: "Y", accentClass: "text-emerald-300" };
  if (ext === "sh") return { label: "$", accentClass: "text-emerald-300" };
  return { label: "•", accentClass: "text-slate-400" };
}

function detectFirmwareProjectKind(entries: DirectoryChildEntry[]): FirmwareProjectKind {
  const hasFile = (name: string) => entries.some((entry) => entry.kind === "file" && entry.name === name);
  const hasDir = (name: string) => entries.some((entry) => entry.kind === "directory" && entry.name === name);

  if (hasFile("setup.sh") && hasFile("sdkconfig") && hasFile("CMakeLists.txt")) {
    return "esp32";
  }

  const hasIoc = entries.some((entry) => entry.kind === "file" && entry.name.toLowerCase().endsWith(".ioc"));
  if (hasDir("Release") && hasIoc) {
    return "stm32";
  }

  return "unknown";
}

let ideFirmwareWarmupKey: string | null = null;
let ideCachedTerminalSessionId: string | null = null;
let ideCachedFirmwareBuildSessionId: string | null = null;
let ideCachedFirmwareMonitorSessionId: string | null = null;

export default function WorkspaceShell({
  variant,
  theme = "dark",
  isActive = false,
}: {
  variant: WorkspaceVariant;
  theme?: ThemeMode;
  isActive?: boolean;
}) {
  const keys = storageKeys(variant);
  const tabStateFileName = variant === "ide" ? "ide-tabs.json" : "wavelets-tabs.json";
  const readTabState = variant === "ide" ? readIdeTabState : readWaveletsTabState;
  const writeTabState = variant === "ide" ? writeIdeTabState : writeWaveletsTabState;

  const [rootDir, setRootDir] = useState<string | null>(() => readStoredRoot(keys));
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
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

  const [gitStatus, setGitStatus] = useState<GitRepoStatus | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [gitHasChecked, setGitHasChecked] = useState(false);
  const [isGitLoading, setIsGitLoading] = useState(false);
  const [isGitBusy, setIsGitBusy] = useState(false);
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const [gitSelectedDiff, setGitSelectedDiff] = useState<{
    path: string;
    view: "staged" | "unstaged";
    orig_path?: string | null;
  } | null>(null);
  const [gitDiffContents, setGitDiffContents] = useState<GitDiffContents | null>(null);
  const [isGitDiffLoading, setIsGitDiffLoading] = useState(false);

  const explorerResizeActiveRef = useRef(false);
  const explorerResizeStartXRef = useRef(0);
  const explorerResizeStartWidthRef = useRef(0);

  const [isTerminalVisible, setIsTerminalVisible] = useState(false);
  const [bottomPanelTab, setBottomPanelTab] = useState<BottomPanelTab>("terminal");
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

  const [terminalSessions, setTerminalSessions] = useState<TerminalSession[]>([]);
  const [activeTerminalSessionId, setActiveTerminalSessionId] = useState<string | null>(null);
  const [isTerminalPickerOpen, setIsTerminalPickerOpen] = useState(false);
  const terminalPickerAnchorRef = useRef<HTMLDivElement | null>(null);

  const [firmwareProgressPct, setFirmwareProgressPct] = useState<number | null>(null);
  const [firmwareBuildHasOutput, setFirmwareBuildHasOutput] = useState(false);
  const [firmwareMonitorHasOutput, setFirmwareMonitorHasOutput] = useState(false);
  const [isFirmwareBusy, setIsFirmwareBusy] = useState(false);
  const [firmwareCodegenMode, setFirmwareCodegenMode] = useState<"auto" | "always" | "never">("auto");
  const [firmwarePanelTab, setFirmwarePanelTab] = useState<"build" | "monitor">("build");

  const firmwareBuildPtySessionIdRef = useRef<string | null>(null);
  const firmwareBuildEnvReadyRef = useRef(false);
  const firmwareBuildEnvKeyRef = useRef<string | null>(null);

  const firmwareMonitorPtySessionIdRef = useRef<string | null>(null);
  const firmwareMonitorEnvReadyRef = useRef(false);
  const firmwareMonitorEnvKeyRef = useRef<string | null>(null);

  const firmwareMonitorRunningRef = useRef(false);
  const firmwareMonitorRunningKeyRef = useRef<string | null>(null);
  const [isFirmwareMonitorRunning, setIsFirmwareMonitorRunning] = useState(false);

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

  const firmwareBuildTerminalContainerRef = useRef<HTMLDivElement | null>(null);
  const firmwareBuildTerminalRef = useRef<Terminal | null>(null);
  const firmwareBuildFitAddonRef = useRef<FitAddon | null>(null);
  const pendingFirmwareBuildTextRef = useRef<string[]>([]);

  const firmwareMonitorTerminalContainerRef = useRef<HTMLDivElement | null>(null);
  const firmwareMonitorTerminalRef = useRef<Terminal | null>(null);
  const firmwareMonitorFitAddonRef = useRef<FitAddon | null>(null);
  const pendingFirmwareMonitorTextRef = useRef<string[]>([]);

  const monaco = useMonaco();
  const device = useDevice();

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
  const firmwareProjectKind = useMemo((): FirmwareProjectKind => {
    if (!explorerRoot) {
      return "unknown";
    }
    const entries = dirChildren[explorerRoot] ?? [];
    if (entries.length === 0) {
      return "unknown";
    }
    return detectFirmwareProjectKind(entries);
  }, [dirChildren, explorerRoot]);
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

  const waveletTargetPath = useMemo(() => activeFilePath ?? selectedPath ?? null, [activeFilePath, selectedPath]);
  const canRunWavelet = useMemo(() => {
    if (variant !== "wavelets" || !rootDir || !waveletTargetPath) {
      return false;
    }
    return isWaveletScriptPath(waveletTargetPath);
  }, [rootDir, variant, waveletTargetPath]);

  const effectiveBottomPanelTab: BottomPanelTab = variant === "ide" ? bottomPanelTab : "terminal";

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
      const candidates = snapshot.filter((file) => !file.isDirty);
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

  const gitRepoIssue = useMemo(() => {
    const message = (gitError ?? "").toLowerCase();
    if (!message) {
      return null;
    }
    if (message.includes("not a git repository")) {
      return "not_repo" as const;
    }
    if (message.includes("git is not installed")) {
      return "git_missing" as const;
    }
    return null;
  }, [gitError]);
  const showGitNeedsInitIndicator = gitRepoIssue === "not_repo";

  const refreshGit = useCallback(async () => {
    if (!rootDir || !isTauriAvailable()) {
      setGitStatus(null);
      setGitError(null);
      setGitHasChecked(false);
      return;
    }
    setIsGitLoading(true);
    if (!gitHasChecked) {
      setGitStatus(null);
      setGitError(null);
    }
    try {
      const status = await safeInvoke<GitRepoStatus>("git_status", { payload: { path: rootDir } }, { throwOnError: true });
      setGitStatus(status ?? null);
      setGitError(null);
    } catch (error) {
      setGitStatus(null);
      setGitError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsGitLoading(false);
      setGitHasChecked(true);
    }
  }, [gitHasChecked, rootDir]);

  useEffect(() => {
    void refreshGit();
  }, [refreshGit]);

  useEffect(() => {
    if (sidebarPanel === "git" && !gitHasChecked) {
      void refreshGit();
    }
  }, [gitHasChecked, refreshGit, sidebarPanel]);

  useEffect(() => {
    if (!gitSelectedDiff || !rootDir || !isTauriAvailable()) {
      setGitDiffContents(null);
      return;
    }

    let canceled = false;
    setIsGitDiffLoading(true);
    setGitError(null);
    void safeInvoke<GitDiffContents>("git_diff_contents", {
      payload: {
        path: rootDir,
        file_path: gitSelectedDiff.path,
        view: gitSelectedDiff.view,
        orig_path: gitSelectedDiff.orig_path ?? undefined,
      },
    }, { throwOnError: true })
      .then((contents) => {
        if (canceled) return;
        setGitDiffContents(contents ?? null);
      })
      .catch((error) => {
        if (canceled) return;
        setGitDiffContents(null);
        setGitError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (canceled) return;
        setIsGitDiffLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [gitSelectedDiff, rootDir]);

  useEffect(() => {
    sessionsRef.current = terminalSessions;
  }, [terminalSessions]);

  useEffect(() => {
    if (firmwareProjectKind !== "stm32" && firmwareCodegenMode !== "auto") {
      setFirmwareCodegenMode("auto");
    }
  }, [firmwareCodegenMode, firmwareProjectKind]);

  useEffect(() => {
    if (variant !== "ide" && bottomPanelTab === "firmware") {
      setBottomPanelTab("terminal");
    }
  }, [bottomPanelTab, variant]);

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
    setIsTerminalPickerOpen(false);
  }, [bottomPanelTab]);

  useEffect(() => {
    if (!isTerminalVisible) {
      setIsTerminalPickerOpen(false);
    }
  }, [isTerminalVisible]);

  const updateFirmwareProgressFromMessage = useCallback((message: string) => {
    const matches = message.match(/(\d{1,3})%/g);
    if (!matches || matches.length === 0) {
      return;
    }
    const last = matches[matches.length - 1];
    const value = Number.parseInt(last.replace("%", ""), 10);
    if (!Number.isFinite(value)) {
      return;
    }
    setFirmwareProgressPct(Math.max(0, Math.min(100, value)));
  }, []);

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
    if (typeof window === "undefined") {
      return;
    }
    if (!rootDir) {
      window.localStorage.removeItem(keys.root);
      if (keys.legacy?.root) {
        window.localStorage.removeItem(keys.legacy.root);
      }
      return;
    }
    window.localStorage.setItem(keys.root, rootDir);
    if (keys.legacy?.root) {
      window.localStorage.removeItem(keys.legacy.root);
    }
  }, [rootDir]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    if (!rootDir || !isTauriAvailable()) {
      restoredTabsRootRef.current = null;
      restoringTabsRef.current = false;
      tabsHydratedRef.current = false;
      return;
    }

    // When the IDE pane becomes active, always hydrate from disk for the current root.
    restoredTabsRootRef.current = rootDir;
    tabsHydratedRef.current = false;
    tabsRestoreSucceededRef.current = false;
    tabsUserTouchedRef.current = false;

    let canceled = false;

    void (async () => {
      const state = await readTabState(rootDir);
      if (canceled || !state || state.open.length === 0) {
        restoringTabsRef.current = false;
        tabsHydratedRef.current = true;
        return;
      }

      tabsRestoreSucceededRef.current = true;

      restoringTabsRef.current = true;
      setIsLoadingFile(true);
      try {
        const rootPrefix = rootDir.replace(/\\/g, "/").replace(/\/$/, "");
        const stateFilePath = `${rootPrefix}/.emwaver/${tabStateFileName}`;

        const paths = Array.from(new Set(state.open))
          .filter((path) => typeof path === "string")
          .filter((path) => path.replace(/\\/g, "/") !== stateFilePath);
        if (paths.length === 0) {
          return;
        }

        const restored = await Promise.all(
          paths.map(async (path) => {
            const [content, diskMtimeMs] = await Promise.all([
              safeInvoke<string>("read_file", { payload: { path } }),
              safeInvoke<number>("file_modified_ms", { payload: { path } })
                .then((value) => value ?? undefined)
                .catch(() => undefined),
            ]);

            return {
              path,
              name: basename(path),
              content: content ?? "",
              language: languageForPath(path),
              isDirty: false,
              diskMtimeMs,
            } satisfies OpenFile;
          }),
        );

        if (canceled) {
          return;
        }

        setOpenFiles(restored);
        const active = state.active && paths.includes(state.active) ? state.active : paths[0];
        setActiveFilePath(active);
        setSelectedPath(active);
      } finally {
        if (!canceled) {
          setIsLoadingFile(false);
        }
        restoringTabsRef.current = false;
        tabsHydratedRef.current = true;
      }
    })();

    return () => {
      canceled = true;
    };
  }, [isActive, rootDir]);

  const openFilesStorageKey = useMemo(() => openFiles.map((file) => file.path).join("\n"), [openFiles]);
  useEffect(() => {
    if (restoringTabsRef.current || !tabsHydratedRef.current) {
      return;
    }

    const rootPrefix = rootDir ? rootDir.replace(/\\/g, "/").replace(/\/$/, "") : null;
    const stateFilePath = rootPrefix ? `${rootPrefix}/.emwaver/ide-tabs.json` : null;

    const open = (openFilesStorageKey ? openFilesStorageKey.split("\n") : []).filter(Boolean);
    const filteredOpen = stateFilePath ? open.filter((path) => path.replace(/\\/g, "/") !== stateFilePath) : open;

    const activeNormalized = activeFilePath ? activeFilePath.replace(/\\/g, "/") : null;
    const active = stateFilePath && activeNormalized === stateFilePath ? (filteredOpen[0] ?? null) : activeFilePath;

    // Avoid clobbering an existing tab-state file with an "empty" state on startup.
    if (!tabsRestoreSucceededRef.current && !tabsUserTouchedRef.current && filteredOpen.length === 0 && !active) {
      return;
    }

    void writeTabState(rootDir, filteredOpen, active);
  }, [activeFilePath, openFilesStorageKey, rootDir]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(keys.sidebarWidth, String(Math.round(sidebarWidth)));
    if (keys.legacy?.sidebarWidth) {
      window.localStorage.removeItem(keys.legacy.sidebarWidth);
    }
  }, [sidebarWidth]);

  useEffect(() => {
    if (isSidebarCollapsed) {
      return;
    }
    sidebarLastExpandedWidthRef.current = sidebarWidth;
  }, [isSidebarCollapsed, sidebarWidth]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(keys.terminalHeight, String(Math.round(terminalHeight)));
    if (keys.legacy?.terminalHeight) {
      window.localStorage.removeItem(keys.legacy.terminalHeight);
    }
  }, [terminalHeight]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(keys.terminalListWidth, String(Math.round(terminalListWidth)));
    if (keys.legacy?.terminalListWidth) {
      window.localStorage.removeItem(keys.legacy.terminalListWidth);
    }
  }, [terminalListWidth]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(keys.terminalListCollapsed, String(isTerminalListCollapsed));
    if (keys.legacy?.terminalListCollapsed) {
      window.localStorage.removeItem(keys.legacy.terminalListCollapsed);
    }
  }, [isTerminalListCollapsed]);

  useEffect(() => {
    if (isTerminalListCollapsed) {
      return;
    }
    terminalListLastExpandedWidthRef.current = terminalListWidth;
  }, [isTerminalListCollapsed, terminalListWidth]);

  useEffect(() => {
    if (!isTerminalVisible) {
      return;
    }
    if (isTerminalListCollapsed) {
      return;
    }
    const panel = terminalPanelRef.current;
    if (!panel) {
      return;
    }

    const raf = requestAnimationFrame(() => {
      const panelWidth = panel.clientWidth;
      if (!panelWidth) {
        return;
      }

      const maxRightWidth = panelWidth - TERMINAL_VIEW_MIN_WIDTH;
      if (maxRightWidth < TERMINAL_LIST_COLLAPSE_THRESHOLD) {
        setIsTerminalListCollapsed(true);
        return;
      }

      const nextWidth = clamp(terminalListWidth, TERMINAL_LIST_MIN_WIDTH, Math.min(TERMINAL_LIST_MAX_WIDTH, maxRightWidth));
      if (nextWidth !== terminalListWidth) {
        setTerminalListWidth(nextWidth);
      }
    });

    return () => cancelAnimationFrame(raf);
  }, [isTerminalListCollapsed, isTerminalVisible, terminalListWidth]);

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
    if (firmwareBuildTerminalRef.current) {
      firmwareBuildTerminalRef.current.options.theme = terminalTheme;
    }
    if (firmwareMonitorTerminalRef.current) {
      firmwareMonitorTerminalRef.current.options.theme = terminalTheme;
    }
  }, [terminalTheme]);

  const ensureFirmwareTerminal = useCallback(
    (tab: "build" | "monitor") => {
      const isBuild = tab === "build";
      const terminalRef = isBuild ? firmwareBuildTerminalRef : firmwareMonitorTerminalRef;
      if (terminalRef.current) {
        return;
      }
      const container = isBuild ? firmwareBuildTerminalContainerRef.current : firmwareMonitorTerminalContainerRef.current;
      if (!container) {
        return;
      }

      const term = new Terminal({
        convertEol: true,
        cursorBlink: false,
        disableStdin: true,
        fontFamily:
          '"Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        fontSize: 12,
        theme: terminalTheme,
        scrollback: 8000,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);

      if (isBuild) {
        firmwareBuildTerminalRef.current = term;
        firmwareBuildFitAddonRef.current = fitAddon;

        const buffered = pendingFirmwareBuildTextRef.current;
        if (buffered.length > 0) {
          buffered.forEach((chunk) => term.write(chunk));
          pendingFirmwareBuildTextRef.current = [];
          setFirmwareBuildHasOutput(true);
        }
      } else {
        firmwareMonitorTerminalRef.current = term;
        firmwareMonitorFitAddonRef.current = fitAddon;

        const buffered = pendingFirmwareMonitorTextRef.current;
        if (buffered.length > 0) {
          buffered.forEach((chunk) => term.write(chunk));
          pendingFirmwareMonitorTextRef.current = [];
          setFirmwareMonitorHasOutput(true);
        }
      }

      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
        } catch {
          // ignore
        }
      });
    },
    [terminalTheme],
  );

  const fitFirmwareTerminal = useCallback((tab: "build" | "monitor") => {
    const fitAddon = tab === "build" ? firmwareBuildFitAddonRef.current : firmwareMonitorFitAddonRef.current;
    if (!fitAddon) {
      return;
    }
    try {
      fitAddon.fit();
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const unlistenPromise = safeListen<FirmwareProgressPayload>("firmware-progress", (event) => {
      const payload = event.payload;
      if (!payload?.message) {
        return;
      }

      ensureFirmwareTerminal("build");
      updateFirmwareProgressFromMessage(payload.message);

      const terminal = firmwareBuildTerminalRef.current;
      const message = payload.message;
      const stream = payload.stream ? String(payload.stream) : "info";

      const ansiWrapped =
        stream === "stderr" && !message.includes("\u001b[")
          ? `\u001b[31m${message}\u001b[0m`
          : message;

      const formatted =
        stream === "info" && !ansiWrapped.endsWith("\n") && !ansiWrapped.endsWith("\r")
          ? `${ansiWrapped}\r\n`
          : ansiWrapped;

      if (terminal) {
        terminal.write(formatted);
      } else {
        pendingFirmwareBuildTextRef.current.push(formatted);
      }

      setFirmwareBuildHasOutput(true);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [ensureFirmwareTerminal, updateFirmwareProgressFromMessage]);

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
        return null;
      }
      if (terminalStartInFlightRef.current) {
        return null;
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
        if (!ideCachedTerminalSessionId) {
          ideCachedTerminalSessionId = sessionId;
        }
        return sessionId;
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
      if (ideCachedTerminalSessionId === sessionId) {
        ideCachedTerminalSessionId = null;
      }
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

  const ensureFirmwareBuildPtySession = useCallback(async () => {
    if (!isTauriAvailable() || !rootDir) {
      return null;
    }

    const existing = firmwareBuildPtySessionIdRef.current ?? ideCachedFirmwareBuildSessionId;
    if (existing) {
      firmwareBuildPtySessionIdRef.current = existing;
      return existing;
    }

    const response = await safeInvoke<{ session_id: string }>("pty_start", {
      payload: { cwd: rootDir, cols: 80, rows: 24 },
    });
    const sessionId = response?.session_id;
    if (!sessionId) {
      throw new Error("PTY start returned no session id");
    }

    firmwareBuildPtySessionIdRef.current = sessionId;
    ideCachedFirmwareBuildSessionId = sessionId;
    firmwareBuildEnvReadyRef.current = false;
    firmwareBuildEnvKeyRef.current = null;

    return sessionId;
  }, [rootDir]);

  const ensureFirmwareMonitorPtySession = useCallback(async () => {
    if (!isTauriAvailable() || !rootDir) {
      return null;
    }

    const existing = firmwareMonitorPtySessionIdRef.current ?? ideCachedFirmwareMonitorSessionId;
    if (existing) {
      firmwareMonitorPtySessionIdRef.current = existing;
      return existing;
    }

    const response = await safeInvoke<{ session_id: string }>("pty_start", {
      payload: { cwd: rootDir, cols: 80, rows: 24 },
    });
    const sessionId = response?.session_id;
    if (!sessionId) {
      throw new Error("PTY start returned no session id");
    }

    firmwareMonitorPtySessionIdRef.current = sessionId;
    ideCachedFirmwareMonitorSessionId = sessionId;
    firmwareMonitorEnvReadyRef.current = false;
    firmwareMonitorEnvKeyRef.current = null;

    return sessionId;
  }, [rootDir]);

  const ensureFirmwareEnv = useCallback(
    async (tab: "build" | "monitor", sessionId: string) => {
      if (!rootDir) {
        return;
      }

      const key = `${firmwareProjectKind}:${rootDir}`;
      const isBuild = tab === "build";
      const envReadyRef = isBuild ? firmwareBuildEnvReadyRef : firmwareMonitorEnvReadyRef;
      const envKeyRef = isBuild ? firmwareBuildEnvKeyRef : firmwareMonitorEnvKeyRef;

      if (envReadyRef.current && envKeyRef.current === key) {
        return;
      }

      if (firmwareProjectKind === "esp32") {
        await safeInvoke<void>("pty_write", {
          payload: { session_id: sessionId, data: `cd "${rootDir.replace(/\"/g, "\\\"")}" && source setup.sh\r` },
        });
      } else {
        await safeInvoke<void>("pty_write", {
          payload: { session_id: sessionId, data: `cd "${rootDir.replace(/\"/g, "\\\"")}"\r` },
        });
      }

      envReadyRef.current = true;
      envKeyRef.current = key;
    },
    [firmwareProjectKind, rootDir],
  );

  useEffect(() => {
    void ensureInitialTerminalSession();
  }, [ensureInitialTerminalSession]);

  useEffect(() => {
    if (!isTauriAvailable() || !rootDir || firmwareProjectKind !== "esp32") {
      return;
    }

    const key = `${firmwareProjectKind}:${rootDir}`;
    if (ideFirmwareWarmupKey === key) {
      firmwareBuildEnvReadyRef.current = true;
      firmwareBuildEnvKeyRef.current = key;
      firmwareMonitorEnvReadyRef.current = true;
      firmwareMonitorEnvKeyRef.current = key;
      return;
    }
    ideFirmwareWarmupKey = key;

    void (async () => {
      try {
        const [buildSessionId, monitorSessionId] = await Promise.all([
          ensureFirmwareBuildPtySession(),
          ensureFirmwareMonitorPtySession(),
        ]);

        const terminalSessionId =
          activeTerminalSessionId ??
          sessionsRef.current[sessionsRef.current.length - 1]?.id ??
          ideCachedTerminalSessionId ??
          (await startTerminalSession({ makeActive: false }));

        const cwd = rootDir.replace(/\"/g, "\\\"");
        const source = `cd "${cwd}" && source setup.sh`;

        const writes: Array<Promise<unknown>> = [];
        if (terminalSessionId) {
          writes.push(safeInvoke<void>("pty_write", { payload: { session_id: terminalSessionId, data: `${source}\r` } }));
        }
        if (buildSessionId) {
          writes.push(safeInvoke<void>("pty_write", { payload: { session_id: buildSessionId, data: `${source} && clear\r` } }));
        }
        if (monitorSessionId) {
          writes.push(safeInvoke<void>("pty_write", { payload: { session_id: monitorSessionId, data: `${source} && clear\r` } }));
        }
        await Promise.all(writes);

        firmwareBuildEnvReadyRef.current = true;
        firmwareBuildEnvKeyRef.current = key;
        firmwareMonitorEnvReadyRef.current = true;
        firmwareMonitorEnvKeyRef.current = key;

        try {
          firmwareBuildTerminalRef.current?.reset();
          firmwareBuildTerminalRef.current?.clear();
        } catch {
          // ignore
        }
        try {
          firmwareMonitorTerminalRef.current?.reset();
          firmwareMonitorTerminalRef.current?.clear();
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    })();
  }, [
    activeTerminalSessionId,
    ensureFirmwareBuildPtySession,
    ensureFirmwareMonitorPtySession,
    firmwareProjectKind,
    rootDir,
    startTerminalSession,
  ]);

  useEffect(() => {
    firmwareBuildEnvReadyRef.current = false;
    firmwareBuildEnvKeyRef.current = null;
    firmwareMonitorEnvReadyRef.current = false;
    firmwareMonitorEnvKeyRef.current = null;

    const key = rootDir ? `${firmwareProjectKind}:${rootDir}` : null;
    const shouldReset = !rootDir || !isTauriAvailable() || (ideFirmwareWarmupKey && key && ideFirmwareWarmupKey !== key);

    if (shouldReset) {
      ideFirmwareWarmupKey = null;

      const buildSessionId = firmwareBuildPtySessionIdRef.current ?? ideCachedFirmwareBuildSessionId;
      if (buildSessionId) {
        void safeInvoke<void>("pty_stop", { payload: { session_id: buildSessionId } });
      }
      firmwareBuildPtySessionIdRef.current = null;
      ideCachedFirmwareBuildSessionId = null;

      const monitorSessionId = firmwareMonitorPtySessionIdRef.current ?? ideCachedFirmwareMonitorSessionId;
      if (monitorSessionId) {
        void safeInvoke<void>("pty_stop", { payload: { session_id: monitorSessionId } });
      }
      firmwareMonitorPtySessionIdRef.current = null;
      ideCachedFirmwareMonitorSessionId = null;
    }
  }, [firmwareProjectKind, rootDir]);

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
      if (bottomPanelTab === "terminal") {
        focusActiveTerminal();
      } else if (bottomPanelTab === "firmware") {
        ensureFirmwareTerminal(firmwarePanelTab);
        fitFirmwareTerminal(firmwarePanelTab);
      }
      const panelWidth = panel.getBoundingClientRect().width;
      const computedMax = Math.floor(panelWidth * 0.45);
      const effectiveMax = Math.max(TERMINAL_LIST_MIN_WIDTH, Math.min(TERMINAL_LIST_MAX_WIDTH, computedMax));
      setTerminalListWidth((prev) => clamp(prev, TERMINAL_LIST_MIN_WIDTH, effectiveMax));
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [bottomPanelTab, ensureFirmwareTerminal, fitFirmwareTerminal, focusActiveTerminal, firmwarePanelTab, isTerminalVisible]);

  useEffect(() => {
    if (!isTerminalVisible) {
      return;
    }
    if (bottomPanelTab !== "terminal") {
      return;
    }
    requestAnimationFrame(() => focusActiveTerminal());
  }, [bottomPanelTab, focusActiveTerminal, isTerminalVisible]);

  useEffect(() => {
    if (!isTerminalVisible) {
      return;
    }
    if (bottomPanelTab !== "firmware") {
      return;
    }
    ensureFirmwareTerminal(firmwarePanelTab);
    requestAnimationFrame(() => fitFirmwareTerminal(firmwarePanelTab));
  }, [bottomPanelTab, ensureFirmwareTerminal, fitFirmwareTerminal, firmwarePanelTab, isTerminalVisible]);

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

      const firmwareBuildSessionId = firmwareBuildPtySessionIdRef.current;
      if (firmwareBuildSessionId && payload.session_id === firmwareBuildSessionId) {
        ensureFirmwareTerminal("build");
        const text = decoder.decode(bytes, { stream: true });
        const fwTerminal = firmwareBuildTerminalRef.current;
        if (fwTerminal) {
          fwTerminal.write(text);
        } else {
          pendingFirmwareBuildTextRef.current.push(text);
        }
        setFirmwareBuildHasOutput(true);
        return;
      }

      const firmwareMonitorSessionId = firmwareMonitorPtySessionIdRef.current;
      if (firmwareMonitorSessionId && payload.session_id === firmwareMonitorSessionId) {
        ensureFirmwareTerminal("monitor");
        const text = decoder.decode(bytes, { stream: true });
        const fwTerminal = firmwareMonitorTerminalRef.current;
        if (fwTerminal) {
          fwTerminal.write(text);
        } else {
          pendingFirmwareMonitorTextRef.current.push(text);
        }
        setFirmwareMonitorHasOutput(true);
        return;
      }

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
    setGitStatus(null);
    setGitError(null);
    setGitHasChecked(false);
    setGitSelectedDiff(null);
    setGitDiffContents(null);
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

  const handleCreateProject = useCallback(
    async ({ name, location, target, components, stm32_firmware }: NewProjectPayload) => {
      const trimmedName = name.trim();
      const trimmedLocation = location.trim();
      if (!trimmedName || !trimmedLocation) {
        return;
      }

      if (!isTauriAvailable()) {
        window.alert("Tauri not available - cannot create project");
        return;
      }

      setIsCreatingProject(true);
      try {
        const response = await safeInvoke<CreateProjectResponse>("create_project", {
          payload: {
            name: trimmedName,
            location: trimmedLocation,
            target,
            components,
            stm32_firmware: stm32_firmware ?? null,
          },
        });
        if (!response) {
          throw new Error("Tauri not available - cannot create project");
        }
        setIsNewProjectModalOpen(false);
        openRoot(response.path);
      } catch (error) {
        console.error(error);
        window.alert(String(error));
      } finally {
        setIsCreatingProject(false);
      }
    },
    [openRoot],
  );

  const writeFirmwareInfo = useCallback(
    (tab: "build" | "monitor", message: string) => {
      const formatted = message.endsWith("\n") || message.endsWith("\r") ? message : `${message}\r\n`;
      const line = `\u001b[90m${formatted}\u001b[0m`;

      ensureFirmwareTerminal(tab);

      if (tab === "build") {
        const terminal = firmwareBuildTerminalRef.current;
        if (terminal) {
          terminal.write(line);
        } else {
          pendingFirmwareBuildTextRef.current.push(line);
        }
        setFirmwareBuildHasOutput(true);
      } else {
        const terminal = firmwareMonitorTerminalRef.current;
        if (terminal) {
          terminal.write(line);
        } else {
          pendingFirmwareMonitorTextRef.current.push(line);
        }
        setFirmwareMonitorHasOutput(true);
      }
    },
    [ensureFirmwareTerminal],
  );

  const handleFirmwareBuild = useCallback(async () => {
    if (!isTauriAvailable()) {
      writeFirmwareInfo("build", "Tauri not available; cannot build firmware.");
      return;
    }

    setFirmwareProgressPct(null);
    setIsTerminalVisible(true);
    setBottomPanelTab("firmware");
    setIsFirmwareBusy(true);
    setFirmwareBuildHasOutput(false);
    pendingFirmwareBuildTextRef.current = [];
    ensureFirmwareTerminal("build");
    if (firmwareBuildTerminalRef.current) {
      try {
        firmwareBuildTerminalRef.current.reset();
        firmwareBuildTerminalRef.current.clear();
      } catch {
        // ignore
      }
    }

    try {
      if (firmwareProjectKind === "esp32") {
        const sessionId = await ensureFirmwareBuildPtySession();
        if (!sessionId) {
          return;
        }
        await ensureFirmwareEnv("build", sessionId);
        await safeInvoke<void>("pty_write", { payload: { session_id: sessionId, data: "idf.py build\r" } });
        setFirmwareProgressPct(null);
        setIsFirmwareBusy(false);
        return;
      }

      await safeInvoke<void>(
        "firmware_build",
        {
          payload: {
            start_dir: rootDir ?? undefined,
            codegen: firmwareProjectKind === "stm32" ? firmwareCodegenMode : "auto",
            verbose: true,
          },
        },
        { throwOnError: true },
      );
      writeFirmwareInfo("build", "Build complete.");
      setFirmwareProgressPct(100);
    } catch (error) {
      console.error(error);
      writeFirmwareInfo("build", `Build failed: ${String(error)}`);
    } finally {
      setIsFirmwareBusy(false);
    }
  }, [ensureFirmwareBuildPtySession, ensureFirmwareEnv, firmwareCodegenMode, firmwareProjectKind, rootDir, writeFirmwareInfo]);

  const handleFirmwareFlash = useCallback(async () => {
    if (!isTauriAvailable()) {
      writeFirmwareInfo("build", "Tauri not available; cannot flash firmware.");
      return;
    }

    // Always stop monitor before flashing; monitor typically holds the serial port.
    const monitorSessionId = firmwareMonitorPtySessionIdRef.current;
    if (monitorSessionId) {
      try {
        const stopSequence = firmwareProjectKind === "esp32" ? "\x1d" : "\x03";
        await safeInvoke<void>("pty_write", { payload: { session_id: monitorSessionId, data: stopSequence } });
      } catch {
        // ignore
      } finally {
        firmwareMonitorRunningRef.current = false;
        firmwareMonitorRunningKeyRef.current = null;
        setIsFirmwareMonitorRunning(false);
      }
    }

    setFirmwareProgressPct(null);
    setIsTerminalVisible(true);
    setBottomPanelTab("firmware");
    setIsFirmwareBusy(true);
    setFirmwareBuildHasOutput(false);
    pendingFirmwareBuildTextRef.current = [];
    ensureFirmwareTerminal("build");
    if (firmwareBuildTerminalRef.current) {
      try {
        firmwareBuildTerminalRef.current.reset();
        firmwareBuildTerminalRef.current.clear();
      } catch {
        // ignore
      }
    }

    try {
      if (firmwareProjectKind === "esp32") {
        const sessionId = await ensureFirmwareBuildPtySession();
        if (!sessionId) {
          return;
        }
        await ensureFirmwareEnv("build", sessionId);
        await safeInvoke<void>("pty_write", { payload: { session_id: sessionId, data: "idf.py flash\r" } });
        setFirmwareProgressPct(null);
        setIsFirmwareBusy(false);
        return;
      }

      await safeInvoke<void>(
        "firmware_flash",
        {
          payload: {
            start_dir: rootDir ?? undefined,
            codegen: firmwareProjectKind === "stm32" ? firmwareCodegenMode : "auto",
            verbose: true,
          },
        },
        { throwOnError: true },
      );
      writeFirmwareInfo("build", "Flash complete.");
      setFirmwareProgressPct(100);
    } catch (error) {
      console.error(error);
      writeFirmwareInfo("build", `Flash failed: ${String(error)}`);
    } finally {
      setIsFirmwareBusy(false);
    }
  }, [ensureFirmwareBuildPtySession, ensureFirmwareEnv, firmwareCodegenMode, firmwareProjectKind, rootDir, writeFirmwareInfo]);

  const handleFirmwareMonitor = useCallback(async () => {
    if (!isTauriAvailable()) {
      writeFirmwareInfo("monitor", "Tauri not available; cannot monitor firmware.");
      return;
    }
    if (!rootDir) {
      writeFirmwareInfo("monitor", "No folder open; cannot monitor firmware.");
      return;
    }

    setFirmwarePanelTab("monitor");
    setIsTerminalVisible(true);
    setBottomPanelTab("firmware");

    try {
      const key = `${firmwareProjectKind}:${rootDir}`;
      const sessionId = await ensureFirmwareMonitorPtySession();
      if (!sessionId) {
        return;
      }

      if (firmwareMonitorRunningRef.current && firmwareMonitorRunningKeyRef.current === key) {
        writeFirmwareInfo("monitor", "Monitor already running.");
        return;
      }

      await ensureFirmwareEnv("monitor", sessionId);

      const command = firmwareProjectKind === "esp32" ? "idf.py monitor" : "emwaver monitor";
      await safeInvoke<void>("pty_write", { payload: { session_id: sessionId, data: `${command}\r` } });
      firmwareMonitorRunningRef.current = true;
      firmwareMonitorRunningKeyRef.current = key;
      setIsFirmwareMonitorRunning(true);
    } catch (error) {
      console.error(error);
      writeFirmwareInfo("monitor", `Monitor failed: ${String(error)}`);
    }
  }, [ensureFirmwareEnv, ensureFirmwareMonitorPtySession, firmwareProjectKind, rootDir, writeFirmwareInfo]);


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
    if (!isTauriAvailable()) {
      return;
    }
    setActiveMainTabKind("file");
    setActivePreviewPath(null);
    setSelectedPath(path);
    setActiveFilePath(path);
    setGitSelectedDiff(null);
    if (openFiles.some((file) => file.path === path)) {
      return;
    }
    if (openingFilePathsRef.current.has(path)) {
      return;
    }
    openingFilePathsRef.current.add(path);
    setIsLoadingFile(true);
    try {
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
      };
      setOpenFiles((prev) => (prev.some((file) => file.path === path) ? prev : [...prev, next]));
    } finally {
      openingFilePathsRef.current.delete(path);
      setIsLoadingFile(false);
    }
  }, [openFiles]);

  const openWaveletPreviewTab = useCallback(
    async (path: string, { activate }: { activate: boolean }) => {
      if (variant !== "wavelets") {
        return;
      }
      await handleOpenFile(path);
      setWaveletPreviewTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
      if (activate) {
        setActiveMainTabKind("preview");
        setActivePreviewPath(path);
      }
    },
    [handleOpenFile, variant],
  );

  const closeWaveletPreviewTab = useCallback(
    (path: string) => {
      if (variant !== "wavelets") {
        return;
      }
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
    [activePreviewPath, variant],
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
    if (variant === "wavelets") {
      closeWaveletPreviewTab(path);
    }
  }, [closeWaveletPreviewTab, variant]);

  const runWaveletForPath = useCallback(
    async (path: string) => {
      if (variant !== "wavelets" || !rootDir) {
        return;
      }

      const normalizedRoot = rootDir.replace(/\\/g, "/").replace(/\/$/, "");
      const normalizedPath = path.replace(/\\/g, "/");
      if (!isWaveletScriptPath(path)) {
        return;
      }

      setWaveletPreviewState((prev) => ({
        ...prev,
        [path]: {
          tree: prev[path]?.tree ?? null,
          console: [],
          isRunning: true,
        },
      }));

      if (!waveletBootstrapRef.current) {
        waveletBootstrapRef.current = await readWaveletAssetScript(WAVELET_BOOTSTRAP_FILENAME);
      }

      let engine = waveletEngineByPathRef.current.get(path);
      if (!engine) {
        engine = new WaveletEngine();
        const bleService = createBLEServiceWrapper();
        const bootstrap = waveletBootstrapRef.current ?? "";
        engine.setBootstrapSource(bootstrap);
        engine.setup(
          (message: string) => {
            setWaveletPreviewState((prev) => ({
              ...prev,
              [path]: {
                tree: prev[path]?.tree ?? null,
                console: [...(prev[path]?.console ?? []), String(message)],
                isRunning: prev[path]?.isRunning ?? false,
              },
            }));
          },
          (tree: WaveletTree) => {
            setWaveletPreviewState((prev) => ({
              ...prev,
              [path]: {
                tree,
                console: prev[path]?.console ?? [],
                isRunning: prev[path]?.isRunning ?? false,
              },
            }));
          },
          (title: string, message: string) => {
            alert(`${title}\n\n${message}`);
          },
          {
            BLEService: bleService,
            DeviceConnection: waveletDeviceConnection,
            Utils: waveletUtilsBinding,
            createByteArray: waveletCreateByteArray,
          },
        );
        waveletEngineByPathRef.current.set(path, engine);
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

      const queue: string[] = [rootDir];
      const visited = new Set<string>();
      const maxFiles = 200;
      const filePaths: string[] = [];

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

      for (const filePath of filePaths) {
        const normalizedFilePath = filePath.replace(/\\/g, "/");
        const relative = normalizedFilePath.startsWith(`${normalizedRoot}/`)
          ? normalizedFilePath.slice(`${normalizedRoot}/`.length)
          : basename(filePath);

        const openFile = openFileByPath.get(filePath);
        const content = openFile ? openFile.content : (await safeInvoke<string>("read_file", { payload: { path: filePath } })) ?? "";
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

      const entryFile = openFileByPath.get(path);
      const entrySource = entryFile ? entryFile.content : (await safeInvoke<string>("read_file", { payload: { path } })) ?? "";
      engine.execute(entrySource, () => {
        setWaveletPreviewState((prev) => ({
          ...prev,
          [path]: {
            tree: prev[path]?.tree ?? null,
            console: [...(prev[path]?.console ?? []), "Wavelet execution completed."],
            isRunning: false,
          },
        }));
      });

      setWaveletPreviewState((prev) => ({
        ...prev,
        [path]: {
          tree: prev[path]?.tree ?? null,
          console: prev[path]?.console ?? [],
          isRunning: false,
        },
      }));
    },
    [rootDir, variant, waveletCreateByteArray, waveletDeviceConnection, waveletUtilsBinding],
  );

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

  const runGitAction = useCallback(
    async (action: () => Promise<unknown>) => {
      if (!rootDir || !isTauriAvailable()) {
        return;
      }
    setIsGitBusy(true);
    setGitError(null);
    try {
      await action();
      await refreshGit();
    } catch (error) {
      setGitError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsGitBusy(false);
      }
    },
    [refreshGit, rootDir],
  );

  const handleGitStage = useCallback(
    async (paths: string[]) => {
      await runGitAction(() => safeInvoke<void>("git_stage", { payload: { path: rootDir!, paths } }));
    },
    [rootDir, runGitAction],
  );

  const handleGitUnstage = useCallback(
    async (paths: string[]) => {
      await runGitAction(() => safeInvoke<void>("git_unstage", { payload: { path: rootDir!, paths } }));
    },
    [rootDir, runGitAction],
  );

  const handleGitDiscard = useCallback(
    async (paths: string[]) => {
      await runGitAction(() => safeInvoke<void>("git_discard", { payload: { path: rootDir!, paths } }));
    },
    [rootDir, runGitAction],
  );

  const handleGitCommit = useCallback(async () => {
    const message = gitCommitMessage.trim();
    if (!message) {
      return;
    }
    await runGitAction(() => safeInvoke<void>("git_commit", { payload: { path: rootDir!, message } }));
    setGitCommitMessage("");
  }, [gitCommitMessage, rootDir, runGitAction]);

  const handleGitPush = useCallback(async () => {
    await runGitAction(() => safeInvoke<void>("git_push", { payload: { path: rootDir! } }));
  }, [rootDir, runGitAction]);

  const handleGitStageAll = useCallback(async () => {
    await runGitAction(() => safeInvoke<void>("git_stage_all", { payload: { path: rootDir! } }));
  }, [rootDir, runGitAction]);

  const handleGitUnstageAll = useCallback(async () => {
    await runGitAction(() => safeInvoke<void>("git_unstage_all", { payload: { path: rootDir! } }));
  }, [rootDir, runGitAction]);

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
    const unlistenNewProjectPromise = safeListen("menu-new-project", () => {
      setIsNewProjectModalOpen(true);
    });
    const unlistenOpenProjectPromise = safeListen("menu-open-project", () => {
      void handlePickFolder();
    });
    const unlistenOpenFolderPromise = safeListen("menu-ide-open-folder", () => {
      void handlePickFolder();
    });
    const unlistenSavePromise = safeListen("menu-ide-save-file", () => {
      void handleSaveFile();
    });
    const unlistenFirmwareBuildPromise = safeListen("menu-ide-firmware-build", () => {
      void handleFirmwareBuild();
    });
    const unlistenFirmwareFlashPromise = safeListen("menu-ide-firmware-flash", () => {
      void handleFirmwareFlash();
    });
    const unlistenFirmwareBuildFlashPromise = safeListen("menu-ide-firmware-build-flash", () => {
      void handleFirmwareFlash();
    });
    return () => {
      void unlistenTogglePromise.then((unlisten) => unlisten());
      void unlistenShowPromise.then((unlisten) => unlisten());
      void unlistenCloseFolderPromise.then((unlisten) => unlisten());
      void unlistenNewProjectPromise.then((unlisten) => unlisten());
      void unlistenOpenProjectPromise.then((unlisten) => unlisten());
      void unlistenOpenFolderPromise.then((unlisten) => unlisten());
      void unlistenSavePromise.then((unlisten) => unlisten());
      void unlistenFirmwareBuildPromise.then((unlisten) => unlisten());
      void unlistenFirmwareFlashPromise.then((unlisten) => unlisten());
      void unlistenFirmwareBuildFlashPromise.then((unlisten) => unlisten());
    };
  }, [handleCloseFolder, handleFirmwareBuild, handleFirmwareFlash, handlePickFolder, handleSaveFile]);

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
      {!rootDir ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <div className="mx-auto mb-6 h-24 w-24 overflow-hidden rounded-full bg-slate-900/60 shadow-2xl shadow-sky-500/20 ring-2 ring-sky-500/40">
            <img src="/emwaver-logo.png" alt="EMWaver" className="h-full w-full object-contain p-4" />
          </div>
          <h2 className="text-2xl font-semibold text-slate-100">
            {variant === "ide" ? "Open or create a project" : "Open a wavelet project"}
          </h2>
          <p className="mt-2 max-w-lg text-sm text-slate-400">
            {variant === "ide"
              ? "The IDE needs a firmware folder to browse, edit, build, and flash."
              : "Wavelets Workspace needs a folder to browse, edit, run, and preview wavelets."}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {variant === "ide" ? (
              <button
                type="button"
                onClick={() => setIsNewProjectModalOpen(true)}
                className="min-w-[160px] rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:bg-sky-400 cursor-pointer"
              >
                New Project…
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void handlePickFolder()}
              className="min-w-[160px] rounded-md border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-900 hover:text-sky-200 cursor-pointer"
            >
              Open Folder…
            </button>
          </div>

          {variant === "ide" && isNewProjectModalOpen ? (
            <NewProjectModal
              onClose={() => setIsNewProjectModalOpen(false)}
              onCreate={handleCreateProject}
              isSubmitting={isCreatingProject}
            />
          ) : null}
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
	              <div className="border-b border-slate-900 px-4 py-3">
	                <div className="flex items-start justify-between gap-2">
	                  <div className="min-w-0 cursor-default">
	                    <h2
                        className="truncate text-sm font-semibold text-slate-200"
                        title={
                          sidebarPanel === "explorer"
                            ? rootDir ?? (variant === "ide" ? "IDE" : "Wavelets Workspace")
                            : "Source Control"
                        }
                      >
	                      {sidebarPanel === "explorer"
	                        ? rootDir
	                          ? basename(rootDir)
	                          : variant === "ide"
	                            ? "IDE"
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
              <div className="h-full min-h-0 overflow-auto p-2">
                {sidebarPanel === "explorer" ? (
                  explorerRoot ? (
                    renderDirectory(explorerRoot, 0)
                  ) : (
                    <p className="px-2 text-xs text-slate-500">No folder open.</p>
                  )
	                ) : !rootDir ? (
	                  <p className="px-2 text-xs text-slate-500">Open a folder to use Source Control.</p>
                  ) : !gitHasChecked ? (
                    <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-3 px-4 py-6 text-slate-400">
                      <div
                        aria-hidden="true"
                        className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400"
                      />
                      <div className="text-xs">Checking Git status…</div>
                    </div>
	                ) : showGitNeedsInitIndicator ? (
                    <div className="space-y-2 px-2 py-2">
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-100">
                        <div className="text-xs font-semibold">Not a Git repository</div>
                        <div className="mt-1 text-[11px] text-amber-200/80">
                          Run <span className="font-mono">git init</span> in this folder to enable Source Control.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void refreshGit()}
                        disabled={isGitLoading || isGitBusy}
                        className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900 disabled:opacity-50"
                        title="Refresh"
                      >
                        Refresh
                      </button>
                    </div>
                  ) : gitError ? (
                    <div className="space-y-2 px-2 py-2">
                      <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-100">
                        <div className="text-xs font-semibold">Source Control unavailable</div>
                        <div className="mt-1 break-words text-[11px] text-rose-200/80">{gitError}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void refreshGit()}
                        disabled={isGitLoading || isGitBusy}
                        className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900 disabled:opacity-50"
                        title="Refresh"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
	                  <div className="space-y-3 px-2 py-2">
                      <div className="px-1 text-[11px] text-slate-500">
                        <span className="font-semibold text-slate-300">
                          {gitStatus?.branch ? gitStatus.branch : "detached"}
                        </span>
                        {gitStatus?.upstream ? <span className="text-slate-600"> → {gitStatus.upstream}</span> : null}
                        <span className="ml-2">↑ {gitStatus?.ahead ?? 0}</span>
                        <span className="ml-2">↓ {gitStatus?.behind ?? 0}</span>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between px-1">
                          <div className="text-[11px] font-semibold tracking-wide text-slate-400">CHANGES</div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void refreshGit()}
                              disabled={isGitLoading || isGitBusy}
                              className="rounded p-1 text-slate-500 hover:bg-slate-900/60 hover:text-slate-200 disabled:opacity-50"
                              title="Refresh"
                            >
                              <RefreshIcon className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleGitStageAll()}
                              disabled={isGitLoading || isGitBusy || (gitStatus?.changes?.length ?? 0) === 0}
                              className="rounded p-1 text-slate-500 hover:bg-slate-900/60 hover:text-slate-200 disabled:opacity-50"
                              title="Stage all changes"
                            >
                              <PlusIcon className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleGitUnstageAll()}
                              disabled={isGitLoading || isGitBusy || (gitStatus?.staged?.length ?? 0) === 0}
                              className="rounded p-1 text-slate-500 hover:bg-slate-900/60 hover:text-slate-200 disabled:opacity-50"
                              title="Unstage all changes"
                            >
                              <MinusIcon className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleGitPush()}
                              disabled={isGitLoading || isGitBusy || (gitStatus?.ahead ?? 0) === 0}
                              className="rounded p-1 text-slate-500 hover:bg-slate-900/60 hover:text-slate-200 disabled:opacity-50"
                              title="Push"
                            >
                              <ArrowUpIcon className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        <textarea
                          rows={2}
                          value={gitCommitMessage}
                          onChange={(event) => setGitCommitMessage(event.target.value)}
                          onKeyDown={(event) => {
                            const isCommit = (event.ctrlKey || event.metaKey) && event.key === "Enter";
                            if (!isCommit) {
                              return;
                            }
                            if (isGitLoading || isGitBusy) {
                              return;
                            }
                            if ((gitStatus?.staged?.length ?? 0) === 0) {
                              return;
                            }
                            if (!gitCommitMessage.trim()) {
                              return;
                            }
                            event.preventDefault();
                            void handleGitCommit();
                          }}
                          placeholder="Message"
                          className="w-full resize-none rounded border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-slate-700 focus:outline-none"
                        />

                        <button
                          type="button"
                          onClick={() => void handleGitCommit()}
                          disabled={
                            isGitLoading ||
                            isGitBusy ||
                            (gitStatus?.staged?.length ?? 0) === 0 ||
                            !gitCommitMessage.trim()
                          }
                          className="w-full rounded bg-sky-600 px-2 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                          title="Commit staged changes"
                        >
                          Commit
                        </button>
                      </div>

                      {gitError ? <p className="px-1 text-[11px] text-rose-300">{gitError}</p> : null}

                      <div className="space-y-1">
                        <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-slate-300">
                          <span>Staged Changes</span>
                          <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-200">
                            {gitStatus?.staged?.length ?? 0}
                          </span>
                        </div>
                        <div className="space-y-0.5">
                          {(gitStatus?.staged ?? []).map((entry) => {
                            const isActive = gitSelectedDiff?.path === entry.path && gitSelectedDiff?.view === "staged";
                            return (
                              <div
                                key={`staged:${entry.path}`}
                                className={`group flex items-center gap-1 rounded px-1 py-0.5 ${
                                  isActive ? "bg-slate-900/60" : "hover:bg-slate-900/60"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setGitSelectedDiff({
                                      path: entry.path,
                                      view: "staged",
                                      orig_path: entry.orig_path ?? null,
                                    })
                                  }
                                  className="min-w-0 flex-1 truncate px-1 py-1 text-left text-xs text-slate-200"
                                  title={entry.path}
                                >
                                  <span className="mr-2 inline-block w-4 text-slate-500">{entry.index_status}</span>
                                  {entry.path}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleGitUnstage([entry.path])}
                                  disabled={isGitLoading || isGitBusy}
                                  className="rounded p-1 text-slate-500 opacity-0 hover:bg-slate-900/60 hover:text-slate-200 group-hover:opacity-100 disabled:opacity-50"
                                  title="Unstage"
                                >
                                  <MinusIcon className="h-4 w-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-slate-300">
                          <span>Changes</span>
                          <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-200">
                            {gitStatus?.changes?.length ?? 0}
                          </span>
                        </div>
                        <div className="space-y-0.5">
                          {(gitStatus?.changes ?? []).map((entry) => {
                            const isActive =
                              gitSelectedDiff?.path === entry.path && gitSelectedDiff?.view === "unstaged";
                            const canDiscard = !entry.is_untracked && entry.worktree_status.trim() !== "";
                            return (
                              <div
                                key={`change:${entry.path}`}
                                className={`group flex items-center gap-1 rounded px-1 py-0.5 ${
                                  isActive ? "bg-slate-900/60" : "hover:bg-slate-900/60"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setGitSelectedDiff({
                                      path: entry.path,
                                      view: "unstaged",
                                      orig_path: entry.orig_path ?? null,
                                    })
                                  }
                                  className="min-w-0 flex-1 truncate px-1 py-1 text-left text-xs text-slate-200"
                                  title={entry.path}
                                >
                                  <span className="mr-2 inline-block w-4 text-slate-500">
                                    {entry.is_untracked ? "?" : entry.worktree_status}
                                  </span>
                                  {entry.path}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleGitStage([entry.path])}
                                  disabled={isGitLoading || isGitBusy}
                                  className="rounded p-1 text-slate-500 opacity-0 hover:bg-slate-900/60 hover:text-slate-200 group-hover:opacity-100 disabled:opacity-50"
                                  title="Stage"
                                >
                                  <PlusIcon className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleGitDiscard([entry.path])}
                                  disabled={isGitLoading || isGitBusy || !canDiscard}
                                  className="rounded p-1 text-slate-500 opacity-0 hover:bg-slate-900/60 hover:text-slate-200 group-hover:opacity-100 disabled:opacity-50"
                                  title={entry.is_untracked ? "Discard is not available for untracked files" : "Discard"}
                                >
                                  <TrashIcon className="h-4 w-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
	                )}
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
          <div className="flex items-center justify-between border-b border-slate-900 bg-slate-950">
	            <div className="flex min-w-0 flex-1 items-center overflow-hidden">
	              <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
	                {openFiles.length === 0 ? (
	                  <div className="px-4 py-2 text-xs text-slate-500">Select a file to edit</div>
	                ) : (
	                  openFiles.map((file) => {
	                    const isActive = activeMainTabKind === "file" && file.path === activeFilePath;
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
                              setActiveMainTabKind("file");
                              setActivePreviewPath(null);
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
                {variant === "wavelets"
                  ? waveletPreviewTabs.map((path) => {
                      const isActive = activeMainTabKind === "preview" && activePreviewPath === path;
                      return (
                        <div
                          key={`preview:${path}`}
                          className={`group relative flex shrink-0 items-center border-r border-slate-900 ${
                            isActive ? "bg-slate-900" : "bg-slate-950 hover:bg-slate-900/60"
                          }`}
                          title={`Preview: ${path}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setActiveMainTabKind("preview");
                              setActivePreviewPath(path);
                              setGitSelectedDiff(null);
                            }}
                            className={`flex items-center gap-2 px-3 py-2 pr-9 text-left text-xs ${
                              isActive ? "text-slate-100" : "text-slate-400 group-hover:text-slate-200"
                            }`}
                          >
                            <span
                              className="flex h-4 w-6 items-center justify-center rounded bg-slate-950/40 text-[10px] font-semibold text-emerald-200"
                              aria-hidden="true"
                            >
                              ▶
                            </span>
                            <span className="max-w-[12rem] truncate">{basename(path)}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => closeWaveletPreviewTab(path)}
                            className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200 group-hover:block"
                            title="Close preview"
                          >
                            <CloseIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })
                  : null}
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-3 px-4 py-2 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                {variant === "ide" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setIsTerminalVisible(true);
                        setBottomPanelTab("firmware");
                        setFirmwarePanelTab("build");
                        void handleFirmwareBuild();
                      }}
                      disabled={isFirmwareBusy || !rootDir}
                      className="rounded border border-slate-700 bg-slate-900/60 px-1.5 py-1.5 text-slate-200 shadow-sm hover:bg-slate-800 hover:shadow disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-400 disabled:opacity-60"
                      title="Build"
                    >
                      <HammerIcon className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsTerminalVisible(true);
                        setBottomPanelTab("firmware");
                        setFirmwarePanelTab("build");
                        void handleFirmwareFlash();
                      }}
                      disabled={isFirmwareBusy || !rootDir}
                      className="rounded border border-sky-300/70 bg-sky-500 px-1.5 py-1.5 text-white shadow-sm hover:bg-sky-400 hover:shadow disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-400 disabled:opacity-60"
                      title="Flash"
                    >
                      <UploadIcon className="h-4 w-4 text-sky-50" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsTerminalVisible(true);
                        setBottomPanelTab("firmware");
                        setFirmwarePanelTab("monitor");
                        void handleFirmwareMonitor();
                      }}
                      disabled={!rootDir}
                      className="rounded border border-emerald-300/70 bg-emerald-500 px-1.5 py-1.5 text-white shadow-sm hover:bg-emerald-400 hover:shadow disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-400 disabled:opacity-60"
                      title="Monitor"
                    >
                      <MonitorIcon className="h-4 w-4 text-emerald-50" />
                    </button>
                    {firmwareProjectKind === "stm32" ? (
                      <select
                        value={firmwareCodegenMode}
                        disabled={isFirmwareBusy || !rootDir}
                        onChange={(event) => setFirmwareCodegenMode(event.target.value as "auto" | "always" | "never")}
                        className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 disabled:opacity-50"
                        title="STM32CubeMX code generation mode"
                      >
                        <option value="auto">codegen:auto</option>
                        <option value="always">codegen:always</option>
                        <option value="never">codegen:never</option>
                      </select>
                    ) : null}

                    {isFirmwareBusy ? (
                      <div
                        className="h-1.5 w-14 overflow-hidden rounded bg-slate-800"
                        title="Flashing…"
                        aria-label="Flashing…"
                      >
                        {firmwareProgressPct === null ? (
                          <div className="h-full w-full bg-sky-400/80 animate-pulse" />
                        ) : (
                          <div className="h-full bg-sky-400/80" style={{ width: `${firmwareProgressPct}%` }} />
                        )}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        if (!waveletTargetPath) return;
                        void (async () => {
                          await openWaveletPreviewTab(waveletTargetPath, { activate: true });
                          await runWaveletForPath(waveletTargetPath);
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
                    <button
                      type="button"
                      onClick={() => {
                        if (!waveletTargetPath) return;
                        void (async () => {
                          await openWaveletPreviewTab(waveletTargetPath, { activate: false });
                          await runWaveletForPath(waveletTargetPath);
                        })();
                      }}
                      disabled={!canRunWavelet || !waveletTargetPath}
                      className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-slate-200 shadow-sm hover:bg-slate-800 hover:shadow disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-400 disabled:opacity-60"
                      title="Run wavelet"
                    >
                      <span className="flex items-center gap-1.5">
                        <PlayIcon className="h-4 w-4" />
                        <span className="text-[11px] font-semibold">Run</span>
                      </span>
                    </button>
                    {waveletTargetPath && waveletPreviewState[waveletTargetPath]?.isRunning ? (
                      <div className="h-1.5 w-14 overflow-hidden rounded bg-slate-800" title="Running…">
                        <div className="h-full w-full bg-emerald-400/80 animate-pulse" />
                      </div>
                    ) : null}
                  </>
                )}

              </div>

              {isLoadingFile ? <span>Loading…</span> : null}
              {activeFile?.isDirty ? <span className="text-amber-300">Unsaved</span> : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              {gitSelectedDiff ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex items-center justify-between border-b border-slate-900 bg-slate-950 px-3 py-2 text-xs">
                    <div className="min-w-0 truncate text-slate-200" title={gitSelectedDiff.path}>
                      Diff: {gitSelectedDiff.path}
                    </div>
                    <button
                      type="button"
                      onClick={() => setGitSelectedDiff(null)}
                      className="rounded p-1 text-slate-500 hover:bg-slate-900/60 hover:text-slate-200"
                      title="Close diff"
                    >
                      <CloseIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 select-text">
                    {isGitDiffLoading ? (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading diff…</div>
                    ) : gitDiffContents?.is_binary ? (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">
                        Binary file diff not supported.
                      </div>
                    ) : (
                      <DiffEditor
                        theme={getEmwaverMonacoTheme(theme)}
                        original={gitDiffContents?.original ?? ""}
                        modified={gitDiffContents?.modified ?? ""}
                        options={{
                          ...MONACO_EDITOR_OPTIONS,
                          readOnly: true,
                          renderSideBySide: true,
                        }}
                      />
                    )}
                  </div>
                </div>
              ) : variant === "wavelets" && activeMainTabKind === "preview" && activePreviewPath ? (
                <div className="flex h-full min-h-0 flex-col select-text">
                  <div className="flex items-center justify-between border-b border-slate-900 bg-slate-950 px-3 py-2 text-xs">
                    <div className="min-w-0 truncate text-slate-200" title={activePreviewPath}>
                      Preview: {basename(activePreviewPath)}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setWaveletPreviewState((prev) => ({
                            ...prev,
                            [activePreviewPath]: { tree: null, console: [], isRunning: false },
                          }));
                        }}
                        className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-900"
                        title="Clear preview output"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => void runWaveletForPath(activePreviewPath)}
                        className="rounded border border-emerald-300/70 bg-emerald-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-400"
                        title="Run wavelet"
                      >
                        Run
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveMainTabKind("file");
                          setActivePreviewPath(null);
                        }}
                        className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-900"
                        title="Back to editor"
                      >
                        Editor
                      </button>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-6">
                    {waveletPreviewState[activePreviewPath]?.tree ? (
                      <WaveletUIRenderer
                        tree={waveletPreviewState[activePreviewPath]?.tree as WaveletTree}
                        consoleOutput={waveletPreviewState[activePreviewPath]?.console ?? []}
                        onInvokeCallback={(token, args) => {
                          waveletEngineByPathRef.current.get(activePreviewPath)?.invoke(token, args);
                        }}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">
                        Run this wavelet to render a preview.
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-900 bg-slate-950 px-4 py-3">
                    <div className="mb-2 flex items-center justify-between text-[11px] font-semibold tracking-wide text-slate-400">
                      <span>CONSOLE</span>
                      <span className="text-slate-600">{waveletDeviceConnection.connectionStatus()}</span>
                    </div>
                    <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-slate-800 bg-slate-950/40 p-2 font-mono text-[11px] text-slate-200">
                      {(waveletPreviewState[activePreviewPath]?.console ?? []).length === 0 ? (
                        <div className="text-slate-500">No output yet.</div>
                      ) : (
                        (waveletPreviewState[activePreviewPath]?.console ?? []).map((line, idx) => (
                          <div key={idx}>{line}</div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : activeFile ? (
                <div className="h-full select-text">
                  <MonacoEditor
                    theme={getEmwaverMonacoTheme(theme)}
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
                              effectiveBottomPanelTab === "terminal"
                                ? "border-b-2 border-sky-400 text-slate-100"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            TERMINAL
                          </button>
                          {variant === "ide" ? (
                            <button
                              type="button"
                              onClick={() => setBottomPanelTab("firmware")}
                              className={`select-none px-3 py-2 font-semibold tracking-wide ${
                                effectiveBottomPanelTab === "firmware"
                                  ? "border-b-2 border-sky-400 text-slate-100"
                                  : "text-slate-400 hover:text-slate-200"
                              }`}
                            >
                              DEVICE
                            </button>
                          ) : null}
                        </div>

                        <div ref={terminalPickerAnchorRef} className="relative flex items-center gap-1">
                          {effectiveBottomPanelTab === "terminal" ? (
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
                            <div className="flex items-center gap-2">
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleFirmwareBuild()}
                                  disabled={isFirmwareBusy || !rootDir}
                                  className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-slate-200 shadow-sm hover:bg-slate-800 hover:shadow disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-400 disabled:opacity-60"
                                  title={firmwareProjectKind === "esp32" ? "Build (idf.py build)" : "Build firmware"}
                                >
                                  Build
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleFirmwareFlash()}
                                  disabled={isFirmwareBusy || !rootDir}
                                  className="rounded border border-sky-300/70 bg-sky-500 px-2 py-1 text-white shadow-sm hover:bg-sky-400 hover:shadow disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-400 disabled:opacity-60"
                                  title={firmwareProjectKind === "esp32" ? "Flash (idf.py flash)" : "Flash firmware"}
                                >
                                  Flash
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFirmwarePanelTab("monitor");
                                    void handleFirmwareMonitor();
                                  }}
                                  disabled={!rootDir}
                                  className="rounded border border-emerald-300/70 bg-emerald-500 px-2 py-1 text-white shadow-sm hover:bg-emerald-400 hover:shadow disabled:border-slate-800 disabled:bg-slate-950 disabled:text-slate-400 disabled:opacity-60"
                                  title={firmwareProjectKind === "esp32" ? "Monitor (idf.py monitor)" : "Monitor (emwaver monitor)"}
                                >
                                  Monitor
                                </button>

                                {firmwarePanelTab === "monitor" && isFirmwareMonitorRunning ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const sessionId = firmwareMonitorPtySessionIdRef.current;
                                      if (!sessionId || !isTauriAvailable()) {
                                        return;
                                      }
                                      void (async () => {
                                        try {
                                          const stopSequence = firmwareProjectKind === "esp32" ? "\x1d" : "\x03";
                                          await safeInvoke<void>("pty_write", { payload: { session_id: sessionId, data: stopSequence } });
                                        } catch {
                                          // ignore
                                        } finally {
                                          firmwareMonitorRunningRef.current = false;
                                          firmwareMonitorRunningKeyRef.current = null;
                                          setIsFirmwareMonitorRunning(false);
                                          writeFirmwareInfo("monitor", "Monitor stopped.");
                                        }
                                      })();
                                    }}
                                    className="rounded border border-rose-300/70 bg-rose-600 px-2 py-1 text-white shadow-sm hover:bg-rose-500 hover:shadow"
                                    title="Stop monitor"
                                  >
                                    Stop
                                  </button>
                                ) : null}
                              </>

                              <button
                                type="button"
                                onClick={() => {
                                  setFirmwareProgressPct(null);
                                  if (firmwarePanelTab === "build") {
                                    setFirmwareBuildHasOutput(false);
                                    const terminal = firmwareBuildTerminalRef.current;
                                    if (terminal) {
                                      try {
                                        terminal.reset();
                                        terminal.clear();
                                      } catch {
                                        // ignore
                                      }
                                    } else {
                                      pendingFirmwareBuildTextRef.current = [];
                                    }
                                  } else {
                                    setFirmwareMonitorHasOutput(false);
                                    const terminal = firmwareMonitorTerminalRef.current;
                                    if (terminal) {
                                      try {
                                        terminal.reset();
                                        terminal.clear();
                                      } catch {
                                        // ignore
                                      }
                                    } else {
                                      pendingFirmwareMonitorTextRef.current = [];
                                    }
                                  }
                                }}
                                className="rounded px-2 py-1 text-slate-400 hover:bg-slate-900/70 hover:text-slate-100"
                                title="Clear firmware log"
                              >
                                Clear
                              </button>
                            </div>
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
		                          <div
                                className={`relative min-h-0 flex-1 overflow-hidden ${effectiveBottomPanelTab === "terminal" ? "" : "hidden"}`}
                              >
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
	                                <div className="flex h-full items-center justify-center text-sm text-slate-500">
	                                  Starting shell…
	                                </div>
	                              ) : null}
	                            </div>

                            <div className={`relative min-h-0 flex-1 ${effectiveBottomPanelTab === "firmware" ? "" : "hidden"}`}>
                              {firmwarePanelTab === "build" && !firmwareBuildHasOutput ? (
                                <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
                                  No firmware activity yet.
                                </div>
                              ) : null}
                              {firmwarePanelTab === "monitor" && !firmwareMonitorHasOutput ? (
                                <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
                                  No firmware activity yet.
                                </div>
                              ) : null}

                              <div
                                ref={firmwareBuildTerminalContainerRef}
                                className={`absolute inset-0 px-2 py-2 ${firmwarePanelTab === "build" ? "" : "hidden"}`}
                              />
                              <div
                                ref={firmwareMonitorTerminalContainerRef}
                                className={`absolute inset-0 px-2 py-2 ${firmwarePanelTab === "monitor" ? "" : "hidden"}`}
                              />
                            </div>
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
	                              {effectiveBottomPanelTab === "terminal" ? (
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
	                                    DEVICE
	                                  </div>

	                                  <button
	                                    type="button"
	                                    onClick={() => {
	                                      setFirmwarePanelTab("build");
	                                      void (async () => {
	                                        try {
	                                          const sessionId = await ensureFirmwareBuildPtySession();
	                                          if (sessionId) {
	                                            await ensureFirmwareEnv("build", sessionId);
	                                          }
	                                        } catch {
	                                          // ignore
	                                        }
	                                      })();
	                                    }}
	                                    className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
	                                      firmwarePanelTab === "build"
	                                        ? "bg-slate-900/70 text-sky-200"
	                                        : "text-slate-300 hover:bg-slate-900/40"
	                                    }`}
	                                  >
	                                    <HammerIcon className="h-4 w-4 text-slate-500" />
	                                    <span>Build/Flash</span>
	                                  </button>

	                                  <button
	                                    type="button"
	                                    onClick={() => {
	                                      setFirmwarePanelTab("monitor");
	                                      void (async () => {
	                                        try {
	                                          const sessionId = await ensureFirmwareMonitorPtySession();
	                                          if (sessionId) {
	                                            await ensureFirmwareEnv("monitor", sessionId);
	                                          }
	                                        } catch {
	                                          // ignore
	                                        }
	                                      })();
	                                    }}
	                                    className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
	                                      firmwarePanelTab === "monitor"
	                                        ? "bg-slate-900/70 text-emerald-200"
	                                        : "text-slate-300 hover:bg-slate-900/40"
	                                    }`}
	                                  >
	                                    <MonitorIcon className="h-4 w-4 text-slate-500" />
	                                    <span>Monitor</span>
	                                  </button>
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
      )}
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
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [target, setTarget] = useState<NewProjectPayload["target"]>("esp32s3");
  const [pendingDisableCoreConfirm, setPendingDisableCoreConfirm] = useState<null | "ble" | "command_registry">(null);

  const [components, setComponents] = useState<Set<NewProjectPayload["components"][number]>>(
    () => new Set(["ble", "command_registry", "gpio", "ota"]),
  );
  const [stm32Firmware, setStm32Firmware] = useState<
    Exclude<NewProjectPayload["stm32_firmware"], undefined | null>
  >(() => "gpio");

  const [name, setName] = useState("emwaver-firmware");
  const [location, setLocation] = useState("");

  const resetForTarget = useCallback((nextTarget: NewProjectPayload["target"]) => {
    if (nextTarget === "esp32s3") {
      setComponents(new Set(["ble", "command_registry", "gpio", "ota"]));
    } else {
      setStm32Firmware("gpio");
      setComponents(new Set());
    }
  }, []);

  useEffect(() => {
    resetForTarget(target);
  }, [resetForTarget, target]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !location.trim()) {
      return;
    }
    const componentList = Array.from(components.values());
    await onCreate({
      name: name.trim(),
      location: location.trim(),
      target,
      components: target === "esp32s3" ? componentList : [],
      stm32_firmware: target === "stm32f042" ? stm32Firmware : null,
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
      {pendingDisableCoreConfirm ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
            <div className="text-sm font-semibold text-slate-100">
              {pendingDisableCoreConfirm === "ble" ? "Disable BLE?" : "Disable Command Registry?"}
            </div>
            {pendingDisableCoreConfirm === "ble" ? (
              <p className="mt-2 text-sm text-slate-300">
                Disabling BLE means you won’t be able to interact with EMWaver apps.
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-300">
                You can still connect over BLE, but you won’t have any built-in commands (like <span className="font-semibold">version</span>).
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDisableCoreConfirm(null)}
                className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const mode = pendingDisableCoreConfirm;
                  setPendingDisableCoreConfirm(null);
                  setComponents((prev) => {
                    const next = new Set(prev);
                    if (mode === "ble") {
                      next.delete("ble");
                      next.delete("command_registry");
                      next.delete("ota");
                      next.delete("gpio");
                      next.delete("sampler");
                      next.delete("cc1101");
                      next.delete("rfm69");
                      next.delete("mfrc522");
                    } else {
                      next.delete("command_registry");
                      next.delete("gpio");
                      next.delete("sampler");
                      next.delete("cc1101");
                      next.delete("rfm69");
                      next.delete("mfrc522");
                    }
                    return next;
                  });
                }}
                className="rounded-md bg-rose-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:bg-rose-400 cursor-pointer"
              >
                Disable
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-100">Create project</h2>
          <p className="text-sm text-slate-400">Step {step} of 3</p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {step === 1 ? (
            <div className="space-y-3">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Target</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setTarget("esp32s3")}
                    className={[
                      "rounded-md border px-4 py-3 text-left transition-colors",
                      target === "esp32s3"
                        ? "border-sky-500/80 bg-sky-500/10 text-slate-100"
                        : "border-slate-700 bg-slate-950 text-slate-200 hover:border-sky-500/60",
                    ].join(" ")}
                  >
                    <div className="text-sm font-semibold">ESP32-S3</div>
                    <div className="mt-1 text-xs text-slate-400">Supports: EMWaver Flagship, Shield, DIY.</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTarget("stm32f042")}
                    className={[
                      "rounded-md border px-4 py-3 text-left transition-colors",
                      target === "stm32f042"
                        ? "border-sky-500/80 bg-sky-500/10 text-slate-100"
                        : "border-slate-700 bg-slate-950 text-slate-200 hover:border-sky-500/60",
                    ].join(" ")}
                  >
                    <div className="text-sm font-semibold">STM32F042</div>
                    <div className="mt-1 text-xs text-slate-400">Supports: Infrared Waver, ISM Waver, GPIO Waver, RFID Waver.</div>
                  </button>
                </div>
              </div>
              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:bg-sky-400 cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}

	          {step === 2 ? (
            <div className="space-y-3">
              {target === "esp32s3" ? (
                <div>
                  <div className="mb-2">
                    <div className="text-sm font-semibold text-slate-100">Components</div>
                    <div className="text-xs text-slate-400">
                      Default is BLE + Command Registry + GPIO + OTA; uncheck what you don&apos;t need.
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      {
                        id: "ble" as const,
                        label: "BLE",
                      },
                      {
                        id: "command_registry" as const,
                        label: "Command Registry",
                      },
                    ].map((item) => {
                      const checked = components.has(item.id);
                      const disabled = false;
                      return (
                        <label
                          key={item.id}
                          className={[
                            "flex items-center gap-2 rounded-md border bg-slate-950 px-3 py-2 text-sm text-slate-200",
                            disabled ? "border-slate-800 opacity-60" : "border-slate-700 hover:border-sky-500/60",
                          ].join(" ")}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={(event) => {
                              const nextChecked = event.target.checked;
                              setComponents((prev) => {
                                const next = new Set(prev);
                                if (item.id === "ble" && !nextChecked) {
                                  setPendingDisableCoreConfirm("ble");
                                  return prev;
                                }
                                if (item.id === "command_registry" && !nextChecked) {
                                  setPendingDisableCoreConfirm(item.id);
                                  return prev;
                                }

                                if (nextChecked) {
                                  next.add(item.id);
                                  if (item.id === "command_registry") {
                                    next.add("ble");
                                  }
                                } else {
                                  next.delete(item.id);
                                }

                                if (!next.has("ble")) {
                                  next.delete("command_registry");
                                  next.delete("ota");
                                  next.delete("gpio");
                                  next.delete("sampler");
                                  next.delete("cc1101");
                                  next.delete("rfm69");
                                  next.delete("mfrc522");
                                }

                                if (!next.has("command_registry")) {
                                  next.delete("gpio");
                                  next.delete("sampler");
                                  next.delete("cc1101");
                                  next.delete("rfm69");
                                  next.delete("mfrc522");
                                }

                                return next;
                              });
                            }}
                          />
                          <span>{item.label}</span>
                        </label>
                      );
                    })}
                  </div>

                  <div className="mt-2 border-t border-slate-800 pt-2 text-xs text-slate-400">
                    Firmware modules
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { id: "ota", label: "OTA" },
                        { id: "gpio", label: "GPIO" },
                        { id: "sampler", label: "Sampler" },
                        { id: "cc1101", label: "CC1101" },
                        { id: "rfm69", label: "RFM69" },
                        { id: "mfrc522", label: "MFRC522" },
                      ] as const
                    ).map((item) => {
                      const checked = components.has(item.id);
                      const disabled =
                        item.id === "ota" ? !components.has("ble") : !components.has("command_registry");
                      return (
                        <label
                          key={item.id}
                          className={[
                            "flex items-center gap-2 rounded-md border bg-slate-950 px-3 py-2 text-sm text-slate-200",
                            disabled ? "border-slate-800 opacity-60" : "border-slate-700 hover:border-sky-500/60",
                          ].join(" ")}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={(event) => {
                              const nextChecked = event.target.checked;
                              setComponents((prev) => {
                                const next = new Set(prev);
                                if (nextChecked) {
                                  next.add(item.id);
                                } else {
                                  next.delete(item.id);
                                }
                                return next;
                              });
                            }}
                          />
                          <span>{item.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-2">
                    <div className="text-sm font-semibold text-slate-100">Base firmware</div>
                    <div className="text-xs text-slate-400">Default is GPIO.</div>
                  </div>
                  <select
                    value={stm32Firmware}
                    onChange={(event) =>
                      setStm32Firmware(event.target.value as Exclude<NewProjectPayload["stm32_firmware"], undefined | null>)
                    }
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="gpio">GPIO</option>
                    <option value="ir">IR</option>
                    <option value="ism">ISM</option>
                    <option value="rfid">RFID</option>
                  </select>
                </div>
              )}

              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-200 cursor-pointer"
                >
                  Back
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-200 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:bg-sky-400 cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Project name
                </label>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                  placeholder="emwaver-firmware"
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
              <div className="rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
                {target === "esp32s3" ? (
                  <span>
                    Target: ESP32-S3 • Components: {Array.from(components.values()).join(", ")}
                  </span>
                ) : (
                  <span>Target: STM32F042 • Base firmware: {stm32Firmware}</span>
                )}
              </div>
              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-transform transition-colors duration-150 hover:-translate-y-0.5 hover:border-sky-500/60 hover:bg-slate-800 hover:text-sky-200 cursor-pointer"
                >
                  Back
                </button>
                <div className="flex gap-2">
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
              </div>
            </div>
          ) : null}

        </form>
      </div>
    </div>
  );
}
