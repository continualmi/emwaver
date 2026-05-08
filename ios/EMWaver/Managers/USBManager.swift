/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation
import CoreBluetooth
import CoreMIDI
import SwiftUI
import os

struct SamplerLanePolicy {
    enum EmwOpcode {
        static let sample: UInt8 = 0x60
        static let sampleStart: UInt8 = 0x00
        static let sampleStop: UInt8 = 0x01
    }

    let shouldStoreCommandLane: Bool
    let shouldStoreStreamLane: Bool
    let nextSamplerStreamingActive: Bool

    static func forOutgoingPacket(_ data: Data, samplerStreamingActive: Bool) -> SamplerLanePolicy {
        var nextSamplerStreamingActive = samplerStreamingActive

        if data.count >= 2, data[data.startIndex] == EmwOpcode.sample {
            let subOpcode = data[data.startIndex.advanced(by: 1)]
            if subOpcode == EmwOpcode.sampleStart {
                nextSamplerStreamingActive = true
            } else if subOpcode == EmwOpcode.sampleStop {
                nextSamplerStreamingActive = false
            }
        }

        return SamplerLanePolicy(
            shouldStoreCommandLane: false,
            shouldStoreStreamLane: false,
            nextSamplerStreamingActive: nextSamplerStreamingActive
        )
    }

    static func forIncomingSuperframe(
        commandLane: Data,
        streamLane: Data,
        samplerStreamingActive: Bool
    ) -> SamplerLanePolicy {
        let commandEmpty = commandLane.allSatisfy { $0 == 0 }
        let streamEmpty = streamLane.allSatisfy { $0 == 0 }

        return SamplerLanePolicy(
            shouldStoreCommandLane: !commandEmpty,
            shouldStoreStreamLane: !streamEmpty || samplerStreamingActive,
            nextSamplerStreamingActive: samplerStreamingActive
        )
    }
}

/// NOTE: Despite the historical name, this is now a **USB MIDI (CoreMIDI)** transport.
/// We keep the `USBManager` API surface to minimize churn across the iOS codebase.
final class USBManager: NSObject, ObservableObject {
    // Mini-frame: 18B cmd lane + 18B stream lane.
    private static let laneSizeBytes: Int = 18
    private static let superframeSizeBytes: Int = 36
    
    // Legacy constant alias for code using it (usually referring to the lane/packet size)
    private static let packetSizeBytes: Int = 18
    
    private static let log = Logger(subsystem: "com.emwaver", category: "device-transport")

    private static let bleServiceUUID = CBUUID(string: "45C7158E-0C3B-4E90-A847-452A15B14191")
    private static let bleCommandCharacteristicUUID = CBUUID(string: "46C7158E-0C3B-4E90-A847-452A15B14191")
    private static let bleNotifyCharacteristicUUID = CBUUID(string: "47C7158E-0C3B-4E90-A847-452A15B14191")

    private enum ActiveTransport {
        case none
        case usbMidi
        case ble
    }

    private func dbg(_ msg: String) {
        #if DEBUG
        // Both: `print` always shows in Xcode debug console; Logger integrates with Console.app.
        print("[USBMIDI] \(msg)")
        Self.log.info("\(msg, privacy: .public)")
        #endif
    }

    struct ReadPackets {
        let data: [UInt8]
        let ts_ms: [UInt64]
        let next_packet_index: UInt64
        let available_packets: UInt64
    }

    // MARK: - Published Properties

    @Published var isConnected = false
    @Published var isScanning = false
    @Published var bufferVersion: Int = 0

    @Published var connectedPortName: String? = nil
    @Published var availablePorts: [String] = []
    @Published var lastErrorText: String? = nil
    @Published var selfTestStatus: String = ""

    // MARK: - MIDI plumbing

    private let midiQueue = DispatchQueue(label: "com.emwaver.midi", qos: .userInitiated)
    private let bufferQueue = DispatchQueue(label: "com.emwaver.bufferQueue")
    private let bufferQueueKey = DispatchSpecificKey<Void>()
    private var activeBufferSession: TransportDeviceSession = DeviceBufferSession()
    private var bufferSessionsByDeviceId: [String: TransportDeviceSession] = [:]
    private var activeBufferSessionKey = "active"

    private var client: MIDIClientRef = 0
    private var inPort: MIDIPortRef = 0
    private var outPort: MIDIPortRef = 0

    private var connectedSource: MIDIEndpointRef = 0
    private var connectedDestination: MIDIEndpointRef = 0

    private var virtualDestination: MIDIEndpointRef = 0

    // MARK: - BLE plumbing

    private var centralManager: CBCentralManager?
    private var activeTransport: ActiveTransport = .none
    private var connectedPeripheral: CBPeripheral?
    private var commandCharacteristic: CBCharacteristic?
    private var notifyCharacteristic: CBCharacteristic?

    // Variables for speed calculation
    private var totalBytesReceived: Int = 0
    private var firstPacketTimeMillis: TimeInterval = 0
    private var lastPacketReceivedTime: TimeInterval = 0

    // MARK: - Init

    override
    init() {
        bufferQueue.setSpecific(key: bufferQueueKey, value: ())
        super.init()
        dbg("USBManager init")
        midiQueue.async {
            self.ensureClient()
            self.ensureBleCentral()
            self.refreshPortsInternal()
        }
    }

    private func withBufferQueueSync<T>(_ block: () -> T) -> T {
        if DispatchQueue.getSpecific(key: bufferQueueKey) != nil {
            return block()
        }
        return bufferQueue.sync(execute: block)
    }

