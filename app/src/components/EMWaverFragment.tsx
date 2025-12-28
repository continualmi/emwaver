import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDevice } from "../utils/DeviceContext";

interface BLEStatus {
  connected: boolean;
  scanning: boolean;
  device_name: string | null;
  device_address: string | null;
}

export default function EMWaverFragment() {
  const { addNotificationListener, removeNotificationListener } = useDevice();
  const [status, setStatus] = useState<BLEStatus>({
    connected: false,
    scanning: false,
    device_name: null,
    device_address: null,
  });
  const [commandInput, setCommandInput] = useState("");
  const [serialMonitor, setSerialMonitor] = useState<string[]>([]);
  const [showHex, setShowHex] = useState(false);
  const [firmwareVersion, setFirmwareVersion] = useState("Unknown");
  const [isInitialized, setIsInitialized] = useState(false);
  const monitorEndRef = useRef<HTMLDivElement>(null);
  const statusIntervalRef = useRef<number | null>(null);
  const notificationIntervalRef = useRef<number | null>(null);

  // Initialize BLE on mount
  useEffect(() => {
    const initBLE = async () => {
      try {
        await invoke("ble_initialize");
        setIsInitialized(true);
      } catch (error) {
        console.error("Failed to initialize BLE:", error);
      }
    };
    initBLE();
  }, []);

  // Poll for status updates
  useEffect(() => {
    if (!isInitialized) return;

    const updateStatus = async () => {
      try {
        const currentStatus = await invoke<BLEStatus>("ble_get_status");
        setStatus(currentStatus);
      } catch (error) {
        console.error("Failed to get BLE status:", error);
      }
    };

    updateStatus();
    statusIntervalRef.current = window.setInterval(updateStatus, 1000);

    return () => {
      if (statusIntervalRef.current !== null) {
        clearInterval(statusIntervalRef.current);
      }
    };
  }, [isInitialized]);

  // Poll for notifications
  useEffect(() => {
    if (!status.connected) return;

    const listener = (data: Uint8Array, timestampMs: number) => {
      const timestamp = new Date(timestampMs).toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
      });
      appendToMonitor(data, timestamp, false);
    };

    addNotificationListener(listener);
    return () => {
      removeNotificationListener(listener);
    };
  }, [status.connected, addNotificationListener, removeNotificationListener]);

  // Auto-scroll monitor
  useEffect(() => {
    monitorEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [serialMonitor]);

  const appendToMonitor = (data: Uint8Array, timestamp: string, isTx: boolean) => {
    const hexStr = Array.from(data)
      .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
      .join(" ");
    const asciiStr = Array.from(data)
      .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : "."))
      .join("");

    const content = showHex ? hexStr : asciiStr;
    const color = isTx ? "#FFD700" : "#00AA00";
    const line = `[${timestamp}] <span style="color: ${color}">${content}</span>`;

    setSerialMonitor((prev) => [...prev, line]);
  };

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
      setStatus((prev) => ({ ...prev, scanning: true }));
      await invoke("ble_start_scan");
    } catch (error) {
      console.error("Failed to start scan:", error);
      setStatus((prev) => ({ ...prev, scanning: false }));
    }
  };

  const handleDisconnect = async () => {
    try {
      await invoke("ble_disconnect");
      setFirmwareVersion("Unknown");
    } catch (error) {
      console.error("Failed to disconnect:", error);
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
      // Log TX data
      const timestamp = new Date().toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
      });
      appendToMonitor(commandBytes, timestamp, true);

      // Send packet
      await invoke("ble_send_packet", { data: Array.from(commandBytes) });

      // Clear input
      setCommandInput("");

      // If command is "version", request firmware version
      if (commandInput.trim().toLowerCase() === "version") {
        setTimeout(() => {
          // Version will be received via notifications
        }, 500);
      }
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
      const timestamp = new Date().toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
      });
      appendToMonitor(versionBytes, timestamp, true);
      await invoke("ble_send_packet", { data: Array.from(versionBytes) });
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
        </div>
        <button
          onClick={clearMonitor}
          className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 rounded hover:border-slate-700"
        >
          Clear
        </button>
      </header>

      <div className="flex flex-1 flex-col min-h-0 gap-4 overflow-y-auto px-6 py-6">
        {/* Connection Status */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
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
                onClick={handleDisconnect}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={status.scanning || !isInitialized}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                Connect
              </button>
            )}
          </div>
        </div>

        {/* Firmware Version */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-slate-400">Firmware Version:</span>
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
                className="h-5 w-5"
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

        {/* Command Input */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
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
        <div className="flex-1 min-h-[18rem] rounded-xl border border-slate-800 bg-slate-950 p-4 overflow-hidden flex flex-col">
          <div className="text-sm font-semibold text-slate-400 mb-2">Serial Monitor</div>
          <div className="flex-1 overflow-y-auto font-mono text-sm text-slate-300 bg-slate-900 rounded p-3">
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
                <div ref={monitorEndRef} />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
