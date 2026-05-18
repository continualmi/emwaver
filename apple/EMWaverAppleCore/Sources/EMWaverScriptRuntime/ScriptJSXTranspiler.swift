/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

enum ScriptJSXTranspiler {
    enum TranspileError: LocalizedError {
        case unterminatedElement(String)
        case mismatchedClosingTag(expected: String, found: String)
        case unterminatedExpression
        case unsupportedAttribute(String)

        var errorDescription: String? {
            switch self {
            case .unterminatedElement(let tag):
                return "unterminated JSX element <\(tag)>"
            case .mismatchedClosingTag(let expected, let found):
                return "mismatched JSX closing tag: expected </\(expected)>, found </\(found)>"
            case .unterminatedExpression:
                return "unterminated JSX expression"
            case .unsupportedAttribute(let name):
                return "unsupported JSX attribute: \(name)"
            }
        }
    }

    static func transpile(_ source: String) throws -> String {
        try Parser(source).transpile()
    }

    private final class Parser {
        private let source: String
        private var index: String.Index

        init(_ source: String) {
            self.source = source
            self.index = source.startIndex
        }

        func transpile() throws -> String {
            var output = ""
            while !isAtEnd {
                if startsLineComment {
                    output += consumeLineComment()
                } else if startsBlockComment {
                    output += consumeBlockComment()
                } else if let quote = current, quote == "\"" || quote == "'" || quote == "`" {
                    output += try consumeQuotedString(quote)
                } else if current == "<", looksLikeJSXElementStart(at: index) {
                    output += try parseElement()
                } else {
                    output.append(advance())
                }
            }
            return output
        }

        private var isAtEnd: Bool {
            index >= source.endIndex
        }

        private var current: Character? {
            isAtEnd ? nil : source[index]
        }

        private var startsLineComment: Bool {
            current == "/" && peek() == "/"
        }

        private var startsBlockComment: Bool {
            current == "/" && peek() == "*"
        }

        private func advance() -> Character {
            let char = source[index]
            index = source.index(after: index)
            return char
        }

        private func peek() -> Character? {
            guard !isAtEnd else { return nil }
            let next = source.index(after: index)
            return next < source.endIndex ? source[next] : nil
        }

        private func consumeLineComment() -> String {
            let start = index
            while !isAtEnd, current != "\n" {
                _ = advance()
            }
            if !isAtEnd {
                _ = advance()
            }
            return String(source[start..<index])
        }

        private func consumeBlockComment() -> String {
            let start = index
            _ = advance()
            _ = advance()
            while !isAtEnd {
                if current == "*", peek() == "/" {
                    _ = advance()
                    _ = advance()
                    break
                }
                _ = advance()
            }
            return String(source[start..<index])
        }

        private func consumeQuotedString(_ quote: Character) throws -> String {
            let start = index
            _ = advance()
            while !isAtEnd {
                let char = advance()
                if char == "\\" {
                    if !isAtEnd { _ = advance() }
                    continue
                }
                if char == quote {
                    break
                }
            }
            return String(source[start..<index])
        }

        private func parseElement() throws -> String {
            try consume("<")
            let tag = parseTagName()
            guard !tag.isEmpty else {
                throw TranspileError.unterminatedElement("unknown")
            }

            var attributes: [(String, String)] = []
            var selfClosing = false
            var closed = false

            while !isAtEnd {
                skipWhitespace()
                if startsWith("/>") {
                    index = source.index(index, offsetBy: 2)
                    selfClosing = true
                    break
                }
                if current == ">" {
                    _ = advance()
                    break
                }
                let attribute = try parseAttribute()
                attributes.append(attribute)
            }

            var children: [String] = []
            if !selfClosing {
                while !isAtEnd {
                    if startsWith("</") {
                        index = source.index(index, offsetBy: 2)
                        let closingTag = parseTagName()
                        skipWhitespace()
                        try consume(">")
                        guard closingTag == tag else {
                            throw TranspileError.mismatchedClosingTag(expected: tag, found: closingTag)
                        }
                        closed = true
                        break
                    }

                    if current == "<", looksLikeJSXElementStart(at: index) {
                        children.append(try parseElement())
                        continue
                    }

                    if current == "{" {
                        let expression = try parseBraceExpression()
                        if !expression.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            children.append(expression)
                        }
                        continue
                    }

                    let text = parseTextChild()
                    let normalized = normalizeText(text)
                    if !normalized.isEmpty {
                        children.append(jsStringLiteral(normalized))
                    }
                }
            }

            if !selfClosing, !closed {
                throw TranspileError.unterminatedElement(tag)
            }

            let props = makeProps(attributes)
            let args = ([tagReference(tag), props] + children).joined(separator: ", ")
            return "JSX.h(\(args))"
        }

