/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation
import Network
import CryptoKit

struct MacWiFiDeviceRecord: Identifiable, Equatable {
    let id: String
    var displayName: String
    var host: String
    var port: Int
    var boardType: String?
    var firmwareVersion: String?
    var protocolVersion: String?
    var capabilities: [String]
    var isPaired: Bool
    var lastSeen: Date
}

final class MacWiFiManager {
    static let defaultPort = 3922
    static let serviceType = "_emwaver._tcp"

    private struct PairedWiFiDevice: Codable {
        var host: String
        var port: Int
        var displayName: String
        var secret: String
        var lastSeen: Date
    }

    private struct WiFiAuth: Codable {
        var type: String
        var client: String
        var protocolVersion: Int
        var challenge: String
        var response: String
    }

    private struct WiFiChallenge: Codable {
        var type: String
        var challenge: String
    }

    private struct BonjourMetadata {
        var boardType: String?
        var firmwareVersion: String?
        var protocolVersion: String?
        var capabilities: [String] = []
    }

    private static let pairingStoreKey = "com.emwaver.macos.pairedWifiDevices.v1"

    private let queue = DispatchQueue(label: "com.emwaver.macos.wifi", qos: .userInitiated)
    private let onDevicesChanged: ([MacWiFiDeviceRecord]) -> Void
    private let onData: (Data, String?) -> Void
    private let onError: (String) -> Void
    private let onConnected: (MacWiFiDeviceRecord) -> Void
    private let onDisconnected: (String?) -> Void

    private var browser: NWBrowser?
    private var discoveredDevicesByID: [String: MacWiFiDeviceRecord] = [:]
    private var pairedDevicesByID: [String: PairedWiFiDevice] = [:]
    private var socket: URLSessionWebSocketTask?
    private var connectedDeviceID: String?
    private var pendingAuthSecret: String?
    private var pendingAuthRecord: MacWiFiDeviceRecord?
    private var authTimeoutWorkItem: DispatchWorkItem?
    private var pendingPairingRollback: (id: String, previous: PairedWiFiDevice?)?

    init(
        onDevicesChanged: @escaping ([MacWiFiDeviceRecord]) -> Void,
        onData: @escaping (Data, String?) -> Void,
        onError: @escaping (String) -> Void,
        onConnected: @escaping (MacWiFiDeviceRecord) -> Void,
        onDisconnected: @escaping (String?) -> Void
    ) {
        self.onDevicesChanged = onDevicesChanged
        self.onData = onData
        self.onError = onError
        self.onConnected = onConnected
        self.onDisconnected = onDisconnected
        loadPairedDevices()
    }

    var activeDeviceID: String? {
        connectedDeviceID
    }

    var isConnected: Bool {
        socket != nil && connectedDeviceID != nil
    }

