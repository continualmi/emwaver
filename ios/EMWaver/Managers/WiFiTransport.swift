/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

enum WiFiTransport {
    static let transportName = "Wi-Fi"
    static let defaultPort = 3922

    final class Connection: TransportDeviceConnection {
        let hostOrDeviceId: String
        let host: String
        let port: Int
        let sessionKey: String
        let displayName: String
        let session: TransportDeviceSession
        private let task: URLSessionWebSocketTask?

        init(hostOrDeviceId: String?, session: TransportDeviceSession? = nil) {
            self.host = WiFiTransport.normalizedKey(hostOrDeviceId, fallback: "active")
            self.port = WiFiTransport.defaultPort
            let key = "\(host):\(port)"
            self.hostOrDeviceId = key
            self.sessionKey = WiFiTransport.sessionKey(for: key)
            self.displayName = WiFiTransport.displayName(for: key)
            self.session = session ?? DeviceBufferSession()
            self.task = nil
        }

        init(host: String, port: Int, session: TransportDeviceSession, task: URLSessionWebSocketTask) {
            self.host = WiFiTransport.normalizedKey(host, fallback: "active")
            self.port = WiFiTransport.isValidPort(port) ? port : WiFiTransport.defaultPort
            let key = "\(self.host):\(self.port)"
            self.hostOrDeviceId = key
            self.sessionKey = WiFiTransport.sessionKey(for: key)
            self.displayName = WiFiTransport.displayName(for: key)
            self.session = session
            self.task = task
        }

        var isOpen: Bool {
            task != nil
        }

        func sendSysex(_ sysex: Data) {
            task?.send(.data(sysex)) { _ in }
        }

        func close() {
            task?.cancel(with: .normalClosure, reason: nil)
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

    static func isValidPort(_ port: Int) -> Bool {
        (1...65535).contains(port)
    }

    static func isValidManualHost(_ host: String?) -> Bool {
        let value = normalizedKey(host, fallback: "")
        return !value.isEmpty
            && !value.contains("://")
            && !value.contains("/")
            && !value.contains("?")
            && !value.contains("#")
            && !value.contains("@")
            && !value.contains("[")
            && !value.contains("]")
            && value.rangeOfCharacter(from: .whitespacesAndNewlines) == nil
    }

    static func webSocketURL(host: String?, port: Int) -> URL? {
        guard isValidManualHost(host), isValidPort(port) else { return nil }
        let safeHost = normalizedKey(host, fallback: "")
        let urlHost = safeHost.contains(":") ? "[\(safeHost)]" : safeHost
        return URL(string: "ws://\(urlHost):\(port)/v1/ws")
    }

    static func openConnection(
        host: String,
        port: Int,
        session: TransportDeviceSession,
        onBytes: @escaping (Data) -> Void,
        onFailure: @escaping (Error) -> Void
    ) -> Connection? {
        guard let url = webSocketURL(host: host, port: port) else { return nil }
        let task = URLSession.shared.webSocketTask(with: url)
        let connection = Connection(host: host, port: port, session: session, task: task)
        task.resume()
        receiveLoop(task: task, onBytes: onBytes, onFailure: onFailure)
        return connection
    }

    private static func receiveLoop(
        task: URLSessionWebSocketTask,
        onBytes: @escaping (Data) -> Void,
        onFailure: @escaping (Error) -> Void
    ) {
        task.receive { result in
            switch result {
            case .success(.data(let data)):
                onBytes(data)
                receiveLoop(task: task, onBytes: onBytes, onFailure: onFailure)
            case .success(.string(let text)):
                if text.localizedCaseInsensitiveContains("busy") {
                    return
                }
                receiveLoop(task: task, onBytes: onBytes, onFailure: onFailure)
            case .success:
                receiveLoop(task: task, onBytes: onBytes, onFailure: onFailure)
            case .failure(let error):
                onFailure(error)
            }
        }
    }

    private static func normalizedKey(_ value: String?, fallback: String) -> String {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? fallback : trimmed
    }
}
