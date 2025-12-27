import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ThemeMode = "dark" | "light";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { isTauriAvailable, safeInvoke } from "../utils/tauri";

type FirmwareOption = {
  id: "ism" | "gpio" | "ir" | "rfid";
  label: string;
};

type ProgressEventPayload = {
  message: string;
  timestamp_ms?: number;
};

type OtaProgressEventPayload = {
  message: string;
  sent_bytes?: number;
  total_bytes?: number;
  timestamp_ms?: number;
};

type BleStatus = {
  connected: boolean;
  scanning: boolean;
  device_name?: string | null;
  device_address?: string | null;
};

const FIRMWARE_OPTIONS: FirmwareOption[] = [
  { id: "ism", label: "ISM" },
  { id: "gpio", label: "GPIO" },
  { id: "ir", label: "IR" },
  { id: "rfid", label: "RFID" },
];

export default function FlashFragment({ theme = "dark" }: { theme?: ThemeMode }) {
  const firmwareOptions = useMemo(() => FIRMWARE_OPTIONS, []);
  const [selectedFirmware, setSelectedFirmware] = useState<FirmwareOption["id"]>("ism");
  const [externalFilePath, setExternalFilePath] = useState<string | null>(null);
  const [otaFilePath, setOtaFilePath] = useState<string | null>(null);
  const [dfuConnected, setDfuConnected] = useState<boolean>(false);
  const [bleConnected, setBleConnected] = useState<boolean>(false);
  const [bleDeviceLabel, setBleDeviceLabel] = useState<string | null>(null);
  const [isFlashing, setIsFlashing] = useState<boolean>(false);
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const appendProgress = useCallback((line: string) => {
    const ts = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
    setProgressLines((prev) => [...prev.slice(-499), `[${ts}] ${line}`]);
  }, []);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [progressLines]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let unlistenOta: (() => void) | null = null;
    const register = async () => {
      if (!isTauriAvailable()) return;
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<ProgressEventPayload>("dfu-progress", (event) => {
        if (event.payload?.message) {
          appendProgress(event.payload.message);
        }
      });
      unlistenOta = await listen<OtaProgressEventPayload>("ota-progress", (event) => {
        if (event.payload?.message) {
          const sent = typeof event.payload.sent_bytes === "number" ? event.payload.sent_bytes : null;
          const total = typeof event.payload.total_bytes === "number" ? event.payload.total_bytes : null;
          if (sent != null && total != null && total > 0) {
            appendProgress(`${event.payload.message} (${sent}/${total})`);
          } else {
            appendProgress(event.payload.message);
          }
        }
      });
    };
    void register();
    return () => {
      if (unlisten) unlisten();
      if (unlistenOta) unlistenOta();
    };
  }, [appendProgress]);

  const refreshDfuStatus = useCallback(async () => {
    try {
      const connected = await safeInvoke<boolean>("dfu_is_connected", undefined, { throwOnError: true });
      setDfuConnected(Boolean(connected));
      appendProgress(Boolean(connected) ? "DFU device detected." : "No DFU device detected.");
    } catch (error) {
      console.error(error);
      appendProgress(`Error checking DFU device: ${String(error)}`);
      setDfuConnected(false);
    }
  }, [appendProgress]);

  const refreshBleStatus = useCallback(async () => {
    try {
      try {
        const status = await safeInvoke<BleStatus>("ble_get_status", undefined, { throwOnError: true });
        setBleConnected(Boolean(status?.connected));
        if (status?.connected) {
          const label = [status.device_name, status.device_address].filter(Boolean).join(" ");
          setBleDeviceLabel(label || "Connected");
          appendProgress(`BLE connected: ${label || "yes"}`);
        } else {
          setBleDeviceLabel(null);
          appendProgress("BLE not connected.");
        }
        return;
      } catch (error) {
        const message = String(error);
        if (!message.toLowerCase().includes("ble not initialized")) {
          throw error;
        }
      }

      await safeInvoke("ble_initialize", undefined, { throwOnError: true });
      const status = await safeInvoke<BleStatus>("ble_get_status", undefined, { throwOnError: true });
      setBleConnected(Boolean(status?.connected));
      setBleDeviceLabel(status?.connected ? [status.device_name, status.device_address].filter(Boolean).join(" ") : null);
      appendProgress("BLE initialized.");
    } catch (error) {
      console.error(error);
      appendProgress(`Error checking BLE status: ${String(error)}`);
      setBleConnected(false);
      setBleDeviceLabel(null);
    }
  }, [appendProgress]);

  const handleSelectExternalFile = useCallback(async () => {
    try {
      const path = await openDialog({
        title: "Select firmware binary",
        multiple: false,
        directory: false,
        filters: [{ name: "Firmware", extensions: ["dfu", "bin"] }],
      });

      if (typeof path === "string" && path.length > 0) {
        setExternalFilePath(path);
        appendProgress(`Selected external file: ${path}`);
      }
    } catch (error) {
      console.error(error);
      appendProgress(`Failed to select file: ${String(error)}`);
    }
  }, [appendProgress]);

  const handleSelectOtaFile = useCallback(async () => {
    try {
      const path = await openDialog({
        title: "Select ESP32 OTA firmware (.bin)",
        multiple: false,
        directory: false,
        filters: [{ name: "ESP32 Firmware", extensions: ["bin"] }],
      });

      if (typeof path === "string" && path.length > 0) {
        setOtaFilePath(path);
        appendProgress(`Selected OTA file: ${path}`);
      }
    } catch (error) {
      console.error(error);
      appendProgress(`Failed to select OTA file: ${String(error)}`);
    }
  }, [appendProgress]);

  const handleFirmwareChange = useCallback((value: FirmwareOption["id"]) => {
    setSelectedFirmware(value);
    setExternalFilePath(null);
  }, []);

  const handleFlash = useCallback(async () => {
    if (!dfuConnected) {
      appendProgress("No DFU device detected. Connect the device in DFU mode and retry.");
      return;
    }

    setIsFlashing(true);
    setProgressLines([]);

    try {
      if (externalFilePath) {
        appendProgress("Starting DFU flash (external file)...");
        await safeInvoke("dfu_flash_file", { path: externalFilePath }, { throwOnError: true });
      } else {
        appendProgress(`Starting DFU flash (embedded ${selectedFirmware.toUpperCase()})...`);
        await safeInvoke("dfu_flash_embedded", { firmware: selectedFirmware }, { throwOnError: true });
      }
      appendProgress("Flash write completed successfully!");
    } catch (error) {
      console.error(error);
      appendProgress(`Error writing flash: ${String(error)}`);
    } finally {
      setIsFlashing(false);
      void refreshDfuStatus();
    }
  }, [appendProgress, dfuConnected, externalFilePath, refreshDfuStatus, selectedFirmware]);

  const handleOtaFlash = useCallback(async () => {
    if (!bleConnected) {
      appendProgress("BLE not connected. Connect to the ESP32 device via BLE first, then retry.");
      return;
    }
    if (!otaFilePath) {
      appendProgress("No OTA file selected. Choose a .bin firmware file and retry.");
      return;
    }

    setIsFlashing(true);
    setProgressLines([]);

    try {
      appendProgress("Starting ESP32 BLE OTA flash...");
      await safeInvoke("ble_ota_flash_file", { path: otaFilePath }, { throwOnError: true });
      appendProgress("OTA completed successfully!");
    } catch (error) {
      console.error(error);
      appendProgress(`OTA failed: ${String(error)}`);
    } finally {
      setIsFlashing(false);
      void refreshBleStatus();
    }
  }, [appendProgress, bleConnected, otaFilePath, refreshBleStatus]);

  return (
    <section className="flex flex-1 flex-col min-h-0 bg-slate-950 overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-900 px-6 py-4 flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Flash</h2>
          <p className="text-sm text-slate-400">STM32 DFU over USB, or ESP32 OTA over BLE.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            type="button"
            disabled={isFlashing}
            onClick={() => void refreshDfuStatus()}
            className="rounded border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-60"
          >
            Check DFU
          </button>
          <div
            className={`rounded px-3 py-2 text-xs font-medium ${
              dfuConnected ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30" : "bg-rose-500/10 text-rose-300 border border-rose-500/30"
            }`}
          >
            {dfuConnected ? "Connected" : "Not Connected"}
          </div>

          <button
            type="button"
            disabled={isFlashing}
            onClick={() => void refreshBleStatus()}
            className="rounded border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-60"
          >
            Check BLE
          </button>
          <div
            className={`rounded px-3 py-2 text-xs font-medium ${
              bleConnected ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30" : "bg-rose-500/10 text-rose-300 border border-rose-500/30"
            }`}
            title={bleDeviceLabel ?? undefined}
          >
            {bleConnected ? bleDeviceLabel || "Connected" : "Not Connected"}
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 flex-col gap-6 overflow-y-auto px-6 py-6">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">DFU Mode</h3>
              <p className="mt-2 text-sm text-slate-200">
                Set <span className="font-semibold">BOOT0</span> to <span className="font-semibold">FLASH (DFU)</span>, then reconnect USB.
              </p>
              <p className="mt-1 text-xs text-slate-400">Use this diagram to confirm the switch position before flashing.</p>
            </div>
            <div className="flex justify-center md:justify-end">
              <img
                src={theme === "light" ? "/flash-mode-light.png" : "/flash-mode.png"}
                alt="BOOT0 switch positions for Flash (DFU) vs Run mode"
                className="max-h-[220px] w-auto select-none opacity-95"
                draggable={false}
              />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Firmware</h3>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-100">Bundled firmware</p>
              <select
                value={selectedFirmware}
                disabled={isFlashing}
                onChange={(event) => handleFirmwareChange(event.target.value as FirmwareOption["id"])}
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 disabled:opacity-60"
              >
                {firmwareOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400">Selecting a bundled firmware clears any external file selection.</p>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-100">External firmware</p>
              <button
                type="button"
                disabled={isFlashing}
                onClick={() => void handleSelectExternalFile()}
                className="rounded border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-60"
              >
                Choose file…
              </button>
              <p className="text-xs text-slate-400 truncate">
                {externalFilePath ? externalFilePath : "No external file selected."}
              </p>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-xs text-slate-400">
              Flashing erases and replaces device firmware. Connect the device in DFU mode (BOOT0 set for DFU).
            </p>
            <button
              type="button"
              disabled={isFlashing || !dfuConnected}
              onClick={() => void handleFlash()}
              className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-sky-500 disabled:opacity-60"
            >
              {isFlashing ? "Flashing…" : "Flash"}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">ESP32 OTA (BLE)</h3>
          <p className="mt-2 text-sm text-slate-200">
            Uploads an ESP32 firmware <span className="font-semibold">.bin</span> over BLE OTA (desktop only for now).
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-100">Firmware file</p>
              <button
                type="button"
                disabled={isFlashing}
                onClick={() => void handleSelectOtaFile()}
                className="rounded border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-60"
              >
                Choose .bin…
              </button>
              <p className="text-xs text-slate-400 truncate">{otaFilePath ? otaFilePath : "No OTA file selected."}</p>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-slate-100">Device</p>
              <p className="text-xs text-slate-400">
                Requires an active BLE connection (use the BLE page to connect, then come back here).
              </p>
              <button
                type="button"
                disabled={isFlashing || !bleConnected || !otaFilePath}
                onClick={() => void handleOtaFlash()}
                className="mt-auto rounded bg-sky-600 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-sky-500 disabled:opacity-60"
              >
                {isFlashing ? "Flashing…" : "Flash OTA"}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 flex flex-col min-h-0">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Progress</h3>
          <div
            ref={logRef}
            className="mt-4 flex-1 min-h-0 overflow-y-auto rounded border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs text-slate-200"
          >
            {progressLines.length === 0 ? (
              <div className="text-slate-500">No activity yet.</div>
            ) : (
              progressLines.map((line, idx) => (
                <div key={`${idx}-${line}`} className="whitespace-pre-wrap break-words">
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
