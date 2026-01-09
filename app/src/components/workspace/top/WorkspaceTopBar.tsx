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

import type { ReactNode } from "react";
import { CloseIcon } from "../WorkspaceIcons";
import type { OpenFile, ThemeMode } from "../workspaceTypes";
import { basename, iconLabelForPath } from "../workspaceUtils";

type WorkspaceTopBarProps = {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  activeFileIsDirty: boolean;
  isLoadingFile: boolean;
  activeMainTabKind: "file" | "preview";
  activePreviewPath: string | null;
  scriptPreviewTabs: string[];
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  onSelectPreview: (path: string) => void;
  onClosePreview: (path: string) => void;
  rightActions: ReactNode;
  theme: ThemeMode;
};

export default function WorkspaceTopBar({
  openFiles,
  activeFilePath,
  activeFileIsDirty,
  isLoadingFile,
  activeMainTabKind,
  activePreviewPath,
  scriptPreviewTabs,
  onSelectFile,
  onCloseFile,
  onSelectPreview,
  onClosePreview,
  rightActions,
}: WorkspaceTopBarProps) {
  return (
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
                    onClick={() => onSelectFile(file.path)}
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
                    onClick={() => onCloseFile(file.path)}
                    className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200 group-hover:block"
                    title="Close (Cmd/Ctrl+W)"
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          )}
          {scriptPreviewTabs.map((path) => {
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
                  onClick={() => onSelectPreview(path)}
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
                  onClick={() => onClosePreview(path)}
                  className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200 group-hover:block"
                  title="Close preview"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-3 px-4 py-2 text-xs text-slate-500">
        <div className="flex items-center gap-2">{rightActions}</div>
        {isLoadingFile ? <span>Loading…</span> : null}
        {activeFileIsDirty ? <span className="text-amber-300">Unsaved</span> : null}
      </div>
    </div>
  );
}

