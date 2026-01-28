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
import type { OpenFile, ThemeMode } from "../workspaceTypes";
import { iconLabelForPath } from "../workspaceUtils";

type WorkspaceTopBarProps = {
  activeFile: OpenFile | null;
  isLoadingFile: boolean;
  activeMainTabKind: "file" | "preview";
  onSetPreview: (next: boolean) => void;
  canRun: boolean;
  rightActions: ReactNode;
  theme: ThemeMode;
};

export default function WorkspaceTopBar({
  activeFile,
  isLoadingFile,
  activeMainTabKind,
  onSetPreview,
  canRun,
  rightActions,
}: WorkspaceTopBarProps) {
  const fileIcon = activeFile ? iconLabelForPath(activeFile.path) : null;
  const activeFileIsDirty = activeFile?.isDirty ?? false;
  const isPreview = activeMainTabKind === "preview";

  return (
    <div className="flex items-center justify-between border-b border-slate-900 bg-slate-950">
      <div className="flex min-w-0 flex-1 items-center overflow-hidden">
        {activeFile ? (
          <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                {fileIcon ? (
                  <span
                    className={`flex h-4 w-6 shrink-0 items-center justify-center rounded bg-slate-950/40 text-[10px] font-semibold ${fileIcon.accentClass}`}
                    aria-hidden="true"
                  >
                    {fileIcon.kind === "emw" ? (
                      <span className="flex">
                        <span className="text-slate-100">E</span>
                        <span className="text-sky-400">M</span>
                      </span>
                    ) : (
                      fileIcon.label
                    )}
                  </span>
                ) : null}
                <div className="min-w-0 truncate text-xs text-slate-200" title={activeFile.path}>
                  {activeFile.name}
                </div>
                {activeFile.isDirty ? <span className="text-xs text-amber-300">●</span> : null}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <label
                className={`group flex select-none items-center gap-2 rounded-full border bg-slate-950 px-2 py-1.5 text-[11px] font-semibold ${
                  canRun && activeFile
                    ? "cursor-pointer border-slate-800 text-slate-300 hover:border-slate-700"
                    : "cursor-not-allowed border-slate-900 text-slate-600 opacity-70"
                }`}
              >
                <span className={isPreview ? "text-slate-500" : "text-slate-200"}>Edit</span>
                <span className="relative inline-flex h-5 w-10 items-center">
                  <input
                    type="checkbox"
                    checked={isPreview}
                    onChange={(event) => {
                      if (!canRun || !activeFile) return;
                      onSetPreview(event.target.checked);
                    }}
                    className="peer sr-only"
                    aria-label="Toggle run"
                  />
                  <span className="absolute inset-0 rounded-full bg-slate-900/70 ring-1 ring-inset ring-slate-800 transition-colors peer-checked:bg-emerald-500/25 peer-checked:ring-emerald-500/30" />
                  <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-slate-200 shadow-sm transition-transform peer-checked:translate-x-5 peer-checked:bg-emerald-200" />
                </span>
                <span className={isPreview ? "text-emerald-200" : "text-slate-500"}>Run</span>
              </label>
            </div>
          </div>
        ) : (
          <div className="px-4 py-2 text-xs text-slate-500">Select a file to edit</div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-3 px-4 py-2 text-xs text-slate-500">
        <div className="flex items-center gap-2">{rightActions}</div>
        {isLoadingFile ? <span>Loading…</span> : null}
        {activeFileIsDirty ? <span className="text-amber-300">Unsaved</span> : null}
      </div>
    </div>
  );
}
