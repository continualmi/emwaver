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
import { SCRIPT_EXAMPLE_SCRIPTS, iconLabelForPath } from "../workspaceUtils";

type ScriptAssetsPanelProps = {
  onOpenAsset: (filename: string) => void | Promise<void>;
};

export default function ScriptAssetsPanel({ onOpenAsset }: ScriptAssetsPanelProps) {
  const entries = useMemo(() => SCRIPT_EXAMPLE_SCRIPTS, []);

  return (
    <div className="flex flex-col">
      <div className="max-h-64 overflow-auto pr-1">
        {entries.map((filename) => {
          const icon = iconLabelForPath(filename);
          return (
            <button
              key={filename}
              type="button"
              onClick={() => void onOpenAsset(filename)}
              className="group flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-slate-400 hover:bg-slate-900/50 hover:text-slate-100"
              title={`Open ${filename}`}
            >
              <span
                className={`flex h-4 w-6 items-center justify-center rounded bg-slate-950/40 text-[10px] font-semibold ${icon.accentClass}`}
                aria-hidden="true"
              >
                {icon.kind === "emw" ? (
                  <span className="flex">
                    <span className="text-slate-100">E</span>
                    <span className="text-sky-400">M</span>
                  </span>
                ) : (
                  icon.label
                )}
              </span>
              <span className="min-w-0 truncate">{filename}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
