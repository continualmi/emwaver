/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

final class DeviceBufferSession {
    private static let packetSizeBytes = 18
    private let lock = NSLock()

    private var rxBytes: [UInt8] = []
    private var rxTsMs: [UInt64] = []
    private var rxCounter: UInt64 = 0
    private var txBytes: [UInt8] = []
    private var txTsMs: [UInt64] = []
    private var samplerStreamingActive = false
    private var sysexAccumulator = UsbMidiSysexAccumulator()

    func clearAll() {
        lock.lock()
        defer { lock.unlock() }
        rxBytes = []
        rxTsMs = []
        rxCounter = 0
        txBytes = []
        txTsMs = []
        samplerStreamingActive = false
        sysexAccumulator = UsbMidiSysexAccumulator()
    }

    func getRxPacketCount() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return UInt64(rxBytes.count / Self.packetSizeBytes)
    }

    func getTxPacketCount() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return UInt64(txTsMs.count)
    }

    func getRxCounter() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return rxCounter
    }

    func setRxCounter(_ value: UInt64) {
        lock.lock()
        defer { lock.unlock() }
        let packets = UInt64(rxBytes.count / Self.packetSizeBytes)
        rxCounter = min(value, packets)
    }

    func storeBulkPkt(_ data: Data, tsMs: UInt64) {
        if data.isEmpty { return }
        lock.lock()
        defer { lock.unlock() }
        storeBulkPktLocked(data, tsMs: tsMs)
    }

    private func storeBulkPktLocked(_ data: Data, tsMs: UInt64) {
        let prevPackets = rxBytes.count / Self.packetSizeBytes
        rxBytes.append(contentsOf: data)
        let newPackets = rxBytes.count / Self.packetSizeBytes
        let delta = max(0, newPackets - prevPackets)
        if delta > 0 {
            rxTsMs.append(contentsOf: Array(repeating: tsMs, count: delta))
        }
    }

    func appendTxBytes(_ data: Data, tsMs: UInt64) {
        if data.isEmpty { return }
        lock.lock()
        defer { lock.unlock() }

        var offset = 0
        while offset < data.count {
            let take = min(Self.packetSizeBytes, data.count - offset)
            var pkt = [UInt8](repeating: 0, count: Self.packetSizeBytes)
            data.copyBytes(to: &pkt, from: offset..<(offset + take))
            txBytes.append(contentsOf: pkt)
            txTsMs.append(tsMs)
            offset += take
        }
    }

    func outgoingSamplerPolicy(for data: Data) -> SamplerLanePolicy {
        lock.lock()
        defer { lock.unlock() }
        let policy = SamplerLanePolicy.forOutgoingPacket(data, samplerStreamingActive: samplerStreamingActive)
        samplerStreamingActive = policy.nextSamplerStreamingActive
        return policy
    }

    func resetSamplerStreaming() {
        lock.lock()
        defer { lock.unlock() }
        samplerStreamingActive = false
    }

    func feedMidiBytes(_ normalized: Data, tsMs: UInt64) {
        if normalized.isEmpty { return }
        lock.lock()
        defer { lock.unlock() }

        for sysex in sysexAccumulator.feed(normalized) {
            guard let superframe = UsbMidiSysex.decodeSysexToSuperframe(sysex) else {
                continue
            }
            guard superframe.count >= Self.packetSizeBytes * 2 else {
                continue
            }

            let commandLane = superframe.subdata(in: 0..<Self.packetSizeBytes)
            let streamLane = superframe.subdata(in: Self.packetSizeBytes..<(Self.packetSizeBytes * 2))
            let policy = SamplerLanePolicy.forIncomingSuperframe(
                commandLane: commandLane,
                streamLane: streamLane,
                samplerStreamingActive: samplerStreamingActive
            )

            if policy.shouldStoreCommandLane {
                storeBulkPktLocked(commandLane, tsMs: tsMs)
            }
            if policy.shouldStoreStreamLane {
                storeBulkPktLocked(streamLane, tsMs: tsMs)
            }
        }
    }

    func prepareCommandResponseWait() {
        lock.lock()
        defer { lock.unlock() }
        rxCounter = UInt64(rxBytes.count / Self.packetSizeBytes)
    }

    func awaitCommandResponse(timeout: Int, shouldContinue: () -> Bool) -> Data? {
        let startTime = Date().timeIntervalSince1970
        let safeTimeout = Double(max(1, timeout))

        while true {
            if !shouldContinue() { return nil }
            if let pkt = nextRxPacket() {
                return pkt.packet64
            }

            let elapsedMs = (Date().timeIntervalSince1970 - startTime) * 1000
            if elapsedMs >= safeTimeout {
                return nil
            }

            Thread.sleep(forTimeInterval: 0.01)
        }
    }

    func loadBuffer(_ data: Data) {
        lock.lock()
        defer { lock.unlock() }
        rxBytes = Array(data)
        rxCounter = 0
        rxTsMs = Array(repeating: 0, count: rxBytes.count / Self.packetSizeBytes)
    }

    func getBuffer() -> Data {
        lock.lock()
        defer { lock.unlock() }
        return Data(rxBytes)
    }

    func readRxSince(packetIndex: UInt64, maxPackets: Int) -> NativeBufferRust.ReadPackets {
        lock.lock()
        defer { lock.unlock() }
        return readSince(bytes: rxBytes, timestamps: rxTsMs, packetIndex: packetIndex, maxPackets: maxPackets)
    }

    func readTxSince(packetIndex: UInt64, maxPackets: Int) -> NativeBufferRust.ReadPackets {
        lock.lock()
        defer { lock.unlock() }
        return readSince(bytes: txBytes, timestamps: txTsMs, packetIndex: packetIndex, maxPackets: maxPackets)
    }

    func nextRxPacket() -> (packet64: Data, tsMs: UInt64)? {
        lock.lock()
        defer { lock.unlock() }

        let packets = UInt64(rxBytes.count / Self.packetSizeBytes)
        if rxCounter >= packets { return nil }

        let startByte = Int(rxCounter) * Self.packetSizeBytes
        if startByte + Self.packetSizeBytes > rxBytes.count { return nil }

        let pkt = Data(rxBytes[startByte..<(startByte + Self.packetSizeBytes)])
        let ts = Int(rxCounter) < rxTsMs.count ? rxTsMs[Int(rxCounter)] : 0
        rxCounter += 1
        return (pkt, ts)
    }

    func compressDataBits(rangeStart: Int, rangeEnd: Int, numberBins: Int) -> ([Float], [Float]) {
        lock.lock()
        defer { lock.unlock() }

        let buffer = rxBytes
        let totalBits = buffer.count * 8
        if buffer.isEmpty || rangeStart >= rangeEnd || rangeStart >= totalBits || numberBins <= 0 {
            return ([], [])
        }

        let end = min(rangeEnd, totalBits)
        let start = min(rangeStart, end)
        let span = end - start
        if span <= 0 { return ([], []) }

        func bitAt(_ i: Int) -> UInt8 {
            let byteIndex = i >> 3
            if byteIndex < 0 || byteIndex >= buffer.count { return 0 }
            return (buffer[byteIndex] >> (i & 7)) & 1
        }

        var timeValues: [Float] = []
        var dataValues: [Float] = []

        if span <= numberBins * 2 {
            timeValues.reserveCapacity(span)
            dataValues.reserveCapacity(span)
            for i in start..<end {
                timeValues.append(Float(i))
                dataValues.append(bitAt(i) == 1 ? 255.0 : 0.0)
            }
            return (timeValues, dataValues)
        }

        let binWidth = Float(span) / Float(numberBins)
        for bin in 0..<numberBins {
            let binStart = Int(floor(Float(start) + Float(bin) * binWidth))
            var binEnd = Int(floor(Float(binStart) + binWidth))
            if binEnd > end { binEnd = end }
            if binEnd <= binStart { continue }

            var hasLow = false
            var hasHigh = false
            var i = binStart
            while i < binEnd {
                let byteIndex = i >> 3
                if byteIndex >= buffer.count { break }

                if (i & 7) == 0 && i + 8 <= binEnd {
                    let byteVal = buffer[byteIndex]
                    if byteVal == 0 {
                        hasLow = true
                    } else if byteVal == 255 {
                        hasHigh = true
                    } else {
                        hasLow = true
                        hasHigh = true
                    }
                    i += 8
                } else {
                    if bitAt(i) == 1 { hasHigh = true } else { hasLow = true }
                    i += 1
                }

                if hasLow && hasHigh { break }
            }

            if hasLow || hasHigh {
                timeValues.append(Float(binStart))
                dataValues.append(hasLow ? 0.0 : 255.0)
                timeValues.append(Float(binEnd - 1))
                dataValues.append(hasHigh ? 255.0 : 0.0)
            }
        }

        return (timeValues, dataValues)
    }

    func takeRxState() -> (rxBytes: Data, rxTsMs: [UInt64], rxCounter: UInt64) {
        lock.lock()
        defer { lock.unlock() }
        return (Data(rxBytes), rxTsMs, rxCounter)
    }

    func restoreRxState(rxBytes: Data, rxTsMs: [UInt64], rxCounter: UInt64) {
        lock.lock()
        defer { lock.unlock() }
        self.rxBytes = Array(rxBytes)
        self.rxTsMs = rxTsMs

        let packets = self.rxBytes.count / Self.packetSizeBytes
        if self.rxTsMs.count < packets {
            self.rxTsMs.append(contentsOf: Array(repeating: 0, count: packets - self.rxTsMs.count))
        } else if self.rxTsMs.count > packets {
            self.rxTsMs = Array(self.rxTsMs.prefix(packets))
        }

        self.rxCounter = min(rxCounter, UInt64(packets))
    }

    private func readSince(bytes: [UInt8], timestamps: [UInt64], packetIndex: UInt64, maxPackets: Int) -> NativeBufferRust.ReadPackets {
        let availablePackets = UInt64(bytes.count / Self.packetSizeBytes)
        if availablePackets == 0 || maxPackets <= 0 || packetIndex >= availablePackets {
            return NativeBufferRust.ReadPackets(data: [], ts_ms: [], next_packet_index: min(packetIndex, availablePackets), available_packets: availablePackets)
        }

        let toRead = UInt64(min(maxPackets, Int(availablePackets - packetIndex)))
        let startByte = Int(packetIndex) * Self.packetSizeBytes
        let endByte = min(bytes.count, startByte + Int(toRead) * Self.packetSizeBytes)
        let dataSlice = startByte < endByte ? Array(bytes[startByte..<endByte]) : []

        let tsStart = Int(packetIndex)
        let tsEnd = min(timestamps.count, tsStart + Int(toRead))
        let tsSlice = tsStart < tsEnd ? Array(timestamps[tsStart..<tsEnd]) : []

        return NativeBufferRust.ReadPackets(data: dataSlice, ts_ms: tsSlice, next_packet_index: packetIndex + toRead, available_packets: availablePackets)
    }
}
