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
}
