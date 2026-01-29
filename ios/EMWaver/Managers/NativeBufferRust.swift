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

final class NativeBufferRust {
    // PACKET_SIZE from Rust buffer core (emwaver-buffer-core): fixed 18B.
    static let packetSizeBytes: Int = 18

    private init() {}

    struct ReadPackets {
        let data: [UInt8]
        let ts_ms: [UInt64]
        let next_packet_index: UInt64
        let available_packets: UInt64
    }

    struct BleTxProfile {
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

    // MARK: - C ABI

    @_silgen_name("emw_buffer_clear_all") private static func c_clear_all()
    @_silgen_name("emw_buffer_rx_len_bytes") private static func c_rx_len_bytes() -> Int
    @_silgen_name("emw_buffer_rx_packet_count") private static func c_rx_packet_count() -> UInt64
    @_silgen_name("emw_buffer_tx_packet_count") private static func c_tx_packet_count() -> UInt64

    @_silgen_name("emw_buffer_get_rx_counter") private static func c_get_rx_counter() -> UInt64
    @_silgen_name("emw_buffer_set_rx_counter") private static func c_set_rx_counter(_ v: UInt64)
    @_silgen_name("emw_buffer_set_invert_rx") private static func c_set_invert_rx(_ enabled: Bool)

    @_silgen_name("emw_buffer_load_rx_bytes")
    private static func c_load_rx_bytes(_ data: UnsafePointer<UInt8>?, _ len: Int)

    @_silgen_name("emw_buffer_get_rx_snapshot")
    private static func c_get_rx_snapshot(_ outPtr: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>, _ outLen: UnsafeMutablePointer<Int>)

    @_silgen_name("emw_buffer_store_bulk_pkt")
    private static func c_store_bulk_pkt(_ data: UnsafePointer<UInt8>?, _ len: Int, _ ts_ms: UInt64)

    @_silgen_name("emw_buffer_append_tx_bytes")
    private static func c_append_tx_bytes(_ data: UnsafePointer<UInt8>?, _ len: Int, _ ts_ms: UInt64)

    @_silgen_name("emw_buffer_read_rx_since")
    private static func c_read_rx_since(
        _ packetIndex: UInt64,
        _ maxPackets: Int,
        _ outDataPtr: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>,
        _ outDataLen: UnsafeMutablePointer<Int>,
        _ outTsPtr: UnsafeMutablePointer<UnsafeMutablePointer<UInt64>?>,
        _ outTsLen: UnsafeMutablePointer<Int>,
        _ outNextPacketIndex: UnsafeMutablePointer<UInt64>,
        _ outAvailablePackets: UnsafeMutablePointer<UInt64>
    )

    @_silgen_name("emw_buffer_read_tx_since")
    private static func c_read_tx_since(
        _ packetIndex: UInt64,
        _ maxPackets: Int,
        _ outDataPtr: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>,
        _ outDataLen: UnsafeMutablePointer<Int>,
        _ outTsPtr: UnsafeMutablePointer<UnsafeMutablePointer<UInt64>?>,
        _ outTsLen: UnsafeMutablePointer<Int>,
        _ outNextPacketIndex: UnsafeMutablePointer<UInt64>,
        _ outAvailablePackets: UnsafeMutablePointer<UInt64>
    )

    @_silgen_name("emw_buffer_next_rx_packet")
    private static func c_next_rx_packet(
        _ outPacket64: UnsafeMutablePointer<UInt8>?,
        _ outPacket64Len: Int,
        _ outTsMs: UnsafeMutablePointer<UInt64>?
    ) -> Bool

    @_silgen_name("emw_packet_make_packet64")
    private static func c_make_packet64(
        _ data: UnsafePointer<UInt8>?,
        _ len: Int,
        _ outPacket64: UnsafeMutablePointer<UInt8>?,
        _ outPacket64Len: Int
    ) -> Bool

    @_silgen_name("emw_status_parse_bs")
    private static func c_parse_bs(_ packet64: UnsafePointer<UInt8>?, _ len: Int) -> Int32

    @_silgen_name("emw_buffer_compress_data_bits")
    private static func c_compress_data_bits(
        _ rangeStart: Int32,
        _ rangeEnd: Int32,
        _ numberBins: Int32,
        _ outTimePtr: UnsafeMutablePointer<UnsafeMutablePointer<Float>?>,
        _ outTimeLen: UnsafeMutablePointer<Int>,
        _ outDataPtr: UnsafeMutablePointer<UnsafeMutablePointer<Float>?>,
        _ outDataLen: UnsafeMutablePointer<Int>
    )

    @_silgen_name("emw_tx_ble_profile_default")
    private static func c_tx_ble_profile_default() -> BleTxProfile

