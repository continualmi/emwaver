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

    private struct WiFiHello: Codable {
        var type: String
        var client: String
        var protocolVersion: Int
        var nonce: String
        var response: String
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

            let safePort = port > 0 ? port : Self.defaultPort
            let id = Self.deviceID(host: trimmedHost, port: safePort)
            let record = MacWiFiDeviceRecord(
                id: id,
                displayName: trimmedHost,
                host: trimmedHost,
                port: safePort,
                boardType: "esp32s3",
                isPaired: true,
                lastSeen: Date()
            )
            self.discoveredDevicesByID[id] = record
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

    func connect(record: MacWiFiDeviceRecord) {
        queue.async {
            guard let paired = self.pairedDevicesByID[record.id], !paired.secret.isEmpty else {
                self.onError("Pair this Wi-Fi device locally before connecting")
                return
            }
            guard let url = URL(string: "ws://\(record.host):\(record.port)/v1/ws") else {
                self.onError("Invalid Wi-Fi device address")
                return
            }

            self.disconnect(notify: false)

            let socket = URLSession.shared.webSocketTask(with: url)
            self.socket = socket
            self.connectedDeviceID = record.id

            socket.resume()
            self.sendHello(socket: socket, secret: paired.secret)
            self.receiveLoop(socket: socket)
            self.onConnected(record)
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
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        connectedDeviceID = nil
        if notify {
            onDisconnected(oldID)
        }
        publishDevices()
    }

    private func handleBrowseResults(_ results: Set<NWBrowser.Result>) {
        for result in results {
            guard case let .service(name, type, domain, _) = result.endpoint,
                  type == Self.serviceType else { continue }
            let host = "\(name).\(domain)"
                .replacingOccurrences(of: "..", with: ".")
                .trimmingCharacters(in: CharacterSet(charactersIn: "."))
            let id = Self.deviceID(host: host, port: Self.defaultPort)
            discoveredDevicesByID[id] = MacWiFiDeviceRecord(
                id: id,
                displayName: name.isEmpty ? host : name,
                host: host,
                port: Self.defaultPort,
                boardType: "esp32s3",
                isPaired: pairedDevicesByID[id] != nil,
                lastSeen: Date()
            )
        }

        for (id, paired) in pairedDevicesByID where discoveredDevicesByID[id] == nil {
            discoveredDevicesByID[id] = MacWiFiDeviceRecord(
                id: id,
                displayName: paired.displayName,
                host: paired.host,
                port: paired.port,
                boardType: "esp32s3",
                isPaired: true,
                lastSeen: paired.lastSeen
            )
        }

        publishDevices()
    }

    private func sendHello(socket: URLSessionWebSocketTask, secret: String) {
        let nonce = Self.randomHex(byteCount: 16)
        let response = Self.hmacHex(secret: secret, message: nonce)
        let hello = WiFiHello(type: "auth", client: "emwaver-macos", protocolVersion: 1, nonce: nonce, response: response)
        guard let data = try? JSONEncoder().encode(hello) else { return }
        socket.send(.data(data)) { [weak self] error in
            if let error {
                self?.onError("Wi-Fi authentication failed: \(error.localizedDescription)")
            }
        }
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
                    if text.localizedCaseInsensitiveContains("auth") &&
                        text.localizedCaseInsensitiveContains("fail") {
                        self.onError("Wi-Fi pairing secret rejected")
                    }
                @unknown default:
                    break
                }
                self.receiveLoop(socket: socket)
            case .failure(let error):
                self.onError("Wi-Fi disconnected: \(error.localizedDescription)")
                self.queue.async {
                    if self.socket === socket {
                        self.disconnect(notify: true)
                    }
                }
            }
        }
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

    private static func randomHex(byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: max(1, byteCount))
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    private static func hmacHex(secret: String, message: String) -> String {
        let key = SymmetricKey(data: Data(secret.utf8))
        let signature = HMAC<SHA256>.authenticationCode(for: Data(message.utf8), using: key)
        return signature.map { String(format: "%02x", $0) }.joined()
    }
}
