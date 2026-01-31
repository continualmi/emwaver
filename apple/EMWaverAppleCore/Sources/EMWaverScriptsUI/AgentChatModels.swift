/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation

public enum AgentChatRole: String, Codable {
    case user
    case assistant
    case system
}

public struct AgentChatMessage: Identifiable, Codable, Equatable {
    public let id: UUID
    public let role: AgentChatRole
    public let text: String
    public let createdAt: Date

    public init(id: UUID = UUID(), role: AgentChatRole, text: String, createdAt: Date = Date()) {
        self.id = id
        self.role = role
        self.text = text
        self.createdAt = createdAt
    }
}
