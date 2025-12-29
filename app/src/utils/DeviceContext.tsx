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
  sendPacket: (data: Uint8Array, timeoutMs?: number, packets?: number) => Promise<Uint8Array | null>;
  send: (commandString: string, timeoutMs?: number, packets?: number) => Promise<Uint8Array | null>;
  transmitBuffer: (data: Uint8Array) => Promise<void>;
  // Event listeners
  addNotificationListener: (listener: (data: Uint8Array, timestamp: number) => void) => void;
  removeNotificationListener: (listener: (data: Uint8Array, timestamp: number) => void) => void;
  addTxListener: (listener: (data: Uint8Array, timestamp: number) => void) => void;
  removeTxListener: (listener: (data: Uint8Array, timestamp: number) => void) => void;
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
  const txListenersRef = useRef<Set<(data: Uint8Array, timestamp: number) => void>>(new Set());
  const pendingResponseRef = useRef<{ 
    resolve: (data: Uint8Array) => void;
    reject: (reason: any) => void;
    wantPackets: number;
    gotPackets: Uint8Array[];
  } | null>(null);
  const txPacketIndexRef = useRef<number>(0);

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
        // 0) TX log (for visualization)
        for (let i = 0; i < 10; i++) {
          const txResp = await safeInvoke<{
            data: number[];
            ts_ms: number[];
            next_packet_index: number;
            available_packets: number;
          }>(
            'buffer_read_tx_since',
            { packetIndex: txPacketIndexRef.current, maxPackets: 32 },
            { throwOnError: true },
          );
          if (!txResp || !txResp.data?.length || !txResp.ts_ms?.length) break;
          const packetCount = txResp.ts_ms.length;
          for (let p = 0; p < packetCount; p++) {
            const start = p * 64;
            const end = start + 64;
            const packet = new Uint8Array(txResp.data.slice(start, end));
            txListenersRef.current.forEach((listener) => listener(packet, txResp.ts_ms[p] ?? Date.now()));
          }
          txPacketIndexRef.current = txResp.next_packet_index ?? txPacketIndexRef.current + packetCount;
          break;
        }

        for (let i = 0; i < 10; i++) {
          const packet = await safeInvoke<{ data: number[]; ts_ms: number } | null>(
            'buffer_next_packet',
            undefined,
            { throwOnError: true },
          );
          if (!packet?.data?.length) break;
          const chunk = new Uint8Array(packet.data);
          const timestamp = packet.ts_ms ?? Date.now();

          // 1) Resolve a pending request with the next 64-byte packet (synchronous model).
          if (pendingResponseRef.current) {
            pendingResponseRef.current.gotPackets.push(chunk);
            if (pendingResponseRef.current.gotPackets.length >= pendingResponseRef.current.wantPackets) {
              const totalLen = pendingResponseRef.current.gotPackets.reduce((sum, p) => sum + p.length, 0);
              const out = new Uint8Array(totalLen);
              let offset = 0;
              for (const pkt of pendingResponseRef.current.gotPackets) {
                out.set(pkt, offset);
                offset += pkt.length;
              }
              pendingResponseRef.current.resolve(out);
              pendingResponseRef.current = null;
            }
          }

          // 2) Broadcast raw bytes (binary-safe) to all listeners.
          listenersRef.current.forEach((listener) => listener(chunk, timestamp));
        }
      } catch (e) {
        console.error("Notification poll error", e);
      }
    };

    notificationIntervalRef.current = window.setInterval(processNotification, 5);
    return () => {
      if (notificationIntervalRef.current) clearInterval(notificationIntervalRef.current);
    };
  }, [status.connected, status.transport]);

  useEffect(() => {
    if (!status.connected) {
      pendingResponseRef.current = null;
      void safeInvoke<void>('buffer_set_counter', { value: 0 }).catch(() => {});
      txPacketIndexRef.current = 0;
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

  const sendCommand = useCallback(async (data: Uint8Array) => {
    if (status.transport === 'BLE') {
        await safeInvoke('ble_send_packet', { data: Array.from(data) }, { throwOnError: true });
    } else if (status.transport === 'USB') {
        await safeInvoke('usb_send_packet', { data: Array.from(data) }, { throwOnError: true });
    }
  }, [status.transport]);

  const sendPacket = useCallback(async (data: Uint8Array, timeoutMs: number = 2000, packets: number = 1): Promise<Uint8Array | null> => {
    if (!status.connected) return null;
    if (pendingResponseRef.current) {
      console.warn("sendPacket called while another command is pending");
      return null;
    }

    const wantPackets = Math.max(1, Math.floor(packets || 1));

    const responsePromise = new Promise<Uint8Array | null>((resolve) => {
      const timeoutId = setTimeout(() => {
        if (pendingResponseRef.current) {
          pendingResponseRef.current = null;
          resolve(null);
        }
      }, timeoutMs);

      pendingResponseRef.current = {
        resolve: (payload) => {
          clearTimeout(timeoutId);
          resolve(payload);
        },
        reject: (_err) => {
          clearTimeout(timeoutId);
          resolve(null);
        },
        wantPackets,
        gotPackets: [],
      };
    });

    await sendCommand(data);
    return await responsePromise;
  }, [sendCommand, status.connected]);

  const send = useCallback(async (commandString: string, timeoutMs: number = 2000, packets: number = 1): Promise<Uint8Array | null> => {
    const encoded = new TextEncoder().encode(commandString);
    return await sendPacket(encoded, timeoutMs, packets);
  }, [sendPacket]);

  const transmitBuffer = useCallback(async (data: Uint8Array) => {
    if (status.transport === 'BLE') {
        await safeInvoke('ble_transmit_buffer', { data: Array.from(data) }, { throwOnError: true });
    } else if (status.transport === 'USB') {
        // For USB, we can just send the packet for now, or implement specific flow control if needed.
        // The firmware likely expects the same streaming behavior.
        // For now, mapping to usb_send_packet.
        await safeInvoke('usb_send_packet', { data: Array.from(data) }, { throwOnError: true });
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