        private func parseAttribute() throws -> (String, String) {
            let name = parseAttributeName()
            guard !name.isEmpty else {
                throw TranspileError.unsupportedAttribute(String(current ?? "?"))
            }
            skipWhitespace()
            guard current == "=" else {
                return (name, "true")
            }
            _ = advance()
            skipWhitespace()

            if current == "{" {
                return (name, try parseBraceExpression())
            }
            if let quote = current, quote == "\"" || quote == "'" {
                return (name, try consumeQuotedString(quote))
            }

            let start = index
            while !isAtEnd, let char = current, !char.isWhitespace, char != ">", !startsWith("/>") {
                _ = advance()
            }
            return (name, String(source[start..<index]))
        }

        private func parseBraceExpression() throws -> String {
            try consume("{")
            let start = index
            var depth = 1
            while !isAtEnd {
                if startsLineComment {
                    _ = consumeLineComment()
                    continue
                }
                if startsBlockComment {
                    _ = consumeBlockComment()
                    continue
                }
                if let quote = current, quote == "\"" || quote == "'" || quote == "`" {
                    _ = try consumeQuotedString(quote)
                    continue
                }

                let char = advance()
                if char == "{" {
                    depth += 1
                } else if char == "}" {
                    depth -= 1
                    if depth == 0 {
                        let end = source.index(before: index)
                        return String(source[start..<end])
                    }
                }
            }
            throw TranspileError.unterminatedExpression
        }

        private func parseTextChild() -> String {
            let start = index
            while !isAtEnd {
                if current == "<" || current == "{" {
                    break
                }
                _ = advance()
            }
            return String(source[start..<index])
        }

        private func parseTagName() -> String {
            let start = index
            while !isAtEnd, let char = current, isTagNameCharacter(char) {
                _ = advance()
            }
            return String(source[start..<index])
        }

        private func parseAttributeName() -> String {
            let start = index
            while !isAtEnd, let char = current, isAttributeNameCharacter(char) {
                _ = advance()
            }
            return String(source[start..<index])
        }

        private func skipWhitespace() {
            while !isAtEnd, let char = current, char.isWhitespace {
                _ = advance()
            }
        }

        private func consume(_ expected: Character) throws {
            guard current == expected else {
                throw TranspileError.unterminatedExpression
            }
            _ = advance()
        }

        private func startsWith(_ text: String) -> Bool {
            source[index...].hasPrefix(text)
        }

        private func looksLikeJSXElementStart(at start: String.Index) -> Bool {
            guard source[start] == "<" else { return false }
            var cursor = source.index(after: start)
            guard cursor < source.endIndex, isJSXTagStart(source[cursor]) else { return false }
            while cursor < source.endIndex, isTagNameCharacter(source[cursor]) {
                cursor = source.index(after: cursor)
            }
            while cursor < source.endIndex, source[cursor].isWhitespace {
                cursor = source.index(after: cursor)
            }
            guard cursor < source.endIndex else { return false }
            if source[cursor] == ">" {
                return true
            }
            if source[cursor] == "/" {
                let next = source.index(after: cursor)
                return next < source.endIndex && source[next] == ">"
            }
            return isAttributeNameStart(source[cursor])
        }

        private func makeProps(_ attributes: [(String, String)]) -> String {
            guard !attributes.isEmpty else { return "null" }
            let pairs = attributes.map { name, value in
                "\(propertyKey(name)): \(value)"
            }
            return "{ \(pairs.joined(separator: ", ")) }"
        }

        private func propertyKey(_ name: String) -> String {
            if isIdentifier(name) {
                return name
            }
            return jsStringLiteral(name)
        }

        private func tagReference(_ tag: String) -> String {
            isIdentifier(tag) ? tag : jsStringLiteral(tag)
        }

        private func jsStringLiteral(_ value: String) -> String {
            var output = "\""
            for scalar in value.unicodeScalars {
                switch scalar {
                case "\"":
                    output += "\\\""
                case "\\":
                    output += "\\\\"
                case "\n":
                    output += "\\n"
                case "\r":
                    output += "\\r"
                case "\t":
                    output += "\\t"
                default:
                    if scalar.value < 0x20 {
                        output += String(format: "\\u%04X", scalar.value)
                    } else {
                        output.unicodeScalars.append(scalar)
                    }
                }
            }
            output += "\""
            return output
        }

        private func normalizeText(_ text: String) -> String {
            text
                .split(whereSeparator: \.isWhitespace)
                .joined(separator: " ")
        }

        private func isJSXTagStart(_ char: Character) -> Bool {
            char.isUppercase
        }

        private func isTagNameCharacter(_ char: Character) -> Bool {
            char.isLetter || char.isNumber || char == "_" || char == "."
        }

        private func isAttributeNameCharacter(_ char: Character) -> Bool {
            char.isLetter || char.isNumber || char == "_" || char == "-" || char == ":"
        }

        private func isAttributeNameStart(_ char: Character) -> Bool {
            char.isLetter || char == "_" || char == ":"
        }

        private func isIdentifier(_ value: String) -> Bool {
            guard let first = value.first else { return false }
            guard first.isLetter || first == "_" || first == "$" else { return false }
            return value.dropFirst().allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "$" }
        }
    }
}
