/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation
import SwiftUI

@MainActor
public final class AgentChatViewModel: ObservableObject {
    @Published public private(set) var messages: [AgentChatMessage] = []
    @Published public var draft: String = ""
    @Published public var isSending: Bool = false
    @Published public var lastError: String?
    @Published public var backendURLString: String

    private let service: any AgentChatService
    private let defaultsKey = "emwaver.agent.backendURL"

    public init(service: any AgentChatService = AgentHTTPService()) {
        self.service = service
        self.backendURLString = UserDefaults.standard.string(forKey: defaultsKey) ?? "http://127.0.0.1:5000"
    }

    public func persistBackendURL() {
        UserDefaults.standard.set(backendURLString, forKey: defaultsKey)
    }

    public func clear() {
        messages.removeAll()
        lastError = nil
    }

    public func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard !isSending else { return }

        lastError = nil
        draft = ""
        messages.append(AgentChatMessage(role: .user, text: text))

        guard let baseURL = URL(string: backendURLString) else {
            lastError = AgentChatServiceError.invalidBaseURL.localizedDescription
            return
        }

        isSending = true
        Task {
            do {
                let reply = try await service.send(baseURL: baseURL, message: text)
                await MainActor.run {
                    self.messages.append(AgentChatMessage(role: .assistant, text: reply))
                    self.isSending = false
                }
            } catch {
                await MainActor.run {
                    self.lastError = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
                    self.isSending = false
                }
            }
        }
    }
}
