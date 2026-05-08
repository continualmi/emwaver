/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

struct ActiveDeviceTarget<Transport: Equatable> {
    let deviceId: String
    let transport: Transport

    init(deviceId: String, transport: Transport) {
        let key = deviceId.trimmingCharacters(in: .whitespacesAndNewlines)
        self.deviceId = key.isEmpty ? "active" : key
        self.transport = transport
    }

    func matchesDeviceId(_ deviceId: String?) -> Bool {
        let key = deviceId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let requested = key.isEmpty ? "active" : key
        return requested.caseInsensitiveCompare(self.deviceId) == .orderedSame
    }

    func matchesTransport(_ transport: Transport) -> Bool {
        self.transport == transport
    }
}