    @_silgen_name("emw_tx_ble_next_packet_size")
    private static func c_tx_ble_next_packet_size(_ bytesSent: Int32, _ lastStatus: Int32, _ currentPacketSize: Int32) -> Int32

    @_silgen_name("emw_buffer_take_rx_state")
    private static func c_take_rx_state(
        _ outBytesPtr: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>,
        _ outBytesLen: UnsafeMutablePointer<Int>,
        _ outTsPtr: UnsafeMutablePointer<UnsafeMutablePointer<UInt64>?>,
        _ outTsLen: UnsafeMutablePointer<Int>,
        _ outRxCounter: UnsafeMutablePointer<UInt64>
    )

    @_silgen_name("emw_buffer_restore_rx_state")
    private static func c_restore_rx_state(
        _ rxBytes: UnsafePointer<UInt8>?,
        _ rxBytesLen: Int,
        _ rxTs: UnsafePointer<UInt64>?,
        _ rxTsLen: Int,
        _ rxCounter: UInt64
    )

    @_silgen_name("emw_free_u8") private static func c_free_u8(_ ptr: UnsafeMutablePointer<UInt8>?, _ len: Int)
    @_silgen_name("emw_free_u64") private static func c_free_u64(_ ptr: UnsafeMutablePointer<UInt64>?, _ len: Int)
    @_silgen_name("emw_free_f32") private static func c_free_f32(_ ptr: UnsafeMutablePointer<Float>?, _ len: Int)

    // MARK: - Public API (Swift-friendly)

    static func clearAll() {
        c_clear_all()
    }

    static func getBufferLength() -> Int {
        c_rx_len_bytes()
    }

    static func getRxPacketCount() -> UInt64 {
        c_rx_packet_count()
    }

    static func getTxPacketCount() -> UInt64 {
        c_tx_packet_count()
    }

    static func getRxCounter() -> UInt64 {
        c_get_rx_counter()
    }

    static func setRxCounter(_ value: UInt64) {
        c_set_rx_counter(value)
    }

    static func setInvertRx(_ enabled: Bool) {
        c_set_invert_rx(enabled)
    }

    static func loadBuffer(_ data: Data) {
        data.withUnsafeBytes { raw in
            c_load_rx_bytes(raw.bindMemory(to: UInt8.self).baseAddress, data.count)
        }
    }

    static func getBuffer() -> Data {
        var ptr: UnsafeMutablePointer<UInt8>? = nil
        var len: Int = 0
        c_get_rx_snapshot(&ptr, &len)
        guard let ptr, len > 0 else { return Data() }
        let data = Data(bytes: ptr, count: len)
        c_free_u8(ptr, len)
        return data
    }

    static func storeBulkPkt(_ data: Data, tsMs: UInt64) {
        data.withUnsafeBytes { raw in
            c_store_bulk_pkt(raw.bindMemory(to: UInt8.self).baseAddress, data.count, tsMs)
        }
    }

    static func appendTxBytes(_ data: Data, tsMs: UInt64) {
        data.withUnsafeBytes { raw in
            c_append_tx_bytes(raw.bindMemory(to: UInt8.self).baseAddress, data.count, tsMs)
        }
    }

    static func readRxSince(packetIndex: UInt64, maxPackets: Int) -> ReadPackets {
        var dataPtr: UnsafeMutablePointer<UInt8>? = nil
        var dataLen: Int = 0
        var tsPtr: UnsafeMutablePointer<UInt64>? = nil
        var tsLen: Int = 0
        var nextIndex: UInt64 = 0
        var available: UInt64 = 0

        c_read_rx_since(packetIndex, maxPackets, &dataPtr, &dataLen, &tsPtr, &tsLen, &nextIndex, &available)

        let data: [UInt8]
        if let dataPtr, dataLen > 0 {
            data = Array(UnsafeBufferPointer(start: dataPtr, count: dataLen))
            c_free_u8(dataPtr, dataLen)
        } else {
            data = []
        }

        let ts: [UInt64]
        if let tsPtr, tsLen > 0 {
            ts = Array(UnsafeBufferPointer(start: tsPtr, count: tsLen))
            c_free_u64(tsPtr, tsLen)
        } else {
            ts = []
        }

        return ReadPackets(data: data, ts_ms: ts, next_packet_index: nextIndex, available_packets: available)
    }

