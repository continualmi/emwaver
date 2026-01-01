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

import { safeInvoke } from "../utils/tauri";

type IdeTabState = {
  open: string[];
  active: string | null;
};

const IDE_STATE_DIR_NAME = ".emwaver";
const IDE_STATE_FILE_NAME = "ide-tabs.json";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function normalizeRoot(rootDir: string): string {
  return normalizePath(rootDir).replace(/\/$/, "");
}

function isAbsolutePath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith("/")) return true;
  return /^[A-Za-z]:[\\/]/.test(path);
}

function stateDir(rootDir: string): string {
  return `${normalizeRoot(rootDir)}/${IDE_STATE_DIR_NAME}`;
}

function stateFile(rootDir: string): string {
  return `${stateDir(rootDir)}/${IDE_STATE_FILE_NAME}`;
}

function toProjectRelative(rootDir: string, path: string): string {
  const root = normalizeRoot(rootDir);
  const normalized = normalizePath(path);
  const prefix = `${root}/`;
  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length);
  }
  return normalized;
}

function toProjectAbsolute(rootDir: string, path: string): string {
  const root = normalizeRoot(rootDir);
  const normalized = normalizePath(path);
  if (isAbsolutePath(normalized)) {
    return normalized;
  }
  return `${root}/${normalized}`;
}

export async function readIdeTabState(rootDir: string | null): Promise<IdeTabState | null> {
  if (!rootDir) {
    return null;
  }
  const raw = await safeInvoke<string>("read_file", { payload: { path: stateFile(rootDir) } });
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<IdeTabState>;
    const openRaw = Array.isArray(parsed.open) ? parsed.open.filter((p) => typeof p === "string") : [];
    const open = openRaw.map((p) => toProjectAbsolute(rootDir, p));
    const active = typeof parsed.active === "string" ? toProjectAbsolute(rootDir, parsed.active) : null;
    return { open, active };
  } catch {
    return null;
  }
}

export async function writeIdeTabState(rootDir: string | null, openFiles: string[], active: string | null): Promise<void> {
  if (!rootDir) {
    return;
  }
  await safeInvoke<void>("ensure_dir", { payload: { path: stateDir(rootDir) } });
  const payload: IdeTabState = {
    open: openFiles.map((path) => toProjectRelative(rootDir, path)),
    active: active ? toProjectRelative(rootDir, active) : null,
  };
  await safeInvoke<void>("write_file", {
    payload: { path: stateFile(rootDir), content: JSON.stringify(payload, null, 2) },
  });
}
