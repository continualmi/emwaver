/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Combine
import Foundation
import Network
import EMWaverScriptRuntime

final class MacMcpServer: ObservableObject {
    private static let endpointPath = "/mcp"
    private static let fallbackProtocolVersion = "2025-06-18"

    private let queue = DispatchQueue(label: "com.emwaver.macos.mcp")
    private weak var device: MacUSBManager?
    private var listener: NWListener?
    private var scriptRuns: [String: ScriptPreviewManager] = [:]

    @Published private(set) var isRunning: Bool = false
    @Published private(set) var lastErrorText: String?

    var endpointURL: String {
        "http://127.0.0.1:\(MacMcpSettings.port)\(Self.endpointPath)"
    }

    func attach(device: MacUSBManager) {
        self.device = device
    }

    func syncWithSettings() {
        if MacMcpSettings.enabled {
            start()
        } else {
            stop()
        }
    }

    func start() {
        queue.async {
            guard self.listener == nil else { return }

            do {
                let parameters = NWParameters.tcp
                parameters.allowLocalEndpointReuse = true
                parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: MacMcpSettings.port)!)

                let listener = try NWListener(using: parameters, on: NWEndpoint.Port(rawValue: MacMcpSettings.port)!)
                listener.newConnectionHandler = { [weak self] connection in
                    self?.handle(connection: connection)
                }
                listener.stateUpdateHandler = { [weak self] state in
                    self?.handle(listenerState: state)
                }
                self.listener = listener
                listener.start(queue: self.queue)
            } catch {
                self.publishState(isRunning: false, lastErrorText: error.localizedDescription)
                self.listener = nil
            }
        }
    }

    func stop() {
        queue.async {
            self.listener?.cancel()
            self.listener = nil
            DispatchQueue.main.sync {
                for manager in self.scriptRuns.values {
                    manager.exitPreview()
                }
                self.scriptRuns.removeAll()
            }
            self.publishState(isRunning: false, lastErrorText: nil)
        }
    }

    private func handle(listenerState: NWListener.State) {
        switch listenerState {
        case .ready:
            publishState(isRunning: true, lastErrorText: nil)
        case .failed(let error):
            listener?.cancel()
            listener = nil
            publishState(isRunning: false, lastErrorText: error.localizedDescription)
        case .cancelled:
            listener = nil
            publishState(isRunning: false, lastErrorText: nil)
        default:
            break
        }
    }

    private func publishState(isRunning: Bool, lastErrorText: String?) {
        DispatchQueue.main.async {
            self.isRunning = isRunning
            self.lastErrorText = lastErrorText
        }
    }

    private func handle(connection: NWConnection) {
        connection.start(queue: queue)
        receiveRequest(connection: connection, buffer: Data())
    }

    private func receiveRequest(connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }
            if error != nil {
                connection.cancel()
                return
            }

            var next = buffer
            if let data {
                next.append(data)
            }

            if let request = Self.parseHttpRequest(next) {
                self.handle(request: request, connection: connection)
                return
            }

            if isComplete || next.count > 10 * 1024 * 1024 {
                self.send(status: 400, reason: "Bad Request", body: Self.jsonRpcError(id: nil, code: -32600, message: "Invalid HTTP request"), connection: connection)
                return
            }

            self.receiveRequest(connection: connection, buffer: next)
        }
    }

    private func handle(request: HttpRequest, connection: NWConnection) {
        guard request.method.uppercased() == "POST", request.path == Self.endpointPath else {
            send(status: 404, reason: "Not Found", body: Self.jsonRpcError(id: nil, code: -32004, message: "Unknown MCP endpoint"), connection: connection)
            return
        }

        guard isAuthorized(request) else {
            send(status: 401, reason: "Unauthorized", body: Self.jsonRpcError(id: nil, code: -32001, message: "MCP bearer token is required"), connection: connection)
            return
        }

        let response = handleJsonRpc(body: request.body)
        if response.statusCode == 202 {
            sendEmpty(status: 202, reason: "Accepted", connection: connection)
        } else {
            send(status: response.statusCode, reason: "OK", body: response.body, connection: connection)
        }
    }

    private func isAuthorized(_ request: HttpRequest) -> Bool {
        guard let authorization = request.headers["authorization"] else {
            return false
        }

        let prefix = "Bearer "
        guard authorization.lowercased().hasPrefix(prefix.lowercased()) else {
            return false
        }

        let token = authorization.dropFirst(prefix.count).trimmingCharacters(in: .whitespacesAndNewlines)
        return token == MacMcpSettings.token
    }

    private func handleJsonRpc(body: Data) -> McpHttpResponse {
        do {
            let json = try JSONSerialization.jsonObject(with: body)
            if let batch = json as? [[String: Any]] {
                let responses = batch.compactMap { handleSingleJsonRpc($0) }
                if responses.isEmpty {
                    return McpHttpResponse(statusCode: 202, body: Data())
                }
                return McpHttpResponse(statusCode: 200, body: Self.jsonData(responses))
            }
            guard let request = json as? [String: Any] else {
                return McpHttpResponse(statusCode: 200, body: Self.jsonRpcError(id: nil, code: -32600, message: "JSON-RPC request must be an object"))
            }
            guard let response = handleSingleJsonRpc(request) else {
                return McpHttpResponse(statusCode: 202, body: Data())
            }
            return McpHttpResponse(statusCode: 200, body: Self.jsonData(response))
        } catch {
            return McpHttpResponse(statusCode: 200, body: Self.jsonRpcError(id: nil, code: -32700, message: "Invalid JSON request"))
        }
    }

    private func handleSingleJsonRpc(_ request: [String: Any]) -> [String: Any]? {
        let id = request["id"]
        guard id != nil else { return nil }
        guard let method = request["method"] as? String, !method.isEmpty else {
            return Self.rpcError(id: id, code: -32600, message: "Missing JSON-RPC method")
        }

        do {
            switch method {
            case "initialize":
                return Self.rpcResult(id: id, result: initializeResult(parameters: request["params"] as? [String: Any]))
            case "tools/list":
                return Self.rpcResult(id: id, result: toolsListResult())
            case "tools/call":
                return Self.rpcResult(id: id, result: try toolsCallResult(parameters: request["params"] as? [String: Any]))
            default:
                return Self.rpcError(id: id, code: -32601, message: "Unsupported MCP method: \(method)")
            }
        } catch {
            return Self.rpcError(id: id, code: -32603, message: error.localizedDescription)
        }
    }

    private func initializeResult(parameters: [String: Any]?) -> [String: Any] {
        let protocolVersion = (parameters?["protocolVersion"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? Self.fallbackProtocolVersion
        return [
            "protocolVersion": protocolVersion,
            "capabilities": [
                "tools": [:]
            ],
            "serverInfo": [
                "name": "EMWaver macOS",
                "version": MacAppBuildInfo.displayVersion
            ]
        ]
    }

    private func toolsListResult() -> [String: Any] {
        [
            "tools": [
                Self.tool(name: "list_scripts", description: "List bundled and local JavaScript scripts visible to the macOS app.", inputSchema: Self.emptySchema()),
                Self.tool(name: "read_script", description: "Read one script by script_id from the same roots used by the app UI.", inputSchema: Self.objectSchema(properties: [
                    "script_id": ["type": "string"]
                ], required: ["script_id"])),
                Self.tool(name: "write_script", description: "Create or update a local JavaScript script in the macOS app script folder.", inputSchema: Self.objectSchema(properties: [
                    "script_id": ["type": "string"],
                    "path": ["type": "string"],
                    "content": ["type": "string"]
                ], required: ["content"])),
                Self.tool(name: "run_script", description: "Run a JavaScript script through the macOS app script engine.", inputSchema: Self.objectSchema(properties: [
                    "script_id": ["type": "string"],
                    "source": ["type": "string"],
                    "name": ["type": "string"]
                ], required: [])),
                Self.tool(name: "stop_script", description: "Stop an MCP-started macOS script run.", inputSchema: Self.objectSchema(properties: [
                    "run_id": ["type": "string"]
                ], required: [])),
                Self.tool(name: "device_state", description: "Return current EMWaver device, transport, firmware, and discovery state.", inputSchema: Self.emptySchema())
            ]
        ]
    }

    private func toolsCallResult(parameters: [String: Any]?) throws -> [String: Any] {
        let name = parameters?["name"] as? String
        let arguments = parameters?["arguments"] as? [String: Any]
        let structured: [String: Any]

        switch name {
        case "list_scripts":
            structured = ["ok": true, "scripts": listScripts().map { $0.json }]
        case "read_script":
            structured = readScript(arguments: arguments)
        case "write_script":
            structured = writeScript(arguments: arguments)
        case "run_script":
            structured = runScript(arguments: arguments)
        case "stop_script":
            structured = stopScript(arguments: arguments)
        case "device_state":
            structured = deviceState()
        default:
            structured = Self.toolError(code: "unsupported_tool", message: "Unsupported MCP tool: \(name ?? "<missing>")")
        }

        return [
            "content": [
                [
                    "type": "text",
                    "text": Self.jsonString(structured)
                ]
            ],
            "structuredContent": structured
        ]
    }

    private func readScript(arguments: [String: Any]?) -> [String: Any] {
        guard let scriptId = arguments?["script_id"] as? String, !scriptId.isEmpty else {
            return Self.toolError(code: "missing_script_id", message: "read_script requires script_id", recovery: "Call list_scripts first and pass one returned script id.")
        }

        guard let script = listScripts().first(where: { $0.id.caseInsensitiveCompare(scriptId) == .orderedSame }) else {
            return Self.toolError(code: "script_not_found", message: "Script not found: \(scriptId)", recovery: "Call list_scripts again; the script may have been renamed or deleted.")
        }

        do {
            var scriptJson = script.json
            scriptJson["source"] = try String(contentsOf: script.url, encoding: .utf8)
            return ["ok": true, "script": scriptJson]
        } catch {
            return Self.toolError(code: "script_read_failed", message: error.localizedDescription)
        }
    }

    private func runScript(arguments: [String: Any]?) -> [String: Any] {
        let resolved = resolveRunSource(arguments: arguments)
        guard resolved.ok else {
            return Self.toolError(code: resolved.errorCode ?? "script_unavailable", message: resolved.errorMessage ?? "Script unavailable", recovery: resolved.recovery)
        }

        let runId = UUID().uuidString
        let source = resolved.source ?? ""
        let name = resolved.name ?? "MCP Script"
        let modules = moduleSources(excluding: resolved.scriptId)

        return DispatchQueue.main.sync {
            let manager = ScriptPreviewManager()
            if let device, device.isConnected {
                manager.attach(device: device)
            }
            manager.render(script: source, name: name, moduleSources: modules)
            scriptRuns[runId] = manager

            let error = manager.scriptError
            return [
                "ok": error == nil,
                "run_id": runId,
                "status": error == nil ? "running" : "failed",
                "name": name,
                "console": Self.consoleJson(manager.consoleLines),
                "error": error.map { ["level": "error", "text": $0, "timestamp": Self.timestamp()] } ?? NSNull()
            ]
        }
    }

    private func stopScript(arguments: [String: Any]?) -> [String: Any] {
        let runId = arguments?["run_id"] as? String
        return DispatchQueue.main.sync {
            if let runId, !runId.isEmpty {
                guard let manager = scriptRuns.removeValue(forKey: runId) else {
                    return Self.toolError(code: "run_not_found", message: "MCP script run not found: \(runId)", recovery: "Call run_script first, or omit run_id to stop all MCP-started runs.")
                }
                let console = Self.consoleJson(manager.consoleLines)
                manager.exitPreview()
                return [
                    "ok": true,
                    "run_id": runId,
                    "status": "stopped",
                    "console": console
                ]
            }

            let stopped = scriptRuns.count
            for manager in scriptRuns.values {
                manager.exitPreview()
            }
            scriptRuns.removeAll()
            return [
                "ok": true,
                "status": "stopped",
                "stopped": stopped
            ]
        }
    }

    private func resolveRunSource(arguments: [String: Any]?) -> ResolvedRunSource {
        if let source = arguments?["source"] as? String, !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let name = (arguments?["name"] as? String).flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 } ?? "MCP Script"
            return .success(source: source, name: name, scriptId: nil)
        }

        guard let scriptId = arguments?["script_id"] as? String, !scriptId.isEmpty else {
            return .failure(code: "missing_script", message: "run_script requires script_id or source", recovery: "Call list_scripts first, or pass source directly.")
        }
        guard let script = listScripts().first(where: { $0.id.caseInsensitiveCompare(scriptId) == .orderedSame }) else {
            return .failure(code: "script_not_found", message: "Script not found: \(scriptId)", recovery: "Call list_scripts again; the script may have been renamed or deleted.")
        }
        do {
            return .success(source: try String(contentsOf: script.url, encoding: .utf8), name: script.name, scriptId: script.id)
        } catch {
            return .failure(code: "script_read_failed", message: error.localizedDescription, recovery: nil)
        }
    }

    private func writeScript(arguments: [String: Any]?) -> [String: Any] {
        guard let content = arguments?["content"] as? String else {
            return Self.toolError(code: "missing_content", message: "write_script requires content")
        }

        let scripts = listScripts()
        if let scriptId = arguments?["script_id"] as? String, !scriptId.isEmpty {
            guard let script = scripts.first(where: { $0.id.caseInsensitiveCompare(scriptId) == .orderedSame }) else {
                return Self.toolError(code: "script_not_found", message: "Script not found: \(scriptId)", recovery: "Call list_scripts again; the script may have been renamed or deleted.")
            }
            guard script.editable else {
                return Self.toolError(code: "script_read_only", message: "Bundled scripts are read-only", recovery: "Create a local script with path and content, or copy the bundled script in the app UI first.")
            }

            do {
                try content.write(to: script.url, atomically: true, encoding: .utf8)
                return ["ok": true, "created": false, "script": script.json]
            } catch {
                return Self.toolError(code: "script_write_failed", message: error.localizedDescription)
            }
        }

        guard let scriptsDir = localScriptsDirectory(create: true) else {
            return Self.toolError(code: "script_directory_unavailable", message: "Local script directory is unavailable")
        }

        let fileName = Self.localScriptFileName(arguments?["path"] as? String)
        let url = scriptsDir.appendingPathComponent(fileName, isDirectory: false)
        let created = !FileManager.default.fileExists(atPath: url.path)

        do {
            try content.write(to: url, atomically: true, encoding: .utf8)
            let script = MacMcpScript(id: "local:\(fileName)", name: fileName, url: url, editable: true, sourceKind: "custom")
            return ["ok": true, "created": created, "script": script.json]
        } catch {
            return Self.toolError(code: "script_write_failed", message: error.localizedDescription)
        }
    }

    private func listScripts() -> [MacMcpScript] {
        let fileManager = FileManager.default
        var scripts: [MacMcpScript] = []

        let bundled = Bundle.main.urls(forResourcesWithExtension: "js", subdirectory: "DefaultScripts") ?? []
        for url in bundled {
            let name = url.lastPathComponent
            scripts.append(MacMcpScript(
                id: "bundled:\(name)",
                name: name,
                url: url,
                editable: false,
                sourceKind: Self.sourceKind(for: name, isBundled: true)
            ))
        }

        if let scriptsDir = localScriptsDirectory(create: false) {
            let local = (try? fileManager.contentsOfDirectory(at: scriptsDir, includingPropertiesForKeys: nil)) ?? []
            for url in local where url.pathExtension.lowercased() == "js" {
                let name = url.lastPathComponent
                scripts.append(MacMcpScript(
                    id: "local:\(name)",
                    name: name,
                    url: url,
                    editable: true,
                    sourceKind: "custom"
                ))
            }
        }

        return scripts.sorted {
            if Self.sortRank($0.sourceKind) != Self.sortRank($1.sourceKind) {
                return Self.sortRank($0.sourceKind) < Self.sortRank($1.sourceKind)
            }
            return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    private func moduleSources(excluding excludedScriptId: String?) -> [String: String] {
        var modules: [String: String] = [:]
        for script in listScripts() {
            if let excludedScriptId, script.id.caseInsensitiveCompare(excludedScriptId) == .orderedSame {
                continue
            }
            guard script.sourceKind == "library" || script.sourceKind == "kernel" else {
                continue
            }
            guard let source = try? String(contentsOf: script.url, encoding: .utf8), !source.isEmpty else {
                continue
            }
            modules[script.name] = source
            if script.name.lowercased().hasSuffix(".js") {
                modules[String(script.name.dropLast(3))] = source
            }
        }
        return modules
    }

    private func localScriptsDirectory(create: Bool) -> URL? {
        guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            return nil
        }
        let scriptsDir = documents.appendingPathComponent("scripts", isDirectory: true)
        if create {
            try? FileManager.default.createDirectory(at: scriptsDir, withIntermediateDirectories: true)
        }
        return scriptsDir
    }

    private func deviceState() -> [String: Any] {
        func build() -> [String: Any] {
            guard let device else {
                return ["ok": true, "connected": false, "mode": "Disconnected", "devices": []]
            }

            let devices = device.discoveredDevices.map { item -> [String: Any] in
                [
                    "id": item.id,
                    "name": LocalDeviceLabelFormatter.label(for: item),
                    "transport": item.transport.rawValue,
                    "board_type": item.boardType ?? NSNull(),
                    "module_label": item.moduleLabel ?? NSNull(),
                    "identifier": item.identifierText ?? NSNull(),
                    "state": item.connectionState.rawValue,
                    "last_error": item.lastErrorText ?? NSNull(),
                    "connected": item.connectionState == .connected
                ]
            }

            return [
                "ok": true,
                "connected": device.isConnected,
                "mode": device.isConnected ? "RunMode" : "Disconnected",
                "transport": device.connectedTransportKind ?? NSNull(),
                "board_type": (device.connectedBoardType ?? device.lastDetectedBoardType) as Any? ?? NSNull(),
                "firmware_version": device.deviceEmwaverVersion ?? NSNull(),
                "hardware_uid": device.connectedHardwareUID ?? NSNull(),
                "last_error": device.lastErrorText ?? NSNull(),
                "selected_device": device.isConnected ? [
                    "id": device.connectedPortName ?? "active",
                    "name": device.connectedPortName ?? "Connected",
                    "transport": device.connectedTransportKind ?? "USB"
                ] : NSNull(),
                "devices": devices
            ]
        }

        if Thread.isMainThread {
            return build()
        }
        return DispatchQueue.main.sync(execute: build)
    }

    private static func sourceKind(for name: String, isBundled: Bool) -> String {
        guard isBundled else { return "custom" }
        let lowered = name.lowercased()
        if lowered == "emw-kernel.js" || lowered == "emw-protocol.js" {
            return "kernel"
        }
        if lowered.hasPrefix("emw-") {
            return "library"
        }
        return "example"
    }

    private static func sortRank(_ sourceKind: String) -> Int {
        switch sourceKind {
        case "example": return 0
        case "library": return 1
        case "kernel": return 2
        default: return 3
        }
    }

    private static func localScriptFileName(_ requestedPath: String?) -> String {
        var raw = (requestedPath?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
            ? URL(fileURLWithPath: requestedPath ?? "").lastPathComponent
            : "mcp-script.js"
        if raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            raw = "mcp-script.js"
        }
        if !raw.lowercased().hasSuffix(".js") {
            raw += ".js"
        }
        return raw
    }

    private func send(status: Int, reason: String, body: Data, connection: NWConnection) {
        var response = Data()
        response.append(Data("HTTP/1.1 \(status) \(reason)\r\n".utf8))
        response.append(Data("Content-Type: application/json\r\n".utf8))
        response.append(Data("Content-Length: \(body.count)\r\n".utf8))
        response.append(Data("Connection: close\r\n\r\n".utf8))
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func sendEmpty(status: Int, reason: String, connection: NWConnection) {
        let response = Data("HTTP/1.1 \(status) \(reason)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private static func parseHttpRequest(_ data: Data) -> HttpRequest? {
        guard let headerEnd = data.range(of: Data("\r\n\r\n".utf8)) else {
            return nil
        }

        let headerData = data[..<headerEnd.lowerBound]
        guard let headerText = String(data: headerData, encoding: .utf8) else {
            return nil
        }

        let lines = headerText.components(separatedBy: "\r\n")
        guard let requestLine = lines.first?.split(separator: " "), requestLine.count >= 2 else {
            return nil
        }

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
            headers[key] = value
        }

        let contentLength = Int(headers["content-length"] ?? "0") ?? 0
        let bodyStart = headerEnd.upperBound
        guard data.count >= bodyStart + contentLength else {
            return nil
        }

        return HttpRequest(
            method: String(requestLine[0]),
            path: String(requestLine[1]),
            headers: headers,
            body: data[bodyStart..<(bodyStart + contentLength)]
        )
    }

    private static func tool(name: String, description: String, inputSchema: [String: Any]) -> [String: Any] {
        [
            "name": name,
            "description": description,
            "inputSchema": inputSchema
        ]
    }

    private static func emptySchema() -> [String: Any] {
        objectSchema(properties: [:], required: [])
    }

    private static func objectSchema(properties: [String: Any], required: [String]) -> [String: Any] {
        [
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false
        ]
    }

    private static func toolError(code: String, message: String, recovery: String? = nil) -> [String: Any] {
        var error: [String: Any] = [
            "code": code,
            "message": message
        ]
        if let recovery, !recovery.isEmpty {
            error["recovery"] = recovery
        }
        return [
            "ok": false,
            "error": error
        ]
    }

    private static func rpcResult(id: Any?, result: [String: Any]) -> [String: Any] {
        [
            "jsonrpc": "2.0",
            "id": id ?? NSNull(),
            "result": result
        ]
    }

    private static func rpcError(id: Any?, code: Int, message: String) -> [String: Any] {
        [
            "jsonrpc": "2.0",
            "id": id ?? NSNull(),
            "error": [
                "code": code,
                "message": message
            ]
        ]
    }

    private static func jsonRpcError(id: Any?, code: Int, message: String) -> Data {
        jsonData(rpcError(id: id, code: code, message: message))
    }

    private static func jsonString(_ value: Any) -> String {
        String(data: jsonData(value), encoding: .utf8) ?? "{}"
    }

    private static func jsonData(_ value: Any) -> Data {
        (try? JSONSerialization.data(withJSONObject: value, options: [])) ?? Data("{}".utf8)
    }

    private static func consoleJson(_ lines: [String]) -> [[String: Any]] {
        lines.map { line in
            [
                "level": line.contains("[error]") ? "error" : (line.contains("[warn]") ? "warning" : "info"),
                "text": line,
                "timestamp": timestamp()
            ]
        }
    }

    private static func timestamp() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    private struct HttpRequest {
        let method: String
        let path: String
        let headers: [String: String]
        let body: Data
    }

    private struct McpHttpResponse {
        let statusCode: Int
        let body: Data
    }

    private struct ResolvedRunSource {
        let ok: Bool
        let source: String?
        let name: String?
        let scriptId: String?
        let errorCode: String?
        let errorMessage: String?
        let recovery: String?

        static func success(source: String, name: String, scriptId: String?) -> ResolvedRunSource {
            ResolvedRunSource(ok: true, source: source, name: name, scriptId: scriptId, errorCode: nil, errorMessage: nil, recovery: nil)
        }

        static func failure(code: String, message: String, recovery: String?) -> ResolvedRunSource {
            ResolvedRunSource(ok: false, source: nil, name: nil, scriptId: nil, errorCode: code, errorMessage: message, recovery: recovery)
        }
    }

    private struct MacMcpScript {
        let id: String
        let name: String
        let url: URL
        let editable: Bool
        let sourceKind: String

        var json: [String: Any] {
            [
                "id": id,
                "name": name,
                "path": url.path,
                "editable": editable,
                "source_kind": sourceKind
            ]
        }
    }
}

enum MacMcpSettings {
    static let enabledKey = "emwaver.mcp.enabled"
    static let tokenKey = "emwaver.mcp.token"
    static let portKey = "emwaver.mcp.port"
    static let port: UInt16 = 3923

    static var enabled: Bool {
        get { UserDefaults.standard.bool(forKey: enabledKey) }
        set { UserDefaults.standard.set(newValue, forKey: enabledKey) }
    }

    static var token: String {
        if let existing = UserDefaults.standard.string(forKey: tokenKey), !existing.isEmpty {
            return existing
        }
        return resetToken()
    }

    @discardableResult
    static func resetToken() -> String {
        let token = UUID().uuidString.replacingOccurrences(of: "-", with: "") + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        UserDefaults.standard.set(token, forKey: tokenKey)
        return token
    }
}
