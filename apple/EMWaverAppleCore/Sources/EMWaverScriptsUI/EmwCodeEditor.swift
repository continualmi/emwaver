/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import SwiftUI

#if canImport(AppKit)
import AppKit

public struct EmwCodeEditor: NSViewRepresentable {
    @Binding private var text: String
    private let isEditable: Bool
    private let wrapLines: Bool

    public init(text: Binding<String>, isEditable: Bool = true, wrapLines: Bool = false) {
        _text = text
        self.isEditable = isEditable
        self.wrapLines = wrapLines
    }

    public func makeNSView(context: Context) -> NSScrollView {
        // Create a TextKit 1 stack explicitly.
        // This avoids TextKit 2 edge cases where `textStorage` can be nil and
        // makes syntax coloring predictable.
        let textStorage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        textStorage.addLayoutManager(layoutManager)
        let textContainer = NSTextContainer(size: NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude))
        textContainer.widthTracksTextView = wrapLines
        layoutManager.addTextContainer(textContainer)

        let textView = CodeTextView(
            frame: NSRect(x: 0, y: 0, width: 600, height: 600),
            textContainer: textContainer
        )
        textView.delegate = context.coordinator
        textView.isEditable = isEditable
        textView.isSelectable = true
        textView.allowsUndo = true
        textView.isRichText = false
        textView.importsGraphics = false
        textView.usesFindBar = true
        textView.isIncrementalSearchingEnabled = true
        textView.usesRuler = true
        textView.smartInsertDeleteEnabled = false
        textView.isContinuousSpellCheckingEnabled = false
        textView.isGrammarCheckingEnabled = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.isAutomaticLinkDetectionEnabled = false
        textView.isAutomaticDataDetectionEnabled = false
        textView.isAutomaticTextCompletionEnabled = false

        textView.backgroundColor = .textBackgroundColor
        textView.drawsBackground = true
        textView.textContainerInset = NSSize(width: 14, height: 10)

        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = !wrapLines
        textView.autoresizingMask = [.width]
        textView.textContainer?.containerSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.textContainer?.widthTracksTextView = wrapLines

        let font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        textView.typingAttributes = [
            .font: font,
            .foregroundColor: NSColor.textColor,
        ]
        textView.textColor = .textColor
        textView.font = font
        textView.insertionPointColor = .textColor
        textView.selectedTextAttributes = [
            .backgroundColor: NSColor.selectedTextBackgroundColor,
            .foregroundColor: NSColor.selectedTextColor,
        ]

        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = !wrapLines
        scrollView.autohidesScrollers = true
        scrollView.borderType = .noBorder
        scrollView.drawsBackground = true
        scrollView.backgroundColor = .textBackgroundColor

        scrollView.documentView = textView
        scrollView.contentView.postsBoundsChangedNotifications = true

        // Ensure the editor always expands with SwiftUI layout.
        scrollView.translatesAutoresizingMaskIntoConstraints = false

        let ruler = LineNumberRulerView(scrollView: scrollView, textView: textView)
        scrollView.verticalRulerView = ruler
        scrollView.hasVerticalRuler = true
        scrollView.rulersVisible = true

        context.coordinator.install(textView: textView, rulerView: ruler)

        textView.string = text
        context.coordinator.highlightNow()
        return scrollView
    }

    public func updateNSView(_ nsView: NSScrollView, context: Context) {
        guard let textView = nsView.documentView as? NSTextView else { return }

        if context.coordinator.wrapLines != wrapLines {
            context.coordinator.wrapLines = wrapLines
            nsView.hasHorizontalScroller = !wrapLines
            textView.isHorizontallyResizable = !wrapLines
            textView.textContainer?.widthTracksTextView = wrapLines
        }

        if wrapLines {
            // Ensure the container width follows the visible width.
            let w = max(0, nsView.contentSize.width)
            textView.textContainer?.containerSize = NSSize(width: w, height: CGFloat.greatestFiniteMagnitude)
        } else {
            textView.textContainer?.containerSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        }

        if context.coordinator.isEditable != isEditable {
            context.coordinator.isEditable = isEditable
            textView.isEditable = isEditable
            textView.isSelectable = true
        }

        if context.coordinator.lastKnownText != text {
            let selected = textView.selectedRanges
            textView.string = text
            textView.selectedRanges = selected
            context.coordinator.lastKnownText = text
            context.coordinator.highlightNow()
            (nsView.verticalRulerView as? LineNumberRulerView)?.needsDisplay = true
        }
    }

    public func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, isEditable: isEditable, wrapLines: wrapLines)
    }
}

