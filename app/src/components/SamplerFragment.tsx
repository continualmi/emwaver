import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import zoomPlugin from 'chartjs-plugin-zoom';
import { appDataDir } from '@tauri-apps/api/path';
import { isTauriAvailable, safeInvoke, safeJoin } from '../utils/tauri';
import { useDevice } from '../utils/DeviceContext';

// Register Chart.js components - do this once at module load
try {
  ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler,
    zoomPlugin
  );
} catch (error) {
  console.error('Failed to register Chart.js components:', error);
}

type SamplerDeviceType = 'esp32' | 'stm32';

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

const PIN_INDEX_ESP32_KEY = 'sampler.pinIndex.esp32';
const PIN_INDEX_STM32_KEY = 'sampler.pinIndex.stm32';
const PIN_IO_ESP32_KEY = 'sampler.pinIo.esp32';
const LAST_SIGNAL_KEY = 'sampler.lastSignal';
const PWM_ENABLED_KEY = 'sampler.pwm.enabled';
const PWM_FREQ_KEY = 'sampler.pwm.freq';
const PWM_DUTY_KEY = 'sampler.pwm.duty';
const SETTINGS_RESOLUTION_KEY = 'sampler.settings.resolution';
const SETTINGS_REFRESH_KEY = 'sampler.settings.refreshRate';
const SETTINGS_MAX_SAMPLES_KEY = 'sampler.settings.maxSamples';
const SETTINGS_EVENT = 'emwaver-settings-change';

const DEFAULT_PWM_FREQ_HZ = 38000;
const DEFAULT_PWM_DUTY_PERCENT = 50;
const SIGNALS_DIR_NAME = 'signals';
const MAX_CHART_BINS = 5000;
const MIN_CHART_BINS = 100;
const MIN_CHART_RENDER_INTERVAL_MS = 120;
const INTERACTION_REFRESH_THROTTLE_MS = 80;

const ESP32_PINS = [
  'IO1 DIO0[S]/GDO0[F]',
  'IO2 DIO1[S]/GDO2[F]',
  'IO3 GPIO3',
  'IO4 IR TX[F/D]',
  'IO5 IR RX[F/D]',
  'IO6 GPIO6',
  'IO7 GPIO7',
  'IO8 GPIO8',
  'IO9 GPIO9',
  'IO10 GPIO10',
  'IO11 GPIO11',
  'IO12 GPIO12',
  'IO13 GPIO13',
  'IO14 GPIO14',
  'IO15 GPIO15',
  'IO16 GPIO16',
  'IO17 GPIO17',
  'IO18 GPIO18',
  'IO37 IR TX[S]',
  'IO38 IR RX[S]',
  'IO39 DIO5[S]',
  'IO40 DIO4[S]',
  'IO41 DIO3[S]',
  'IO42 DIO2[S]',
  'IO46 GPIO46',
];

const LEGACY_ESP32_PINS = [
  'RFM69 DIO0 / CC1101 GDO0 (IO1)',
  'RFM69 DIO1 / CC1101 GDO2 (IO2)',
  'RFM69 DIO2 (IO42)',
  'RFM69 DIO3 (IO41)',
  'RFM69 DIO4 (IO40)',
  'RFM69 DIO5 (IO39)',
  'IR RX (IO38)',
  'IR TX (IO37)',
  'GPIO4 / IR TX (IO4)',
  'GPIO5 / IR RX (IO5)',
  'GPIO6 (IO6)',
  'GPIO7 (IO7)',
  'GPIO15 (IO15)',
  'GPIO16 (IO16)',
  'GPIO17 (IO17)',
  'GPIO18 (IO18)',
  'GPIO8 (IO8)',
  'GPIO3 (IO3)',
  'GPIO46 (IO46)',
  'GPIO9 (IO9)',
  'GPIO10 / CC1101 NSS (IO10)',
  'GPIO11 / CC1101 MOSI (IO11)',
  'GPIO12 / CC1101 SCK (IO12)',
  'GPIO13 / CC1101 MISO (IO13)',
  'GPIO14 (IO14)',
];

