/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

final class TransportDeviceConnectionState<Transport: Equatable> {
    private let noneTransport: Transport
    private var connectionsByDeviceId: [String: TransportDeviceConnection] = [:]
    private var target: ActiveDeviceTarget<Transport>
    private(set) var connection: TransportDeviceConnection?

    init(noneTransport: Transport) {
        self.noneTransport = noneTransport
        self.target = ActiveDeviceTarget(deviceId: "active", transport: noneTransport)
    }

    @discardableResult
    func setTarget(deviceId: String, transport: Transport) -> ActiveDeviceTarget<Transport> {
        let target = ActiveDeviceTarget(deviceId: deviceId, transport: transport)
        self.target = target
        connection = nil
        return target
    }

    func setConnection(_ connection: TransportDeviceConnection?) {
        self.connection = connection
        if let connection {
            connectionsByDeviceId[Self.normalize(connection.sessionKey)] = connection
        }
    }

    func clear() {
        target = ActiveDeviceTarget(deviceId: "active", transport: noneTransport)
        connection = nil
        connectionsByDeviceId.removeAll()
    }

    func clear(transport: Transport) {
        guard matchesTransport(transport) else { return }
        clear()
    }

    var currentScriptDeviceId: String {
        connection?.sessionKey ?? target.deviceId
    }

    var transport: Transport {
        target.transport
    }

    func matchesDeviceId(_ deviceId: String?) -> Bool {
        target.matchesDeviceId(deviceId)
    }

    func matchesTransport(_ transport: Transport) -> Bool {
        target.matchesTransport(transport)
    }

    func connection(for deviceId: String?) -> TransportDeviceConnection? {
        connectionsByDeviceId[Self.normalize(deviceId)]
    }

    private static func normalize(_ deviceId: String?) -> String {
        let key = deviceId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let normalized = key.isEmpty ? "active" : key
        return normalized.lowercased()
    }
}