public extension EmwCodeEditor {
    final class Coordinator: NSObject, NSTextViewDelegate {
        private var text: Binding<String>
        fileprivate var lastKnownText: String
        fileprivate var isEditable: Bool
        fileprivate var wrapLines: Bool

        private weak var textView: CodeTextView?
        private weak var rulerView: LineNumberRulerView?
        private var highlightWorkItem: DispatchWorkItem?

        init(text: Binding<String>, isEditable: Bool, wrapLines: Bool) {
            self.text = text
            self.lastKnownText = text.wrappedValue
            self.isEditable = isEditable
            self.wrapLines = wrapLines
        }

        fileprivate func install(textView: CodeTextView, rulerView: LineNumberRulerView) {
            self.textView = textView
            self.rulerView = rulerView

            NotificationCenter.default.addObserver(
                self,
                selector: #selector(handleTextDidChange(_:)),
                name: NSText.didChangeNotification,
                object: textView
            )

            if let clipView = textView.enclosingScrollView?.contentView {
                NotificationCenter.default.addObserver(
                    self,
                    selector: #selector(boundsDidChange(_:)),
                    name: NSView.boundsDidChangeNotification,
                    object: clipView
                )
            }
        }

        deinit {
            NotificationCenter.default.removeObserver(self)
        }

        @objc private func handleTextDidChange(_ notification: Notification) {
            guard let tv = notification.object as? NSTextView else { return }
            let newValue = tv.string
            lastKnownText = newValue
            text.wrappedValue = newValue
            scheduleHighlight()
            rulerView?.needsDisplay = true
            textView?.needsDisplay = true
        }

        @objc private func boundsDidChange(_ notification: Notification) {
            rulerView?.needsDisplay = true
        }

        fileprivate func highlightNow() {
            highlightWorkItem?.cancel()
            highlightWorkItem = nil
            guard let tv = textView else { return }
            SyntaxHighlighter.apply(to: tv)
            rulerView?.needsDisplay = true
        }

        private func scheduleHighlight() {
            highlightWorkItem?.cancel()
            let item = DispatchWorkItem { [weak self] in
                self?.highlightNow()
            }
            highlightWorkItem = item
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: item)
        }
    }
}

private final class CodeTextView: NSTextView {
    override func keyDown(with event: NSEvent) {
        // Insert spaces for tab (simple, predictable for scripts).
        if event.keyCode == 48 { // tab
            if isEditable {
                insertText("    ", replacementRange: selectedRange())
                return
            }
        }
        super.keyDown(with: event)
    }

    override func drawBackground(in rect: NSRect) {
        super.drawBackground(in: rect)
        drawCurrentLineHighlight(in: rect)
    }

    private func drawCurrentLineHighlight(in rect: NSRect) {
        guard window?.firstResponder === self else { return }
        guard let layoutManager = layoutManager, let textContainer = textContainer else { return }
        let insertion = selectedRange().location
        guard insertion != NSNotFound else { return }

        let glyphIndex = layoutManager.glyphIndexForCharacter(at: insertion)
        var lineRange = NSRange(location: 0, length: 0)
        let lineRect = layoutManager.lineFragmentRect(forGlyphAt: glyphIndex, effectiveRange: &lineRange, withoutAdditionalLayout: true)

        var highlightRect = lineRect
        highlightRect.origin.x = 0
        highlightRect.size.width = bounds.width
        highlightRect = highlightRect.insetBy(dx: 0, dy: -1)

        if rect.intersects(highlightRect) {
            let color = NSColor.controlAccentColor.withAlphaComponent(0.06)
            color.setFill()
            NSBezierPath(rect: highlightRect).fill()
        }

        _ = textContainer
    }
}

private final class LineNumberRulerView: NSRulerView {
    private weak var textView: NSTextView?
    private let font: NSFont
    private let textColor: NSColor
    private let bgColor: NSColor

    init(scrollView: NSScrollView, textView: NSTextView) {
        self.textView = textView
        self.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        self.textColor = NSColor.secondaryLabelColor
        self.bgColor = NSColor.controlBackgroundColor
        super.init(scrollView: scrollView, orientation: .verticalRuler)
        ruleThickness = 44
        clientView = textView
    }

