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
    }

    private var header: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles")
                    Text("Agent")
                        .font(.headline)
                }

                Spacer()

                Menu {
                    Button("New Chat") {
                        viewModel.newConversation()
                    }

                    if !viewModel.conversations.isEmpty {
                        Divider()

                        ForEach(viewModel.conversations) { conv in
                            Button {
                                viewModel.selectConversation(conv.id)
                            } label: {
                                HStack {
                                    Text(conv.title)
                                    if viewModel.selectedConversationId == conv.id {
                                        Spacer()
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }

                        if let selected = viewModel.selectedConversationId {
                            Divider()
                            Button(role: .destructive) {
                                viewModel.deleteConversation(selected)
                            } label: {
                                Text("Delete This Chat")
                            }
                        }
                    }

                    Divider()

                    Menu {
                        ForEach(AgentChatViewModel.allowedModelIds, id: \.self) { mid in
                            Button {
                                viewModel.setModelForSelectedConversation(mid)
                            } label: {
                                HStack {
                                    Text(mid)
                                    if viewModel.selectedModelId == mid {
                                        Spacer()
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    } label: {
                        Text("Model: \(viewModel.selectedModelId)")
                    }

                    Divider()

                    if viewModel.isChatGPTConnected {
                        Button(role: .destructive) {
                            viewModel.disconnectChatGPT()
                        } label: {
                            Text("Disconnect ChatGPT")
                        }
                    } else {
                        Button {
                            viewModel.connectChatGPTViaBrowser()
                        } label: {
                            Text("Connect ChatGPT (Plus/Pro)")
                        }
                    }

                    Divider()

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

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 6) {
                HStack(spacing: 6) {
                    if message.role == .system && isToolBubble {
                        Image(systemName: "wrench.and.screwdriver")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else if message.role == .assistant {
                        Image(systemName: "sparkles")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else if message.role == .user {
                        Image(systemName: "person.fill")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Text(roleLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if message.role == .assistant {
                    MarkdownText(markdown: renderedText)
                        .textSelection(.enabled)
                        .font(.callout)
                } else {
                    Text(renderedText)
                        .textSelection(.enabled)
                        .font(isToolBubble ? .caption : .callout)
                        .foregroundStyle(isToolBubble ? .secondary : .primary)
                }
            }
            .padding(isToolBubble ? 8 : 10)
            .background(bubbleBackground, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(.black.opacity(0.08))
            )
            .frame(maxWidth: 520, alignment: message.role == .user ? .trailing : .leading)

            if message.role != .user {
                Spacer(minLength: 24)
            }
        }
    }

    private var isToolBubble: Bool {
        message.role == .system && message.text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("[tool]")
    }

    private func friendlyToolName(_ toolId: String) -> String {
        switch toolId {
        case "list_scripts": return "List EMWaver scripts"
        case "list_signal_files": return "List signal files"
        case "web_fetch": return "Fetch web page"
        case "write_script": return "Write script"
        case "run_script": return "Run script"
        case "ui_snapshot": return "Snapshot UI"
        case "ui_event": return "UI action"
        default: return toolId
        }
    }

    private var renderedText: String {
        if isToolBubble {
            let t = message.text.trimmingCharacters(in: .whitespacesAndNewlines)
            let raw = t.replacingOccurrences(of: "[tool]", with: "").trimmingCharacters(in: .whitespaces)
            return friendlyToolName(raw)
        }
        return message.text
    }

    private var roleLabel: String {
        switch message.role {
        case .user: return "You"
        case .assistant: return "Agent"
        case .system:
            if isToolBubble { return "Tool" }
            return "System"
        }
    }

    private var bubbleBackground: some ShapeStyle {
        switch message.role {
        case .user:
            return AnyShapeStyle(Color.accentColor.opacity(0.14))
        case .assistant:
            return AnyShapeStyle(Color.gray.opacity(0.10))
        case .system:
            if isToolBubble {
                return AnyShapeStyle(Color.secondary.opacity(0.10))
            }
            return AnyShapeStyle(Color.orange.opacity(0.10))
        }
    }
}

private struct MarkdownText: View {
    let markdown: String

    var body: some View {
        if let attr = try? AttributedString(
            markdown: markdown,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .full)
        ) {
            Text(attr)
        } else {
            Text(markdown)
        }
    }
}
