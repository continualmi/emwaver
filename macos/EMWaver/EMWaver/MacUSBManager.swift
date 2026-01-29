/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
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

import Combine
import CoreMIDI
import Foundation

import EMWaverScriptRuntime
import EMWaverTransport

/// macOS USB MIDI (CoreMIDI) transport.
///
/// This is intentionally minimal: enough to power Scripts execution.
/// It implements `ScriptDevice` for the shared Script runtime.
final class MacUSBManager: ObservableObject, ScriptDevice {
    private static let laneSizeBytes: Int = 64
    private static let superframeSizeBytes: Int = 128

    @Published var isConnected: Bool = false
    @Published var connectedPortName: String? = nil
    @Published var availablePorts: [String] = []
    @Published var lastErrorText: String? = nil
    @Published var deviceEmwaverVersion: String? = nil
    @Published var autoConnectEnabled: Bool = true {
        didSet {
            if autoConnectEnabled {
                refreshPorts()
            }
        }
    }

    private let midiQueue = DispatchQueue(label: "com.emwaver.macos.midi", qos: .userInitiated)
    private let bufferQueue = DispatchQueue(label: "com.emwaver.macos.buffer")

    private let midiQueueKey = DispatchSpecificKey<Void>()

    private var client: MIDIClientRef = 0
    private var inPort: MIDIPortRef = 0
    private var outPort: MIDIPortRef = 0

    private var connectedSource: MIDIEndpointRef = 0
    private var connectedDestination: MIDIEndpointRef = 0

    private var sysexAccumulator = UsbMidiSysexAccumulator()

    private var captureBuffer = Data()
    private var rxPackets: [Data] = []

    private var waitingForResponse = false
    private var responseSemaphore: DispatchSemaphore? = nil
    private var responseData: Data? = nil

    init() {
        midiQueue.setSpecific(key: midiQueueKey, value: ())
        midiQueue.async {
            self.ensureClient()
            self.refreshPortsInternal()
            self.autoConnectIfNeededInternal()
        }
    }

    private func withMidiQueueSync(_ block: () -> Void) {
        if DispatchQueue.getSpecific(key: midiQueueKey) != nil {
            block()
        } else {
            midiQueue.sync(execute: block)
        }
    }

    private func isTransportConnectedInternal() -> Bool {
        if DispatchQueue.getSpecific(key: midiQueueKey) != nil {
            return connectedSource != 0 && connectedDestination != 0
        }
        return midiQueue.sync { connectedSource != 0 && connectedDestination != 0 }
    }

    // MARK: - ScriptDevice (buffer)

    func getBuffer() -> Data {
        bufferQueue.sync { captureBuffer }
    }

    func clearBuffer() {
        bufferQueue.sync {
            captureBuffer.removeAll(keepingCapacity: true)
            rxPackets.removeAll(keepingCapacity: true)
        }
    }

    func loadBuffer(data: Data) {
        bufferQueue.sync {
            captureBuffer = data
        }
    }

    // MARK: - Connection

    func refreshPorts() {
        midiQueue.async {
            self.ensureClient()
            self.refreshPortsInternal()
            self.autoConnectIfNeededInternal()
        }
    }

    func connect(portName: String) {
        midiQueue.async {
            self.ensureClient()
            self.connectInternal(portName: portName)
        }
    }

    func disconnect() {
        midiQueue.async {
            self.disconnectInternal()
        }
    }

    private func autoConnectIfNeededInternal() {
        guard autoConnectEnabled else { return }
        guard !isTransportConnectedInternal() else { return }
        connectToFirstPortInternal()
    }

    // MARK: - ScriptDevice (TX/RX)

    func sendPacket(_ data: Data) {
        midiQueue.async {
            guard self.connectedDestination != 0 else {
                self.setError("Cannot send packet: Not connected")
                return
            }

            guard let packet64 = Self.makePacket64(data) else {
                self.setError("Cannot send packet: too large (\(data.count) bytes, max \(Self.laneSizeBytes))")
                return
            }

            let sf = Self.makeSuperframe(cmdLane: packet64, streamLane: nil)
            self.sendSuperframe(sf)
        }
    }

