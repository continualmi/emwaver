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

import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, MutableRefObject, RefObject } from "react";
import { useMemo, useState } from "react";
import { CloseIcon } from "../WorkspaceIcons";

type WorkspaceBottomPanelProps = {
  rootDir: string | null;

  isVisible: boolean;
  onToggleVisible: () => void;
  onClosePanel: () => void;

  consoleLines: string[];
  consoleAnchorRef: MutableRefObject<HTMLDivElement | null>;
  onClearConsole: () => void;
  onSubmitConsoleInput: (line: string) => void;

  panelRef: RefObject<HTMLDivElement | null>;
  height: number;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
};

export default function WorkspaceBottomPanel({
  rootDir,
  isVisible,
  onToggleVisible,
  onClosePanel,
  consoleLines,
  consoleAnchorRef,
  onClearConsole,
  onSubmitConsoleInput,
  panelRef,
  height,
  onResizeMouseDown,
}: WorkspaceBottomPanelProps) {
  const consoleText = useMemo(() => consoleLines.join("\n"), [consoleLines]);
  const [consoleInput, setConsoleInput] = useState("");

  const submitConsoleInput = () => {
    const trimmed = consoleInput.replace(/\r?\n/g, "").trimEnd();
    if (!trimmed) {
      return;
    }
    onSubmitConsoleInput(trimmed);
    setConsoleInput("");
  };

  const handleConsoleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    submitConsoleInput();
  };

  return (
    <div className="border-t border-slate-900 bg-slate-950">
      <button
        type="button"
        onClick={onToggleVisible}
        className={`flex w-full items-center justify-between px-4 py-2 text-left ${isVisible ? "hidden" : ""}`}
        title="Toggle console (Cmd/Ctrl+J)"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-200">Console</span>
          <span className="text-xs text-slate-600">▸</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{rootDir ? `root: ${rootDir}` : "No folder"}</span>
          <span className="text-slate-600">Cmd/Ctrl+J</span>
        </div>
      </button>

      <div className={isVisible ? "" : "hidden"}>
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize console"
          onMouseDown={onResizeMouseDown}
          className="h-2 cursor-row-resize bg-slate-900/50 hover:bg-slate-700/80"
        />

        <div
          ref={panelRef as unknown as RefObject<HTMLDivElement>}
          className="flex flex-col overflow-hidden bg-slate-950"
          style={{ height }}
        >
          <div className="flex items-center justify-between border-b border-slate-900/70 px-2 py-1 text-xs">
            <div className="flex items-center gap-2 px-3 py-2 font-semibold tracking-wide text-slate-100">CONSOLE</div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClearConsole}
                className="rounded px-2 py-1 text-[11px] font-semibold tracking-wide text-slate-300 hover:bg-slate-900/70 hover:text-slate-100"
                title="Clear console output"
              >
                CLEAR
              </button>

              <button
                type="button"
                onClick={onClosePanel}
                className="rounded p-1 text-slate-400 hover:bg-slate-900/70 hover:text-slate-100"
                title="Close panel (Cmd/Ctrl+J)"
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs text-slate-200">
                {consoleLines.length === 0 ? (
                  <div className="pt-2 text-slate-500">No output yet.</div>
                ) : (
                  <pre className="whitespace-pre-wrap font-mono leading-relaxed">{consoleText}</pre>
                )}
                <div ref={consoleAnchorRef} />
              </div>

              <div className="border-t border-slate-900/70 bg-slate-950 px-3 py-2">
                <div className="flex items-center gap-2">
                  <input
                    value={consoleInput}
                    onChange={(event) => setConsoleInput(event.target.value)}
                    onKeyDown={handleConsoleInputKeyDown}
                    placeholder="Type a line and press Enter… (Console.readLine())"
                    className="min-w-0 flex-1 rounded border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-slate-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={submitConsoleInput}
                    className="rounded bg-slate-900 px-2 py-1 text-[11px] font-semibold tracking-wide text-slate-200 hover:bg-slate-800"
                    title="Send (Enter)"
                  >
                    SEND
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
