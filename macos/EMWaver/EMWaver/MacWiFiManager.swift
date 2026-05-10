/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation
import Network
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
    var isAdvertised: Bool
    var lastSeen: Date
}

final class MacWiFiManager {
    static let defaultPort = 3922
    static let serviceType = "_emwaver._tcp"
    private static let livenessProbeInterval: DispatchTimeInterval = .seconds(2)
    private static let livenessProbeTimeout: DispatchTimeInterval = .seconds(3)
    private static let discoveryReachabilityInterval: DispatchTimeInterval = .seconds(2)
    private static let discoveryProbeTimeout: DispatchTimeInterval = .seconds(3)
    private static let hardwareUIDCommand = Data([0x08])

    private struct BonjourMetadata {
        var localIdentifier: String?
        var host: String?
        var boardType: String?
        var firmwareVersion: String?
        var protocolVersion: String?
        var capabilities: [String] = []
    }

    private let queue = DispatchQueue(label: "com.emwaver.macos.wifi", qos: .userInitiated)
    private let onDevicesChanged: ([MacWiFiDeviceRecord]) -> Void
    private let onData: (Data, String?) -> Void
    private let onError: (String) -> Void
    private let onConnected: (MacWiFiDeviceRecord) -> Void
    private let onDisconnected: (String?) -> Void

    private var browser: NWBrowser?
    private var discoveredDevicesByID: [String: MacWiFiDeviceRecord] = [:]
    private var socket: URLSessionWebSocketTask?
    private var connectedDeviceID: String?
    private var pendingConnectionRecord: MacWiFiDeviceRecord?
    private var advertisedDeviceIDs: Set<String> = []
    private var advertisedRecordsByID: [String: MacWiFiDeviceRecord] = [:]
    private var validatingAdvertisedDeviceIDs: Set<String> = []
    private var advertisedValidationSockets: [String: URLSessionWebSocketTask] = [:]
    private var pendingResponses: [UInt16: PendingResponse] = [:]
    private var discoveryReachabilityTimer: DispatchSourceTimer?
    private var livenessTimer: DispatchSourceTimer?
    private var pendingLivenessSequence: UInt16?
    private var txSequence: UInt16 = 1

    private final class PendingResponse {
        let semaphore = DispatchSemaphore(value: 0)
        var payload: Data?
        var completion: ((Data?) -> Void)?
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
    }

    var activeDeviceID: String? {
        connectedDeviceID
    }

    var isConnected: Bool {
        socket != nil && connectedDeviceID != nil
    }

