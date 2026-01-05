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

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type DialogKind = "alert" | "confirm";

type DialogState = {
  open: boolean;
  kind: DialogKind;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
};

type DialogRequest =
  | { kind: "alert"; title?: string; message: string; confirmLabel?: string }
  | {
      kind: "confirm";
      title?: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
    };

type AppDialogContextType = {
  alert: (message: string, options?: { title?: string; confirmLabel?: string }) => Promise<void>;
  confirm: (
    message: string,
    options?: { title?: string; confirmLabel?: string; cancelLabel?: string },
  ) => Promise<boolean>;
};

const AppDialogContext = createContext<AppDialogContextType | null>(null);

export function useAppDialog(): AppDialogContextType {
  const ctx = useContext(AppDialogContext);
  if (!ctx) {
    throw new Error("useAppDialog must be used within AppDialogProvider");
  }
  return ctx;
}

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const resolverRef = useRef<null | ((value: boolean) => void)>(null);
  const [state, setState] = useState<DialogState>({
    open: false,
    kind: "alert",
    title: "EMWaver",
    message: "",
    confirmLabel: "OK",
    cancelLabel: "Cancel",
  });

  const close = useCallback((result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setState((prev) => ({ ...prev, open: false }));
  }, []);

  const open = useCallback((req: DialogRequest) => {
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }

    const title = req.title?.trim() ? req.title : "EMWaver";
    const confirmLabel = req.confirmLabel?.trim() ? req.confirmLabel : "OK";
    const cancelLabel =
      req.kind === "confirm" && req.cancelLabel?.trim() ? req.cancelLabel : "Cancel";

    setState({
      open: true,
      kind: req.kind,
      title,
      message: req.message,
      confirmLabel,
      cancelLabel,
    });

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const api = useMemo<AppDialogContextType>(
    () => ({
      alert: async (message, options) => {
        await open({ kind: "alert", message, ...options });
      },
      confirm: async (message, options) => {
        return await open({ kind: "confirm", message, ...options });
      },
    }),
    [open],
  );

  return (
    <AppDialogContext.Provider value={api}>
      {children}
      {state.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-100">{state.title}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{state.message}</p>
            </div>
            <div className="flex items-center justify-end gap-2">
              {state.kind === "confirm" ? (
                <button
                  type="button"
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:border-slate-500"
                  onClick={() => close(false)}
                >
                  {state.cancelLabel}
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
                onClick={() => close(true)}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppDialogContext.Provider>
  );
}

