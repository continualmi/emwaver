import { useCallback, useEffect, useMemo, useState } from "react";
import { isTauriAvailable } from "../utils/tauri";

const SETTINGS_REFRESH_KEY = "sampler.settings.refreshRate";
const SETTINGS_MAX_SAMPLES_KEY = "sampler.settings.maxSamples";
const CS_PIN_STORAGE_KEY = "rfm69_cs_pin";
const CS_ACTIVE_HIGH_STORAGE_KEY = "rfm69_cs_active_high";
const SETTINGS_EVENT = "emwaver-settings-change";

const REFRESH_OPTIONS = [
  { label: "10 ms", value: 10 },
  { label: "50 ms", value: 50 },
  { label: "100 ms", value: 100 },
  { label: "150 ms", value: 150 },
  { label: "200 ms", value: 200 },
  { label: "300 ms", value: 300 },
  { label: "400 ms", value: 400 },
  { label: "500 ms", value: 500 },
];

const BUFFER_OPTIONS = [
  { label: "1 MB (~80 seconds)", value: 1_048_576 },
  { label: "768 KB (~60 seconds)", value: 786_432 },
  { label: "512 KB (~40 seconds)", value: 524_288 },
  { label: "384 KB (~30 seconds)", value: 393_216 },
  { label: "256 KB (~20 seconds)", value: 262_144 },
  { label: "128 KB (~10 seconds)", value: 131_072 },
  { label: "No limit", value: 0 },
];

async function openExternal(url: string) {
  if (isTauriAvailable()) {
    const { open } = await import("@tauri-apps/plugin-opener");
    await open(url);
    return;
  }

  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function emitSettingsChange(scope: "sampler" | "ism") {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { scope } }));
}

export default function SettingsFragment() {
  const [refreshRate, setRefreshRate] = useState<number>(() => {
    const stored = Number.parseInt(localStorage.getItem(SETTINGS_REFRESH_KEY) || "50", 10);
    return Number.isNaN(stored) ? 50 : stored;
  });
  const [maxSamples, setMaxSamples] = useState<number>(() => {
    const stored = Number.parseInt(localStorage.getItem(SETTINGS_MAX_SAMPLES_KEY) || "393216", 10);
    return Number.isNaN(stored) ? 393_216 : stored;
  });
  const [rfm69CsPin, setRfm69CsPin] = useState<string>(() => {
    return localStorage.getItem(CS_PIN_STORAGE_KEY) || "36";
  });
  const [rfm69CsActiveHigh, setRfm69CsActiveHigh] = useState<boolean>(() => {
    const stored = localStorage.getItem(CS_ACTIVE_HIGH_STORAGE_KEY);
    return stored ? stored === "true" : true;
  });

  const refreshOptions = useMemo(() => REFRESH_OPTIONS, []);
  const bufferOptions = useMemo(() => BUFFER_OPTIONS, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_REFRESH_KEY, `${refreshRate}`);
  }, [refreshRate]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_MAX_SAMPLES_KEY, `${maxSamples}`);
  }, [maxSamples]);

  useEffect(() => {
    localStorage.setItem(CS_PIN_STORAGE_KEY, rfm69CsPin);
  }, [rfm69CsPin]);

  useEffect(() => {
    localStorage.setItem(CS_ACTIVE_HIGH_STORAGE_KEY, rfm69CsActiveHigh ? "true" : "false");
  }, [rfm69CsActiveHigh]);

  const handleRefreshChange = useCallback((value: number) => {
    setRefreshRate(value);
    emitSettingsChange("sampler");
  }, []);

  const handleBufferChange = useCallback((value: number) => {
    setMaxSamples(value);
    emitSettingsChange("sampler");
  }, []);

  const handleRfm69PinChange = useCallback((value: string) => {
    const trimmed = value.trim();
    setRfm69CsPin(trimmed);
    emitSettingsChange("ism");
  }, []);

  const handleRfm69ActiveChange = useCallback((value: boolean) => {
    setRfm69CsActiveHigh(value);
    emitSettingsChange("ism");
  }, []);

  return (
    <section className="flex flex-1 flex-col min-h-0 bg-slate-950 overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-900 px-6 py-4 flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Settings</h2>
          <p className="text-sm text-slate-400">Tune sampling and RF defaults.</p>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 flex-col gap-6 overflow-y-auto px-6 py-6">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Sampler Settings</h3>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-100">Refresh Time</p>
                <p className="text-xs text-slate-400">Select the refresh time interval for the sampler.</p>
              </div>
              <select
                value={refreshRate}
                onChange={(event) => handleRefreshChange(Number(event.target.value))}
                className="w-full md:w-56 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              >
                {refreshOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-100">Buffer Size Limit</p>
                <p className="text-xs text-slate-400">Set maximum buffer size for sampling (10µs per sample).</p>
              </div>
              <select
                value={maxSamples}
                onChange={(event) => handleBufferChange(Number(event.target.value))}
                className="w-full md:w-56 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              >
                {bufferOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">ISM Settings</h3>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-100">RFM69 CS Pin</p>
                <p className="text-xs text-slate-400">Chip select pin for RFM69 SPI communication.</p>
              </div>
              <input
                type="number"
                value={rfm69CsPin}
                onChange={(event) => handleRfm69PinChange(event.target.value)}
                className="w-full md:w-32 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-100">RFM69 CS Active High</p>
                <p className="text-xs text-slate-400">Enable if CS is active high (select=high, deselect=low).</p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-sky-500"
                  checked={rfm69CsActiveHigh}
                  onChange={(event) => handleRfm69ActiveChange(event.target.checked)}
                />
                Active High
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Support &amp; Information</h3>
          <div className="mt-4 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => {
                void openExternal("https://docs.emwaver.com");
              }}
              className="flex items-center justify-between rounded border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 hover:bg-slate-800"
            >
              <span>Help &amp; Documentation</span>
              <span className="text-xs text-slate-400">docs.emwaver.com</span>
            </button>
            <button
              type="button"
              onClick={() => {
                void openExternal("https://emwaverpolicy.z6.web.core.windows.net/");
              }}
              className="flex items-center justify-between rounded border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 hover:bg-slate-800"
            >
              <span>Privacy Policy</span>
              <span className="text-xs text-slate-400">emwaverpolicy.z6.web.core.windows.net</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