    private func setActiveBufferSession(deviceId: String) {
        let key = deviceId.trimmingCharacters(in: .whitespacesAndNewlines)
        withBufferQueueSync {
            let sessionKey = key.isEmpty ? "active" : key
            let session = bufferSessionsByDeviceId[sessionKey] ?? DeviceBufferSession()
            bufferSessionsByDeviceId[sessionKey] = session
            activeBufferSession = session
            activeBufferSessionKey = sessionKey
            activeBufferSession.clearAll()
        }
    }

    func currentScriptDeviceId() -> String {
        withBufferQueueSync { activeBufferSessionKey }
    }

    private func bufferSession(deviceId: String) -> TransportDeviceSession {
        let key = deviceId.trimmingCharacters(in: .whitespacesAndNewlines)
        let sessionKey = key.isEmpty ? "active" : key
        if let session = bufferSessionsByDeviceId[sessionKey] {
            return session
        }
        let session = DeviceBufferSession()
        bufferSessionsByDeviceId[sessionKey] = session
        return session
    }

    // MARK: - Common helpers (used across the iOS codebase)

    static func isPaddedOkFrame(_ data: Data) -> Bool {
        guard data.count == packetSizeBytes else { return false }
        return data.allSatisfy { $0 == 0x00 }
    }

    static func isPaddedErrFrame(_ data: Data) -> Bool {
        guard data.count == packetSizeBytes else { return false }
        guard data.first == 0xFF else { return false }
        return data.dropFirst().allSatisfy { $0 == 0x00 }
    }

    static func dataToHexString(_ data: Data) -> String {
        data.map { String(format: "%02X ", $0) }.joined().trimmingCharacters(in: .whitespaces)
    }

    static func dataToAsciiString(_ data: Data) -> String {
        data.map { byte in
            if (32...126).contains(Int(byte)) { return String(UnicodeScalar(byte)) }
            return "."
        }.joined()
    }

    static func hexStringToData(_ hexString: String) -> Data? {
        let hex = hexString.replacingOccurrences(of: "[^0-9A-Fa-f]", with: "", options: .regularExpression)
        guard hex.count % 2 == 0 else { return nil }

        var data = Data()
        var index = hex.startIndex
        while index < hex.endIndex {
            let byteString = hex[index..<hex.index(index, offsetBy: 2)]
            guard let byte = UInt8(byteString, radix: 16) else { return nil }
            data.append(byte)
            index = hex.index(index, offsetBy: 2)
        }
        return data
    }

    static func parseCommand(_ input: String) -> Data? {
        var byteArray = [UInt8]()

        if input.contains("[") && input.contains("]") {
            var currentIndex = input.startIndex

            while currentIndex < input.endIndex {
                if let openingBracket = input[currentIndex...].firstIndex(of: "[") {
                    if openingBracket > currentIndex {
                        let asciiPart = String(input[currentIndex..<openingBracket])
                        byteArray.append(contentsOf: asciiPart.utf8)
                    }

                    if let closingBracket = input[openingBracket...].firstIndex(of: "]") {
                        let startIndex = input.index(after: openingBracket)
                        let bracketContent = String(input[startIndex..<closingBracket]).trimmingCharacters(in: .whitespaces)

                        if bracketContent.lowercased().hasPrefix("0x") {
                            let hexValue = String(bracketContent.dropFirst(2))
                            guard let byteValue = UInt8(hexValue, radix: 16) else { return nil }
                            byteArray.append(byteValue)
                        } else if let decimalValue = UInt8(bracketContent) {
                            byteArray.append(decimalValue)
                        } else {
                            return nil
                        }

                        currentIndex = input.index(after: closingBracket)
                    } else {
                        return nil
                    }
                } else {
                    let restOfString = String(input[currentIndex...])
                    byteArray.append(contentsOf: restOfString.utf8)
                    break
                }
            }
        } else {
            byteArray.append(contentsOf: input.utf8)
        }

        return Data(byteArray)
    }

    static func frameAsciiCommand(_ command: String) -> Data {
        var framed = command
        if !framed.hasSuffix("\n") {
            framed += "\n"
        }
        return Data(framed.utf8)
    }

    // MARK: - Connection

    func refreshPorts() {
        midiQueue.async {
            self.ensureClient()
            self.refreshPortsInternal()
        }
    }

    func startScan() {
        midiQueue.async {
            self.ensureClient()
            self.ensureBleCentral()
            DispatchQueue.main.async { self.isScanning = true }

            self.refreshPortsInternal()

            // Auto-connect immediately; `availablePorts` updates on the main queue and may lag.
            if !self.connectToFirstPortInternal() {
                self.startBleScanInternal()
            }

            DispatchQueue.main.async { self.isScanning = false }
        }
    }

    func stopScan() {
        midiQueue.async {
            self.centralManager?.stopScan()
            DispatchQueue.main.async { self.isScanning = false }
        }
    }

    func disconnect() {
        midiQueue.async {
            self.disconnectInternal()
        }
    }

    // MARK: - Transport (TX/RX)

    /// Best-effort variant of `sendCommand` used for non-critical background checks (e.g. secure identity).
    /// Never touches `lastErrorText`.
    private func sendCommandBestEffort(_ command: Data, timeout: Int) -> Data? {
        // Avoid depending on the @Published `isConnected` flag here; it may lag behind CoreMIDI state.
        guard activeTransport == .ble || connectedDestination != 0 else { return nil }

        let session = withBufferQueueSync {
            activeBufferSession.prepareCommandResponseWait()
            return activeBufferSession
        }

        // Send synchronously to avoid racing the RX wait-loop.
        sendPacketBestEffortSync(command)

        return session.awaitCommandResponse(timeout: timeout) {
            activeTransport == .ble || connectedDestination != 0
        }
    }