    func sendCommand(_ command: Data, timeout: Int) -> Data? {
        guard isTransportConnectedInternal() else {
            setError("Cannot send command: Not connected")
            return nil
        }

        bufferQueue.sync {
            rxPackets.removeAll(keepingCapacity: true)
        }

        let sem = DispatchSemaphore(value: 0)
        bufferQueue.sync {
            waitingForResponse = true
            responseSemaphore = sem
            responseData = nil
        }

        sendPacket(command)

        let ms = max(1, timeout)
        let waitResult = sem.wait(timeout: .now() + .milliseconds(ms))

        bufferQueue.sync {
            waitingForResponse = false
            responseSemaphore = nil
        }

        if waitResult == .timedOut {
            return nil
        }

        return bufferQueue.sync { responseData }
    }

    func transmitBuffer() {
        guard isTransportConnectedInternal() else {
            setError("Cannot transmit buffer: Not connected")
            return
        }

        let data = getBuffer()
        guard !data.isEmpty else { return }

        // Very simple sender: chunk into fixed 64B stream-lane packets.
        // (No BS pacing yet on macOS; keep this predictable.)
        var idx = 0
        while idx < data.count {
            let end = min(idx + Self.laneSizeBytes, data.count)
            let chunk = data.subdata(in: idx..<end)
            guard let packet64 = Self.makePacket64(chunk) else { break }
            let sf = Self.makeSuperframe(cmdLane: nil, streamLane: packet64)
            withMidiQueueSync { self.sendSuperframe(sf) }
            idx = end
            Thread.sleep(forTimeInterval: 0.001)
        }
    }

    // MARK: - MIDI internals

    private func ensureClient() {
        if client != 0 { return }

        let stClient = MIDIClientCreate(
            "emwaver-macos-midi" as CFString,
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
            "emwaver-macos-midi-in" as CFString,
            Self.readProc,
            UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque()),
            &inPort
        )
        guard stIn == noErr else {
            setError("MIDIInputPortCreate failed: \(stIn)")
            return
        }

