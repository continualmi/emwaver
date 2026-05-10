/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import SwiftUI

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

public struct AgentChatPanelView: View {
    @ObservedObject private var viewModel: AgentChatViewModel

    private static let messagesBottomId = "agent-chat-messages-bottom"
    private static let messagesScrollSpace = "agent-chat-messages-scroll-space"
    private static let bottomFollowTolerance: CGFloat = 32

    private let agentEnabled: Bool
    private let onRequestUpgrade: (() -> Void)?
    @State private var messagesBottomY: CGFloat = 0
    @State private var messagesViewportHeight: CGFloat = 0
    @State private var isMessagesNearBottom = true

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
            messages

            Divider()

            proNotice

            composer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Self.panelBackground)
    }

    private static var panelBackground: Color {
        #if canImport(UIKit)
        Color(uiColor: .secondarySystemBackground)
        #elseif canImport(AppKit)
        Color(nsColor: .controlBackgroundColor)
        #else
        Color.gray.opacity(0.08)
        #endif
    }

    private var messages: some View {
        ScrollViewReader { proxy in
            ZStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
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
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                            .background(messageCardBackground, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    .strokeBorder(messageCardBorder)
                            )
                            .shadow(color: messageCardShadow, radius: 10, y: 4)
                        }

                        if let err = viewModel.lastError, !err.isEmpty {
                            Text(err)
                                .foregroundStyle(.red)
                                .font(.callout)
                                .textSelection(.enabled)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 12)
                                .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                                        .strokeBorder(Color.red.opacity(0.18))
                                )
                        }

                        Color.clear
                            .frame(height: 1)
                            .id(Self.messagesBottomId)
                    }
                    .padding(12)
                    .background(
                        GeometryReader { contentProxy in
                            Color.clear.preference(
                                key: MessagesBottomDistancePreferenceKey.self,
                                value: contentProxy.frame(in: .named(Self.messagesScrollSpace)).maxY
                            )
                        }
                    )
                }
                .coordinateSpace(name: Self.messagesScrollSpace)
                .background(
                    GeometryReader { viewportProxy in
                        Color.clear.preference(
                            key: MessagesViewportHeightPreferenceKey.self,
                            value: viewportProxy.size.height
                        )
                    }
                )

                if !isMessagesNearBottom && !viewModel.isLoadingConversation {
                    VStack {
                        Spacer()
                        HStack {
                            Spacer()
                            Button {
                                scrollToBottom(using: proxy)
                            } label: {
                                Image(systemName: "arrow.down")
                                    .font(.system(size: 13, weight: .semibold))
                                    .frame(width: 30, height: 30)
                            }
                            .buttonStyle(.plain)
                            .background(.regularMaterial, in: Circle())
                            .overlay(Circle().strokeBorder(Color.black.opacity(0.10)))
                            .shadow(color: .black.opacity(0.16), radius: 8, y: 3)
                            .help("Scroll to bottom")
                            .padding(.trailing, 14)
                            .padding(.bottom, 14)
                        }
                    }
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
                }

                if viewModel.isLoadingConversation {
                    ProgressView()
                        .controlSize(.regular)
                        .padding(16)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.16), value: viewModel.isLoadingConversation)
            .animation(.easeInOut(duration: 0.16), value: isMessagesNearBottom)
            .onPreferenceChange(MessagesBottomDistancePreferenceKey.self) { bottomY in
                updateBottomState(bottomY: bottomY)
            }
            .onPreferenceChange(MessagesViewportHeightPreferenceKey.self) { viewportHeight in
                updateBottomState(viewportHeight: viewportHeight)
            }
            .onChange(of: viewModel.selectedConversationId) { _ in
                scrollToBottom(using: proxy)
            }
            .onChange(of: viewModel.messages) { _ in
                scrollToBottom(using: proxy)
            }
            .onChange(of: viewModel.isLoadingConversation) { loading in
                if !loading {
                    scrollToBottom(using: proxy)
                }
            }
            .onChange(of: viewModel.isSending) { _ in
                scrollToBottom(using: proxy)
            }
            .onChange(of: viewModel.lastError) { _ in
                scrollToBottom(using: proxy)
            }
            .onAppear {
                scrollToBottom(using: proxy)
            }
        }
    }

    private func updateBottomState(bottomY: CGFloat? = nil, viewportHeight: CGFloat? = nil) {
        let nextBottomY = bottomY ?? messagesBottomY
        let nextViewportHeight = viewportHeight ?? messagesViewportHeight
        messagesBottomY = nextBottomY
        messagesViewportHeight = nextViewportHeight

        guard nextViewportHeight > 0 else { return }
        isMessagesNearBottom = (nextBottomY - nextViewportHeight) <= Self.bottomFollowTolerance
    }

    private func scrollToBottom(using proxy: ScrollViewProxy) {
        DispatchQueue.main.async {
            proxy.scrollTo(Self.messagesBottomId, anchor: .bottom)
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            suggestions

            HStack(alignment: .center, spacing: 10) {
                TextField("Message", text: $viewModel.draft, axis: .vertical)
                    .lineLimit(1...6)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(composerFieldBackgroundColor, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(messageCardBorder)
                    )
                    .foregroundStyle(.primary)
                    .tint(.accentColor)
                    .disabled(viewModel.isSending)
                    .onSubmit {
                        sendOrUpgrade()
                    }

                if viewModel.isSending {
                    Button(role: .destructive) {
                        viewModel.stop()
                    } label: {
                        Text("Stop")
                            .frame(minWidth: 64)
                    }
                    .buttonStyle(.bordered)
                } else {
                    Button {
                        sendOrUpgrade()
                    } label: {
                        Text("Send")
                            .frame(minWidth: 64)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(viewModel.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
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

                    Text("Add an MGPT API key to enable Agent replies.")
                        .font(.callout)
                        .foregroundStyle(.secondary)

                    Spacer()

                    Button("Get Free Key…") {
                        onRequestUpgrade?()
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(messageCardBorder)
                )
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
            "Help me write a script for a connected board.",
            "Help me write a script to blink a GPIO pin.",
            "How do I capture and replay an IR remote?",
        ]

        if viewModel.messages.isEmpty && viewModel.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 10)], alignment: .leading, spacing: 10) {
                ForEach(items, id: \.self) { text in
                    Button {
                        viewModel.draft = text
                        // Don't auto-send; user can edit then Send.
                    } label: {
                        SuggestionCard(title: text, icon: suggestionIcon(for: text))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func suggestionIcon(for text: String) -> String {
        if text.localizedCaseInsensitiveContains("USB") { return "cable.connector" }
        if text.localizedCaseInsensitiveContains("connected board") { return "cpu" }
        if text.localizedCaseInsensitiveContains("GPIO") { return "lightbulb" }
        if text.localizedCaseInsensitiveContains("IR remote") { return "dot.radiowaves.left.and.right" }
        return "folder"
    }
}

private struct SuggestionCard: View {
    let title: String
    let icon: String

    @State private var isHovering = false

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 16, height: 16)

            Text(title)
                .font(.caption)
                .foregroundStyle(.primary)
                .lineLimit(3)
                .multilineTextAlignment(.leading)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .topLeading)
        .padding(10)
        .background(
            (isHovering ? Color.accentColor.opacity(0.10) : messageCardBackground),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(isHovering ? Color.accentColor.opacity(0.28) : messageCardBorder)
        )
        .shadow(color: isHovering ? Color.black.opacity(0.12) : messageCardShadow, radius: isHovering ? 10 : 8, y: 3)
        .scaleEffect(isHovering ? 1.015 : 1)
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .onHover { hovering in
            isHovering = hovering
            #if canImport(AppKit)
            if hovering {
                NSCursor.pointingHand.push()
            } else {
                NSCursor.pop()
            }
            #endif
        }
        .animation(.easeInOut(duration: 0.12), value: isHovering)
    }
}

private struct MessagesBottomDistancePreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct MessagesViewportHeightPreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private var composerFieldBackgroundColor: Color {
    #if canImport(UIKit)
    Color(uiColor: .secondarySystemBackground)
    #elseif canImport(AppKit)
    Color(nsColor: .textBackgroundColor)
    #else
    Color.white.opacity(0.9)
    #endif
}

private struct MessageRow: View {
    let message: AgentChatMessage

    var body: some View {
        HStack {
            if message.role == .user {
                Spacer(minLength: 24)
            }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 6) {
                if message.role != .user {
                    HStack(spacing: 6) {
                        if message.role == .system && isToolBubble {
                            Image(systemName: "wrench.and.screwdriver")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else if message.role == .assistant {
                            Image(systemName: "sparkles")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Text(roleLabel)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
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
            .padding(.horizontal, isToolBubble ? 10 : 14)
            .padding(.vertical, isToolBubble ? 9 : 12)
            .background(bubbleBackground, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(bubbleBorder)
            )
            .shadow(color: messageCardShadow, radius: 10, y: 4)
            .frame(maxWidth: 560, alignment: message.role == .user ? .trailing : .leading)

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
            return AnyShapeStyle(Color.accentColor.opacity(0.18))
        case .assistant:
            return AnyShapeStyle(messageCardBackground)
        case .system:
            if isToolBubble {
                return AnyShapeStyle(Color.secondary.opacity(0.11))
            }
            return AnyShapeStyle(Color.orange.opacity(0.10))
        }
    }

    private var bubbleBorder: Color {
        switch message.role {
        case .user:
            return Color.accentColor.opacity(0.20)
        case .assistant:
            return messageCardBorder
        case .system:
            return isToolBubble ? Color.secondary.opacity(0.16) : Color.orange.opacity(0.18)
        }
    }
}

private var messageCardBackground: Color {
    #if canImport(UIKit)
    Color(uiColor: .systemBackground)
    #elseif canImport(AppKit)
    Color(nsColor: .textBackgroundColor)
    #else
    Color.white.opacity(0.96)
    #endif
}

private var messageCardBorder: Color {
    Color.primary.opacity(0.13)
}

private var messageCardShadow: Color {
    Color.black.opacity(0.08)
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