    var connectingDeviceID: String? {
        queue.sync {
            socket != nil && connectedDeviceID == nil ? pendingConnectionRecord?.id : nil
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
        startDiscoveryReachabilityTimer()
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

    func connect(host: String, port: Int = MacWiFiManager.defaultPort) {
        let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        queue.async {
            guard !trimmedHost.isEmpty else {
                self.onError("Wi-Fi host is required")
                return
            }
            guard Self.isValidManualHost(trimmedHost) else {
                self.onError("Wi-Fi host must be a hostname or IP address without a scheme, path, or port")
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
                localIdentifier: nil,
                boardType: "esp32",
                firmwareVersion: nil,
                protocolVersion: "1",
                capabilities: ["wifi"],
                isAdvertised: false,
                lastSeen: Date()
            )
            self.discoveredDevicesByID[id] = record
            self.publishDevices()
            self.connect(record: record)
        }
    }

    func addManualDevice(host: String, port: Int = MacWiFiManager.defaultPort, displayName: String? = nil) {
        let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedName = displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        queue.async {
            guard !trimmedHost.isEmpty,
                  Self.isValidManualHost(trimmedHost) else { return }

            let safePort = Self.isValidPort(port) ? port : Self.defaultPort
            let id = Self.deviceID(host: trimmedHost, port: safePort)
            let visibleName = (trimmedName?.isEmpty == false ? trimmedName! : trimmedHost)
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
                isAdvertised: false,
                lastSeen: Date()
            )
            self.publishDevices()
        }
    }

    func removeManualDevice(host: String, port: Int = MacWiFiManager.defaultPort) {
        let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        queue.async {
            guard !trimmedHost.isEmpty else { return }

            let safePort = Self.isValidPort(port) ? port : Self.defaultPort
            let id = Self.deviceID(host: trimmedHost, port: safePort)
            self.discoveredDevicesByID.removeValue(forKey: id)
            self.publishDevices()
        }
    }

    func connect(record: MacWiFiDeviceRecord) {
        queue.async {
            Self.log("connect requested id=\(record.id) host=\(record.host) port=\(record.port) advertised=\(record.isAdvertised)")
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
            self.pendingConnectionRecord = record

            socket.resume()
            self.receiveLoop(socket: socket)
            self.sendLivenessProbe(socket: socket, record: record, markConnectedOnSuccess: true)
            self.publishDevices()
        }
    }

    func send(_ data: Data, sequence: UInt16? = nil) {
        queue.async {
            guard let socket = self.socket, self.connectedDeviceID != nil else {
                Self.log("send rejected: socket not connected bytes=\(data.count)")
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
        let oldID = connectedDeviceID ?? pendingConnectionRecord?.id
        let wasConnected = connectedDeviceID != nil
        if socket != nil || connectedDeviceID != nil || pendingConnectionRecord != nil {
            Self.log("disconnect notify=\(notify) connected=\(wasConnected) id=\(oldID ?? pendingConnectionRecord?.id ?? "nil")")
        }
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        connectedDeviceID = nil
        cancelLivenessTimer()
        pendingLivenessSequence = nil
        failPendingResponses()
        txSequence = 1
        pendingConnectionRecord = nil
        if let oldID,
           let record = discoveredDevicesByID[oldID],
           !record.isAdvertised {
            discoveredDevicesByID.removeValue(forKey: oldID)
        }
        if notify {
            onDisconnected(oldID)
        }
        publishDevices()
    }

    private func handleBrowseResults(_ results: Set<NWBrowser.Result>) {
        Self.log("Bonjour results count=\(results.count)")
        var advertisedIDs = Set<String>()
        var candidateRecords: [MacWiFiDeviceRecord] = []
        for result in results {
            guard case let .service(name, type, domain, _) = result.endpoint,
                  type == Self.serviceType else { continue }
            let metadata = Self.bonjourMetadata(from: result.metadata)
            guard let host = Self.bonjourHost(name: name, domain: domain, metadata: metadata) else {
                Self.log("ignoring Bonjour result without usable host name=\(name) domain=\(domain)")
                continue
            }
            let id = Self.deviceID(host: host, port: Self.defaultPort)
            advertisedIDs.insert(id)
            let capabilities = metadata.capabilities.isEmpty ? ["wifi"] : metadata.capabilities
            Self.log("discovered name=\(name) host=\(host) id=\(id) proto=\(metadata.protocolVersion ?? "nil") caps=\(capabilities.joined(separator: ","))")
            let record = MacWiFiDeviceRecord(
                id: id,
                displayName: name.isEmpty ? host : name,
                host: host,
                port: Self.defaultPort,
                localIdentifier: metadata.localIdentifier,
                boardType: metadata.boardType ?? "esp32",
                firmwareVersion: metadata.firmwareVersion,
                protocolVersion: metadata.protocolVersion ?? "1",
                capabilities: capabilities,
                isAdvertised: true,
                lastSeen: Date()
            )
            advertisedRecordsByID[id] = record
            if connectedDeviceID == id || discoveredDevicesByID[id]?.isAdvertised == true {
                discoveredDevicesByID[id] = record
            } else {
                candidateRecords.append(record)
            }
        }
        advertisedDeviceIDs = advertisedIDs
        advertisedRecordsByID = advertisedRecordsByID.filter { advertisedIDs.contains($0.key) }

        for id in Array(discoveredDevicesByID.keys) where !advertisedIDs.contains(id) {
            guard var record = discoveredDevicesByID[id],
                  record.isAdvertised else {
                continue
            }
            if connectedDeviceID == id {
                record.isAdvertised = false
                discoveredDevicesByID[id] = record
                if let activeSocket = socket {
                    Self.log("advertisement disappeared for connected id=\(id); checking UID liveness")
                    sendLivenessProbe(socket: activeSocket, record: record, markConnectedOnSuccess: false)
                }
            } else {
                Self.log("removing stale discovery id=\(id)")
                discoveredDevicesByID.removeValue(forKey: id)
            }
        }
        validatingAdvertisedDeviceIDs.formIntersection(advertisedIDs)
        for record in candidateRecords where !validatingAdvertisedDeviceIDs.contains(record.id) {
            validateAdvertisedRecord(record)
        }

        publishDevices()
    }

    private func startDiscoveryReachabilityTimer() {
        discoveryReachabilityTimer?.setEventHandler {}
        discoveryReachabilityTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(
            deadline: .now() + Self.discoveryReachabilityInterval,
            repeating: Self.discoveryReachabilityInterval
        )
        timer.setEventHandler { [weak self] in
            self?.validatePublishedAdvertisedRecords()
        }
        discoveryReachabilityTimer = timer
        timer.resume()
    }

    private func validatePublishedAdvertisedRecords() {
        let records = advertisedRecordsByID.values
        for record in records where connectedDeviceID != record.id {
            guard advertisedDeviceIDs.contains(record.id),
                  !validatingAdvertisedDeviceIDs.contains(record.id) else {
                continue
            }
            validateAdvertisedRecord(record, removeOnFailure: discoveredDevicesByID[record.id]?.isAdvertised == true)
        }
    }

    private func validateAdvertisedRecord(_ record: MacWiFiDeviceRecord, removeOnFailure: Bool = false) {
        guard let url = Self.webSocketURL(host: record.host, port: record.port),
              let frame = Self.makeEnvelope(kind: 1, sequence: 1, payload: Self.hardwareUIDCommand) else { return }
        validatingAdvertisedDeviceIDs.insert(record.id)
        Self.log("validating advertised uid id=\(record.id)")
        let validationSocket = URLSession.shared.webSocketTask(with: url)
        advertisedValidationSockets[record.id] = validationSocket
        validationSocket.resume()
        validationSocket.send(.data(frame)) { [weak self] error in
            guard let self else { return }
            self.queue.async {
                guard self.validatingAdvertisedDeviceIDs.contains(record.id),
                      self.advertisedValidationSockets[record.id] === validationSocket else { return }
                if let error {
                    Self.log("advertised UID probe send failed id=\(record.id) error=\(error.localizedDescription)")
                    self.finishAdvertisedValidationFailure(record, removeOnFailure: removeOnFailure)
                }
            }
        }
        validationSocket.receive { [weak self] result in
            guard let self else { return }
            self.queue.async {
                guard self.validatingAdvertisedDeviceIDs.contains(record.id),
                      self.advertisedValidationSockets[record.id] === validationSocket else { return }
                switch result {
                case .success(let message):
                    guard case .data(let data) = message,
                          let envelope = Self.unwrapEnvelope(data),
                          envelope.sequence == 1,
                          let uid = Self.hardwareUID(from: envelope.payload) else {
                        Self.log("advertised UID probe returned invalid response id=\(record.id)")
                        self.finishAdvertisedValidationFailure(record, removeOnFailure: removeOnFailure)
                        return
                    }
                    Self.log("advertised validation passed id=\(record.id) uid=\(uid)")
                    self.finishAdvertisedValidationSuccess(record, uid: uid)
                case .failure(let error):
                    Self.log("advertised UID probe failed id=\(record.id) error=\(error.localizedDescription)")
                    self.finishAdvertisedValidationFailure(record, removeOnFailure: removeOnFailure)
                }
            }
        }
        queue.asyncAfter(deadline: .now() + Self.discoveryProbeTimeout) { [weak self] in
            guard let self else { return }
            guard self.validatingAdvertisedDeviceIDs.contains(record.id),
                  self.advertisedValidationSockets[record.id] === validationSocket else { return }
            Self.log("advertised validation timed out id=\(record.id)")
            self.finishAdvertisedValidationFailure(record, removeOnFailure: removeOnFailure)
        }
    }

    private func finishAdvertisedValidationSuccess(_ record: MacWiFiDeviceRecord, uid: String) {
        validatingAdvertisedDeviceIDs.remove(record.id)
        advertisedValidationSockets.removeValue(forKey: record.id)?.cancel(with: .goingAway, reason: nil)
        guard advertisedDeviceIDs.contains(record.id) else { return }
        var validatedRecord = record
        validatedRecord.localIdentifier = uid
        validatedRecord.lastSeen = Date()
        discoveredDevicesByID[record.id] = validatedRecord
        publishDevices()
    }

    private func finishAdvertisedValidationFailure(_ record: MacWiFiDeviceRecord, removeOnFailure: Bool) {
        validatingAdvertisedDeviceIDs.remove(record.id)
        advertisedValidationSockets.removeValue(forKey: record.id)?.cancel(with: .goingAway, reason: nil)
        if removeOnFailure {
            removeUnreachableAdvertisedRecord(record.id)
        }
    }

    private func removeUnreachableAdvertisedRecord(_ id: String) {
        guard connectedDeviceID != id,
              discoveredDevicesByID[id]?.isAdvertised == true else {
            return
        }
        Self.log("removing unreachable advertised discovery id=\(id)")
        discoveredDevicesByID.removeValue(forKey: id)
        publishDevices()
    }

    private func markConnected(record: MacWiFiDeviceRecord, socket: URLSessionWebSocketTask) {
        guard self.socket === socket else { return }
        Self.log("connected id=\(record.id)")
        var connectedRecord = record
        connectedRecord.lastSeen = Date()
        self.discoveredDevicesByID[record.id] = connectedRecord
        self.connectedDeviceID = record.id
        self.pendingConnectionRecord = nil
        self.onConnected(connectedRecord)
        self.startLivenessTimer(socket: socket, record: connectedRecord)
        self.publishDevices()
    }

    private func startLivenessTimer(socket: URLSessionWebSocketTask, record: MacWiFiDeviceRecord) {
        cancelLivenessTimer()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(
            deadline: .now() + Self.livenessProbeInterval,
            repeating: Self.livenessProbeInterval
        )
        timer.setEventHandler { [weak self, weak socket] in
            guard let self, let socket, self.socket === socket else { return }
            self.sendLivenessProbe(socket: socket, record: record, markConnectedOnSuccess: false)
        }
        livenessTimer = timer
        timer.resume()
    }

    private func cancelLivenessTimer() {
        livenessTimer?.setEventHandler {}
        livenessTimer?.cancel()
        livenessTimer = nil
    }

    private func sendLivenessProbe(
        socket: URLSessionWebSocketTask,
        record: MacWiFiDeviceRecord,
        markConnectedOnSuccess: Bool
    ) {
        guard pendingLivenessSequence == nil else { return }
        let sequence = nextSequence()
        guard let frame = Self.makeEnvelope(kind: 1, sequence: sequence, payload: Self.hardwareUIDCommand) else { return }
        let pending = PendingResponse()
        pendingLivenessSequence = sequence
        pendingResponses[sequence] = pending
        pending.completion = { [weak self, weak socket] payload in
            guard let self, let socket else { return }
            self.queue.async {
                guard self.socket === socket, self.pendingLivenessSequence == sequence else { return }
                self.pendingLivenessSequence = nil
                guard let payload, let uid = Self.hardwareUID(from: payload) else {
                    Self.log("UID liveness returned invalid response id=\(record.id) seq=\(sequence)")
                    self.onError("Wi-Fi disconnected: UID probe failed")
                    self.disconnect(notify: true)
                    return
                }
                Self.log("UID liveness ok id=\(record.id) seq=\(sequence) uid=\(uid)")
                if markConnectedOnSuccess {
                    var connectedRecord = record
                    connectedRecord.localIdentifier = uid
                    self.markConnected(record: connectedRecord, socket: socket)
                } else if var current = self.discoveredDevicesByID[record.id] {
                    current.localIdentifier = uid
                    current.lastSeen = Date()
                    self.discoveredDevicesByID[record.id] = current
                    self.publishDevices()
                }
            }
        }
        Self.log("UID liveness probe id=\(record.id) seq=\(sequence) initial=\(markConnectedOnSuccess)")
        queue.asyncAfter(deadline: .now() + Self.livenessProbeTimeout) { [weak self, weak socket] in
            guard let self, let socket else { return }
            guard self.socket === socket, self.pendingLivenessSequence == sequence else { return }
            Self.log("UID liveness timed out id=\(record.id) seq=\(sequence)")
            self.pendingLivenessSequence = nil
            self.pendingResponses.removeValue(forKey: sequence)
            self.onError("Wi-Fi disconnected: UID probe timed out")
            self.disconnect(notify: true)
        }
        socket.send(.data(frame)) { [weak self] error in
            guard let self else { return }
            self.queue.async {
                if let error {
                    guard self.pendingLivenessSequence == sequence else { return }
                    Self.log("UID liveness send failed id=\(record.id) seq=\(sequence) error=\(error.localizedDescription)")
                    self.pendingLivenessSequence = nil
                    self.pendingResponses.removeValue(forKey: sequence)
                    self.onError("Wi-Fi disconnected: \(error.localizedDescription)")
                    self.disconnect(notify: true)
                }
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
                    if text.localizedCaseInsensitiveContains("busy") {
                        Self.log("device busy")
                        self.onError("Wi-Fi device is busy with another session")
                        self.queue.async {
                            if self.socket === socket {
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
        pending.completion?(payload)
        pending.semaphore.signal()
        return true
    }

    private func failPendingResponses() {
        let pending = pendingResponses.values
        pendingResponses.removeAll()
        for response in pending {
            response.completion?(nil)
            response.semaphore.signal()
        }
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

    static func hardwareUID(from response: Data) -> String? {
        guard response.count >= 7, response[0] == 0x80 else { return nil }
        let payload = response.dropFirst(1)
        let significantLength = payload.lastIndex(where: { $0 != 0 })
            .map { payload.distance(from: payload.startIndex, to: $0) + 1 } ?? 0
        guard significantLength > 0 else { return nil }
        return payload.prefix(significantLength).map { String(format: "%02x", $0) }.joined()
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

    private static func redactedAuthText(_ text: String) -> String { text }

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

    private static func bonjourHost(name: String, domain: String, metadata: BonjourMetadata) -> String? {
        if let advertisedHost = metadata.host,
           let host = normalizedBonjourHost(advertisedHost) {
            return host
        }
        if let host = normalizedBonjourHost(name) {
            return host
        }
        return normalizedBonjourHost("\(name).\(domain)"
            .replacingOccurrences(of: "..", with: ".")
            .trimmingCharacters(in: CharacterSet(charactersIn: ".")))
    }

    private static func normalizedBonjourHost(_ value: String) -> String? {
        var host = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !host.isEmpty else { return nil }
        guard host.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { return nil }
        let lowercasedHost = host.lowercased()
        if lowercasedHost.hasSuffix(".local.") {
            host.removeLast(1)
        } else if !lowercasedHost.hasSuffix(".local") {
            host += ".local"
        }
        guard isValidManualHost(host) else { return nil }
        return host
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
            host: nonEmpty(dictionary["host"]),
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

}
