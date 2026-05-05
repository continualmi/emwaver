/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

public final class PlotBufferStore {
    public static let shared = PlotBufferStore()

    public typealias Provider = () -> Data

    private var buffers: [String: Data] = [:]
    private var providers: [String: Provider] = [:]
    private let lock = NSLock()

    private init() {}

    public func setBuffer(id: String, data: Data) {
        lock.lock()
        buffers[id] = data
        lock.unlock()
    }

    public func setProvider(id: String, provider: @escaping Provider) {
        lock.lock()
        providers[id] = provider
        lock.unlock()
    }

    public func getBytes(id: String) -> Data {
        lock.lock()
        let provider = providers[id]
        let stored = buffers[id]
        lock.unlock()

        if let provider {
            return provider()
        }
        return stored ?? Data()
    }
}