    private func sendPacketBestEffortSync(_ data: Data) {
        guard activeTransport == .ble || connectedDestination != 0 else { return }

        // Ensure we send on the MIDI queue, but synchronously for determinism.
        midiQueue.sync {
            guard self.activeTransport == .ble || self.connectedDestination != 0 else { return }
            guard let packet64 = self.withBufferQueueSync({ NativeBufferRust.makePacket64(data) }) else { return }

            self.withBufferQueueSync {
                self.activeBufferSession.appendTxBytes(packet64, tsMs: Self.nowMs())
            }
            DispatchQueue.main.async { self.bufferVersion += 1 }

            let sf = self.makeSuperframe(cmdLane: packet64, streamLane: nil)
            self.sendSuperframeBestEffort(sf)
        }
    }

    private func makeSuperframe(cmdLane: Data?, streamLane: Data?) -> Data {
        var sf = Data(repeating: 0, count: Self.superframeSizeBytes)
        
        if let c = cmdLane {
            let len = min(c.count, Self.laneSizeBytes)
            if len > 0 {
                sf.replaceSubrange(0..<len, with: c.prefix(len))
            }
        }
        
        if let s = streamLane {
            let len = min(s.count, Self.laneSizeBytes)
            if len > 0 {
                sf.replaceSubrange(Self.laneSizeBytes..<(Self.laneSizeBytes + len), with: s.prefix(len))
            }
        }
        
        return sf
    }
    
    private func sendSuperframe(_ superframe: Data) {
        guard let sysex = UsbMidiSysex.encodeSuperframe(superframe) else {
            setError("Cannot send packet: SysEx encode failed")
            return
        }

        switch activeTransport {
        case .usbMidi:
            let st = sendSysex(sysex, to: connectedDestination)
            if st != noErr {
                setError("MIDISend failed: \(st)")
            }
        case .ble:
            sendBleSysex(sysex, reportErrors: true)
        case .none:
            setError("Cannot send packet: Not connected")
        }
    }

    /// Best-effort send that never updates `lastErrorText`.
    private func sendSuperframeBestEffort(_ superframe: Data) {
        guard activeTransport == .ble || connectedDestination != 0 else { return }
        guard let sysex = UsbMidiSysex.encodeSuperframe(superframe) else { return }
        if activeTransport == .ble {
            sendBleSysex(sysex, reportErrors: false)
        } else {
            _ = sendSysex(sysex, to: connectedDestination)
        }
    }

    @objc func sendPacket(_ data: Data) {
        midiQueue.async {
            guard self.isConnected, self.activeTransport == .ble || self.connectedDestination != 0 else {
                self.setError("Cannot send packet: Not connected")
                return
            }

            guard let packet64 = self.withBufferQueueSync({ NativeBufferRust.makePacket64(data) }) else {
                self.setError("Cannot send packet: too large (\(data.count) bytes, max \(Self.packetSizeBytes))")
                return
            }

            _ = self.withBufferQueueSync { self.activeBufferSession.outgoingSamplerPolicy(for: data) }
            
            // Log command lane transmission
            self.withBufferQueueSync {
                self.activeBufferSession.appendTxBytes(packet64, tsMs: Self.nowMs())
            }
            DispatchQueue.main.async { self.bufferVersion += 1 }

            // Create superframe with Command Lane populated
            let sf = self.makeSuperframe(cmdLane: packet64, streamLane: nil)
            self.sendSuperframe(sf)
        }
    }

    func sendPacket(_ data: Data, deviceId: String) {
        midiQueue.async {
            guard self.isConnected, self.activeTransport == .ble || self.connectedDestination != 0 else {
                self.setError("Cannot send packet: Not connected")
                return
            }

            guard let packet64 = self.withBufferQueueSync({ NativeBufferRust.makePacket64(data) }) else {
                self.setError("Cannot send packet: too large (\(data.count) bytes, max \(Self.packetSizeBytes))")
                return
            }

            self.withBufferQueueSync {
                let session = self.bufferSession(deviceId: deviceId)
                _ = session.outgoingSamplerPolicy(for: data)
                session.appendTxBytes(packet64, tsMs: Self.nowMs())
            }
            DispatchQueue.main.async { self.bufferVersion += 1 }

            let sf = self.makeSuperframe(cmdLane: packet64, streamLane: nil)
            self.sendSuperframe(sf)
        }
    }

    // MARK: - Buffer Monitor APIs (non-destructive)

    func bufferClear() {
        clearBuffer()
    }

    func bufferReadPacketsSince(packetIndex: UInt64, maxPackets: Int) -> ReadPackets {
        withBufferQueueSync {
            let rp = activeBufferSession.readRxSince(packetIndex: packetIndex, maxPackets: maxPackets)
            return ReadPackets(data: rp.data, ts_ms: rp.ts_ms, next_packet_index: rp.next_packet_index, available_packets: rp.available_packets)
        }
    }

    func bufferReadTxSince(packetIndex: UInt64, maxPackets: Int) -> ReadPackets {
        withBufferQueueSync {
            let rp = activeBufferSession.readTxSince(packetIndex: packetIndex, maxPackets: maxPackets)
            return ReadPackets(data: rp.data, ts_ms: rp.ts_ms, next_packet_index: rp.next_packet_index, available_packets: rp.available_packets)
        }
    }

    func bufferGetPacketCount() -> UInt64 {
        withBufferQueueSync { activeBufferSession.getRxPacketCount() }
    }

