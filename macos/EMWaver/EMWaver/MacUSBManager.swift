/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
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
    // Mini-frame: 18B cmd lane + 18B stream lane.
    private static let laneSizeBytes: Int = 18
    private static let superframeSizeBytes: Int = 36

    private enum EmwOpcode {
        static let version: UInt8 = 0x01
        static let enterDfu: UInt8 = 0x06
        static let sample: UInt8 = 0x60

        static let sampleStart: UInt8 = 0x00
        static let sampleStop: UInt8 = 0x01
    }

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

    @Published var connectedBoardType: String? = nil
    @Published var lastDetectedBoardType: String? = nil

    private let midiQueue = DispatchQueue(label: "com.emwaver.macos.midi", qos: .userInitiated)
    private let bufferQueue = DispatchQueue(label: "com.emwaver.macos.buffer")
    private let commandLock = NSLock()

    private let midiQueueKey = DispatchSpecificKey<Void>()

    private var client: MIDIClientRef = 0
    private var inPort: MIDIPortRef = 0
    private var outPort: MIDIPortRef = 0

    private var connectedSource: MIDIEndpointRef = 0
    private var connectedDestination: MIDIEndpointRef = 0

    private var portCandidatesByDisplayName: [String: PortCandidate] = [:]

    private var sysexAccumulator = UsbMidiSysexAccumulator()

    private var captureBuffer = Data()
    private var rxPackets: [Data] = []

    // When sampling is active, we must keep *all* stream lanes, including all-zero lanes.
    // Otherwise the buffer appears to "stall" until an actual signal produces nonzero bytes.
    private var isSamplerStreamingActive = false

    private var waitingForResponse = false
    private var responseSemaphore: DispatchSemaphore? = nil
    private var responseData: Data? = nil
    private var responsePredicate: ((Data) -> Bool)? = nil

    init() {
        midiQueue.setSpecific(key: midiQueueKey, value: ())

        // Important: create the CoreMIDI client/ports on the main thread.
        // Creating the MIDI client on a GCD worker thread can result in missed
        // hot-plug notifications on some macOS setups (no runloop attached).
        // The rest of the I/O work is still serialized on `midiQueue`.
        self.ensureClient()

        midiQueue.async {
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

    private func inferBoardType(portName: String?) -> String {
        let name = (portName ?? "").lowercased()
        if name.contains("esp32") || name.contains("s3") {
            return "esp32s3"
        }
        if name.contains("emwaver esp") {
            return "esp32s3"
        }
        return "stm32f042"
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

    func requestEnterUpdateMode() {
        // Fire-and-forget. The device will erase the initial flash pages and reset,
        // then enumerate as DFU (0483:DF11).
        midiQueue.async {
            guard self.connectedDestination != 0 else {
                self.setError("Cannot enter Update Mode: Not connected")
                return
            }

            guard let pkt = Self.makePacket(Data([EmwOpcode.enterDfu])) else {
                self.setError("Cannot enter Update Mode: packet build failed")
                return
            }

            let sf = Self.makeSuperframe(cmdLane: pkt, streamLane: nil)
            self.sendSuperframe(sf)
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
            self.sendPacketNow(data)
        }
    }

    func sendCommand(_ command: Data, timeout: Int) -> Data? {
        sendCommandInternal(command, timeout: timeout, responsePredicate: nil)
    }

    private func sendCommandInternal(_ command: Data, timeout: Int, responsePredicate: ((Data) -> Bool)?) -> Data? {
        guard isTransportConnectedInternal() else {
            setError("Cannot send command: Not connected")
            return nil
        }

        commandLock.lock()
        defer { commandLock.unlock() }

        bufferQueue.sync {
            rxPackets.removeAll(keepingCapacity: true)
        }

        let sem = DispatchSemaphore(value: 0)
        bufferQueue.sync {
            waitingForResponse = true
            responseSemaphore = sem
            responseData = nil
            self.responsePredicate = responsePredicate
        }

        withMidiQueueSync {
            self.sendPacketNow(command)
        }

        let ms = max(1, timeout)
        let waitResult = sem.wait(timeout: .now() + .milliseconds(ms))

        bufferQueue.sync {
            waitingForResponse = false
            responseSemaphore = nil
            self.responsePredicate = nil
        }

        if waitResult == .timedOut {
            return nil
        }

        return bufferQueue.sync { responseData }
    }

    private func sendPacketNow(_ data: Data) {
        guard connectedDestination != 0 else {
            setError("Cannot send packet: Not connected")
            return
        }

        guard let packet = Self.makePacket(data) else {
            setError("Cannot send packet: too large (\(data.count) bytes, max \(Self.laneSizeBytes))")
            return
        }

        // Track sampler mode so we don't drop all-zero stream lanes while sampling.
        if data.count >= 2 {
            let opcode = data[data.startIndex]
            if opcode == EmwOpcode.sample {
                let sub = data[data.startIndex.advanced(by: 1)]
                if sub == EmwOpcode.sampleStart {
                    isSamplerStreamingActive = true
                } else if sub == EmwOpcode.sampleStop {
                    isSamplerStreamingActive = false
                }
            }
        }

        let sf = Self.makeSuperframe(cmdLane: packet, streamLane: nil)
        sendSuperframe(sf)
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
            guard let packet = Self.makePacket(chunk) else { break }
            let sf = Self.makeSuperframe(cmdLane: nil, streamLane: packet)
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

        var nameCounts: [String: Int] = [:]
        nameCounts.reserveCapacity(candidates.count)

        var ports: [String] = []
        ports.reserveCapacity(candidates.count)

        var map: [String: PortCandidate] = [:]
        map.reserveCapacity(candidates.count)

        for c in candidates {
            let base = c.name
            let n = (nameCounts[base] ?? 0) + 1
            nameCounts[base] = n
            let display = (n == 1) ? base : "\(base) (\(n))"
            ports.append(display)
            map[display] = c
        }

        self.portCandidatesByDisplayName = map
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

        let display = portCandidatesByDisplayName.first(where: { $0.value.source == chosen.source && $0.value.destination == chosen.destination })?.key
        connectInternal(candidate: chosen, displayName: display)
    }

    private func connectInternal(portName: String) {
        if let chosen = portCandidatesByDisplayName[portName] {
            connectInternal(candidate: chosen, displayName: portName)
            return
        }

        // Fallback (shouldn't happen; display names are built from candidates).
        let candidates = listPortCandidatesInternal()
        if let chosen = candidates.first(where: { $0.name == portName }) {
            connectInternal(candidate: chosen, displayName: portName)
            return
        }

        setError("No matching port: \(portName)")
    }

    private func connectInternal(candidate: PortCandidate, displayName: String?) {
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
            self.connectedPortName = displayName ?? candidate.name
            self.isConnected = true
            self.lastErrorText = nil
            self.deviceEmwaverVersion = nil
        }

        // Query only local runtime metadata needed for display and update guidance.
        DispatchQueue.global(qos: .userInitiated).async {
            var v = self.queryDeviceVersion(timeoutMs: 1500)
            if v == nil {
                Thread.sleep(forTimeInterval: 0.25)
                v = self.queryDeviceVersion(timeoutMs: 1500)
            }

            let boardType = self.inferBoardType(portName: displayName ?? candidate.name)

            DispatchQueue.main.async {
                self.deviceEmwaverVersion = v
                self.connectedBoardType = boardType
                self.lastDetectedBoardType = boardType
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
            self.connectedBoardType = nil
        }
    }

    private func queryDeviceVersion(timeoutMs: Int) -> String? {
        // Opcode 0x01 is "VERSION". Expected response lane: [0x80, major, minor, patch, 0...]
        // Product UI uses major.minor (patch is internal / not shown).
        let resp = sendCommandInternal(
            Data([EmwOpcode.version]),
            timeout: timeoutMs,
            responsePredicate: { lane64 in
                if lane64.count < 4 { return false }
                if lane64[0] != 0x80 { return false }
                return !lane64.dropFirst(4).contains(where: { $0 != 0 })
            }
        )
        guard let resp else { return nil }
        if resp.count < 4 { return nil }
        if resp[0] != 0x80 { return nil }
        if resp.dropFirst(4).contains(where: { $0 != 0 }) { return nil }
        return "\(resp[1]).\(resp[2])"
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
            MIDIPacketListAdd(pktList, capacity, packet, 0, sysex.count, base)
            return true
        }
        guard ok else { return -1 }
        return MIDISend(outPort, destination, pktList)
    }

    private static func makePacket(_ data: Data) -> Data? {
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

            // In sampler streaming mode, stream lanes can legitimately be all zeros (idle-low).
            // Dropping them makes the capture look like it "stalls" until a real signal arrives.
            if !streamEmpty || isSamplerStreamingActive {
                storeRxLane(streamLane)
            }
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

    private func storeRxLane(_ lane: Data) {
        bufferQueue.sync {
            captureBuffer.append(lane)
            rxPackets.append(lane)

            if waitingForResponse, responseData == nil {
                if let predicate = responsePredicate, !predicate(lane) {
                    return
                }
                responseData = lane
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
            if mgr.connectedSource != 0, mgr.isOffline(MIDIObjectRef(mgr.connectedSource)) {
                mgr.disconnectInternal()
            }
            if mgr.connectedDestination != 0, mgr.isOffline(MIDIObjectRef(mgr.connectedDestination)) {
                mgr.disconnectInternal()
            }
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