        let stOut = MIDIOutputPortCreate(client, "emwaver-macos-midi-out" as CFString, &outPort)
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
            return
        }
        connectInternal(candidate: chosen)
    }

    private func connectInternal(portName: String) {
        let candidates = listPortCandidatesInternal()
        guard let chosen = candidates.first(where: { $0.name == portName }) else {
            setError("No matching port: \(portName)")
            return
        }
        connectInternal(candidate: chosen)
    }

    private func connectInternal(candidate: PortCandidate) {
        disconnectInternal()

        bufferQueue.sync {
            self.captureBuffer.removeAll(keepingCapacity: true)
            self.rxPackets.removeAll(keepingCapacity: true)
            self.sysexAccumulator = UsbMidiSysexAccumulator()
        }

        connectedSource = candidate.source
        connectedDestination = candidate.destination

        let st = MIDIPortConnectSource(inPort, candidate.source, nil)
        guard st == noErr else {
            setError("MIDIPortConnectSource failed: \(st)")
            connectedSource = 0
            connectedDestination = 0
            return
        }

        DispatchQueue.main.async {
            self.connectedPortName = candidate.name
            self.isConnected = true
            self.lastErrorText = nil
            self.deviceEmwaverVersion = nil
        }

        // Mirror the desktop app behavior: query the device version automatically on connect.
        DispatchQueue.global(qos: .userInitiated).async {
            let v = self.queryDeviceVersion(timeoutMs: 1500)
            DispatchQueue.main.async {
                self.deviceEmwaverVersion = v
            }
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
            self.deviceEmwaverVersion = nil
        }
    }

    private func queryDeviceVersion(timeoutMs: Int) -> String? {
        // Opcode 0x01 is "VERSION". Expected response lane: [0x80, major, minor, patch, 0...]
        let resp = sendCommand(Data([0x01]), timeout: timeoutMs)
        guard let resp else { return nil }
        if resp.count < 4 { return nil }
        if resp[0] != 0x80 { return nil }
        if resp.dropFirst(4).contains(where: { $0 != 0 }) { return nil }
        return "\(resp[1]).\(resp[2]).\(resp[3])"
    }

    private func listPortCandidatesInternal() -> [PortCandidate] {
        let sources = allSources()
        let dests = allDestinations()

        var out: [PortCandidate] = []
        out.reserveCapacity(min(sources.count, dests.count))

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

    private static func makeSuperframe(cmdLane: Data?, streamLane: Data?) -> Data {
        var sf = Data(repeating: 0, count: superframeSizeBytes)
        if let c = cmdLane {
            let len = min(c.count, laneSizeBytes)
            if len > 0 { sf.replaceSubrange(0..<len, with: c.prefix(len)) }
        }
        if let s = streamLane {
            let len = min(s.count, laneSizeBytes)
            if len > 0 { sf.replaceSubrange(laneSizeBytes..<(laneSizeBytes + len), with: s.prefix(len)) }
        }
        return sf
    }

    private func sendSuperframe(_ superframe: Data) {
        guard let sysex = UsbMidiSysex.encodeSuperframe(superframe) else {
            setError("SysEx encode failed")
            return
        }
        let st = sendSysex(sysex, to: connectedDestination)
        if st != noErr {
            setError("MIDISend failed: \(st)")
        }
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
        guard ok else { return -1 }
        return MIDISend(outPort, destination, pktList)
    }

    private static func makePacket64(_ data: Data) -> Data? {
        if data.count > laneSizeBytes { return nil }
        if data.count == laneSizeBytes { return data }
        var out = Data(repeating: 0, count: laneSizeBytes)
        out.replaceSubrange(0..<data.count, with: data)
        return out
    }

    private func handleMidiBytes(_ data: Data) {
        let normalized = normalizeIncomingMidiBytes(data)

        for sysex in sysexAccumulator.feed(normalized) {
            guard let superframe = UsbMidiSysex.decodeSysexToSuperframe(sysex) else { continue }

            let cmdLane = superframe.subdata(in: 0..<Self.laneSizeBytes)
            let streamLane = superframe.subdata(in: Self.laneSizeBytes..<Self.superframeSizeBytes)

            let cmdEmpty = cmdLane.allSatisfy { $0 == 0 }
            let streamEmpty = streamLane.allSatisfy { $0 == 0 }

            if !cmdEmpty { storeRxLane(cmdLane) }
            if !streamEmpty { storeRxLane(streamLane) }
        }
    }

    /// Some stacks surface USB-MIDI 4-byte event packets (header + 3 bytes).
    /// Best-effort unpack them back into raw MIDI bytes.
    private func normalizeIncomingMidiBytes(_ data: Data) -> Data {
        guard data.count >= 4, data.count % 4 == 0 else { return data }

        let groups = min(data.count / 4, 16)
        var sysExCinCount = 0
        var hasSysexByte = false

        for g in 0..<groups {
            let h = data[g * 4]
            let cin = h & 0x0F
            if cin >= 0x4 && cin <= 0x7 { sysExCinCount += 1 }
            let b0 = data[g * 4 + 1]
            let b1 = data[g * 4 + 2]
            let b2 = data[g * 4 + 3]
            if b0 == 0xF0 || b0 == 0xF7 || b1 == 0xF0 || b1 == 0xF7 || b2 == 0xF0 || b2 == 0xF7 {
                hasSysexByte = true
            }
        }

        guard hasSysexByte, sysExCinCount >= max(2, groups / 2) else { return data }

        var out = Data()
        out.reserveCapacity(data.count)

        for i in stride(from: 0, to: data.count, by: 4) {
            let cin = data[i] & 0x0F
            let b0 = data[i + 1]
            let b1 = data[i + 2]
            let b2 = data[i + 3]

            switch cin {
            case 0x4, 0x7:
                out.append(b0)
                out.append(b1)
                out.append(b2)
            case 0x6:
                out.append(b0)
                out.append(b1)
            case 0x5:
                out.append(b0)
            default:
                out.append(b0)
                out.append(b1)
                out.append(b2)
            }
        }

        return out
    }

    private func storeRxLane(_ lane64: Data) {
        bufferQueue.sync {
            captureBuffer.append(lane64)
            rxPackets.append(lane64)

            if waitingForResponse, responseData == nil {
                responseData = lane64
                responseSemaphore?.signal()
            }
        }
    }

    private func setError(_ msg: String) {
        DispatchQueue.main.async {
            self.lastErrorText = msg
        }
    }

    // MARK: - CoreMIDI callbacks

    private static let notifyProc: MIDINotifyProc = { _, refCon in
        guard let refCon else { return }
        let mgr = Unmanaged<MacUSBManager>.fromOpaque(refCon).takeUnretainedValue()
        mgr.midiQueue.async {
            mgr.refreshPortsInternal()
            mgr.autoConnectIfNeededInternal()
        }
    }

    private static let readProc: MIDIReadProc = { pktList, refCon, _ in
        guard let refCon else { return }
        let mgr = Unmanaged<MacUSBManager>.fromOpaque(refCon).takeUnretainedValue()

        let packetCount = Int(pktList.pointee.numPackets)
        var packets: [Data] = []
        packets.reserveCapacity(packetCount)

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
            for p in packets {
                mgr.handleMidiBytes(p)
            }
        }
    }
}
