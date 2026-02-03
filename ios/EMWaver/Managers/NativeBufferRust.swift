/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

import Foundation

// iOS: intentionally avoid the Rust buffer-core static lib.
// This keeps the same API surface (NativeBufferRust) so USBManager code stays stable,
// but implements the buffer logic in Swift.
final class NativeBufferRust {
    // PACKET_SIZE from Rust buffer core: fixed 18B.
    static let packetSizeBytes: Int = 18

    private init() {}

    struct ReadPackets {
        let data: [UInt8]
        let ts_ms: [UInt64]
        let next_packet_index: UInt64
        let available_packets: UInt64
    }

    struct TxProfile {
        let max_packet_size: Int32
        let min_packet_size: Int32
        let initial_packet_size: Int32
        let fixed_delay_ms: Int32
        let target_buffer_level: Int32
        let buffer_high_threshold: Int32
        let buffer_low_threshold: Int32
        let initial_fill_bytes: Int32
        let nudge_band: Int32
        let step_large: Int32
        let step_small: Int32
    }

    // MARK: - Managed state

    private static let lock = NSLock()

    private static var rxBytes: [UInt8] = []
    // One timestamp per completed 18B packet.
    private static var rxTsMs: [UInt64] = []
    // Packet cursor used by nextRxPacket.
    private static var rxCounter: UInt64 = 0

    private static var txBytes: [UInt8] = []
    // One timestamp per 18B packet.
    private static var txTsMs: [UInt64] = []

    // MARK: - Buffer APIs

    static func clearAll() {
        lock.lock(); defer { lock.unlock() }
        rxBytes = []
        rxTsMs = []
        rxCounter = 0
        txBytes = []
        txTsMs = []
    }

    static func getRxPacketCount() -> UInt64 {
        lock.lock(); defer { lock.unlock() }
        return UInt64(rxBytes.count / packetSizeBytes)
    }

    static func getTxPacketCount() -> UInt64 {
        lock.lock(); defer { lock.unlock() }
        return UInt64(txTsMs.count)
    }

    static func getRxCounter() -> UInt64 {
        lock.lock(); defer { lock.unlock() }
        return rxCounter
    }

    static func setRxCounter(_ value: UInt64) {
        lock.lock(); defer { lock.unlock() }
        let packets = UInt64(rxBytes.count / packetSizeBytes)
        rxCounter = min(value, packets)
    }

    static func storeBulkPkt(_ data: Data, tsMs: UInt64) {
        if data.isEmpty { return }
        lock.lock(); defer { lock.unlock() }

        let prevPackets = rxBytes.count / packetSizeBytes
        rxBytes.append(contentsOf: data)
        let newPackets = rxBytes.count / packetSizeBytes
        let delta = max(0, newPackets - prevPackets)
        if delta > 0 {
            rxTsMs.append(contentsOf: Array(repeating: tsMs, count: delta))
        }
    }

    static func appendTxBytes(_ data: Data, tsMs: UInt64) {
        if data.isEmpty { return }
        lock.lock(); defer { lock.unlock() }

        // Log as padded 18B packets with one ts per packet.
        var offset = 0
        while offset < data.count {
            let take = min(packetSizeBytes, data.count - offset)
            var pkt = [UInt8](repeating: 0, count: packetSizeBytes)
            data.copyBytes(to: &pkt, from: offset..<(offset + take))
            txBytes.append(contentsOf: pkt)
            txTsMs.append(tsMs)
            offset += take
        }
    }

    static func loadBuffer(_ data: Data) {
        lock.lock(); defer { lock.unlock() }
        rxBytes = Array(data)
        rxCounter = 0
        let packets = rxBytes.count / packetSizeBytes
        rxTsMs = Array(repeating: 0, count: packets)
    }

    static func getBuffer() -> Data {
        lock.lock(); defer { lock.unlock() }
        return Data(rxBytes)
    }

    static func readRxSince(packetIndex: UInt64, maxPackets: Int) -> ReadPackets {
        lock.lock(); defer { lock.unlock() }

        let availablePackets = UInt64(rxBytes.count / packetSizeBytes)
        if availablePackets == 0 || maxPackets <= 0 || packetIndex >= availablePackets {
            return ReadPackets(data: [], ts_ms: [], next_packet_index: min(packetIndex, availablePackets), available_packets: availablePackets)
        }

        let toRead = UInt64(min(maxPackets, Int(availablePackets - packetIndex)))
        let startByte = Int(packetIndex) * packetSizeBytes
        let endByte = min(rxBytes.count, startByte + Int(toRead) * packetSizeBytes)
        let dataSlice = startByte < endByte ? Array(rxBytes[startByte..<endByte]) : []

        let tsStart = Int(packetIndex)
        let tsEnd = min(rxTsMs.count, tsStart + Int(toRead))
        let tsSlice = tsStart < tsEnd ? Array(rxTsMs[tsStart..<tsEnd]) : []

        return ReadPackets(data: dataSlice, ts_ms: tsSlice, next_packet_index: packetIndex + toRead, available_packets: availablePackets)
    }

