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
// Intentionally minimal: no header chrome in run mode.

type ScriptPreviewEntry = {
  tree: ScriptTree | null;
  isRunning: boolean;
  error?: string | null;
};

type ScriptPreviewPanelProps = {
  theme: ThemeMode;
  state: ScriptPreviewEntry | undefined;
  onInvokeCallback: (token: string, args: unknown[]) => void;
};

export default function ScriptPreviewPanel({
  state,
  onInvokeCallback,
}: ScriptPreviewPanelProps) {
  const errorText = state?.error ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col select-text">
      <div className="min-h-0 flex-1 overflow-hidden">
        {state?.tree ? (
          <div className="h-full overflow-y-auto p-6">
            <ScriptUIRenderer tree={state.tree as ScriptTree} onInvokeCallback={onInvokeCallback} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center bg-slate-950 px-6 text-center">
            <div className="max-w-xl text-sm text-slate-500">
              {errorText ? (
                <div className="rounded border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-100">
                  {errorText}
                </div>
              ) : (
                <div>
                  This script did not render any UI.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
