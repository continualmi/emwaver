/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import SwiftUI

#if canImport(AppKit)
import AppKit

/// Native macOS code editor using NSTextView with basic syntax highlighting.
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
        let scrollView = NSScrollView()
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = !wrapLines
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = false

        let textView = NSTextView()
        textView.isRichText = false
        textView.importsGraphics = false
        textView.usesFindBar = true
        textView.allowsUndo = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.smartInsertDeleteEnabled = false
        textView.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        textView.textColor = .labelColor
        textView.drawsBackground = false
        textView.backgroundColor = .clear
        textView.textContainerInset = NSSize(width: 10, height: 10)

        context.coordinator.install(into: textView)
        context.coordinator.configure(textView: textView, isEditable: isEditable, wrapLines: wrapLines)
        context.coordinator.setTextIfNeeded(text)

        scrollView.documentView = textView
        return scrollView
    }

    public func updateNSView(_ nsView: NSScrollView, context: Context) {
        guard let textView = nsView.documentView as? NSTextView else { return }
        nsView.hasHorizontalScroller = !wrapLines
        context.coordinator.configure(textView: textView, isEditable: isEditable, wrapLines: wrapLines)
        context.coordinator.setTextIfNeeded(text)
    }

    public func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, isEditable: isEditable, wrapLines: wrapLines)
    }

    public final class Coordinator: NSObject, NSTextStorageDelegate {
        @Binding private var text: String
        var isEditable: Bool
        var wrapLines: Bool
        var lastKnownText: String
        weak var textView: NSTextView?

        private var isApplyingHighlight = false
        private var pendingHighlightWorkItem: DispatchWorkItem?

        private static let defaultFont = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)

        private static let keywordRegex = try? NSRegularExpression(
            pattern: "\\b(break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|false|finally|for|function|if|import|in|instanceof|let|new|null|return|super|switch|this|throw|true|try|typeof|undefined|var|void|while|with)\\b",
            options: []
        )
        private static let numberRegex = try? NSRegularExpression(pattern: "\\b\\d+(?:\\.\\d+)?\\b", options: [])
        private static let lineCommentRegex = try? NSRegularExpression(pattern: "//.*", options: [])
        private static let blockCommentRegex = try? NSRegularExpression(pattern: "/\\*[\\s\\S]*?\\*/", options: [])
        private static let stringRegex = try? NSRegularExpression(
            pattern: "(?:'([^'\\\\]|\\\\.)*'|\"([^\"\\\\]|\\\\.)*\"|`([^`\\\\]|\\\\.)*`)",
            options: []
        )

        init(text: Binding<String>, isEditable: Bool, wrapLines: Bool) {
            _text = text
            self.isEditable = isEditable
            self.wrapLines = wrapLines
            self.lastKnownText = text.wrappedValue
        }

        deinit {
            if let textView {
                NotificationCenter.default.removeObserver(self, name: NSText.didChangeNotification, object: textView)
            } else {
                NotificationCenter.default.removeObserver(self)
            }
        }

        func install(into textView: NSTextView) {
            self.textView = textView
            textView.textStorage?.delegate = self

            NotificationCenter.default.addObserver(
                self,
                selector: #selector(textDidChange(_:)),
                name: NSText.didChangeNotification,
                object: textView
            )
        }

        func configure(textView: NSTextView, isEditable: Bool, wrapLines: Bool) {
            self.isEditable = isEditable
            self.wrapLines = wrapLines

            textView.isEditable = isEditable
            textView.isSelectable = true

            // Wrapping behavior.
            textView.textContainer?.widthTracksTextView = wrapLines
            textView.isHorizontallyResizable = !wrapLines
            let max = CGFloat(Double.greatestFiniteMagnitude)
            textView.maxSize = NSSize(width: max, height: max)
            textView.textContainer?.containerSize = NSSize(
                width: wrapLines ? textView.bounds.width : max,
                height: max
            )
        }

        func setTextIfNeeded(_ newText: String) {
            guard let textView else { return }
            // Compare against the view's actual contents, not just lastKnownText.
            // On first mount, lastKnownText == binding but NSTextView.string is still empty.
            if textView.string == newText {
                lastKnownText = newText
                return
            }

            lastKnownText = newText
            let selected = textView.selectedRanges
            textView.string = newText
            textView.selectedRanges = selected
            scheduleHighlight()
        }

        @objc private func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            let newText = textView.string
            guard lastKnownText != newText else { return }
            lastKnownText = newText
            text = newText
            scheduleHighlight()
        }

        public func textStorage(_ textStorage: NSTextStorage, didProcessEditing editedMask: NSTextStorageEditActions, range editedRange: NSRange, changeInLength delta: Int) {
            guard !isApplyingHighlight else { return }
            if editedMask.contains(NSTextStorageEditActions.editedCharacters) {
                scheduleHighlight()
            }
        }

        private func scheduleHighlight() {
            pendingHighlightWorkItem?.cancel()
            let work = DispatchWorkItem { [weak self] in
                self?.applyHighlighting()
            }
            pendingHighlightWorkItem = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.03, execute: work)
        }

        private func applyHighlighting() {
            guard let textView, let storage = textView.textStorage else { return }
            let fullRange = NSRange(location: 0, length: (storage.string as NSString).length)

            isApplyingHighlight = true
            defer { isApplyingHighlight = false }

            let baseAttrs: [NSAttributedString.Key: Any] = [
                .font: Self.defaultFont,
                .foregroundColor: NSColor.labelColor
            ]
            storage.setAttributes(baseAttrs, range: fullRange)

            let text = storage.string

            let commentAttrs: [NSAttributedString.Key: Any] = [
                .foregroundColor: NSColor.secondaryLabelColor
            ]
            let stringAttrs: [NSAttributedString.Key: Any] = [
                .foregroundColor: NSColor.systemRed
            ]
            let keywordAttrs: [NSAttributedString.Key: Any] = [
                .foregroundColor: NSColor.systemBlue
            ]
            let numberAttrs: [NSAttributedString.Key: Any] = [
                .foregroundColor: NSColor.systemPurple
            ]

            if let re = Self.blockCommentRegex {
                for match in re.matches(in: text, range: fullRange) {
                    storage.addAttributes(commentAttrs, range: match.range)
                }
            }

            if let re = Self.lineCommentRegex {
                for match in re.matches(in: text, range: fullRange) {
                    storage.addAttributes(commentAttrs, range: match.range)
                }
            }

            if let re = Self.stringRegex {
                for match in re.matches(in: text, range: fullRange) {
                    storage.addAttributes(stringAttrs, range: match.range)
                }
            }

            if let re = Self.numberRegex {
                for match in re.matches(in: text, range: fullRange) {
                    storage.addAttributes(numberAttrs, range: match.range)
                }
            }

            if let re = Self.keywordRegex {
                for match in re.matches(in: text, range: fullRange) {
                    storage.addAttributes(keywordAttrs, range: match.range)
                }
            }
        }
    }
}

