/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

public enum AgentChatRole: String, Codable {
    case user
    case assistant
    case system
}

public struct AgentChatToolMeta: Codable, Equatable {
    public let arguments: [String: AgentToolJSON]?
    public let output: AgentToolJSON?
    public let ok: Bool?

    public init(arguments: [String: AgentToolJSON]? = nil, output: AgentToolJSON? = nil, ok: Bool? = nil) {
        self.arguments = arguments
        self.output = output
        self.ok = ok
    }
}

public struct AgentChatMessage: Identifiable, Codable, Equatable {
    public let id: UUID
    public let role: AgentChatRole
    public let text: String
    public let createdAt: Date
    public let toolMeta: AgentChatToolMeta?

    public init(id: UUID = UUID(), role: AgentChatRole, text: String, createdAt: Date = Date(), toolMeta: AgentChatToolMeta? = nil) {
        self.id = id
        self.role = role
        self.text = text
        self.createdAt = createdAt
        self.toolMeta = toolMeta
    }
}
