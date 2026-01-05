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
