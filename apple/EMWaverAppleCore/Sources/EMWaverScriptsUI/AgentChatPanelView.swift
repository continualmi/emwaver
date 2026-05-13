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
                        if viewModel.messages.isEmpty && !viewModel.isLoadingConversation {
                            suggestions
                        }

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
            HStack(alignment: .center, spacing: 10) {
                AgentComposerInput(
                    text: $viewModel.draft,
                    isDisabled: viewModel.isSending,
                    onSubmit: submitComposer
                )

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
                        submitComposer()
                    } label: {
                        Text("Send")
                            .frame(minWidth: 64)
                    }
                    .buttonStyle(.borderedProminent)
                    .help("Send message")
                    .disabled(!canSubmitDraft)
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

    private var canSubmitDraft: Bool {
        !viewModel.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func submitComposer() {
        guard !viewModel.isSending, canSubmitDraft else { return }
        sendOrUpgrade()
    }

    @ViewBuilder
    private var suggestions: some View {
        let items: [String] = [
            "How do I connect an EMWaver device over USB?",
            "Help me write a script for a connected board.",
            "Help me write a script to blink a GPIO pin.",
            "How do I capture and replay an IR remote?",
        ]

        if viewModel.messages.isEmpty {
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

private struct AgentComposerInput: View {
    @Binding var text: String
    let isDisabled: Bool
    let onSubmit: () -> Void

    #if canImport(AppKit)
    @State private var macTextHeight: CGFloat = AgentComposerMetrics.minimumTextHeight
    #endif

    var body: some View {
        Group {
            #if canImport(AppKit)
            ZStack(alignment: .topLeading) {
                AgentComposerMacTextView(
                    text: $text,
                    measuredHeight: $macTextHeight,
                    isDisabled: isDisabled,
                    onSubmit: onSubmit
                )
                    .frame(maxWidth: .infinity)
                    .frame(height: macTextHeight, alignment: .topLeading)

                if text.isEmpty {
                    Text("Message")
                        .foregroundStyle(.secondary)
                        .allowsHitTesting(false)
                }
            }
            #else
            TextField("Message", text: $text, axis: .vertical)
                .lineLimit(1...8)
                .fixedSize(horizontal: false, vertical: true)
                .textFieldStyle(.plain)
                .submitLabel(.send)
                .onSubmit(onSubmit)
            #endif
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(composerFieldBackgroundColor, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(messageCardBorder)
        )
        .foregroundStyle(.primary)
        .tint(.accentColor)
        .disabled(isDisabled)
        .fixedSize(horizontal: false, vertical: true)
    }
}

private enum AgentComposerMetrics {
    static let minimumTextHeight: CGFloat = 20
    static let maximumTextHeight: CGFloat = 148
}

#if canImport(AppKit)
private struct AgentComposerMacTextView: NSViewRepresentable {
    @Binding var text: String
    @Binding var measuredHeight: CGFloat
    let isDisabled: Bool
    let onSubmit: () -> Void

    func makeNSView(context: Context) -> AgentComposerTextContainer {
        let container = AgentComposerTextContainer()
        container.textView.delegate = context.coordinator
        container.textView.onSubmit = onSubmit
        container.onHeightChange = { height in
            context.coordinator.measuredHeight.wrappedValue = height
        }
        container.textView.string = text
        container.textView.isEditable = !isDisabled
        return container
    }

    func updateNSView(_ nsView: AgentComposerTextContainer, context: Context) {
        context.coordinator.text = $text
        context.coordinator.measuredHeight = $measuredHeight
        nsView.textView.onSubmit = onSubmit
        nsView.onHeightChange = { height in
            context.coordinator.measuredHeight.wrappedValue = height
        }
        nsView.textView.isEditable = !isDisabled
        nsView.textView.alphaValue = isDisabled ? 0.55 : 1.0

        if nsView.textView.string != text {
            nsView.textView.string = text
            nsView.invalidateIntrinsicContentSize()
        }
        nsView.updateMeasuredHeight()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, measuredHeight: $measuredHeight)
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var text: Binding<String>
        var measuredHeight: Binding<CGFloat>

        init(text: Binding<String>, measuredHeight: Binding<CGFloat>) {
            self.text = text
            self.measuredHeight = measuredHeight
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            text.wrappedValue = textView.string
            guard let container = textView.enclosingScrollView?.superview as? AgentComposerTextContainer else { return }
            container.updateMeasuredHeight()
        }
    }
}

private final class AgentComposerTextContainer: NSView {
    let scrollView: NSScrollView
    let textView: AgentComposerNSTextView
    var onHeightChange: ((CGFloat) -> Void)?

    override init(frame frameRect: NSRect) {
        scrollView = NSScrollView()
        textView = AgentComposerNSTextView()
        super.init(frame: frameRect)

        wantsLayer = true
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = false
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.documentView = textView
        addSubview(scrollView)

        textView.drawsBackground = false
        textView.isRichText = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.font = .systemFont(ofSize: NSFont.systemFontSize)
        textView.textColor = .labelColor
        textView.textContainerInset = .zero
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = true
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.minSize = NSSize(width: 0, height: AgentComposerMetrics.minimumTextHeight)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var intrinsicContentSize: NSSize {
        NSSize(width: NSView.noIntrinsicMetric, height: updateMeasuredHeight())
    }

    override func layout() {
        super.layout()
        scrollView.frame = bounds
        textView.frame = NSRect(origin: .zero, size: NSSize(width: bounds.width, height: updateMeasuredHeight()))
    }

    @discardableResult
    func updateMeasuredHeight() -> CGFloat {
        let height = measuredTextHeight()
        DispatchQueue.main.async { [weak self] in
            self?.onHeightChange?(height)
        }
        return height
    }

    private func measuredTextHeight() -> CGFloat {
        guard let layoutManager = textView.layoutManager,
              let textContainer = textView.textContainer else {
            return AgentComposerMetrics.minimumTextHeight
        }

        let width = max(bounds.width, 1)
        textContainer.containerSize = NSSize(width: width, height: CGFloat.greatestFiniteMagnitude)
        layoutManager.ensureLayout(for: textContainer)
        let usedHeight = ceil(layoutManager.usedRect(for: textContainer).height)
        return min(max(usedHeight, AgentComposerMetrics.minimumTextHeight), AgentComposerMetrics.maximumTextHeight)
    }
}

private final class AgentComposerNSTextView: NSTextView {
    var onSubmit: (() -> Void)?

    override func keyDown(with event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let isReturn = event.keyCode == 36 || event.keyCode == 76
        if isReturn && !flags.contains(.shift) {
            onSubmit?()
            return
        }

        super.keyDown(with: event)
    }
}
#endif

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
    @State private var isExpanded = false

    var body: some View {
        if isToolRow {
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) { isExpanded.toggle() }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "wrench.and.screwdriver")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(toolInlineText)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                .buttonStyle(.plain)

                if isExpanded, let meta = message.toolMeta {
                    VStack(alignment: .leading, spacing: 6) {
                        if let args = meta.arguments, !args.isEmpty {
                            Text("Arguments")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                            Text(formatAgentToolJSON(.object(args)))
                                .font(.system(.caption2, design: .monospaced))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(8)
                                .background(Color.black.opacity(0.06), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        }
                        if let output = meta.output {
                            Text(meta.ok == false ? "Error" : "Output")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                            Text(formatAgentToolJSON(output))
                                .font(.system(.caption2, design: .monospaced))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(8)
                                .background(Color.black.opacity(0.06), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        }
                    }
                    .padding(.top, 6)
                }
            }
        } else if message.role == .user {
            HStack {
                Spacer(minLength: 24)
                Text(message.text)
                    .textSelection(.enabled)
                    .font(.callout)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(Color.accentColor.opacity(0.18), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(Color.accentColor.opacity(0.20))
                    )
                    .shadow(color: messageCardShadow, radius: 10, y: 4)
                    .frame(maxWidth: 560, alignment: .trailing)
            }
        } else {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Image(systemName: "sparkles")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("Agent")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    ChatMarkdownView(markdown: message.text)
                        .textSelection(.enabled)
                        .font(.callout)
                }
                .frame(maxWidth: 560, alignment: .leading)
                Spacer(minLength: 24)
            }
        }
    }

    private var isToolRow: Bool {
        message.role == .system && message.text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("[tool]")
    }

    private var toolInlineText: String {
        let t = message.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let raw = t.replacingOccurrences(of: "[tool]", with: "").trimmingCharacters(in: .whitespaces)
        let parts = raw.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
        let toolId = parts.first.map(String.init) ?? raw
        let detail = parts.count > 1 ? String(parts[1]) : ""
        if detail.isEmpty { return toolId }
        return toolId + "  " + detail
    }
}

private func formatAgentToolJSON(_ json: AgentToolJSON, indent: Int = 0) -> String {
    let pad = String(repeating: "  ", count: indent)
    switch json {
    case .string(let s): return "\"\(s)\""
    case .number(let n): return n == n.rounded() && abs(n) < 1e15 ? String(Int(n)) : String(n)
    case .bool(let b):   return b ? "true" : "false"
    case .null:          return "null"
    case .array(let a):
        if a.isEmpty { return "[]" }
        let items = a.map { "\(pad)  \(formatAgentToolJSON($0, indent: indent + 1))" }.joined(separator: ",\n")
        return "[\n\(items)\n\(pad)]"
    case .object(let o):
        if o.isEmpty { return "{}" }
        let items = o.sorted { $0.key < $1.key }
            .map { "\(pad)  \"\($0.key)\": \(formatAgentToolJSON($0.value, indent: indent + 1))" }
            .joined(separator: ",\n")
        return "{\n\(items)\n\(pad)}"
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
