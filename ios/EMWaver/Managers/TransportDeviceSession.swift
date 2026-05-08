/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

protocol TransportDeviceSession: AnyObject {
    func clearAll()
    func getRxPacketCount() -> UInt64
    func getTxPacketCount() -> UInt64
    func getRxCounter() -> UInt64
    func setRxCounter(_ value: UInt64)
    func storeBulkPkt(_ data: Data, tsMs: UInt64)
    func appendTxBytes(_ data: Data, tsMs: UInt64)
    func outgoingSamplerPolicy(for data: Data) -> SamplerLanePolicy
    func resetSamplerStreaming()
    func feedMidiBytes(_ normalized: Data, tsMs: UInt64)
    func prepareCommandResponseWait()
    func awaitCommandResponse(timeout: Int, shouldContinue: () -> Bool) -> Data?
    func loadBuffer(_ data: Data)
    func getBuffer() -> Data
    func readRxSince(packetIndex: UInt64, maxPackets: Int) -> NativeBufferRust.ReadPackets
    func readTxSince(packetIndex: UInt64, maxPackets: Int) -> NativeBufferRust.ReadPackets
    func nextRxPacket() -> (packet64: Data, tsMs: UInt64)?
    func compressDataBits(rangeStart: Int, rangeEnd: Int, numberBins: Int) -> ([Float], [Float])
    func takeRxState() -> (rxBytes: Data, rxTsMs: [UInt64], rxCounter: UInt64)
    func restoreRxState(rxBytes: Data, rxTsMs: [UInt64], rxCounter: UInt64)
}
