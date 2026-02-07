/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation
import JavaScriptCore
import EMWaverScriptModel

public final class ScriptEngine {
    private let executionQueue = DispatchQueue(label: "com.emwaver.script.engine")
    private var context: JSContext?
    private var callbackRegistry: [String: JSValue] = [:]
    private var globalBindings: [String: Any] = [:]
    private var renderHandler: ((ScriptTree) -> Void)?
    private var errorHandler: ((String) -> Void)?

    // Timer support for `every()` (bootstrap uses setTimeout/clearTimeout).
    // Access only from executionQueue.
    private var nextTimeoutId: Int = 1
    private var timeouts: [Int: DispatchWorkItem] = [:]

    public init() {}

    private func emitError(_ message: String) {
        guard let errorHandler else { return }
        DispatchQueue.main.async {
            errorHandler(message)
        }
    }

    private func appDataRootURL() -> URL? {
        // Scripts use FS.appDataDir() as a stable, user-visible location for local artifacts.
        // On Apple, keep this aligned with the app's script storage directory so scripts/signals
        // behave like "just files" (sampler.emw, etc.).
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        return docs?.appendingPathComponent("scripts", isDirectory: true)
    }

    private func installHostPrimitives(into context: JSContext) {
        context.exceptionHandler = { [weak self] _, exception in
            if let message = exception?.toString() {
                self?.emitError("Script error: \(message)")
            }
        }

        let renderBlock: @convention(block) (JSValue) -> Void = { [weak self] value in
            self?.handleRender(nodeValue: value)
        }
        context.setObject(renderBlock, forKeyedSubscript: "_scriptRender" as NSString)

        let registerBlock: @convention(block) (String, JSValue) -> Void = { [weak self] token, callback in
            guard let self, !token.isEmpty else { return }
            self.callbackRegistry[token] = callback
        }
        context.setObject(registerBlock, forKeyedSubscript: "_scriptRegisterCallback" as NSString)

        let createByteArrayBlock: @convention(block) (JSValue) -> JSValue? = { jsArray in
            guard let context = jsArray.context else { return nil }
            guard jsArray.isArray else { return JSValue(undefinedIn: context) }
            let length = jsArray.forProperty("length")?.toInt32() ?? 0
            var bytes: [UInt8] = []
            bytes.reserveCapacity(Int(length))
            for i in 0..<length {
                if let element = jsArray.atIndex(Int(i)), element.isNumber {
                    bytes.append(UInt8(element.toInt32() & 0xFF))
                }
            }
            return JSValue(object: Data(bytes), in: context)
        }
        context.setObject(createByteArrayBlock, forKeyedSubscript: "_scriptCreateByteArray" as NSString)

        // Manual command helper (bridges to ScriptDeviceWrapper when present).
        let sendCommandBlock: @convention(block) (JSValue, JSValue) -> JSValue? = { [weak self] commandValue, timeoutValue in
            guard let self, let context = commandValue.context else { return nil }
            guard let wrapper = self.globalBindings["Device"] as? ScriptDeviceWrapper else {
                return JSValue(nullIn: context)
            }
            guard let command = commandValue.toObject() as? Data, timeoutValue.isNumber else {
                return JSValue(nullIn: context)
            }
            let timeout = timeoutValue.toInt32()
            guard let result = wrapper.sendCommand(command, timeout: Int(timeout)) else {
                return JSValue(nullIn: context)
            }
            return JSValue(object: Array(result), in: context)
        }
        context.setObject(sendCommandBlock, forKeyedSubscript: "_manualSendCommand" as NSString)

        // Android parity: DeviceConnection.sendCommandString appends newline.
        let sendCommandStringBlock: @convention(block) (String, Int) -> JSValue? = { [weak self] command, timeout in
            guard let self else { return nil }
            guard let wrapper = self.globalBindings["Device"] as? ScriptDeviceWrapper else {
                return JSValue(nullIn: context)
            }

            var framed = command
            if !framed.hasSuffix("\n") {
                framed += "\n"
            }
            guard let result = wrapper.sendCommand(Data(framed.utf8), timeout: timeout) else {
                return JSValue(nullIn: context)
            }
            return JSValue(object: Array(result), in: context)
        }
        context.setObject(sendCommandStringBlock, forKeyedSubscript: "_scriptSendCommandString" as NSString)

        // Byte-level packet variant.
        let sendPacketBlock: @convention(block) (JSValue, Int) -> JSValue? = { [weak self] bytesValue, timeout in
            guard let self else { return nil }
            guard let wrapper = self.globalBindings["Device"] as? ScriptDeviceWrapper else {
                return JSValue(nullIn: context)
            }
            guard let data = self.dataFromJSBytes(bytesValue) else { return JSValue(nullIn: context) }
            guard let result = wrapper.sendCommand(data, timeout: timeout) else {
                return JSValue(nullIn: context)
            }
            return JSValue(object: Array(result), in: context)
        }
        context.setObject(sendPacketBlock, forKeyedSubscript: "_scriptSendPacket" as NSString)

        // Blocking sleep primitive used by the sync-only bootstrap delay().
        let sleepBlock: @convention(block) (Double) -> Void = { ms in
            let durationMs = max(0.0, ms)
            if durationMs <= 0 { return }
            Thread.sleep(forTimeInterval: durationMs / 1000.0)
        }
        context.setObject(sleepBlock, forKeyedSubscript: "_scriptSleep" as NSString)

        // Minimal timer API used by every(): setTimeout/clearTimeout.
        let setTimeoutBlock: @convention(block) (JSValue, Double) -> Int = { [weak self] callback, ms in
            guard let self else { return 0 }
            let delayMs = max(0.0, ms)
            let id = self.nextTimeoutId
            self.nextTimeoutId += 1

            var item: DispatchWorkItem!
            item = DispatchWorkItem { [weak self] in
                guard let self else { return }
                if item.isCancelled { return }
                self.timeouts[id] = nil
                _ = callback.call(withArguments: [])
            }

            self.timeouts[id] = item
            let deadline = DispatchTime.now() + .milliseconds(Int(delayMs.rounded()))
            self.executionQueue.asyncAfter(deadline: deadline, execute: item)
            return id
        }
        context.setObject(setTimeoutBlock, forKeyedSubscript: "setTimeout" as NSString)

        let clearTimeoutBlock: @convention(block) (Int) -> Void = { [weak self] id in
            guard let self else { return }
            if let item = self.timeouts[id] {
                item.cancel()
                self.timeouts[id] = nil
            }
        }
        context.setObject(clearTimeoutBlock, forKeyedSubscript: "clearTimeout" as NSString)

        // -----------------------------------------------------------------
        // Minimal filesystem/path API (used by built-in scripts like sampler.emw)
        // -----------------------------------------------------------------

        let appDataDirBlock: @convention(block) () -> String = { [weak self] in
            guard let self, let url = self.appDataRootURL() else { return "" }
            return url.path
        }
        context.setObject(appDataDirBlock, forKeyedSubscript: "_scriptAppDataDir" as NSString)

        let pathJoinBlock: @convention(block) (JSValue) -> String = { partsValue in
            let rawParts = partsValue.toArray() ?? []
            let parts = rawParts.map { String(describing: $0) }.filter { !$0.isEmpty }
            return NSString.path(withComponents: parts)
        }
        context.setObject(pathJoinBlock, forKeyedSubscript: "_scriptPathJoin" as NSString)

        let ensureDirBlock: @convention(block) (String) -> Void = { [weak self] path in
            guard let self else { return }
            let p = path.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !p.isEmpty else { return }
            do {
                try FileManager.default.createDirectory(atPath: p, withIntermediateDirectories: true, attributes: nil)
            } catch {
                self.emitError("Script error: FS.ensureDir failed: \(error)")
            }
        }
        context.setObject(ensureDirBlock, forKeyedSubscript: "_scriptEnsureDir" as NSString)

        // `FS.readDir(dir)` is expected to return `[String]` (names only) across platforms.
        let readDirBlock: @convention(block) (String) -> JSValue = { path in
            let p = path.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !p.isEmpty else { return JSValue(object: [], in: context) }
            do {
                let urls = try FileManager.default.contentsOfDirectory(
                    at: URL(fileURLWithPath: p, isDirectory: true),
                    includingPropertiesForKeys: [.isDirectoryKey],
                    options: [.skipsHiddenFiles]
                )
                let names = urls.map { $0.lastPathComponent }
                return JSValue(object: names, in: context)
            } catch {
                return JSValue(object: [], in: context)
            }
        }
        context.setObject(readDirBlock, forKeyedSubscript: "_scriptReadDir" as NSString)

        let readTextBlock: @convention(block) (String) -> String = { path in
            let p = path.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !p.isEmpty else { return "" }
            return (try? String(contentsOfFile: p, encoding: .utf8)) ?? ""
        }
        context.setObject(readTextBlock, forKeyedSubscript: "_scriptReadFileText" as NSString)

        let writeTextBlock: @convention(block) (String, String) -> Void = { [weak self] path, content in
            guard let self else { return }
            let p = path.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !p.isEmpty else { return }
            do {
                let url = URL(fileURLWithPath: p)
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: nil)
                try content.write(to: url, atomically: true, encoding: .utf8)
            } catch {
                self.emitError("Script error: FS.writeText failed: \(error)")
            }
        }
        context.setObject(writeTextBlock, forKeyedSubscript: "_scriptWriteFileText" as NSString)