    func startDiscovery() {
        let browser = NWBrowser(
            for: .bonjour(type: Self.serviceType, domain: nil),
            using: .tcp
        )
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            self?.queue.async {
                self?.handleBrowseResults(results)
            }
        }
        browser.stateUpdateHandler = { [weak self] state in
            if case .failed(let error) = state {
                self?.onError("Wi-Fi discovery failed: \(error.localizedDescription)")
            }
        }
        self.browser = browser
        browser.start(queue: queue)
        publishDevices()
    }

    func devices() -> [MacWiFiDeviceRecord] {
        queue.sync {
            Array(discoveredDevicesByID.values).sorted { $0.displayName < $1.displayName }
        }
    }

    func record(id: String) -> MacWiFiDeviceRecord? {
        queue.sync { discoveredDevicesByID[id] }
    }

    func connect(host: String, port: Int = MacWiFiManager.defaultPort, pairingSecret: String) {
        let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSecret = pairingSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        queue.async {
            guard !trimmedHost.isEmpty else {
                self.onError("Wi-Fi host is required")
                return
            }
            guard !trimmedSecret.isEmpty else {
                self.onError("Wi-Fi pairing secret is required")
                return
            }
            guard Self.isValidPort(port) else {
                self.onError("Wi-Fi port must be between 1 and 65535")
                return
            }

            let safePort = port
            let id = Self.deviceID(host: trimmedHost, port: safePort)
            let record = MacWiFiDeviceRecord(
                id: id,
                displayName: trimmedHost,
                host: trimmedHost,
                port: safePort,
                boardType: "esp32s3",
                firmwareVersion: nil,
                protocolVersion: "1",
                capabilities: ["wifi"],
                isPaired: true,
                lastSeen: Date()
            )
            self.discoveredDevicesByID[id] = record
            self.pendingPairingRollback = (id: id, previous: self.pairedDevicesByID[id])
            self.pairedDevicesByID[id] = PairedWiFiDevice(
                host: trimmedHost,
                port: safePort,
                displayName: trimmedHost,
                secret: trimmedSecret,
                lastSeen: Date()
            )
            self.savePairedDevices()
            self.publishDevices()
            self.connect(record: record)
        }
    }

    func storePairing(host: String, port: Int = MacWiFiManager.defaultPort, displayName: String? = nil, pairingSecret: String) {
        let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSecret = pairingSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedName = displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        queue.async {
            guard !trimmedHost.isEmpty, !trimmedSecret.isEmpty else { return }

            let safePort = Self.isValidPort(port) ? port : Self.defaultPort
            let id = Self.deviceID(host: trimmedHost, port: safePort)
            let visibleName = (trimmedName?.isEmpty == false ? trimmedName! : trimmedHost)
            self.pairedDevicesByID[id] = PairedWiFiDevice(
                host: trimmedHost,
                port: safePort,
                displayName: visibleName,
                secret: trimmedSecret,
                lastSeen: Date()
            )
            self.discoveredDevicesByID[id] = MacWiFiDeviceRecord(
                id: id,
                displayName: visibleName,
                host: trimmedHost,
                port: safePort,
                boardType: "esp32s3",
                firmwareVersion: nil,
                protocolVersion: "1",
                capabilities: ["wifi"],
                isPaired: true,
                lastSeen: Date()
            )
            self.savePairedDevices()
            self.publishDevices()
        }
    }

    func removePairing(host: String, port: Int = MacWiFiManager.defaultPort) {
        let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        queue.async {
            guard !trimmedHost.isEmpty else { return }

            let safePort = Self.isValidPort(port) ? port : Self.defaultPort
            let id = Self.deviceID(host: trimmedHost, port: safePort)
            self.pairedDevicesByID.removeValue(forKey: id)
            if var record = self.discoveredDevicesByID[id] {
                record.isPaired = false
                self.discoveredDevicesByID[id] = record
            }
            self.savePairedDevices()
            self.publishDevices()
        }
    }

    func connect(record: MacWiFiDeviceRecord) {
        queue.async {
            guard let paired = self.pairedDevicesByID[record.id], !paired.secret.isEmpty else {
                self.onError("Pair this Wi-Fi device locally before connecting")
                return
            }
            if let protocolVersion = record.protocolVersion, protocolVersion != "1" {
                self.onError("Firmware does not support this Wi-Fi transport protocol")
                return
            }
            if !record.capabilities.isEmpty && !record.capabilities.contains("wifi") {
                self.onError("Firmware does not advertise Wi-Fi transport support")
                return
            }
            guard let url = URL(string: "ws://\(record.host):\(record.port)/v1/ws") else {
                self.onError("Invalid Wi-Fi device address")
                return
            }

            self.disconnect(notify: false)

            let socket = URLSession.shared.webSocketTask(with: url)
            self.socket = socket
            self.connectedDeviceID = nil
            self.pendingAuthSecret = paired.secret
            self.pendingAuthRecord = record

            socket.resume()
            self.receiveLoop(socket: socket)
            self.scheduleAuthTimeout(for: socket)
            self.publishDevices()
        }
    }

    func send(_ data: Data) {
        queue.async {
            guard let socket = self.socket else {
                self.onError("Wi-Fi write failed: Not connected")
                return
            }
            socket.send(.data(data)) { [weak self] error in
                if let error {
                    self?.onError("Wi-Fi write failed: \(error.localizedDescription)")
                }
            }
        }
    }

    func disconnect() {
        queue.async {
            self.disconnect(notify: true)
        }
    }

    private func disconnect(notify: Bool) {
        let oldID = connectedDeviceID
        let wasAuthenticated = connectedDeviceID != nil
        authTimeoutWorkItem?.cancel()
        authTimeoutWorkItem = nil
        if !wasAuthenticated {
            rollbackPendingPairing()
        }
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        connectedDeviceID = nil
        pendingAuthSecret = nil
        pendingAuthRecord = nil
        if notify {
            onDisconnected(oldID)
        }
        publishDevices()
    }

    private func handleBrowseResults(_ results: Set<NWBrowser.Result>) {
        var advertisedIDs = Set<String>()
        for result in results {
            guard case let .service(name, type, domain, _) = result.endpoint,
                  type == Self.serviceType else { continue }
            let host = "\(name).\(domain)"
                .replacingOccurrences(of: "..", with: ".")
                .trimmingCharacters(in: CharacterSet(charactersIn: "."))
            let id = Self.deviceID(host: host, port: Self.defaultPort)
            advertisedIDs.insert(id)
            let metadata = Self.bonjourMetadata(from: result.metadata)
            discoveredDevicesByID[id] = MacWiFiDeviceRecord(
                id: id,
                displayName: name.isEmpty ? host : name,
                host: host,
                port: Self.defaultPort,
                boardType: metadata.boardType ?? "esp32s3",
                firmwareVersion: metadata.firmwareVersion,
                protocolVersion: metadata.protocolVersion,
                capabilities: metadata.capabilities,
                isPaired: pairedDevicesByID[id] != nil,
                lastSeen: Date()
            )
        }

        for id in discoveredDevicesByID.keys where !advertisedIDs.contains(id) && pairedDevicesByID[id] == nil {
            discoveredDevicesByID.removeValue(forKey: id)
        }

        for (id, paired) in pairedDevicesByID where discoveredDevicesByID[id] == nil {
            discoveredDevicesByID[id] = MacWiFiDeviceRecord(
                id: id,
                displayName: paired.displayName,
                host: paired.host,
                port: paired.port,
                boardType: "esp32s3",
                firmwareVersion: nil,
                protocolVersion: "1",
                capabilities: ["wifi"],
                isPaired: true,
                lastSeen: paired.lastSeen
            )
        }

        publishDevices()
    }

    private func sendHello(socket: URLSessionWebSocketTask, secret: String, challenge: String) {
        let response = Self.hmacHex(secret: secret, message: challenge)
        let hello = WiFiAuth(type: "auth", client: "emwaver-macos", protocolVersion: 1, challenge: challenge, response: response)
        guard let data = try? JSONEncoder().encode(hello) else { return }
        socket.send(.data(data)) { [weak self] error in
            if let error {
                self?.onError("Wi-Fi authentication failed: \(error.localizedDescription)")
            }
        }
    }

    private func scheduleAuthTimeout(for socket: URLSessionWebSocketTask) {
        authTimeoutWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self, weak socket] in
            guard let self,
                  let socket,
                  self.socket === socket,
                  self.connectedDeviceID == nil else {
                return
            }
            self.onError("Wi-Fi authentication timed out")
            self.rollbackPendingPairing()
            self.disconnect(notify: true)
        }
        authTimeoutWorkItem = workItem
        queue.asyncAfter(deadline: .now() + 8, execute: workItem)
    }

    private func receiveLoop(socket: URLSessionWebSocketTask) {
        socket.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .data(let data):
                    self.onData(data, self.connectedDeviceID)
                case .string(let text):
                    if let data = text.data(using: .utf8),
                       let challenge = try? JSONDecoder().decode(WiFiChallenge.self, from: data),
                       challenge.type == "challenge",
                       let secret = self.pendingAuthSecret {
                        self.sendHello(socket: socket, secret: secret, challenge: challenge.challenge)
                    } else if text.localizedCaseInsensitiveContains("auth") &&
                                text.localizedCaseInsensitiveContains("ok"),
                              let record = self.pendingAuthRecord {
                        self.authTimeoutWorkItem?.cancel()
                        self.authTimeoutWorkItem = nil
                        self.connectedDeviceID = record.id
                        self.pendingAuthSecret = nil
                        self.pendingAuthRecord = nil
                        self.pendingPairingRollback = nil
                        self.onConnected(record)
                        self.publishDevices()
                    } else if text.localizedCaseInsensitiveContains("auth") &&
                                text.localizedCaseInsensitiveContains("fail") {
                        self.onError("Wi-Fi pairing secret rejected")
                        self.queue.async {
                            if self.socket === socket {
                                self.rollbackPendingPairing()
                                self.disconnect(notify: true)
                            }
                        }
                    } else if text.localizedCaseInsensitiveContains("busy") {
                        self.onError("Wi-Fi device is busy with another session")
                        self.queue.async {
                            if self.socket === socket {
                                self.rollbackPendingPairing()
                                self.disconnect(notify: true)
                            }
                        }
                    }
                @unknown default:
                    break
                }
                self.receiveLoop(socket: socket)
            case .failure(let error):
                self.onError("Wi-Fi disconnected: \(error.localizedDescription)")
                self.queue.async {
                    if self.socket === socket {
                        if self.connectedDeviceID == nil {
                            self.rollbackPendingPairing()
                        }
                        self.disconnect(notify: true)
                    }
                }
            }
        }
    }

    private func rollbackPendingPairing() {
        guard let rollback = pendingPairingRollback else { return }
        if let previous = rollback.previous {
            pairedDevicesByID[rollback.id] = previous
            if var record = discoveredDevicesByID[rollback.id] {
                record.isPaired = true
                record.displayName = previous.displayName
                discoveredDevicesByID[rollback.id] = record
            }
        } else {
            pairedDevicesByID.removeValue(forKey: rollback.id)
            if var record = discoveredDevicesByID[rollback.id] {
                record.isPaired = false
                discoveredDevicesByID[rollback.id] = record
            }
        }
        pendingPairingRollback = nil
        savePairedDevices()
        publishDevices()
    }

    private func publishDevices() {
        onDevicesChanged(Array(discoveredDevicesByID.values).sorted { $0.displayName < $1.displayName })
    }

    private func loadPairedDevices() {
        guard let data = UserDefaults.standard.data(forKey: Self.pairingStoreKey),
              let records = try? JSONDecoder().decode([String: PairedWiFiDevice].self, from: data) else {
            return
        }
        pairedDevicesByID = records
        for (id, record) in records {
            discoveredDevicesByID[id] = MacWiFiDeviceRecord(
                id: id,
                displayName: record.displayName,
                host: record.host,
                port: record.port,
                boardType: "esp32s3",
                firmwareVersion: nil,
                protocolVersion: "1",
                capabilities: ["wifi"],
                isPaired: true,
                lastSeen: record.lastSeen
            )
        }
    }

    private func savePairedDevices() {
        guard let data = try? JSONEncoder().encode(pairedDevicesByID) else { return }
        UserDefaults.standard.set(data, forKey: Self.pairingStoreKey)
    }

    private static func deviceID(host: String, port: Int) -> String {
        "wifi:\(host.lowercased()):\(port)"
    }

    private static func isValidPort(_ port: Int) -> Bool {
        (1...65535).contains(port)
    }

    private static func bonjourMetadata(from metadata: NWBrowser.Result.Metadata) -> BonjourMetadata {
        guard case .bonjour(let txtRecord) = metadata else {
            return BonjourMetadata()
        }
        let dictionary = txtRecord.dictionary
        return BonjourMetadata(
            boardType: normalizedBoardType(dictionary["board"]),
            firmwareVersion: nonEmpty(dictionary["fw"]),
            protocolVersion: nonEmpty(dictionary["proto"]),
            capabilities: capabilities(dictionary["cap"])
        )
    }

    private static func normalizedBoardType(_ value: String?) -> String? {
        guard let value = nonEmpty(value) else { return nil }
        switch value.lowercased() {
        case "esp32s3", "esp32-s3":
            return "esp32s3"
        default:
            return value
        }
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private static func capabilities(_ value: String?) -> [String] {
        guard let value = nonEmpty(value) else { return [] }
        return value
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
    }

    private static func hmacHex(secret: String, message: String) -> String {
        let key = SymmetricKey(data: Data(secret.utf8))
        let signature = HMAC<SHA256>.authenticationCode(for: Data(message.utf8), using: key)
        return signature.map { String(format: "%02x", $0) }.joined()
    }
}