    func bufferGetTxPacketCount() -> UInt64 {
        withBufferQueueSync { activeBufferSession.getTxPacketCount() }
    }

    struct BufferPacket {
        let data: [UInt8]
        let ts_ms: UInt64
    }

    func bufferNextRxPacket() -> BufferPacket? {
        withBufferQueueSync {
            guard let pkt = activeBufferSession.nextRxPacket() else { return nil }
            return BufferPacket(data: Array(pkt.packet64), ts_ms: pkt.tsMs)
        }
    }

    func bufferGetRxCounter() -> UInt64 {
        withBufferQueueSync { activeBufferSession.getRxCounter() }
    }

    func bufferSetRxCounter(_ value: UInt64) {
        withBufferQueueSync { activeBufferSession.setRxCounter(value) }
    }

    struct BufferMonitorEntry: Identifiable {
        let id: String
        let data: [UInt8]
        let ts_ms: UInt64
        let isTx: Bool
        let packetIndex: UInt64
    }

    func bufferMonitorEntries(limit: Int) -> [BufferMonitorEntry] {
        guard limit > 0 else { return [] }
        return withBufferQueueSync {
            let maxPackets = min(limit, 1500)

            let txCount = activeBufferSession.getTxPacketCount()
            let rxCount = activeBufferSession.getRxPacketCount()

            let txStart = txCount > UInt64(maxPackets) ? (txCount - UInt64(maxPackets)) : 0
            let rxStart = rxCount > UInt64(maxPackets) ? (rxCount - UInt64(maxPackets)) : 0

            let txRust = activeBufferSession.readTxSince(packetIndex: txStart, maxPackets: maxPackets)
            let rxRust = activeBufferSession.readRxSince(packetIndex: rxStart, maxPackets: maxPackets)
            let tx = ReadPackets(data: txRust.data, ts_ms: txRust.ts_ms, next_packet_index: txRust.next_packet_index, available_packets: txRust.available_packets)
            let rx = ReadPackets(data: rxRust.data, ts_ms: rxRust.ts_ms, next_packet_index: rxRust.next_packet_index, available_packets: rxRust.available_packets)

            var out: [BufferMonitorEntry] = []
            out.reserveCapacity(tx.ts_ms.count + rx.ts_ms.count)

            for i in 0..<tx.ts_ms.count {
                let start = i * Self.packetSizeBytes
                let end = start + Self.packetSizeBytes
                if end <= tx.data.count {
                    let pkt = Array(tx.data[start..<end])
                    let idx = txStart + UInt64(i)
                    out.append(BufferMonitorEntry(id: "tx:\(idx)", data: pkt, ts_ms: tx.ts_ms[i], isTx: true, packetIndex: idx))
                }
            }

            for i in 0..<rx.ts_ms.count {
                let start = i * Self.packetSizeBytes
                let end = start + Self.packetSizeBytes
                if end <= rx.data.count {
                    let pkt = Array(rx.data[start..<end])
                    let idx = rxStart + UInt64(i)
                    out.append(BufferMonitorEntry(id: "rx:\(idx)", data: pkt, ts_ms: rx.ts_ms[i], isTx: false, packetIndex: idx))
                }
            }

            out.sort {
                if $0.ts_ms != $1.ts_ms { return $0.ts_ms < $1.ts_ms }
                if $0.isTx != $1.isTx { return $0.isTx && !$1.isTx }
                return $0.packetIndex < $1.packetIndex
            }

            if out.count > limit {
                return Array(out.suffix(limit))
            }
            return out
        }
    }

    // MARK: - Buffer Operations

    @objc func clearBuffer() {
        withBufferQueueSync { activeBufferSession.clearAll() }
        DispatchQueue.main.async {
            self.bufferVersion += 1
        }
    }

    func clearBuffer(deviceId: String) {
        withBufferQueueSync { bufferSession(deviceId: deviceId).clearAll() }
        DispatchQueue.main.async {
            self.bufferVersion += 1
        }
    }

    // setInvertRx removed (legacy)

    func storeBulkPkt(_ data: Data) {
        withBufferQueueSync {
            activeBufferSession.storeBulkPkt(data, tsMs: Self.nowMs())
        }
        DispatchQueue.main.async {
            self.bufferVersion += 1
        }

        let currentTime = Date().timeIntervalSince1970
        lastPacketReceivedTime = currentTime
        if totalBytesReceived == 0 {
            firstPacketTimeMillis = currentTime
        }
        totalBytesReceived += data.count
    }

    @objc func loadBuffer(data: Data) {
        withBufferQueueSync { activeBufferSession.loadBuffer(data) }
        DispatchQueue.main.async {
            self.bufferVersion += 1
        }
        totalBytesReceived = data.count
        firstPacketTimeMillis = Date().timeIntervalSince1970
        lastPacketReceivedTime = firstPacketTimeMillis
    }

    func loadBuffer(data: Data, deviceId: String) {
        withBufferQueueSync { bufferSession(deviceId: deviceId).loadBuffer(data) }
        DispatchQueue.main.async {
            self.bufferVersion += 1
        }
    }

    @objc func getBuffer() -> Data {
        withBufferQueueSync { activeBufferSession.getBuffer() }
    }

    func getBuffer(deviceId: String) -> Data {
        withBufferQueueSync { bufferSession(deviceId: deviceId).getBuffer() }
    }

    func getReceptionSpeedBps() -> Double {
        if totalBytesReceived == 0 || firstPacketTimeMillis == 0 {
            return 0.0
        }
        let currentTime = Date().timeIntervalSince1970
        let elapsedTimeSeconds = currentTime - firstPacketTimeMillis
        if elapsedTimeSeconds <= 0 {
            return 0.0
        }
        return Double(totalBytesReceived * 8) / elapsedTimeSeconds
    }

