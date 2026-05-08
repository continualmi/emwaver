/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

final class TransportDeviceSessionRegistry {
    private var sessionsByDeviceId: [String: TransportDeviceSession] = [:]
    private var activeSession: TransportDeviceSession = DeviceBufferSession()

    var active: TransportDeviceSession {
        activeSession
    }

    func session(deviceId: String) -> TransportDeviceSession {
        let key = Self.normalize(deviceId)
        let lookupKey = key.lowercased()
        if let session = sessionsByDeviceId[lookupKey] {
            return session
        }

        let session = DeviceBufferSession()
        sessionsByDeviceId[lookupKey] = session
        return session
    }

    @discardableResult
    func select(deviceId: String, resetSession: Bool) -> TransportDeviceSession {
        let session = session(deviceId: deviceId)
        activeSession = session
        if resetSession {
            session.clearAll()
        }
        return session
    }

    private static func normalize(_ deviceId: String) -> String {
        let key = deviceId.trimmingCharacters(in: .whitespacesAndNewlines)
        return key.isEmpty ? "active" : key
    }
}
