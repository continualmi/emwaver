import { useEffect, useState, useRef, useCallback } from "react";
import { safeInvoke } from "../utils/tauri";
import type { FragmentType } from "../App";
import { useBLE } from "../utils/BLEContext";

type HomePageProps = {
  onNavigateToFragment: (fragment: FragmentType) => void;
  // isActive is no longer needed since polling is handled by context
};

export default function HomePage({ onNavigateToFragment }: HomePageProps) {
  // Use BLE Context instead of local state for connection
  const { 
    status, 
    connect, 
    disconnect, 
    sendCommand, 
    addNotificationListener, 
    removeNotificationListener 
  } = useBLE();

  const [commandInput, setCommandInput] = useState("");
  const [serialMonitor, setSerialMonitor] = useState<string[]>([]);
  const [showHex, setShowHex] = useState(false);
  const [firmwareVersion, setFirmwareVersion] = useState("Unknown");
  
  const monitorContainerRef = useRef<HTMLDivElement>(null);
  
  const scanTimeoutRef = useRef<number | null>(null);

  const fragments = [
    {
      id: "wavelets" as FragmentType,
      name: "Wavelets",
      description: "Manage and run wavelet scripts",
      icon: <WaveletIcon />,
      borderClass: "hover:border-sky-500/60",
      iconClass: "text-sky-400",
    },
    {
      id: "ism" as FragmentType,
      name: "ISM (CC1101)",
      description: "Sub-GHz radio control and signal capture",
      icon: <ISMIcon />,
      borderClass: "hover:border-emerald-500/60",
      iconClass: "text-emerald-400",
    },
    {
      id: "sampler" as FragmentType,
      name: "Sampler",
      description: "Signal sampling and analysis",
      icon: <SamplerIcon />,
      borderClass: "hover:border-purple-500/60",
      iconClass: "text-purple-400",
    },
  ];

  // Auto-scroll monitor
  useEffect(() => {
    if (monitorContainerRef.current) {
      monitorContainerRef.current.scrollTop = monitorContainerRef.current.scrollHeight;
    }
  }, [serialMonitor]);

  const appendToMonitor = useCallback((data: Uint8Array, timestamp: number, isTx: boolean) => {
    const timeStr = new Date(timestamp).toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
    });
    
    const hexStr = Array.from(data)
      .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
      .join(" ");
    const asciiStr = Array.from(data)
      .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : "."))
      .join("");

    const content = showHex ? hexStr : asciiStr;
    const color = isTx ? "#FFD700" : "#00AA00";
    const line = `[${timeStr}] <span style="color: ${color}">${content}</span>`;

    setSerialMonitor((prev) => [...prev, line]);
  }, [showHex]);

  // Register Notification Listener
  useEffect(() => {
    const listener = (data: Uint8Array, timestamp: number) => {
        appendToMonitor(data, timestamp, false);
    };
    addNotificationListener(listener);
    return () => {
        removeNotificationListener(listener);
    };
  }, [addNotificationListener, removeNotificationListener, appendToMonitor]);


  const parseCommand = (input: string): Uint8Array | null => {
    const bytes: number[] = [];

    try {
      // Check if input contains bracketed values
      if (input.includes("[") && input.includes("]")) {
        const parts = input.split(/[\[\]]/);
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
            // Hexadecimal value
            bytes.push(parseInt(trimmed.substring(2), 16));
          } else if (/^\d+$/.test(trimmed)) {
            // Decimal value
            const val = parseInt(trimmed, 10);
            if (val < 0 || val > 255) {
              throw new Error(`Decimal value out of byte range: ${val}`);
            }
            bytes.push(val);
          } else {
            // Treat as ASCII
            for (const char of trimmed) {
              bytes.push(char.charCodeAt(0));
            }
          }
        }
      } else {
        // No brackets, treat entire input as ASCII
        for (const char of input) {
          bytes.push(char.charCodeAt(0));
        }
      }

      return new Uint8Array(bytes);
    } catch (error) {
      console.error("Error parsing command:", error);
      return null;
    }
  };

  const handleSendCommand = async () => {
    if (!commandInput.trim()) {
      return;
    }

    const commandBytes = parseCommand(commandInput.trim());
    if (!commandBytes) {
      alert("Invalid packet format.");
      return;
    }

    if (!status.connected) {
      alert("Device not connected");
      return;
    }

    try {
      // Log TX data locally
      appendToMonitor(commandBytes, Date.now(), true);

      // Send packet via Context
      await sendCommand(commandBytes);

      // Clear input
      setCommandInput("");
    } catch (error) {
      console.error("Failed to send packet:", error);
      alert(`Failed to send packet: ${error}`);
    }
  };

  const handleCheckVersion = async () => {
    if (!status.connected) {
      alert("Device not connected");
      return;
    }

    try {
      const versionBytes = new TextEncoder().encode("version");
      appendToMonitor(versionBytes, Date.now(), true);
      await sendCommand(versionBytes);
    } catch (error) {
      console.error("Failed to check version:", error);
    }
  };

  const clearMonitor = () => {
    setSerialMonitor([]);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSendCommand();
    }
  };

  // Extract version from notification when connected
  useEffect(() => {
    if (status.connected && serialMonitor.length > 0) {
      const lastMessage = serialMonitor[serialMonitor.length - 1];
      // Look for version pattern like "1.0.0 - Welcome to EMWaver!"
      const versionMatch = lastMessage.match(/(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        setFirmwareVersion(versionMatch[1]);
      }
    } else if (!status.connected) {
      setFirmwareVersion("Unknown");
    }
  }, [serialMonitor, status.connected]);

  return (
    <section className="flex flex-1 flex-col min-h-0 bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-900 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">EMWaver</h2>
          <p className="text-sm text-slate-400">Main hardware control and device management</p>
        </div>
      </header>

      <div className="flex flex-1 flex-col min-h-0 gap-3 overflow-hidden px-6 py-4">
        {/* Quick Access to Fragments */}
        <div className="flex-shrink-0">
          <h3 className="text-sm font-semibold text-slate-100 mb-2">Quick Access</h3>
          <div className="grid grid-cols-2 gap-3">
            {fragments.map((fragment) => (
              <button
                key={fragment.id}
                onClick={() => onNavigateToFragment(fragment.id)}
                className={`group rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-left transition-all ${fragment.borderClass} hover:bg-slate-900 hover:shadow-lg`}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 ${fragment.iconClass} transition-colors group-hover:bg-slate-800`}>
                    <span className="h-5 w-5">{fragment.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-slate-100 truncate">{fragment.name}</h4>
                    <p className="mt-1 text-xs text-slate-400 line-clamp-2">{fragment.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Divider/Spacing */}
        <div className="border-t border-slate-800 my-2 flex-shrink-0"></div>

        {/* Connection Status and Firmware Version - Side by Side */}
        <div className="grid grid-cols-2 gap-3 flex-shrink-0">
          {/* Connection Status */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-400">Status:</span>
                <span
                  className={`text-sm font-medium ${
                    status.connected ? "text-green-500" : status.scanning ? "text-yellow-500" : "text-red-500"
                  }`}
                >
                  {status.connected ? "Connected" : status.scanning ? "Connecting..." : "Not connected"}
                </span>
              </div>
              {status.connected ? (
                <button
                  onClick={disconnect}
                  className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={connect}
                  className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  {status.scanning ? "Scanning..." : "Connect"}
                </button>
              )}
            </div>
          </div>

          {/* Firmware Version */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-400">Firmware:</span>
                <span
                  className={`text-sm ${
                    firmwareVersion !== "Unknown" ? "text-blue-400" : "text-slate-500"
                  }`}
                >
                  {firmwareVersion}
                </span>
              </div>
              <button
                onClick={handleCheckVersion}
                disabled={!status.connected}
                className="p-1.5 text-slate-400 hover:text-slate-200 disabled:text-slate-700 disabled:cursor-not-allowed border border-slate-800 rounded hover:border-slate-700 transition-colors"
                title="Check firmware version"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Command Input */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 flex-shrink-0">
          <label className="block text-sm font-semibold text-slate-400 mb-2">Command</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="e.g., version[0x00][255][0xFF]"
              className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-600"
            />
            <button
              onClick={handleSendCommand}
              disabled={!status.connected || !commandInput.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              Send Packet
            </button>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showHex}
                onChange={(e) => setShowHex(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-600"
              />
              <span>HEX</span>
            </label>
          </div>
        </div>

        {/* Serial Monitor */}
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <div className="text-sm font-semibold text-slate-400">Serial Monitor</div>
            <button
              onClick={clearMonitor}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 rounded hover:border-slate-700 transition-colors"
            >
              Clear
            </button>
          </div>
          <div ref={monitorContainerRef} className="overflow-y-auto font-mono text-sm text-slate-300 bg-slate-900 rounded p-3 flex-1 min-h-0">
            {serialMonitor.length === 0 ? (
              <div className="text-slate-500">No data received yet...</div>
            ) : (
              <>
                {serialMonitor.map((line, index) => (
                  <div
                    key={index}
                    dangerouslySetInnerHTML={{ __html: line }}
                    className="mb-1"
                  />
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function WaveletIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <path
        d="M3 12c1.5-3 3.5-3 5 0s3.5 3 5 0 3.5-3 5 0"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 5c1 2 2.5 2 4 0s3-2 4 0 3 2 4 0"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="opacity-70"
      />
    </svg>
  );
}

function ISMIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <circle cx="7" cy="10" r="1.5" />
      <circle cx="13" cy="10" r="1.5" />
      <line x1="10" y1="4" x2="10" y2="16" />
    </svg>
  );
}

function SamplerIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
      <path d="M3 10h14M5 6l2 4-2 4M15 6l-2 4 2 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}