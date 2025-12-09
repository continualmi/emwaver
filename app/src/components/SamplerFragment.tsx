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
import { safeInvoke } from '../utils/tauri';
import { SamplerBuffer } from '../utils/SamplerBuffer';

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

const PINS = [
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

function getPinNumber(pinString: string): number {
  const match = pinString.match(/\(IO(\d+)\)/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return -1;
}

function SamplerFragment() {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedPinIndex, setSelectedPinIndex] = useState(10); // GPIO6 default
  const [signalNames, setSignalNames] = useState<string[]>([]);
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
  const [chartResolution, setChartResolution] = useState(1000);
  const [maxSamples, setMaxSamples] = useState(393216);
  const [refreshRate, setRefreshRate] = useState(50);

  const bufferRef = useRef(new SamplerBuffer());
  const chartRef = useRef<any>(null);
  const refreshIntervalRef = useRef<number | null>(null);
  const lastBufferSizeRef = useRef(0);
  
  // Update buffer max size when setting changes
  useEffect(() => {
    bufferRef.current.setMaxSize(maxSamples);
  }, [maxSamples]);

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

  // Check BLE connection status
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const status = await safeInvoke<{ connected: boolean }>('ble_get_status');
        setIsConnected(status?.connected ?? false);
      } catch (error) {
        console.error('Failed to check BLE status:', error);
        setIsConnected(false);
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 1000);
    return () => clearInterval(interval);
  }, []);

  // Listen for BLE notifications and accumulate buffer
  useEffect(() => {
    if (!isConnected) return;

    const pollNotifications = async () => {
      const notification = await safeInvoke<{ data: number[] }>('ble_get_notification');
      if (notification?.data) {
        bufferRef.current.append(new Uint8Array(notification.data));
        if (isRecording) {
          setHasUnsavedChanges(true);
        }
      }
    };

    const interval = setInterval(pollNotifications, 10);
    return () => clearInterval(interval);
  }, [isConnected, isRecording]);

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

      // Update chart data
      setChartData(compressed);
      
      // Update chart X-axis max to expand as buffer grows (matches Android)
      if (chart.options?.scales?.x) {
        chart.options.scales.x.max = chartMaxX;
        // Also update zoom limits
        if (chart.options.plugins?.zoom?.limits?.x) {
          chart.options.plugins.zoom.limits.x.max = chartMaxX;
        }
      }
      
      // Force chart update (matches Android: chart.invalidate())
      chart.update('none');
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

    const selectedPin = PINS[selectedPinIndex];
    const pinNumber = getPinNumber(selectedPin);
    if (pinNumber === -1) {
      alert('Invalid pin selected');
      return;
    }

    // Send "sample start --pin=<pin>" command (matching Android/iOS)
    const commandStr = `sample start --pin=${pinNumber}`;
    const command = new TextEncoder().encode(commandStr);
    await safeInvoke('ble_send_packet', { data: Array.from(command) });

    setIsRecording(true);
    setHasUnsavedChanges(true);
  };

  const stopRecording = async () => {
    if (!isConnected) return;

    // Send "sample stop" command (matching Android/iOS)
    const command = new TextEncoder().encode('sample stop');
    await safeInvoke('ble_send_packet', { data: Array.from(command) });

    setIsRecording(false);
  };

  const retransmitSignal = async () => {
    if (!isConnected) {
      alert('Not connected to device');
      return;
    }

    const buffer = bufferRef.current.getBuffer();
    if (buffer.length === 0) {
      alert('Buffer is empty');
      return;
    }

    const selectedPin = PINS[selectedPinIndex];
    const pinNumber = getPinNumber(selectedPin);
    if (pinNumber === -1) {
      alert('Invalid pin selected');
      return;
    }

    // Send "transmit start --pin=<pin>" command (matching Android/iOS)
    const commandStr = `transmit start --pin=${pinNumber}`;
    const command = new TextEncoder().encode(commandStr);
    await safeInvoke('ble_send_packet', { data: Array.from(command) });

    // Use transmitBuffer method (matching Android/iOS)
    await safeInvoke('ble_transmit_buffer', { data: Array.from(buffer) });

    alert(`Retransmitting ${buffer.length} samples on ${selectedPin}`);
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
    try {
      // Load from localStorage (can be enhanced with file system later)
      const stored = localStorage.getItem(`signal_${signalName}`);
      if (!stored) {
        alert('Signal file not found');
        return;
      }

      const data = Uint8Array.from(JSON.parse(stored));
      bufferRef.current.loadBuffer(data);
      lastBufferSizeRef.current = bufferRef.current.getBufferLength();
      setCurrentSignalName(signalName);
      setHasUnsavedChanges(false);
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

    const fileName = currentSignalName || generateNewSignalName();
    
    try {
      // Save to localStorage (can be enhanced with file system later)
      localStorage.setItem(`signal_${fileName}`, JSON.stringify(Array.from(buffer)));
      setCurrentSignalName(fileName);
      setHasUnsavedChanges(false);
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
          bufferRef.current.loadBuffer(new Uint8Array(arrayBuffer));
          lastBufferSizeRef.current = bufferRef.current.getBufferLength();
          
          const fileName = selectedFile.name || 'imported.raw';
          setCurrentSignalName(fileName);
          setHasUnsavedChanges(false);
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
  };

  const refreshSignalList = () => {
    try {
      // Get all signal names from localStorage
      const signals: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('signal_')) {
          signals.push(key.replace('signal_', ''));
        }
      }
      signals.sort();
      setSignalNames(signals);
    } catch (error) {
      console.error('Failed to refresh signal list:', error);
    }
  };

  // Load signal list on mount
  useEffect(() => {
    refreshSignalList();
  }, []);

  const generateNewSignalName = (): string => {
    let counter = 1;
    let candidate = `signal${counter}.raw`;
    while (signalNames.includes(candidate)) {
      counter++;
      candidate = `signal${counter}.raw`;
    }
    return candidate;
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
    
    // Update chart data and force redraw
    chart.update('none');
  }, [chartData]);

  const data = {
    datasets: [
      {
        label: 'Signal',
        data: chartData.timeValues.map((time, index) => ({
          x: time,
          y: chartData.dataValues[index],
        })),
        borderColor: '#01579B',
        backgroundColor: 'rgba(1, 87, 155, 0.1)',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0,
        normalized: true,
      },
    ],
  };

  return (
    <section className="flex flex-1 flex-col bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-900 px-6 py-4">
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

      <div className="flex flex-1 flex-col gap-5 overflow-hidden px-6 py-6">
        {/* Chart */}
        <div className="flex-1 min-h-0 bg-slate-900 rounded-lg p-4">
          <div className="h-full w-full">
            {chartError ? (
              <div className="flex h-full items-center justify-center text-slate-400">
                <p>Chart error: {chartError}</p>
              </div>
            ) : (
              <Line 
                ref={chartRef} 
                data={data} 
                options={chartOptions}
              />
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-4">
          <select
            value={selectedPinIndex}
            onChange={(e) => setSelectedPinIndex(Number(e.target.value))}
            className="px-4 py-2 bg-slate-900 text-slate-200 rounded border border-slate-700"
          >
            {PINS.map((pin, index) => (
              <option key={index} value={index}>
                {pin}
              </option>
            ))}
          </select>

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
              if (index > 0 && signalNames[index - 1]) {
                loadSignal(signalNames[index - 1]);
              } else {
                createNewSignal();
              }
            }}
            className="px-4 py-2 bg-slate-900 text-slate-200 rounded border border-slate-700"
          >
            <option value={0}>New signal...</option>
            {signalNames.map((name, index) => (
              <option key={index} value={index + 1}>
                {name}
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
