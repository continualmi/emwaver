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

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { appDataDir } from '@tauri-apps/api/path';
import { isTauriAvailable, safeInvoke, safeJoin, safeListen } from '../utils/tauri';
import { useDevice } from '../utils/DeviceContext';
import { useAppDialog } from '../utils/AppDialogContext';

type SamplerDeviceType = 'stm32';

type SignalEntry = {
  name: string;
  path: string;
};

type DirectoryEntry = {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: DirectoryEntry[];
};

type TextInputDialogState = {
  open: boolean;
  title: string;
  value: string;
  okLabel: string;
};

type SamplerCompressViewportResponse = {
  buffer_len_bytes: number;
  time_values: number[];
  data_values: number[];
};

type TxProgressEventPayload = {
  pct: number;
  sent_bytes: number;
  total_bytes: number;
  chunk_len?: number;
  packet_size?: number;
  period_ns?: number;
  bs?: number;
};

const PIN_INDEX_STM32_KEY = 'sampler.pinIndex.stm32';
const LAST_SIGNAL_KEY = 'sampler.lastSignal';
const PWM_ENABLED_KEY = 'sampler.pwm.enabled';
const PWM_FREQ_KEY = 'sampler.pwm.freq';
const PWM_DUTY_KEY = 'sampler.pwm.duty';
const PWM_PREFS_MIGRATED_KEY = 'sampler.pwm.prefsMigrated.v2';
const INVERT_CAPTURE_KEY = 'sampler.capture.invert';
const LEGACY_INVERT_RECORDING_KEY = 'sampler.settings.invertRecording';
const SETTINGS_RESOLUTION_KEY = 'sampler.settings.resolution';
const SETTINGS_SAMPLE_PERIOD_US_KEY = 'sampler.settings.samplePeriodUs';
const SETTINGS_REFRESH_KEY = 'sampler.settings.refreshRate';
const SETTINGS_MAX_SAMPLES_KEY = 'sampler.settings.maxSamples';
const SETTINGS_EVENT = 'emwaver-settings-change';

const DEFAULT_PWM_FREQ_HZ = 38000;
const DEFAULT_PWM_DUTY_PERCENT = 100;
const SIGNALS_DIR_NAME = 'signals';
const MAX_CHART_BINS = 5000;
const MIN_CHART_BINS = 100;
const MIN_CHART_RENDER_INTERVAL_MS = 120;
const INTERACTION_REFRESH_THROTTLE_MS = 80;


// STM32 pins (MIDI sampler)
// Encoded pin format matches STM32 firmware gpio aliases:
// - A0..A15 (PA0..PA15) => 0..15
// - B0..B15 (PB0..PB15) => 16..31
// Keep labels aligned with Android (`android/.../SamplerFragment.java`).
const STM32_PINS = [
  'A0 (IR_RX)',
  'A1 (IR_TX)',
  'A2 (GDO0)',
  'A3 (GDO2)',
  'A4 (NSS)',
  'A5 (SCK)',
  'A6 (MISO)',
  'A7 (MOSI)',
  'A13 (SWCLK)',
  'A14 (SWDIO)',
  'B6 (UART TX / I2C SCL)',
  'B7 (UART RX / I2C SDA)',
];

function getStm32PinNumber(pinString: string): number {
  const match = pinString.match(/\bP?([AB])(\d{1,2})\b/);
  if (!match) return -1;
  const bank = match[1];
  const pin = Number.parseInt(match[2], 10);
  if (!Number.isFinite(pin) || pin < 0 || pin > 15) return -1;
  return bank === 'A' ? pin : 16 + pin;
}

function normalizeSignalName(rawName: string, fallback: string, ext: '.raw' | '.txt' = '.raw'): string {
  const trimmed = rawName.trim();
  const baseName = trimmed || fallback;
  const lower = baseName.toLowerCase();
  if (lower.endsWith(ext)) {
    return baseName;
  }
  return `${baseName}${ext}`;
}

function parsePwmIntOrDefault(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const TIMINGS_SAMPLE_PERIOD_US = 10;
const PULSE_MEASURE_MAX_BITS = 250_000; // 31.25 KB at 8 bits/byte

function getBitLSB(bytes: Uint8Array, bitIndex: number): 0 | 1 {
  const byteIndex = bitIndex >> 3;
  if (byteIndex < 0 || byteIndex >= bytes.length) return 0;
  const mask = 1 << (bitIndex & 7);
  return (bytes[byteIndex] & mask) !== 0 ? 1 : 0;
}

function computeSinglePulseWidthUs(
  bytes: Uint8Array,
  rangeStartBit: number,
  rangeEndBitExclusive: number,
  samplePeriodUs: number,
): { widthUs: number; level: 'high' | 'low' } | null {
  const start = Math.max(0, rangeStartBit | 0);
  const end = Math.max(start + 1, rangeEndBitExclusive | 0);
  if (end - start < 2) return null;

  let cur = getBitLSB(bytes, start);
  const transitions: number[] = [];

  for (let i = start + 1; i < end; i++) {
    const bit = getBitLSB(bytes, i);
    if (bit !== cur) {
      transitions.push(i);
      cur = bit;
      if (transitions.length > 2) return null;
    }
  }

  if (transitions.length !== 2) return null;

  const startBit = getBitLSB(bytes, start);
  const endBit = getBitLSB(bytes, end - 1);
  if (startBit !== endBit) return null;

  const [t1, t2] = transitions;
  if (t1 <= start || t2 >= end - 1) return null;

  const widthBits = t2 - t1;
  const widthUs = Math.max(0, widthBits * samplePeriodUs);
  const level = getBitLSB(bytes, t1) === 1 ? 'high' : 'low';
  return { widthUs, level };
}

function parseSignedTimingsText(text: string): number[] {
  return text
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      // Accept plain integers (e.g. 1000, -450) and ignore any trailing commas.
      const normalized = token.replace(/,+$/, '');
      const value = Number.parseInt(normalized, 10);
      return Number.isFinite(value) ? value : NaN;
    })
    .filter((value) => Number.isFinite(value));
}

function timingsToRawBufferBytes(
  pulsesUs: number[],
  options: { samplePeriodUs: number; maxBytes: number },
): { data: Uint8Array; totalSamples: number; truncated: boolean } {
  const samplePeriodUs = Math.max(1, options.samplePeriodUs | 0);
  const maxBytes = Math.max(1, options.maxBytes | 0);
  const maxBits = maxBytes * 8;

  let totalSamples = 0;
  for (const pulse of pulsesUs) {
    const samples = Math.round(Math.abs(pulse) / samplePeriodUs);
    if (samples > 0) {
      totalSamples += samples;
      if (totalSamples >= maxBits) {
        totalSamples = maxBits;
        break;
      }
    }
  }

  const bytesLen = Math.ceil(totalSamples / 8);
  const data = new Uint8Array(bytesLen);
  let bitCursor = 0;
  let truncated = false;

  for (const pulse of pulsesUs) {
    if (bitCursor >= totalSamples) {
      truncated = true;
      break;
    }
    const isHigh = pulse > 0;
    const samples = Math.round(Math.abs(pulse) / samplePeriodUs);
    if (samples <= 0) continue;
    const remaining = totalSamples - bitCursor;
    const run = Math.min(samples, remaining);

    if (isHigh) {
      // Set bits for the run (LSB-first in each byte).
      for (let i = 0; i < run; i++) {
        const idx = bitCursor + i;
        data[idx >> 3] |= 1 << (idx & 7);
      }
    }
    bitCursor += run;
  }

  return { data, totalSamples, truncated };
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for environments where clipboard permission is denied.
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.width = '1px';
      textarea.style.height = '1px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
}

