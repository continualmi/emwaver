import SwiftUI
import UniformTypeIdentifiers
import UIKit

extension String {
    func width(withFont font: UIFont) -> CGFloat {
        let attributes = [NSAttributedString.Key.font: font]
        let size = (self as NSString).size(withAttributes: attributes)
        return size.width
    }
}

struct MarkdownContent: View {
    let markdown: String
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(parseMarkdown(markdown), id: \.id) { component in
                component.view
            }
        }
    }
    
    private func parseMarkdown(_ text: String) -> [MarkdownComponent] {
        var components: [MarkdownComponent] = []
        let parts = text.split(separator: "```", omittingEmptySubsequences: false)
        
        for (index, part) in parts.enumerated() {
            if index % 2 == 0 {
                // Regular text (may contain tables)
                if !part.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    components.append(contentsOf: parseTextWithTables(String(part)))
                }
            } else {
                // Code block
                let codeLines = part.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
                let code = codeLines.count > 1 ? String(codeLines[1]) : String(part)
                components.append(.codeBlock(code))
            }
        }
        
        return components
    }
    
    private func parseTextWithTables(_ text: String) -> [MarkdownComponent] {
        var components: [MarkdownComponent] = []
        let lines = text.components(separatedBy: .newlines)
        var tableLines: [String] = []
        var normalText: [String] = []
        var inTable = false
        
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("|") && trimmed.hasSuffix("|") {
                if !inTable && !normalText.isEmpty {
                    components.append(.text(normalText.joined(separator: "\n")))
                    normalText.removeAll()
                }
                inTable = true
                tableLines.append(line)
            } else {
                if inTable {
                    if !tableLines.isEmpty {
                        components.append(.table(tableLines))
                    }
                    tableLines.removeAll()
                    inTable = false
                }
                normalText.append(line)
            }
        }
        
        if !normalText.isEmpty {
            components.append(.text(normalText.joined(separator: "\n")))
        }
        if !tableLines.isEmpty {
            components.append(.table(tableLines))
        }
        
        return components
    }
}

enum MarkdownComponent: Identifiable {
    case text(String)
    case codeBlock(String)
    case table([String])
    
    var id: String {
        switch self {
        case .text(let content):
            return "text-\(content.hashValue)"
        case .codeBlock(let code):
            return "code-\(code.hashValue)"
        case .table(let lines):
            return "table-\(lines.joined().hashValue)"
        }
    }
    
    var view: AnyView {
        switch self {
        case .text(let content):
            return AnyView(
                Text(parseMarkdownText(content))
                    .textSelection(.enabled)
                    .padding(.vertical, 4)
            )
        case .codeBlock(let code):
            return AnyView(CodeBlockView(code: code))
        case .table(let lines):
            return AnyView(TableView(lines: lines))
        }
    }
    
    private func parseMarkdownText(_ text: String) -> AttributedString {
        if let attributed = try? AttributedString(markdown: text) {
            return attributed
        }
        return AttributedString(text)
    }
}

struct CodeBlockView: View {
    let code: String
    @State private var copied = false
    @Environment(\.colorScheme) var colorScheme
    
    private var codeBlockBackground: Color {
        colorScheme == .dark ? Color(white: 0.15) : Color(white: 0.95)
    }
    
    private var codeTextColor: Color {
        colorScheme == .dark ? Color(white: 0.88) : Color(white: 0.2)
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScrollView(.horizontal, showsIndicators: true) {
                Text(code)
                    .font(.system(size: 14, design: .monospaced))
                    .foregroundColor(codeTextColor)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 20)
            }
            
            Button(action: {
                UIPasteboard.general.string = code
                copied = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    copied = false
                }
            }) {
                HStack(spacing: 4) {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 12))
                    Text(copied ? "Copied" : "Copy Code")
                        .font(.system(size: 12))
                }
                .foregroundColor(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color.accentColor.opacity(0.8))
                .cornerRadius(6)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
        .background(codeBlockBackground)
        .cornerRadius(8)
        .padding(.vertical, 10)
    }
}