    func compressDataBits(rangeStart: Int, rangeEnd: Int, numberBins: Int) -> ([Float], [Float]) {
        withBufferQueueSync { activeBufferSession.compressDataBits(rangeStart: rangeStart, rangeEnd: rangeEnd, numberBins: numberBins) }
    }

    /// Transmits the current buffer content to the connected device.
    /// For USB MIDI we always send fixed 18B lane packets (SysEx-tunneled mini-frames).
    @objc func transmitBuffer() {
        guard isConnected else {
            setError("Cannot transmit buffer: Not connected")
            return
        }

        let bufferToSend = getBuffer()
        guard !bufferToSend.isEmpty else { return }

        let saved = withBufferQueueSync {
            let saved = activeBufferSession.takeRxState()
            activeBufferSession.setRxCounter(0)
            return saved
        }
        DispatchQueue.main.async { self.bufferVersion += 1 }

        let profile = withBufferQueueSync { NativeBufferRust.txProfile() }
        let fixedDelayMs = Double(profile.fixed_delay_ms)

        let totalBytesToSend = bufferToSend.count
        var currentPacketSize = Int(profile.max_packet_size)
        var lastStatus = Int(profile.target_buffer_level)

        var bytesSent = 0
        while bytesSent < totalBytesToSend {
            while let next = withBufferQueueSync({ activeBufferSession.nextRxPacket() }) {
                let status = withBufferQueueSync { NativeBufferRust.parseBsStatus(next.packet64) }
                if status >= 0 { lastStatus = status }
            }

            currentPacketSize = withBufferQueueSync {
                NativeBufferRust.txNextPacketSize(bytesSent: bytesSent, lastStatus: lastStatus, currentPacketSize: currentPacketSize)
            }

            let remainingBytes = totalBytesToSend - bytesSent
            let packetSize = min(currentPacketSize, remainingBytes)
            let endRange = bytesSent + packetSize
            let chunk = bufferToSend.subdata(in: bytesSent..<endRange)

            // Construct and send as Stream Lane
            midiQueue.async {
                guard let packet64 = self.withBufferQueueSync({ NativeBufferRust.makePacket64(chunk) }) else { return }
                
                // Log stream lane transmission
                self.withBufferQueueSync {
                    self.activeBufferSession.appendTxBytes(packet64, tsMs: Self.nowMs())
                }
                
                let sf = self.makeSuperframe(cmdLane: nil, streamLane: packet64)
                self.sendSuperframe(sf)
            }

            bytesSent = endRange
            Thread.sleep(forTimeInterval: fixedDelayMs / 1000.0)
        }

        Thread.sleep(forTimeInterval: 0.1)

        withBufferQueueSync {
            activeBufferSession.restoreRxState(rxBytes: saved.rxBytes, rxTsMs: saved.rxTsMs, rxCounter: saved.rxCounter)
        }
        DispatchQueue.main.async { self.bufferVersion += 1 }
    }

    // Send a command and wait for response
    @objc func sendCommand(_ command: Data, timeout: Int) -> Data? {
        guard isConnected else {
            setError("Cannot send command: Not connected")
            return nil
        }

        let session = withBufferQueueSync {
            activeBufferSession.prepareCommandResponseWait()
            return activeBufferSession
        }

        sendPacket(command)

        return session.awaitCommandResponse(timeout: timeout) {
            isConnected
        }
    }

    func sendCommand(_ command: Data, timeout: Int, deviceId: String) -> Data? {
        guard isConnected else {
            setError("Cannot send command: Not connected")
            return nil
        }

        let session = withBufferQueueSync {
            let session = bufferSession(deviceId: deviceId)
            session.prepareCommandResponseWait()
            return session
        }

        sendPacket(command, deviceId: deviceId)

        return session.awaitCommandResponse(timeout: timeout) {
            isConnected
        }
    }

    // MARK: - Self-test (no adapter)

