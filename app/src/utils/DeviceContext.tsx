import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { safeInvoke } from './tauri';

// Types
export type TransportType = 'BLE' | 'USB';

interface DeviceStatus {
  connected: boolean;
  transport: TransportType | null;
  scanning: boolean; // For BLE
  device_name: string | null;
  device_address: string | null; // BLE address or USB port path
}

interface Notification {
  data: number[];
  timestamp: number;
}

interface DeviceContextType {
  status: DeviceStatus;
  connectUSB: (port: string) => Promise<void>;
  connectBLE: () => Promise<void>;
  disconnect: () => Promise<void>;
  listUSBPorts: () => Promise<string[]>;
  sendCommand: (data: Uint8Array) => Promise<void>;
  transmitBuffer: (data: Uint8Array) => Promise<void>;
  sendAndAwaitResponse: (commandString: string, timeoutMs?: number) => Promise<Uint8Array | null>;
  // Event listeners
  addNotificationListener: (listener: (data: Uint8Array, timestamp: number) => void) => void;
  removeNotificationListener: (listener: (data: Uint8Array, timestamp: number) => void) => void;
}

const DeviceContext = createContext<DeviceContextType | null>(null);

export const useDevice = () => {
  const context = useContext(DeviceContext);
  if (!context) {
    throw new Error('useDevice must be used within a DeviceProvider');
  }
  return context;
};

export const DeviceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<DeviceStatus>({
    connected: false,
    transport: null,
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
        // Check BLE status first
        const bleStatus = await safeInvoke<{ 
            connected: boolean;
            scanning: boolean;
            device_name: string | null;
            device_address: string | null;
        }>('ble_get_status');

        if (bleStatus && (bleStatus.connected || bleStatus.scanning)) {
            setStatus({
                connected: bleStatus.connected,
                transport: 'BLE',
                scanning: bleStatus.scanning,
                device_name: bleStatus.device_name,
                device_address: bleStatus.device_address,
            });
            return;
        }

        // Check USB status
        const usbStatus = await safeInvoke<{ 
            connected: boolean;
            device_path: string | null;
        }>('usb_get_status');

        if (usbStatus && usbStatus.connected) {
             setStatus({
                connected: true,
                transport: 'USB',
                scanning: false,
                device_name: 'USB Device',
                device_address: usbStatus.device_path,
            });
            return;
        }

        // Nothing connected
        setStatus({
            connected: false,
            transport: null,
            scanning: false,
            device_name: null,
            device_address: null,
        });

      } catch (e) {
        console.error("Status poll error", e);
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
      if (!status.connected || !status.transport) return;

      try {
        for (let i = 0; i < 5; i++) {
            let notif: Notification | null = null;
            
            if (status.transport === 'BLE') {
                notif = await safeInvoke<Notification | null>('ble_get_notification');
            } else if (status.transport === 'USB') {
                notif = await safeInvoke<Notification | null>('usb_get_notification');
            }

            if (!notif) break; // Queue empty

            const data = new Uint8Array(notif.data);
            const text = new TextDecoder().decode(data).trim();

            // 1. Handle Pending Response (Command-Response pattern)
            if (pendingResponseRef.current) {
                if (pendingResponseRef.current.isMatch(text)) {
                    pendingResponseRef.current.resolve(data);
                    pendingResponseRef.current = null;
                }
            }

            // 2. Broadcast to all listeners
            listenersRef.current.forEach(listener => listener(data, notif.timestamp));
        }
      } catch (e) {
        console.error("Notification poll error", e);
      }
    };

    notificationIntervalRef.current = window.setInterval(processNotification, 50);
    return () => {
      if (notificationIntervalRef.current) clearInterval(notificationIntervalRef.current);
    };
  }, [status.connected, status.transport]);


  // --- Public API ---

  const connectBLE = useCallback(async () => {
    if (!initializedRef.current) {
      await safeInvoke('ble_initialize');
      initializedRef.current = true;
    }
    await safeInvoke('ble_start_scan');
    
    setTimeout(async () => {
        const s = await safeInvoke<{scanning: boolean; connected: boolean}>('ble_get_status');
        if (s?.scanning && !s.connected) {
            await safeInvoke('ble_stop_scan');
        }
    }, 15000);
  }, []);

  const connectUSB = useCallback(async (port: string) => {
    await safeInvoke('usb_connect', { portName: port });
  }, []);

  const disconnect = useCallback(async () => {
    if (status.transport === 'BLE') {
        await safeInvoke('ble_disconnect');
    } else if (status.transport === 'USB') {
        await safeInvoke('usb_disconnect');
    }
  }, [status.transport]);

  const listUSBPorts = useCallback(async () => {
      const ports = await safeInvoke<string[]>('usb_list_ports');
      return ports || [];
  }, []);

  const sendCommand = useCallback(async (data: Uint8Array) => {
    if (status.transport === 'BLE') {
        await safeInvoke('ble_send_packet', { data: Array.from(data) });
    } else if (status.transport === 'USB') {
        await safeInvoke('usb_send_packet', { data: Array.from(data) });
    }
  }, [status.transport]);

  const transmitBuffer = useCallback(async (data: Uint8Array) => {
    if (status.transport === 'BLE') {
        await safeInvoke('ble_transmit_buffer', { data: Array.from(data) });
    } else if (status.transport === 'USB') {
        // For USB, we can just send the packet for now, or implement specific flow control if needed.
        // The firmware likely expects the same streaming behavior.
        // For now, mapping to usb_send_packet.
        await safeInvoke('usb_send_packet', { data: Array.from(data) });
    }
  }, [status.transport]);

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
    <DeviceContext.Provider value={{
      status,
      connectUSB,
      connectBLE,
      disconnect,
      listUSBPorts,
      sendCommand,
      transmitBuffer,
      sendAndAwaitResponse,
      addNotificationListener,
      removeNotificationListener
    }}>
      {children}
    </DeviceContext.Provider>
  );
};
