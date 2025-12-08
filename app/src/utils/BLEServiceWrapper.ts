/**
 * BLEServiceWrapper - Wrapper for BLE functionality to expose to wavelets
 */

import { safeInvoke } from './tauri';

export interface BLEServiceWrapper {
  sendCommand: (command: Uint8Array, timeout?: number) => Promise<Uint8Array | null>;
  isConnected: () => Promise<boolean>;
}

/**
 * Create a BLEService wrapper for use in WaveletEngine
 */
export function createBLEServiceWrapper(): BLEServiceWrapper {
  return {
    async sendCommand(command: Uint8Array, timeout: number = 5000): Promise<Uint8Array | null> {
      try {
        const result = await safeInvoke<number[]>("ble_send_packet_with_response", {
          data: Array.from(command),
          timeout,
        });
        
        if (result === null) {
          return null;
        }
        
        return new Uint8Array(result);
      } catch (error) {
        console.error("BLEService.sendCommand error:", error);
        return null;
      }
    },

    async isConnected(): Promise<boolean> {
      try {
        const status = await safeInvoke<{ connected: boolean }>("ble_get_status");
        return status?.connected ?? false;
      } catch {
        return false;
      }
    },
  };
}
