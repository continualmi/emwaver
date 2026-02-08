/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import SwiftUI

#if os(macOS)

/// Extremely-scoped beta UI builder:
/// - macOS only
/// - edits only the top-level UI.column({ children: [...] }) list inside render()
/// - reorders/moves child nodes by rewriting the `children: [...]` array text
///
/// This intentionally does *not* understand arbitrary scripts.
public struct UiTreeBuilderBetaView: View {
    @Binding private var source: String
    private let onDone: () -> Void

    @State private var parseResult: UiTreeBuilderBetaParser.ParseResult?
    @State private var parseError: String?

    public init(source: Binding<String>, onDone: @escaping () -> Void) {
        _source = source
        self.onDone = onDone
    }

    public var body: some View {
        VStack(spacing: 0) {
            header

            Divider()

            HSplitView {
                leftPanel
                    .frame(minWidth: 320, idealWidth: 360)

                rightPanel
                    .frame(minWidth: 420)
            }
        }
        .onAppear { refreshParse() }
        .onChange(of: source) { _ in refreshParse() }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Text("UI Builder (Beta)")
                .font(.headline)

            Text("UI tree only — drag to reorder")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Spacer()

            Button("Done") { onDone() }
                .keyboardShortcut(.defaultAction)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }

    private var leftPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Elements")
                    .font(.subheadline.weight(.semibold))

                Spacer()

                Button {
                    refreshParse()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help("Re-parse")
            }

            if let parseError {
                Text(parseError)
                    .foregroundStyle(.red)
                    .font(.footnote)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

                Spacer()
            } else if let result = parseResult {
                List {
                    ForEach(Array(result.items.enumerated()), id: \.offset) { idx, item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.summary)
                                .font(.system(.body, design: .monospaced))
                                .lineLimit(1)

                            Text(item.kindHint)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        .padding(.vertical, 4)
                    }
                    .onMove { indices, newOffset in
                        applyMove(indices: indices, newOffset: newOffset)
                    }
                }
                .listStyle(.inset)

                Text("Tip: this edits the script by rewriting only the children array. If you change the UI structure manually in code, re-open the builder.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)

                Spacer(minLength: 0)
            } else {
                ProgressView()
                Spacer()
            }
        }
        .padding(12)
    }

    private var rightPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Generated region")
                .font(.subheadline.weight(.semibold))

            if let result = parseResult {
                ScrollView {
                    Text(result.childrenArrayText)
                        .font(.system(.footnote, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .padding(10)
                }
                .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            } else {
                Text("—")
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)
        }
        .padding(12)
    }

    private func refreshParse() {
        do {
            parseResult = try UiTreeBuilderBetaParser.parse(source: source)
            parseError = nil
        } catch {
            parseResult = nil
            parseError = String(describing: error)
        }
    }

    private func applyMove(indices: IndexSet, newOffset: Int) {
        guard let result = parseResult else { return }
        var items = result.items
        items.move(fromOffsets: indices, toOffset: newOffset)

        let updated = UiTreeBuilderBetaParser.rewriteChildrenArray(
            source: source,
            childrenArrayRange: result.childrenArrayRange,
            newItems: items.map { $0.raw }
        )

        // Overwrite the script text; editor keeps undo history at NSTextView level.
        source = updated

        // Update the parse result for stable UI; avoid racing the onChange re-parse.
        parseResult = try? UiTreeBuilderBetaParser.parse(source: updated)
    }
}

#endif