    func runVirtualLoopbackSelfTest() {
        midiQueue.async {
            self.ensureClient()

            if self.virtualDestination == 0 {
                let st = MIDIDestinationCreate(
                    self.client,
                    "EMWaver Virtual Dest" as CFString,
                    Self.readProc,
                    UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque()),
                    &self.virtualDestination
                )
                if st != noErr {
                    self.setError("MIDIDestinationCreate failed: \(st)")
                    return
                }
            }

            self.withBufferQueueSync { self.activeBufferSession.clearAll() }
            DispatchQueue.main.async { self.bufferVersion += 1 }

            let test = Data((0..<64).map { UInt8($0 & 0xFF) })
            // Create superframe for test
            let sf = self.makeSuperframe(cmdLane: test, streamLane: nil)
            guard let sysex = UsbMidiSysex.encodeSuperframe(sf) else {
                self.setError("Self-test: failed to encode")
                return
            }

            let st = self.sendSysex(sysex, to: self.virtualDestination)
            if st != noErr {
                self.setError("Self-test: MIDISend failed: \(st)")
                return
            }

            Thread.sleep(forTimeInterval: 0.2)

            let got = self.withBufferQueueSync { self.activeBufferSession.getRxPacketCount() }
            DispatchQueue.main.async {
                self.selfTestStatus = got > 0 ? "OK (received \(got) packet)" : "FAILED (no packet received)"
            }
        }
    }

    // MARK: - CoreMIDI internals

    private func ensureClient() {
        if client != 0 { return }
        dbg("ensureClient: creating CoreMIDI client/ports")

        let stClient = MIDIClientCreate(
            "emwaver-midi" as CFString,
            Self.notifyProc,
            UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque()),
            &client
        )
        guard stClient == noErr else {
            setError("MIDIClientCreate failed: \(stClient)")
            return
        }

        let stIn = MIDIInputPortCreate(
            client,
            "emwaver-midi-in" as CFString,
            Self.readProc,
            UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque()),
            &inPort
        )
        guard stIn == noErr else {
            setError("MIDIInputPortCreate failed: \(stIn)")
            return
        }

        let stOut = MIDIOutputPortCreate(client, "emwaver-midi-out" as CFString, &outPort)
        guard stOut == noErr else {
            setError("MIDIOutputPortCreate failed: \(stOut)")
            return
        }
    }

    private struct PortCandidate {
        let name: String
        let source: MIDIEndpointRef
        let destination: MIDIEndpointRef
    }

    private func refreshPortsInternal() {
        let candidates = listPortCandidatesInternal()
        let ports = candidates.map { $0.name }
        dbg("refreshPorts: candidates=\(ports)")
        DispatchQueue.main.async {
            self.availablePorts = ports
        }
    }

    @discardableResult
    private func connectToFirstPortInternal() -> Bool {
        let candidates = listPortCandidatesInternal()
        let chosen = candidates.first(where: { $0.name.localizedCaseInsensitiveContains("emwaver") })
            ?? candidates.first(where: { !$0.name.localizedCaseInsensitiveContains("network") })
            ?? candidates.first
        guard let chosen else {
            dbg("connect: no port candidates")
            return false
        }
        dbg("connect: chosen=\(chosen.name)")

        disconnectInternal()
        centralManager?.stopScan()

        connectedSource = chosen.source
        connectedDestination = chosen.destination
        setActiveBufferSession(deviceId: "usbmidi:\(chosen.source):\(chosen.destination):\(chosen.name)")

        let st = MIDIPortConnectSource(inPort, chosen.source, nil)
        guard st == noErr else {
            setError("MIDIPortConnectSource failed: \(st)")
            connectedSource = 0
            connectedDestination = 0
            return false
        }

        activeTransport = .usbMidi
        DispatchQueue.main.async {
            self.connectedPortName = chosen.name
            self.isConnected = true
            self.lastErrorText = nil
        }
        return true
    }

    private func disconnectInternal() {
        if connectedSource != 0 {
            _ = MIDIPortDisconnectSource(inPort, connectedSource)
        }
        if let peripheral = connectedPeripheral {
            centralManager?.cancelPeripheralConnection(peripheral)
        }
        connectedSource = 0
        connectedDestination = 0
        connectedPeripheral = nil
        commandCharacteristic = nil
        notifyCharacteristic = nil
        activeTransport = .none
        withBufferQueueSync { activeBufferSession.resetSamplerStreaming() }

        DispatchQueue.main.async {
            self.isConnected = false
            self.connectedPortName = nil
        }
    }

    private func listPortCandidatesInternal() -> [PortCandidate] {
        let sources = allSources()
        let dests = allDestinations()

        var out: [PortCandidate] = []
        for d in dests {
            let dEntity = entityName(for: d.endpoint)
            if let s = sources.first(where: { entityName(for: $0.endpoint) == dEntity }) {
                out.append(PortCandidate(name: dEntity ?? d.name, source: s.endpoint, destination: d.endpoint))
            }
        }

        if out.isEmpty {
            let common = Set(sources.map { $0.name }).intersection(Set(dests.map { $0.name }))
            for name in common.sorted() {
                if let s = sources.first(where: { $0.name == name }), let d = dests.first(where: { $0.name == name }) {
                    out.append(PortCandidate(name: name, source: s.endpoint, destination: d.endpoint))
                }
            }
        }

        return out
    }

    private func allSources() -> [(name: String, endpoint: MIDIEndpointRef)] {
        var out: [(String, MIDIEndpointRef)] = []
        let n = MIDIGetNumberOfSources()
        out.reserveCapacity(Int(n))
        for i in 0..<n {
            let ep = MIDIGetSource(i)
            if ep != 0, !isOffline(MIDIObjectRef(ep)) { out.append((endpointDisplayName(ep), ep)) }
        }
        return out
    }

    private func allDestinations() -> [(name: String, endpoint: MIDIEndpointRef)] {
        var out: [(String, MIDIEndpointRef)] = []
        let n = MIDIGetNumberOfDestinations()
        out.reserveCapacity(Int(n))
        for i in 0..<n {
            let ep = MIDIGetDestination(i)
            if ep != 0, !isOffline(MIDIObjectRef(ep)) { out.append((endpointDisplayName(ep), ep)) }
        }
        return out
    }

    private func endpointDisplayName(_ ep: MIDIEndpointRef) -> String {
        if let s = getStringProperty(MIDIObjectRef(ep), kMIDIPropertyDisplayName) {
            return s.replacingOccurrences(of: "USB MIDI", with: "USB")
        }
        if let s = getStringProperty(MIDIObjectRef(ep), kMIDIPropertyName) {
            return s.replacingOccurrences(of: "USB MIDI", with: "USB")
        }
        return "USB \(ep)"
    }

    private func entityName(for ep: MIDIEndpointRef) -> String? {
        var entity: MIDIEntityRef = 0
        guard MIDIEndpointGetEntity(ep, &entity) == noErr, entity != 0 else { return nil }
        return getStringProperty(MIDIObjectRef(entity), kMIDIPropertyName)
    }

    private func getStringProperty(_ obj: MIDIObjectRef, _ key: CFString) -> String? {
        var unmanaged: Unmanaged<CFString>?
        let st = MIDIObjectGetStringProperty(obj, key, &unmanaged)
        guard st == noErr, let unmanaged else { return nil }
        return unmanaged.takeRetainedValue() as String
    }

    private func isOffline(_ obj: MIDIObjectRef) -> Bool {
        var value: Int32 = 0
        let st = MIDIObjectGetIntegerProperty(obj, kMIDIPropertyOffline, &value)
        return st == noErr && value != 0
    }

    private func sendSysex(_ sysex: Data, to destination: MIDIEndpointRef) -> OSStatus {
        let capacity = 1024
        let raw = UnsafeMutableRawPointer.allocate(byteCount: capacity, alignment: MemoryLayout<MIDIPacketList>.alignment)
        defer { raw.deallocate() }

        let pktList = raw.assumingMemoryBound(to: MIDIPacketList.self)
        let packet = MIDIPacketListInit(pktList)

        let ok: Bool = sysex.withUnsafeBytes { bytes in
            guard let base = bytes.bindMemory(to: UInt8.self).baseAddress else { return false }
            _ = MIDIPacketListAdd(pktList, capacity, packet, 0, sysex.count, base)
            return true
        }

        guard ok else {
            dbg("sendSysex: MIDIPacketListAdd failed")
            return -1
        }
        let st = MIDISend(outPort, destination, pktList)
        if st != noErr {
            dbg("sendSysex: MIDISend failed st=\(st)")
        }
        return st
    }

    private func ensureBleCentral() {
        guard centralManager == nil else { return }
        centralManager = CBCentralManager(delegate: self, queue: midiQueue)
    }

    private func startBleScanInternal() {
        ensureBleCentral()
        guard centralManager?.state == .poweredOn else {
            dbg("BLE scan deferred: central not powered on")
            return
        }
        guard activeTransport != .usbMidi else { return }

        dbg("BLE scan: service=\(Self.bleServiceUUID.uuidString)")
        centralManager?.scanForPeripherals(withServices: [Self.bleServiceUUID], options: [
            CBCentralManagerScanOptionAllowDuplicatesKey: false
        ])
    }

    private func sendBleSysex(_ sysex: Data, reportErrors: Bool) {
        guard let peripheral = connectedPeripheral, let characteristic = commandCharacteristic else {
            if reportErrors { setError("BLE send failed: command characteristic unavailable") }
            return
        }

        let maxWriteLength = max(20, peripheral.maximumWriteValueLength(for: .withResponse))
        var offset = 0
        while offset < sysex.count {
            let end = min(offset + maxWriteLength, sysex.count)
            let chunk = sysex.subdata(in: offset..<end)
            peripheral.writeValue(chunk, for: characteristic, type: .withResponse)
            offset = end
        }
    }

    private func handlePacketDatas(_ packets: [Data]) {
        dbg("RX: packets=\(packets.count)")
        for data in packets {
            let prefix = data.prefix(min(24, data.count)).map { String(format: "%02X", $0) }.joined(separator: " ")
            let ascii = data.prefix(min(64, data.count)).map { (32...126).contains(Int($0)) ? String(UnicodeScalar($0)) : "." }.joined()
            dbg("RX: packet len=\(data.count) bytes prefix=\(prefix)")
            if !ascii.isEmpty {
                dbg("RX: ascii(<=64): \(ascii)")
            }
            feedMidiBytes(data)
        }
    }

    /// CoreMIDI normally delivers raw MIDI bytes (starting with 0xF0 for SysEx),
    /// but some stacks can surface USB-MIDI 4-byte event packets (header + 3 bytes).
    /// If the stream looks like USB-MIDI events, unpack it to raw MIDI bytes.
    private func normalizeIncomingMidiBytes(_ data: Data) -> Data {
        guard data.count >= 4, data.count % 4 == 0 else { return data }

        // Heuristic: many 4-byte groups with CIN in the SysEx range.
        let groups = min(data.count / 4, 16)
        var sysExCinCount = 0
        var hasSysexByte = false

        for g in 0..<groups {
            let h = data[g * 4]
            let cin = h & 0x0F
            if (cin >= 0x4 && cin <= 0x7) { sysExCinCount += 1 }
            let b0 = data[g * 4 + 1]
            let b1 = data[g * 4 + 2]
            let b2 = data[g * 4 + 3]
            if b0 == 0xF0 || b0 == 0xF7 || b1 == 0xF0 || b1 == 0xF7 || b2 == 0xF0 || b2 == 0xF7 {
                hasSysexByte = true
            }
        }

        // Require both: looks like SysEx CIN headers and contains SysEx boundary bytes.
        guard hasSysexByte, sysExCinCount >= max(2, groups / 2) else { return data }

        var out = Data()
        out.reserveCapacity(data.count) // upper bound

        for i in stride(from: 0, to: data.count, by: 4) {
            let cin = data[i] & 0x0F
            let b0 = data[i + 1]
            let b1 = data[i + 2]
            let b2 = data[i + 3]

            switch cin {
            case 0x4, 0x7: // 3 bytes
                out.append(b0)
                out.append(b1)
                out.append(b2)
            case 0x6: // 2 bytes
                out.append(b0)
                out.append(b1)
            case 0x5: // 1 byte
                out.append(b0)
            default:
                // Not a SysEx event; pass through the 3 data bytes (best-effort).
                out.append(b0)
                out.append(b1)
                out.append(b2)
            }
        }

        return out
    }

    private func feedMidiBytes(_ data: Data) {
        let normalized = normalizeIncomingMidiBytes(data)
        withBufferQueueSync {
            activeBufferSession.feedMidiBytes(normalized, tsMs: Self.nowMs())
        }
    }

    private func setError(_ msg: String) {
        dbg("ERROR: \(msg)")
        DispatchQueue.main.async {
            self.lastErrorText = msg
        }
    }

    private static func nowMs() -> UInt64 {
        UInt64(Date().timeIntervalSince1970 * 1000)
    }

    // MARK: - CoreMIDI callbacks

    private static let notifyProc: MIDINotifyProc = { _, refCon in
        guard let refCon else { return }
        let mgr = Unmanaged<USBManager>.fromOpaque(refCon).takeUnretainedValue()
        mgr.midiQueue.async {
            mgr.refreshPortsInternal()
        }
    }

    private static let readProc: MIDIReadProc = { pktList, refCon, _ in
        guard let refCon else { return }
        let mgr = Unmanaged<USBManager>.fromOpaque(refCon).takeUnretainedValue()

        // IMPORTANT: `pktList` is only valid for the duration of this callback.
        // Copy packet bytes synchronously, then hand off to our queue.
        let packetCount = Int(pktList.pointee.numPackets)
        mgr.dbg("readProc: numPackets=\(packetCount)")
        var packets: [Data] = []
        packets.reserveCapacity(packetCount)

        // NOTE: Avoid taking the address of `pktList.pointee.packet` directly (can produce a temporary).
        let pktListMut = UnsafeMutablePointer(mutating: pktList)
        var packetPtr: UnsafePointer<MIDIPacket> = withUnsafePointer(to: &pktListMut.pointee.packet) { ptr in
            UnsafePointer(ptr)
        }

        for _ in 0..<packetCount {
            let len = Int(packetPtr.pointee.length)
            let data = withUnsafeBytes(of: packetPtr.pointee.data) { raw in
                Data(raw.prefix(min(len, raw.count)))
            }
            packets.append(data)
            packetPtr = UnsafePointer(MIDIPacketNext(packetPtr))
        }

        mgr.midiQueue.async {
            mgr.handlePacketDatas(packets)
        }
    }
}

