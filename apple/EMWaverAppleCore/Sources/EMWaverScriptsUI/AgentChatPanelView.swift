/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import SwiftUI

public struct AgentChatPanelView: View {
    @ObservedObject private var viewModel: AgentChatViewModel

    public init(viewModel: AgentChatViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        VStack(spacing: 0) {
            header

            Divider()

            messages

            Divider()

            composer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.regularMaterial)
        .onAppear {
            viewModel.bootstrapIfPossible()
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                Menu {
                    Button("New Chat") {
                        viewModel.newConversation()
                    }

                    Divider()

                    ForEach(viewModel.conversations, id: \.id) { c in
                        Button {
                            viewModel.selectConversation(c.id)
                        } label: {
                            let t = (c.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                            Text(t.isEmpty ? c.id : t)
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "sparkles")
                        Text(viewModel.selectedConversationTitle)
                            .font(.headline)
                        Image(systemName: "chevron.down")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .menuStyle(.borderlessButton)

                Spacer()

                Menu {
                    Button("Refresh") {
                        Task { await viewModel.refreshConversations() }
                    }

                    Button("Clear Messages") {
                        viewModel.clear()
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .buttonStyle(.plain)
                .help("Chat options")
            }
        }
        .padding(12)
    }

    private var messages: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(viewModel.messages) { msg in
                        MessageRow(message: msg)
                            .id(msg.id)
                    }

                    if viewModel.isSending {
                        HStack(spacing: 8) {
                            ProgressView()
                                .controlSize(.small)
                            Text("Thinking…")
                                .foregroundStyle(.secondary)
                                .font(.callout)
                        }
                        .padding(.vertical, 8)
                    }

                    if let err = viewModel.lastError, !err.isEmpty {
                        Text(err)
                            .foregroundStyle(.red)
                            .font(.callout)
                            .padding(.vertical, 8)
                    }
                }
                .padding(12)
            }
            .onChange(of: viewModel.messages) { _ in
                scrollToBottom(using: proxy)
            }
            .onAppear {
                scrollToBottom(using: proxy)
            }
        }
    }

    private func scrollToBottom(using proxy: ScrollViewProxy) {
        guard let last = viewModel.messages.last else { return }
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.15)) {
                proxy.scrollTo(last.id, anchor: .bottom)
            }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Message", text: $viewModel.draft, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...6)
                .disabled(viewModel.isSending)
                .onSubmit {
                    viewModel.send()
                }

            HStack {
                Text("Enter to send")
                    .foregroundStyle(.secondary)
                    .font(.caption)

                Spacer()

                Button {
                    viewModel.send()
                } label: {
                    Text("Send")
                }
                .keyboardShortcut(.return, modifiers: [])
                .disabled(viewModel.isSending || viewModel.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(12)
    }
}

private struct MessageRow: View {
    let message: AgentChatMessage

    var body: some View {
        HStack {
            if message.role == .user {
                Spacer(minLength: 24)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(roleLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(message.text)
                    .textSelection(.enabled)
                    .font(.callout)
            }
            .padding(10)
            .background(bubbleBackground, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(.black.opacity(0.08))
            )
            .frame(maxWidth: 520, alignment: .leading)

            if message.role != .user {
                Spacer(minLength: 24)
            }
        }
    }

    private var roleLabel: String {
        switch message.role {
        case .user: return "You"
        case .assistant: return "Agent"
        case .system: return "System"
        }
    }

    private var bubbleBackground: some ShapeStyle {
        switch message.role {
        case .user:
            return AnyShapeStyle(Color.accentColor.opacity(0.14))
        case .assistant:
            return AnyShapeStyle(Color.gray.opacity(0.10))
        case .system:
            return AnyShapeStyle(Color.orange.opacity(0.10))
        }
    }
}
