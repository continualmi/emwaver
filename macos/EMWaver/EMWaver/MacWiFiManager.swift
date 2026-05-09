/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation
import Network
import CryptoKit
import Darwin

struct MacWiFiDeviceRecord: Identifiable, Equatable {
    let id: String
    var displayName: String
    var host: String
    var port: Int
    var localIdentifier: String?
    var boardType: String?
    var firmwareVersion: String?
    var protocolVersion: String?
    var capabilities: [String]
    var isPaired: Bool
    var isAdvertised: Bool
    var lastSeen: Date
}

final class MacWiFiManager {
    static let defaultPort = 3922
    static let serviceType = "_emwaver._tcp"

    private struct PairedWiFiDevice: Codable {
        var host: String
        var port: Int
        var displayName: String
        var secret: String?
        var lastSeen: Date
    }

    private struct BonjourMetadata {
        var localIdentifier: String?
        var boardType: String?
        var firmwareVersion: String?
        var protocolVersion: String?
        var capabilities: [String] = []
    }

    private static let pairingStoreKey = "com.emwaver.macos.pairedWifiDevices.v1"
    private static let pairingSecretAccountPrefix = "wifi-pairing:"

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
    private var pendingPairingRollback: (id: String, previous: PairedWiFiDevice?, previousSecret: String?)?
    private var pendingResponses: [UInt16: PendingResponse] = [:]
    private var txSequence: UInt16 = 1

    private final class PendingResponse {
        let semaphore = DispatchSemaphore(value: 0)
        var payload: Data?
    }

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

    var connectingDeviceID: String? {
        queue.sync {
            socket != nil && connectedDeviceID == nil ? pendingAuthRecord?.id : nil
        }
    }

