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

import type { MouseEvent as ReactMouseEvent, MutableRefObject, RefObject } from "react";
import { ChevronDownIcon, CloseIcon, PlusIcon, TerminalIcon, TrashIcon } from "../WorkspaceIcons";
import type { TerminalSession, ThemeMode } from "../workspaceTypes";

type StartTerminalSession = (options: { makeActive: boolean }) => Promise<string | null> | void;

type WorkspaceBottomPanelProps = {
  theme: ThemeMode;
  rootDir: string | null;

  isTerminalVisible: boolean;
  onToggleTerminalVisible: () => void;
  onClosePanel: () => void;

  terminalPanelRef: RefObject<HTMLDivElement | null>;
  terminalHeight: number;
  onTerminalResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;

  terminalPickerAnchorRef: RefObject<HTMLDivElement | null>;
  activeTerminalTitle: string;
  isTerminalPickerOpen: boolean;
  setIsTerminalPickerOpen: (next: boolean) => void;

  terminalSessions: TerminalSession[];
  activeTerminalSessionId: string | null;
  setActiveTerminalSessionId: (id: string | null) => void;
  ensureSessionTerminal: (sessionId: string) => void;
  focusActiveTerminal: () => void;

  startTerminalSession: StartTerminalSession;
  closeTerminalSession: (sessionId: string) => void;

  terminalContainerBySessionRef: MutableRefObject<Map<string, HTMLDivElement>>;

  isTerminalListCollapsed: boolean;
  onExpandTerminalList: () => void;
  onCollapseTerminalList: () => void;
  onTerminalListResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  terminalListWidth: number;
};