    static func readTxSince(packetIndex: UInt64, maxPackets: Int) -> ReadPackets {
        var dataPtr: UnsafeMutablePointer<UInt8>? = nil
        var dataLen: Int = 0
        var tsPtr: UnsafeMutablePointer<UInt64>? = nil
        var tsLen: Int = 0
        var nextIndex: UInt64 = 0
        var available: UInt64 = 0

        c_read_tx_since(packetIndex, maxPackets, &dataPtr, &dataLen, &tsPtr, &tsLen, &nextIndex, &available)

        let data: [UInt8]
        if let dataPtr, dataLen > 0 {
            data = Array(UnsafeBufferPointer(start: dataPtr, count: dataLen))
            c_free_u8(dataPtr, dataLen)
        } else {
            data = []
        }

        let ts: [UInt64]
        if let tsPtr, tsLen > 0 {
            ts = Array(UnsafeBufferPointer(start: tsPtr, count: tsLen))
            c_free_u64(tsPtr, tsLen)
        } else {
            ts = []
        }

        return ReadPackets(data: data, ts_ms: ts, next_packet_index: nextIndex, available_packets: available)
    }

    static func nextRxPacket() -> (packet64: Data, tsMs: UInt64)? {
        var out = [UInt8](repeating: 0, count: packetSizeBytes)
        var ts: UInt64 = 0
        let ok = out.withUnsafeMutableBufferPointer { buf in
            c_next_rx_packet(buf.baseAddress, buf.count, &ts)
        }
        guard ok else { return nil }
        return (Data(out), ts)
    }

    static func makePacket64(_ data: Data) -> Data? {
        var out = [UInt8](repeating: 0, count: packetSizeBytes)
        let ok = out.withUnsafeMutableBufferPointer { outBuf in
            data.withUnsafeBytes { raw in
                c_make_packet64(raw.bindMemory(to: UInt8.self).baseAddress, data.count, outBuf.baseAddress, outBuf.count)
            }
        }
        return ok ? Data(out) : nil
    }

    static func parseBsStatus(_ packet64: Data) -> Int {
        packet64.withUnsafeBytes { raw in
            Int(c_parse_bs(raw.bindMemory(to: UInt8.self).baseAddress, packet64.count))
        }
    }

    static func compressDataBits(rangeStart: Int, rangeEnd: Int, numberBins: Int) -> ([Float], [Float]) {
        var timePtr: UnsafeMutablePointer<Float>? = nil
        var timeLen: Int = 0
        var dataPtr: UnsafeMutablePointer<Float>? = nil
        var dataLen: Int = 0

        c_compress_data_bits(Int32(rangeStart), Int32(rangeEnd), Int32(numberBins), &timePtr, &timeLen, &dataPtr, &dataLen)

        let timeValues: [Float]
        if let timePtr, timeLen > 0 {
            timeValues = Array(UnsafeBufferPointer(start: timePtr, count: timeLen))
            c_free_f32(timePtr, timeLen)
        } else {
            timeValues = []
        }

        let dataValues: [Float]
        if let dataPtr, dataLen > 0 {
            dataValues = Array(UnsafeBufferPointer(start: dataPtr, count: dataLen))
            c_free_f32(dataPtr, dataLen)
        } else {
            dataValues = []
        }

        return (timeValues, dataValues)
    }

    static func txBleProfile() -> BleTxProfile {
        c_tx_ble_profile_default()
    }

    static func txBleNextPacketSize(bytesSent: Int, lastStatus: Int, currentPacketSize: Int) -> Int {
        Int(c_tx_ble_next_packet_size(Int32(bytesSent), Int32(lastStatus), Int32(currentPacketSize)))
    }

    static func takeRxState() -> (rxBytes: Data, rxTsMs: [UInt64], rxCounter: UInt64) {
        var bytesPtr: UnsafeMutablePointer<UInt8>? = nil
        var bytesLen: Int = 0
        var tsPtr: UnsafeMutablePointer<UInt64>? = nil
        var tsLen: Int = 0
        var counter: UInt64 = 0

        c_take_rx_state(&bytesPtr, &bytesLen, &tsPtr, &tsLen, &counter)

        let rxBytes: Data
        if let bytesPtr, bytesLen > 0 {
            rxBytes = Data(bytes: bytesPtr, count: bytesLen)
            c_free_u8(bytesPtr, bytesLen)
        } else {
            rxBytes = Data()
        }

        let rxTs: [UInt64]
        if let tsPtr, tsLen > 0 {
            rxTs = Array(UnsafeBufferPointer(start: tsPtr, count: tsLen))
            c_free_u64(tsPtr, tsLen)
        } else {
            rxTs = []
        }

        return (rxBytes, rxTs, counter)
    }

    static func restoreRxState(rxBytes: Data, rxTsMs: [UInt64], rxCounter: UInt64) {
        rxBytes.withUnsafeBytes { rawBytes in
            rxTsMs.withUnsafeBufferPointer { tsBuf in
                c_restore_rx_state(
                    rawBytes.bindMemory(to: UInt8.self).baseAddress,
                    rxBytes.count,
                    tsBuf.baseAddress,
                    tsBuf.count,
                    rxCounter
                )
            }
        }
    }
}