function SamplerFragment() {
  // Use Device context instead of polling directly
  const { status, sendPacketNoWait, transmitBuffer } = useDevice();
  const dialog = useAppDialog();
  const isConnected = status.connected;
  const deviceType: SamplerDeviceType = 'stm32';
  
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);
  const [selectedPinIndexStm32, setSelectedPinIndexStm32] = useState(() => {
    const stored = Number.parseInt(localStorage.getItem(PIN_INDEX_STM32_KEY) || '0', 10);
    return Number.isNaN(stored) ? 0 : stored;
  });
  const [signalEntries, setSignalEntries] = useState<SignalEntry[]>([]);
  const [selectedSignalIndex, setSelectedSignalIndex] = useState(0); // 0 = "New signal..."
  const [currentSignalName, setCurrentSignalName] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [chartPointCount, setChartPointCount] = useState(0);
  const [chartError, setChartError] = useState<string | null>(null);

  const [pulseMeasure, setPulseMeasure] = useState<null | { widthUs: number; level: 'high' | 'low' }>(null);
  const pulseMeasureTimeoutRef = useRef<number | null>(null);
  const lastPulseMeasureKeyRef = useRef<string>('');
  const [invertCaptureDuringRecording, setInvertCaptureDuringRecording] = useState(() => {
    const stored = localStorage.getItem(INVERT_CAPTURE_KEY);
    if (stored != null) {
      return stored === 'true';
    }
    const legacy = localStorage.getItem(LEGACY_INVERT_RECORDING_KEY);
    return legacy === 'true';
  });
  const invertCaptureDuringRecordingRef = useRef(invertCaptureDuringRecording);
  useEffect(() => {
    invertCaptureDuringRecordingRef.current = invertCaptureDuringRecording;
    localStorage.setItem(INVERT_CAPTURE_KEY, invertCaptureDuringRecording ? 'true' : 'false');
    if (isRecordingRef.current) {
      void safeInvoke<void>('buffer_set_invert_rx', { enabled: invertCaptureDuringRecording }).catch(() => {});
    }
  }, [deviceType, invertCaptureDuringRecording]);
  const [debugViewport, setDebugViewport] = useState<{
    chartReady: boolean;
    scaleMin: number | null;
    scaleMax: number | null;
    visibleStart: number;
    visibleEnd: number;
    requestedBins: number;
    chartWidth: number | null;
    minRenderIntervalMs: number;
  }>({
    chartReady: false,
    scaleMin: null,
    scaleMax: null,
    visibleStart: 0,
    visibleEnd: 0,
    requestedBins: 0,
    chartWidth: null,
    minRenderIntervalMs: MIN_CHART_RENDER_INTERVAL_MS,
  });
  
  // Settings state
  const [showSettings, setShowSettings] = useState(false);

  const [isRetransmitting, setIsRetransmitting] = useState(false);
  const [txProgress, setTxProgress] = useState<TxProgressEventPayload>({ pct: 0, sent_bytes: 0, total_bytes: 0 });

  const [timingsModalOpen, setTimingsModalOpen] = useState(false);
  const [timingsLoading, setTimingsLoading] = useState(false);
  const [timingsText, setTimingsText] = useState<string>('');
  const timingsList = useMemo(() => parseSignedTimingsText(timingsText), [timingsText]);
  const timingsDisplay = useMemo(() => timingsText.trim().replace(/\s+/g, ' '), [timingsText]);
  const [chartResolution, setChartResolution] = useState(() => {
    const stored = Number.parseInt(localStorage.getItem(SETTINGS_RESOLUTION_KEY) || '1000', 10);
    return Number.isNaN(stored) ? 1000 : stored;
  });
  const [samplePeriodUs, setSamplePeriodUs] = useState(() => {
    const stored = Number.parseInt(localStorage.getItem(SETTINGS_SAMPLE_PERIOD_US_KEY) || '5', 10);
    if (Number.isNaN(stored)) return 5;
    return Math.max(5, Math.min(255, stored));
  });
  const [maxSamples, setMaxSamples] = useState(() => {
    const stored = Number.parseInt(localStorage.getItem(SETTINGS_MAX_SAMPLES_KEY) || '393216', 10);
    return Number.isNaN(stored) ? 393216 : stored;
  });
  const [refreshRate, setRefreshRate] = useState(() => {
    const stored = Number.parseInt(localStorage.getItem(SETTINGS_REFRESH_KEY) || '50', 10);
    return Number.isNaN(stored) ? 50 : stored;
  });
  const [pwmEnabled, setPwmEnabled] = useState(() => localStorage.getItem(PWM_ENABLED_KEY) === 'true');
  const [pwmFreqHz, setPwmFreqHz] = useState(() => {
    const stored = Number.parseInt(localStorage.getItem(PWM_FREQ_KEY) || `${DEFAULT_PWM_FREQ_HZ}`, 10);
    return Number.isNaN(stored) ? DEFAULT_PWM_FREQ_HZ : stored;
  });
  const [pwmDutyPercent, setPwmDutyPercent] = useState(() => {
    const stored = Number.parseInt(localStorage.getItem(PWM_DUTY_KEY) || `${DEFAULT_PWM_DUTY_PERCENT}`, 10);
    return Number.isNaN(stored) ? DEFAULT_PWM_DUTY_PERCENT : stored;
  });
  const [signalsDir, setSignalsDir] = useState<string | null>(null);
  const [textDialog, setTextDialog] = useState<TextInputDialogState>({
    open: false,
    title: '',
    value: '',
    okLabel: 'OK',
  });
  const [textDialogMode, setTextDialogMode] = useState<'save' | 'rename' | null>(null);

  const uplotRef = useRef<uPlot | null>(null);
  const plotRootRef = useRef<HTMLDivElement | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const refreshIntervalRef = useRef<number | null>(null);
  const bufferLenBytesRef = useRef(0);
  const [bufferLenBytes, setBufferLenBytes] = useState(0);
  const autoFitXRef = useRef(true);
  const lastRenderedAvailableBitsRef = useRef(0);
  const lastBufferSizeRef = useRef(0);
  const lastChartRenderAtRef = useRef(0);
  const lastChartViewportKeyRef = useRef<string>('');
  const pendingChartRefreshRef = useRef<number | null>(null);
  const chartRefreshInFlightRef = useRef(false);
  const isChartInteractingRef = useRef(false);
  const interactionResetTimeoutRef = useRef<number | null>(null);
  const prevVisibleRangeStartRef = useRef(0);
  const prevVisibleRangeEndRef = useRef(0);
  const prevVisibleSpanRef = useRef(0);
  const lastInteractionRefreshAtRef = useRef(0);

  const selectedPinIndex = selectedPinIndexStm32;
  const pinOptions = STM32_PINS;

  useEffect(() => {
    if (deviceType !== 'stm32') {
      return;
    }
    if (localStorage.getItem(PWM_PREFS_MIGRATED_KEY) === 'true') {
      return;
    }

    // Historically the desktop default duty was 50%. For STM32 transmit, match
    // Android/iOS: default duty=100% unless the user explicitly changed it.
    const storedDuty = localStorage.getItem(PWM_DUTY_KEY);
    if (storedDuty === '50') {
      localStorage.setItem(PWM_DUTY_KEY, '100');
      setPwmDutyPercent(100);
    }
    localStorage.setItem(PWM_PREFS_MIGRATED_KEY, 'true');
  }, [deviceType]);

  const pollBufferLenBytes = useCallback(async (): Promise<number | null> => {
    try {
      const lenBytes = await safeInvoke<number>('buffer_get_len_bytes');
      const value = Number(lenBytes);
      if (!Number.isFinite(value) || value < 0) {
        return null;
      }
      if (value !== bufferLenBytesRef.current) {
        bufferLenBytesRef.current = value;
        setBufferLenBytes(value);
      }
      return value;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(PIN_INDEX_STM32_KEY, `${selectedPinIndexStm32}`);
  }, [selectedPinIndexStm32]);

  useEffect(() => {
    if (selectedPinIndexStm32 >= STM32_PINS.length) {
      setSelectedPinIndexStm32(0);
    }
  }, [selectedPinIndexStm32]);

  useEffect(() => {
    localStorage.setItem(PWM_ENABLED_KEY, pwmEnabled ? 'true' : 'false');
  }, [pwmEnabled]);

  useEffect(() => {
    localStorage.setItem(PWM_FREQ_KEY, `${pwmFreqHz}`);
  }, [pwmFreqHz]);

  useEffect(() => {
    localStorage.setItem(PWM_DUTY_KEY, `${pwmDutyPercent}`);
  }, [pwmDutyPercent]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_RESOLUTION_KEY, `${chartResolution}`);
  }, [chartResolution]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_SAMPLE_PERIOD_US_KEY, `${samplePeriodUs}`);
  }, [samplePeriodUs]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_REFRESH_KEY, `${refreshRate}`);
  }, [refreshRate]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_MAX_SAMPLES_KEY, `${maxSamples}`);
  }, [maxSamples]);

  const getEffectiveBins = useCallback((requested: number) => {
    const value = Math.trunc(Number(requested) || 0);
    if (!Number.isFinite(value) || value <= 0) {
      return MIN_CHART_BINS;
    }
    return Math.max(MIN_CHART_BINS, Math.min(MAX_CHART_BINS, value));
  }, []);

  const getAdaptiveBins = useCallback(
    (requested: number) => {
      const base = getEffectiveBins(requested);
      // Respect user-requested bins (clamped by MAX_CHART_BINS).
      // The number of rendered points can still be lower when zoomed in (raw bits), and can be
      // up to ~2x bins when zoomed out (min/max pairs per bin).
      return base;
    },
    [getEffectiveBins],
  );

  const minRenderIntervalMs = useMemo(() => {
    // While recording the buffer grows fast; throttling redraw helps keep UI responsive.
    // Keep interaction-driven refresh separate (handled by zoom/pan callbacks).
    const base = Math.max(MIN_CHART_RENDER_INTERVAL_MS, Math.trunc(refreshRate * 4));
    return isRecording ? Math.max(base, 250) : base;
  }, [isRecording, refreshRate]);

  const getCompressionBitsPerBin = useCallback(() => {
    const spanBits = Math.max(0, debugViewport.visibleEnd - debugViewport.visibleStart);
    const bins = Math.max(1, debugViewport.requestedBins);
    return spanBits / bins;
  }, [debugViewport.requestedBins, debugViewport.visibleEnd, debugViewport.visibleStart]);

  const formatFinite = useCallback((value: number, decimals: number) => {
    return Number.isFinite(value) ? value.toFixed(decimals) : '—';
  }, []);

  const getViewportBits = useCallback(() => {
    const bufferBytes = bufferLenBytesRef.current;
    const maxX = Math.max(10000, bufferBytes * 8);
    if (isRecordingRef.current) {
      return { visibleRangeStart: 0, visibleRangeEnd: maxX, maxX };
    }
    const plot = uplotRef.current;
    if (!plot || !plot.scales?.x) {
      return { visibleRangeStart: 0, visibleRangeEnd: maxX, maxX };
    }
    const rawMin = Number(plot.scales.x.min);
    const rawMax = Number(plot.scales.x.max);
    if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax) || rawMax <= rawMin) {
      return { visibleRangeStart: 0, visibleRangeEnd: maxX, maxX };
    }
    const visibleRangeStart = Math.max(0, Math.floor(rawMin));
    const visibleRangeEnd = Math.min(maxX, Math.floor(rawMax));
    if (visibleRangeEnd <= visibleRangeStart) {
      return { visibleRangeStart: 0, visibleRangeEnd: maxX, maxX };
    }
    return { visibleRangeStart, visibleRangeEnd, maxX };
  }, []);

  const markChartInteracting = useCallback(() => {
    isChartInteractingRef.current = true;
    if (interactionResetTimeoutRef.current != null) {
      window.clearTimeout(interactionResetTimeoutRef.current);
    }
    interactionResetTimeoutRef.current = window.setTimeout(() => {
      interactionResetTimeoutRef.current = null;
      isChartInteractingRef.current = false;
    }, 150);
  }, []);

  useEffect(() => {
    return () => {
      if (interactionResetTimeoutRef.current != null) {
        window.clearTimeout(interactionResetTimeoutRef.current);
        interactionResetTimeoutRef.current = null;
      }
    };
  }, []);

  const performChartRefresh = useCallback(() => {
				    const plot = uplotRef.current;
				    if (!plot) return;

			    if (chartRefreshInFlightRef.current) {
			      return;
			    }
			    const requestedBins = getAdaptiveBins(chartResolution);
			    const { visibleRangeStart, visibleRangeEnd } = getViewportBits();
          const viewportKey = `${visibleRangeStart}:${visibleRangeEnd}:${requestedBins}`;
          const availableBits = bufferLenBytesRef.current * 8;
          if (
            viewportKey === lastChartViewportKeyRef.current &&
            visibleRangeEnd <= lastRenderedAvailableBitsRef.current &&
            visibleRangeEnd <= availableBits
          ) {
            return;
          }

			    chartRefreshInFlightRef.current = true;
          const scaleMin = Number(plot.scales?.x?.min);
          const scaleMax = Number(plot.scales?.x?.max);
          const chartWidth = plotRootRef.current?.clientWidth ?? null;
          setDebugViewport({
            chartReady: true,
            scaleMin: Number.isFinite(scaleMin) ? scaleMin : null,
            scaleMax: Number.isFinite(scaleMax) ? scaleMax : null,
            visibleStart: visibleRangeStart,
            visibleEnd: visibleRangeEnd,
            requestedBins,
            chartWidth,
            minRenderIntervalMs,
          });

				    void safeInvoke<SamplerCompressViewportResponse>(
				      'buffer_compress_viewport',
				      { rangeStart: visibleRangeStart, rangeEnd: visibleRangeEnd, numberBins: requestedBins },
	            { throwOnError: true },
				    )
			      .then((result) => {
			        if (!result) {
                setChartError('buffer_compress_viewport returned null');
                return;
              }
              setChartError(null);

			        const bufferBytes = result.buffer_len_bytes;
			        bufferLenBytesRef.current = bufferBytes;
              setBufferLenBytes(bufferBytes);
              if (isRecordingRef.current && bufferBytes >= maxSamples) {
                stopRecording();
                void dialog.alert('Recording stopped: buffer size limit reached.');
                return;
              }

			        const nextViewportKey = `${visibleRangeStart}:${visibleRangeEnd}:${requestedBins}`;
			        if (nextViewportKey === lastChartViewportKeyRef.current) {
			          return;
			        }
			        lastChartViewportKeyRef.current = nextViewportKey;

              schedulePulseMeasurement(nextViewportKey, visibleRangeStart, visibleRangeEnd);

              if (result.time_values.length !== result.data_values.length) {
                console.warn('Sampler viewport length mismatch', {
                  time: result.time_values.length,
                  data: result.data_values.length,
                });
              }

              const x = new Float64Array(result.time_values);
              const y = new Float32Array(result.data_values);
              setChartPointCount(x.length);
              plot.setData([x, y]);
              lastRenderedAvailableBitsRef.current = bufferBytes * 8;
			      })
			      .catch((error) => {
			        console.error('Failed to refresh chart (buffer compress):', error);
              setChartError(String(error));
			      })
			      .finally(() => {
			        chartRefreshInFlightRef.current = false;
			      });
			  }, [chartResolution, dialog, getAdaptiveBins, getViewportBits, maxSamples, minRenderIntervalMs]);

  const schedulePulseMeasurement = useCallback(
    (viewportKey: string, visibleRangeStart: number, visibleRangeEnd: number) => {
      if (pulseMeasureTimeoutRef.current != null) {
        window.clearTimeout(pulseMeasureTimeoutRef.current);
        pulseMeasureTimeoutRef.current = null;
      }

      // Avoid work while recording, or when viewport is too large.
      if (isRecordingRef.current) {
        setPulseMeasure(null);
        return;
      }

      const spanBits = Math.max(0, visibleRangeEnd - visibleRangeStart);
      if (spanBits > PULSE_MEASURE_MAX_BITS) {
        setPulseMeasure(null);
        return;
      }

      // Only rerun when viewport actually changes.
      if (viewportKey === lastPulseMeasureKeyRef.current) {
        return;
      }
      lastPulseMeasureKeyRef.current = viewportKey;

      pulseMeasureTimeoutRef.current = window.setTimeout(() => {
        pulseMeasureTimeoutRef.current = null;
        void (async () => {
          const raw = await safeInvoke<number[]>('buffer_get_bytes');
          const bytes = raw?.length ? new Uint8Array(raw) : new Uint8Array();
          if (bytes.length === 0) {
            setPulseMeasure(null);
            return;
          }

          const result = computeSinglePulseWidthUs(
            bytes,
            Math.max(0, visibleRangeStart),
            Math.max(0, visibleRangeEnd),
            TIMINGS_SAMPLE_PERIOD_US,
          );
          setPulseMeasure(result);
        })();
      }, 180);
    },
    [],
  );

  const scheduleChartRefresh = useCallback(() => {
    if (pendingChartRefreshRef.current != null) {
      window.clearTimeout(pendingChartRefreshRef.current);
    }
    pendingChartRefreshRef.current = window.setTimeout(() => {
      pendingChartRefreshRef.current = null;
      performChartRefresh();
    }, 50);
  }, [performChartRefresh]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string }>).detail;
      if (detail?.scope && detail.scope !== 'sampler') {
        return;
      }
      const storedRefresh = Number.parseInt(localStorage.getItem(SETTINGS_REFRESH_KEY) || '50', 10);
      const storedMaxSamples = Number.parseInt(localStorage.getItem(SETTINGS_MAX_SAMPLES_KEY) || '393216', 10);
      const storedResolution = Number.parseInt(localStorage.getItem(SETTINGS_RESOLUTION_KEY) || '1000', 10);
      setRefreshRate(Number.isNaN(storedRefresh) ? 50 : storedRefresh);
      setMaxSamples(Number.isNaN(storedMaxSamples) ? 393216 : storedMaxSamples);
      setChartResolution(Number.isNaN(storedResolution) ? 1000 : storedResolution);
    };

    window.addEventListener(SETTINGS_EVENT, handler);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, handler);
    };
  }, []);

  useEffect(() => {
    if (!isTauriAvailable()) {
      return;
    }
    const resolveSignalsDir = async () => {
      const root = await appDataDir();
      const dir = await safeJoin(root, SIGNALS_DIR_NAME);
      await safeInvoke<void>('ensure_dir', { payload: { path: dir } }, { throwOnError: true });
      setSignalsDir(dir);
    };
    void resolveSignalsDir();
  }, []);

  useEffect(() => {
    if (!isTauriAvailable()) {
      return;
    }

    let unlisten: (() => void) | null = null;
    void safeListen<TxProgressEventPayload>('tx_progress', (event) => {
      if (!isRetransmitting) {
        return;
      }
      const payload = event.payload;
      if (!payload) return;
      setTxProgress(payload);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [isRetransmitting]);

  useEffect(() => {
    return () => {
      if (pulseMeasureTimeoutRef.current != null) {
        window.clearTimeout(pulseMeasureTimeoutRef.current);
        pulseMeasureTimeoutRef.current = null;
      }
    };
  }, []);

  const ensureSignalsDir = useCallback(async (): Promise<string | null> => {
    if (!isTauriAvailable()) {
      return null;
    }
    if (signalsDir) {
      return signalsDir;
    }
    const root = await appDataDir();
    const dir = await safeJoin(root, SIGNALS_DIR_NAME);
    await safeInvoke<void>('ensure_dir', { payload: { path: dir } }, { throwOnError: true });
    setSignalsDir(dir);
    return dir;
  }, [signalsDir]);

  // Define refreshChart callback first (before useEffects that depend on it)
  const refreshChart = useCallback(() => {
    scheduleChartRefresh();
  }, [scheduleChartRefresh]);

  const maybeRefreshOnInteraction = useCallback(
    () => {
      if (!uplotRef.current) return;

      const now = Date.now();
      if (now - lastInteractionRefreshAtRef.current < INTERACTION_REFRESH_THROTTLE_MS) {
        return;
      }

      const { visibleRangeStart, visibleRangeEnd } = getViewportBits();
      const span = Math.max(1, visibleRangeEnd - visibleRangeStart);

      const prevStart = prevVisibleRangeStartRef.current;
      const prevEnd = prevVisibleRangeEndRef.current;
      const prevSpan = Math.max(1, prevVisibleSpanRef.current);

      const translationThreshold = Math.floor(span / 100);
      const zoomThreshold = Math.floor(prevSpan / 10);

      const movedEnough =
        Math.abs(visibleRangeStart - prevStart) > translationThreshold ||
        Math.abs(visibleRangeEnd - prevEnd) > translationThreshold;
      const zoomedEnough = Math.abs(span - prevSpan) >= zoomThreshold;

      if (movedEnough || zoomedEnough) {
        prevVisibleRangeStartRef.current = visibleRangeStart;
        prevVisibleRangeEndRef.current = visibleRangeEnd;
        prevVisibleSpanRef.current = span;
        lastInteractionRefreshAtRef.current = now;
        refreshChart();
      }
    },
    [getViewportBits, refreshChart],
  );

  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    let dragging = false;
    let dragStartX = 0;
    let dragStartMin = 0;
    let dragStartMax = 0;

    const clampX = (min: number, max: number, totalMax: number) => {
      const span = Math.max(1, max - min);
      let nextMin = min;
      let nextMax = max;
      if (!Number.isFinite(nextMin) || !Number.isFinite(nextMax) || nextMax <= nextMin) {
        return { min: 0, max: Math.max(10000, totalMax) };
      }
      if (nextMin < 0) {
        nextMin = 0;
        nextMax = span;
      }
      if (nextMax > totalMax) {
        nextMax = totalMax;
        nextMin = totalMax - span;
        if (nextMin < 0) nextMin = 0;
      }
      if (nextMax <= nextMin) {
        nextMax = nextMin + 1;
      }
      return { min: nextMin, max: nextMax };
    };

    const onWheel = (event: WheelEvent) => {
      const plot = uplotRef.current;
      if (!plot) return;

      // While recording, keep the live view locked to "full range" so incoming
      // data is always visible.
      if (isRecordingRef.current) {
        event.preventDefault();
        markChartInteracting();
        return;
      }

      event.preventDefault();
      markChartInteracting();
      autoFitXRef.current = false;

      const totalMax = Math.max(10000, bufferLenBytesRef.current * 8);
      const rect = el.getBoundingClientRect();
      const plotLeft = rect.left + (plot.bbox?.left ?? 0);
      const xPos = event.clientX - plotLeft;
      const xVal = plot.posToVal(xPos, 'x');

      const currentMin = Number(plot.scales?.x?.min);
      const currentMax = Number(plot.scales?.x?.max);
      if (!Number.isFinite(currentMin) || !Number.isFinite(currentMax) || currentMax <= currentMin) {
        plot.setScale('x', { min: 0, max: totalMax });
        maybeRefreshOnInteraction();
        return;
      }

      // deltaY > 0 => zoom out; deltaY < 0 => zoom in
      const factor = Math.exp(event.deltaY * 0.001);
      const nextMinRaw = xVal - (xVal - currentMin) * factor;
      const nextMaxRaw = xVal + (currentMax - xVal) * factor;
      const { min: nextMin, max: nextMax } = clampX(nextMinRaw, nextMaxRaw, totalMax);

      plot.setScale('x', { min: nextMin, max: nextMax });
      maybeRefreshOnInteraction();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const plot = uplotRef.current;
      if (!plot) return;
      dragging = true;
      dragStartX = event.clientX;
      dragStartMin = Number(plot.scales?.x?.min) || 0;
      dragStartMax = Number(plot.scales?.x?.max) || 10000;
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      markChartInteracting();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const plot = uplotRef.current;
      if (!plot) return;

      // While recording, keep the live view locked to "full range" so incoming
      // data is always visible.
      if (isRecordingRef.current) {
        event.preventDefault();
        markChartInteracting();
        return;
      }

      event.preventDefault();
      autoFitXRef.current = false;
      const totalMax = Math.max(10000, bufferLenBytesRef.current * 8);
      const span = Math.max(1, dragStartMax - dragStartMin);
      const plotWidth = Math.max(1, plot.bbox?.width ?? el.clientWidth ?? 1);
      const dx = event.clientX - dragStartX;
      const shift = -(dx / plotWidth) * span;
      const { min: nextMin, max: nextMax } = clampX(dragStartMin + shift, dragStartMax + shift, totalMax);

      plot.setScale('x', { min: nextMin, max: nextMax });
      maybeRefreshOnInteraction();
    };

    const onPointerUp = () => {
      dragging = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      event.preventDefault();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown, { passive: true });
    el.addEventListener('pointermove', onPointerMove, { passive: false });
    el.addEventListener('pointerup', onPointerUp, { passive: true });
    el.addEventListener('pointercancel', onPointerUp, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [markChartInteracting, maybeRefreshOnInteraction]);

	  // While recording, poll buffer length and refresh the chart only when needed.
	  useEffect(() => {
	    if (!isConnected || !isRecording) {
	      if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current);
          refreshIntervalRef.current = null;
        }
        return;
      }

      const refreshChartLoop = async () => {
        const now = Date.now();
        if (now - lastChartRenderAtRef.current < minRenderIntervalMs) {
          await pollBufferLenBytes();
          return;
        }

        await pollBufferLenBytes();

        const plot = uplotRef.current;
        const bufferBytes = bufferLenBytesRef.current;
        const availableBits = bufferBytes * 8;
        const maxX = Math.max(10000, availableBits);

        if (plot && isRecordingRef.current) {
          // Recording: always show the full range (Android/iOS behavior).
          autoFitXRef.current = true;
          try {
            plot.setScale('x', { min: 0, max: maxX });
          } catch {
            // ignore
          }
        } else if (plot && autoFitXRef.current && !isChartInteractingRef.current) {
          const rawMin = Number(plot.scales?.x?.min);
          const rawMax = Number(plot.scales?.x?.max);
          const nextMin = 0;
          const nextMax = maxX;
          const shouldRescale =
            !Number.isFinite(rawMin) ||
            !Number.isFinite(rawMax) ||
            Math.abs(rawMin - nextMin) > 1 ||
            Math.abs(rawMax - nextMax) > 1;
          if (shouldRescale) {
            try {
              plot.setScale('x', { min: nextMin, max: nextMax });
            } catch {
              // ignore
            }
          }
        }

        const requestedBins = getAdaptiveBins(chartResolution);
        const { visibleRangeStart, visibleRangeEnd } = getViewportBits();
        const viewportKey = `${visibleRangeStart}:${visibleRangeEnd}:${requestedBins}`;

        const viewportAlreadyRendered =
          viewportKey === lastChartViewportKeyRef.current &&
          visibleRangeEnd <= lastRenderedAvailableBitsRef.current &&
          visibleRangeEnd <= availableBits;

        if (viewportAlreadyRendered) {
          return;
        }

        lastChartRenderAtRef.current = now;
        performChartRefresh();
      };

      refreshIntervalRef.current = window.setInterval(() => {
        void refreshChartLoop();
      }, refreshRate);

      return () => {
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current);
          refreshIntervalRef.current = null;
        }
      };
	  }, [
      chartResolution,
      getAdaptiveBins,
      getViewportBits,
      isConnected,
      isRecording,
      minRenderIntervalMs,
      performChartRefresh,
      pollBufferLenBytes,
      refreshRate,
    ]);

		  const startRecording = async () => {
		    if (!isConnected) {
		      await dialog.alert('Not connected to device');
		      return;
		    }

    const selectedPin = pinOptions[selectedPinIndex];
		    const pinNumber = getStm32PinNumber(selectedPin);
		    if (pinNumber === -1) {
		      await dialog.alert('Invalid pin selected');
		      return;
		    }

			    await safeInvoke<void>('buffer_clear').catch(() => {});
        await safeInvoke<void>('buffer_set_invert_rx', { enabled: invertCaptureDuringRecordingRef.current }).catch(() => {});
			    bufferLenBytesRef.current = 0;
			    setBufferLenBytes(0);
			    lastBufferSizeRef.current = 0;
			    lastChartViewportKeyRef.current = '';
          lastRenderedAvailableBitsRef.current = 0;
			    setChartPointCount(0);
          if (uplotRef.current) {
            uplotRef.current.setData([new Float64Array(), new Float32Array()]);
          }
	    resetChartZoom();
          autoFitXRef.current = true;

	    // Binary: EMW_OP_SAMPLE (0x60) / START (0x00)
	    const tickUs = Math.max(5, Math.min(255, Math.trunc(samplePeriodUs) || 5));
	    await sendPacketNoWait(new Uint8Array([0x60, 0x00, pinNumber & 0xff, tickUs & 0xff]));

	    setIsRecording(true);
	    setHasUnsavedChanges(true);
	  };

		  const stopRecording = async () => {
		    if (!isConnected) return;

		    // Binary: EMW_OP_SAMPLE (0x60) / STOP (0x01)
			    await sendPacketNoWait(new Uint8Array([0x60, 0x01]));
        await safeInvoke<void>('buffer_set_invert_rx', { enabled: false }).catch(() => {});
		    setIsRecording(false);
		  };

			  const retransmitSignal = async () => {
			    if (!isConnected) {
			      await dialog.alert('Not connected to device');
			      return;
			    }

				    const bytes = await safeInvoke<number[]>('buffer_get_bytes');
				    const buffer = bytes?.length ? new Uint8Array(bytes) : new Uint8Array();
				    if (buffer.length === 0) {
				      await dialog.alert('Buffer is empty');
				      return;
				    }

    const selectedPin = pinOptions[selectedPinIndex];
    const pinNumber = getStm32PinNumber(selectedPin);
    if (pinNumber === -1) {
	      await dialog.alert('Invalid pin selected');
      return;
    }

	    try {
	      setIsRetransmitting(true);
	      setTxProgress({ pct: 0, sent_bytes: 0, total_bytes: buffer.length });

	      // Binary: EMW_OP_TRANSMIT (0x80) / START (0x00)
	      // Mini-frame extension:
	      //   [0]=0x80 [1]=0x00 [2]=pin [3]=duty% [4..7]=freqHz (u32 LE) [8]=tickUs
	      let dutyPercent = 100;
	      let freqHz = 0;
	      if (pwmEnabled) {
	        freqHz = parsePwmIntOrDefault(`${pwmFreqHz}`, DEFAULT_PWM_FREQ_HZ);
	        dutyPercent = parsePwmIntOrDefault(`${pwmDutyPercent}`, DEFAULT_PWM_DUTY_PERCENT);
	        if (freqHz < 1) {
	          await dialog.alert('Invalid PWM frequency');
	          return;
	        }
	        if (dutyPercent < 1 || dutyPercent > 100) {
	          await dialog.alert('Invalid PWM duty (1-100)');
	          return;
	        }
	        setPwmFreqHz(freqHz);
	        setPwmDutyPercent(dutyPercent);
	      }

	      const startPkt = new Uint8Array(9);
	      startPkt[0] = 0x80;
	      startPkt[1] = 0x00;
	      startPkt[2] = pinNumber & 0xff;
	      startPkt[3] = dutyPercent & 0xff;
	      const hz = freqHz >>> 0;
	      startPkt[4] = hz & 0xff;
	      startPkt[5] = (hz >>> 8) & 0xff;
	      startPkt[6] = (hz >>> 16) & 0xff;
	      startPkt[7] = (hz >>> 24) & 0xff;
	      startPkt[8] = Math.max(5, Math.min(255, Math.trunc(samplePeriodUs) || 5)) & 0xff;
	      await sendPacketNoWait(startPkt);

      // Use transmitBuffer method (matching Android/iOS)
      await transmitBuffer(buffer);
    } catch (error) {
      console.error('Failed to retransmit signal:', error);
	      await dialog.alert('Failed to retransmit signal');
	    } finally {
	      setIsRetransmitting(false);
    }
	  };

				  const getTimings = async () => {
			    setTimingsModalOpen(true);
			    setTimingsLoading(true);
			    setTimingsText('');
			    try {
			      const timings = await safeInvoke<string>('buffer_build_signed_raw_timings', {
			        sample_period_us: Math.max(5, Math.min(255, Math.trunc(samplePeriodUs) || 5)),
			      });
			      if (!timings) {
			        setTimingsModalOpen(false);
			        await dialog.alert('Buffer is empty');
			        return;
			      }
			      setTimingsText(timings.trim());
			    } catch (error) {
			      console.error('Failed to build timings:', error);
			      setTimingsModalOpen(false);
			      await dialog.alert('Failed to build timings');
			    } finally {
			      setTimingsLoading(false);
			    }
		  };

      const generateNewTimingsName = (): string => {
        const baseRaw = currentSignalName ? currentSignalName.replace(/\.(raw|txt)$/i, '') : 'signal';
        const base = baseRaw.toLowerCase().endsWith('.timings') ? baseRaw : `${baseRaw}.timings`;
        let counter = 1;
        let candidate = `${base}.txt`;
        const existing = new Set(signalEntries.map((entry) => entry.name.toLowerCase()));
        while (existing.has(candidate.toLowerCase())) {
          counter += 1;
          candidate = `${base}.${counter}.txt`;
        }
        return candidate;
      };

      const saveTimingsToStorage = async () => {
        const content = timingsText.trim().replace(/\s+/g, ' ');
        if (!content) {
          await dialog.alert('No timings to save.');
          return;
        }

        const dir = await ensureSignalsDir();
        if (!dir) {
          await dialog.alert('Signals storage is not available');
          return;
        }

        const fileName = generateNewTimingsName();
        const targetPath = await safeJoin(dir, fileName);
        try {
          await safeInvoke<void>(
            'write_file',
            { payload: { path: targetPath, content: `${content}\n` } },
            { throwOnError: true },
          );
          refreshSignalList();
          await dialog.alert(`Timings saved: ${fileName}`);
        } catch (error) {
          console.error('Failed to save timings:', error);
          await dialog.alert('Failed to save timings');
        }
      };

	  const clearBuffer = () => {
				    void safeInvoke<void>('buffer_clear', undefined, { throwOnError: true }).catch((error) => {
				      console.error('Failed to clear sampler buffer:', error);
				    });
            void safeInvoke<void>('buffer_set_invert_rx', { enabled: false }).catch(() => {});
				    bufferLenBytesRef.current = 0;
				    setBufferLenBytes(0);
				    lastBufferSizeRef.current = 0;
            lastRenderedAvailableBitsRef.current = 0;
				    setChartPointCount(0);
            setPulseMeasure(null);
            if (uplotRef.current) {
              uplotRef.current.setData([new Float64Array(), new Float32Array()]);
            }
				    setHasUnsavedChanges(false);
				    resetChartZoom();
            autoFitXRef.current = true;
				  };

  const resetChartZoom = () => {
    const plot = uplotRef.current;
    if (!plot) return;
    const maxX = Math.max(10000, bufferLenBytesRef.current * 8);
    try {
      plot.setScale('x', { min: 0, max: maxX });
      prevVisibleRangeStartRef.current = 0;
      prevVisibleRangeEndRef.current = maxX;
      prevVisibleSpanRef.current = maxX;
      autoFitXRef.current = true;
    } catch (e) {
      console.warn('Could not reset zoom:', e);
    }
  };

	  const loadSignal = async (signalName: string) => {
    if (!signalsDir) {
	      await dialog.alert('Signals storage is not available');
      return;
    }
    if (signalName === currentSignalName && !hasUnsavedChanges) {
      return;
    }
    try {
      const entry = signalEntries.find((item) => item.name === signalName);
      if (!entry) {
	        await dialog.alert('Signal file not found');
        return;
      }

      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.txt')) {
        const text = await safeInvoke<string>(
          'read_file',
          { payload: { path: entry.path } },
          { throwOnError: true },
        );
        if (!text || !text.trim()) {
          await dialog.alert('Signal file is empty');
          return;
        }

        const pulses = parseSignedTimingsText(text);
        if (pulses.length === 0) {
          await dialog.alert('No timings found in file');
          return;
        }

        const { data: rawBytes, truncated } = timingsToRawBufferBytes(pulses, {
          samplePeriodUs: TIMINGS_SAMPLE_PERIOD_US,
          maxBytes: maxSamples,
        });
        if (rawBytes.length === 0) {
          await dialog.alert('Timings decode resulted in an empty buffer');
          return;
        }

        const nextLen = await safeInvoke<number>(
          'buffer_set_bytes',
          { data: Array.from(rawBytes) },
          { throwOnError: true },
        );
        const lenBytes = Number(nextLen) || rawBytes.length;
        bufferLenBytesRef.current = lenBytes;
        setBufferLenBytes(lenBytes);
        lastBufferSizeRef.current = lenBytes;
        setCurrentSignalName(signalName);
        setHasUnsavedChanges(false);
        localStorage.setItem(LAST_SIGNAL_KEY, signalName);
        resetChartZoom();
        refreshChart();
        if (truncated) {
          void dialog.alert('Loaded timings were truncated to the current buffer limit.');
        }
        return;
      }

      const data = await safeInvoke<number[]>(
        'read_binary_file',
        { payload: { path: entry.path } },
        { throwOnError: true },
      );
	      if (!data || data.length === 0) {
	        await dialog.alert('Signal file is empty');
	        return;
	      }

	      const nextLen = await safeInvoke<number>(
	        'buffer_set_bytes',
	        { data },
	        { throwOnError: true },
	      );
	      const lenBytes = Number(nextLen) || data.length;
	      bufferLenBytesRef.current = lenBytes;
	      setBufferLenBytes(lenBytes);
	      lastBufferSizeRef.current = lenBytes;
	      setCurrentSignalName(signalName);
	      setHasUnsavedChanges(false);
	      localStorage.setItem(LAST_SIGNAL_KEY, signalName);
	      resetChartZoom();
	      refreshChart();
	    } catch (error) {
	      console.error('Failed to load signal:', error);
	      await dialog.alert('Failed to load signal');
	    }
  };

		  const saveSignalToStorage = async (enteredName: string) => {
		    const bufferSize = (await safeInvoke<number>('buffer_get_len_bytes')) ?? bufferLenBytesRef.current;
		    if (bufferSize === 0) {
		      await dialog.alert('Buffer is empty');
		      return;
		    }

    const dir = await ensureSignalsDir();
    if (!dir) {
	    await dialog.alert('Signals storage is not available');
      return;
    }

	    const defaultName = currentSignalName?.toLowerCase().endsWith('.raw') ? currentSignalName : generateNewSignalName();
    const fileName = normalizeSignalName(enteredName || defaultName, defaultName);

		    try {
			      const targetPath = await safeJoin(dir, fileName);
			      await safeInvoke<void>(
			        'buffer_write_file',
			        { path: targetPath },
			        { throwOnError: true },
			      );
	      setCurrentSignalName(fileName);
	      setHasUnsavedChanges(false);
	      localStorage.setItem(LAST_SIGNAL_KEY, fileName);
      refreshSignalList();
	      await dialog.alert(`Signal saved: ${fileName}`);
    } catch (error) {
      console.error('Failed to save signal:', error);
	    await dialog.alert('Failed to save signal');
    }
  };

		  const openSaveDialog = () => {
		    const bufferSize = bufferLenBytesRef.current;
		    if (bufferSize === 0) {
		      void dialog.alert('Buffer is empty');
		      return;
		    }

	    const defaultName = currentSignalName?.toLowerCase().endsWith('.raw') ? currentSignalName : generateNewSignalName();
    setTextDialogMode('save');
    setTextDialog({ open: true, title: 'Save Signal', value: defaultName, okLabel: 'Save' });
  };

  const closeTextDialog = () => {
    setTextDialogMode(null);
    setTextDialog((prev) => ({ ...prev, open: false }));
  };

  const confirmTextDialog = async () => {
    const value = textDialog.value.trim();
    const mode = textDialogMode;
    closeTextDialog();
    if (mode === 'save') {
      await saveSignalToStorage(value);
      return;
    }
    if (mode === 'rename') {
      await renameSignalToStorage(value);
    }
  };

  const revealSignalsFolder = useCallback(async () => {
    const dir = await ensureSignalsDir();
    if (!dir) {
	    await dialog.alert('Signals storage is not available');
      return;
    }
    try {
      await safeInvoke<void>(
        'reveal_in_finder',
        { payload: { path: dir } },
        { throwOnError: true },
      );
    } catch (error) {
      console.error('Failed to reveal signals folder:', error);
	    await dialog.alert('Failed to open signals folder');
    }
  }, [dialog, ensureSignalsDir]);

  const revealCurrentSignal = useCallback(async () => {
    const dir = await ensureSignalsDir();
    if (!dir) {
	    await dialog.alert('Signals storage is not available');
      return;
    }
    if (!currentSignalName) {
	    await dialog.alert('No signal selected');
      return;
    }
    try {
      const entry = signalEntries.find((item) => item.name === currentSignalName);
      const path = entry?.path ?? (await safeJoin(dir, currentSignalName));
      await safeInvoke<void>(
        'reveal_in_finder',
        { payload: { path } },
        { throwOnError: true },
      );
    } catch (error) {
      console.error('Failed to reveal signal file:', error);
	    await dialog.alert('Failed to open signal file');
    }
  }, [currentSignalName, dialog, ensureSignalsDir, signalEntries]);

  const importSignal = async () => {
    try {
      // Use file input for both browser and Tauri (simpler approach)
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.raw,.txt';
      input.onchange = async (e) => {
        const selectedFile = (e.target as HTMLInputElement).files?.[0];
        if (!selectedFile) return;

        try {
          const lowerName = (selectedFile.name || '').toLowerCase();

          if (lowerName.endsWith('.txt')) {
            const text = await selectedFile.text();
            if (!text.trim()) {
              await dialog.alert('Selected file is empty');
              return;
            }

            const pulses = parseSignedTimingsText(text);
            if (pulses.length === 0) {
              await dialog.alert('No timings found in file');
              return;
            }

            const { data: rawBytes, truncated } = timingsToRawBufferBytes(pulses, {
              samplePeriodUs: TIMINGS_SAMPLE_PERIOD_US,
              maxBytes: maxSamples,
            });
            if (rawBytes.length === 0) {
              await dialog.alert('Timings decode resulted in an empty buffer');
              return;
            }

            const defaultName = selectedFile.name || 'signal.timings.txt';
            const fileName = normalizeSignalName(defaultName.replace(/\.txt$/i, ''), defaultName, '.txt');
            const dir = await ensureSignalsDir();
            if (dir) {
              const targetPath = await safeJoin(dir, fileName);
              await safeInvoke<void>(
                'write_file',
                { payload: { path: targetPath, content: text } },
                { throwOnError: true },
              );
            }

            const nextLen = await safeInvoke<number>(
              'buffer_set_bytes',
              { data: Array.from(rawBytes) },
              { throwOnError: true },
            );
            const lenBytes = Number(nextLen) || rawBytes.length;
            bufferLenBytesRef.current = lenBytes;
            setBufferLenBytes(lenBytes);
            lastBufferSizeRef.current = lenBytes;

            setCurrentSignalName(fileName);
            setHasUnsavedChanges(false);
            localStorage.setItem(LAST_SIGNAL_KEY, fileName);
            resetChartZoom();
            refreshChart();
            refreshSignalList();
            if (truncated) {
              void dialog.alert('Imported timings were truncated to the current buffer limit.');
            }
            return;
          }

          const arrayBuffer = await selectedFile.arrayBuffer();
          const buffer = new Uint8Array(arrayBuffer);
	          if (buffer.length === 0) {
	            await dialog.alert('Selected file is empty');
	            return;
	          }

	          const defaultName = selectedFile.name || generateNewSignalName();
	          const fileName = normalizeSignalName(defaultName, generateNewSignalName(), '.raw');
	          const dir = await ensureSignalsDir();
	          if (dir) {
	            const targetPath = await safeJoin(dir, fileName);
	            await safeInvoke<void>(
	              'write_binary_file',
	              { payload: { path: targetPath, data: Array.from(buffer) } },
	              { throwOnError: true },
	            );
		          }

		          const nextLen = await safeInvoke<number>(
		            'buffer_set_bytes',
		            { data: Array.from(buffer) },
		            { throwOnError: true },
		          );
		          const lenBytes = Number(nextLen) || buffer.length;
		          bufferLenBytesRef.current = lenBytes;
		          setBufferLenBytes(lenBytes);
		          lastBufferSizeRef.current = lenBytes;

	          setCurrentSignalName(fileName);
	          setHasUnsavedChanges(false);
	          localStorage.setItem(LAST_SIGNAL_KEY, fileName);
	          resetChartZoom();
	          refreshChart();
	          refreshSignalList();
	        } catch (error) {
	          console.error('Failed to read file:', error);
	          await dialog.alert('Failed to import signal');
	        }
      };
      input.click();
    } catch (error) {
      console.error('Failed to import signal:', error);
	    await dialog.alert('Failed to import signal');
    }
  };

  const createNewSignal = () => {
    clearBuffer();
    setCurrentSignalName(null);
    setSelectedSignalIndex(0);
    localStorage.removeItem(LAST_SIGNAL_KEY);
  };

  const refreshSignalList = () => {
    try {
      if (!signalsDir) {
        setSignalEntries([]);
        return;
      }

      const loadSignals = async () => {
        const entries = await safeInvoke<DirectoryEntry[]>(
          'read_directory',
          { payload: { path: signalsDir } },
          { throwOnError: true },
        );
        const files = (entries || []).filter((entry) => {
          if (entry.kind !== 'file') return false;
          const lower = entry.name.toLowerCase();
          return lower.endsWith('.raw') || lower.endsWith('.txt');
        });
        const mapped: SignalEntry[] = await Promise.all(
          files.map(async (entry) => ({
            name: entry.name,
            path: await safeJoin(signalsDir, entry.path),
          }))
        );
        mapped.sort((a, b) => a.name.localeCompare(b.name));
        setSignalEntries(mapped);
      };

      void loadSignals();
    } catch (error) {
      console.error('Failed to refresh signal list:', error);
    }
  };

  // Load signal list on mount
  useEffect(() => {
    refreshSignalList();
  }, [signalsDir]);

  useEffect(() => {
    if (!signalEntries.length || currentSignalName) {
      return;
    }
    const lastSignal = localStorage.getItem(LAST_SIGNAL_KEY);
    if (lastSignal && signalEntries.some((entry) => entry.name === lastSignal)) {
      void loadSignal(lastSignal);
    }
  }, [signalEntries, currentSignalName]);

  useEffect(() => {
    if (!currentSignalName) {
      setSelectedSignalIndex(0);
      return;
    }
    const index = signalEntries.findIndex((entry) => entry.name === currentSignalName);
    if (index >= 0) {
      setSelectedSignalIndex(index + 1);
    }
  }, [signalEntries, currentSignalName]);

  const generateNewSignalName = (): string => {
    let counter = 1;
    let candidate = `signal${counter}.raw`;
    while (signalEntries.some((entry) => entry.name === candidate)) {
      counter++;
      candidate = `signal${counter}.raw`;
    }
    return candidate;
  };

  const renameSignalToStorage = async (enteredName: string) => {
    if (!currentSignalName || !signalsDir) {
	    await dialog.alert('No signal loaded');
      return;
    }
    const ext = currentSignalName.toLowerCase().endsWith('.txt') ? '.txt' : '.raw';
    const normalized = normalizeSignalName(enteredName, currentSignalName, ext);
    if (normalized === currentSignalName) {
	    await dialog.alert('Name unchanged');
      return;
    }
    if (signalEntries.some((entry) => entry.name === normalized)) {
	    await dialog.alert('A signal with this name already exists');
      return;
    }
    const entry = signalEntries.find((item) => item.name === currentSignalName);
    if (!entry) {
	    await dialog.alert('Signal file not found');
      return;
    }
    const targetPath = await safeJoin(signalsDir, normalized);
    try {
      await safeInvoke<void>(
        'rename_path',
        { payload: { from: entry.path, to: targetPath } },
        { throwOnError: true },
      );
      setCurrentSignalName(normalized);
      setHasUnsavedChanges(false);
      localStorage.setItem(LAST_SIGNAL_KEY, normalized);
      refreshSignalList();
	    await dialog.alert('Signal renamed');
    } catch (error) {
      console.error('Failed to rename signal:', error);
	    await dialog.alert('Failed to rename signal');
    }
  };

  const openRenameDialog = () => {
    if (!currentSignalName) {
	    void dialog.alert('No signal loaded');
      return;
    }
    const existing = currentSignalName.replace(/\.(raw|txt)$/i, '');
    setTextDialogMode('rename');
    setTextDialog({ open: true, title: 'Rename Signal', value: existing, okLabel: 'Rename' });
  };

  const renameSignal = async () => {
    openRenameDialog();
  };

  const deleteSignal = async () => {
    if (!currentSignalName || !signalsDir) {
	    await dialog.alert('No signal loaded');
      return;
    }
    const entry = signalEntries.find((item) => item.name === currentSignalName);
    if (!entry) {
	    await dialog.alert('Signal file not found');
      return;
    }
    const confirmed = await dialog.confirm(`Delete ${currentSignalName}?`, {
      title: 'Delete Signal',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    });
    if (!confirmed) {
      return;
    }
	    const currentIndex = signalEntries.findIndex((item) => item.name === currentSignalName);
	    try {
	      await safeInvoke<void>(
	        'remove_path',
	        { payload: { path: entry.path } },
	        { throwOnError: true },
	      );
	      let nextSignal: string | null = null;
	      if (signalEntries.length > 1 && currentIndex >= 0) {
	        if (currentIndex < signalEntries.length - 1) {
	          nextSignal = signalEntries[currentIndex + 1].name;
        } else {
          nextSignal = signalEntries[0].name;
        }
      }
      setCurrentSignalName(null);
      setHasUnsavedChanges(false);
      localStorage.removeItem(LAST_SIGNAL_KEY);
      refreshSignalList();
      if (nextSignal) {
        setSelectedSignalIndex(0);
        void loadSignal(nextSignal);
      }
	    await dialog.alert('Signal deleted');
    } catch (error) {
      console.error('Failed to delete signal:', error);
	    await dialog.alert('Failed to delete signal');
    }
  };

  useEffect(() => {
    const root = plotRootRef.current;
    if (!root) return;

    const width = root.clientWidth || 800;
    const height = root.clientHeight || 400;

    const opts: uPlot.Options = {
      width,
      height,
      legend: { show: false },
      cursor: { focus: { prox: 16 } },
      axes: [
        {
          stroke: '#cbd5e1',
          grid: { stroke: '#334155' },
        },
        {
          stroke: '#cbd5e1',
          grid: { stroke: '#334155' },
        },
      ],
      scales: {
        x: { time: false },
        y: {
          time: false,
          range: () => [-128, 384],
        },
      },
      series: [
        {},
        {
          label: 'Signal',
          stroke: '#01579B',
          width: 2,
        },
      ],
    };

    const plot = new uPlot(opts, [new Float64Array(), new Float32Array()], root);
    uplotRef.current = plot;

    try {
      plot.setScale('x', { min: 0, max: 10000 });
    } catch {
      // ignore
    }

    const ro = new ResizeObserver(() => {
      if (!plotRootRef.current) return;
      const nextWidth = plotRootRef.current.clientWidth || 800;
      const nextHeight = plotRootRef.current.clientHeight || 400;
      try {
        plot.setSize({ width: nextWidth, height: nextHeight });
      } catch {
        // ignore
      }
    });
    ro.observe(root);

    return () => {
      ro.disconnect();
      try {
        plot.destroy();
      } catch {
        // ignore
      }
      if (uplotRef.current === plot) {
        uplotRef.current = null;
      }
    };
  }, []);

  return (
    <section className="flex flex-1 flex-col min-h-0 bg-slate-950 overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-900 px-6 py-4 flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Sampler</h2>
          <p className="text-sm text-slate-400">
            {currentSignalName ? `${currentSignalName}${hasUnsavedChanges ? '*' : ''}` : 'No signal'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={createNewSignal}
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-black/30"
          >
            New
          </button>
          <button
            onClick={openSaveDialog}
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-black/30"
          >
            Save
          </button>
          <button
            onClick={() => void getTimings()}
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-black/30"
          >
            Timings
          </button>
          <button
            onClick={revealCurrentSignal}
            disabled={!currentSignalName}
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-black/30 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Show File
          </button>
          <button
            onClick={revealSignalsFolder}
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-black/30"
          >
            Show Folder
          </button>
          <button
            onClick={renameSignal}
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-black/30"
          >
            Rename
          </button>
          <button
            onClick={deleteSignal}
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-black/30"
          >
            Delete
          </button>
          <button
            onClick={importSignal}
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-black/30"
          >
            Import
          </button>
          <button
            onClick={clearBuffer}
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-black/30"
          >
            Clear
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-black/30"
          >
            Settings
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 flex-col gap-5 overflow-y-auto px-6 py-6">
        {/* Chart */}
		        <div className="flex-shrink-0 bg-slate-900 rounded-lg p-4">
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
			            <div>Bytes: {bufferLenBytes}</div>
                  <div>Samples: {bufferLenBytes * 8}</div>
                  <div>Resolution: 10 µs</div>
                  <div>Points: {chartPointCount}</div>
                  <div>View: {debugViewport.visibleStart}..{debugViewport.visibleEnd}</div>
                  <div>Target bins: {chartResolution}</div>
                  <div>Bins: {debugViewport.requestedBins}</div>
                  <div>
                    Compression: {formatFinite(getCompressionBitsPerBin(), 2)} bits/bin
                  </div>
			          </div>
	          <div className="w-full" style={{ minHeight: '400px', height: '400px' }}>
              <div
                ref={chartContainerRef}
                className="relative h-full w-full"
                style={{ touchAction: 'none' }}
              >
                <div ref={plotRootRef} className="h-full w-full" />
                {chartError ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-slate-200">
                    <p>Chart error: {chartError}</p>
                  </div>
                ) : null}

                {pulseMeasure ? (
                  <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-1.5 text-[11px] text-slate-200 backdrop-blur">
                    Pulse: {Math.round(pulseMeasure.widthUs)} us ({pulseMeasure.level})
                  </div>
                ) : null}
              </div>
          </div>
        </div>

        {/* Primary actions */}
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <button
              onClick={startRecording}
              disabled={!isConnected || isRecording}
              className="flex-1 rounded-lg border border-sky-500/25 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-500/15 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Record
            </button>
            <button
              onClick={stopRecording}
              disabled={!isConnected || !isRecording}
              className="flex-1 rounded-lg border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/15 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Stop
            </button>
          </div>

          <button
            onClick={retransmitSignal}
            disabled={!isConnected || isRetransmitting}
            className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/15 disabled:border-slate-700 disabled:bg-slate-900/40 disabled:text-slate-500 disabled:cursor-not-allowed"
          >
            {isRetransmitting ? 'Retransmitting…' : 'Retransmit'}
          </button>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-4">
          <div className="text-xs text-slate-400">
            Device: {status.transport ? `${status.transport} (${deviceType})` : '—'}
          </div>
          <select
            value={selectedPinIndex}
            onChange={(e) => {
              const index = Number(e.target.value);
              setSelectedPinIndexStm32(index);
            }}
            className="px-4 py-2 bg-slate-900 text-slate-200 rounded border border-slate-700"
          >
            {pinOptions.map((pin, index) => (
              <option key={index} value={index}>
                {pin}
              </option>
            ))}
          </select>

          <div className="rounded border border-slate-800 bg-slate-900 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-100">TX PWM</p>
                <p className="text-xs text-slate-500">Used for retransmit carrier settings.</p>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={pwmEnabled}
                  onChange={(e) => setPwmEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                Enabled
              </label>
	            </div>
	            {pwmEnabled ? (
	              <div className="mt-3 grid gap-3 md:grid-cols-2">
	                <label className="text-xs text-slate-400">
	                  Frequency (Hz)
	                  <input
	                    type="number"
	                    value={pwmFreqHz}
	                    onChange={(e) => setPwmFreqHz(parsePwmIntOrDefault(e.target.value, DEFAULT_PWM_FREQ_HZ))}
	                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
	                  />
	                </label>
	                <label className="text-xs text-slate-400">
	                  Duty (%)
	                  <input
	                    type="number"
	                    value={pwmDutyPercent}
	                    onChange={(e) => setPwmDutyPercent(parsePwmIntOrDefault(e.target.value, DEFAULT_PWM_DUTY_PERCENT))}
	                    className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
	                  />
	                </label>
	              </div>
	            ) : null}
	          </div>

          <select
            value={selectedSignalIndex}
            onChange={(e) => {
              const index = Number(e.target.value);
              setSelectedSignalIndex(index);
              if (index > 0 && signalEntries[index - 1]) {
                loadSignal(signalEntries[index - 1].name);
              } else {
                createNewSignal();
              }
            }}
            className="px-4 py-2 bg-slate-900 text-slate-200 rounded border border-slate-700"
          >
            <option value={0}>New signal...</option>
            {signalEntries.map((entry, index) => (
              <option key={index} value={index + 1}>
                {entry.name}
              </option>
            ))}
          </select>
	      </div>
	      </div>

        {isRetransmitting ? (
          <div className="fixed bottom-6 right-6 z-50 w-[360px] rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-2xl backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-100">Transmitting</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {Math.max(0, Math.min(100, Math.round(txProgress.pct || 0)))}% ({txProgress.sent_bytes || 0}/
                  {txProgress.total_bytes || 0}B)
                </div>
              </div>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded bg-slate-800">
              <div
                className="h-full bg-emerald-400/60 transition-[width] duration-150"
                style={{ width: `${Math.max(0, Math.min(100, txProgress.pct || 0))}%` }}
              />
            </div>
          </div>
        ) : null}

	      {timingsModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
            <div className="w-full max-w-3xl rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-100">Timings</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Space-separated signed microseconds. Positive = high, negative = low. ({timingsList.length} pulses)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTimingsModalOpen(false)}
                  className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs text-slate-200 hover:bg-black/30"
                >
                  Close
                </button>
              </div>

              <div className="mt-4">
                {timingsLoading ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-200">
                    Computing timings...
                  </div>
                ) : (
                  <textarea
                    readOnly
                    value={timingsDisplay}
                    className="h-[360px] w-full resize-none rounded-lg border border-slate-800 bg-slate-950/40 p-3 font-mono text-xs text-slate-200 outline-none"
                  />
                )}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void copyTextToClipboard(timingsDisplay)}
                  disabled={timingsLoading || !timingsText.trim()}
                  className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-200 hover:bg-black/30 disabled:opacity-60"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => void saveTimingsToStorage()}
                  disabled={timingsLoading || !timingsText.trim()}
                  className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                >
                  Save .txt
                </button>
              </div>
            </div>
          </div>
	      ) : null}

	      {textDialog.open && (
	        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
	          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
	            <h3 className="text-lg font-medium text-slate-100 mb-4">{textDialog.title}</h3>
	            <input
	              className="w-full rounded-lg border border-slate-800 bg-slate-950/40 p-2 mb-4 font-mono text-slate-100"
	              value={textDialog.value}
	              autoFocus
	              onChange={(e) => setTextDialog((prev) => ({ ...prev, value: e.target.value }))}
	              onKeyDown={(e) => {
	                if (e.key === 'Escape') {
	                  closeTextDialog();
	                }
	                if (e.key === 'Enter') {
	                  void confirmTextDialog();
	                }
	              }}
	            />
	            <div className="flex justify-end gap-2">
	              <button
	                onClick={closeTextDialog}
	                className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-200 hover:bg-black/30"
	              >
	                Cancel
	              </button>
	              <button
	                onClick={() => void confirmTextDialog()}
	                className="rounded-lg bg-sky-300 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-200"
	              >
	                {textDialog.okLabel}
	              </button>
	            </div>
	          </div>
	        </div>
	      )}

	      {/* Settings Modal */}
	      {showSettings && (
	        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
	          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-slate-100">Settings</h3>

            <div className="mb-6 space-y-3">
              <div className="text-sm font-medium text-slate-200">Sampler</div>

              <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
                <div className="flex flex-col">
                  <span>Invert capture during recording</span>
                  <span className="text-xs text-slate-500">Only affects Sampler while recording (0↔1).</span>
                </div>
                <input
                  type="checkbox"
                  checked={invertCaptureDuringRecording}
                  onChange={(event) => setInvertCaptureDuringRecording(event.target.checked)}
                  className="h-4 w-4 accent-sky-500"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <div className="flex flex-col">
                  <span>Sample period (us)</span>
                  <span className="text-xs text-slate-500">Used for capture + retransmit pacing. Minimum: 5us.</span>
                </div>
                <select
                  value={`${samplePeriodUs}`}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    setSamplePeriodUs(Number.isNaN(next) ? 5 : Math.max(5, Math.min(255, next)));
                  }}
                  className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                >
                  <option value="5">5</option>
                  <option value="10">10</option>
                  <option value="20">20</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm text-slate-200">
                <span className="text-xs text-slate-400">Invert capture applies while recording</span>
              </label>
            </div>
            
            <div className="mb-4 space-y-2">
              <label className="block text-sm font-medium text-slate-300">Chart bins</label>
              <input
                type="number"
                value={chartResolution}
                onChange={(e) => setChartResolution(Number(e.target.value))}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
              />
              <p className="text-xs text-slate-500">
                Higher values show more detail but may reduce performance. Rendered points depend on zoom (raw vs compressed).
              </p>
            </div>

            <div className="mb-4 space-y-2">
              <label className="block text-sm font-medium text-slate-300">
                Refresh Rate (ms)
              </label>
              <input
                type="number"
                value={refreshRate}
                onChange={(e) => setRefreshRate(Number(e.target.value))}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
              />
              <p className="text-xs text-slate-500">
                Interval between chart updates. Lower values are smoother but use more CPU.
              </p>
            </div>

            <div className="mb-6 space-y-2">
              <label className="block text-sm font-medium text-slate-300">
                Max Buffer Size (KB)
              </label>
              <input
                type="number"
                value={maxSamples / 1024}
                onChange={(e) => setMaxSamples(Number(e.target.value) * 1024)}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
              />
              <p className="text-xs text-slate-500">
                Limit for signal recording storage. Default: 384KB (~30s)
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSettings(false)}
                className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default SamplerFragment;
