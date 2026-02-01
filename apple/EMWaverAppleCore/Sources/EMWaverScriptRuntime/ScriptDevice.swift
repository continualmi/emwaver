/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation
import JavaScriptCore

// Device bridge exposed to the script runtime.
public protocol ScriptDevice: AnyObject {
    func getBuffer() -> Data
    func clearBuffer()
    func loadBuffer(data: Data)

    func sendPacket(_ data: Data)
    func sendCommand(_ command: Data, timeout: Int) -> Data?
    func transmitBuffer()
}

@objc public protocol ScriptDeviceJSExport: JSExport {
    func getBuffer() -> Data
    func clearBuffer()
    func loadBuffer(data: Data)
    func sendPacket(_ data: Data)
    func sendCommand(_ command: Data, timeout: Int) -> Data?
    func transmitBuffer()
}

public final class ScriptDeviceWrapper: NSObject, ScriptDeviceJSExport {
    private weak var device: (any ScriptDevice)?

    public init(device: any ScriptDevice) {
        self.device = device
        super.init()
    }

    public func getBuffer() -> Data {
        device?.getBuffer() ?? Data()
    }

    public func clearBuffer() {
        device?.clearBuffer()
    }

    public func loadBuffer(data: Data) {
        device?.loadBuffer(data: data)
    }

    public func sendPacket(_ data: Data) {
        device?.sendPacket(data)
    }

    public func sendCommand(_ command: Data, timeout: Int) -> Data? {
        device?.sendCommand(command, timeout: timeout)
    }

    public func transmitBuffer() {
        device?.transmitBuffer()
    }
}
