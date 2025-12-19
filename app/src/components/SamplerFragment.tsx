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
import { SamplerBuffer } from '../utils/SamplerBuffer';
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

const DEVICE_TYPE_KEY = 'sampler.deviceType';
const PIN_INDEX_ESP32_KEY = 'sampler.pinIndex.esp32';
const PIN_INDEX_STM32_KEY = 'sampler.pinIndex.stm32';
const LAST_SIGNAL_KEY = 'sampler.lastSignal';
const PWM_ENABLED_KEY = 'sampler.pwm.enabled';
const PWM_FREQ_KEY = 'sampler.pwm.freq';
const PWM_DUTY_KEY = 'sampler.pwm.duty';
const SETTINGS_RESOLUTION_KEY = 'sampler.settings.resolution';
const SETTINGS_REFRESH_KEY = 'sampler.settings.refreshRate';
const SETTINGS_MAX_SAMPLES_KEY = 'sampler.settings.maxSamples';

const DEFAULT_PWM_FREQ_HZ = 38000;
const DEFAULT_PWM_DUTY_PERCENT = 50;
const SIGNALS_DIR_NAME = 'signals';

const ESP32_PINS = [
  'RFM69 DIO0 (IO1)',
  'RFM69 DIO1 (IO2)',
  'RFM69 DIO2 (IO42)',
  'RFM69 DIO3 (IO41)',
  'RFM69 DIO4 (IO40)',
  'RFM69 DIO5 (IO39)',
  'IR RX (IO38)',
  'IR TX (IO37)',
  'GPIO4 (IO4)',
  'GPIO5 (IO5)',
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
  'GPIO10 (IO10)',
  'GPIO11 (IO11)',
  'GPIO12 (IO12)',
  'GPIO13 (IO13)',
  'GPIO14 (IO14)',
];

const STM32_PINS = [
  'IR RX (PA1)',
  'PA0 (TIM2 CH1)',
  'PA2 (TIM2 CH3)',
  'PA3 (TIM2 CH4)',
];

