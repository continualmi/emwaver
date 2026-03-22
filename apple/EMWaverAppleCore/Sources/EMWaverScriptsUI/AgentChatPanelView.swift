/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import SwiftUI

public struct AgentChatPanelView: View {
    @ObservedObject private var viewModel: AgentChatViewModel

    private let agentEnabled: Bool
    private let onRequestUpgrade: (() -> Void)?

    public init(
        viewModel: AgentChatViewModel,
        agentEnabled: Bool = true,
        onRequestUpgrade: (() -> Void)? = nil
    ) {
        self.viewModel = viewModel
        self.agentEnabled = agentEnabled
        self.onRequestUpgrade = onRequestUpgrade
    }

    public var body: some View {
        VStack(spacing: 0) {
            header

            Divider()

            messages

            Divider()

            proNotice

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

                    Button("Clear Messages") {
                        viewModel.clear()
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .buttonStyle(.plain)
                .help("Agent options")
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
        VStack(alignment: .leading, spacing: 10) {
            suggestions

            TextField("Message", text: $viewModel.draft, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...6)
                .disabled(viewModel.isSending)
                .onSubmit {
                    sendOrUpgrade()
                }

            HStack {
                Text(agentEnabled ? "Enter to send" : "Pro required to send")
                    .foregroundStyle(.secondary)
                    .font(.caption)

                Spacer()

                Button {
                    sendOrUpgrade()
                } label: {
                    Text("Send")
                }
                .keyboardShortcut(.return, modifiers: [])
                .disabled(viewModel.isSending || viewModel.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(12)
    }

    private var proNotice: some View {
        Group {
            if !agentEnabled {
                HStack(alignment: .center, spacing: 10) {
                    Image(systemName: "lock.fill")
                        .foregroundStyle(.secondary)

                    Text("Agent requires EMWaver Pro. You can read chats and type, but sending is locked.")
                        .font(.callout)
                        .foregroundStyle(.secondary)

                    Spacer()

                    Button("Get EMWaver Pro…") {
                        onRequestUpgrade?()
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
        }
    }

    private func sendOrUpgrade() {
        if agentEnabled {
            viewModel.send()
        } else {
            onRequestUpgrade?()
        }
    }

    @ViewBuilder
    private var suggestions: some View {
        let items: [String] = [
            "How do I connect an EMWaver device over USB?",
            "Show me where to find Host Sessions and what they do.",
            "Help me write a script to blink a GPIO pin.",
            "How do I capture and replay an IR remote?",
            "How do I sync scripts across devices?",
        ]

        // Keep it lightweight: show when draft is empty.
        if viewModel.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(items, id: \.self) { text in
                        Button {
                            viewModel.draft = text
                            // Don't auto-send; user can edit then Send.
                        } label: {
                            Text(text)
                                .font(.caption)
                                .lineLimit(1)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 7)
                                .background(Color.gray.opacity(0.12), in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
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
                    ChatMarkdownView(markdown: renderedText)
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
        case "apply_patch": return "Edit files"
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

            // raw can be either:
            //   "web_fetch"
            // or
            //   "web_fetch https://example.com"
            let parts = raw.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
            let toolId = parts.first.map(String.init) ?? raw
            let detail = (parts.count > 1) ? String(parts[1]) : ""

            let title = friendlyToolName(toolId)
            if detail.isEmpty { return title }
            return title + "\n" + detail
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

private struct ChatMarkdownView: View {
    let markdown: String

    var body: some View {
        let src = markdown.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let blocks = splitIntoBlocks(src)

        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                BlockView(block: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func splitIntoBlocks(_ s: String) -> [String] {
        // Preserve explicit blank lines as paragraph boundaries.
        // Also split around fenced code blocks (``` ... ```) so we can render them plainly.
        var blocks: [String] = []
        var current: [String] = []
        var inFence = false

        for line in s.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) {
            if line.hasPrefix("```") {
                if inFence {
                    // closing fence
                    current.append(line)
                    blocks.append(current.joined(separator: "\n"))
                    current.removeAll(keepingCapacity: true)
                    inFence = false
                } else {
                    // opening fence
                    if !current.isEmpty {
                        blocks.append(current.joined(separator: "\n"))
                        current.removeAll(keepingCapacity: true)
                    }
                    current.append(line)
                    inFence = true
                }
                continue
            }

            if !inFence, line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                if !current.isEmpty {
                    blocks.append(current.joined(separator: "\n"))
                    current.removeAll(keepingCapacity: true)
                }
                continue
            }

            current.append(line)
        }

        if !current.isEmpty {
            blocks.append(current.joined(separator: "\n"))
        }
        return blocks
    }

    private struct BlockView: View {
        let block: String

        var body: some View {
            if isFencedCodeBlock(block) {
                CodeBlockView(code: extractFencedCode(block))
            } else if isBulletList(block) {
                BulletListView(block: block)
            } else {
                ParagraphView(text: block)
            }
        }

        private func isFencedCodeBlock(_ s: String) -> Bool {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.hasPrefix("```") && t.contains("\n```")
        }

        private func extractFencedCode(_ s: String) -> String {
            // Drop the first and last fence lines.
            let lines = s.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            guard lines.count >= 2 else { return s }
            // Remove opening fence (possibly with language id)
            // Remove final closing fence
            let inner = lines.dropFirst().dropLast()
            return inner.joined(separator: "\n")
        }

        private func isBulletList(_ s: String) -> Bool {
            let lines = s.split(separator: "\n", omittingEmptySubsequences: true)
            guard !lines.isEmpty else { return false }
            return lines.allSatisfy { $0.hasPrefix("- ") }
        }
    }

    private struct ParagraphView: View {
        let text: String

        var body: some View {
            if let attr = try? AttributedString(
                markdown: text,
                options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
            ) {
                Text(attr)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text(text)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private struct BulletListView: View {
        let block: String

        var body: some View {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(items, id: \.self) { item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("•")
                            .foregroundStyle(.secondary)
                        if let attr = try? AttributedString(
                            markdown: item,
                            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
                        ) {
                            Text(attr)
                        } else {
                            Text(item)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }

        private var items: [String] {
            block
                .split(separator: "\n", omittingEmptySubsequences: true)
                .map(String.init)
                .map { line in
                    if line.hasPrefix("- ") { return String(line.dropFirst(2)) }
                    return line
                }
        }
    }

    private struct CodeBlockView: View {
        let code: String

        var body: some View {
            Text(code)
                .font(.system(.callout, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color.black.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }
}