    required init(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func drawHashMarksAndLabels(in rect: NSRect) {
        guard let textView, let layoutManager = textView.layoutManager, let textContainer = textView.textContainer else {
            return
        }

        bgColor.setFill()
        NSBezierPath(rect: rect).fill()

        let visibleRect = scrollView?.contentView.bounds ?? .zero
        let glyphRange = layoutManager.glyphRange(forBoundingRect: visibleRect, in: textContainer)
        let charRange = layoutManager.characterRange(forGlyphRange: glyphRange, actualGlyphRange: nil)

        let nsString = textView.string as NSString
        let startLine = max(1, countLines(in: nsString, upTo: charRange.location) + 1)

        var lineNumber = startLine
        var glyphIndex = glyphRange.location
        let maxGlyph = NSMaxRange(glyphRange)
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.alignment = .right

        while glyphIndex < maxGlyph {
            var effectiveRange = NSRange(location: 0, length: 0)
            let lineRect = layoutManager.lineFragmentRect(forGlyphAt: glyphIndex, effectiveRange: &effectiveRange, withoutAdditionalLayout: true)

            let y = lineRect.minY + textView.textContainerOrigin.y
            if y > visibleRect.maxY {
                break
            }

            if y + lineRect.height >= visibleRect.minY - 2 {
                let label = "\(lineNumber)" as NSString
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: font,
                    .foregroundColor: textColor,
                    .paragraphStyle: paragraphStyle,
                ]
                let labelRect = NSRect(x: 0, y: y + 1, width: ruleThickness - 8, height: lineRect.height)
                label.draw(in: labelRect, withAttributes: attrs)
            }

            glyphIndex = NSMaxRange(effectiveRange)
            lineNumber += 1
        }

        NSColor.separatorColor.setFill()
        NSBezierPath(rect: NSRect(x: ruleThickness - 1, y: rect.minY, width: 1, height: rect.height)).fill()
    }

    private func countLines(in text: NSString, upTo index: Int) -> Int {
        if index <= 0 { return 0 }
        let safeIndex = min(index, text.length)
        var count = 0
        for i in 0..<safeIndex {
            if text.character(at: i) == 10 { // \n
                count += 1
            }
        }
        return count
    }
}

private enum SyntaxHighlighter {
    private static let baseFont = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
    private static let baseColor = NSColor.textColor
    private static let commentColor = NSColor.systemGreen.withAlphaComponent(0.85)
    private static let stringColor = NSColor.systemOrange.withAlphaComponent(0.95)
    private static let keywordColor = NSColor.systemBlue.withAlphaComponent(0.95)
    private static let numberColor = NSColor.systemPurple.withAlphaComponent(0.95)

    private static let keywordPattern = "\\b(let|const|var|function|return|if|else|for|while|break|continue|true|false|null|undefined|new|this)\\b"
    private static let numberPattern = "\\b(0x[0-9a-fA-F]+|\\d+(?:\\.\\d+)?)\\b"
    private static let stringPattern = "(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*')"
    private static let commentPattern = "//.*$"

    private static let combined: NSRegularExpression = {
        // Order matters: comments > strings > keywords/numbers.
        let pattern = "(?m)(?:(?<comment>" + commentPattern + ")|(?<string>" + stringPattern + ")|(?<keyword>" + keywordPattern + ")|(?<number>" + numberPattern + "))"
        return (try? NSRegularExpression(pattern: pattern, options: [])) ?? {
            // Should never happen; keep an inert regex.
            return try! NSRegularExpression(pattern: "\\b$^", options: [])
        }()
    }()

    static func apply(to textView: NSTextView) {
        guard let storage = textView.textStorage else { return }
        let fullRange = NSRange(location: 0, length: storage.length)

        storage.beginEditing()
        storage.setAttributes([
            .font: baseFont,
            .foregroundColor: baseColor,
        ], range: fullRange)

        combined.enumerateMatches(in: storage.string, options: [], range: fullRange) { match, _, _ in
            guard let match else { return }
            let comment = match.range(withName: "comment")
            if comment.location != NSNotFound {
                storage.addAttributes([.foregroundColor: commentColor], range: comment)
                return
            }
            let string = match.range(withName: "string")
            if string.location != NSNotFound {
                storage.addAttributes([.foregroundColor: stringColor], range: string)
                return
            }
            let keyword = match.range(withName: "keyword")
            if keyword.location != NSNotFound {
                storage.addAttributes([.foregroundColor: keywordColor], range: keyword)
                return
            }
            let number = match.range(withName: "number")
            if number.location != NSNotFound {
                storage.addAttributes([.foregroundColor: numberColor], range: number)
                return
            }
        }

        storage.endEditing()
    }
}

#endif
