/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

enum WiFiTransport {
    static let transportName = "Wi-Fi"

    final class Connection: TransportDeviceConnection {
        let hostOrDeviceId: String
        let sessionKey: String
        let displayName: String
        let session: TransportDeviceSession

        init(hostOrDeviceId: String?, session: TransportDeviceSession? = nil) {
            let key = WiFiTransport.normalizedKey(hostOrDeviceId, fallback: "active")
            self.hostOrDeviceId = key
            self.sessionKey = WiFiTransport.sessionKey(for: key)
            self.displayName = WiFiTransport.displayName(for: key)
            self.session = session ?? DeviceBufferSession()
        }
    }

    static func sessionKey(for hostOrDeviceId: String?) -> String {
        let key = normalizedKey(hostOrDeviceId, fallback: "active")
        return "wifi:\(key)"
    }

    static func displayName(for hostOrDeviceId: String?) -> String {
        let key = normalizedKey(hostOrDeviceId, fallback: "device")
        return "\(transportName): \(key)"
    }

    private static func normalizedKey(_ value: String?, fallback: String) -> String {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? fallback : trimmed
    }
}
