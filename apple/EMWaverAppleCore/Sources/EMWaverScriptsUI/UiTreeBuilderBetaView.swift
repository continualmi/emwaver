/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import SwiftUI
import EMWaverScriptRuntime
import EMWaverScriptSwiftUI

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

    @StateObject private var previewManager = ScriptPreviewManager()
    @State private var isRenderingPreview = false
    @State private var previewError: String?

    @State private var pendingRenderWorkItem: DispatchWorkItem?

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

                VStack(spacing: 0) {
                    previewPanel

                    Divider()

                    rightPanel
                        .frame(maxHeight: 220)
                }
                .frame(minWidth: 420)
            }
        }
        .onAppear {
            refreshParse()
            renderPreviewDebounced()
        }
        .onChange(of: source) { _ in
            refreshParse()
            renderPreviewDebounced()
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Text("UI Builder (Beta)")
                .font(.headline)

            Text("UI tree only — reorder + add elements")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Spacer()

            Menu {
                Button("Text") { addElement(template: UiTreeBuilderBetaTemplates.text) }
                Button("Button") { addElement(template: UiTreeBuilderBetaTemplates.button) }
                Button("Slider") { addElement(template: UiTreeBuilderBetaTemplates.slider) }
                Button("Spacer") { addElement(template: UiTreeBuilderBetaTemplates.spacer) }
            } label: {
                Label("Add", systemImage: "plus")
            }
            .disabled(parseResult == nil)

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

    private var previewPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Preview")
                    .font(.subheadline.weight(.semibold))

                Spacer()

                if isRenderingPreview {
                    ProgressView()
                        .controlSize(.small)
                }

                Button {
                    renderPreviewDebounced(force: true)
                } label: {
                    Image(systemName: "play.fill")
                }
                .buttonStyle(.borderless)
                .help("Render preview")
            }

            ZStack {
                if let err = previewError, !err.isEmpty {
                    Text(err)
                        .foregroundStyle(.red)
                        .font(.footnote)
                        .padding(10)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                } else if previewManager.scriptTree == nil {
                    Text("No preview yet")
                        .foregroundStyle(.secondary)
                } else {
                    ScriptRenderView(tree: previewManager.scriptTree) { token, args in
                        // UI builder is UI-tree only; handlers still work if present.
                        previewManager.invoke(token: token, arguments: args)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .padding(12)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .padding(12)
    }

    private var rightPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("children: [...] region")
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

        source = updated
        parseResult = try? UiTreeBuilderBetaParser.parse(source: updated)
    }

    private func addElement(template: String) {
        guard let result = parseResult else { return }
        var items = result.items.map { $0.raw }
        items.append(template)

        let updated = UiTreeBuilderBetaParser.rewriteChildrenArray(
            source: source,
            childrenArrayRange: result.childrenArrayRange,
            newItems: items
        )
        source = updated
        parseResult = try? UiTreeBuilderBetaParser.parse(source: updated)
    }

    private func renderPreviewDebounced(force: Bool = false) {
        pendingRenderWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.renderPreview()
        }
        pendingRenderWorkItem = work

        let delay: DispatchTimeInterval = force ? .milliseconds(0) : .milliseconds(120)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func renderPreview() {
        // If parse fails, don't spam render attempts.
        if parseResult == nil {
            previewError = parseError
            return
        }

        isRenderingPreview = true
        previewError = nil

        // No modules for now; this is a local preview.
        previewManager.render(script: source, name: "UI Builder", moduleSources: [:])

        // ScriptPreviewManager reports errors via its published `scriptError`.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            self.isRenderingPreview = false
            if let err = self.previewManager.scriptError, !err.isEmpty {
                self.previewError = err
            } else {
                self.previewError = nil
            }
        }
    }
}

/// Very small set of templates for beta UI tree insertion.
/// (IDs are placeholders; users can refine in code.)
enum UiTreeBuilderBetaTemplates {
    static let text = "UI.text({ text: \"New Text\" })"

    static let button = "UI.button({ id: \"btn.new\", label: \"New Button\" })"

    static let slider = "UI.slider({ id: \"slider.new\", value: 0, min: 0, max: 100, step: 1 })"

    static let spacer = "UI.spacer({})"
}


#endif
