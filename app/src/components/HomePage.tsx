import { useEffect, useState, useRef, useCallback } from "react";
import type { FragmentType } from "../App";
import { useDevice, TransportType } from "../utils/DeviceContext";

type HomePageProps = {
  onNavigateToFragment: (fragment: FragmentType) => void;
  // isActive is no longer needed since polling is handled by context
};

export default function HomePage({ onNavigateToFragment }: HomePageProps) {
  const { 
    status, 
    connectUSB, 
    connectBLE, 
    disconnect, 
    listUSBPorts, 
    sendCommand, 
    addNotificationListener, 
    removeNotificationListener 
  } = useDevice();

  const [commandInput, setCommandInput] = useState("");
  const [serialMonitor, setSerialMonitor] = useState<string[]>([]);
  const [showHex, setShowHex] = useState(false);
  const [firmwareVersion, setFirmwareVersion] = useState("Unknown");
  
  // Transport selection state
  const [selectedTransport, setSelectedTransport] = useState<TransportType>('USB');
  const [usbPorts, setUsbPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState<string>("");
  const [isRefreshingPorts, setIsRefreshingPorts] = useState(false);

  const monitorContainerRef = useRef<HTMLDivElement>(null);
  
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
      id: "ide" as FragmentType,
      name: "IDE",
      description: "Edit firmware and run commands",
      icon: <IDEIcon />,
      borderClass: "hover:border-slate-400/60",
      iconClass: "text-slate-300",
    },
    {
      id: "ism" as FragmentType,
      name: "ISM (RFM69)",
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
    {
      id: "rfid" as FragmentType,
      name: "RFID",
      description: "Read/write MIFARE blocks",
      icon: <RfidIcon />,
      borderClass: "hover:border-amber-500/60",
      iconClass: "text-amber-400",
    },
    {
      id: "packetMode" as FragmentType,
      name: "Packet Mode",
      description: "CC1101 fixed-length packets",
      icon: <PacketModeIcon />,
      borderClass: "hover:border-indigo-500/60",
      iconClass: "text-indigo-400",
    },
    {
      id: "flash" as FragmentType,
      name: "Flash",
      description: "STM32 DFU firmware flashing",
      icon: <FlashIcon />,
      borderClass: "hover:border-sky-500/60",
      iconClass: "text-sky-400",
    },
    {
      id: "settings" as FragmentType,
      name: "Settings",
      description: "Sampler and RF defaults",
      icon: <SettingsIcon />,
      borderClass: "hover:border-slate-400/60",
      iconClass: "text-slate-400",
    },
  ];

  // Refresh ports on mount
  useEffect(() => {
    refreshPorts();
  }, [listUSBPorts]);

  const refreshPorts = async () => {
    setIsRefreshingPorts(true);
    try {
        const ports = await listUSBPorts();
        setUsbPorts(ports);
        if (ports.length > 0 && !selectedPort) {
            setSelectedPort(ports[0]);
        }
    } catch (e) {
        console.error("Failed to list ports", e);
        alert(`Failed to list USB ports: ${String(e)}`);
    } finally {
        setIsRefreshingPorts(false);
    }
  };

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

  const handleConnect = async () => {
      try {
        if (selectedTransport === 'BLE') {
            await connectBLE();
        } else {
            if (!selectedPort) {
                alert("Please select a USB port");
                return;
            }
            await connectUSB(selectedPort);
        }
      } catch (e) {
        console.error("Connect failed", e);
        alert(`Connect failed: ${String(e)}`);
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
      <div className="flex flex-1 flex-col min-h-0 gap-3 overflow-y-auto px-6 py-4">
        <div className="flex-shrink-0">
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
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-400">Connection</span>
                <div className="flex gap-2">
                    {!status.connected && (
                        <>
                            <button
                                onClick={() => setSelectedTransport('USB')}
                                className={`px-2 py-1 text-xs rounded border ${selectedTransport === 'USB' ? 'bg-sky-500/20 border-sky-500 text-sky-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
                            >
                                USB
                            </button>
                            <button
                                onClick={() => setSelectedTransport('BLE')}
                                className={`px-2 py-1 text-xs rounded border ${selectedTransport === 'BLE' ? 'bg-sky-500/20 border-sky-500 text-sky-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
                            >
                                BLE
                            </button>
                        </>
                    )}
                </div>
              </div>
              
              <div className="flex items-center justify-between gap-2">
                {!status.connected ? (
                   selectedTransport === 'USB' ? (
                       <div className="flex flex-1 gap-2 min-w-0">
                           <select 
                               value={selectedPort} 
                               onChange={(e) => setSelectedPort(e.target.value)}
                               className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                           >
                               <option value="" disabled>Select Port</option>
                               {usbPorts.map(port => <option key={port} value={port}>{port}</option>)}
                           </select>
                           <button 
                                onClick={refreshPorts}
                                disabled={isRefreshingPorts}
                                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs text-slate-300 transition-colors"
                                title="Refresh Ports"
                           >
                               ↻
                           </button>
                           <button
                              onClick={handleConnect}
                              disabled={!selectedPort}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs rounded transition-colors whitespace-nowrap"
                           >
                              Connect
                           </button>
                       </div>
                   ) : (
                       <div className="flex flex-1 items-center justify-between">
                           <span className="text-xs text-slate-500">Scan for EMWaver devices</span>
                           <button
                              onClick={handleConnect}
                              disabled={status.scanning}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 text-white text-xs rounded transition-colors"
                           >
                              {status.scanning ? "Scanning..." : "Scan & Connect"}
                           </button>
                       </div>
                   )
                ) : (
                   <div className="flex flex-1 items-center justify-between">
                       <div className="flex flex-col">
                           <span className="text-xs font-medium text-green-400">Connected ({status.transport})</span>
                           <span className="text-[10px] text-slate-500 truncate max-w-[120px]" title={status.device_address || ""}>{status.device_address}</span>
                       </div>
                       <button
                          onClick={disconnect}
                          className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
                       >
                          Disconnect
                       </button>
                   </div>
                )}
              </div>
            </div>
          </div>

          {/* Firmware Version */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <div className="flex items-center justify-between h-full">
              <div className="flex flex-col justify-center">
                <span className="text-sm font-semibold text-slate-400">Firmware</span>
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
                className="p-2 text-slate-400 hover:text-slate-200 disabled:text-slate-700 disabled:cursor-not-allowed border border-slate-800 rounded hover:border-slate-700 transition-colors"
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
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 flex flex-col flex-1 min-h-[18rem]">
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
  // Converted from Android ic_console_black_24dp.xml (terminal/console icon)
  // Adjusted viewBox to zoom in and center the icon for better visibility
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full">
      <g transform="translate(12, 12) scale(1.3) translate(-10.5, -12)">
        <path d="M5.64645 9.14645C5.84171 8.95118 6.15829 8.95118 6.35355 9.14645L8.35355 11.1464C8.44732 11.2402 8.5 11.3674 8.5 11.5C8.5 11.6326 8.44732 11.7598 8.35355 11.8536L6.35355 13.8536C6.15829 14.0488 5.84171 14.0488 5.64645 13.8536C5.45118 13.6583 5.45118 13.3417 5.64645 13.1464L7.29289 11.5L5.64645 9.85355C5.45118 9.65829 5.45118 9.34171 5.64645 9.14645ZM14.5 13H9.5C9.22386 13 9 13.2239 9 13.5C9 13.7761 9.22386 14 9.5 14H14.5C14.7761 14 15 13.7761 15 13.5C15 13.2239 14.7761 13 14.5 13ZM2.99609 5.5C2.99609 4.11929 4.11538 3 5.49609 3H14.4961C15.8768 3 16.9961 4.11929 16.9961 5.5V6H16.999V7H16.9961V14.5C16.9961 15.8807 15.8768 17 14.4961 17H5.49609C4.11538 17 2.99609 15.8807 2.99609 14.5V5.5ZM15.9961 6V5.5C15.9961 4.67157 15.3245 4 14.4961 4H5.49609C4.66767 4 3.99609 4.67157 3.99609 5.5V6H15.9961ZM3.99609 7V14.5C3.99609 15.3284 4.66767 16 5.49609 16H14.4961C15.3245 16 15.9961 15.3284 15.9961 14.5V7H3.99609Z" />
      </g>
    </svg>
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

function FlashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-full w-full" aria-hidden="true">
      <path
        d="M13 2L3 14h7l-1 8 12-14h-7l1-6z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
