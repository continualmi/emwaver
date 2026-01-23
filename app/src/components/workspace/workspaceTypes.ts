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

export type ThemeMode = "dark";

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

export type OpenFile = {
  path: string;
  name: string;
  content: string;
  language: string;
  isDirty: boolean;
  diskMtimeMs?: number;
  source?: "disk" | "asset";
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
};

export type CreateProjectResponse = {
  path: string;
};
