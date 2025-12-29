import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDevice } from "../utils/DeviceContext";

function bytesToHex(data: Uint8Array) {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

function bytesToAscii(data: Uint8Array) {
  return Array.from(data)
    .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : "."))
    .join("");
}

export default function TemplateFragment() {
  const { status, send, addNotificationListener, removeNotificationListener } = useDevice();
  const [resultText, setResultText] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);
  const [showHex, setShowHex] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const connectionLabel = useMemo(() => {
    if (!status.connected) return "Not connected";
    const label = [status.device_name, status.device_address].filter(Boolean).join(" ");
    return `${status.transport ?? "Unknown"} connected${label ? `: ${label}` : ""}`;
  }, [status.connected, status.device_address, status.device_name, status.transport]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    const listener = (data: Uint8Array, timestamp: number) => {
      const timeStr = new Date(timestamp).toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
      });
      const content = showHex ? bytesToHex(data) : bytesToAscii(data);
      setLog((prev) => [...prev.slice(-199), `[${timeStr}] ${content}`]);
    };
    addNotificationListener(listener);
    return () => {
      removeNotificationListener(listener);
    };
  }, [addNotificationListener, removeNotificationListener, showHex]);

  const runExample = useCallback(async () => {
    if (!status.connected) {
      setResultText("Not connected. Connect via the EMWaver page (USB/BLE) first, then come back.");
      return;
    }

    setIsBusy(true);
    setResultText("");
    try {
      const response = await send("version", 2500, 1);
      if (!response) {
        setResultText("Timed out waiting for response.");
        return;
      }
      setResultText(showHex ? bytesToHex(response) : bytesToAscii(response));
    } catch (error) {
      setResultText(String(error));
    } finally {
      setIsBusy(false);
    }
  }, [send, showHex, status.connected]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-950 text-slate-100">
      <div className="border-b border-slate-900 px-6 py-5">
        <h1 className="text-xl font-semibold">Template</h1>
        <p className="mt-1 text-sm text-slate-400">
          A starter view for hackers building from source. Customize this screen freely to explore new APIs and UI ideas.
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-6 lg:grid-cols-2">
        <section className="min-h-0 rounded-xl border border-slate-900 bg-slate-950/60 p-4">
          <h2 className="text-sm font-semibold text-slate-200">Getting Started</h2>
          <p className="mt-2 text-sm text-slate-400">
            This screen is intentionally simple. It’s meant to be edited by people building EMWaver from source.
          </p>
          <div className="mt-4 rounded-lg border border-slate-900 bg-black/30 p-3 text-xs text-slate-200">
            <div className="font-semibold text-slate-300">Where to customize</div>
            <div className="mt-2 space-y-1 font-mono text-[12px] text-slate-300">
              <div>Desktop: app/src/components/TemplateFragment.tsx</div>
              <div>Android: android/app/src/main/java/.../ui/template/TemplateFragment.java</div>
              <div>iOS: ios/EMWaver/Views/TemplateView.swift</div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-xs font-semibold text-slate-300">Connection</div>
            <div className="mt-1 text-xs text-slate-400">{connectionLabel}</div>
            <div className="mt-2 text-xs text-slate-500">
              Connect/disconnect in the EMWaver page (USB/BLE). This Template view only demonstrates simple calls once connected.
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={showHex}
                onChange={(e) => setShowHex(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900"
              />
              Hex view
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void runExample()}
                className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                disabled={!status.connected || isBusy}
              >
                Example: version
              </button>
              <button
                type="button"
                onClick={() => setResultText("")}
                className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-slate-900 bg-black/30 p-3">
            <div className="text-xs font-semibold text-slate-300">Result</div>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-200">{resultText || "—"}</pre>
          </div>
        </section>

        <section className="min-h-0 rounded-xl border border-slate-900 bg-slate-950/60 p-4 flex flex-col">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Notifications</h2>
            <button
              type="button"
              onClick={() => setLog([])}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              Clear
            </button>
          </div>
          <div
            ref={logRef}
            className="mt-3 flex-1 overflow-auto rounded-lg border border-slate-900 bg-black/30 p-3 font-mono text-xs text-slate-200"
          >
            {log.length === 0 ? <div className="text-slate-500">No notifications yet.</div> : log.map((line) => <div key={line}>{line}</div>)}
          </div>
        </section>
      </div>
    </div>
  );
}