    static func readTxSince(packetIndex: UInt64, maxPackets: Int) -> ReadPackets {
        lock.lock(); defer { lock.unlock() }

        let availablePackets = UInt64(txTsMs.count)
        if availablePackets == 0 || maxPackets <= 0 || packetIndex >= availablePackets {
            return ReadPackets(data: [], ts_ms: [], next_packet_index: min(packetIndex, availablePackets), available_packets: availablePackets)
        }

        let toRead = UInt64(min(maxPackets, Int(availablePackets - packetIndex)))
        let startByte = Int(packetIndex) * packetSizeBytes
        let endByte = min(txBytes.count, startByte + Int(toRead) * packetSizeBytes)
        let dataSlice = startByte < endByte ? Array(txBytes[startByte..<endByte]) : []

        let tsStart = Int(packetIndex)
        let tsEnd = min(txTsMs.count, tsStart + Int(toRead))
        let tsSlice = tsStart < tsEnd ? Array(txTsMs[tsStart..<tsEnd]) : []

        return ReadPackets(data: dataSlice, ts_ms: tsSlice, next_packet_index: packetIndex + toRead, available_packets: availablePackets)
    }

    static func nextRxPacket() -> (packet64: Data, tsMs: UInt64)? {
        lock.lock(); defer { lock.unlock() }

        let packets = UInt64(rxBytes.count / packetSizeBytes)
        if rxCounter >= packets { return nil }

        let startByte = Int(rxCounter) * packetSizeBytes
        if startByte + packetSizeBytes > rxBytes.count { return nil }

        let pkt = Data(rxBytes[startByte..<(startByte + packetSizeBytes)])
        let ts = Int(rxCounter) < rxTsMs.count ? rxTsMs[Int(rxCounter)] : 0
        rxCounter += 1
        return (pkt, ts)
    }

    static func makePacket64(_ data: Data) -> Data? {
        // Historical name: this produces an 18B packet.
        if data.count > packetSizeBytes { return nil }
        var out = [UInt8](repeating: 0, count: packetSizeBytes)
        data.copyBytes(to: &out, count: data.count)
        return Data(out)
    }

    static func parseBsStatus(_ packet64: Data) -> Int {
        // Matches crates/emwaver-buffer-core/src/status.rs
        if packet64.count < 4 { return -1 }
        let b0 = packet64[packet64.startIndex]
        let b1 = packet64[packet64.startIndex.advanced(by: 1)]
        if b0 != UInt8(ascii: "B") || b1 != UInt8(ascii: "S") { return -1 }
        let hi = UInt16(packet64[packet64.startIndex.advanced(by: 2)])
        let lo = UInt16(packet64[packet64.startIndex.advanced(by: 3)])
        return Int((hi << 8) | lo)
    }

    // MARK: - Sampler plot compression

    static func compressDataBits(rangeStart: Int, rangeEnd: Int, numberBins: Int) -> ([Float], [Float]) {
        // Matches crates/emwaver-buffer-core/src/sampler.rs compress_bits
        lock.lock(); defer { lock.unlock() }

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
            let bitIndex = i & 7
            return (buffer[byteIndex] >> bitIndex) & 1
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

    // MARK: - TX pacing (matches crates/emwaver-buffer-core/src/tx.rs)

    static func txProfile() -> TxProfile {
        TxProfile(
            max_packet_size: 240,
            min_packet_size: 128,
            initial_packet_size: 188,
            fixed_delay_ms: 15,
            target_buffer_level: 2048,
            buffer_high_threshold: 3000,
            buffer_low_threshold: 1000,
            initial_fill_bytes: 2048,
            nudge_band: 100,
            step_large: 32,
            step_small: 16
        )
    }

    static func txNextPacketSize(bytesSent: Int, lastStatus: Int, currentPacketSize: Int) -> Int {
        let p = txProfile()

        let bytesSent = max(0, bytesSent)
        let current = max(0, currentPacketSize)

        if bytesSent < Int(p.initial_fill_bytes) {
            return Int(p.max_packet_size)
        }

        if lastStatus > Int(p.buffer_high_threshold) {
            return max(Int(p.min_packet_size), current - Int(p.step_large))
        }

        if lastStatus < Int(p.buffer_low_threshold) {
            return min(Int(p.max_packet_size), current + Int(p.step_large))
        }

        if current != Int(p.initial_packet_size) && abs(lastStatus - Int(p.target_buffer_level)) < Int(p.nudge_band) {
            if current < Int(p.initial_packet_size) {
                return min(Int(p.initial_packet_size), current + Int(p.step_small))
            }
            return max(Int(p.initial_packet_size), current - Int(p.step_small))
        }

        return current
    }

    // MARK: - RX swap (used by transmit)

    static func takeRxState() -> (rxBytes: Data, rxTsMs: [UInt64], rxCounter: UInt64) {
        lock.lock(); defer { lock.unlock() }
        return (Data(rxBytes), rxTsMs, rxCounter)
    }

    static func restoreRxState(rxBytes: Data, rxTsMs: [UInt64], rxCounter: UInt64) {
        lock.lock(); defer { lock.unlock() }
        self.rxBytes = Array(rxBytes)
        self.rxTsMs = rxTsMs

        // Ensure ts length matches whole packets.
        let packets = self.rxBytes.count / packetSizeBytes
        if self.rxTsMs.count < packets {
            self.rxTsMs.append(contentsOf: Array(repeating: 0, count: packets - self.rxTsMs.count))
        } else if self.rxTsMs.count > packets {
            self.rxTsMs = Array(self.rxTsMs.prefix(packets))
        }

        self.rxCounter = min(rxCounter, UInt64(packets))
    }
}
