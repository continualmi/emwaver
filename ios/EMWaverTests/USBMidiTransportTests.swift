import CoreMIDI
import XCTest
@testable import EMWaver

final class USBMidiTransportTests: XCTestCase {
    func testConnectionCarriesEndpointPairAndSessionKey() {
        let candidate = USBMidiTransport.PortCandidate(
            name: "Board",
            source: MIDIEndpointRef(101),
            destination: MIDIEndpointRef(202)
        )

        let connection = USBMidiTransport.Connection(candidate: candidate)

        XCTAssertEqual(connection.name, "Board")
        XCTAssertEqual(connection.source, MIDIEndpointRef(101))
        XCTAssertEqual(connection.destination, MIDIEndpointRef(202))
        XCTAssertEqual(connection.sessionKey, "usbmidi:101:202:Board")
        XCTAssertTrue(connection.isConnected)
    }

    func testConnectionReportsDisconnectedWhenEndpointPairIsIncomplete() {
        let candidate = USBMidiTransport.PortCandidate(
            name: "Missing Destination",
            source: MIDIEndpointRef(101),
            destination: MIDIEndpointRef(0)
        )

        let connection = USBMidiTransport.Connection(candidate: candidate)

        XCTAssertFalse(connection.isConnected)
    }

    func testCopiesMidiPacketListData() {
        let first = Data([0xF0, 0x01, 0x02])
        let second = Data([0x03, 0xF7])
        let capacity = 1024
        let raw = UnsafeMutableRawPointer.allocate(byteCount: capacity, alignment: MemoryLayout<MIDIPacketList>.alignment)
        defer { raw.deallocate() }

        let packetList = raw.assumingMemoryBound(to: MIDIPacketList.self)
        var packet = MIDIPacketListInit(packetList)

        first.withUnsafeBytes { bytes in
            let base = bytes.bindMemory(to: UInt8.self).baseAddress!
            packet = MIDIPacketListAdd(packetList, capacity, packet, 0, first.count, base)
        }
        second.withUnsafeBytes { bytes in
            let base = bytes.bindMemory(to: UInt8.self).baseAddress!
            _ = MIDIPacketListAdd(packetList, capacity, packet, 1, second.count, base)
        }

        XCTAssertEqual(USBMidiTransport.copyPacketData(from: packetList), [first, second])
    }
}
