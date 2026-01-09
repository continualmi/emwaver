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

import type { ScriptTree } from "../../../utils/ScriptEngine";
import ScriptUIRenderer from "../../scripts/ScriptUIRenderer";
import type { ThemeMode } from "../workspaceTypes";
import { basename } from "../workspaceUtils";

type ScriptPreviewEntry = {
  tree: ScriptTree | null;
  isRunning: boolean;
};

type ScriptPreviewPanelProps = {
  theme: ThemeMode;
  path: string;
  state: ScriptPreviewEntry | undefined;
  deviceStatus: string;
  onInvokeCallback: (token: string, args: unknown[]) => void;
};

export default function ScriptPreviewPanel({
  path,
  state,
  deviceStatus,
  onInvokeCallback,
}: ScriptPreviewPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col select-text">
      <div className="flex items-center justify-between border-b border-slate-900 bg-slate-950 px-3 py-2 text-xs">
        <div className="min-w-0 truncate text-slate-200" title={path}>
          Preview: {basename(path)}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-600">{deviceStatus}</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {state?.tree ? (
          <ScriptUIRenderer tree={state.tree as ScriptTree} onInvokeCallback={onInvokeCallback} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Preview this script to render.</div>
        )}
      </div>
    </div>
  );
}