function getEsp32PinNumber(pinString: string): number {
  const match = pinString.match(/\(IO(\d+)\)/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return -1;
}

function getStm32PinNumber(pinString: string): number {
  if (pinString.includes('PA0')) return 0;
  if (pinString.includes('PA1')) return 1;
  if (pinString.includes('PA2')) return 2;
  if (pinString.includes('PA3')) return 3;
  return -1;
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

function SamplerFragment() {
  // Use Device context instead of polling directly
  const { status, addNotificationListener, removeNotificationListener, sendCommand, transmitBuffer } = useDevice();
  const isConnected = status.connected;
  
  const [isRecording, setIsRecording] = useState(false);
  const [deviceType, setDeviceType] = useState<SamplerDeviceType>(() => {
    const stored = localStorage.getItem(DEVICE_TYPE_KEY);
    return stored === 'stm32' ? 'stm32' : 'esp32';
  });
  const [selectedPinIndexEsp32, setSelectedPinIndexEsp32] = useState(() => {
    const stored = Number.parseInt(localStorage.getItem(PIN_INDEX_ESP32_KEY) || '10', 10);
    return Number.isNaN(stored) ? 10 : stored;
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
  const [chartError] = useState<string | null>(null);
  
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

  const bufferRef = useRef(new SamplerBuffer());
  const chartRef = useRef<any>(null);
  const refreshIntervalRef = useRef<number | null>(null);
  const lastBufferSizeRef = useRef(0);

  const selectedPinIndex = deviceType === 'stm32' ? selectedPinIndexStm32 : selectedPinIndexEsp32;
  const pinOptions = deviceType === 'stm32' ? STM32_PINS : ESP32_PINS;

  // Update buffer max size when setting changes
  useEffect(() => {
    bufferRef.current.setMaxSize(maxSamples);
  }, [maxSamples]);

  useEffect(() => {
    localStorage.setItem(DEVICE_TYPE_KEY, deviceType);
  }, [deviceType]);

  useEffect(() => {
    localStorage.setItem(PIN_INDEX_ESP32_KEY, `${selectedPinIndexEsp32}`);
  }, [selectedPinIndexEsp32]);

  useEffect(() => {
    localStorage.setItem(PIN_INDEX_STM32_KEY, `${selectedPinIndexStm32}`);
  }, [selectedPinIndexStm32]);

  useEffect(() => {
    if (selectedPinIndexEsp32 >= ESP32_PINS.length) {
      setSelectedPinIndexEsp32(0);
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

  useEffect(() => {
    if (!isTauriAvailable()) {
      return;
    }
    const resolveSignalsDir = async () => {
      const root = await appDataDir();
      const dir = await safeJoin(root, SIGNALS_DIR_NAME);
      await safeInvoke<void>('ensure_dir', { payload: { path: dir } });
      setSignalsDir(dir);
    };
    void resolveSignalsDir();
  }, []);

  // Define refreshChart callback first (before useEffects that depend on it)
  const refreshChart = useCallback((chartInstance?: any) => {
    const chart = chartInstance || chartRef.current;
    if (!chart) return;

    const currentBufferSize = bufferRef.current.getBufferLength();
    const chartMaxX = currentBufferSize * 8;
    
    // Get visible range from chart if available
    let visibleRangeStart = 0;
    let visibleRangeEnd = chartMaxX;
    
    try {
      const xScale = chart.scales?.x;
      if (xScale) {
        visibleRangeStart = Math.max(0, Math.floor(xScale.min));
        visibleRangeEnd = Math.min(chartMaxX, Math.floor(xScale.max));
      }
    } catch (e) {
      // Chart not fully initialized
      visibleRangeStart = 0;
      visibleRangeEnd = chartMaxX;
    }

    const compressed = bufferRef.current.compressDataBits(
      visibleRangeStart,
      visibleRangeEnd,
      chartResolution
    );

    setChartData(compressed);
  }, [chartResolution]);

  // Listen for BLE notifications via context and accumulate buffer
  useEffect(() => {
    if (!isConnected) return;

    const notificationListener = (data: Uint8Array, timestamp: number) => {
      // Append all notification data to buffer
      if (data.length > 0) {
        bufferRef.current.append(data);
        if (isRecording) {
          setHasUnsavedChanges(true);
        }
      }
    };

    addNotificationListener(notificationListener);
    return () => {
      removeNotificationListener(notificationListener);
    };
  }, [isConnected, isRecording, addNotificationListener, removeNotificationListener]);

  // Refresh chart periodically
  useEffect(() => {
    if (!isConnected) {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      return;
    }

    const refreshChartLoop = () => {
      const currentBufferSize = bufferRef.current.getBufferLength();
      
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

      const chart = chartRef.current;
      if (!chart) return;

      // Update chart max X (matches Android: chartMaxX = currentBufferSize * 8)
      const chartMaxX = currentBufferSize * 8;
      
      // Get visible range from chart (matches Android: chart.getLowestVisibleX/HighestVisibleX)
      let visibleRangeStart = 0;
      let visibleRangeEnd = chartMaxX;
      
      try {
        const xScale = chart.scales?.x;
        if (xScale) {
          visibleRangeStart = Math.max(0, Math.floor(xScale.min));
          visibleRangeEnd = Math.min(chartMaxX, Math.floor(xScale.max));
        }
      } catch (e) {
        // Chart not fully initialized yet
        visibleRangeStart = 0;
        visibleRangeEnd = chartMaxX;
      }

      // Compress data (matches C++ compressDataBits exactly)
      const compressed = bufferRef.current.compressDataBits(
        visibleRangeStart,
        visibleRangeEnd,
        chartResolution
      );

      // Update chart data - always set even if empty to trigger re-render
      setChartData(compressed);
      
      // Update chart X-axis max to expand as buffer grows (matches Android)
      if (chart.options?.scales?.x) {
        chart.options.scales.x.max = chartMaxX;
        // Also update zoom limits
        if (chart.options.plugins?.zoom?.limits?.x) {
          chart.options.plugins.zoom.limits.x.max = chartMaxX;
        }
      }
    };

    refreshIntervalRef.current = window.setInterval(() => {
      refreshChartLoop();
    }, refreshRate);
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [isConnected, isRecording, chartResolution, maxSamples, refreshRate]);

  const startRecording = async () => {
    if (!isConnected) {
      alert('Not connected to device');
      return;
    }
    if (deviceType === 'stm32' && status.transport !== 'USB') {
      alert('USB device not connected');
      return;
    }
    if (deviceType === 'esp32' && status.transport !== 'BLE') {
      alert('BLE device not connected');
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

    // Send "sample start --pin=<pin>" command (matching Android/iOS)
    const commandStr = `sample start --pin=${pinNumber}\n`;
    const command = new TextEncoder().encode(commandStr);
    await sendCommand(command);

    setIsRecording(true);
    setHasUnsavedChanges(true);
  };

  const stopRecording = async () => {
    if (!isConnected) return;
    if (deviceType === 'stm32' && status.transport !== 'USB') {
      alert('USB device not connected');
      return;
    }
    if (deviceType === 'esp32' && status.transport !== 'BLE') {
      alert('BLE device not connected');
      return;
    }

    // Send "sample stop" command (matching Android/iOS)
    const command = new TextEncoder().encode('sample stop\n');
    await sendCommand(command);

    setIsRecording(false);
  };

  const retransmitSignal = async () => {
    if (!isConnected) {
      alert('Not connected to device');
      return;
    }
    if (deviceType === 'stm32' && status.transport !== 'USB') {
      alert('USB device not connected');
      return;
    }
    if (deviceType === 'esp32' && status.transport !== 'BLE') {
      alert('BLE device not connected');
      return;
    }

    const buffer = bufferRef.current.getBuffer();
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
      commandStr += '\n';
      const command = new TextEncoder().encode(commandStr);
      await sendCommand(command);

      // Use transmitBuffer method (matching Android/iOS)
      await transmitBuffer(buffer);

      alert(`Retransmitting ${buffer.length} samples on ${selectedPin}`);
    } catch (error) {
      console.error('Failed to retransmit signal:', error);
      alert('Failed to retransmit signal');
    }
  };

  const getTimings = () => {
    const timings = bufferRef.current.buildSignedRawTimings();
    if (!timings) {
      alert('Buffer is empty');
      return;
    }

    // Copy to clipboard
    navigator.clipboard.writeText(timings);
    alert('Timings copied to clipboard');
  };

  const clearBuffer = () => {
    bufferRef.current.clearBuffer();
    lastBufferSizeRef.current = 0;
    setChartData({ timeValues: [], dataValues: [] });
    setHasUnsavedChanges(false);
    resetChartZoom();
  };

  const resetChartZoom = () => {
    const chart = chartRef.current;
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

      const data = await safeInvoke<number[]>('read_binary_file', {
        payload: { path: entry.path },
      });
      if (!data || data.length === 0) {
        alert('Signal file is empty');
        return;
      }

      bufferRef.current.loadBuffer(new Uint8Array(data));
      lastBufferSizeRef.current = bufferRef.current.getBufferLength();
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

  const saveSignal = async () => {
    const buffer = bufferRef.current.getBuffer();
    if (buffer.length === 0) {
      alert('Buffer is empty');
      return;
    }

    if (!signalsDir) {
      alert('Signals storage is not available');
      return;
    }

    const defaultName = currentSignalName || generateNewSignalName();
    const entered = window.prompt('Save Signal', defaultName);
    if (entered === null) {
      return;
    }
    const fileName = normalizeSignalName(entered || defaultName, defaultName);

    try {
      const targetPath = await safeJoin(signalsDir, fileName);
      await safeInvoke<void>('write_binary_file', {
        payload: { path: targetPath, data: Array.from(buffer) },
      });
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
          if (signalsDir) {
            const targetPath = await safeJoin(signalsDir, fileName);
            await safeInvoke<void>('write_binary_file', {
              payload: { path: targetPath, data: Array.from(buffer) },
            });
          }

          bufferRef.current.loadBuffer(buffer);
          lastBufferSizeRef.current = bufferRef.current.getBufferLength();
          
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
        const entries = await safeInvoke<DirectoryEntry[]>('read_directory', {
          payload: { path: signalsDir },
        });
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

  const renameSignal = async () => {
    if (!currentSignalName || !signalsDir) {
      alert('No signal loaded');
      return;
    }
    const existing = currentSignalName.replace(/\.raw$/i, '');
    const entered = window.prompt('Rename Signal', existing);
    if (entered === null) {
      return;
    }
    const normalized = normalizeSignalName(entered, currentSignalName);
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
      await safeInvoke<void>('rename_path', {
        payload: { from: entry.path, to: targetPath },
      });
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
      await safeInvoke<void>('remove_path', { payload: { path: entry.path } });
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
          onZoomComplete: ({ chart }: { chart: any }) => {
            refreshChart(chart);
          },
        },
        pan: {
          enabled: true,
          mode: 'x' as const,
          onPanComplete: ({ chart }: { chart: any }) => {
            refreshChart(chart);
          },
        },
        limits: {
          x: {
            min: 0,
            max: bufferRef.current.getBufferLength() * 8 || 10000,
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
        max: bufferRef.current.getBufferLength() * 8 || 10000,
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
  }), [refreshChart]);

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
            onClick={saveSignal}
            className="px-3 py-1.5 text-sm bg-slate-800 text-slate-200 rounded hover:bg-slate-700"
          >
            Save
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

        {/* Controls */}
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <button
              onClick={() => setDeviceType('esp32')}
              className={`flex-1 px-4 py-2 rounded border ${
                deviceType === 'esp32'
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-slate-900 border-slate-700 text-slate-200'
              }`}
            >
              ESP32 (BLE)
            </button>
            <button
              onClick={() => setDeviceType('stm32')}
              className={`flex-1 px-4 py-2 rounded border ${
                deviceType === 'stm32'
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-slate-900 border-slate-700 text-slate-200'
              }`}
            >
              STM32 (USB)
            </button>
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
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-xs text-slate-400">
                Frequency (Hz)
                <input
                  type="number"
                  value={pwmFreqHz}
                  onChange={(e) => setPwmFreqHz(parsePwmIntOrDefault(e.target.value, DEFAULT_PWM_FREQ_HZ))}
                  disabled={!pwmEnabled}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 disabled:opacity-60"
                />
              </label>
              <label className="text-xs text-slate-400">
                Duty (%)
                <input
                  type="number"
                  value={pwmDutyPercent}
                  onChange={(e) => setPwmDutyPercent(parsePwmIntOrDefault(e.target.value, DEFAULT_PWM_DUTY_PERCENT))}
                  disabled={!pwmEnabled}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 disabled:opacity-60"
                />
              </label>
            </div>
          </div>

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