        let readBytesBlock: @convention(block) (String) -> JSValue = { path in
            let p = path.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !p.isEmpty else { return JSValue(object: [], in: context) }
            guard let data = try? Data(contentsOf: URL(fileURLWithPath: p)) else {
                return JSValue(object: [], in: context)
            }
            return JSValue(object: Array(data), in: context)
        }
        context.setObject(readBytesBlock, forKeyedSubscript: "_scriptReadFileBytes" as NSString)

        let writeBytesBlock: @convention(block) (String, JSValue) -> Void = { [weak self] path, bytesValue in
            guard let self else { return }
            let p = path.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !p.isEmpty else { return }
            guard let data = self.dataFromJSBytes(bytesValue) else { return }
            do {
                let url = URL(fileURLWithPath: p)
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: nil)
                try data.write(to: url, options: [.atomic])
            } catch {
                self.emitError("Script error: FS.writeBytes failed: \(error)")
            }
        }
        context.setObject(writeBytesBlock, forKeyedSubscript: "_scriptWriteFileBytes" as NSString)

        let removePathBlock: @convention(block) (String) -> Void = { [weak self] path in
            guard let self else { return }
            let p = path.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !p.isEmpty else { return }
            do {
                try FileManager.default.removeItem(at: URL(fileURLWithPath: p))
            } catch {
                self.emitError("Script error: FS.remove failed: \(error)")
            }
        }
        context.setObject(removePathBlock, forKeyedSubscript: "_scriptRemovePath" as NSString)

        let renamePathBlock: @convention(block) (String, String) -> Void = { [weak self] from, to in
            guard let self else { return }
            let src = from.trimmingCharacters(in: .whitespacesAndNewlines)
            let dst = to.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !src.isEmpty, !dst.isEmpty else { return }
            do {
                let srcURL = URL(fileURLWithPath: src)
                let dstURL = URL(fileURLWithPath: dst)
                try FileManager.default.createDirectory(at: dstURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: nil)
                try FileManager.default.moveItem(at: srcURL, to: dstURL)
            } catch {
                self.emitError("Script error: FS.rename failed: \(error)")
            }
        }
        context.setObject(renamePathBlock, forKeyedSubscript: "_scriptRenamePath" as NSString)

        let revealBlock: @convention(block) (String) -> Void = { path in
            let p = path.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !p.isEmpty else { return }
            #if os(macOS)
            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            proc.arguments = ["-R", p]
            try? proc.run()
            #else
            _ = p
            #endif
        }
        context.setObject(revealBlock, forKeyedSubscript: "_scriptRevealInFinder" as NSString)

        // -----------------------------------------------------------------
        // Sampler buffer API (used by sampler.emw via script_bootstrap.emw)
        // -----------------------------------------------------------------

        let samplerPacketCountBlock: @convention(block) () -> Int = { [weak self] in
            guard let self, let wrapper = self.globalBindings["Device"] as? ScriptDeviceWrapper else { return 0 }
            let len = wrapper.getBuffer().count
            if len <= 0 { return 0 }
            return Int((len + 63) / 64)
        }
        context.setObject(samplerPacketCountBlock, forKeyedSubscript: "_scriptSamplerBufferGetPacketCount" as NSString)

        let samplerLenBytesBlock: @convention(block) () -> Int = { [weak self] in
            guard let self, let wrapper = self.globalBindings["Device"] as? ScriptDeviceWrapper else { return 0 }
            return wrapper.getBuffer().count
        }
        context.setObject(samplerLenBytesBlock, forKeyedSubscript: "_scriptSamplerBufferGetLenBytes" as NSString)

        let samplerGetBytesBlock: @convention(block) () -> JSValue = { [weak self] in
            guard let self, let wrapper = self.globalBindings["Device"] as? ScriptDeviceWrapper else {
                return JSValue(object: [], in: context)
            }
            return JSValue(object: Array(wrapper.getBuffer()), in: context)
        }
        context.setObject(samplerGetBytesBlock, forKeyedSubscript: "_scriptSamplerBufferGetBytes" as NSString)

        let samplerClearBlock: @convention(block) () -> Void = { [weak self] in
            guard let self, let wrapper = self.globalBindings["Device"] as? ScriptDeviceWrapper else { return }
            wrapper.clearBuffer()
        }
        context.setObject(samplerClearBlock, forKeyedSubscript: "_scriptSamplerBufferClear" as NSString)

        // _scriptSamplerBufferSetInvertRx removed (legacy).

        let samplerReadPacketsBlock: @convention(block) (Int, Int) -> JSValue = { [weak self] packetIndex, maxPackets in
            guard let self, let wrapper = self.globalBindings["Device"] as? ScriptDeviceWrapper else {
                return JSValue(object: ["data": [], "nextPacketIndex": 0, "availablePackets": 0], in: context)
            }
            let data = wrapper.getBuffer()
            let totalPackets = Int((data.count + 63) / 64)
            let startPacket = max(0, packetIndex)
            let availablePackets = max(0, totalPackets - startPacket)
            let toRead = max(0, min(availablePackets, max(1, maxPackets)))

            let startByte = startPacket * 64
            let endByte = min(data.count, startByte + toRead * 64)
            let slice: [UInt8] = startByte < endByte ? Array(data[startByte..<endByte]) : []

            return JSValue(
                object: [
                    "data": slice,
                    "nextPacketIndex": startPacket + toRead,
                    "availablePackets": availablePackets,
                ],
                in: context
            )
        }
        context.setObject(samplerReadPacketsBlock, forKeyedSubscript: "_scriptSamplerBufferReadPacketsSince" as NSString)

        // -----------------------------------------------------------------
        // Plot buffer sources (used by UI.plot internal compression)
        // -----------------------------------------------------------------

        // Register the live sampler buffer as a plot source.
        if let wrapper = globalBindings["Device"] as? ScriptDeviceWrapper {
            PlotBufferStore.shared.setProvider(id: "samplerBits") {
                wrapper.getBuffer()
            }
        }

        // Allow scripts to store an in-memory byte buffer and reference it by id.
        let plotBufferSetBlock: @convention(block) (JSValue) -> String = { [weak self] bytesValue in
            guard let self else { return "" }
            guard let data = self.dataFromJSBytes(bytesValue) else { return "" }
            let id = "buf:" + UUID().uuidString
            PlotBufferStore.shared.setBuffer(id: id, data: data)
            return id
        }
        context.setObject(plotBufferSetBlock, forKeyedSubscript: "_scriptPlotBufferSet" as NSString)

        // -----------------------------------------------------------------
        // Buffer helpers used by sampler.emw (load/save + timings)
        // -----------------------------------------------------------------

        let bufferSetBytesBlock: @convention(block) (JSValue) -> Int = { [weak self] bytesValue in
            guard let self, let wrapper = self.globalBindings["Device"] as? ScriptDeviceWrapper else { return 0 }
            guard let data = self.dataFromJSBytes(bytesValue) else { return 0 }
            wrapper.loadBuffer(data: data)
            return data.count
        }
        context.setObject(bufferSetBytesBlock, forKeyedSubscript: "_scriptBufferSetBytes" as NSString)

        let bufferSaveBytesFileBlock: @convention(block) (String) -> Void = { [weak self] path in
            guard let self, let wrapper = self.globalBindings["Device"] as? ScriptDeviceWrapper else { return }
            let p = path.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !p.isEmpty else { return }
            do {
                let url = URL(fileURLWithPath: p)
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: nil)
                try wrapper.getBuffer().write(to: url, options: [.atomic])
            } catch {
                self.emitError("Script error: save buffer failed: \(error)")
            }
        }
        context.setObject(bufferSaveBytesFileBlock, forKeyedSubscript: "_scriptBufferSaveBytesFile" as NSString)

        // Retransmit helper (sampler.emw): start TX and stream the buffer bytes.
        // This is intentionally fire-and-forget: firmware completes and sends an OK lane later.
        let deviceTransmitBufferStartBlock: @convention(block) (JSValue, JSValue, String?) -> Int = { [weak self] bytesValue, optsValue, doneToken in
            guard let self, let wrapper = self.globalBindings["Device"] as? ScriptDeviceWrapper else { return 0 }
            guard let data = self.dataFromJSBytes(bytesValue) else { return 0 }

            var pin: UInt8 = 1 // default: A1 (IR_TX)
            var duty: UInt8 = 100
            var tickUs: UInt8 = 10
            var pwmHz: UInt32 = 0

            if let dict = optsValue.toDictionary() as? [String: Any] {
                if let p = dict["pin"] as? NSNumber { pin = UInt8(clamping: p.intValue) }
                if let p = dict["dutyPercent"] as? NSNumber { duty = UInt8(clamping: p.intValue) }
                if let t = dict["tickUs"] as? NSNumber { tickUs = UInt8(clamping: t.intValue) }
                if let h = dict["freqHz"] as? NSNumber { pwmHz = UInt32(clamping: h.intValue) }
            }

            if duty == 0 { duty = 50 }
            if duty > 100 { duty = 100 }
            if tickUs < 5 { tickUs = 5 }

            // Build EMW_OP_TRANSMIT START packet (matches firmware `emw_proto.h`).
            var pkt = Data(repeating: 0, count: 9)
            pkt[0] = 0x80
            pkt[1] = 0x00
            pkt[2] = pin
            pkt[3] = duty
            pkt[4] = UInt8(pwmHz & 0xff)
            pkt[5] = UInt8((pwmHz >> 8) & 0xff)
            pkt[6] = UInt8((pwmHz >> 16) & 0xff)
            pkt[7] = UInt8((pwmHz >> 24) & 0xff)
            pkt[8] = tickUs

            // Start TX, then stream bytes.
            wrapper.sendPacket(pkt)
            wrapper.loadBuffer(data: data)
            wrapper.transmitBuffer()

            if let token = doneToken, !token.isEmpty {
                self.invoke(handler: token, arguments: [])
            }

            return data.count
        }
        context.setObject(deviceTransmitBufferStartBlock, forKeyedSubscript: "_scriptDeviceTransmitBufferStart" as NSString)

        let bufferBuildSignedRawTimingsBlock: @convention(block) (Int) -> String = { [weak self] samplePeriodUsRaw in
            guard let self, let wrapper = self.globalBindings["Device"] as? ScriptDeviceWrapper else { return "" }
            let data = wrapper.getBuffer()
            if data.isEmpty { return "" }

            let samplePeriodUs = max(1, samplePeriodUsRaw)
            let totalBits = data.count * 8
            var components: [String] = []
            components.reserveCapacity(min(2048, totalBits / 8))

            var currentState = ((data[0] >> 0) & 1) == 1
            var count = 0

            func appendTiming(state: Bool, count: Int) {
                guard count > 0 else { return }
                let microseconds = count * samplePeriodUs
                let prefix = state ? "" : "-"
                components.append("\(prefix)\(microseconds)")
            }

            for index in 0..<totalBits {
                let byteIndex = index >> 3
                let bitIndex = index & 7
                let bit = ((data[byteIndex] >> bitIndex) & 1) == 1
                if bit == currentState {
                    count += 1
                } else {
                    appendTiming(state: currentState, count: count)
                    currentState = bit
                    count = 1
                }
            }

            appendTiming(state: currentState, count: count)
            return components.joined(separator: " ")
        }
        context.setObject(bufferBuildSignedRawTimingsBlock, forKeyedSubscript: "_scriptBufferBuildSignedRawTimings" as NSString)
    }

    private func dataFromJSBytes(_ bytesValue: JSValue) -> Data? {
        if let direct = bytesValue.toObject() as? Data {
            return direct
        }

        // JS arrays or typed arrays (Uint8Array etc.) are "array-like": they have a numeric `length`
        // and indexable elements. JavaScriptCore's `isArray` is false for typed arrays.
        let lengthValue = bytesValue.forProperty("length")
        guard let lengthValue, lengthValue.isNumber else { return nil }

        let length = Int(lengthValue.toInt32())
        if length <= 0 { return Data() }

        var bytes: [UInt8] = []
        bytes.reserveCapacity(length)
        for i in 0..<length {
            guard let element = bytesValue.atIndex(i), element.isNumber else { return nil }
            bytes.append(UInt8(element.toInt32() & 0xFF))
        }
        return Data(bytes)
    }

    public func setup(
        renderHandler: @escaping (ScriptTree) -> Void,
        bindings: [String: Any] = [:],
        errorHandler: ((String) -> Void)? = nil
    ) {
        self.renderHandler = renderHandler
        self.errorHandler = errorHandler
        self.globalBindings = bindings

        executionQueue.sync {
            guard let context = JSContext() else { return }
            self.installHostPrimitives(into: context)
            self.injectDSL(into: context)
            self.applyGlobalBindings(to: context)
            self.context = context
        }
    }

    public func execute(script: String, completion: (() -> Void)? = nil) {
        executionQueue.async { [weak self] in
            guard let self, let context = self.context else { return }

            self.cancelAllTimeoutsLocked()
            if self.containsAsyncTokens(script) {
                self.emitError("Script error: async/await is not supported. Scripts must be synchronous.")
                if let completion {
                    DispatchQueue.main.async { completion() }
                }
                return
            }

            self.callbackRegistry.removeAll()
            // Bootstrap hides host primitives (e.g. `_scriptSendPacket`) after capturing them.
            // Re-install on each run so re-injecting bootstrap continues to work.
            self.installHostPrimitives(into: context)
            self.injectDSL(into: context)
            self.applyGlobalBindings(to: context)

            context.exception = nil
            let wrappedScript = """
(() => {
\(script)
})();
"""
            context.evaluateScript(wrappedScript)

            if let completion {
                DispatchQueue.main.async { completion() }
            }
        }
    }

    public func invoke(handler token: String, arguments: [Any] = []) {
        executionQueue.async { [weak self] in
            guard let self else { return }
            guard let callback = self.callbackRegistry[token] else {
                self.emitError("No callback registered for token \(token)")
                return
            }
            _ = callback.call(withArguments: arguments)
        }
    }

    public func registerGlobalBindings(_ bindings: [String: Any]) {
        globalBindings.merge(bindings) { _, new in new }
        executionQueue.async { [weak self] in
            guard let self, let context = self.context else { return }
            self.applyGlobalBindings(to: context)
        }
    }

    private func cancelAllTimeoutsLocked() {
        // executionQueue only.
        for (_, item) in timeouts {
            item.cancel()
        }
        timeouts.removeAll()
    }

    private func containsAsyncTokens(_ script: String) -> Bool {
        // Intentionally simple: reject if any async/await tokens are present.
        // This may false-positive on strings/comments, but keeps behavior aligned across platforms.
        script.contains("await") || script.contains("async")
    }

    private func injectDSL(into context: JSContext) {
        guard let url = Bundle.main.url(forResource: "script_bootstrap", withExtension: "emw") else {
            emitError("Script bootstrap missing from app bundle (script_bootstrap.emw)")
            return
        }

        do {
            let source = try String(contentsOf: url, encoding: .utf8)
            context.evaluateScript(source)
        } catch {
            emitError("Failed to load script bootstrap: \(error)")
        }
    }

    private func applyGlobalBindings(to context: JSContext) {
        for (key, value) in globalBindings {
            context.setObject(value, forKeyedSubscript: key as NSString)
        }
    }

    private func handleRender(nodeValue: JSValue) {
        guard let renderHandler else { return }
        guard let rootNode = buildNode(from: nodeValue) else {
            emitError("Script render received invalid node")
            return
        }

        let metadataValue = nodeValue.forProperty("metadata")
        var metadata: [String: Any] = [:]
        if metadataValue?.isUndefined == false,
           let dict = metadataValue?.toDictionary() as? [String: Any] {
            metadata = dict
        }

        let tree = ScriptTree(root: rootNode, metadata: metadata)
        DispatchQueue.main.async { renderHandler(tree) }
    }

    private func buildNode(from value: JSValue, path: [Int] = []) -> ScriptNode? {
        guard let typeString = value.forProperty("type")?.toString(),
              let nodeType = ScriptNodeType(rawValue: typeString) else {
            return nil
        }

        let rawId = value.forProperty("id")?.toString() ?? ""
        let id = makeStableIdentifier(rawId: rawId, nodeType: nodeType, path: path)

        var rawProps: [String: Any] = [:]
        if let propsDict = value.forProperty("props")?.toDictionary() as? [String: Any] {
            rawProps = propsDict
        }

        var eventHandlers: [ScriptEventType: String] = [:]
        if let handlerDict = value.forProperty("handlers")?.toDictionary() as? [String: Any] {
            for (key, rawValue) in handlerDict {
                guard let token = rawValue as? String,
                      let eventType = ScriptEventType(rawValue: key) else {
                    continue
                }
                eventHandlers[eventType] = token
            }
        }

        var childNodes: [ScriptNode] = []
        if let childrenValue = value.forProperty("children"), childrenValue.isArray {
            let count = childrenValue.forProperty("length")?.toInt32() ?? 0
            for index in 0..<count {
                if let childValue = childrenValue.atIndex(Int(index)),
                   let childNode = buildNode(from: childValue, path: path + [Int(index)]) {
                    childNodes.append(childNode)
                }
            }
        }

        let props = ScriptNodeProps(raw: rawProps, eventHandlers: eventHandlers)
        return ScriptNode(id: id, type: nodeType, props: props, children: childNodes)
    }

    private func makeStableIdentifier(rawId: String, nodeType: ScriptNodeType, path: [Int]) -> String {
        if !rawId.isEmpty && !isAutogeneratedId(rawId, for: nodeType) {
            return rawId
        }
        let pathComponent = path.map(String.init).joined(separator: "-")
        let suffix = pathComponent.isEmpty ? "root" : pathComponent
        return "\(nodeType.rawValue)-\(suffix)"
    }

    private func isAutogeneratedId(_ id: String, for nodeType: ScriptNodeType) -> Bool {
        let prefix = "\(nodeType.rawValue)_"
        guard id.hasPrefix(prefix) else { return false }
        let suffix = id.dropFirst(prefix.count)
        return !suffix.isEmpty && suffix.allSatisfy { $0.isNumber }
    }
}
