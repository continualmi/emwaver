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

import { useEffect, useState, useRef, useCallback } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import type { FragmentType } from "../App";
import { useDevice } from "../utils/DeviceContext";
import { isTauriAvailable, safeInvoke, safeListen } from "../utils/tauri";

type HomePageProps = {
  onNavigateToFragment: (fragment: FragmentType) => void;
  isActive: boolean;
};

type DfuProgressEventPayload = {
  message: string;
  timestamp_ms?: number;
};

function displayEmwaverName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .replace(/\bEMWaver\b/gi, "")
    .replace(/\bUSB\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSemver(input: string): [number, number, number] | null {
  const m = input.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const a = Number.parseInt(m[1], 10);
  const b = Number.parseInt(m[2], 10);
  const c = Number.parseInt(m[3], 10);
  if (![a, b, c].every(Number.isFinite)) return null;
  return [a, b, c];
}

function compareSemver(a: string, b: string): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

const MAX_MONITOR_ENTRIES = 1500;
const MAX_COMMAND_ENTRIES = 600;
const DEV_MONITORS_ENABLED_KEY = "emwaver:devMonitorsEnabled";

type BufferEntry = {
  data: Uint8Array;
  timestamp: number;
  timeStr: string;
  isTx: boolean;
  seq: number;
  ascii: string;
  hex: string;
  kind?: number;
};

type CommandPacketEntry = {
  data: Uint8Array;
  timestamp: number;
  timeStr: string;
  seq: number;
  isTx: boolean;
  ascii: string;
  hex: string;
  kind: number;
};

export default function HomePage({ onNavigateToFragment, isActive }: HomePageProps) {
  const { 
    status, 
    connectMIDI,
    disconnect, 
    listMIDIPorts,
    sendPacketNoWait,
  } = useDevice();

  const [transportEntries, setTransportEntries] = useState<BufferEntry[]>([]);
  const [streamEntries, setStreamEntries] = useState<BufferEntry[]>([]);
  const [commandEntries, setCommandEntries] = useState<CommandPacketEntry[]>([]);
  const [showTxHex, setShowTxHex] = useState(false);
  const [showRxHex, setShowRxHex] = useState(false);
  const [deviceEmwaverVersion, setDeviceEmwaverVersion] = useState<string | null>(null);
  const [appEmwaverVersion, setAppEmwaverVersion] = useState<string | null>(null);

  const [dfuConnected, setDfuConnected] = useState(false);
  const [isDfuFlashing, setIsDfuFlashing] = useState(false);

  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateDone, setUpdateDone] = useState(false);
  const [dfuProgressPct, setDfuProgressPct] = useState<number>(0);
  const [dfuProgressMessage, setDfuProgressMessage] = useState<string>("");

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let cancelled = false;
    (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const version = await getVersion();
        if (!cancelled) setAppEmwaverVersion(version);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status.connected && dfuConnected) {
      setDfuConnected(false);
    }
  }, [dfuConnected, status.connected]);

  useEffect(() => {
    if (!isActive) return;
    if (!dfuConnected) return;
    if (status.connected) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const connected = await safeInvoke<boolean>("dfu_is_connected", undefined, { throwOnError: true });
        if (cancelled) return;
        if (!connected) setDfuConnected(false);
      } catch {
        // ignore
      }
    };

    void tick();
    const interval = window.setInterval(() => {
      void tick();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [dfuConnected, isActive, status.connected]);

  const [shellSessionId, setShellSessionId] = useState<string | null>(null);
  const shellContainerRef = useRef<HTMLDivElement>(null);
  const shellTerminalRef = useRef<Terminal | null>(null);
  const shellFitAddonRef = useRef<FitAddon | null>(null);
  const shellDecoderRef = useRef(new TextDecoder());
  const shellSessionIdRef = useRef<string | null>(null);
  const pendingShellOutputBySessionRef = useRef<Map<string, Uint8Array[]>>(new Map());
  
  const connectionManagerRef = useRef<{ inFlight: boolean; lastAttemptMs: number }>({
    inFlight: false,
    lastAttemptMs: 0,
  });

  const devMonitorsAllowed = import.meta.env.VITE_MONITOR === "1";
  const [devMonitorsEnabled, setDevMonitorsEnabled] = useState<boolean>(() => {
    if (!devMonitorsAllowed) return false;
    try {
      const raw = localStorage.getItem(DEV_MONITORS_ENABLED_KEY);
      if (raw !== null) return raw === "1";
    } catch {
      // ignore
    }
    // If you explicitly opt-in via env var, default to enabled.
    return import.meta.env.VITE_MONITOR === "1";
  });

  const persistDevMonitorsEnabled = useCallback((enabled: boolean) => {
    setDevMonitorsEnabled(enabled);
    try {
      localStorage.setItem(DEV_MONITORS_ENABLED_KEY, enabled ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  const transportContainerRef = useRef<HTMLDivElement>(null);
  const streamContainerRef = useRef<HTMLDivElement>(null);
  const commandContainerRef = useRef<HTMLDivElement>(null);

  const transportSeqRef = useRef(0);
  const streamSeqRef = useRef(0);
  const commandSeqRef = useRef(0);

  const transportRxIndexRef = useRef(0);
  const transportTxIndexRef = useRef(0);
  const streamRxIndexRef = useRef(0);
  const commandIndexRef = useRef(0);
  const lastVersionQueryKeyRef = useRef<string>("");

  // Always-on connection manager: auto-connects to the first EMWaver MIDI device,
  // and also auto-detects Update Mode devices.
  useEffect(() => {
    if (!isActive) return;
    if (!isTauriAvailable()) return;

    let cancelled = false;

    const tick = async () => {
      const now = Date.now();
      if (cancelled) return;
      if (isDfuFlashing) return;
      if (connectionManagerRef.current.inFlight) return;
      if (now - connectionManagerRef.current.lastAttemptMs < 800) return;
      if (status.connected) return;

      connectionManagerRef.current.inFlight = true;
      connectionManagerRef.current.lastAttemptMs = now;

      try {
        // Prefer run mode (MIDI) unless we're explicitly in update flow.
        if (!updateModalOpen) {
          const ports = await listMIDIPorts();
          if (cancelled) return;
          if (ports.length > 0) {
            setDfuConnected(false);
            await connectMIDI(ports[0]);
            return;
          }
        }

        // If no MIDI device, try Update Mode (DFU).
        const dfu = await safeInvoke<boolean>("dfu_is_connected", undefined, { throwOnError: true });
        if (cancelled) return;
        setDfuConnected(Boolean(dfu));
        if (dfu) {
          setDfuProgressMessage("Update Mode device detected.");
          setDfuProgressPct(0);
        }
      } catch {
        // ignore
      } finally {
        connectionManagerRef.current.inFlight = false;
      }
    };

    void tick();
    const interval = window.setInterval(() => void tick(), 900);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [connectMIDI, isActive, isDfuFlashing, listMIDIPorts, status.connected, updateModalOpen]);

  useEffect(() => {
    shellSessionIdRef.current = shellSessionId;
  }, [shellSessionId]);

  // Shell output wiring (listen immediately; buffer until we have a terminal + session).
  useEffect(() => {
    const unlistenPromise = safeListen<{ session_id: string; data: number[] }>("pty-output", (event) => {
      const payload = event.payload;
      if (!payload) return;

      const bytes = new Uint8Array(payload.data);
      const currentSessionId = shellSessionIdRef.current;
      const terminal = shellTerminalRef.current;

      if (terminal && currentSessionId && payload.session_id === currentSessionId) {
        terminal.write(shellDecoderRef.current.decode(bytes, { stream: true }));
        return;
      }

      const map = pendingShellOutputBySessionRef.current;
      const existing = map.get(payload.session_id) ?? [];
      existing.push(bytes);
      map.set(payload.session_id, existing);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!isActive) return;
    if (!isTauriAvailable()) return;
    if (!shellContainerRef.current) return;
    if (shellTerminalRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"Fira Code", "SF Mono", Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      theme: {
        background: "#111c32",
        foreground: "#f1f5f9",
        cursor: "#38bdf8",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(shellContainerRef.current);

    terminal.onData((data) => {
      const currentSessionId = shellSessionIdRef.current;
      if (!currentSessionId) return;
      void safeInvoke<void>("pty_write", {
        payload: {
          session_id: currentSessionId,
          data,
        },
      });
    });

    shellTerminalRef.current = terminal;
    shellFitAddonRef.current = fitAddon;

    const currentSessionId = shellSessionIdRef.current;
    if (currentSessionId) {
      const pending = pendingShellOutputBySessionRef.current.get(currentSessionId);
      if (pending && pending.length > 0) {
        pendingShellOutputBySessionRef.current.delete(currentSessionId);
        for (const chunk of pending) {
          terminal.write(shellDecoderRef.current.decode(chunk, { stream: true }));
        }
      }
    }

    return () => {
      terminal.dispose();
      fitAddon.dispose();
      shellTerminalRef.current = null;
      shellFitAddonRef.current = null;
    };
  }, [isActive, shellSessionId]);

  useEffect(() => {
    if (!isActive) return;
    if (!isTauriAvailable()) return;
    if (!status.connected) return;
    if (shellSessionId) return;

    let cancelled = false;
    const start = async () => {
      try {
        const response = await safeInvoke<{ session_id: string }>("pty_start", {
          payload: {
            cwd: null,
            cols: 120,
            rows: 18,
            emwaver_shell: true,
          },
        });
        if (cancelled) return;
        if (response?.session_id) {
          setShellSessionId(response.session_id);
          // Flush any output that arrived before the session id/state was ready.
          const terminal = shellTerminalRef.current;
          const pending = pendingShellOutputBySessionRef.current.get(response.session_id);
          if (terminal && pending && pending.length > 0) {
            pendingShellOutputBySessionRef.current.delete(response.session_id);
            for (const chunk of pending) {
              terminal.write(shellDecoderRef.current.decode(chunk, { stream: true }));
            }
          }
        }
      } catch (e) {
        console.error("Failed to start shell", e);
      }
    };

    void start();
    return () => {
      cancelled = true;
    };
  }, [isActive, shellSessionId, status.connected]);

  useEffect(() => {
    const fit = () => {
      const terminal = shellTerminalRef.current;
      const fitAddon = shellFitAddonRef.current;
      if (!terminal || !fitAddon || !shellSessionId) return;
      fitAddon.fit();
      void safeInvoke<void>("pty_resize", {
        payload: {
          session_id: shellSessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        },
      });
    };

    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [shellSessionId]);

  // Stop shell when leaving Home.
  useEffect(() => {
    if (isActive) return;
    if (!shellSessionId) return;

    let cancelled = false;
    void safeInvoke<void>("pty_stop", {
      payload: { session_id: shellSessionId },
    }).finally(() => {
      if (!cancelled) setShellSessionId(null);
    });

    return () => {
      cancelled = true;
    };
  }, [isActive, shellSessionId]);

  // Stop shell if the device disconnects.
  useEffect(() => {
    if (status.connected) return;
    if (!shellSessionId) return;

    let cancelled = false;
    void safeInvoke<void>("pty_stop", {
      payload: { session_id: shellSessionId },
    }).finally(() => {
      if (!cancelled) setShellSessionId(null);
    });

    return () => {
      cancelled = true;
    };
  }, [shellSessionId, status.connected]);

  // Auto-scroll monitors
  useEffect(() => {
    if (transportContainerRef.current) {
      transportContainerRef.current.scrollTop = transportContainerRef.current.scrollHeight;
    }
  }, [transportEntries]);

  useEffect(() => {
    const unlistenPromise = safeListen<DfuProgressEventPayload>("dfu-progress", (event) => {
      const msg = event?.payload?.message?.trim();
      if (!msg) return;

      setDfuProgressMessage(msg.replace(/\s*\(\d+%\)\s*$/, ""));
      const m = msg.match(/\((\d+)%\)/);
      if (m) {
        const pct = Number.parseInt(m[1] ?? "0", 10);
        if (Number.isFinite(pct)) setDfuProgressPct(Math.max(0, Math.min(100, pct)));
      }
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (streamContainerRef.current) {
      streamContainerRef.current.scrollTop = streamContainerRef.current.scrollHeight;
    }
  }, [streamEntries]);

  useEffect(() => {
    if (commandContainerRef.current) {
      commandContainerRef.current.scrollTop = commandContainerRef.current.scrollHeight;
    }
  }, [commandEntries]);

  const buildLogEntry = useCallback(
    (data: Uint8Array, timestamp: number, isTx: boolean, seq: number, kind?: number): BufferEntry => {
      const timeStr = new Date(timestamp).toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
      });
      const bytes = Array.from(data);
      const hex = bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
      const ascii = bytes.map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : ".")).join("");
      return { data, timestamp, timeStr, isTx, seq, ascii, hex, kind };
    },
    [],
  );

  const appendBatchToTransport = useCallback(
    (batch: Array<{ data: Uint8Array; timestamp: number; isTx: boolean; kind?: number }>) => {
      if (batch.length === 0) return;
      const built: BufferEntry[] = batch.map(({ data, timestamp, isTx, kind }) =>
        buildLogEntry(data, timestamp, isTx, transportSeqRef.current++, kind),
      );
      setTransportEntries((prev) => {
        const next = [...prev, ...built];
        next.sort((a, b) => {
          if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
          if (a.isTx !== b.isTx) return a.isTx ? -1 : 1;
          return a.seq - b.seq;
        });
        if (next.length > MAX_MONITOR_ENTRIES) {
          return next.slice(next.length - MAX_MONITOR_ENTRIES);
        }
        return next;
      });
    },
    [buildLogEntry],
  );

  const appendBatchToStream = useCallback(
    (batch: Array<{ data: Uint8Array; timestamp: number }>) => {
      if (batch.length === 0) return;
      const built: BufferEntry[] = batch.map(({ data, timestamp }) =>
        buildLogEntry(data, timestamp, false, streamSeqRef.current++),
      );
      setStreamEntries((prev) => {
        const next = [...prev, ...built];
        next.sort((a, b) => (a.timestamp !== b.timestamp ? a.timestamp - b.timestamp : a.seq - b.seq));
        if (next.length > MAX_MONITOR_ENTRIES) {
          return next.slice(next.length - MAX_MONITOR_ENTRIES);
        }
        return next;
      });
    },
    [buildLogEntry],
  );

  const appendBatchToCommandMonitor = useCallback((batch: CommandPacketEntry[]) => {
    if (batch.length === 0) return;
    const limit = devMonitorsEnabled ? MAX_COMMAND_ENTRIES : 64;
    setCommandEntries((prev) => {
      const next = [...prev, ...batch];
      next.sort((a, b) => (a.timestamp !== b.timestamp ? a.timestamp - b.timestamp : a.seq - b.seq));
      if (next.length > limit) {
        return next.slice(next.length - limit);
      }
      return next;
    });
  }, [devMonitorsEnabled]);

  // Transport Monitor: global RX/TX (128B superframes).
  useEffect(() => {
    let cancelled = false;
    let interval: number | null = null;

    const resetLocal = () => {
      setTransportEntries([]);
      transportSeqRef.current = 0;
      transportRxIndexRef.current = 0;
      transportTxIndexRef.current = 0;
    };

    const poll = async () => {
      if (cancelled || !status.connected) return;

      try {
        const batch: Array<{ data: Uint8Array; timestamp: number; isTx: boolean; kind?: number }> = [];

        // TX
        const txResp = await safeInvoke<{
          data: number[];
          ts_ms: number[];
          kinds: number[];
          next_packet_index: number;
          packet_size: number;
        }>(
          "transport_read_tx_since",
          { packetIndex: transportTxIndexRef.current, maxPackets: 64 },
          { throwOnError: true },
        );
        if (txResp?.ts_ms?.length && txResp?.data?.length) {
          const packetSize = txResp.packet_size ?? 128;
          const count = txResp.ts_ms.length;
          for (let p = 0; p < count; p++) {
            const start = p * packetSize;
            const end = start + packetSize;
            const pkt = new Uint8Array(txResp.data.slice(start, end));
            const ts = txResp.ts_ms[p];
            batch.push({ data: pkt, timestamp: ts, isTx: true, kind: txResp.kinds?.[p] ?? 0 });
          }
          transportTxIndexRef.current = txResp.next_packet_index ?? transportTxIndexRef.current + count;
        }

        // RX
        const rxResp = await safeInvoke<{
          data: number[];
          ts_ms: number[];
          kinds: number[];
          next_packet_index: number;
          packet_size: number;
        }>(
          "transport_read_rx_since",
          { packetIndex: transportRxIndexRef.current, maxPackets: 64 },
          { throwOnError: true },
        );
        if (rxResp?.ts_ms?.length && rxResp?.data?.length) {
          const packetSize = rxResp.packet_size ?? 128;
          const count = rxResp.ts_ms.length;
          for (let p = 0; p < count; p++) {
            const start = p * packetSize;
            const end = start + packetSize;
            const pkt = new Uint8Array(rxResp.data.slice(start, end));
            const ts = rxResp.ts_ms[p];
            batch.push({ data: pkt, timestamp: ts, isTx: false, kind: rxResp.kinds?.[p] ?? 0 });
          }
          transportRxIndexRef.current = rxResp.next_packet_index ?? transportRxIndexRef.current + count;
        }

        appendBatchToTransport(batch);
      } catch (e) {
        console.error("Transport Monitor poll failed", e);
      }
    };

    if (!status.connected || !devMonitorsEnabled) {
      resetLocal();
      return;
    }
    if (!isActive) return;

    resetLocal();
    void poll();
    interval = window.setInterval(poll, 500);

    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, [appendBatchToTransport, devMonitorsEnabled, isActive, status.connected]);

  // Command Monitor: TX/RX cmd lane packets (64B).
  useEffect(() => {
    let cancelled = false;
    let interval: number | null = null;

    const resetLocal = () => {
      setCommandEntries([]);
      commandSeqRef.current = 0;
      commandIndexRef.current = 0;
    };

    const poll = async () => {
      if (cancelled || !status.connected) return;

      try {
        const resp = await safeInvoke<{
          data: number[];
          ts_ms: number[];
          kinds: number[];
          next_packet_index: number;
          packet_size: number;
        }>(
          "command_read_since",
          { packetIndex: commandIndexRef.current, maxPackets: 256 },
          { throwOnError: true },
        );
        if (!resp?.ts_ms?.length || !resp?.data?.length) return;

        const packetSize = resp.packet_size ?? 64;
        const count = resp.ts_ms.length;
        const batch: CommandPacketEntry[] = [];
        for (let p = 0; p < count; p++) {
          const start = p * packetSize;
          const end = start + packetSize;
          const pkt = new Uint8Array(resp.data.slice(start, end));
          const ts = resp.ts_ms[p];
          const kind = resp.kinds?.[p] ?? 0;
          const isTx = kind === 1;
          const timeStr = new Date(ts).toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            fractionalSecondDigits: 3,
          });
          const bytes = Array.from(pkt);
          const hex = bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
          const firstZero = pkt.indexOf(0);
          const endText = firstZero >= 0 ? firstZero : pkt.length;
          const ascii = new TextDecoder().decode(pkt.slice(0, endText)).trim();
          batch.push({ data: pkt, timestamp: ts, timeStr, seq: commandSeqRef.current++, isTx, ascii, hex, kind });
        }

        commandIndexRef.current = resp.next_packet_index ?? commandIndexRef.current + count;
        appendBatchToCommandMonitor(batch);
      } catch (e) {
        console.error("Command Monitor poll failed", e);
      }
    };

    if (!status.connected) {
      resetLocal();
      return;
    }
    if (!isActive) return;

    resetLocal();
    void poll();
    interval = window.setInterval(poll, 250);

    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, [appendBatchToCommandMonitor, isActive, status.connected]);

  // Stream Monitor: sampler stream bytes (64B packets) from the shared RX buffer.
  useEffect(() => {
    let cancelled = false;
    let interval: number | null = null;

    const resetLocal = () => {
      setStreamEntries([]);
      streamSeqRef.current = 0;
      streamRxIndexRef.current = 0;
    };

    const poll = async () => {
      if (cancelled || !status.connected) return;

      try {
        const rxResp = await safeInvoke<{
          data: number[];
          ts_ms: number[];
          next_packet_index: number;
        }>(
          "buffer_read_packets_since",
          { packetIndex: streamRxIndexRef.current, maxPackets: 256 },
          { throwOnError: true },
        );
        if (!rxResp?.ts_ms?.length || !rxResp?.data?.length) return;

        const count = rxResp.ts_ms.length;
        const batch: Array<{ data: Uint8Array; timestamp: number }> = [];
        for (let p = 0; p < count; p++) {
          const start = p * 64;
          const end = start + 64;
          const pkt = new Uint8Array(rxResp.data.slice(start, end));
          const ts = rxResp.ts_ms[p];
          batch.push({ data: pkt, timestamp: ts });
        }
        streamRxIndexRef.current = rxResp.next_packet_index ?? streamRxIndexRef.current + count;
        appendBatchToStream(batch);
      } catch (e) {
        console.error("Stream Monitor poll failed", e);
      }
    };

    if (!status.connected || !devMonitorsEnabled) {
      resetLocal();
      return;
    }
    if (!isActive) return;

    resetLocal();
    void poll();
    interval = window.setInterval(poll, 500);

    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, [appendBatchToStream, devMonitorsEnabled, isActive, status.connected]);

  const openUpdateModal = useCallback(async () => {
    setUpdateError(null);
    setUpdateDone(false);
    setDfuProgressPct(0);
    setDfuProgressMessage("");
    setUpdateModalOpen(true);

    // If we're talking to the device over MIDI, disconnect so the user can enter Update Mode.
    if (status.connected) {
      try {
        await disconnect();
      } catch {
        // ignore
      }
    }
  }, [disconnect, status.connected]);

  const startUpdate = useCallback(async () => {
    setUpdateError(null);
    setUpdateDone(false);
    setDfuProgressPct(0);
    setDfuProgressMessage("Preparing update...");

    if (!dfuConnected) {
      setUpdateError(
        "Connect the device in Update Mode first (unplug, flip the Update switch to Update, plug in, then wait for EMWaver to detect it).",
      );
      return;
    }

    setIsDfuFlashing(true);
    try {
      await safeInvoke("dfu_flash_embedded", undefined, { throwOnError: true });
      setDfuProgressPct(100);
      setUpdateDone(true);
    } catch (e) {
      console.error("DFU flash failed", e);
      setUpdateError(String(e));
    } finally {
      setIsDfuFlashing(false);
    }
  }, [dfuConnected]);



  // Manual version refresh removed; version is queried automatically on connect.

  // Automatically query EMWaver version after each (new) connection.
  useEffect(() => {
    if (!status.connected) {
      lastVersionQueryKeyRef.current = "";
      return;
    }
    if (!status.transport) return;

    const key = `${status.transport}:${status.device_address ?? ""}`;
    if (key === lastVersionQueryKeyRef.current) return;
    lastVersionQueryKeyRef.current = key;

    let cancelled = false;

    const sendVersion = async () => {
      try {
        await sendPacketNoWait(new Uint8Array([0x01]));
      } catch (e) {
        console.error("Auto version query failed", e);
      }
    };

    void sendVersion();

    // Retry once if we still haven't parsed a version.
    const retry = window.setTimeout(() => {
      if (cancelled) return;
      if (!status.connected) return;
      if (lastVersionQueryKeyRef.current !== key) return;
      if (deviceEmwaverVersion) return;
      void sendVersion();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearTimeout(retry);
    };
  }, [deviceEmwaverVersion, sendPacketNoWait, status.connected, status.device_address, status.transport]);

  const clearMonitor = async () => {
    try {
      await safeInvoke("buffer_clear", undefined, { throwOnError: true });
    } catch (e) {
      console.error("Failed to clear buffer", e);
    } finally {
      setTransportEntries([]);
      setStreamEntries([]);
      setCommandEntries([]);

      transportSeqRef.current = 0;
      streamSeqRef.current = 0;
      commandSeqRef.current = 0;

      transportRxIndexRef.current = 0;
      transportTxIndexRef.current = 0;
      streamRxIndexRef.current = 0;
      commandIndexRef.current = 0;
    }
  };

  // Extract version from notification when connected
  useEffect(() => {
    if (!status.connected) {
      setDeviceEmwaverVersion(null);
      return;
    }

    // Only treat an RX packet as a version response if it follows a VERSION request (opcode 0x01).
    // Many other command responses start with status=0 and would otherwise be mis-parsed as semver.
    let lastVersionTxIndex = -1;
    for (let i = commandEntries.length - 1; i >= 0; i--) {
      const entry = commandEntries[i];
      if (!entry.isTx) continue;
      if (entry.data?.[0] === 0x01) {
        lastVersionTxIndex = i;
        break;
      }
    }
    if (lastVersionTxIndex < 0) return;

    const tx = commandEntries[lastVersionTxIndex];
    const txTs = tx.timestamp;
    const MAX_VERSION_RTT_MS = 1500;

    for (let i = lastVersionTxIndex + 1; i < commandEntries.length; i++) {
      const entry = commandEntries[i];
      if (entry.isTx) continue;
      if (entry.timestamp < txTs) continue;
      if (entry.timestamp - txTs > MAX_VERSION_RTT_MS) break;

      // Expected: [status=0, major, minor, patch, ...]
      if (!entry.data || entry.data.length < 4) continue;
      if (entry.data[0] !== 0) continue;
      if (!Array.from(entry.data.slice(4)).every((b) => b === 0)) continue;

      const major = entry.data[1];
      const minor = entry.data[2];
      const patch = entry.data[3];
      const version = `${major}.${minor}.${patch}`;
      setDeviceEmwaverVersion(version);
      return;
    }
  }, [commandEntries, status.connected]);

  const deviceVersionMismatch = Boolean(
    status.connected && deviceEmwaverVersion && appEmwaverVersion && deviceEmwaverVersion !== appEmwaverVersion,
  );
  const deviceVersionCmp =
    status.connected && deviceEmwaverVersion && appEmwaverVersion
      ? compareSemver(deviceEmwaverVersion, appEmwaverVersion)
      : null;
  const deviceVersionOlder = deviceVersionMismatch && (deviceVersionCmp === null || deviceVersionCmp < 0);

  return (
    <section className="flex flex-1 flex-col min-h-0 bg-slate-950">
      {updateModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-100">Update EMWaver</h2>
                <p className="mt-2 text-sm text-slate-300">Update your device to the latest EMWaver version.</p>
              </div>
              <button
                type="button"
                disabled={isDfuFlashing}
                onClick={() => setUpdateModalOpen(false)}
                className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs text-slate-200 hover:bg-black/30 disabled:opacity-60"
                aria-label="Close"
                title="Close"
              >
                Close
              </button>
            </div>

            {!dfuConnected && !updateDone ? (
              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-200">
                <div className="font-medium text-slate-100">Put the device into Update Mode</div>
                <div className="mt-1 text-xs text-slate-400">
                  Unplug, flip the Update switch to
                  <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/20 px-2 py-0.5 mx-1 text-slate-200">
                    <GearIcon className="h-3.5 w-3.5 text-slate-200" />
                    Update
                  </span>
                  , plug back in, and wait for EMWaver to detect it.
                </div>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <GearIcon className="h-3.5 w-3.5" />
                    Update mode
                  </span>
                  <span className="text-slate-600">|</span>
                  <span className="inline-flex items-center gap-1">
                    <PlayIcon className="h-3.5 w-3.5" />
                    Run mode
                  </span>
                </div>
              </div>
            ) : null}

            {dfuConnected && !updateDone ? (
              <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-200">
                Device connected in Update Mode.
              </div>
            ) : null}

            {updateError ? (
              <div className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-sm text-rose-200 whitespace-pre-wrap">
                {updateError}
              </div>
            ) : null}

            {isDfuFlashing ? (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{dfuProgressMessage || "Updating..."}</span>
                  <span>{Math.round(dfuProgressPct)}%</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded bg-slate-800">
                  <div
                    className="h-full bg-sky-400/60 transition-[width] duration-150"
                    style={{ width: `${Math.max(0, Math.min(100, dfuProgressPct))}%` }}
                  />
                </div>
              </div>
            ) : null}

            {updateDone ? (
              <div className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm text-emerald-200">
                Update complete. Unplug the device, flip the Update switch to
                <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/20 px-2 py-0.5 mx-1 text-emerald-100">
                  <PlayIcon className="h-3.5 w-3.5" />
                  Run
                </span>
                , and reconnect.
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              {!updateDone ? (
                <button
                  type="button"
                  onClick={() => void startUpdate()}
                  disabled={!dfuConnected || isDfuFlashing}
                  className="px-3 py-2 rounded text-sm font-medium text-slate-950 bg-sky-300 hover:bg-sky-200 disabled:opacity-60 transition-colors"
                >
                  Update device
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className="flex flex-1 flex-col min-h-0 gap-3 overflow-y-auto px-6 py-4">
        {/* Connection Status and EMWaver Version - Side by Side */}
        <div className="grid grid-cols-2 gap-3 flex-shrink-0">
          {/* Connection Status */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold text-slate-300">Connection</span>
                {devMonitorsAllowed ? (
                  <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={devMonitorsEnabled}
                      onChange={(e) => persistDevMonitorsEnabled(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-600"
                    />
                    <span>Monitors</span>
                  </label>
                ) : null}
              </div>
              
              <div className="flex items-center justify-between gap-2">
	                <div className="flex flex-1 items-center justify-between">
	                  <div className="flex flex-col">
	                    {status.connected ? (
	                      <span className="text-sm font-semibold text-emerald-300">Connected</span>
	                    ) : dfuConnected ? (
	                      <span className="text-sm font-semibold text-amber-300">Update Mode detected</span>
	                    ) : (
	                      <span className="text-sm font-semibold text-slate-300">Searching for device...</span>
	                    )}
	                    <span
	                      className="text-xs text-slate-500 truncate max-w-[220px]"
	                      title={dfuConnected ? "Update Mode" : (status.device_address || "")}
	                    >
	                      {status.connected
	                        ? (displayEmwaverName(status.device_address) || "Device")
	                        : dfuConnected
	                          ? "plugged in (Update Mode)"
	                          : "connect device or enter Update Mode"}
	                    </span>
	                  </div>
	                  {!status.connected && !dfuConnected ? (
	                    <div className="h-2.5 w-2.5 rounded-full bg-slate-500/40 animate-pulse" aria-hidden="true" />
	                  ) : null}
	                </div>
              </div>

            </div>
          </div>

           {/* EMWaver Version */}
           <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
             <div className="flex items-center justify-between h-full">
               <div className="flex items-center gap-3">
                  <img
                    src="/device-icons/emwaver-icon.png"
                    alt="Device icon"
                    className="h-20 w-20 rounded-2xl bg-slate-950/30 p-1"
                    draggable={false}
                  />
                  <div className="flex flex-col justify-center">
                   {!dfuConnected && !updateModalOpen && status.connected && deviceEmwaverVersion ? (
                     <span className="text-base font-semibold text-blue-300">{deviceEmwaverVersion}</span>
                   ) : null}
                  {dfuConnected || updateModalOpen ? null : status.connected ? (
                    deviceEmwaverVersion ? (
                      appEmwaverVersion ? (
                        deviceVersionMismatch ? (
                          <span className="mt-1 text-sm text-amber-200">
                            Your device is running an {deviceVersionOlder ? "older" : "different"} EMWaver version {deviceEmwaverVersion}. Update it.
                          </span>
                        ) : (
                          <span className="mt-1 text-sm text-emerald-200">Device emwaver version is up to date</span>
                        )
                      ) : (
                        <span className="mt-1 text-sm text-slate-500">Checking...</span>
                      )
                    ) : (
                      <span className="mt-1 text-sm text-slate-500">Checking device...</span>
                    )
                  ) : (
                    <span className="mt-1 text-sm text-slate-500">Connect a device to check</span>
                  )}

                  {deviceVersionMismatch || dfuConnected ? (
                    <>
                      <span className="mt-3 text-xs font-medium text-slate-400">Update device emwaver version</span>
                      <button
                        type="button"
                        onClick={() => void openUpdateModal()}
                        className="mt-2 inline-flex items-center justify-center px-3 py-1.5 rounded text-sm font-semibold text-sky-100 bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/20 transition-colors"
                      >
                        Update device
                      </button>
                    </>
                  ) : null}
                 </div>
               </div>
             </div>
           </div>
         </div>

        {/* Shell (emwaver shell) */}
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 flex flex-col flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-slate-400">Shell</div>
            <div className="text-xs text-slate-600">
              {!status.connected ? "connect device" : shellSessionId ? "ready" : "starting..."}
            </div>
          </div>
          <div ref={shellContainerRef} className="h-40 overflow-hidden bg-slate-900 p-2" />
        </div>

        {devMonitorsEnabled ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 flex flex-col flex-1 min-h-[18rem]">
            <>
              {/* Transport Monitor */}
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <div className="text-sm font-semibold text-slate-400">Transport Monitor</div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showTxHex}
                      onChange={(e) => setShowTxHex(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-600"
                    />
                    <span>TX HEX</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showRxHex}
                      onChange={(e) => setShowRxHex(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-600"
                    />
                    <span>RX HEX</span>
                  </label>
                  <button
                    onClick={clearMonitor}
                    className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 rounded hover:border-slate-700 transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div ref={transportContainerRef} className="overflow-y-auto overflow-x-hidden font-mono text-sm text-slate-300 bg-slate-900 rounded p-3 flex-1 min-h-0">
                {transportEntries.length === 0 ? (
                  <div className="text-slate-500">No transport packets yet...</div>
                ) : (
                  <>
                    {transportEntries.map((entry) => {
                      const content = entry.isTx ? (showTxHex ? entry.hex : entry.ascii) : (showRxHex ? entry.hex : entry.ascii);
                      const kind = entry.kind ?? 0;
                      const flags = [
                        (kind & 0x01) !== 0 ? "C" : "",
                        (kind & 0x02) !== 0 ? "M" : "",
                        (kind & 0x04) !== 0 ? "S" : "",
                        (kind & 0x08) !== 0 ? "B" : "",
                      ].filter(Boolean).join("");

                      return (
                        <div key={entry.seq} className="mb-1 whitespace-pre-wrap break-words">
                          <span className="text-slate-500">{`[${entry.timeStr}] `}</span>
                          {flags ? <span className="text-slate-500">{`[${flags}] `}</span> : null}
                          <span className={entry.isTx ? "text-slate-100" : "text-sky-400"}>{content}</span>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {/* Command Monitor */}
              <div className="mt-3 flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-slate-400">Command Monitor</div>
                  <button
                    onClick={clearMonitor}
                    className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 rounded hover:border-slate-700 transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div ref={commandContainerRef} className="max-h-40 overflow-y-auto overflow-x-hidden font-mono text-xs text-slate-300 bg-slate-900 rounded p-3">
                  {commandEntries.length === 0 ? (
                    <div className="text-slate-500">No commands yet...</div>
                  ) : (
                    commandEntries.map((entry) => {
                      const dir = entry.isTx ? ">" : "<";
                      const color = entry.isTx ? "text-slate-100" : "text-sky-400";
                      return (
                        <div key={entry.seq} className="mb-2 whitespace-pre-wrap break-words">
                          <div>
                            <span className="text-slate-500">{`[${entry.timeStr}] `}</span>
                            <span className={color}>{`${dir} ${entry.ascii || "(empty)"}`}</span>
                          </div>
                          <div className="text-slate-600">{entry.hex}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Stream Monitor */}
              <div className="mt-3 flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-slate-400">Stream Monitor</div>
                  <button
                    onClick={clearMonitor}
                    className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 rounded hover:border-slate-700 transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div ref={streamContainerRef} className="max-h-40 overflow-y-auto overflow-x-hidden font-mono text-xs text-slate-300 bg-slate-900 rounded p-3">
                  {streamEntries.length === 0 ? (
                    <div className="text-slate-500">No stream packets yet...</div>
                  ) : (
                    streamEntries.map((entry) => {
                      const content = showRxHex ? entry.hex : entry.ascii;
                      return (
                        <div key={entry.seq} className="mb-1 whitespace-pre-wrap break-words">
                          <span className="text-slate-500">{`[${entry.timeStr}] `}</span>
                          <span className="text-sky-400">{content}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function IDEIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-full w-full" aria-hidden="true">
      <path
        d="M7 8l-3 4 3 4M17 8l3 4-3 4M14 6l-4 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-full w-full">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7.1 3.2l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className ?? "h-4 w-4"}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7.1 3.2l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className ?? "h-4 w-4"} aria-hidden="true">
      <path d="M5.2 3.6a.8.8 0 011.2-.7l6.2 3.6a.8.8 0 010 1.4l-6.2 3.6a.8.8 0 01-1.2-.7V3.6z" />
    </svg>
  );
}

function ISMIcon() {
  // Converted from Android chip_svgrepo_com.xml
  return (
    <svg viewBox="0 0 206.74 206.74" fill="currentColor" className="h-full w-full">
      <path d="M135.33,63.91H71.41c-4.14,0 -7.5,3.36 -7.5,7.5v63.91c0,4.14 3.36,7.5 7.5,7.5h63.91c4.14,0 7.5,-3.36 7.5,-7.5V71.41C142.83,67.27 139.47,63.91 135.33,63.91zM127.83,127.83H78.91V78.91h48.91V127.83z" />
      <path d="M199.24,110.87c4.14,0 7.5,-3.36 7.5,-7.5s-3.36,-7.5 -7.5,-7.5h-24.45V78.91h24.45c4.14,0 7.5,-3.36 7.5,-7.5c0,-4.14 -3.36,-7.5 -7.5,-7.5h-24.45V39.46c0,-4.14 -3.36,-7.5 -7.5,-7.5h-24.46V7.5c0,-4.14 -3.36,-7.5 -7.5,-7.5c-4.14,0 -7.5,3.36 -7.5,7.5v24.45h-16.96V7.5c0,-4.14 -3.36,-7.5 -7.5,-7.5s-7.5,3.36 -7.5,7.5v24.45H78.91V7.5c0,-4.14 -3.36,-7.5 -7.5,-7.5c-4.14,0 -7.5,3.36 -7.5,7.5v24.45H39.46c-4.14,0 -7.5,3.36 -7.5,7.5v24.46H7.5c-4.14,0 -7.5,3.36 -7.5,7.5c0,4.14 3.36,7.5 7.5,7.5h24.46v16.96H7.5c-4.14,0 -7.5,3.36 -7.5,7.5s3.36,7.5 7.5,7.5h24.46v16.96H7.5c-4.14,0 -7.5,3.36 -7.5,7.5c0,4.14 3.36,7.5 7.5,7.5h24.46v24.46c0,4.14 3.36,7.5 7.5,7.5h24.46v24.45c0,4.14 3.36,7.5 7.5,7.5c4.14,0 7.5,-3.36 7.5,-7.5v-24.45h16.96v24.45c0,4.14 3.36,7.5 7.5,7.5s7.5,-3.36 7.5,-7.5v-24.45h16.96v24.45c0,4.14 3.36,7.5 7.5,7.5c4.14,0 7.5,-3.36 7.5,-7.5v-24.45h24.46c4.14,0 7.5,-3.36 7.5,-7.5v-24.46h24.45c4.14,0 7.5,-3.36 7.5,-7.5c0,-4.14 -3.36,-7.5 -7.5,-7.5h-24.45v-16.96H199.24zM159.78,159.78H46.96V46.96h112.83V159.78z" />
    </svg>
  );
}

function SamplerIcon() {
  // Converted from Android ic_rawmode_black_24dp.xml (waveform icon)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-full w-full">
      <path d="M 0.00 12.00 L 0.24 12.63 L 0.48 13.27 L 0.73 13.89 L 0.97 14.51 L 1.21 15.12 L 1.45 15.72 L 1.70 16.30 L 1.94 16.86 L 2.18 17.41 L 2.42 17.93 L 2.67 18.43 L 2.91 18.90 L 3.15 19.35 L 3.39 19.76 L 3.64 20.15 L 3.88 20.50 L 4.12 20.82 L 4.36 21.10 L 4.61 21.34 L 4.85 21.55 L 5.09 21.72 L 5.33 21.85 L 5.58 21.94 L 5.82 21.99 L 6.06 22.00 L 6.30 21.97 L 6.55 21.90 L 6.79 21.79 L 7.03 21.64 L 7.27 21.45 L 7.52 21.22 L 7.76 20.96 L 8.00 20.66 L 8.24 20.33 L 8.48 19.96 L 8.73 19.56 L 8.97 19.13 L 9.21 18.67 L 9.45 18.18 L 9.70 17.67 L 9.94 17.14 L 10.18 16.58 L 10.42 16.01 L 10.67 15.42 L 10.91 14.82 L 11.15 14.20 L 11.39 13.58 L 11.64 12.95 L 11.88 12.32 L 12.12 11.68 L 12.36 11.05 L 12.61 10.42 L 12.85 9.80 L 13.09 9.18 L 13.33 8.58 L 13.58 7.99 L 13.82 7.42 L 14.06 6.86 L 14.30 6.33 L 14.55 5.82 L 14.79 5.33 L 15.03 4.87 L 15.27 4.44 L 15.52 4.04 L 15.76 3.67 L 16.00 3.34 L 16.24 3.04 L 16.48 2.78 L 16.73 2.55 L 16.97 2.36 L 17.21 2.21 L 17.45 2.10 L 17.70 2.03 L 17.94 2.00 L 18.18 2.01 L 18.42 2.06 L 18.67 2.15 L 18.91 2.28 L 19.15 2.45 L 19.39 2.66 L 19.64 2.90 L 19.88 3.18 L 20.12 3.50 L 20.36 3.85 L 20.61 4.24 L 20.85 4.65 L 21.09 5.10 L 21.33 5.57 L 21.58 6.07 L 21.82 6.59 L 22.06 7.14 L 22.30 7.70 L 22.55 8.28 L 22.79 8.88 L 23.03 9.49 L 23.27 10.11 L 23.52 10.73 L 23.76 11.37 L 24.00 12.00" />
    </svg>
  );
}

function RfidIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full">
      <path d="M12.5,11a1.5,1.5 0,1 0,1.5 1.5,1.502 1.502,0 0,0 -1.5,-1.5zM7.916,17.219a6.769,6.769 0,0 1,0 -9.438l0.718,0.697a5.769,5.769 0,0 0,0 8.044zM5.071,19.914a10.497,10.497 0,0 1,0 -14.828l0.707,0.707a9.497,9.497 0,0 0,0 13.414zM17.084,17.219l-0.718,-0.697a5.769,5.769 0,0 0,0 -8.044l0.718,-0.697a6.769,6.769 0,0 1,0 9.438zM19.929,19.914l-0.707,-0.707a9.497,9.497 0,0 0,0 -13.414l0.707,-0.707a10.497,10.497 0,0 1,0 14.828z" />
    </svg>
  );
}

function PacketModeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full">
      <path d="M10.5911 2.51301C11.4947 2.14671 12.5053 2.14671 13.4089 2.51301L20.9075 5.55298C21.5679 5.82071 22 6.46216 22 7.17477V16.8275C22 17.5401 21.5679 18.1815 20.9075 18.4493L13.4089 21.4892C12.5053 21.8555 11.4947 21.8555 10.5911 21.4892L3.09252 18.4493C2.43211 18.1815 2 17.5401 2 16.8275V7.17477C2 6.46216 2.43211 5.82071 3.09252 5.55298L10.5911 2.51301ZM12.8453 3.90312C12.3032 3.68334 11.6968 3.68334 11.1547 3.90312L9.24097 4.67894L16.7678 7.60604L19.437 6.57542L12.8453 3.90312ZM14.6911 8.40787L7.21472 5.50039L4.59029 6.56435L12.0013 9.44642L14.6911 8.40787ZM3.5 16.8275C3.5 16.9293 3.56173 17.0209 3.65607 17.0592L11.1547 20.0991C11.1863 20.112 11.2183 20.1241 11.2503 20.1354V10.7638L3.5 7.74979V16.8275ZM12.8453 20.0991L20.3439 17.0592C20.4383 17.0209 20.5 16.9293 20.5 16.8275V7.77292L12.7503 10.7651V20.1352C12.7822 20.1239 12.8139 20.1119 12.8453 20.0991Z" />
    </svg>
  );
}
