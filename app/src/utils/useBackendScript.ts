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

/**
 * Hook for executing scripts using the fast backend Boa JS engine.
 * 
 * This provides ~2ms latency for script device operations (SPI/I2C/GPIO/etc)
 * instead of ~6-8ms when using the frontend JS engine with Tauri IPC.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { safeInvoke, safeListen, isTauriAvailable } from "./tauri";
import type { ScriptTree } from "./ScriptEngine";

export interface BackendScriptState {
  tree: ScriptTree | null;
  isRunning: boolean;
  logs: string[];
  error: string | null;
}

export interface UseBackendScriptResult {
  state: BackendScriptState;
  execute: (script: string, bootstrap: string) => Promise<void>;
  stop: () => Promise<void>;
  invokeCallback: (token: string, args: unknown[]) => Promise<void>;
  clearLogs: () => void;
}

/**
 * Hook to execute scripts using the backend Boa JS engine for fast hardware access.
 */
export function useBackendScript(): UseBackendScriptResult {
  const [state, setState] = useState<BackendScriptState>({
    tree: null,
    isRunning: false,
    logs: [],
    error: null,
  });
  
  const unlistenersRef = useRef<(() => void)[]>([]);

  // Setup event listeners
  useEffect(() => {
    if (!isTauriAvailable()) return;

    const setupListeners = async () => {
      // Listen for render events
      const unlistenRender = await safeListen<unknown>("script:render", (event) => {
        const tree = event.payload as ScriptTree;
        setState((prev) => ({ ...prev, tree }));
      });
      unlistenersRef.current.push(unlistenRender);

      // Listen for print events
      const unlistenPrint = await safeListen<string>("script:print", (event) => {
        setState((prev) => ({
          ...prev,
          logs: [...prev.logs.slice(-99), event.payload], // Keep last 100 logs
        }));
      });
      unlistenersRef.current.push(unlistenPrint);

      // Listen for error events
      const unlistenError = await safeListen<string>("script:error", (event) => {
        setState((prev) => ({
          ...prev,
          error: event.payload,
          isRunning: false,
        }));
      });
      unlistenersRef.current.push(unlistenError);

      // Listen for stopped events
      const unlistenStopped = await safeListen<void>("script:stopped", () => {
        setState((prev) => ({ ...prev, isRunning: false }));
      });
      unlistenersRef.current.push(unlistenStopped);
    };

    setupListeners();

    return () => {
      unlistenersRef.current.forEach((unlisten) => unlisten());
      unlistenersRef.current = [];
    };
  }, []);

  const execute = useCallback(async (script: string, bootstrap: string) => {
    setState((prev) => ({
      ...prev,
      isRunning: true,
      error: null,
      tree: null,
    }));

    try {
      await safeInvoke("script_execute", { script, bootstrap }, { throwOnError: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        error: message,
        isRunning: false,
      }));
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await safeInvoke("script_stop", {}, { throwOnError: true });
    } catch (error) {
      console.error("Failed to stop script:", error);
    }
  }, []);

  const invokeCallback = useCallback(async (token: string, args: unknown[]) => {
    try {
      await safeInvoke("script_callback", { token, data: args }, { throwOnError: true });
    } catch (error) {
      console.error("Failed to invoke callback:", error);
    }
  }, []);

  const clearLogs = useCallback(() => {
    setState((prev) => ({ ...prev, logs: [] }));
  }, []);

  return {
    state,
    execute,
    stop,
    invokeCallback,
    clearLogs,
  };
}
