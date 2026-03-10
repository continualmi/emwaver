import XCTest
@testable import EMWaver

final class SamplerLanePolicyTests: XCTestCase {
    func testOutgoingSampleStartEnablesSamplerStreaming() {
        let policy = SamplerLanePolicy.forOutgoingPacket(Data([0x60, 0x00, 0x01, 0x0A]), samplerStreamingActive: false)

        XCTAssertTrue(policy.nextSamplerStreamingActive)
    }

    func testOutgoingSampleStopDisablesSamplerStreaming() {
        let policy = SamplerLanePolicy.forOutgoingPacket(Data([0x60, 0x01]), samplerStreamingActive: true)

        XCTAssertFalse(policy.nextSamplerStreamingActive)
    }

    func testIncomingPolicyStoresNonEmptyCommandLane() {
        let commandLane = Data([0x80] + Array(repeating: 0x00, count: 17))
        let streamLane = Data(repeating: 0x00, count: 18)

        let policy = SamplerLanePolicy.forIncomingSuperframe(
            commandLane: commandLane,
            streamLane: streamLane,
            samplerStreamingActive: false
        )

        XCTAssertTrue(policy.shouldStoreCommandLane)
        XCTAssertFalse(policy.shouldStoreStreamLane)
    }

    func testIncomingPolicyStoresNonEmptyStreamLane() {
        let commandLane = Data(repeating: 0x00, count: 18)
        let streamLane = Data([0x01] + Array(repeating: 0x00, count: 17))

        let policy = SamplerLanePolicy.forIncomingSuperframe(
            commandLane: commandLane,
            streamLane: streamLane,
            samplerStreamingActive: false
        )

        XCTAssertFalse(policy.shouldStoreCommandLane)
        XCTAssertTrue(policy.shouldStoreStreamLane)
    }

    func testIncomingPolicyStoresZeroStreamLaneWhileSampling() {
        let commandLane = Data(repeating: 0x00, count: 18)
        let streamLane = Data(repeating: 0x00, count: 18)

        let policy = SamplerLanePolicy.forIncomingSuperframe(
            commandLane: commandLane,
            streamLane: streamLane,
            samplerStreamingActive: true
        )

        XCTAssertFalse(policy.shouldStoreCommandLane)
        XCTAssertTrue(policy.shouldStoreStreamLane)
    }

    func testIncomingPolicyDropsZeroStreamLaneWhenNotSampling() {
        let commandLane = Data(repeating: 0x00, count: 18)
        let streamLane = Data(repeating: 0x00, count: 18)

        let policy = SamplerLanePolicy.forIncomingSuperframe(
            commandLane: commandLane,
            streamLane: streamLane,
            samplerStreamingActive: false
        )

        XCTAssertFalse(policy.shouldStoreCommandLane)
        XCTAssertFalse(policy.shouldStoreStreamLane)
    }
}
