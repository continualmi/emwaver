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

import Foundation
import CoreMIDI
import SwiftUI
import os

/// NOTE: Despite the historical name, this is now a **USB MIDI (CoreMIDI)** transport.
/// We keep the `USBManager` API surface to minimize churn across the iOS codebase.
final class USBManager: ObservableObject {
    private static let laneSizeBytes: Int = 64
    private static let superframeSizeBytes: Int = 128
    
    // Legacy constant alias for code using it (usually referring to the lane/packet size)
    private static let packetSizeBytes: Int = 64
    
    private static let log = Logger(subsystem: "com.emwaver", category: "usb-midi")

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

    private var client: MIDIClientRef = 0
    private var inPort: MIDIPortRef = 0
    private var outPort: MIDIPortRef = 0

    private var connectedSource: MIDIEndpointRef = 0
    private var connectedDestination: MIDIEndpointRef = 0

    private var virtualDestination: MIDIEndpointRef = 0

    // SysEx receive accumulator (CoreMIDI may chunk messages)
    private var sysexAccumulator = UsbMidiSysexAccumulator()

    // Variables for speed calculation
    private var totalBytesReceived: Int = 0
    private var firstPacketTimeMillis: TimeInterval = 0
    private var lastPacketReceivedTime: TimeInterval = 0

    // MARK: - Init

    init() {
        bufferQueue.setSpecific(key: bufferQueueKey, value: ())
        dbg("USBManager init")
        midiQueue.async {
            self.ensureClient()
            self.refreshPortsInternal()
        }
    }

