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


export type WorkspaceStorageKeys = {
  root: string;
  sidebarWidth: string;
  sidebarCollapsed: string;
  terminalHeight: string;
  terminalListWidth: string;
  terminalListCollapsed: string;
  assetScriptsCollapsed?: string;
  legacy?: Partial<WorkspaceStorageKeys>;
};

export const DEFAULT_SIDEBAR_WIDTH = 320;
export const SIDEBAR_MIN_WIDTH = 140;
export const SIDEBAR_MAX_WIDTH = 1400;
export const SIDEBAR_COLLAPSE_THRESHOLD = 90;

export const DEFAULT_TERMINAL_HEIGHT = 260;
export const TERMINAL_MIN_HEIGHT = 180;
export const TERMINAL_MAX_HEIGHT = 560;

export const DEFAULT_TERMINAL_LIST_WIDTH = 224;
export const TERMINAL_LIST_MIN_WIDTH = 140;
export const TERMINAL_LIST_MAX_WIDTH = 720;
export const TERMINAL_LIST_COLLAPSE_THRESHOLD = 90;
export const TERMINAL_VIEW_MIN_WIDTH = 320;

export function storageKeys(): WorkspaceStorageKeys {
  return {
    root: "emwaver.scriptsWorkspace.root",
    sidebarWidth: "emwaver.scriptsWorkspace.sidebarWidth",
    sidebarCollapsed: "emwaver.scriptsWorkspace.sidebarCollapsed",
    terminalHeight: "emwaver.scriptsWorkspace.terminalHeight",
    terminalListWidth: "emwaver.scriptsWorkspace.terminalListWidth",
    terminalListCollapsed: "emwaver.scriptsWorkspace.terminalListCollapsed",
    assetScriptsCollapsed: "emwaver.scriptsWorkspace.assetScriptsCollapsed",
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function readStoredRoot(keys: WorkspaceStorageKeys): string | null {
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

export function readStoredSidebarWidth(keys: WorkspaceStorageKeys): number {
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

export function readStoredSidebarCollapsed(keys: WorkspaceStorageKeys): boolean {
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

export function readStoredTerminalHeight(keys: WorkspaceStorageKeys): number {
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

export function readStoredTerminalListWidth(keys: WorkspaceStorageKeys): number {
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

export function readStoredTerminalListCollapsed(keys: WorkspaceStorageKeys): boolean {
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

export function readStoredAssetScriptsCollapsed(keys: WorkspaceStorageKeys): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (!keys.assetScriptsCollapsed) {
    return false;
  }
  const stored = window.localStorage.getItem(keys.assetScriptsCollapsed);
  if (!stored) {
    return false;
  }
  return stored === "true";
}
