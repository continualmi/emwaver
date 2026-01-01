export type ThemeMode = "dark" | "light";

export type WorkspaceVariant = "ide" | "wavelets";

export type BottomPanelTab = "terminal" | "firmware";

export type FirmwareProgressPayload = {
  message: string;
  stream?: "info" | "stdout" | "stderr" | string;
  timestamp_ms?: number;
};

export type TerminalSession = {
  id: string;
  title: string;
  createdAt: number;
};

export type DirectoryChildEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
};

export type FirmwareProjectKind = "esp32" | "stm32" | "unknown";

export type OpenFile = {
  path: string;
  name: string;
  content: string;
  language: string;
  isDirty: boolean;
  diskMtimeMs?: number;
};

export type GitStatusEntry = {
  path: string;
  orig_path?: string | null;
  index_status: string;
  worktree_status: string;
  is_untracked: boolean;
  is_ignored: boolean;
};

export type GitRepoStatus = {
  repo_root: string;
  branch?: string | null;
  upstream?: string | null;
  ahead: number;
  behind: number;
  staged: GitStatusEntry[];
  changes: GitStatusEntry[];
  timestamp_ms: number;
};

export type GitDiffContents = {
  original: string;
  modified: string;
  is_binary: boolean;
};

export type NewProjectPayload = {
  name: string;
  location: string;
  target: "esp32s3" | "stm32f042";
  components: Array<"ble" | "command_registry" | "ota" | "gpio" | "sampler" | "cc1101" | "rfm69" | "mfrc522">;
  stm32_firmware?: "gpio" | "ir" | "ism" | "rfid" | null;
};

export type CreateProjectResponse = {
  path: string;
};

