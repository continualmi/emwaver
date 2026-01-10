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

import { useMemo } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "../WorkspaceIcons";
import { SCRIPT_EXAMPLE_SCRIPTS, iconLabelForPath } from "../workspaceUtils";

type ScriptAssetsPanelProps = {
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenAsset: (filename: string) => void | Promise<void>;
};

export default function ScriptAssetsPanel({ isCollapsed, onToggleCollapsed, onOpenAsset }: ScriptAssetsPanelProps) {
  const entries = useMemo(() => SCRIPT_EXAMPLE_SCRIPTS, []);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex items-center justify-between gap-2 rounded px-2 py-2 text-left text-xs font-semibold text-slate-300 hover:bg-slate-900/60 hover:text-slate-100"
        title="Toggle example scripts"
      >
        <span className="flex items-center gap-2">
          <span className="flex h-4 w-4 items-center justify-center text-slate-500" aria-hidden="true">
            {isCollapsed ? <ChevronRightIcon className="h-3.5 w-3.5" /> : <ChevronDownIcon className="h-3.5 w-3.5" />}
          </span>
          <span>Example scripts</span>
        </span>
        <span className="text-[11px] font-normal text-slate-500">{entries.length}</span>
      </button>

      {!isCollapsed ? (
        <div className="mt-1 max-h-52 overflow-auto pr-1">
          {entries.map((filename) => {
            const icon = iconLabelForPath(filename);
            return (
              <button
                key={filename}
                type="button"
                onClick={() => void onOpenAsset(filename)}
                className="group flex w-full items-center gap-2 rounded px-2 py-[3px] text-left text-xs text-slate-400 hover:bg-slate-900/50 hover:text-slate-100"
                title={`Open ${filename}`}
              >
                <span
                  className={`flex h-4 w-6 items-center justify-center rounded bg-slate-950/40 text-[10px] font-semibold ${icon.accentClass}`}
                  aria-hidden="true"
                >
                  {icon.label}
                </span>
                <span className="min-w-0 truncate">{filename}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
