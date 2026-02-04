/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import SwiftUI
import Foundation
import EMWaverScriptStorage

public struct SignalViewerView: View {
    public struct Item: Identifiable, Equatable {
        public let id: String
        public let name: String
        public let kind: ScriptsViewModel.FileKind
    }

    @Environment(\.dismiss) private var dismiss

    let item: Item

    @State private var isLoading = true
    @State private var errorText: String?
    @State private var textContent: String = ""
    @State private var hexContent: String = ""

    public init(item: Item) {
        self.item = item
    }

    public var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorText {
                    VStack(spacing: 10) {
                        Text("Unable to open")
                            .font(.headline)
                        Text(errorText)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    viewer
                }
            }
            .navigationTitle(item.name)
            #if canImport(UIKit)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }

                ToolbarItem(placement: .primaryAction) {
                    Button {
                        copyToPasteboard(item.kind == .signalRaw ? hexContent : textContent)
                    } label: {
                        Image(systemName: "doc.on.doc")
                    }
                    .help("Copy")
                    .disabled((item.kind == .signalRaw ? hexContent : textContent).isEmpty)
                }
            }
        }
        .task {
            await load()
        }
    }

    @ViewBuilder
    private var viewer: some View {
        switch item.kind {
        case .signalRaw:
            ScrollView {
                Text(hexContent)
                    .font(.system(.caption, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
            }
            .background(Color.gray.opacity(0.06))
        case .signalText:
            TextEditor(text: .constant(textContent))
                .font(.system(.body, design: .monospaced))
                .disabled(true)
                .padding(8)
        case .script:
            Text("Not a signal")
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let fm = FileManager.default
            let dir = FileService.shared.signalsDirectoryURL()
            let url = dir.appendingPathComponent(item.id)
            guard fm.fileExists(atPath: url.path) else {
                throw FileServiceError.fileNotFound
            }

            switch item.kind {
            case .signalRaw:
                let data = try Data(contentsOf: url)
                hexContent = Self.formatHex(data: data, maxBytes: 256 * 1024)
            case .signalText:
                let data = try Data(contentsOf: url)
                textContent = String(data: data, encoding: .utf8) ?? ""
            case .script:
                break
            }
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private static func formatHex(data: Data, maxBytes: Int) -> String {
        let slice = data.prefix(maxBytes)
        var out: [String] = []
        out.reserveCapacity((slice.count / 16) + 8)

        let bytes = [UInt8](slice)
        var offset = 0
        while offset < bytes.count {
            let line = bytes[offset..<min(offset + 16, bytes.count)]
            let hex = line.map { String(format: "%02X", $0) }.joined(separator: " ")
            let ascii = line.map { b -> String in
                if b >= 32 && b < 127 {
                    return String(UnicodeScalar(b))
                }
                return "."
            }.joined()
            out.append(String(format: "%08X  %-47@  |%@|", offset, hex as NSString, ascii as NSString))
            offset += 16
        }

        if data.count > maxBytes {
            out.append("\n(truncated to \(maxBytes) bytes; file is \(data.count) bytes)")
        }
        return out.joined(separator: "\n")
    }

    private func copyToPasteboard(_ text: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = text
        #elseif canImport(AppKit)
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(text, forType: .string)
        #endif
    }
}