// STM32 pins (USB sampler)
// Encoded pin format matches STM32 firmware gpio aliases:
// - PA0..PA15 => 0..15
// - PB0..PB15 => 16..31
// Keep labels aligned with Android (`android/.../SamplerFragment.java`).
const STM32_PINS = [
  'PA0 (TIM2 CH1)',
  'PA1 (IR_RX)',
  'PA2 (IR_TX on Infrared Waver / GDO0 on ISM Waver, TIM2 CH3)',
  'PA3 (TIM2 CH4)',
  'PA4',
  'PA5',
  'PA6',
  'PA7',
  'PA13',
  'PA14',
  'PB6',
  'PB7',
];

function getEsp32PinNumber(pinString: string): number {
  const match = pinString.match(/\bIO(\d+)\b/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return -1;
}

function findEsp32PinIndexByNumber(ioPin: number): number {
  for (let i = 0; i < ESP32_PINS.length; i++) {
    if (getEsp32PinNumber(ESP32_PINS[i]) === ioPin) {
      return i;
    }
  }
  return 0;
}

function getStm32PinNumber(pinString: string): number {
  const match = pinString.match(/\bP([AB])(\d{1,2})\b/);
  if (!match) return -1;
  const bank = match[1];
  const pin = Number.parseInt(match[2], 10);
  if (!Number.isFinite(pin) || pin < 0 || pin > 15) return -1;
  return bank === 'A' ? pin : 16 + pin;
}

function normalizeSignalName(rawName: string, fallback: string): string {
  const trimmed = rawName.trim();
  const baseName = trimmed || fallback;
  const lower = baseName.toLowerCase();
  if (lower.endsWith('.raw')) {
    return baseName;
  }
  return `${baseName}.raw`;
}

function parsePwmIntOrDefault(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
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
  const { status, send, sendNoWait, transmitBuffer } = useDevice();
  const isConnected = status.connected;
  const deviceType: SamplerDeviceType = status.transport === 'USB' ? 'stm32' : 'esp32';
  
  const [isRecording, setIsRecording] = useState(false);
  const [selectedPinIndexEsp32, setSelectedPinIndexEsp32] = useState(() => {
    const storedIo = Number.parseInt(localStorage.getItem(PIN_IO_ESP32_KEY) || '', 10);
    if (!Number.isNaN(storedIo) && storedIo >= 0) {
      return findEsp32PinIndexByNumber(storedIo);
    }

    const storedIndex = Number.parseInt(localStorage.getItem(PIN_INDEX_ESP32_KEY) || '', 10);
    if (!Number.isNaN(storedIndex) && storedIndex >= 0 && storedIndex < LEGACY_ESP32_PINS.length) {
      const legacyIo = getEsp32PinNumber(LEGACY_ESP32_PINS[storedIndex]);
      if (legacyIo >= 0) {
        return findEsp32PinIndexByNumber(legacyIo);
      }
    }

    return findEsp32PinIndexByNumber(6);
  });
  const [selectedPinIndexStm32, setSelectedPinIndexStm32] = useState(() => {
    const stored = Number.parseInt(localStorage.getItem(PIN_INDEX_STM32_KEY) || '0', 10);
    return Number.isNaN(stored) ? 0 : stored;
  });
  const [signalEntries, setSignalEntries] = useState<SignalEntry[]>([]);
  const [selectedSignalIndex, setSelectedSignalIndex] = useState(0); // 0 = "New signal..."
  const [currentSignalName, setCurrentSignalName] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [chartData, setChartData] = useState<{ timeValues: number[]; dataValues: number[] }>({
    timeValues: [],
    dataValues: [],
  });
  const [chartError, setChartError] = useState<string | null>(null);
  const [debugViewport, setDebugViewport] = useState<{
    chartReady: boolean;
    scaleMin: number | null;
    scaleMax: number | null;
    visibleStart: number;
    visibleEnd: number;
    requestedBins: number;
  }>({
    chartReady: false,
    scaleMin: null,
    scaleMax: null,
    visibleStart: 0,
    visibleEnd: 0,
    requestedBins: 0,
  });
  
  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [chartResolution, setChartResolution] = useState(() => {
    const stored = Number.parseInt(localStorage.getItem(SETTINGS_RESOLUTION_KEY) || '1000', 10);
    return Number.isNaN(stored) ? 1000 : stored;
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

  const chartRef = useRef<any>(null);
  const refreshIntervalRef = useRef<number | null>(null);
  const bufferLenBytesRef = useRef(0);
  const [bufferLenBytes, setBufferLenBytes] = useState(0);
  const lastBufferSizeRef = useRef(0);
  const lastChartRenderAtRef = useRef(0);
  const lastChartViewportKeyRef = useRef<string>('');
  const pendingChartRefreshRef = useRef<number | null>(null);
  const chartRefreshInFlightRef = useRef(false);
  const prevVisibleRangeStartRef = useRef(0);
  const prevVisibleRangeEndRef = useRef(0);
  const prevVisibleSpanRef = useRef(0);
  const lastInteractionRefreshAtRef = useRef(0);

  const selectedPinIndex = deviceType === 'stm32' ? selectedPinIndexStm32 : selectedPinIndexEsp32;
  const pinOptions = deviceType === 'stm32' ? STM32_PINS : ESP32_PINS;

  useEffect(() => {
    localStorage.setItem(PIN_INDEX_ESP32_KEY, `${selectedPinIndexEsp32}`);
  }, [selectedPinIndexEsp32]);

  useEffect(() => {
    const selected = ESP32_PINS[selectedPinIndexEsp32];
    const io = selected ? getEsp32PinNumber(selected) : -1;
    if (io >= 0) {
      localStorage.setItem(PIN_IO_ESP32_KEY, `${io}`);
    }
  }, [selectedPinIndexEsp32]);

  useEffect(() => {
    localStorage.setItem(PIN_INDEX_STM32_KEY, `${selectedPinIndexStm32}`);
  }, [selectedPinIndexStm32]);

  useEffect(() => {
    if (selectedPinIndexEsp32 >= ESP32_PINS.length) {
      setSelectedPinIndexEsp32(findEsp32PinIndexByNumber(6));
    }
  }, [selectedPinIndexEsp32]);

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
    (chart: any, requested: number) => {
      const base = getEffectiveBins(requested);
      const width = Math.trunc(Number(chart?.width ?? 0)) || 0;
      if (width <= 0) {
        return base;
      }
      // Similar intent to Android's fixed `visiblePoints=300`: keep redraw cost bounded.
      const pixelCap = Math.max(MIN_CHART_BINS, Math.min(MAX_CHART_BINS, Math.floor(width / 2)));
      return Math.min(base, pixelCap);
    },
    [getEffectiveBins],
  );

  const minRenderIntervalMs = useMemo(() => {
    // While recording the buffer grows fast; throttling redraw helps keep UI responsive.
    // Keep interaction-driven refresh separate (handled by zoom/pan callbacks).
    const base = Math.max(MIN_CHART_RENDER_INTERVAL_MS, Math.trunc(refreshRate * 3));
    return isRecording ? Math.max(base, 200) : base;
  }, [isRecording, refreshRate]);

  const computeVisibleRangeBits = useCallback((chart: any, chartMaxX: number) => {
    let visibleRangeStart = 0;
    let visibleRangeEnd = chartMaxX;

    try {
      const xScale = chart?.scales?.x;
      if (xScale) {
        const rawMin = Number(xScale.min);
        const rawMax = Number(xScale.max);
        if (Number.isFinite(rawMin) && Number.isFinite(rawMax) && rawMax > rawMin) {
          visibleRangeStart = Math.max(0, Math.floor(rawMin));
          visibleRangeEnd = Math.min(chartMaxX, Math.floor(rawMax));
        }
      }
    } catch {
      visibleRangeStart = 0;
      visibleRangeEnd = chartMaxX;
    }

    if (!Number.isFinite(visibleRangeStart) || visibleRangeStart < 0) {
      visibleRangeStart = 0;
    }
    if (!Number.isFinite(visibleRangeEnd) || visibleRangeEnd > chartMaxX) {
      visibleRangeEnd = chartMaxX;
    }

    if (visibleRangeEnd <= visibleRangeStart) {
      return { visibleRangeStart: 0, visibleRangeEnd: chartMaxX };
    }

    return { visibleRangeStart, visibleRangeEnd };
  }, []);

  const getChartInstance = useCallback((maybeChart: any): any | null => {
    if (!maybeChart) return null;
    // react-chartjs-2 can expose either the Chart.js instance directly or a wrapper with `.chart`.
    return (maybeChart as any).chart ?? maybeChart;
  }, []);

			  const performChartRefresh = useCallback((chartInstance?: any) => {
			    const chart = getChartInstance(chartInstance || chartRef.current);
			    if (!chart) return;

			    if (chartRefreshInFlightRef.current) {
			      return;
			    }
			    chartRefreshInFlightRef.current = true;

			    const requestedBins = getAdaptiveBins(chart, chartResolution);
			    const fallbackBufferBytes = bufferLenBytesRef.current;
			    const fallbackChartMaxX = fallbackBufferBytes * 8;
			    const chartMaxXForRequest = Math.max(
			      10000,
			      fallbackChartMaxX,
			      Math.trunc(Number(chart?.options?.scales?.x?.max ?? 10000)) || 10000,
			    );
			    const { visibleRangeStart, visibleRangeEnd } = computeVisibleRangeBits(chart, chartMaxXForRequest);
          const xScale = chart?.scales?.x;
          const scaleMin = xScale ? Number(xScale.min) : Number.NaN;
          const scaleMax = xScale ? Number(xScale.max) : Number.NaN;
          setDebugViewport({
            chartReady: true,
            scaleMin: Number.isFinite(scaleMin) ? scaleMin : null,
            scaleMax: Number.isFinite(scaleMax) ? scaleMax : null,
            visibleStart: visibleRangeStart,
            visibleEnd: visibleRangeEnd,
            requestedBins,
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

			        const viewportKey = `${bufferBytes}:${visibleRangeStart}:${visibleRangeEnd}:${requestedBins}`;
			        if (viewportKey === lastChartViewportKeyRef.current) {
			          return;
			        }
			        lastChartViewportKeyRef.current = viewportKey;

			        setChartData({ timeValues: result.time_values, dataValues: result.data_values });
              if (result.time_values.length !== result.data_values.length) {
                console.warn('Sampler viewport length mismatch', {
                  time: result.time_values.length,
                  data: result.data_values.length,
                });
              }

			        const chartMaxX = Math.max(10000, bufferBytes * 8);
			        if (chart.options?.scales?.x) {
			          chart.options.scales.x.max = chartMaxX || 10000;
			          if (chart.options.plugins?.zoom?.limits?.x) {
			            chart.options.plugins.zoom.limits.x.max = chartMaxX || 10000;
			          }
			        }
			      })
			      .catch((error) => {
			        console.error('Failed to refresh chart (buffer compress):', error);
              setChartError(String(error));
			      })
			      .finally(() => {
			        chartRefreshInFlightRef.current = false;
			      });
		  }, [chartResolution, computeVisibleRangeBits, getAdaptiveBins, getChartInstance]);

  const scheduleChartRefresh = useCallback((chartInstance?: any) => {
    if (pendingChartRefreshRef.current != null) {
      window.clearTimeout(pendingChartRefreshRef.current);
    }
    pendingChartRefreshRef.current = window.setTimeout(() => {
      pendingChartRefreshRef.current = null;
      performChartRefresh(chartInstance);
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
      setRefreshRate(Number.isNaN(storedRefresh) ? 50 : storedRefresh);
      setMaxSamples(Number.isNaN(storedMaxSamples) ? 393216 : storedMaxSamples);
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
  const refreshChart = useCallback(
    (chartInstance?: any) => {
      scheduleChartRefresh(chartInstance);
    },
    [scheduleChartRefresh],
  );

  const maybeRefreshOnInteraction = useCallback(
    (chartInstance?: any) => {
      const chart = chartInstance || chartRef.current;
      if (!chart) return;

      const now = Date.now();
      if (now - lastInteractionRefreshAtRef.current < INTERACTION_REFRESH_THROTTLE_MS) {
        return;
      }

      const bufferBytes = bufferLenBytesRef.current;
      const chartMaxX = Math.max(10000, bufferBytes * 8);
      const { visibleRangeStart, visibleRangeEnd } = computeVisibleRangeBits(chart, chartMaxX);
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
        refreshChart(chart);
      }
    },
    [computeVisibleRangeBits, refreshChart],
  );

	  // Refresh chart periodically
	  useEffect(() => {
	    if (!isConnected) {
	      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      return;
    }

			    const refreshChartLoop = async () => {
			      const now = Date.now();
			      if (now - lastChartRenderAtRef.current < minRenderIntervalMs) {
			        return;
			      }

		      const currentBufferSize = (await safeInvoke<number>('buffer_get_len_bytes')) ?? 0;
		      bufferLenBytesRef.current = currentBufferSize;
		      setBufferLenBytes(currentBufferSize);
		      
		      // Check buffer size limit
		      if (isRecording && currentBufferSize >= maxSamples) {
		        stopRecording();
	        alert('Recording stopped: Buffer size limit reached.');
	        return;
	      }

	      // Only update if buffer changed or recording
		      if (currentBufferSize === lastBufferSizeRef.current && !isRecording) {
		        return;
		      }

	      lastBufferSizeRef.current = currentBufferSize;

	      const chart = getChartInstance(chartRef.current);
	      if (!chart) return;

		      lastChartRenderAtRef.current = now;
		      performChartRefresh(chart);
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
			  }, [getChartInstance, isConnected, isRecording, maxSamples, minRenderIntervalMs, performChartRefresh, refreshRate]);

		  const startRecording = async () => {
		    if (!isConnected) {
		      alert('Not connected to device');
		      return;
		    }

    const selectedPin = pinOptions[selectedPinIndex];
    const pinNumber = deviceType === 'stm32'
      ? getStm32PinNumber(selectedPin)
      : getEsp32PinNumber(selectedPin);
		    if (pinNumber === -1) {
		      alert('Invalid pin selected');
		      return;
		    }

		    await safeInvoke<void>('buffer_clear').catch(() => {});
		    bufferLenBytesRef.current = 0;
		    setBufferLenBytes(0);
		    lastBufferSizeRef.current = 0;
		    lastChartViewportKeyRef.current = '';
		    setChartData({ timeValues: [], dataValues: [] });
		    resetChartZoom();

	    // Send "sample start --pin=<pin>" command (matching Android/iOS)
	    if (deviceType === 'esp32') {
	      await sendNoWait(`sample start --pin=${pinNumber}`);
	    } else {
	      await send(`sample start --pin=${pinNumber}`, 2000, 1);
	    }

	    setIsRecording(true);
	    setHasUnsavedChanges(true);
	  };

		  const stopRecording = async () => {
		    if (!isConnected) return;

		    // Send "sample stop" command (matching Android/iOS)
		    if (deviceType === 'esp32') {
		      await sendNoWait("sample stop");
		    } else {
		      await send("sample stop", 2000, 1);
		    }

	    setIsRecording(false);
	  };

				  const retransmitSignal = async () => {
				    if (!isConnected) {
				      alert('Not connected to device');
				      return;
				    }

				    const bytes = await safeInvoke<number[]>('buffer_get_bytes');
				    const buffer = bytes?.length ? new Uint8Array(bytes) : new Uint8Array();
				    if (buffer.length === 0) {
				      alert('Buffer is empty');
				      return;
				    }

    const selectedPin = pinOptions[selectedPinIndex];
    const pinNumber = deviceType === 'stm32'
      ? getStm32PinNumber(selectedPin)
      : getEsp32PinNumber(selectedPin);
    if (pinNumber === -1) {
      alert('Invalid pin selected');
      return;
    }

    try {
      let commandStr = `transmit start --pin=${pinNumber}`;
      if (deviceType === 'esp32' && pwmEnabled) {
        const freqHz = parsePwmIntOrDefault(`${pwmFreqHz}`, DEFAULT_PWM_FREQ_HZ);
        const dutyPercent = parsePwmIntOrDefault(`${pwmDutyPercent}`, DEFAULT_PWM_DUTY_PERCENT);
        if (freqHz < 1) {
          alert('Invalid PWM frequency');
          return;
        }
        if (dutyPercent < 1 || dutyPercent > 100) {
          alert('Invalid PWM duty (1-100)');
          return;
        }
        setPwmFreqHz(freqHz);
        setPwmDutyPercent(dutyPercent);
        commandStr += ` --pwm --freq=${freqHz} --duty=${dutyPercent}`;
      }

      // Send "transmit start --pin=<pin>" command (matching Android/iOS)
      await send(commandStr, 2000, 1);

      // Use transmitBuffer method (matching Android/iOS)
      await transmitBuffer(buffer);

      alert(`Retransmitting ${buffer.length} samples on ${selectedPin}`);
    } catch (error) {
      console.error('Failed to retransmit signal:', error);
      alert('Failed to retransmit signal');
    }
	  };

				  const getTimings = () => {
			    void safeInvoke<string>('buffer_build_signed_raw_timings')
			      .then((timings) => {
			        if (!timings) {
			          alert('Buffer is empty');
			          return;
			        }
              void copyTextToClipboard(timings).then((ok) => {
                if (ok) {
                  alert('Timings copied to clipboard');
                } else {
                  alert('Clipboard copy failed');
                }
              });
			      })
			      .catch((error) => {
			        console.error('Failed to build timings:', error);
			        alert('Failed to build timings');
			      });
		  };

      const copyDebug = () => {
        const lines = [
          `transport=${status.transport}`,
          `connected=${status.connected}`,
          `bytes=${bufferLenBytesRef.current}`,
          `points=${chartData.timeValues.length}`,
          `view=${debugViewport.visibleStart}..${debugViewport.visibleEnd}`,
          `bins=${debugViewport.requestedBins}`,
          `scale=${debugViewport.scaleMin ?? '—'}..${debugViewport.scaleMax ?? '—'}`,
          `refreshRateMs=${refreshRate}`,
          `chartResolution=${chartResolution}`,
        ];
        const payload = lines.join('\n');
        void copyTextToClipboard(payload).then((ok) => {
          if (!ok) {
            alert('Clipboard copy failed');
          }
        });
      };

				  const clearBuffer = () => {
				    void safeInvoke<void>('buffer_clear', undefined, { throwOnError: true }).catch((error) => {
				      console.error('Failed to clear sampler buffer:', error);
				    });
				    bufferLenBytesRef.current = 0;
				    setBufferLenBytes(0);
				    lastBufferSizeRef.current = 0;
				    setChartData({ timeValues: [], dataValues: [] });
				    setHasUnsavedChanges(false);
				    resetChartZoom();
				  };

  const resetChartZoom = () => {
    const chart = getChartInstance(chartRef.current);
    if (chart) {
      try {
        chart.resetZoom();
        chart.update('none');
      } catch (e) {
        // Chart might not be fully initialized
        console.warn('Could not reset zoom:', e);
      }
    }
  };

	  const loadSignal = async (signalName: string) => {
    if (!signalsDir) {
      alert('Signals storage is not available');
      return;
    }
    if (signalName === currentSignalName && !hasUnsavedChanges) {
      return;
    }
    try {
      const entry = signalEntries.find((item) => item.name === signalName);
      if (!entry) {
        alert('Signal file not found');
        return;
      }

      const data = await safeInvoke<number[]>(
        'read_binary_file',
        { payload: { path: entry.path } },
        { throwOnError: true },
      );
	      if (!data || data.length === 0) {
	        alert('Signal file is empty');
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
	      alert('Failed to load signal');
	    }
  };

		  const saveSignalToStorage = async (enteredName: string) => {
		    const bufferSize = (await safeInvoke<number>('buffer_get_len_bytes')) ?? bufferLenBytesRef.current;
		    if (bufferSize === 0) {
		      alert('Buffer is empty');
		      return;
		    }

    const dir = await ensureSignalsDir();
    if (!dir) {
      alert('Signals storage is not available');
      return;
    }

    const defaultName = currentSignalName || generateNewSignalName();
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
      alert(`Signal saved: ${fileName}`);
    } catch (error) {
      console.error('Failed to save signal:', error);
      alert('Failed to save signal');
    }
  };

		  const openSaveDialog = () => {
		    const bufferSize = bufferLenBytesRef.current;
		    if (bufferSize === 0) {
		      alert('Buffer is empty');
		      return;
		    }

    const defaultName = currentSignalName || generateNewSignalName();
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
      alert('Signals storage is not available');
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
      alert('Failed to open signals folder');
    }
  }, [ensureSignalsDir]);

  const revealCurrentSignal = useCallback(async () => {
    const dir = await ensureSignalsDir();
    if (!dir) {
      alert('Signals storage is not available');
      return;
    }
    if (!currentSignalName) {
      alert('No signal selected');
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
      alert('Failed to open signal file');
    }
  }, [currentSignalName, ensureSignalsDir, signalEntries]);

  const importSignal = async () => {
    try {
      // Use file input for both browser and Tauri (simpler approach)
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.raw';
      input.onchange = async (e) => {
        const selectedFile = (e.target as HTMLInputElement).files?.[0];
        if (!selectedFile) return;

        try {
          const arrayBuffer = await selectedFile.arrayBuffer();
          const buffer = new Uint8Array(arrayBuffer);
	          if (buffer.length === 0) {
	            alert('Selected file is empty');
	            return;
	          }

	          const defaultName = selectedFile.name || generateNewSignalName();
	          const fileName = normalizeSignalName(defaultName, generateNewSignalName());
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
	          alert('Failed to import signal');
	        }
      };
      input.click();
    } catch (error) {
      console.error('Failed to import signal:', error);
      alert('Failed to import signal');
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
        const files = (entries || []).filter(
          (entry) => entry.kind === 'file' && entry.name.toLowerCase().endsWith('.raw')
        );
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
      alert('No signal loaded');
      return;
    }
    const normalized = normalizeSignalName(enteredName, currentSignalName);
    if (normalized === currentSignalName) {
      alert('Name unchanged');
      return;
    }
    if (signalEntries.some((entry) => entry.name === normalized)) {
      alert('A signal with this name already exists');
      return;
    }
    const entry = signalEntries.find((item) => item.name === currentSignalName);
    if (!entry) {
      alert('Signal file not found');
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
      alert('Signal renamed');
    } catch (error) {
      console.error('Failed to rename signal:', error);
      alert('Failed to rename signal');
    }
  };

  const openRenameDialog = () => {
    if (!currentSignalName) {
      alert('No signal loaded');
      return;
    }
    const existing = currentSignalName.replace(/\.raw$/i, '');
    setTextDialogMode('rename');
    setTextDialog({ open: true, title: 'Rename Signal', value: existing, okLabel: 'Rename' });
  };

  const renameSignal = async () => {
    openRenameDialog();
  };

  const deleteSignal = async () => {
    if (!currentSignalName || !signalsDir) {
      alert('No signal loaded');
      return;
    }
    const entry = signalEntries.find((item) => item.name === currentSignalName);
    if (!entry) {
      alert('Signal file not found');
      return;
    }
    const confirmed = window.confirm(`Delete ${currentSignalName}?`);
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
      alert('Signal deleted');
    } catch (error) {
      console.error('Failed to delete signal:', error);
      alert('Failed to delete signal');
    }
  };

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: true,
      },
      zoom: {
        zoom: {
          wheel: {
            enabled: true,
            speed: 0.05,
          },
          drag: {
            enabled: false,
          },
          pinch: {
            enabled: true,
          },
          mode: 'x' as const,
          onZoom: ({ chart }: { chart: any }) => {
            maybeRefreshOnInteraction(chart);
          },
          onZoomComplete: ({ chart }: { chart: any }) => {
            refreshChart(chart);
          },
        },
        pan: {
          enabled: true,
          mode: 'x' as const,
          onPan: ({ chart }: { chart: any }) => {
            maybeRefreshOnInteraction(chart);
          },
          onPanComplete: ({ chart }: { chart: any }) => {
            refreshChart(chart);
          },
        },
        limits: {
          x: {
            min: 0,
            max: 10000,
          },
        },
      },
    },
    scales: {
      x: {
        type: 'linear' as const,
        title: {
          display: true,
          text: 'Time (bits)',
          color: '#cbd5e1',
        },
        ticks: {
          color: '#cbd5e1',
        },
        grid: {
          color: '#334155',
        },
        min: 0,
        max: 10000,
      },
      y: {
        type: 'linear' as const,
        title: {
          display: true,
          text: 'Value',
          color: '#cbd5e1',
        },
        ticks: {
          color: '#cbd5e1',
        },
        grid: {
          color: '#334155',
        },
        min: -128,
        max: 384,
      },
    },
  }), [maybeRefreshOnInteraction, refreshChart]);

  // Update chart when data changes (matches Android: chart.setData() + chart.invalidate())
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    
    // Force chart update when data changes
    chart.update('none');
  }, [chartData]);

  const data = useMemo(() => ({
    datasets: [
      {
        label: 'Signal',
        data: chartData.timeValues.length > 0 
          ? chartData.timeValues.map((time, index) => ({
              x: time,
              y: chartData.dataValues[index] ?? 0,
            }))
          : [],
        borderColor: '#01579B',
        backgroundColor: 'rgba(1, 87, 155, 0.1)',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0,
        normalized: true,
      },
    ],
  }), [chartData]);

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
            className="px-3 py-1.5 text-sm bg-slate-800 text-slate-200 rounded hover:bg-slate-700"
          >
            New
          </button>
          <button
            onClick={openSaveDialog}
            className="px-3 py-1.5 text-sm bg-slate-800 text-slate-200 rounded hover:bg-slate-700"
          >
            Save
          </button>
          <button
            onClick={revealCurrentSignal}
            disabled={!currentSignalName}
            className="px-3 py-1.5 text-sm bg-slate-800 text-slate-200 rounded hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Show File
          </button>
          <button
            onClick={revealSignalsFolder}
            className="px-3 py-1.5 text-sm bg-slate-800 text-slate-200 rounded hover:bg-slate-700"
          >
            Show Folder
          </button>
          <button
            onClick={renameSignal}
            className="px-3 py-1.5 text-sm bg-slate-800 text-slate-200 rounded hover:bg-slate-700"
          >
            Rename
          </button>
          <button
            onClick={deleteSignal}
            className="px-3 py-1.5 text-sm bg-slate-800 text-slate-200 rounded hover:bg-slate-700"
          >
            Delete
          </button>
          <button
            onClick={importSignal}
            className="px-3 py-1.5 text-sm bg-slate-800 text-slate-200 rounded hover:bg-slate-700"
          >
            Import
          </button>
          <button
            onClick={clearBuffer}
            className="px-3 py-1.5 text-sm bg-slate-800 text-slate-200 rounded hover:bg-slate-700"
          >
            Clear
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="px-3 py-1.5 text-sm bg-slate-800 text-slate-200 rounded hover:bg-slate-700"
          >
            Settings
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 flex-col gap-5 overflow-y-auto px-6 py-6">
        {/* Chart */}
		        <div className="flex-shrink-0 bg-slate-900 rounded-lg p-4">
			          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
			            <div>Backend: rust</div>
			            <div>Bytes: {bufferLenBytes}</div>
                  <div>Points: {chartData.timeValues.length}</div>
                  <div>
                    View: {debugViewport.visibleStart}..{debugViewport.visibleEnd} bins {debugViewport.requestedBins}
                  </div>
                  <div>
                    Scale: {debugViewport.scaleMin ?? '—'}..{debugViewport.scaleMax ?? '—'}
                  </div>
                  <button
                    type="button"
                    onClick={copyDebug}
                    className="ml-auto rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-700"
                  >
                    Copy debug
                  </button>
			          </div>
	          <div className="w-full" style={{ minHeight: '400px', height: '400px' }}>
	            {chartError ? (
              <div className="flex h-full items-center justify-center text-slate-400">
                <p>Chart error: {chartError}</p>
              </div>
            ) : (
              <Line 
                ref={chartRef} 
                data={data} 
                options={chartOptions}
                redraw={false}
              />
            )}
          </div>
        </div>

        {/* Primary actions */}
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <button
              onClick={startRecording}
              disabled={!isConnected || isRecording}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Record
            </button>
            <button
              onClick={stopRecording}
              disabled={!isConnected || !isRecording}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Stop
            </button>
          </div>

          <button
            onClick={retransmitSignal}
            disabled={!isConnected}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Retransmit
          </button>

          <button
            onClick={getTimings}
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
          >
            Get Timings
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
              if (deviceType === 'stm32') {
                setSelectedPinIndexStm32(index);
              } else {
                setSelectedPinIndexEsp32(index);
              }
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
                <p className="text-xs text-slate-500">Applies to retransmit for ESP32.</p>
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

	      {textDialog.open && (
	        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
	          <div className="bg-slate-900 p-6 rounded-lg w-96 border border-slate-700 shadow-xl">
	            <h3 className="text-lg font-medium text-slate-100 mb-4">{textDialog.title}</h3>
	            <input
	              className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded p-2 mb-4 font-mono"
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
	                className="px-4 py-2 text-slate-300 hover:text-white"
	              >
	                Cancel
	              </button>
	              <button
	                onClick={() => void confirmTextDialog()}
	                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded"
	              >
	                {textDialog.okLabel}
	              </button>
	            </div>
	          </div>
	        </div>
	      )}

	      {/* Settings Modal */}
	      {showSettings && (
	        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
	          <div className="w-96 rounded-lg bg-slate-900 p-6 shadow-xl border border-slate-700">
            <h3 className="mb-4 text-lg font-semibold text-slate-100">Settings</h3>
            
            <div className="mb-4 space-y-2">
              <label className="block text-sm font-medium text-slate-300">
                Chart Resolution (visible points)
              </label>
              <input
                type="number"
                value={chartResolution}
                onChange={(e) => setChartResolution(Number(e.target.value))}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
              />
              <p className="text-xs text-slate-500">
                Higher values show more detail but may reduce performance.
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