    func startDiscovery() {
        Self.log("starting Bonjour discovery type=\(Self.serviceType)")
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
            Self.log("discovery state=\(Self.describeBrowserState(state))")
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
            guard Self.isValidManualHost(trimmedHost) else {
                self.onError("Wi-Fi host must be a hostname or IP address without a scheme, path, or port")
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
            let previousSecret = self.pairedSecret(id: id, paired: self.pairedDevicesByID[id])
            guard Self.savePairingSecret(trimmedSecret, id: id) else {
                self.onError("Could not save Wi-Fi pairing secret")
                return
            }
            let record = MacWiFiDeviceRecord(
                id: id,
                displayName: trimmedHost,
                host: trimmedHost,
                port: safePort,
                localIdentifier: nil,
                boardType: "esp32",
                firmwareVersion: nil,
                protocolVersion: "1",
                capabilities: ["wifi"],
                isPaired: true,
                isAdvertised: false,
                lastSeen: Date()
            )
            self.discoveredDevicesByID[id] = record
            self.pendingPairingRollback = (id: id, previous: self.pairedDevicesByID[id], previousSecret: previousSecret)
            self.pairedDevicesByID[id] = PairedWiFiDevice(
                host: trimmedHost,
                port: safePort,
                displayName: trimmedHost,
                secret: nil,
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
            guard !trimmedHost.isEmpty,
                  Self.isValidManualHost(trimmedHost),
                  !trimmedSecret.isEmpty else { return }

            let safePort = Self.isValidPort(port) ? port : Self.defaultPort
            let id = Self.deviceID(host: trimmedHost, port: safePort)
            guard Self.savePairingSecret(trimmedSecret, id: id) else { return }
            let visibleName = (trimmedName?.isEmpty == false ? trimmedName! : trimmedHost)
            self.pairedDevicesByID[id] = PairedWiFiDevice(
                host: trimmedHost,
                port: safePort,
                displayName: visibleName,
                secret: nil,
                lastSeen: Date()
            )
            self.discoveredDevicesByID[id] = MacWiFiDeviceRecord(
                id: id,
                displayName: visibleName,
                host: trimmedHost,
                port: safePort,
                localIdentifier: nil,
                boardType: "esp32",
                firmwareVersion: nil,
                protocolVersion: "1",
                capabilities: ["wifi"],
                isPaired: true,
                isAdvertised: false,
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
            Self.deletePairingSecret(id: id)
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
            Self.log("connect requested id=\(record.id) host=\(record.host) port=\(record.port) paired=\(record.isPaired) advertised=\(record.isAdvertised)")
            guard let paired = self.pairedDevicesByID[record.id],
                  let secret = self.pairedSecret(id: record.id, paired: paired),
                  !secret.isEmpty else {
                Self.log("connect rejected: missing pairing secret id=\(record.id)")
                self.onError("Pair this Wi-Fi device locally before connecting")
                return
            }
            guard record.protocolVersion == "1" else {
                Self.log("connect rejected: unsupported protocol=\(record.protocolVersion ?? "nil") id=\(record.id)")
                self.onError("Firmware does not support this Wi-Fi transport protocol")
                return
            }
            guard Self.advertisesWiFiCapability(record.capabilities) else {
                Self.log("connect rejected: missing wifi capability caps=\(record.capabilities.joined(separator: ",")) id=\(record.id)")
                self.onError("Firmware does not advertise Wi-Fi transport support")
                return
            }
            guard let url = Self.webSocketURL(host: record.host, port: record.port) else {
                Self.log("connect rejected: invalid address host=\(record.host) port=\(record.port)")
                self.onError("Invalid Wi-Fi device address")
                return
            }

            self.disconnect(notify: false)

            Self.log("opening websocket url=\(url.absoluteString)")
            let socket = URLSession.shared.webSocketTask(with: url)
            self.socket = socket
            self.connectedDeviceID = nil
            self.pendingAuthSecret = secret
            self.pendingAuthRecord = record

            socket.resume()
            self.receiveLoop(socket: socket)
            self.scheduleAuthTimeout(for: socket)
            self.publishDevices()
        }
    }

    func send(_ data: Data, sequence: UInt16? = nil) {
        queue.async {
            guard let socket = self.socket, self.connectedDeviceID != nil else {
                Self.log("send rejected: socket not authenticated bytes=\(data.count)")
                self.onError("Wi-Fi write failed: Not connected")
                return
            }
            let envelopeSequence = sequence ?? self.nextSequence()
            guard let frame = Self.makeEnvelope(kind: 1, sequence: envelopeSequence, payload: data) else {
                self.onError("Wi-Fi write failed: Payload too large")
                return
            }
            Self.log("send seq=\(envelopeSequence) bytes=\(data.count) payload=\(Self.hexPreview(data))")
            socket.send(.data(frame)) { [weak self] error in
                if let error {
                    Self.log("send failed seq=\(envelopeSequence) error=\(error.localizedDescription)")
                    self?.onError("Wi-Fi write failed: \(error.localizedDescription)")
                }
            }
        }
    }

    func sendCommand(_ data: Data, timeout: Int) -> Data? {
        guard isConnected else {
            onError("Wi-Fi write failed: Not connected")
            return nil
        }

        let pending = PendingResponse()
        let sequence = queue.sync {
            let sequence = self.nextSequence()
            self.pendingResponses[sequence] = pending
            Self.log("command queued seq=\(sequence) bytes=\(data.count) payload=\(Self.hexPreview(data))")
            return sequence
        }

        queue.async {
            guard let socket = self.socket else {
                self.pendingResponses.removeValue(forKey: sequence)
                self.onError("Wi-Fi write failed: Not connected")
                pending.semaphore.signal()
                return
            }
            guard let frame = Self.makeEnvelope(kind: 1, sequence: sequence, payload: data) else {
                self.pendingResponses.removeValue(forKey: sequence)
                self.onError("Wi-Fi write failed: Payload too large")
                pending.semaphore.signal()
                return
            }
            Self.log("command send seq=\(sequence) bytes=\(data.count)")
            socket.send(.data(frame)) { [weak self] error in
                if let error {
                    Self.log("command send failed seq=\(sequence) error=\(error.localizedDescription)")
                    self?.queue.async {
                        self?.pendingResponses.removeValue(forKey: sequence)
                        self?.onError("Wi-Fi write failed: \(error.localizedDescription)")
                        pending.semaphore.signal()
                    }
                }
            }
        }

        let waitResult = pending.semaphore.wait(timeout: .now() + .milliseconds(max(1, timeout)))
        if waitResult == .timedOut {
            queue.async {
                self.pendingResponses.removeValue(forKey: sequence)
                Self.log("command timed out seq=\(sequence)")
                self.onError("Wi-Fi command timed out")
            }
            return nil
        }
        return pending.payload
    }

    func disconnect() {
        queue.async {
            self.disconnect(notify: true)
        }
    }

    private func disconnect(notify: Bool) {
        let oldID = connectedDeviceID
        let wasAuthenticated = connectedDeviceID != nil
        if socket != nil || connectedDeviceID != nil || pendingAuthRecord != nil {
            Self.log("disconnect notify=\(notify) authenticated=\(wasAuthenticated) id=\(oldID ?? pendingAuthRecord?.id ?? "nil")")
        }
        authTimeoutWorkItem?.cancel()
        authTimeoutWorkItem = nil
        if !wasAuthenticated {
            rollbackPendingPairing()
        }
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        connectedDeviceID = nil
        failPendingResponses()
        txSequence = 1
        pendingAuthSecret = nil
        pendingAuthRecord = nil
        if notify {
            onDisconnected(oldID)
        }
        publishDevices()
    }

    private func handleBrowseResults(_ results: Set<NWBrowser.Result>) {
        Self.log("Bonjour results count=\(results.count)")
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
            migrateSingleSavedPairingIfNeeded(to: id, host: host, displayName: name, metadata: metadata)
            Self.log("discovered name=\(name) host=\(host) id=\(id) proto=\(metadata.protocolVersion ?? "nil") caps=\(metadata.capabilities.joined(separator: ",")) paired=\(pairedDevicesByID[id] != nil)")
            discoveredDevicesByID[id] = MacWiFiDeviceRecord(
                id: id,
                displayName: name.isEmpty ? host : name,
                host: host,
                port: Self.defaultPort,
                localIdentifier: metadata.localIdentifier,
                boardType: metadata.boardType ?? "esp32",
                firmwareVersion: metadata.firmwareVersion,
                protocolVersion: metadata.protocolVersion,
                capabilities: metadata.capabilities,
                isPaired: pairedDevicesByID[id] != nil,
                isAdvertised: true,
                lastSeen: Date()
            )
        }

        for id in discoveredDevicesByID.keys where !advertisedIDs.contains(id) && pairedDevicesByID[id] == nil {
            Self.log("removing stale unpaired discovery id=\(id)")
            discoveredDevicesByID.removeValue(forKey: id)
        }

        for (id, paired) in pairedDevicesByID where discoveredDevicesByID[id] == nil {
            Self.log("showing saved paired device id=\(id) host=\(paired.host) port=\(paired.port) advertised=false")
            discoveredDevicesByID[id] = MacWiFiDeviceRecord(
                id: id,
                displayName: paired.displayName,
                host: paired.host,
                port: paired.port,
                localIdentifier: nil,
                boardType: "esp32",
                firmwareVersion: nil,
                protocolVersion: "1",
                capabilities: ["wifi"],
                isPaired: true,
                isAdvertised: false,
                lastSeen: paired.lastSeen
            )
        }

        publishDevices()
    }

    private func migrateSingleSavedPairingIfNeeded(
        to advertisedID: String,
        host: String,
        displayName: String,
        metadata: BonjourMetadata
    ) {
        guard pairedDevicesByID[advertisedID] == nil else { return }
        let candidates = pairedDevicesByID.keys.filter { pairedID in
            pairedID != advertisedID && discoveredDevicesByID[pairedID]?.isAdvertised != true
        }
        guard candidates.count == 1,
              let oldID = candidates.first,
              let oldPairing = pairedDevicesByID[oldID],
              let secret = pairedSecret(id: oldID, paired: oldPairing),
              !secret.isEmpty else {
            return
        }

        _ = Self.savePairingSecret(secret, id: advertisedID)
        Self.deletePairingSecret(id: oldID)
        pairedDevicesByID.removeValue(forKey: oldID)
        discoveredDevicesByID.removeValue(forKey: oldID)
        pairedDevicesByID[advertisedID] = PairedWiFiDevice(
            host: host,
            port: Self.defaultPort,
            displayName: displayName.isEmpty ? host : displayName,
            secret: nil,
            lastSeen: Date()
        )
        savePairedDevices()
    }

    private func sendHello(socket: URLSessionWebSocketTask, secret: String, challenge: String) {
        let response = Self.hmacHex(secret: secret, message: challenge)
        let hello: [String: Any] = [
            "type": "auth",
            "client": "emwaver-macos",
            "protocolVersion": 1,
            "envelopeVersion": 1,
            "challenge": challenge,
            "response": response,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: hello) else { return }
        Self.log("sending auth response challengeBytes=\(challenge.count)")
        socket.send(.data(data)) { [weak self] error in
            if let error {
                Self.log("auth send failed error=\(error.localizedDescription)")
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
            Self.log("auth timed out id=\(self.pendingAuthRecord?.id ?? "nil")")
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
                    if let envelope = Self.unwrapEnvelope(data) {
                        Self.log("receive envelope seq=\(envelope.sequence) bytes=\(envelope.payload.count) payload=\(Self.hexPreview(envelope.payload))")
                        if self.completePendingResponse(sequence: envelope.sequence, payload: envelope.payload) {
                            break
                        }
                        self.onData(envelope.payload, self.connectedDeviceID)
                    } else {
                        Self.log("receive raw data bytes=\(data.count) payload=\(Self.hexPreview(data))")
                        self.onData(data, self.connectedDeviceID)
                    }
                case .string(let text):
                    Self.log("receive text=\(Self.redactedAuthText(text))")
                    if let challenge = Self.challengeValue(from: text),
                       let secret = self.pendingAuthSecret {
                        Self.log("auth challenge received bytes=\(challenge.count)")
                        self.sendHello(socket: socket, secret: secret, challenge: challenge)
                    } else if text.localizedCaseInsensitiveContains("auth") &&
                                text.localizedCaseInsensitiveContains("ok"),
                              let record = self.pendingAuthRecord {
                        self.queue.async {
                            guard self.socket === socket else { return }
                            Self.log("authenticated id=\(record.id)")
                            let now = Date()
                            var connectedRecord = record
                            connectedRecord.lastSeen = now
                            if var paired = self.pairedDevicesByID[record.id] {
                                paired.lastSeen = now
                                paired.displayName = record.displayName
                                self.pairedDevicesByID[record.id] = paired
                                self.savePairedDevices()
                            }
                            self.discoveredDevicesByID[record.id] = connectedRecord
                            self.authTimeoutWorkItem?.cancel()
                            self.authTimeoutWorkItem = nil
                            self.connectedDeviceID = record.id
                            self.pendingAuthSecret = nil
                            self.pendingAuthRecord = nil
                            self.pendingPairingRollback = nil
                            self.onConnected(connectedRecord)
                            self.publishDevices()
                        }
                    } else if text.localizedCaseInsensitiveContains("auth") &&
                                text.localizedCaseInsensitiveContains("fail") {
                        Self.log("auth failed")
                        self.onError("Wi-Fi pairing secret rejected")
                        self.queue.async {
                            if self.socket === socket {
                                self.rollbackPendingPairing()
                                self.disconnect(notify: true)
                            }
                        }
                    } else if text.localizedCaseInsensitiveContains("auth") &&
                                text.localizedCaseInsensitiveContains("timeout") {
                        Self.log("auth timeout response")
                        self.onError("Wi-Fi authentication timed out")
                        self.queue.async {
                            if self.socket === socket {
                                self.rollbackPendingPairing()
                                self.disconnect(notify: true)
                            }
                        }
                    } else if text.localizedCaseInsensitiveContains("busy") {
                        Self.log("device busy")
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
                Self.log("receive failed error=\(error.localizedDescription)")
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

    private func completePendingResponse(sequence: UInt16, payload: Data) -> Bool {
        var pending: PendingResponse?
        queue.sync {
            pending = pendingResponses.removeValue(forKey: sequence)
        }
        guard let pending else { return false }
        pending.payload = payload
        pending.semaphore.signal()
        return true
    }

    private func failPendingResponses() {
        let pending = pendingResponses.values
        pendingResponses.removeAll()
        for response in pending {
            response.semaphore.signal()
        }
    }

    private func rollbackPendingPairing() {
        guard let rollback = pendingPairingRollback else { return }
        if let previous = rollback.previous {
            pairedDevicesByID[rollback.id] = previous
            if let previousSecret = rollback.previousSecret {
                _ = Self.savePairingSecret(previousSecret, id: rollback.id)
            } else {
                Self.deletePairingSecret(id: rollback.id)
            }
            if var record = discoveredDevicesByID[rollback.id] {
                record.isPaired = true
                record.displayName = previous.displayName
                discoveredDevicesByID[rollback.id] = record
            }
        } else {
            pairedDevicesByID.removeValue(forKey: rollback.id)
            Self.deletePairingSecret(id: rollback.id)
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

    private func nextSequence() -> UInt16 {
        let sequence = txSequence
        txSequence = Self.nextWiFiSequence(after: txSequence)
        return sequence
    }

    static func nextWiFiSequence(after sequence: UInt16) -> UInt16 {
        let next = sequence &+ 1
        return next == 0 ? 1 : next
    }

    static func makeEnvelope(kind: UInt8, sequence: UInt16, payload: Data) -> Data? {
        guard payload.count <= UInt16.max else { return nil }
        var frame = Data()
        frame.reserveCapacity(10 + payload.count)
        frame.append(contentsOf: [0x45, 0x4d, 0x57, 0x01, kind])
        frame.append(UInt8(sequence & 0xff))
        frame.append(UInt8((sequence >> 8) & 0xff))
        frame.append(0)
        frame.append(UInt8(payload.count & 0xff))
        frame.append(UInt8((payload.count >> 8) & 0xff))
        frame.append(payload)
        return frame
    }

    static func unwrapEnvelope(_ data: Data) -> (payload: Data, sequence: UInt16)? {
        guard data.count >= 10,
              data[0] == 0x45,
              data[1] == 0x4d,
              data[2] == 0x57,
              data[3] == 0x01,
              data[4] == 0x01 else {
            return nil
        }
        let payloadLength = Int(data[8]) | (Int(data[9]) << 8)
        guard data.count == 10 + payloadLength else {
            return nil
        }
        let sequence = UInt16(data[5]) | (UInt16(data[6]) << 8)
        return (data.subdata(in: 10..<data.count), sequence)
    }

    private func loadPairedDevices() {
        guard let data = UserDefaults.standard.data(forKey: Self.pairingStoreKey),
              let records = try? JSONDecoder().decode([String: PairedWiFiDevice].self, from: data) else {
            return
        }
        var migrated = false
        pairedDevicesByID = records
        for (id, record) in records {
            if let inlineSecret = record.secret, !inlineSecret.isEmpty {
                _ = Self.savePairingSecret(inlineSecret, id: id)
                pairedDevicesByID[id]?.secret = nil
                migrated = true
            }
            discoveredDevicesByID[id] = MacWiFiDeviceRecord(
                id: id,
                displayName: record.displayName,
                host: record.host,
                port: record.port,
                localIdentifier: nil,
                boardType: "esp32",
                firmwareVersion: nil,
                protocolVersion: "1",
                capabilities: ["wifi"],
                isPaired: true,
                isAdvertised: false,
                lastSeen: record.lastSeen
            )
        }
        if migrated {
            savePairedDevices()
        }
    }

    private func savePairedDevices() {
        let records = pairedDevicesByID.mapValues { record in
            PairedWiFiDevice(
                host: record.host,
                port: record.port,
                displayName: record.displayName,
                secret: nil,
                lastSeen: record.lastSeen
            )
        }
        guard let data = try? JSONEncoder().encode(records) else { return }
        UserDefaults.standard.set(data, forKey: Self.pairingStoreKey)
    }

    private func pairedSecret(id: String, paired: PairedWiFiDevice?) -> String? {
        if let secret = try? KeychainStore.getString(account: Self.pairingSecretAccount(id: id)),
           !secret.isEmpty {
            return secret
        }
        if let inlineSecret = paired?.secret, !inlineSecret.isEmpty {
            _ = Self.savePairingSecret(inlineSecret, id: id)
            pairedDevicesByID[id]?.secret = nil
            savePairedDevices()
            return inlineSecret
        }
        return nil
    }

    private static func log(_ message: String) {
        print("[Wi-Fi] \(message)")
    }

    private static func describeBrowserState(_ state: NWBrowser.State) -> String {
        switch state {
        case .setup:
            return "setup"
        case .ready:
            return "ready"
        case .cancelled:
            return "cancelled"
        case .waiting(let error):
            return "waiting(\(error.localizedDescription))"
        case .failed(let error):
            return "failed(\(error.localizedDescription))"
        @unknown default:
            return "unknown"
        }
    }

    private static func hexPreview(_ data: Data, limit: Int = 24) -> String {
        let bytes = data.prefix(limit).map { String(format: "%02x", $0) }.joined(separator: " ")
        if data.count > limit {
            return "\(bytes) ..."
        }
        return bytes
    }

    private static func redactedAuthText(_ text: String) -> String {
        if text.localizedCaseInsensitiveContains("challenge") {
            return "auth challenge"
        }
        if text.localizedCaseInsensitiveContains("response") {
            return "auth response"
        }
        return text
    }

    private static func savePairingSecret(_ secret: String, id: String) -> Bool {
        do {
            try KeychainStore.setString(secret, account: pairingSecretAccount(id: id))
            return true
        } catch {
            return false
        }
    }

    private static func deletePairingSecret(id: String) {
        KeychainStore.delete(account: pairingSecretAccount(id: id))
    }

    private static func pairingSecretAccount(id: String) -> String {
        pairingSecretAccountPrefix + id
    }

    static func deviceID(host: String, port: Int) -> String {
        "wifi:\(host.lowercased()):\(port)"
    }

    static func isValidPort(_ port: Int) -> Bool {
        (1...65535).contains(port)
    }

    static func isValidManualHost(_ host: String) -> Bool {
        guard !host.isEmpty,
              host.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              host.rangeOfCharacter(from: CharacterSet(charactersIn: "/?#@")) == nil,
              !host.contains("://") else {
            return false
        }
        if host.contains(":") {
            return isValidIPv6Literal(host)
        }
        return true
    }

    static func webSocketURL(host: String, port: Int) -> URL? {
        guard isValidManualHost(host), isValidPort(port) else { return nil }
        let urlHost = host.contains(":") ? "[\(host)]" : host
        return URL(string: "ws://\(urlHost):\(port)/v1/ws")
    }

    private static func isValidIPv6Literal(_ host: String) -> Bool {
        var addr = in6_addr()
        return host.withCString { inet_pton(AF_INET6, $0, &addr) == 1 }
    }

    private static func bonjourMetadata(from metadata: NWBrowser.Result.Metadata) -> BonjourMetadata {
        guard case .bonjour(let txtRecord) = metadata else {
            return BonjourMetadata()
        }
        let dictionary = txtRecord.dictionary
        return BonjourMetadata(
            localIdentifier: nonEmpty(dictionary["id"]),
            boardType: normalizedBoardType(dictionary["board"]),
            firmwareVersion: nonEmpty(dictionary["fw"]),
            protocolVersion: nonEmpty(dictionary["proto"]),
            capabilities: capabilities(dictionary["cap"])
        )
    }

    static func normalizedBoardType(_ value: String?) -> String? {
        guard let value = nonEmpty(value) else { return nil }
        switch value.lowercased() {
        case "esp32s3", "esp32-s3":
            return "esp32s3"
        case "esp32s2", "esp32-s2":
            return "esp32s2"
        case "esp32":
            return "esp32"
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

    static func capabilities(_ value: String?) -> [String] {
        guard let value = nonEmpty(value) else { return [] }
        return value
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
    }

    static func advertisesWiFiCapability(_ capabilities: [String]) -> Bool {
        capabilities.contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare("wifi") == .orderedSame }
    }

    static func challengeValue(from text: String) -> String? {
        guard let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String,
              type == "challenge",
              let challenge = object["challenge"] as? String,
              !challenge.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return challenge
    }

    private static func hmacHex(secret: String, message: String) -> String {
        let key = SymmetricKey(data: Data(secret.utf8))
        let signature = HMAC<SHA256>.authenticationCode(for: Data(message.utf8), using: key)
        return signature.map { String(format: "%02x", $0) }.joined()
    }
}
