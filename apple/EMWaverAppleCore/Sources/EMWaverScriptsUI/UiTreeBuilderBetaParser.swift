/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation

#if os(macOS)

enum UiTreeBuilderBetaError: LocalizedError {
    case unsupported(String)

    var errorDescription: String? {
        switch self {
        case .unsupported(let message):
            return message
        }
    }
}

/// Text-level parser for a very specific UI pattern.
///
/// We intentionally do NOT try to parse arbitrary JavaScript.
/// We only:
/// - find the first `children: [` after `UI.column(` inside `render()`
/// - split that array into top-level items (comma-separated, bracket-balanced)
/// - allow reorder by rewriting that array slice
enum UiTreeBuilderBetaParser {
    struct Item {
        let raw: String
        let summary: String
        let kindHint: String
    }

    struct ParseResult {
        let childrenArrayRange: Range<String.Index>
        let childrenArrayText: String
        let items: [Item]
    }

    static func canEdit(source: String) -> Bool {
        (try? parse(source: source)) != nil
    }

    static func parse(source: String) throws -> ParseResult {
        guard let columnIdx = findOutsideStringsAndComments(source, needle: "UI.column") else {
            throw UiTreeBuilderBetaError.unsupported("UI Builder (Beta) currently supports scripts that use UI.column({ children: [...] }) in render().")
        }

        // From UI.column... find children:
        let searchStart = columnIdx
        guard let childrenKeyIdx = findOutsideStringsAndComments(source, needle: "children", startAt: searchStart) else {
            throw UiTreeBuilderBetaError.unsupported("Couldn't find a children: [...] array under UI.column(...).")
        }

        // Find the first '[' after `children`.
        guard let openBracket = findNextOutsideStringsAndComments(source, char: "[", startAt: childrenKeyIdx) else {
            throw UiTreeBuilderBetaError.unsupported("Couldn't locate children: [ ... ] array.")
        }
        guard let closeBracket = findMatchingBracket(source, openIndex: openBracket) else {
            throw UiTreeBuilderBetaError.unsupported("Couldn't match closing ] for children array.")
        }

        let range = openBracket..<source.index(after: closeBracket)
        let arrayText = String(source[range])

        let innerStart = source.index(after: openBracket)
        let innerEnd = closeBracket

        let rawItems = splitTopLevelCommaSeparatedItems(source: source, range: innerStart..<innerEnd)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        let items = rawItems.map { raw -> Item in
            let kind = kindHint(from: raw)
            let oneLine = raw
                .replacingOccurrences(of: "\n", with: " ")
                .replacingOccurrences(of: "\t", with: " ")
                .replacingOccurrences(of: "  ", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return Item(raw: raw, summary: oneLine, kindHint: kind)
        }

        if items.isEmpty {
            throw UiTreeBuilderBetaError.unsupported("children: [...] is empty or couldn't be parsed into items.")
        }

        return ParseResult(childrenArrayRange: range, childrenArrayText: arrayText, items: items)
    }

    static func rewriteChildrenArray(source: String, childrenArrayRange: Range<String.Index>, newItems: [String]) -> String {
        // Preserve user's indentation style by detecting the indent of the first item.
        let existing = String(source[childrenArrayRange])
        let indent = detectIndent(existingChildrenArrayText: existing)

        let joined = newItems.enumerated().map { idx, item in
            let trimmed = item.trimmingCharacters(in: .whitespacesAndNewlines)
            return indent + trimmed + (idx == newItems.count - 1 ? "" : ",")
        }.joined(separator: "\n\n")

        let replacement = "[\n" + joined + "\n" + baseIndent(from: indent) + "]"

        var out = source
        out.replaceSubrange(childrenArrayRange, with: replacement)
        return out
    }

    // MARK: - Splitting helpers

    private static func splitTopLevelCommaSeparatedItems(source: String, range: Range<String.Index>) -> [String] {
        var items: [String] = []
        var start = range.lowerBound
        var i = range.lowerBound

        var depthParen = 0
        var depthBrace = 0
        var depthBracket = 0

        var inSingle = false
        var inDouble = false
        var inTemplate = false
        var inLineComment = false
        var inBlockComment = false

        func flush(at end: String.Index) {
            let slice = source[start..<end]
            items.append(String(slice))
        }

        while i < range.upperBound {
            let c = source[i]
            let next = source.index(after: i)
            let n: Character? = (next < range.upperBound) ? source[next] : nil

            if inLineComment {
                if c == "\n" { inLineComment = false }
                i = next
                continue
            }

            if inBlockComment {
                if c == "*", n == "/" {
                    inBlockComment = false
                    i = source.index(i, offsetBy: 2)
                    continue
                }
                i = next
                continue
            }

            // String handling (very minimal but good enough for our scripts).
            if inSingle {
                if c == "\\" { i = (next < range.upperBound) ? source.index(after: next) : next; continue }
                if c == "'" { inSingle = false }
                i = next
                continue
            }
            if inDouble {
                if c == "\\" { i = (next < range.upperBound) ? source.index(after: next) : next; continue }
                if c == "\"" { inDouble = false }
                i = next
                continue
            }
            if inTemplate {
                if c == "\\" { i = (next < range.upperBound) ? source.index(after: next) : next; continue }
                if c == "`" { inTemplate = false }
                i = next
                continue
            }

            // Comment openers
            if c == "/", n == "/" {
                inLineComment = true
                i = source.index(i, offsetBy: 2)
                continue
            }
            if c == "/", n == "*" {
                inBlockComment = true
                i = source.index(i, offsetBy: 2)
                continue
            }

            // String openers
            if c == "'" { inSingle = true; i = next; continue }
            if c == "\"" { inDouble = true; i = next; continue }
            if c == "`" { inTemplate = true; i = next; continue }

            // Depth tracking
            switch c {
            case "(": depthParen += 1
            case ")": depthParen = max(0, depthParen - 1)
            case "{": depthBrace += 1
            case "}": depthBrace = max(0, depthBrace - 1)
            case "[": depthBracket += 1
            case "]": depthBracket = max(0, depthBracket - 1)
            case ",":
                if depthParen == 0, depthBrace == 0, depthBracket == 0 {
                    flush(at: i)
                    start = next
                    i = next
                    continue
                }
            default:
                break
            }

            i = next
        }

        if start < range.upperBound {
            flush(at: range.upperBound)
        }

        return items
    }

    // MARK: - Finding helpers (outside strings/comments)

    private static func findOutsideStringsAndComments(_ source: String, needle: String, startAt: String.Index? = nil) -> String.Index? {
        let start = startAt ?? source.startIndex
        guard !needle.isEmpty else { return nil }

        var i = start

        var inSingle = false
        var inDouble = false
        var inTemplate = false
        var inLineComment = false
        var inBlockComment = false

        while i < source.endIndex {
            let c = source[i]
            let next = source.index(after: i)
            let n: Character? = (next < source.endIndex) ? source[next] : nil

            if inLineComment {
                if c == "\n" { inLineComment = false }
                i = next
                continue
            }

            if inBlockComment {
                if c == "*", n == "/" {
                    inBlockComment = false
                    i = source.index(i, offsetBy: 2)
                    continue
                }
                i = next
                continue
            }

            if inSingle {
                if c == "\\" { i = (next < source.endIndex) ? source.index(after: next) : next; continue }
                if c == "'" { inSingle = false }
                i = next
                continue
            }

            if inDouble {
                if c == "\\" { i = (next < source.endIndex) ? source.index(after: next) : next; continue }
                if c == "\"" { inDouble = false }
                i = next
                continue
            }

            if inTemplate {
                if c == "\\" { i = (next < source.endIndex) ? source.index(after: next) : next; continue }
                if c == "`" { inTemplate = false }
                i = next
                continue
            }

            if c == "/", n == "/" {
                inLineComment = true
                i = source.index(i, offsetBy: 2)
                continue
            }
            if c == "/", n == "*" {
                inBlockComment = true
                i = source.index(i, offsetBy: 2)
                continue
            }

            if c == "'" { inSingle = true; i = next; continue }
            if c == "\"" { inDouble = true; i = next; continue }
            if c == "`" { inTemplate = true; i = next; continue }

            if source[i...].hasPrefix(needle) {
                return i
            }

            i = next
        }

        return nil
    }

    private static func findNextOutsideStringsAndComments(_ source: String, char: Character, startAt: String.Index) -> String.Index? {
        var i = startAt

        var inSingle = false
        var inDouble = false
        var inTemplate = false
        var inLineComment = false
        var inBlockComment = false

        while i < source.endIndex {
            let c = source[i]
            let next = source.index(after: i)
            let n: Character? = (next < source.endIndex) ? source[next] : nil

            if inLineComment {
                if c == "\n" { inLineComment = false }
                i = next
                continue
            }

            if inBlockComment {
                if c == "*", n == "/" {
                    inBlockComment = false
                    i = source.index(i, offsetBy: 2)
                    continue
                }
                i = next
                continue
            }

            if inSingle {
                if c == "\\" { i = (next < source.endIndex) ? source.index(after: next) : next; continue }
                if c == "'" { inSingle = false }
                i = next
                continue
            }

            if inDouble {
                if c == "\\" { i = (next < source.endIndex) ? source.index(after: next) : next; continue }
                if c == "\"" { inDouble = false }
                i = next
                continue
            }

            if inTemplate {
                if c == "\\" { i = (next < source.endIndex) ? source.index(after: next) : next; continue }
                if c == "`" { inTemplate = false }
                i = next
                continue
            }

            if c == "/", n == "/" {
                inLineComment = true
                i = source.index(i, offsetBy: 2)
                continue
            }
            if c == "/", n == "*" {
                inBlockComment = true
                i = source.index(i, offsetBy: 2)
                continue
            }

            if c == "'" { inSingle = true; i = next; continue }
            if c == "\"" { inDouble = true; i = next; continue }
            if c == "`" { inTemplate = true; i = next; continue }

            if c == char { return i }
            i = next
        }

        return nil
    }

    private static func findMatchingBracket(_ source: String, openIndex: String.Index) -> String.Index? {
        guard openIndex < source.endIndex, source[openIndex] == "[" else { return nil }

        var depth = 0
        var i = openIndex

        var inSingle = false
        var inDouble = false
        var inTemplate = false
        var inLineComment = false
        var inBlockComment = false

        while i < source.endIndex {
            let c = source[i]
            let next = source.index(after: i)
            let n: Character? = (next < source.endIndex) ? source[next] : nil

            if inLineComment {
                if c == "\n" { inLineComment = false }
                i = next
                continue
            }

            if inBlockComment {
                if c == "*", n == "/" {
                    inBlockComment = false
                    i = source.index(i, offsetBy: 2)
                    continue
                }
                i = next
                continue
            }

            if inSingle {
                if c == "\\" { i = (next < source.endIndex) ? source.index(after: next) : next; continue }
                if c == "'" { inSingle = false }
                i = next
                continue
            }

            if inDouble {
                if c == "\\" { i = (next < source.endIndex) ? source.index(after: next) : next; continue }
                if c == "\"" { inDouble = false }
                i = next
                continue
            }

            if inTemplate {
                if c == "\\" { i = (next < source.endIndex) ? source.index(after: next) : next; continue }
                if c == "`" { inTemplate = false }
                i = next
                continue
            }

            if c == "/", n == "/" {
                inLineComment = true
                i = source.index(i, offsetBy: 2)
                continue
            }
            if c == "/", n == "*" {
                inBlockComment = true
                i = source.index(i, offsetBy: 2)
                continue
            }

            if c == "'" { inSingle = true; i = next; continue }
            if c == "\"" { inDouble = true; i = next; continue }
            if c == "`" { inTemplate = true; i = next; continue }

            if c == "[" { depth += 1 }
            if c == "]" {
                depth -= 1
                if depth == 0 {
                    return i
                }
            }

            i = next
        }

        return nil
    }

    // MARK: - Formatting helpers

    private static func kindHint(from raw: String) -> String {
        // heuristic: UI.<type>(
        if let r = raw.range(of: "UI.") {
            let tail = raw[r.upperBound...]
            let name = tail.prefix { $0.isLetter || $0.isNumber || $0 == "_" }
            if !name.isEmpty { return "UI." + name }
        }
        return "Element"
    }

    private static func detectIndent(existingChildrenArrayText: String) -> String {
        // Find the first non-empty line after the opening '['.
        let lines = existingChildrenArrayText.components(separatedBy: .newlines)
        if lines.count < 2 { return "        " }

        for line in lines.dropFirst() {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }
            let prefix = line.prefix { $0 == " " || $0 == "\t" }
            return String(prefix)
        }

        return "        "
    }

    private static func baseIndent(from itemIndent: String) -> String {
        // Usually itemIndent is baseIndent + 2/4 spaces.
        // Best-effort: remove 2 spaces if present, else remove 1 tab, else empty.
        if itemIndent.hasSuffix("    ") {
            return String(itemIndent.dropLast(4))
        }
        if itemIndent.hasSuffix("  ") {
            return String(itemIndent.dropLast(2))
        }
        if itemIndent.hasSuffix("\t") {
            return String(itemIndent.dropLast(1))
        }
        return ""
    }
}

#endif