extension USBManager: CBCentralManagerDelegate, CBPeripheralDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        midiQueue.async {
            self.dbg("BLE central state=\(central.state.rawValue)")
            if central.state == .poweredOn, !self.isConnected {
                self.startBleScanInternal()
            }
        }
    }

    func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        midiQueue.async {
            guard self.activeTransport != .usbMidi else { return }
            let advertisedName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
            let name = peripheral.name ?? advertisedName ?? "EMWaver BLE"
            guard name.localizedCaseInsensitiveContains("emwaver") || advertisedName != nil else { return }

            self.dbg("BLE discovered: \(name) rssi=\(RSSI)")
            self.centralManager?.stopScan()
            self.connectedPeripheral = peripheral
            self.commandCharacteristic = nil
            self.notifyCharacteristic = nil
            peripheral.delegate = self
            central.connect(peripheral)
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        midiQueue.async {
            self.dbg("BLE connected: \(peripheral.name ?? peripheral.identifier.uuidString)")
            peripheral.discoverServices([Self.bleServiceUUID])
        }
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        midiQueue.async {
            self.dbg("BLE connect failed: \(error?.localizedDescription ?? "unknown error")")
            if self.activeTransport != .usbMidi {
                self.startBleScanInternal()
            }
        }
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        midiQueue.async {
            guard self.connectedPeripheral?.identifier == peripheral.identifier else { return }
            self.dbg("BLE disconnected: \(error?.localizedDescription ?? "clean")")
            self.connectedPeripheral = nil
            self.commandCharacteristic = nil
            self.notifyCharacteristic = nil
            if self.activeTransport == .ble {
                self.activeTransport = .none
                self.withBufferQueueSync { self.activeBufferSession.resetSamplerStreaming() }
                DispatchQueue.main.async {
                    self.isConnected = false
                    self.connectedPortName = nil
                }
                self.startBleScanInternal()
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        midiQueue.async {
            if let error {
                self.setError("BLE service discovery failed: \(error.localizedDescription)")
                return
            }
            guard let service = peripheral.services?.first(where: { $0.uuid == Self.bleServiceUUID }) else {
                self.setError("BLE service discovery failed: EMWaver service missing")
                return
            }
            peripheral.discoverCharacteristics([
                Self.bleCommandCharacteristicUUID,
                Self.bleNotifyCharacteristicUUID
            ], for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        midiQueue.async {
            if let error {
                self.setError("BLE characteristic discovery failed: \(error.localizedDescription)")
                return
            }

            for characteristic in service.characteristics ?? [] {
                if characteristic.uuid == Self.bleCommandCharacteristicUUID {
                    self.commandCharacteristic = characteristic
                } else if characteristic.uuid == Self.bleNotifyCharacteristicUUID {
                    self.notifyCharacteristic = characteristic
                    peripheral.setNotifyValue(true, for: characteristic)
                }
            }

            guard self.commandCharacteristic != nil else {
                self.setError("BLE characteristic discovery failed: command characteristic missing")
                return
            }

            self.setActiveBufferSession(deviceId: "ble:\(peripheral.identifier.uuidString)")
            self.activeTransport = .ble
            DispatchQueue.main.async {
                self.connectedPortName = peripheral.name ?? "EMWaver BLE"
                self.isConnected = true
                self.lastErrorText = nil
                self.isScanning = false
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        midiQueue.async {
            if let error {
                self.dbg("BLE notify failed: \(error.localizedDescription)")
                return
            }
            guard characteristic.uuid == Self.bleNotifyCharacteristicUUID, let data = characteristic.value else { return }
            self.feedMidiBytes(data)
        }
    }
}
