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

import { DiffEditor } from "@monaco-editor/react";
import { getEmwaverMonacoTheme } from "../../../utils/monacoTheme";
import { CloseIcon } from "../WorkspaceIcons";
import type { GitDiffContents, ThemeMode } from "../workspaceTypes";

type GitDiffPanelProps = {
  theme: ThemeMode;
  filePath: string;
  onClose: () => void;
  isLoading: boolean;
  diffContents: GitDiffContents | null;
  editorOptions: Record<string, unknown>;
};

export default function GitDiffPanel({ theme, filePath, onClose, isLoading, diffContents, editorOptions }: GitDiffPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-slate-900 bg-slate-950 px-3 py-2 text-xs">
        <div className="min-w-0 truncate text-slate-200" title={filePath}>
          Diff: {filePath}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-500 hover:bg-slate-900/60 hover:text-slate-200"
          title="Close diff"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 select-text">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading diff…</div>
        ) : diffContents?.is_binary ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Binary file diff not supported.</div>
        ) : (
          <DiffEditor
            theme={getEmwaverMonacoTheme()}
            original={diffContents?.original ?? ""}
            modified={diffContents?.modified ?? ""}
            options={{
              ...editorOptions,
              readOnly: true,
              renderSideBySide: true,
            }}
          />
        )}
      </div>
    </div>
  );
}
