/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

enum ScriptModuleTranspiler {
    static func transpile(_ source: String) throws -> String {
        let lines = source.components(separatedBy: .newlines)
        var output: [String] = []
        output.reserveCapacity(lines.count)

        for line in lines {
            if let transformed = try transformImportLine(line) {
                output.append(transformed)
            } else {
                output.append(line)
            }
        }

        return output.joined(separator: "\n")
    }

    private static func transformImportLine(_ line: String) throws -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("import ") else { return nil }

        if let match = firstMatch(
            #"^import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?\s*$"#,
            in: trimmed
        ) {
            let names = try destructuringNames(from: match[1])
            return "\(leadingWhitespace(in: line))const { \(names) } = require(\"\(match[2])\");"
        }

        if let match = firstMatch(
            #"^import\s+\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["']([^"']+)["'];?\s*$"#,
            in: trimmed
        ) {
            return "\(leadingWhitespace(in: line))const \(match[1]) = require(\"\(match[2])\");"
        }

        if let match = firstMatch(#"^import\s+["']([^"']+)["'];?\s*$"#, in: trimmed) {
            return "\(leadingWhitespace(in: line))require(\"\(match[1])\");"
        }

        throw TranspileError.unsupportedImport(trimmed)
    }

    private static func destructuringNames(from raw: String) throws -> String {
        let parts = raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard !parts.isEmpty else {
            throw TranspileError.unsupportedImport("import list cannot be empty")
        }

        return try parts.map { part in
            let pieces = part.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
            if pieces.count == 1 {
                return pieces[0]
            }
            if pieces.count == 3, pieces[1] == "as" {
                return "\(pieces[0]): \(pieces[2])"
            }
            throw TranspileError.unsupportedImport("unsupported import binding '\(part)'")
        }.joined(separator: ", ")
    }

    private static func leadingWhitespace(in line: String) -> String {
        String(line.prefix { $0 == " " || $0 == "\t" })
    }

    private static func firstMatch(_ pattern: String, in string: String) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(string.startIndex..<string.endIndex, in: string)
        guard let match = regex.firstMatch(in: string, range: range) else { return nil }
        return (0..<match.numberOfRanges).compactMap { index in
            let nsRange = match.range(at: index)
            guard let range = Range(nsRange, in: string) else { return nil }
            return String(string[range])
        }
    }

    enum TranspileError: LocalizedError {
        case unsupportedImport(String)

        var errorDescription: String? {
            switch self {
            case .unsupportedImport(let line):
                return "Unsupported import syntax: \(line)"
            }
        }
    }
}
