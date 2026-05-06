/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

public enum AgentToolJSON: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: AgentToolJSON])
    case array([AgentToolJSON])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([AgentToolJSON].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: AgentToolJSON].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }

    var stringValue: String? {
        switch self {
        case .string(let value): return value
        case .number(let value): return String(value)
        case .bool(let value): return value ? "true" : "false"
        default: return nil
        }
    }
}

struct AgentToolCall: Codable, Equatable {
    let id: String?
    let name: String
    let arguments: [String: AgentToolJSON]?
}

public struct AgentToolResult: Codable, Equatable {
    public let id: String?
    public let name: String
    public let ok: Bool
    public let result: AgentToolJSON?
    public let error: String?

    public init(id: String?, name: String, ok: Bool, result: AgentToolJSON? = nil, error: String? = nil) {
        self.id = id
        self.name = name
        self.ok = ok
        self.result = result
        self.error = error
    }
}

@MainActor
public struct AgentToolRuntime {
    public let manifest: () -> String
    public let context: () -> String
    public let execute: (_ name: String, _ arguments: [String: AgentToolJSON]) async -> AgentToolResult

    public init(
        manifest: @escaping () -> String,
        context: @escaping () -> String,
        execute: @escaping (_ name: String, _ arguments: [String: AgentToolJSON]) async -> AgentToolResult
    ) {
        self.manifest = manifest
        self.context = context
        self.execute = execute
    }
}
