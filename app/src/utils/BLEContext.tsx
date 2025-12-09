import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { safeInvoke } from './tauri';

// Types
interface BLEStatus {
  connected: boolean;
  scanning: boolean;
  device_name: string | null;
  device_address: string | null;
}

interface BLENotification {
  data: number[];
  timestamp: number;
}

interface BLEContextType {
  status: BLEStatus;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sendCommand: (data: Uint8Array) => Promise<void>;
  sendAndAwaitResponse: (commandString: string, timeoutMs?: number) => Promise<Uint8Array | null>;
  // Event listeners
  addNotificationListener: (listener: (data: Uint8Array, timestamp: number) => void) => void;
  removeNotificationListener: (listener: (data: Uint8Array, timestamp: number) => void) => void;
}

const BLEContext = createContext<BLEContextType | null>(null);

export const useBLE = () => {
  const context = useContext(BLEContext);
  if (!context) {
    throw new Error('useBLE must be used within a BLEProvider');
  }
  return context;
};

export const BLEProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<BLEStatus>({
    connected: false,
    scanning: false,
    device_name: null,
    device_address: null,
  });

  const listenersRef = useRef<Set<(data: Uint8Array, timestamp: number) => void>>(new Set());
  const pendingResponseRef = useRef<{ 
    resolve: (data: Uint8Array) => void;
    reject: (reason: any) => void;
    isMatch: (responseStr: string) => boolean;
  } | null>(null);

  // Polling intervals
  const statusIntervalRef = useRef<number | null>(null);
  const notificationIntervalRef = useRef<number | null>(null);
  const initializedRef = useRef<boolean>(false);

  // Initialize BLE on mount
  useEffect(() => {
    const initBLE = async () => {
      try {
        await safeInvoke('ble_initialize');
        initializedRef.current = true;
      } catch (e) {
        console.error("BLE initialization error", e);
      }
    };
    initBLE();
  }, []);

  // Poll Status
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const currentStatus = await safeInvoke<BLEStatus>('ble_get_status');
        if (currentStatus) {
            setStatus(currentStatus);
        }
      } catch (e) {
        console.error("BLE status poll error", e);
      }
    };

    checkStatus();
    statusIntervalRef.current = window.setInterval(checkStatus, 500);
    return () => {
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
    };
  }, []);

  // Poll Notifications
  useEffect(() => {
    const processNotification = async () => {
      if (!status.connected) return;

      try {
        // We might need to drain the queue if multiple are waiting, 
        // but for now 100ms interval is reasonable for one-at-a-time consumption
        // Loop a few times to drain potentially buffered messages?
        // Let's try fetching up to 5 per cycle to prevent backlog.
        for (let i = 0; i < 5; i++) {
            const notif = await safeInvoke<BLENotification | null>('ble_get_notification');
            if (!notif) break; // Queue empty

            const data = new Uint8Array(notif.data);
            const text = new TextDecoder().decode(data).trim();

            // 1. Handle Pending Response (Command-Response pattern)
            let consumed = false;
            if (pendingResponseRef.current) {
                if (pendingResponseRef.current.isMatch(text)) {
                    pendingResponseRef.current.resolve(data);
                    pendingResponseRef.current = null;
                    // We DO NOT mark consumed=true if we want the Serial Monitor to ALSO see it.
                    // Usually we want the Serial Monitor to see everything.
                }
            }

            // 2. Broadcast to all listeners (Serial Monitor, etc.)
            listenersRef.current.forEach(listener => listener(data, notif.timestamp));
        }
      } catch (e) {
        console.error("BLE notification poll error", e);
      }
    };

    notificationIntervalRef.current = window.setInterval(processNotification, 50); // Faster polling (50ms)
    return () => {
      if (notificationIntervalRef.current) clearInterval(notificationIntervalRef.current);
    };
  }, [status.connected]);


  // --- Public API ---

  const connect = useCallback(async () => {
    // Ensure BLE is initialized before scanning
    if (!initializedRef.current) {
      const initResult = await safeInvoke('ble_initialize');
      if (initResult === null) {
        console.error("BLE initialization failed - Tauri not available or initialization error");
        return;
      }
      initializedRef.current = true;
    }

    const scanResult = await safeInvoke('ble_start_scan');
    if (scanResult === null) {
      console.error("Failed to start BLE scan");
      return;
    }
    
    // The status polling will pick up the 'scanning' state and eventually 'connected'
    // Set a timeout to stop scanning if it takes too long
    setTimeout(async () => {
        const s = await safeInvoke<BLEStatus>('ble_get_status');
        if (s?.scanning && !s.connected) {
            await safeInvoke('ble_stop_scan');
        }
    }, 15000);
  }, []);

  const disconnect = useCallback(async () => {
    await safeInvoke('ble_disconnect');
  }, []);

  const sendCommand = useCallback(async (data: Uint8Array) => {
    await safeInvoke('ble_send_packet', { data: Array.from(data) });
  }, []);

  const sendAndAwaitResponse = useCallback(async (commandString: string, timeoutMs: number = 2000): Promise<Uint8Array | null> => {
    if (!status.connected) return null;

    // Send
    const encoded = new TextEncoder().encode(commandString + "\n");
    await sendCommand(encoded);

    // Create Promise
    return new Promise<Uint8Array | null>((resolve) => {
        const timeoutId = setTimeout(() => {
            if (pendingResponseRef.current) {
                pendingResponseRef.current = null;
                console.warn(`Command timed out: ${commandString}`);
                resolve(null);
            }
        }, timeoutMs);

        pendingResponseRef.current = {
            resolve: (data) => {
                clearTimeout(timeoutId);
                resolve(data);
            },
            reject: (err) => {
                clearTimeout(timeoutId);
                console.error(err);
                resolve(null);
            },
            // Logic to identify if this message is the response we want
            isMatch: (text) => text.startsWith("ok") || text.startsWith("err")
        };
    });
  }, [status.connected, sendCommand]);

  const addNotificationListener = useCallback((listener: (data: Uint8Array, timestamp: number) => void) => {
    listenersRef.current.add(listener);
  }, []);

  const removeNotificationListener = useCallback((listener: (data: Uint8Array, timestamp: number) => void) => {
    listenersRef.current.delete(listener);
  }, []);

  return (
    <BLEContext.Provider value={{
      status,
      connect,
      disconnect,
      sendCommand,
      sendAndAwaitResponse,
      addNotificationListener,
      removeNotificationListener
    }}>
      {children}
    </BLEContext.Provider>
  );
};
