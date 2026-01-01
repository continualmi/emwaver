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

package com.emwaver.emwaverandroidapp;

/**
 * Common interface for device connection services (BLE and USB).
 * This interface provides a unified API for communicating with EMWaver devices
 * regardless of the connection type.
 */
public interface DeviceConnectionService {
    
    /**
     * Connection type enumeration
     */
    enum ConnectionType {
        BLE,
        USB,
        NONE
    }
    
    /**
     * Write data to the device
     * @param bytes Data to write
     */
    void write(byte[] bytes);
    
    /**
     * Send a command and wait for response
     * @param command Command bytes to send
     * @param timeout Timeout in milliseconds
     * @return Response bytes, or null if timeout or error
     */
    byte[] sendCommand(byte[] command, int timeout);
    
    /**
     * Send a packet to the device (fire and forget)
     * @param data Packet data to send
     */
    void sendPacket(byte[] data);
    
    /**
     * Check if device is currently connected
     * @return true if connected, false otherwise
     */
    boolean checkConnection();

    /**
     * Transmit the buffer to the device
     */
    void transmitBuffer();
    
    /**
     * Clear the receive buffer
     */
    void clearBuffer();
    
    /**
     * Get the current buffer length
     * @return Buffer length in bytes
     */
    int getBufferLength();
    
    /**
     * Load data into the buffer
     * @param data Data to load
     */
    void loadBuffer(byte[] data);
    
    /**
     * Get the current buffer contents
     * @return Buffer contents as byte array
     */
    byte[] getBuffer();
    
    /**
     * Compress data bits for sampler visualization
     * @param rangeStart Start index
     * @param rangeEnd End index
     * @param numberBins Number of bins
     * @return Compressed data array
     */
    Object[] compressDataBits(int rangeStart, int rangeEnd, int numberBins);
    
    /**
     * Get the current connection type
     * @return ConnectionType enum value
     */
    ConnectionType getConnectionType();
    
    /**
     * Get connection status string for UI display
     * @return Status string
     */
    String getConnectionStatus();
    
    /**
     * Disconnect from the device
     */
    void disconnect();
}
