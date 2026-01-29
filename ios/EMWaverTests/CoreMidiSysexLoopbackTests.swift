import CoreMIDI
import XCTest
@testable import EMWaver

final class CoreMidiSysexLoopbackTests: XCTestCase {
    private final class LoopbackContext {
        let exp: XCTestExpectation
        var accumulator = UsbMidiSysexAccumulator()
        var received: Data? = nil

        init(exp: XCTestExpectation) {
            self.exp = exp
        }
    }

    func testVirtualDestinationReceivesAndDecodesSysex() throws {
        var client: MIDIClientRef = 0
        var outPort: MIDIPortRef = 0
        var destination: MIDIEndpointRef = 0

        let exp = expectation(description: "received sysex")
        let ctx = LoopbackContext(exp: exp)
        let refCon = UnsafeMutableRawPointer(Unmanaged.passRetained(ctx).toOpaque())
        defer { Unmanaged<LoopbackContext>.fromOpaque(refCon).release() }

        XCTAssertEqual(MIDIClientCreate("emwaver-test" as CFString, nil, nil, &client), noErr)
        defer { MIDIClientDispose(client) }

        XCTAssertEqual(MIDIOutputPortCreate(client, "emwaver-test-out" as CFString, &outPort), noErr)
        defer { MIDIPortDispose(outPort) }

        let readProc: MIDIReadProc = { pktList, refCon, _ in
            guard let refCon else { return }
            let ctx = Unmanaged<LoopbackContext>.fromOpaque(refCon).takeUnretainedValue()
            var packetPtr: UnsafePointer<MIDIPacket> = withUnsafePointer(to: pktList.pointee.packet) { $0 }

            for _ in 0..<pktList.pointee.numPackets {
                let len = Int(packetPtr.pointee.length)
                let data = withUnsafeBytes(of: packetPtr.pointee.data) { raw in
                    Data(raw.prefix(len))
                }

                for sysex in ctx.accumulator.feed(data) {
                    if let superframe = UsbMidiSysex.decodeSysexToSuperframe(sysex), ctx.received == nil {
                        ctx.received = superframe
                        DispatchQueue.main.async { ctx.exp.fulfill() }
                    }
                }

                packetPtr = UnsafePointer(MIDIPacketNext(packetPtr))
            }
        }

        XCTAssertEqual(MIDIDestinationCreate(client, "emwaver-test-dest" as CFString, readProc, refCon, &destination), noErr)

        let expected = Data((0..<36).map { UInt8($0 & 0xFF) })
        let sysex = UsbMidiSysex.encodeSuperframe(expected)!

        let capacity = 2048
        let raw = UnsafeMutableRawPointer.allocate(byteCount: capacity, alignment: MemoryLayout<MIDIPacketList>.alignment)
        defer { raw.deallocate() }

        let pktList = raw.assumingMemoryBound(to: MIDIPacketList.self)
        let packet = MIDIPacketListInit(pktList)

        let ok: Bool = sysex.withUnsafeBytes { bytes in
            guard let base = bytes.bindMemory(to: UInt8.self).baseAddress else { return false }
            return MIDIPacketListAdd(pktList, capacity, packet, 0, sysex.count, base) != nil
        }
        XCTAssertTrue(ok)
        XCTAssertEqual(MIDISend(outPort, destination, pktList), noErr)

        wait(for: [exp], timeout: 2.0)
        XCTAssertEqual(ctx.received, expected)
    }
}
