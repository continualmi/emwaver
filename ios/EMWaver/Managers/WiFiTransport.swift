/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

enum WiFiTransport {
    static let transportName = "Wi-Fi"
    static let defaultPort = 3922
    private static let wifiConfigOpcode: UInt8 = 0x0A
    private static let wifiBegin: UInt8 = 0x00
    private static let wifiField: UInt8 = 0x01
    private static let wifiApply: UInt8 = 0x02
    private static let wifiClear: UInt8 = 0x03
    private static let wifiStatus: UInt8 = 0x04
    private static let wifiFieldSSID: UInt8 = 0x00
    private static let wifiFieldPassword: UInt8 = 0x01
    private static let commandChunkBytes = 13
    private static let maxSSIDBytes = 32
    private static let maxPasswordBytes = 64

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

    static func provisioningCommands(ssid: String, password: String) -> [Data]? {
        let trimmedSSID = ssid.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedSSID.isEmpty else { return nil }
        let ssidBytes = Array(trimmedSSID.utf8)
        let passwordBytes = Array(password.utf8)
        guard ssidBytes.count <= maxSSIDBytes, passwordBytes.count <= maxPasswordBytes else { return nil }

        var commands = [Data([wifiConfigOpcode, wifiBegin])]
        commands.append(contentsOf: fieldCommands(field: wifiFieldSSID, bytes: ssidBytes))
        commands.append(contentsOf: fieldCommands(field: wifiFieldPassword, bytes: passwordBytes))
        commands.append(Data([wifiConfigOpcode, wifiApply]))
        return commands
    }

    static func clearProvisioningCommand() -> Data {
        Data([wifiConfigOpcode, wifiClear])
    }

    static func statusCommand() -> Data {
        Data([wifiConfigOpcode, wifiStatus])
    }

    static func isOKResponse(_ response: Data?) -> Bool {
        response?.first == 0x80
    }

    static func statusMessage(from response: Data?) -> String? {
        guard let response, response.count >= 3, response.first == 0x80 else { return nil }
        let provisionedText = response[1] == 0 ? "unprovisioned" : "provisioned"
        let socketText = response[2] == 0 ? "idle" : "connected"
        guard response.count >= 4 else {
            return "Wi-Fi is \(provisionedText); socket is \(socketText)."
        }

        let stationText = response[3] == 0 ? "offline" : "online"
        guard response.count >= 5 else {
            return "Wi-Fi is \(provisionedText), station is \(stationText); socket is \(socketText)."
        }

        let retryText = response[4] == 0 ? "idle" : "retrying"
        guard response.count >= 7 else {
            return "Wi-Fi is \(provisionedText), station is \(stationText) (\(retryText)); socket is \(socketText)."
        }

        let reason = UInt16(response[5]) | (UInt16(response[6]) << 8)
        let reasonText = disconnectReasonText(reason)
        let runtimeText = response.count >= 13 && response[12] != 0 ? "running" : "idle"
        if let ipText = stationIP(fromStatusResponse: response) {
            return "Wi-Fi is \(provisionedText), station is \(stationText) at \(ipText) (\(retryText), \(reasonText)); socket is \(socketText); runtime is \(runtimeText)."
        }
        return "Wi-Fi is \(provisionedText), station is \(stationText) (\(retryText), \(reasonText)); socket is \(socketText); runtime is \(runtimeText)."
    }

    private static func fieldCommands(field: UInt8, bytes: [UInt8]) -> [Data] {
        guard !bytes.isEmpty else { return [] }
        var commands: [Data] = []
        var offset = 0
        while offset < bytes.count {
            let count = min(commandChunkBytes, bytes.count - offset)
            var command = Data([wifiConfigOpcode, wifiField, field, UInt8(offset), UInt8(count)])
            command.append(contentsOf: bytes[offset..<(offset + count)])
            commands.append(command)
            offset += count
        }
        return commands
    }

    private static func stationIP(fromStatusResponse response: Data) -> String? {
        guard response.count >= 12, response[7] != 0 else { return nil }
        return "\(response[8]).\(response[9]).\(response[10]).\(response[11])"
    }

    private static func disconnectReasonText(_ reason: UInt16) -> String {
        switch reason {
        case 0:
            return "no disconnect reason"
        case 2:
            return "auth expired"
        case 15:
            return "4-way handshake timeout"
        case 201:
            return "no access point"
        case 202:
            return "auth failed"
        case 203:
            return "association failed"
        case 204:
            return "handshake timeout"
        case 205:
            return "connection failed"
        default:
            return "reason \(reason)"
        }
    }

    private static func normalizedKey(_ value: String?, fallback: String) -> String {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? fallback : trimmed
    }
}