#endif

#if canImport(UIKit)
import UIKit

/// Native iOS code editor using UITextView with basic syntax highlighting.
public struct EmwCodeEditor: UIViewRepresentable {
    @Binding private var text: String
    private let isEditable: Bool
    private let wrapLines: Bool

    public init(text: Binding<String>, isEditable: Bool = true, wrapLines: Bool = false) {
        _text = text
        self.isEditable = isEditable
        self.wrapLines = wrapLines
    }

    public func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.backgroundColor = .clear
        view.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        view.textColor = .label
        view.textContainerInset = UIEdgeInsets(top: 10, left: 10, bottom: 10, right: 10)
        view.autocorrectionType = .no
        view.autocapitalizationType = .none
        view.smartDashesType = .no
        view.smartQuotesType = .no
        view.smartInsertDeleteType = .no
        view.keyboardDismissMode = .interactive
        view.delegate = context.coordinator

        context.coordinator.configure(textView: view, isEditable: isEditable, wrapLines: wrapLines)
        context.coordinator.setTextIfNeeded(text)
        return view
    }

    public func updateUIView(_ uiView: UITextView, context: Context) {
        context.coordinator.configure(textView: uiView, isEditable: isEditable, wrapLines: wrapLines)
        context.coordinator.setTextIfNeeded(text)
    }

    public func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, isEditable: isEditable, wrapLines: wrapLines)
    }

    public final class Coordinator: NSObject, UITextViewDelegate {
        @Binding private var text: String
        var isEditable: Bool
        var wrapLines: Bool
        var lastKnownText: String
        weak var textView: UITextView?

        private var isApplyingHighlight = false
        private var pendingHighlightWorkItem: DispatchWorkItem?

        private static let defaultFont = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)

        private static let keywordRegex = try? NSRegularExpression(
            pattern: "\\b(break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|false|finally|for|function|if|import|in|instanceof|let|new|null|return|super|switch|this|throw|true|try|typeof|undefined|var|void|while|with)\\b",
            options: []
        )
        private static let numberRegex = try? NSRegularExpression(pattern: "\\b\\d+(?:\\.\\d+)?\\b", options: [])
        private static let lineCommentRegex = try? NSRegularExpression(pattern: "//.*", options: [])
        private static let blockCommentRegex = try? NSRegularExpression(pattern: "/\\*[\\s\\S]*?\\*/", options: [])
        private static let stringRegex = try? NSRegularExpression(
            pattern: "(?:'([^'\\\\]|\\\\.)*'|\"([^\"\\\\]|\\\\.)*\"|`([^`\\\\]|\\\\.)*`)",
            options: []
        )

        init(text: Binding<String>, isEditable: Bool, wrapLines: Bool) {
            _text = text
            self.isEditable = isEditable
            self.wrapLines = wrapLines
            self.lastKnownText = text.wrappedValue
        }

        func configure(textView: UITextView, isEditable: Bool, wrapLines: Bool) {
            self.isEditable = isEditable
            self.wrapLines = wrapLines
            self.textView = textView

            textView.isEditable = isEditable
            textView.isSelectable = true

            if wrapLines {
                textView.textContainer.lineBreakMode = .byWordWrapping
                textView.textContainer.widthTracksTextView = true
                textView.showsHorizontalScrollIndicator = false
            } else {
                textView.textContainer.lineBreakMode = .byClipping
                textView.textContainer.widthTracksTextView = false
                textView.textContainer.size = CGSize(
                    width: CGFloat.greatestFiniteMagnitude,
                    height: CGFloat.greatestFiniteMagnitude
                )
                textView.showsHorizontalScrollIndicator = true
            }
        }

        func setTextIfNeeded(_ newText: String) {
            guard let textView else { return }
            if textView.text == newText {
                lastKnownText = newText
                return
            }

            lastKnownText = newText
            let selected = textView.selectedRange
            let offset = textView.contentOffset
            textView.text = newText
            textView.selectedRange = selected
            textView.setContentOffset(offset, animated: false)
            scheduleHighlight()
        }

        public func textViewDidChange(_ textView: UITextView) {
            let newText = textView.text ?? ""
            guard lastKnownText != newText else { return }
            lastKnownText = newText
            text = newText
            scheduleHighlight()
        }

        private func scheduleHighlight() {
            pendingHighlightWorkItem?.cancel()
            let work = DispatchWorkItem { [weak self] in
                self?.applyHighlighting()
            }
            pendingHighlightWorkItem = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.03, execute: work)
        }

        private func applyHighlighting() {
            guard let textView else { return }
            guard !isApplyingHighlight else { return }

            isApplyingHighlight = true
            defer { isApplyingHighlight = false }

            let rawText = textView.text ?? ""
            let nsText = rawText as NSString
            let fullRange = NSRange(location: 0, length: nsText.length)

            let baseAttrs: [NSAttributedString.Key: Any] = [
                .font: Self.defaultFont,
                .foregroundColor: UIColor.label
            ]
            let attributed = NSMutableAttributedString(string: rawText, attributes: baseAttrs)

            let commentAttrs: [NSAttributedString.Key: Any] = [
                .foregroundColor: UIColor.secondaryLabel
            ]
            let stringAttrs: [NSAttributedString.Key: Any] = [
                .foregroundColor: UIColor.systemRed
            ]
            let keywordAttrs: [NSAttributedString.Key: Any] = [
                .foregroundColor: UIColor.systemBlue
            ]
            let numberAttrs: [NSAttributedString.Key: Any] = [
                .foregroundColor: UIColor.systemPurple
            ]

            if let re = Self.blockCommentRegex {
                for match in re.matches(in: rawText, range: fullRange) {
                    attributed.addAttributes(commentAttrs, range: match.range)
                }
            }

            if let re = Self.lineCommentRegex {
                for match in re.matches(in: rawText, range: fullRange) {
                    attributed.addAttributes(commentAttrs, range: match.range)
                }
            }

            if let re = Self.stringRegex {
                for match in re.matches(in: rawText, range: fullRange) {
                    attributed.addAttributes(stringAttrs, range: match.range)
                }
            }

            if let re = Self.numberRegex {
                for match in re.matches(in: rawText, range: fullRange) {
                    attributed.addAttributes(numberAttrs, range: match.range)
                }
            }

            if let re = Self.keywordRegex {
                for match in re.matches(in: rawText, range: fullRange) {
                    attributed.addAttributes(keywordAttrs, range: match.range)
                }
            }

            let selected = textView.selectedRange
            let offset = textView.contentOffset
            textView.attributedText = attributed
            textView.selectedRange = selected
            textView.setContentOffset(offset, animated: false)
        }
    }
}

#endif