    private func withBufferQueueSync<T>(_ block: () -> T) -> T {
        if DispatchQueue.getSpecific(key: bufferQueueKey) != nil {
            return block()
        }
        return bufferQueue.sync(execute: block)
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
            DispatchQueue.main.async { self.isScanning = true }

            self.refreshPortsInternal()

            // Auto-connect immediately; `availablePorts` updates on the main queue and may lag.
            self.connectToFirstPortInternal()

            DispatchQueue.main.async { self.isScanning = false }
        }
    }

    func stopScan() {
        DispatchQueue.main.async { self.isScanning = false }
    }

    func disconnect() {
        midiQueue.async {
            self.disconnectInternal()
        }
    }

    // MARK: - Transport (TX/RX)
    
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

        let st = sendSysex(sysex, to: connectedDestination)
        if st != noErr {
            setError("MIDISend failed: \(st)")
        }
    }

    @objc func sendPacket(_ data: Data) {
        midiQueue.async {
            guard self.isConnected, self.connectedDestination != 0 else {
                self.setError("Cannot send packet: Not connected")
                return
            }

            guard let packet64 = self.withBufferQueueSync({ NativeBufferRust.makePacket64(data) }) else {
                self.setError("Cannot send packet: too large (\(data.count) bytes, max \(Self.packetSizeBytes))")
                return
            }
            
            // Log command lane transmission
            self.withBufferQueueSync {
                NativeBufferRust.appendTxBytes(packet64, tsMs: Self.nowMs())
            }
            DispatchQueue.main.async { self.bufferVersion += 1 }

            // Create superframe with Command Lane populated
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
            let rp = NativeBufferRust.readRxSince(packetIndex: packetIndex, maxPackets: maxPackets)
            return ReadPackets(data: rp.data, ts_ms: rp.ts_ms, next_packet_index: rp.next_packet_index, available_packets: rp.available_packets)
        }
    }

    func bufferReadTxSince(packetIndex: UInt64, maxPackets: Int) -> ReadPackets {
        withBufferQueueSync {
            let rp = NativeBufferRust.readTxSince(packetIndex: packetIndex, maxPackets: maxPackets)
            return ReadPackets(data: rp.data, ts_ms: rp.ts_ms, next_packet_index: rp.next_packet_index, available_packets: rp.available_packets)
        }
    }

    func bufferGetPacketCount() -> UInt64 {
        withBufferQueueSync { NativeBufferRust.getRxPacketCount() }
    }

    func bufferGetTxPacketCount() -> UInt64 {
        withBufferQueueSync { NativeBufferRust.getTxPacketCount() }
    }

    struct BufferPacket {
        let data: [UInt8]
        let ts_ms: UInt64
    }

    func bufferNextRxPacket() -> BufferPacket? {
        withBufferQueueSync {
            guard let pkt = NativeBufferRust.nextRxPacket() else { return nil }
            return BufferPacket(data: Array(pkt.packet64), ts_ms: pkt.tsMs)
        }
    }

    func bufferGetRxCounter() -> UInt64 {
        withBufferQueueSync { NativeBufferRust.getRxCounter() }
    }

    func bufferSetRxCounter(_ value: UInt64) {
        withBufferQueueSync { NativeBufferRust.setRxCounter(value) }
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

            let txCount = NativeBufferRust.getTxPacketCount()
            let rxCount = NativeBufferRust.getRxPacketCount()

            let txStart = txCount > UInt64(maxPackets) ? (txCount - UInt64(maxPackets)) : 0
            let rxStart = rxCount > UInt64(maxPackets) ? (rxCount - UInt64(maxPackets)) : 0

            let txRust = NativeBufferRust.readTxSince(packetIndex: txStart, maxPackets: maxPackets)
            let rxRust = NativeBufferRust.readRxSince(packetIndex: rxStart, maxPackets: maxPackets)
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
        withBufferQueueSync { NativeBufferRust.clearAll() }
        DispatchQueue.main.async {
            self.bufferVersion += 1
        }
    }

    func setInvertRx(_ enabled: Bool) {
        withBufferQueueSync { NativeBufferRust.setInvertRx(enabled) }
    }

    func storeBulkPkt(_ data: Data) {
        withBufferQueueSync {
            NativeBufferRust.storeBulkPkt(data, tsMs: Self.nowMs())
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
        withBufferQueueSync { NativeBufferRust.loadBuffer(data) }
        DispatchQueue.main.async {
            self.bufferVersion += 1
        }
        totalBytesReceived = data.count
        firstPacketTimeMillis = Date().timeIntervalSince1970
        lastPacketReceivedTime = firstPacketTimeMillis
    }

    @objc func getBuffer() -> Data {
        withBufferQueueSync { NativeBufferRust.getBuffer() }
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
        withBufferQueueSync { NativeBufferRust.compressDataBits(rangeStart: rangeStart, rangeEnd: rangeEnd, numberBins: numberBins) }
    }

    /// Transmits the current buffer content to the connected device.
    /// For USB MIDI we always send fixed 64B frames (SysEx-tunneled).
    @objc func transmitBuffer() {
        guard isConnected else {
            setError("Cannot transmit buffer: Not connected")
            return
        }

        let bufferToSend = getBuffer()
        guard !bufferToSend.isEmpty else { return }

        let saved = withBufferQueueSync {
            let saved = NativeBufferRust.takeRxState()
            NativeBufferRust.setRxCounter(0)
            return saved
        }
        DispatchQueue.main.async { self.bufferVersion += 1 }

        let profile = withBufferQueueSync { NativeBufferRust.txBleProfile() }
        let fixedDelayMs = Double(profile.fixed_delay_ms)

        let totalBytesToSend = bufferToSend.count
        var currentPacketSize = Int(profile.max_packet_size)
        var lastStatus = Int(profile.target_buffer_level)

        var bytesSent = 0
        while bytesSent < totalBytesToSend {
            while let next = withBufferQueueSync({ NativeBufferRust.nextRxPacket() }) {
                let status = withBufferQueueSync { NativeBufferRust.parseBsStatus(next.packet64) }
                if status >= 0 { lastStatus = status }
            }

            currentPacketSize = withBufferQueueSync {
                NativeBufferRust.txBleNextPacketSize(bytesSent: bytesSent, lastStatus: lastStatus, currentPacketSize: currentPacketSize)
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
                    NativeBufferRust.appendTxBytes(packet64, tsMs: Self.nowMs())
                }
                
                let sf = self.makeSuperframe(cmdLane: nil, streamLane: packet64)
                self.sendSuperframe(sf)
            }

            bytesSent = endRange
            Thread.sleep(forTimeInterval: fixedDelayMs / 1000.0)
        }

        Thread.sleep(forTimeInterval: 0.1)

        withBufferQueueSync {
            NativeBufferRust.restoreRxState(rxBytes: saved.rxBytes, rxTsMs: saved.rxTsMs, rxCounter: saved.rxCounter)
        }
        DispatchQueue.main.async { self.bufferVersion += 1 }
    }

    // Send a command and wait for response
    @objc func sendCommand(_ command: Data, timeout: Int) -> Data? {
        guard isConnected else {
            setError("Cannot send command: Not connected")
            return nil
        }

        // Drop any stale RX packets so next_rx_packet returns this command's response.
        withBufferQueueSync {
            NativeBufferRust.setRxCounter(NativeBufferRust.getRxPacketCount())
        }

        sendPacket(command)

        let startTime = Date().timeIntervalSince1970
        var out = Data()
        out.reserveCapacity(Self.packetSizeBytes)

        while out.count < Self.packetSizeBytes {
            if !isConnected { return nil }

            let nextPacket = withBufferQueueSync { NativeBufferRust.nextRxPacket() }
            if let pkt = nextPacket {
                out.append(pkt.packet64)
                break
            }

            let elapsedMs = (Date().timeIntervalSince1970 - startTime) * 1000
            if elapsedMs >= Double(max(1, timeout)) {
                return nil
            }

            Thread.sleep(forTimeInterval: 0.01)
        }

        return out
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

            self.withBufferQueueSync { NativeBufferRust.clearAll() }
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

            let got = self.withBufferQueueSync { NativeBufferRust.getRxPacketCount() }
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

    private func connectToFirstPortInternal() {
        let candidates = listPortCandidatesInternal()
        let chosen = candidates.first(where: { $0.name.localizedCaseInsensitiveContains("emwaver") })
            ?? candidates.first(where: { !$0.name.localizedCaseInsensitiveContains("network") })
            ?? candidates.first
        guard let chosen else {
            dbg("connect: no port candidates")
            return
        }
        dbg("connect: chosen=\(chosen.name)")

        disconnectInternal()

        connectedSource = chosen.source
        connectedDestination = chosen.destination

        let st = MIDIPortConnectSource(inPort, chosen.source, nil)
        guard st == noErr else {
            setError("MIDIPortConnectSource failed: \(st)")
            connectedSource = 0
            connectedDestination = 0
            return
        }

        DispatchQueue.main.async {
            self.connectedPortName = chosen.name
            self.isConnected = true
            self.lastErrorText = nil
        }
    }

    private func disconnectInternal() {
        if connectedSource != 0 {
            _ = MIDIPortDisconnectSource(inPort, connectedSource)
        }
        connectedSource = 0
        connectedDestination = 0

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
            return MIDIPacketListAdd(pktList, capacity, packet, 0, sysex.count, base) != nil
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

        // Debug: if we get complete SysEx frames, log their header.
        for sysex in sysexAccumulator.feed(normalized) {
            let head = sysex.prefix(min(16, sysex.count)).map { String(format: "%02X", $0) }.joined(separator: " ")
            dbg("RX: sysex len=\(sysex.count) head=\(head)")

            guard let superframe = UsbMidiSysex.decodeSysexToSuperframe(sysex) else {
                dbg("RX: sysex did not decode as EMWaver superframe")
                continue
            }
            
            let cmdLane = superframe.subdata(in: 0..<Self.laneSizeBytes)
            let streamLane = superframe.subdata(in: Self.laneSizeBytes..<Self.superframeSizeBytes)
            
            // Push non-empty lanes to the shared buffer
            // Check for empty (all zeros) logic
            let cmdEmpty = cmdLane.allSatisfy { $0 == 0 }
            let streamEmpty = streamLane.allSatisfy { $0 == 0 }
            
            if !cmdEmpty {
                dbg("RX: Demux CMD lane")
                storeBulkPkt(cmdLane)
            }
            
            if !streamEmpty {
                dbg("RX: Demux STREAM lane")
                storeBulkPkt(streamLane)
            }
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