export default function WorkspaceBottomPanel({
  theme,
  rootDir,
  isTerminalVisible,
  onToggleTerminalVisible,
  onClosePanel,
  terminalPanelRef,
  terminalHeight,
  onTerminalResizeMouseDown,
  terminalPickerAnchorRef,
  activeTerminalTitle,
  isTerminalPickerOpen,
  setIsTerminalPickerOpen,
  terminalSessions,
  activeTerminalSessionId,
  setActiveTerminalSessionId,
  ensureSessionTerminal,
  focusActiveTerminal,
  startTerminalSession,
  closeTerminalSession,
  terminalContainerBySessionRef,
  isTerminalListCollapsed,
  onExpandTerminalList,
  onCollapseTerminalList,
  onTerminalListResizeMouseDown,
  terminalListWidth,
}: WorkspaceBottomPanelProps) {
  return (
    <div className="border-t border-slate-900 bg-slate-950">
      <button
        type="button"
        onClick={onToggleTerminalVisible}
        className={`flex w-full items-center justify-between px-4 py-2 text-left ${isTerminalVisible ? "hidden" : ""}`}
        title="Toggle terminal (Cmd/Ctrl+J)"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-200">Terminal</span>
          <span className="text-xs text-slate-600">▸</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{rootDir ? `root: ${rootDir}` : "No folder"}</span>
          <span className="text-slate-600">Cmd/Ctrl+J</span>
        </div>
      </button>

      <div className={isTerminalVisible ? "" : "hidden"}>
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize terminal"
          onMouseDown={onTerminalResizeMouseDown}
          className="h-2 cursor-row-resize bg-slate-900/50 hover:bg-slate-700/80"
        />

        <div
          ref={terminalPanelRef as unknown as RefObject<HTMLDivElement>}
          className={`flex flex-col overflow-hidden ${theme === "light" ? "bg-slate-50" : "bg-slate-950"}`}
          style={{ height: terminalHeight }}
        >
          <div className="flex items-center justify-between border-b border-slate-900/70 px-2 py-1 text-xs">
            <div className="flex items-end gap-1">
              <div className="select-none px-3 py-2 font-semibold tracking-wide text-slate-100">TERMINAL</div>
            </div>

            <div ref={terminalPickerAnchorRef as unknown as RefObject<HTMLDivElement>} className="relative flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsTerminalPickerOpen(!isTerminalPickerOpen)}
                className="inline-flex select-none items-center gap-2 rounded px-2 py-1 text-slate-300 hover:bg-slate-900/70 hover:text-slate-100"
                title="Select terminal"
              >
                <TerminalIcon className="h-4 w-4 text-slate-500" />
                <span className="max-w-[12rem] truncate">{activeTerminalTitle}</span>
                <ChevronDownIcon className="h-4 w-4 text-slate-500" />
              </button>

              {isTerminalPickerOpen ? (
                <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded border border-slate-800 bg-slate-950 shadow-xl">
                  <div className="max-h-64 overflow-auto p-1">
                    {terminalSessions.map((session) => {
                      const isActive = session.id === activeTerminalSessionId;
                      return (
                        <button
                          key={session.id}
                          type="button"
                          onClick={() => {
                            setIsTerminalPickerOpen(false);
                            setActiveTerminalSessionId(session.id);
                            requestAnimationFrame(() => {
                              ensureSessionTerminal(session.id);
                              focusActiveTerminal();
                            });
                          }}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
                            isActive ? "bg-slate-900/70 text-sky-200" : "text-slate-200 hover:bg-slate-900/50"
                          }`}
                        >
                          <TerminalIcon className={`h-4 w-4 ${isActive ? "text-sky-300" : "text-slate-500"}`} />
                          <span className="min-w-0 flex-1 truncate">{session.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void startTerminalSession({ makeActive: true })}
                className="rounded p-1 text-slate-400 hover:bg-slate-900/70 hover:text-slate-100"
                title="New terminal"
              >
                <PlusIcon />
              </button>

              <button
                type="button"
                onClick={() => {
                  const sessionId = activeTerminalSessionId;
                  if (!sessionId) {
                    return;
                  }
                  void closeTerminalSession(sessionId);
                }}
                disabled={!activeTerminalSessionId}
                className="rounded p-1 text-slate-400 enabled:hover:bg-slate-900/70 enabled:hover:text-slate-100 disabled:opacity-40"
                title="Kill active terminal"
              >
                <TrashIcon />
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
              <div className="relative min-h-0 flex-1 overflow-hidden">
                {terminalSessions.map((session) => (
                  <div
                    key={session.id}
                    ref={(node) => {
                      if (!node) {
                        terminalContainerBySessionRef.current.delete(session.id);
                        return;
                      }
                      terminalContainerBySessionRef.current.set(session.id, node);
                      if (isTerminalVisible) {
                        ensureSessionTerminal(session.id);
                      }
                    }}
                    className={`absolute inset-0 select-text px-2 py-2 ${session.id === activeTerminalSessionId ? "block" : "hidden"}`}
                  />
                ))}
                {terminalSessions.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">Starting shell…</div>
                ) : null}
              </div>
            </div>

            {isTerminalListCollapsed ? (
              <button
                type="button"
                onClick={onExpandTerminalList}
                className="flex w-9 shrink-0 items-center justify-center border-l border-slate-900 bg-slate-950 text-slate-500 hover:bg-slate-900/30 hover:text-slate-200"
                title="Show terminals"
              >
                <TerminalIcon className="h-4 w-4" />
              </button>
            ) : (
              <>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize right panel"
                  onDoubleClick={onCollapseTerminalList}
                  onMouseDown={onTerminalListResizeMouseDown}
                  className="w-2 cursor-col-resize bg-slate-900/40 hover:bg-slate-700/80"
                />

                <aside
                  className="shrink-0 bg-slate-900/15 shadow-[-10px_0_20px_-20px_rgba(0,0,0,0.9)]"
                  style={{ width: terminalListWidth }}
                >
                  <div className="h-full min-h-0 overflow-auto p-2 pt-3">
                    {terminalSessions.length === 0 ? (
                      <div className="px-2 py-1 text-xs text-slate-500">No terminals yet. Use the + button.</div>
                    ) : (
                      terminalSessions.map((session) => {
                        const isActive = session.id === activeTerminalSessionId;
                        return (
                          <div
                            key={session.id}
                            className={`group mb-1 flex items-center gap-2 rounded ${
                              isActive ? "bg-slate-900/60" : "hover:bg-slate-900/30"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setActiveTerminalSessionId(session.id);
                                requestAnimationFrame(() => {
                                  ensureSessionTerminal(session.id);
                                  focusActiveTerminal();
                                });
                              }}
                              className={`flex min-w-0 flex-1 items-center gap-2 truncate px-2 py-1 text-left text-xs transition-colors ${
                                isActive ? "text-sky-200" : "text-slate-300"
                              }`}
                              title={session.title}
                            >
                              <TerminalIcon className={`h-4 w-4 ${isActive ? "text-sky-300" : "text-slate-500"}`} />
                              <span className="min-w-0 flex-1 truncate">{session.title}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void closeTerminalSession(session.id)}
                              className={`rounded px-2 py-1 text-xs text-slate-400 transition-opacity hover:bg-slate-900/70 hover:text-slate-200 ${
                                isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                              }`}
                              title="Close terminal"
                            >
                              <CloseIcon className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </aside>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
