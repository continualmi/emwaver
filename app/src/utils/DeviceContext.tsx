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

interface DeviceContextType {
  status: DeviceStatus;
  connectUSB: (port: string) => Promise<void>;
  connectBLE: () => Promise<void>;
  disconnect: () => Promise<void>;
  listUSBPorts: () => Promise<string[]>;
  sendPacket: (data: Uint8Array, timeoutMs?: number, packets?: number) => Promise<Uint8Array | null>;
  send: (commandString: string, timeoutMs?: number, packets?: number) => Promise<Uint8Array | null>;
  sendPacketNoWait: (data: Uint8Array) => Promise<void>;
  sendNoWait: (commandString: string) => Promise<void>;
  transmitBuffer: (data: Uint8Array) => Promise<void>;
  // Event listeners
  addNotificationListener: (listener: (data: Uint8Array, timestamp: number) => void) => void;
  removeNotificationListener: (listener: (data: Uint8Array, timestamp: number) => void) => void;
  addTxListener: (listener: (data: Uint8Array, timestamp: number) => void) => void;
  removeTxListener: (listener: (data: Uint8Array, timestamp: number) => void) => void;
}

const DeviceContext = createContext<DeviceContextType | null>(null);

const isSameStatus = (a: DeviceStatus, b: DeviceStatus) =>
  a.connected === b.connected &&
  a.transport === b.transport &&
  a.scanning === b.scanning &&
  a.device_name === b.device_name &&
  a.device_address === b.device_address;

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
  const txListenersRef = useRef<Set<(data: Uint8Array, timestamp: number) => void>>(new Set());

  // Polling intervals
  const statusIntervalRef = useRef<number | null>(null);
  const initializedRef = useRef<boolean>(false);

  // Initialize BLE on mount
  useEffect(() => {
    const initBLE = async () => {
      try {
        await safeInvoke('ble_initialize');
        initializedRef.current = true;
      } catch (e) {
        console.error("BLE initialization error", e);
      } finally {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("emwaver:device-initialized"));
        }
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
          const next: DeviceStatus = {
            connected: bleStatus.connected,
            transport: 'BLE',
            scanning: bleStatus.scanning,
            device_name: bleStatus.device_name,
            device_address: bleStatus.device_address,
          };
          setStatus((prev) => (isSameStatus(prev, next) ? prev : next));
          return;
        }

        // Check USB status
        const usbStatus = await safeInvoke<{ 
            connected: boolean;
            device_path: string | null;
        }>('usb_get_status');

        if (usbStatus && usbStatus.connected) {
          const next: DeviceStatus = {
            connected: true,
            transport: 'USB',
            scanning: false,
            device_name: 'USB Device',
            device_address: usbStatus.device_path,
          };
          setStatus((prev) => (isSameStatus(prev, next) ? prev : next));
          return;
        }

        // Nothing connected
        const next: DeviceStatus = {
          connected: false,
          transport: null,
          scanning: false,
          device_name: null,
          device_address: null,
        };
        setStatus((prev) => (isSameStatus(prev, next) ? prev : next));

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

  useEffect(() => {
    if (!status.connected) {
      void safeInvoke<void>('buffer_set_counter', { value: 0 }).catch(() => {});
    }
  }, [status.connected]);


  // --- Public API ---

  const connectBLE = useCallback(async () => {
    if (!initializedRef.current) {
      await safeInvoke('ble_initialize');
      initializedRef.current = true;
    }
    await safeInvoke('buffer_clear').catch(() => {});
    await safeInvoke('ble_start_scan');
    
    setTimeout(async () => {
        const s = await safeInvoke<{scanning: boolean; connected: boolean}>('ble_get_status');
        if (s?.scanning && !s.connected) {
            await safeInvoke('ble_stop_scan');
        }
    }, 15000);
  }, []);

  const connectUSB = useCallback(async (port: string) => {
    await safeInvoke('buffer_clear').catch(() => {});
    await safeInvoke('usb_connect', { portName: port }, { throwOnError: true });
  }, []);

  const disconnect = useCallback(async () => {
    if (status.transport === 'BLE') {
        await safeInvoke('ble_disconnect');
    } else if (status.transport === 'USB') {
        await safeInvoke('usb_disconnect');
    }
  }, [status.transport]);

  const listUSBPorts = useCallback(async () => {
      const ports = await safeInvoke<string[]>('usb_list_ports', undefined, { throwOnError: true });
      return ports || [];
  }, []);

  const sendPacket = useCallback(async (data: Uint8Array, timeoutMs: number = 2000, packets: number = 1): Promise<Uint8Array | null> => {
    if (!status.connected || !status.transport) return null;
    const args = { data: Array.from(data), timeoutMs, packets };

    if (status.transport === 'BLE') {
      const resp = await safeInvoke<number[]>('ble_send_command', args, { throwOnError: true });
      return resp ? new Uint8Array(resp) : null;
    }
    if (status.transport === 'USB') {
      const resp = await safeInvoke<number[]>('usb_send_command', args, { throwOnError: true });
      return resp ? new Uint8Array(resp) : null;
    }
    return null;
  }, [status.connected, status.transport]);

  const send = useCallback(async (commandString: string, timeoutMs: number = 2000, packets: number = 1): Promise<Uint8Array | null> => {
    const encoded = new TextEncoder().encode(commandString);
    return await sendPacket(encoded, timeoutMs, packets);
  }, [sendPacket]);

  const sendPacketNoWait = useCallback(async (data: Uint8Array) => {
    if (!status.connected || !status.transport) return;
    const args = { data: Array.from(data) };

    if (status.transport === 'BLE') {
      await safeInvoke('ble_send_packet', args, { throwOnError: true });
      return;
    }
    if (status.transport === 'USB') {
      await safeInvoke('usb_send_packet', args, { throwOnError: true });
    }
  }, [status.connected, status.transport]);

  const sendNoWait = useCallback(async (commandString: string) => {
    const encoded = new TextEncoder().encode(commandString);
    await sendPacketNoWait(encoded);
  }, [sendPacketNoWait]);

  const transmitBuffer = useCallback(async (data: Uint8Array) => {
    if (status.transport === 'BLE') {
        await safeInvoke('ble_transmit_buffer', { data: Array.from(data) }, { throwOnError: true });
    } else if (status.transport === 'USB') {
        await safeInvoke('usb_transmit_buffer', { data: Array.from(data) }, { throwOnError: true });
    }
  }, [status.transport]);

  const addNotificationListener = useCallback((listener: (data: Uint8Array, timestamp: number) => void) => {
    listenersRef.current.add(listener);
  }, []);

  const removeNotificationListener = useCallback((listener: (data: Uint8Array, timestamp: number) => void) => {
    listenersRef.current.delete(listener);
  }, []);

  const addTxListener = useCallback((listener: (data: Uint8Array, timestamp: number) => void) => {
    txListenersRef.current.add(listener);
  }, []);

  const removeTxListener = useCallback((listener: (data: Uint8Array, timestamp: number) => void) => {
    txListenersRef.current.delete(listener);
  }, []);

  return (
    <DeviceContext.Provider value={{
      status,
      connectUSB,
      connectBLE,
      disconnect,
      listUSBPorts,
      sendPacket,
      send,
      sendPacketNoWait,
      sendNoWait,
      transmitBuffer,
      addNotificationListener,
      removeNotificationListener,
      addTxListener,
      removeTxListener,
    }}>
      {children}
    </DeviceContext.Provider>
  );
};
