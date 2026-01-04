/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { safeInvoke } from './tauri';

// Types
export type TransportType = 'USB' | 'MIDI';

interface DeviceStatus {
  connected: boolean;
  transport: TransportType | null;
  device_name: string | null;
  device_address: string | null;
}

interface DeviceContextType {
  status: DeviceStatus;
  connectUSB: (port: string) => Promise<void>;
  connectMIDI: (portName: string) => Promise<void>;
  disconnect: () => Promise<void>;
  listUSBPorts: () => Promise<string[]>;
  listMIDIPorts: () => Promise<string[]>;
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
    device_name: null,
    device_address: null,
  });

  const listenersRef = useRef<Set<(data: Uint8Array, timestamp: number) => void>>(new Set());
  const txListenersRef = useRef<Set<(data: Uint8Array, timestamp: number) => void>>(new Set());

  // Polling intervals
  const statusIntervalRef = useRef<number | null>(null);
  const initializedRef = useRef<boolean>(false);

  useEffect(() => {
    initializedRef.current = true;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("emwaver:device-initialized"));
    }
  }, []);

  // Poll Status
  useEffect(() => {
    const checkStatus = async () => {
      try {
        // Check USB status
        const usbStatus = await safeInvoke<{
          connected: boolean;
          device_path: string | null;
        }>('usb_get_status');

        if (usbStatus && usbStatus.connected) {
          const next: DeviceStatus = {
            connected: true,
            transport: 'USB',
            device_name: 'USB Device',
            device_address: usbStatus.device_path,
          };
          setStatus((prev) => (isSameStatus(prev, next) ? prev : next));
          return;
        }

        // Check MIDI status
        const midiStatus = await safeInvoke<{
          connected: boolean;
          device_name: string | null;
        }>('midi_get_status');

        if (midiStatus && midiStatus.connected) {
          const next: DeviceStatus = {
            connected: true,
            transport: 'MIDI',
            device_name: midiStatus.device_name,
            device_address: midiStatus.device_name,
          };
          setStatus((prev) => (isSameStatus(prev, next) ? prev : next));
          return;
        }

        // Nothing connected
        const next: DeviceStatus = {
          connected: false,
          transport: null,
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

  const connectUSB = useCallback(async (port: string) => {
    await safeInvoke('buffer_clear').catch(() => {});
    await safeInvoke('usb_connect', { portName: port }, { throwOnError: true });
  }, []);

  const connectMIDI = useCallback(async (portName: string) => {
    await safeInvoke('buffer_clear').catch(() => {});
    await safeInvoke('midi_connect', { portName }, { throwOnError: true });
  }, []);

  const disconnect = useCallback(async () => {
    if (status.transport === 'USB') {
        await safeInvoke('usb_disconnect');
    } else if (status.transport === 'MIDI') {
        await safeInvoke('midi_disconnect');
    }
  }, [status.transport]);

  const listUSBPorts = useCallback(async () => {
      const ports = await safeInvoke<string[]>('usb_list_ports', undefined, { throwOnError: true });
      return ports || [];
  }, []);

  const listMIDIPorts = useCallback(async () => {
      const ports = await safeInvoke<string[]>('midi_list_ports', undefined, { throwOnError: true });
      return ports || [];
  }, []);

  const sendPacket = useCallback(async (data: Uint8Array, timeoutMs: number = 2000, packets: number = 1): Promise<Uint8Array | null> => {
    if (!status.connected || !status.transport) return null;
    const args = { data: Array.from(data), timeoutMs, packets };
    const resp = await safeInvoke<number[]>('device_send_command', args, { throwOnError: true });
    return resp ? new Uint8Array(resp) : null;
  }, [status.connected, status.transport]);

  const send = useCallback(async (commandString: string, timeoutMs: number = 2000, packets: number = 1): Promise<Uint8Array | null> => {
    const encoded = new TextEncoder().encode(commandString);
    return await sendPacket(encoded, timeoutMs, packets);
  }, [sendPacket]);

  const sendPacketNoWait = useCallback(async (data: Uint8Array) => {
    if (!status.connected || !status.transport) return;
    const args = { data: Array.from(data) };
    await safeInvoke('device_write', args, { throwOnError: true });
  }, [status.connected, status.transport]);

  const sendNoWait = useCallback(async (commandString: string) => {
    const encoded = new TextEncoder().encode(commandString);
    await sendPacketNoWait(encoded);
  }, [sendPacketNoWait]);

  const transmitBuffer = useCallback(async (data: Uint8Array) => {
    if (!status.connected || !status.transport) return;
    await safeInvoke('device_transmit_buffer', { data: Array.from(data) }, { throwOnError: true });
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
      connectMIDI,
      disconnect,
      listUSBPorts,
      listMIDIPorts,
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