struct TableView: View {
    let lines: [String]
    @Environment(\.colorScheme) var colorScheme
    
    private var tableBackground: Color {
        colorScheme == .dark ? Color(white: 0.15) : Color(white: 0.95)
    }
    
    private var borderColor: Color {
        colorScheme == .dark ? Color(white: 0.25) : Color(white: 0.7)
    }
    
    private var dividerColor: Color {
        colorScheme == .dark ? Color(white: 0.3) : Color(white: 0.6)
    }
    
    private var columnWidths: [CGFloat] {
        var widths: [CGFloat] = []
        let validLines = lines.enumerated().compactMap { index, line -> String? in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if index == 1 && trimmed.contains("---") {
                return nil
            }
            return line
        }
        
        guard !validLines.isEmpty else { return [] }
        
        let numColumns = parseCells(from: validLines[0]).count
        widths = Array(repeating: 0, count: numColumns)
        
        for line in validLines {
            let cells = parseCells(from: line)
            for (index, cell) in cells.enumerated() {
                if index < widths.count {
                    let textWidth = cell.trimmingCharacters(in: .whitespaces).width(withFont: .systemFont(ofSize: 14))
                    widths[index] = max(widths[index], textWidth + 30) // 30 for padding
                }
            }
        }
        
        return widths.map { max($0, 150) } // Minimum 150
    }
    
    private func parseCells(from line: String) -> [String] {
        let parts = line.split(separator: "|", omittingEmptySubsequences: false)
        let startIndex = parts.first?.isEmpty == true ? 1 : 0
        let endIndex = parts.last?.isEmpty == true ? parts.count - 1 : parts.count
        return Array(parts[startIndex..<endIndex]).map(String.init)
    }
    
    var body: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                    let trimmed = line.trimmingCharacters(in: .whitespaces)
                    if index == 1 && trimmed.contains("---") {
                        // Skip separator line
                    } else {
                        TableRowView(
                            line: line,
                            isHeader: index == 0,
                            dividerColor: dividerColor,
                            columnWidths: columnWidths
                        )
                        if index < lines.count - 1 && !(index == 0 && lines.count > 1 && lines[1].contains("---")) {
                            Divider()
                                .background(dividerColor)
                        }
                    }
                }
            }
            .background(tableBackground)
            .cornerRadius(8)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(borderColor, lineWidth: 1)
            )
        }
        .padding(.vertical, 10)
    }
}

struct TableRowView: View {
    let line: String
    let isHeader: Bool
    let dividerColor: Color
    let columnWidths: [CGFloat]
    @Environment(\.colorScheme) var colorScheme
    
    private var headerBackground: Color {
        colorScheme == .dark ? Color(white: 0.2) : Color(white: 0.85)
    }
    
    private var textColor: Color {
        if isHeader {
            return colorScheme == .dark ? .white : .black
        }
        return colorScheme == .dark ? Color(white: 0.88) : Color(white: 0.2)
    }
    
    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(cells.enumerated()), id: \.offset) { index, cell in
                let width = index < columnWidths.count ? columnWidths[index] : 150
                Text(cell.trimmingCharacters(in: .whitespaces))
                    .font(.system(size: 14, weight: isHeader ? .bold : .regular))
                    .foregroundColor(textColor)
                    .lineLimit(1)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 10)
                    .frame(width: width, alignment: .leading)
                    .background(isHeader ? headerBackground : Color.clear)
                
                if index < cells.count - 1 {
                    Divider()
                        .background(dividerColor)
                        .frame(width: 1)
                }
            }
        }
    }
    
    private var cells: [String] {
        let parts = line.split(separator: "|", omittingEmptySubsequences: false)
        // Skip first and last empty strings from leading/trailing |
        let startIndex = parts.first?.isEmpty == true ? 1 : 0
        let endIndex = parts.last?.isEmpty == true ? parts.count - 1 : parts.count
        return Array(parts[startIndex..<endIndex]).map(String.init)
    }
}
