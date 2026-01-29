/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Foundation
import JavaScriptCore

// Device bridge exposed to scripts.
//
// We keep the historical name `BLEService` on the JS side for parity with
// Android/iOS legacy scripts, but transport is USB MIDI.
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
