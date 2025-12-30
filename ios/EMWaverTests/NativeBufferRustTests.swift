import XCTest

final class NativeBufferRustTests: XCTestCase {
    func testMakePacket64RejectsOversize() {
        let data = Data(repeating: 0x41, count: 65)
        XCTAssertNil(NativeBufferRust.makePacket64(data))
    }

    func testStoreBulkPktTimestampsPerCompletedPacket() {
        NativeBufferRust.clearAll()

        NativeBufferRust.storeBulkPkt(Data(repeating: 0, count: 10), tsMs: 111)
        NativeBufferRust.storeBulkPkt(Data(repeating: 0, count: 54), tsMs: 222)

        let rp = NativeBufferRust.readRxSince(packetIndex: 0, maxPackets: 10)
        XCTAssertEqual(rp.available_packets, 1)
        XCTAssertEqual(rp.next_packet_index, 1)
        XCTAssertEqual(rp.ts_ms, [222])
        XCTAssertEqual(rp.data.count, 64)
    }

    func testCompressBitsNonEmpty() {
        NativeBufferRust.clearAll()
        NativeBufferRust.loadBuffer(Data([0xFF])) // 8 bits all high

        let (t, v) = NativeBufferRust.compressDataBits(rangeStart: 0, rangeEnd: 8, numberBins: 4)
        XCTAssertEqual(t.count, 8)
        XCTAssertEqual(v.count, 8)
        XCTAssertTrue(v.allSatisfy { $0 == 255.0 })
    }
}
